begin;

/**
 * Gerenciar quem ja tem acesso (24/09/2026).
 *
 * A tela de acessos so aprovava ou recusava pedidos novos. Depois de aprovado,
 * ninguem tirava: uma secretaria desligada continuava entrando, e trocar o
 * perfil de alguem exigia mexer no banco. O status 'suspended' existia desde o
 * primeiro dia, mas nada o usava.
 *
 * Duas funcoes, as duas so para o dono ativo da clinica:
 *
 *  - listar_acessos_da_clinica: quem tem vinculo, com nome, e-mail, perfil e
 *    situacao. O e-mail mora em auth.users, que o navegador nao le - por isso
 *    security definer.
 *  - alterar_acesso: muda perfil e/ou suspende/reativa.
 *
 * Travas, porque errar aqui tranca a clinica para fora do proprio sistema:
 *  - ninguem mexe no proprio acesso;
 *  - vinculo de dono nao e alterado por aqui (nem rebaixado, nem suspenso);
 *  - ninguem vira dono por aqui.
 *
 * Suspender vale na hora: toda regra de acesso (private.is_clinic_member e
 * companhia) ja exige status 'active', e e avaliada a cada requisicao.
 */

create or replace function public.listar_acessos_da_clinica(p_clinic uuid)
returns table (
  user_id uuid,
  nome text,
  email text,
  papel public.clinic_role,
  situacao public.membership_status,
  desde timestamptz
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
    m.created_at as desde
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
begin
  if not private.is_clinic_owner(p_clinic) then
    raise exception 'Só o administrador da clínica altera acessos.' using errcode = '42501';
  end if;

  if p_user = auth.uid() then
    raise exception 'Você não pode alterar o seu próprio acesso.' using errcode = '22023';
  end if;

  if p_papel = 'owner'::public.clinic_role then
    raise exception 'O perfil de administrador não é atribuído por aqui.' using errcode = '22023';
  end if;

  select m.role into papel_atual
  from public.clinic_memberships m
  where m.clinic_id = p_clinic and m.user_id = p_user
  for update;

  if not found then
    raise exception 'Esta pessoa não tem acesso a esta clínica.' using errcode = 'P0002';
  end if;

  if papel_atual = 'owner'::public.clinic_role then
    raise exception 'O acesso de administrador não é alterado por aqui.' using errcode = '22023';
  end if;

  update public.clinic_memberships
  set role = p_papel,
      status = p_situacao,
      updated_at = now()
  where clinic_id = p_clinic and user_id = p_user;
end;
$$;

revoke all on function public.listar_acessos_da_clinica(uuid) from public, anon;
revoke all on function public.alterar_acesso(uuid, uuid, public.clinic_role, public.membership_status) from public, anon;
grant execute on function public.listar_acessos_da_clinica(uuid) to authenticated;
grant execute on function public.alterar_acesso(uuid, uuid, public.clinic_role, public.membership_status) to authenticated;

commit;
