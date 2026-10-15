begin;

/**
 * Horarios livres por periodo (14/10/2026), para o botao "Mandar horarios".
 *
 * A secretaria digitava a mao a lista de horarios no WhatsApp e, depois que a
 * familia escolhia, marcava na Agenda - tres vezes so entre 13 e 14/10
 * (Gustavo, Giovana, Cecilia). Agora ela escolhe a unidade e o periodo, o
 * robo manda a lista tocavel e marca sozinho quando a familia toca.
 *
 * O periodo precisa passar da agenda aberta (15 dias): a Cecilia tinha de
 * voltar em 40 dias, "dia 27/11". available_slots so enxergava a janela da
 * clinica. A regra inteira (dias fechados, periodos, horarios extras,
 * antecedencia, consultas e video ocupando o mesmo medico) passa a morar em
 * available_slots_periodo, e available_slots vira o atalho dela sem periodo:
 * uma regra so, que nao tem como divergir. O resultado de available_slots
 * nao muda (conferido no Postgres, ver tests/horarios-periodo.test.mjs).
 *
 * Teto de 180 dias: lista de horarios de meio ano e engano de digitacao.
 */

create or replace function public.available_slots_periodo(
  p_unit_id uuid,
  p_de date default null,
  p_ate date default null
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
  v_horizon_days integer;
  v_notice_hours integer;
  v_hoje date;
  v_primeiro_dia date;
  v_ultimo_dia date;
  v_e_tele boolean;
begin
  select unit.clinic_id, coalesce(clinic.timezone, 'America/Sao_Paulo'), unit.telemedicina
    into v_clinic_id, v_tz, v_e_tele
  from public.clinic_units unit
  join public.clinics clinic on clinic.id = unit.clinic_id
  where unit.id = p_unit_id and unit.archived_at is null;

  if v_clinic_id is null then
    return;
  end if;

  select coalesce(settings.schedule_slot_minutes, 40),
         coalesce(settings.schedule_horizon_days, 15),
         coalesce(settings.schedule_min_notice_hours, 2)
    into v_slot_minutes, v_horizon_days, v_notice_hours
  from public.clinic_settings settings
  where settings.clinic_id = v_clinic_id;

  v_slot_minutes := coalesce(v_slot_minutes, 40);
  v_horizon_days := coalesce(v_horizon_days, 15);
  v_notice_hours := coalesce(v_notice_hours, 2);

  -- Sem periodo, a agenda aberta de sempre: de hoje ate a janela da clinica.
  -- Com periodo (a equipe mandando horarios para uma data combinada), vale o
  -- pedido, nunca antes de hoje e nunca alem de 180 dias.
  v_hoje := (now() at time zone v_tz)::date;
  v_primeiro_dia := greatest(v_hoje, coalesce(p_de, v_hoje));
  v_ultimo_dia := least(coalesce(p_ate, v_primeiro_dia + v_horizon_days), v_hoje + 180);
  if v_ultimo_dia < v_primeiro_dia then
    return;
  end if;

  return query
  with dias as (
    select generate_series(v_primeiro_dia, v_ultimo_dia, interval '1 day')::date as dia
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
      where a.status <> 'cancelled'
        -- Solicitacao sem confirmacao que passou do prazo nao segura mais a
        -- vaga: ela volta a ser oferecida.
        and (a.hold_expires_at is null or a.hold_expires_at > now())
        and a.starts_at < c.fim
        and a.ends_at > c.inicio
        and (
          a.unit_id = p_unit_id
          -- O medico e um so (03/10/2026): a agenda de video para quando ha
          -- consulta em qualquer unidade, e as fisicas param quando ha video.
          or (
            a.clinic_id = v_clinic_id
            and (
              v_e_tele
              or exists (
                select 1 from public.clinic_units t
                where t.id = a.unit_id and t.telemedicina
              )
            )
          )
        )
    )
  order by c.inicio;
end;
$fn$;

comment on function public.available_slots_periodo(uuid, date, date) is
  'Horarios livres de uma unidade entre p_de e p_ate (sem periodo, a agenda aberta da clinica). Mesma regra de available_slots, que e o atalho desta sem periodo.';

grant execute on function public.available_slots_periodo(uuid, date, date) to authenticated, service_role;

-- O mesmo nome e a mesma assinatura de sempre: robo, Agenda e simulador
-- continuam chamando available_slots(p_unit_id) sem mudar nada.
create or replace function public.available_slots(p_unit_id uuid)
returns table (slot_start timestamptz, slot_end timestamptz)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select s.slot_start, s.slot_end from public.available_slots_periodo(p_unit_id, null, null) s;
$fn$;

grant execute on function public.available_slots(uuid) to authenticated, service_role;

commit;
