begin;

/**
 * Responsavel pelo sistema (24/09/2026).
 *
 * O sistema e de quem o desenvolve e mantem; a clinica usa. Os dois precisam
 * ser administradores - o Dr. Marcello aprova a equipe, suspende quem sai, faz
 * tudo - mas o acesso de quem mantem o sistema nao pode ser cortado por dentro
 * dele. E quem mantem precisa conseguir promover um administrador pela tela,
 * sem depender de mexer no banco.
 *
 * Por isso uma marca a mais, acima do perfil: private.responsaveis_pelo_sistema.
 * Nasce com quem ja e administrador HOJE (o proprio responsavel, antes de
 * qualquer outro ter sido promovido). Regras de alterar_acesso a partir daqui:
 *
 *  - o acesso do responsavel nao e alterado por ninguem, por esta tela;
 *  - qualquer administrador promove outro a administrador (nunca a
 *    responsavel: essa marca nao se da pela tela);
 *  - rebaixar ou suspender um administrador, so o responsavel. Sem isso um
 *    administrador novo poderia tirar o Dr. Marcello, e o erro de promover
 *    alguem por engano ficaria sem volta para quem o cometeu;
 *  - o resto (perfis de equipe, suspender, reativar) qualquer administrador.
 *
 * Fora da tela, o vinculo nao e editavel: clinic_memberships so tem leitura
 * para o navegador.
 */

create table if not exists private.responsaveis_pelo_sistema (
  user_id uuid primary key references auth.users (id) on delete cascade,
  desde timestamptz not null default now()
);

insert into private.responsaveis_pelo_sistema (user_id)
select distinct m.user_id
from public.clinic_memberships m
where m.role = 'owner'::public.clinic_role
  and m.status = 'active'::public.membership_status
on conflict (user_id) do nothing;

create or replace function private.e_responsavel_pelo_sistema(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.responsaveis_pelo_sistema r where r.user_id = p_user);
$$;

-- A lista ganha a coluna "protegido". Mudar colunas de retorno exige recriar.
drop function if exists public.listar_acessos_da_clinica(uuid);
create function public.listar_acessos_da_clinica(p_clinic uuid)
returns table (
  user_id uuid,
  nome text,
  email text,
  papel public.clinic_role,
  situacao public.membership_status,
  desde timestamptz,
  protegido boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_clinic_owner(p_clinic) then
    raise exception 'Só o administrador da clínica vê os acessos.' using errcode = '42501';
  end if;

  return query
  select
    m.user_id,
    coalesce(nullif(trim(p.full_name), ''), '') as nome,
    coalesce(u.email, '')::text as email,
    m.role as papel,
    m.status as situacao,
    m.created_at as desde,
    private.e_responsavel_pelo_sistema(m.user_id) as protegido
  from public.clinic_memberships m
  left join public.profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  where m.clinic_id = p_clinic
  order by m.status, m.role, nome;
end;
$$;

create or replace function public.alterar_acesso(
  p_clinic uuid,
  p_user uuid,
  p_papel public.clinic_role,
  p_situacao public.membership_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  papel_atual public.clinic_role;
  sou_responsavel boolean := private.e_responsavel_pelo_sistema(auth.uid());
begin
  if not private.is_clinic_owner(p_clinic) then
    raise exception 'Só o administrador da clínica altera acessos.' using errcode = '42501';
  end if;

  if p_user = auth.uid() then
    raise exception 'Você não pode alterar o seu próprio acesso.' using errcode = '22023';
  end if;

  if private.e_responsavel_pelo_sistema(p_user) then
    raise exception 'O acesso do responsável pelo sistema não pode ser alterado.' using errcode = '42501';
  end if;

  select m.role into papel_atual
  from public.clinic_memberships m
  where m.clinic_id = p_clinic and m.user_id = p_user
  for update;

  if not found then
    raise exception 'Esta pessoa não tem acesso a esta clínica.' using errcode = 'P0002';
  end if;

  if papel_atual = 'owner'::public.clinic_role and not sou_responsavel then
    raise exception 'Só o responsável pelo sistema altera o acesso de um administrador.' using errcode = '42501';
  end if;

  update public.clinic_memberships
  set role = p_papel,
      status = p_situacao,
      updated_at = now()
  where clinic_id = p_clinic and user_id = p_user;
end;
$$;

revoke all on function public.listar_acessos_da_clinica(uuid) from public, anon;
grant execute on function public.listar_acessos_da_clinica(uuid) to authenticated;
revoke all on function public.alterar_acesso(uuid, uuid, public.clinic_role, public.membership_status) from public, anon;
grant execute on function public.alterar_acesso(uuid, uuid, public.clinic_role, public.membership_status) to authenticated;

commit;
