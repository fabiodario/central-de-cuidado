-- Disparo automatico diario dos acompanhamentos vencidos.
--
-- Ate aqui o sistema so enviava quando alguem clicava em "Enviar agora", o que
-- contraria a premissa dele: "no dia certo, o sistema envia". Este agendamento
-- resolve isso.
--
-- O segredo de autenticacao fica no Vault do Supabase, nunca no corpo do job -
-- a definicao de um job do pg_cron e legivel por qualquer um com acesso ao banco.
--
-- NO ESPELHO DO DR. FABIO (15/10/2026): o endereco das Edge Functions tambem
-- sai do Vault. No sistema do Dr. Marcello a URL do projeto Supabase DELE
-- estava escrita aqui e em mais seis migrations de cron (20260825120000,
-- 20260831050000, 20260920180000, 20260926160000, 20260928130000 e
-- 20261001140000). Copiada assim para o banco do Dr. Fabio, o cron dele
-- chamaria todo dia as funcoes do banco de OUTRA clinica, e nada na tela
-- acusaria. Esta migration ainda nao tinha sido aplicada no banco do Dr.
-- Fabio, por isso foi ajustada aqui mesmo, e nao num arquivo novo.
--
-- Depois do primeiro db push, gravar no Vault do projeto do Dr. Fabio (SQL
-- Editor), junto com o cron_secret:
--
--   select vault.create_secret('https://<ref do projeto>.supabase.co', 'project_url');

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Endereco de uma Edge Function deste projeto, montado com a project_url do
-- Vault. Um lugar so para todas as chamadas do cron.
--
-- O nome project_url e o da documentacao do Supabase (Scheduling Edge
-- Functions). Aceita tambem PROJECT_URL: nome de segredo no Vault diferencia
-- maiusculas, e foi uma letra trocada que deixou o lembrete tres semanas sem
-- sair no sistema do Dr. Marcello (ver 20260920180000).
--
-- Sem a URL, para com erro em vez de seguir calado: a execucao do cron fica
-- marcada como falha, com esta mensagem, e aparece no painel de saude dos
-- envios. Um warning deixaria o cron marcando "sucesso" sem chamar nada.
create or replace function private.url_da_funcao(p_funcao text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base text;
begin
  select btrim(decrypted_secret) into base
  from vault.decrypted_secrets
  where name in ('project_url', 'PROJECT_URL')
  order by case when name = 'project_url' then 0 else 1 end
  limit 1;

  base := rtrim(coalesce(base, ''), '/');

  if base = '' then
    raise exception 'project_url ausente no Vault: a funcao % nao foi chamada', p_funcao
      using hint = 'select vault.create_secret(''https://<ref do projeto>.supabase.co'', ''project_url'');';
  end if;

  if base !~ '^https://[^/[:space:]]+$' then
    raise exception 'project_url no Vault nao e um endereco https valido (%): a funcao % nao foi chamada', base, p_funcao;
  end if;

  return base || '/functions/v1/' || p_funcao;
end;
$$;

revoke all on function private.url_da_funcao(text) from public, anon, authenticated;

comment on function private.url_da_funcao(text) is
  'URL de uma Edge Function deste projeto, a partir da project_url do Vault. Falha com erro quando a project_url falta ou nao e https.';

-- Funcao que o cron chama. Le o segredo do Vault e chama a Edge Function.
create or replace function private.dispatch_whatsapp_followups()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
begin
  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'cron_secret'
  limit 1;

  if secret is null then
    raise warning 'cron_secret ausente no Vault; disparo automatico ignorado';
    return;
  end if;

  -- A funcao vive no esquema net e recebe a url como text. Com search_path
  -- vazio, o tipo precisa ser explicito: url_da_funcao ja devolve text.
  perform net.http_post(
    url := private.url_da_funcao('whatsapp-dispatch'),
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', secret
    ),
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function private.dispatch_whatsapp_followups() from public, anon, authenticated;

-- Todo dia as 12:00 UTC = 09:00 em Brasilia. Horario comercial de proposito:
-- mensagem de clinica nao deve chegar de madrugada.
select cron.unschedule('disparo-acompanhamentos-diario')
where exists (
  select 1 from cron.job where jobname = 'disparo-acompanhamentos-diario'
);

select cron.schedule(
  'disparo-acompanhamentos-diario',
  '0 12 * * *',
  $$select private.dispatch_whatsapp_followups()$$
);
