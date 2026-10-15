begin;

/**
 * "Faltou" automatico no dia seguinte (25/09/2026).
 *
 * O "Chegou" ja se marca sozinho quando o medico salva a consulta do dia. O
 * que sobrava eram as consultas que ninguem marcou: sem Chegou nem Faltou, a
 * taxa de falta da Agenda ficava errada para menos, e a recepcao tinha de
 * lembrar de fechar o dia. Pedido da clinica: virou o dia sem prontuario,
 * e falta.
 *
 * As protecoes:
 *  - so consulta de paciente de verdade (com ficha ou com nome), confirmada
 *    pela clinica - reserva sem paciente e solicitacao pendente ficam de fora;
 *  - se ha consulta escrita no prontuario daquele dia para o paciente, e
 *    presenca (o casamento da tela pode ter falhado, o banco confere de novo);
 *  - a marca no_show_automatico_em separa esta falta da que a recepcao marcou.
 *    Se o medico escrever o prontuario depois, a tela troca a automatica por
 *    "Chegou"; a marcada a mao nunca e mexida;
 *  - olha so os dois ultimos dias. Consulta antiga sem marca e de antes de a
 *    presenca existir, e chamar aquilo de falta seria reescrever o passado.
 */

alter table public.appointments
  add column if not exists no_show_automatico_em timestamptz;

comment on column public.appointments.no_show_automatico_em is
  'Quando o sistema marcou falta sozinho (dia seguinte sem prontuario). Nulo em falta marcada pela equipe.';

create or replace function private.fechar_presencas_do_dia_anterior()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  inicio timestamptz := ((hoje - 2)::timestamp at time zone 'America/Sao_Paulo');
  fim timestamptz := (hoje::timestamp at time zone 'America/Sao_Paulo');
  presencas integer;
  faltas integer;
begin
  -- Primeiro quem tem prontuario daquele dia: presenca.
  with atendidas as (
    update public.appointments a
       set status = 'attended'
     where a.status = 'scheduled'
       and a.starts_at >= inicio and a.starts_at < fim
       and a.patient_id is not null
       and exists (
         select 1 from public.consultations c
          where c.patient_id = a.patient_id
            and c.clinic_id = a.clinic_id
            and c.archived_at is null
            and c.consultation_date = (a.starts_at at time zone 'America/Sao_Paulo')::date
            and (btrim(c.chief_complaint) <> '' or btrim(c.clinical_history) <> ''
                 or btrim(c.assessment) <> '' or btrim(c.plan) <> '')
       )
    returning 1
  )
  select count(*) into presencas from atendidas;

  -- O resto, que ainda esta "marcada", vira falta automatica.
  with faltaram as (
    update public.appointments a
       set status = 'no_show',
           no_show_automatico_em = now()
     where a.status = 'scheduled'
       and a.starts_at >= inicio and a.starts_at < fim
       and a.confirmed_by_clinic
       and (a.patient_id is not null or btrim(coalesce(a.contact_name, '')) <> '')
    returning 1
  )
  select count(*) into faltas from faltaram;

  -- Grita no log do banco: se isto parar de rodar, a Agenda volta a ficar com
  -- dias abertos, e e aqui que se descobre.
  raise log 'fechar_presencas_do_dia_anterior: % presencas, % faltas', presencas, faltas;
  return presencas + faltas;
end
$function$;

revoke all on function private.fechar_presencas_do_dia_anterior() from public, anon, authenticated;

-- 06:00 UTC = 03:00 em Sao Paulo: o dia anterior ja fechou, e ninguem esta
-- usando a Agenda.
select cron.unschedule('fechar-presencas')
where exists (select 1 from cron.job where jobname = 'fechar-presencas');

select cron.schedule(
  'fechar-presencas',
  '0 6 * * *',
  $$ select private.fechar_presencas_do_dia_anterior(); $$
);

commit;
