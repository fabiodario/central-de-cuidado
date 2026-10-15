begin;

/**
 * Notificacao no celular da equipe quando a familia chama (28/09/2026).
 *
 * Ate aqui a conversa que pedia gente so acendia na tela: quem nao estava com
 * a Central aberta so via horas depois. Agora cada celular (Android ou iPhone
 * com o app na tela de inicio) se inscreve em Preferencias, e o meta-webhook
 * avisa quando a conversa entra na fila por 'atendente', 'urgencia',
 * 'documento' ou 'farmacia' - ver _shared/aviso-da-equipe.ts.
 *
 * Duas tabelas:
 *
 *  push_chaves: o par VAPID do servidor, uma linha so. Gerado pela propria
 *    funcao no primeiro uso, para ninguem precisar criar chave e colar em
 *    segredo. Nenhuma politica: so o service role (que ignora RLS) le.
 *
 *  push_inscricoes: um aparelho por linha, por clinica. A pessoa ve e apaga
 *    so as proprias; gravar passa por salvar_inscricao_push, porque o mesmo
 *    celular pode ter sido de outra pessoa da equipe antes (troca de login) e
 *    a linha precisa mudar de dono - coisa que a RLS de UPDATE nao deixaria.
 */

create table if not exists public.push_chaves (
  id smallint primary key default 1 check (id = 1),
  publica text not null,
  privada_jwk jsonb not null,
  criado_em timestamptz not null default now()
);

alter table public.push_chaves enable row level security;
alter table public.push_chaves force row level security;
revoke all on public.push_chaves from public, anon, authenticated;

create table if not exists public.push_inscricoes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  aparelho text not null default '',
  criado_em timestamptz not null default now(),
  ultimo_envio_em timestamptz,
  ultimo_erro text,
  unique (clinic_id, endpoint)
);

create index if not exists push_inscricoes_clinica_idx on public.push_inscricoes (clinic_id);

alter table public.push_inscricoes enable row level security;
alter table public.push_inscricoes force row level security;
revoke all on public.push_inscricoes from public, anon, authenticated;
grant select, delete on public.push_inscricoes to authenticated;

drop policy if exists push_inscricoes_ver_as_minhas on public.push_inscricoes;
create policy push_inscricoes_ver_as_minhas on public.push_inscricoes
  for select to authenticated
  using (user_id = auth.uid() and private.is_clinic_member(clinic_id));

drop policy if exists push_inscricoes_apagar_as_minhas on public.push_inscricoes;
create policy push_inscricoes_apagar_as_minhas on public.push_inscricoes
  for delete to authenticated
  using (user_id = auth.uid());

create or replace function public.salvar_inscricao_push(
  p_clinic uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_aparelho text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
begin
  if auth.uid() is null or not private.is_clinic_member(p_clinic) then
    raise exception 'Sem acesso a esta clinica.' using errcode = '42501';
  end if;
  -- So endereco de servico de push de verdade. Sem isto, qualquer pessoa da
  -- equipe poderia fazer o servidor mandar POST para uma URL qualquer.
  if p_endpoint !~ '^https://[a-z0-9.-]+\.(googleapis\.com|push\.apple\.com|mozilla\.com|mozaws\.net|notify\.windows\.com)/' then
    raise exception 'Endereco de notificacao nao reconhecido.' using errcode = '22023';
  end if;
  if length(coalesce(p_p256dh, '')) < 80 or length(coalesce(p_auth, '')) < 16 then
    raise exception 'Chaves do aparelho invalidas.' using errcode = '22023';
  end if;

  insert into public.push_inscricoes (clinic_id, user_id, endpoint, p256dh, auth, aparelho)
  values (p_clinic, auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_aparelho, ''), 120))
  on conflict (clinic_id, endpoint) do update
     set user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         aparelho = excluded.aparelho,
         ultimo_erro = null
  returning id into v_id;
  return v_id;
end
$function$;

revoke all on function public.salvar_inscricao_push(uuid, text, text, text, text) from public, anon;
grant execute on function public.salvar_inscricao_push(uuid, text, text, text, text) to authenticated;

commit;
