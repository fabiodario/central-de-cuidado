begin;

/**
 * Reserva sem cadastro: lembrete em 6h, cancelamento em 23h (01/10/2026).
 *
 * A regra mora em _shared/ficha-pendente.ts; quem executa e a funcao
 * ficha-pendente, chamada aqui a cada 15 minutos. Ver o cabecalho dela para
 * o caso e para os tempos combinados com o Edu.
 *
 * Duas marcas na consulta, para nada acontecer duas vezes:
 *   - ficha_lembrete_em: quando o lembrete saiu (um so por reserva);
 *   - ficha_desfecho: 'cancelada' (o robo cancelou) ou 'equipe' (o robo
 *     desistiu de resolver sozinho e acendeu a conversa). Com qualquer um, a
 *     funcao nao toca mais nessa consulta.
 */

alter table public.appointments
  add column if not exists ficha_lembrete_em timestamptz,
  add column if not exists ficha_desfecho text;

alter table public.appointments drop constraint if exists appointments_ficha_desfecho_valido;
alter table public.appointments add constraint appointments_ficha_desfecho_valido
  check (ficha_desfecho is null or ficha_desfecho in ('cancelada', 'equipe'));

comment on column public.appointments.ficha_lembrete_em is
  'Quando o robo lembrou a familia de completar o cadastro da reserva.';
comment on column public.appointments.ficha_desfecho is
  'Reserva sem cadastro: cancelada pelo robo, ou entregue a equipe.';

-- O disparo, no mesmo molde do lembrete de consulta - e JA com a espera de 2
-- minutos que aquele perdeu em 20/09 (ver 20260928130000): sem ela o pg_net
-- desiste em 5 segundos e registra falha de uma execucao que deu certo.
--
-- No espelho do Dr. Fabio (15/10/2026) a URL sai de private.url_da_funcao
-- (project_url no Vault, ver 20260823210000): a que estava escrita aqui era a
-- do projeto Supabase do Dr. Marcello.
create or replace function private.disparar_ficha_pendente()
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
    raise warning 'cron_secret ausente no Vault; ficha pendente nao sera conferida';
    return;
  end if;

  perform net.http_post(
    url := private.url_da_funcao('ficha-pendente'),
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', segredo
    ),
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function private.disparar_ficha_pendente() from public, anon, authenticated;

select cron.unschedule('ficha-pendente')
where exists (select 1 from cron.job where jobname = 'ficha-pendente');

select cron.schedule(
  'ficha-pendente',
  '*/15 * * * *',
  $$ select private.disparar_ficha_pendente(); $$
);

commit;
