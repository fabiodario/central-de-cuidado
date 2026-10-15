begin;

/**
 * O lembrete da véspera parou de sair em 31/08/2026. Este arquivo conserta.
 *
 * O QUE ACONTECEU: a migration 20260831050000, que trocou a passada única das
 * 10h por uma varredura de hora em hora, recriou o job do pg_cron buscando o
 * segredo no Vault pelo nome 'CRON_SECRET', em maiúsculas. Todo o resto do
 * sistema guarda e lê esse segredo como 'cron_secret' - é o nome usado desde
 * 23/08, e é o que existe no Vault.
 *
 * O nome de um segredo no Vault diferencia maiúsculas de minúsculas. O SELECT
 * por 'CRON_SECRET' não achava nada e devolvia NULL; o job seguia em frente e
 * chamava a Edge Function com o cabeçalho x-cron-secret vazio; a função
 * respondia 401 e encerrava. Sem erro em lugar nenhum: o cron marcava sucesso,
 * porque a requisição HTTP foi feita - quem recusou foi o outro lado.
 *
 * COMO ISSO APARECEU: conferindo as conversas em 20/09/2026, só DUAS das 29
 * tinham lembrete registrado, ambas de 31/08 - o dia em que a migration
 * entrou. Nenhuma consulta de setembro recebeu, incluindo as de 16/09 e 18/09,
 * com pacientes que compareceram. A configuração da clínica estava correta o
 * tempo todo: lembrete ligado, um dia de antecedência.
 *
 * O CONSERTO, e por que assim: o coalesce aceita os dois nomes. Fixar só o
 * minúsculo consertaria hoje e deixaria a mesma armadilha para quem renomear o
 * segredo amanhã; aceitar os dois faz o job funcionar com qualquer um dos dois
 * no Vault.
 *
 * E o raise: se NENHUM dos dois existir, o job passa a gritar no log em vez de
 * fazer uma chamada que será recusada em silêncio. Falha barulhenta é a única
 * diferença entre um defeito de um dia e um de três semanas.
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
    )
  );
end;
$$;

revoke all on function private.disparar_lembretes_de_consulta() from public, anon, authenticated;

comment on function private.disparar_lembretes_de_consulta() is
  'Chama a Edge Function dos lembretes com o segredo do Vault. Aceita cron_secret e CRON_SECRET, e avisa no log quando nao acha nenhum.';

-- O job passa a chamar a função, em vez de carregar o SQL no corpo dele.
--
-- Não é organização: a definição de um job do pg_cron é legível por qualquer
-- um com acesso ao banco, e com a consulta ao Vault ali dentro o nome do
-- segredo ficava exposto - foi assim que o erro de maiúsculas passou
-- despercebido, escrito num lugar que ninguém relê. Dentro de uma função
-- security definer, ele fica num lugar só, com nome e comentário.
select cron.unschedule('lembretes-consulta')
where exists (select 1 from cron.job where jobname = 'lembretes-consulta');

select cron.schedule(
  'lembretes-consulta',
  '20 * * * *',
  $$ select private.disparar_lembretes_de_consulta(); $$
);

commit;
