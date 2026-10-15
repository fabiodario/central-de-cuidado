begin;

/**
 * O disparo do lembrete volta a esperar a resposta por 2 minutos (28/09/2026).
 *
 * Em 20/09 (20260920180000_consertar_segredo_do_lembrete) esta funcao foi
 * reescrita para ler o segredo do Vault, e o net.http_post perdeu o
 * timeout_milliseconds := 120000 que a versao de 25/08 tinha. Sem ele o pg_net
 * usa o padrao de 5 segundos.
 *
 * O painel de saude mostrou em 28/09: "chamada de robo recusada - Timeout of
 * 5000 ms reached". A funcao do lembrete passa por todas as clinicas e fala
 * com a Meta para cada consulta; com a clinica de teste ligada ao numero de
 * teste, a passada passou de 5 segundos. O banco desistia de esperar e
 * registrava falha, sem saber se os lembretes tinham saido - exatamente o
 * tipo de duvida que o painel existe para nao deixar.
 *
 * Mesma funcao, mesmo segredo, so com o prazo de volta. O disparo diario dos
 * acompanhamentos (whatsapp-dispatch) e o aviso de Santos ja tinham prazo.
 *
 * No espelho do Dr. Fabio (15/10/2026) a URL sai de private.url_da_funcao
 * (project_url no Vault, ver 20260823210000): a que estava escrita aqui era a
 * do projeto Supabase do Dr. Marcello.
 */

create or replace function private.disparar_lembretes_de_consulta()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  segredo text;
begin
  select decrypted_secret into segredo
  from vault.decrypted_secrets
  where name in ('cron_secret', 'CRON_SECRET')
  order by case when name = 'cron_secret' then 0 else 1 end
  limit 1;

  if segredo is null then
    raise warning 'cron_secret ausente no Vault; lembretes de consulta nao serao enviados';
    return;
  end if;

  perform net.http_post(
    url := private.url_da_funcao('appointment-reminders'),
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', segredo
    ),
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function private.disparar_lembretes_de_consulta() from public, anon, authenticated;

commit;
