begin;

/**
 * Horarios livres numa janela de datas, para marcar o retorno (25/09/2026).
 *
 * available_slots so enxerga os proximos N dias (schedule_horizon_days, 15 por
 * padrao) - e de proposito: e o que o robo oferece as familias, e ninguem quer
 * a agenda de marco aberta no WhatsApp em setembro. Mas o retorno que o medico
 * pede ao fim da consulta e em 30, 60, 90 dias, alem dessa janela. Sem isto, o
 * "volte em 3 meses" virava um recado que dependia da familia lembrar.
 *
 * Mesma conta de available_slots (regras da semana, excecoes, consultas
 * marcadas, reservas ainda validas, antecedencia minima), so que numa janela
 * escolhida por quem chama - no maximo 31 dias de largura e ate 400 dias a
 * frente, para ninguem pedir a agenda do ano inteiro de uma vez.
 *
 * security invoker: roda com as permissoes de quem chama, como available_slots.
 */

create or replace function public.horarios_livres_entre(
  p_unit_id uuid,
  p_de date,
  p_ate date
)
returns table (slot_start timestamptz, slot_end timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_clinic_id uuid;
  v_tz text;
  v_slot_minutes integer;
  v_notice_hours integer;
  v_hoje date;
  v_de date;
  v_ate date;
begin
  select unit.clinic_id, coalesce(clinic.timezone, 'America/Sao_Paulo')
    into v_clinic_id, v_tz
  from public.clinic_units unit
  join public.clinics clinic on clinic.id = unit.clinic_id
  where unit.id = p_unit_id and unit.archived_at is null;

  if v_clinic_id is null then
    return;
  end if;

  select coalesce(settings.schedule_slot_minutes, 40),
         coalesce(settings.schedule_min_notice_hours, 2)
    into v_slot_minutes, v_notice_hours
  from public.clinic_settings settings
  where settings.clinic_id = v_clinic_id;

  v_slot_minutes := coalesce(v_slot_minutes, 40);
  v_notice_hours := coalesce(v_notice_hours, 2);

  v_hoje := (now() at time zone v_tz)::date;
  v_de := greatest(p_de, v_hoje);
  v_ate := least(p_ate, v_de + 31, v_hoje + 400);
  if v_ate < v_de then
    return;
  end if;

  return query
  with dias as (
    select generate_series(v_de, v_ate, interval '1 day')::date as dia
  ),
  fechados as (
    select d.dia
    from dias d
    join public.schedule_exceptions e
      on e.exception_date = d.dia
     and e.clinic_id = v_clinic_id
     and e.is_closed
     and (e.unit_id is null or e.unit_id = p_unit_id)
  ),
  periodos as (
    select d.dia, r.starts_at, r.ends_at
    from dias d
    join public.availability_rules r
      on r.unit_id = p_unit_id
     and r.weekday = extract(dow from d.dia)::smallint
    where d.dia not in (select dia from fechados)
    union all
    select d.dia, e.starts_at, e.ends_at
    from dias d
    join public.schedule_exceptions e
      on e.exception_date = d.dia
     and e.clinic_id = v_clinic_id
     and not e.is_closed
     and (e.unit_id is null or e.unit_id = p_unit_id)
  ),
  blocos as (
    select
      ((p.dia + p.starts_at) at time zone v_tz) as inicio_local,
      ((p.dia + p.ends_at) at time zone v_tz) as fim_local
    from periodos p
  ),
  candidatos as (
    select
      gs as inicio,
      gs + make_interval(mins => v_slot_minutes) as fim
    from blocos b,
    lateral generate_series(
      b.inicio_local,
      b.fim_local - make_interval(mins => v_slot_minutes),
      make_interval(mins => v_slot_minutes)
    ) as gs
  )
  select distinct c.inicio, c.fim
  from candidatos c
  where c.inicio >= now() + make_interval(hours => v_notice_hours)
    and not exists (
      select 1
      from public.appointments a
      where a.unit_id = p_unit_id
        and a.status <> 'cancelled'
        and (a.hold_expires_at is null or a.hold_expires_at > now())
        and a.starts_at < c.fim
        and a.ends_at > c.inicio
    )
  order by c.inicio;
end;
$fn$;

comment on function public.horarios_livres_entre(uuid, date, date) is
  'Horarios livres de uma unidade entre duas datas (ate 31 dias de janela e 400 a frente). Mesma regra de available_slots, sem o horizonte do robo. Usada para marcar retorno pelo prontuario.';

revoke all on function public.horarios_livres_entre(uuid, date, date) from public, anon;
grant execute on function public.horarios_livres_entre(uuid, date, date) to authenticated;

commit;
