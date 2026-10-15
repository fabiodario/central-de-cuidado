-- Agenda propria da telemedicina (03/10/2026).
--
-- Ate aqui a telemedicina nao tinha agenda: o robo oferecia os horarios das
-- unidades fisicas e gravava a consulta na unidade que cedeu o horario, com
-- modality = 'telemedicina'. Na tela de Agenda ela aparecia misturada com as
-- presenciais daquela unidade, sem marca nenhuma - em 03/10 o Dr. Marcello
-- atendeu por video o Caio (sabado, 14:00) e a consulta estava "em Livance
-- Ibirapuera", onde ninguem procurou.
--
-- Agora a telemedicina e uma unidade de verdade, marcada com telemedicina =
-- true, com horarios proprios cadastrados na Agenda como qualquer outra.
--
-- O medico e um so: um horario de video nao pode coincidir com um presencial.
-- Por isso available_slots passa a cruzar as agendas - a da telemedicina e
-- bloqueada por consulta em qualquer unidade da clinica, e as fisicas sao
-- bloqueadas tambem pelas consultas de video.
--
-- Idempotente de proposito: pode ser aplicada a mao no SQL Editor e de novo
-- pelo db push sem estragar nada.

alter table public.clinic_units
  add column if not exists telemedicina boolean not null default false;

comment on column public.clinic_units.telemedicina is
  'Unidade que e a agenda da telemedicina (atendimento por video). No maximo uma ativa por clinica.';

create unique index if not exists clinic_units_uma_telemedicina_ativa
  on public.clinic_units (clinic_id)
  where telemedicina and archived_at is null;

-- A agenda da telemedicina das clinicas que oferecem telemedicina.
insert into public.clinic_units (clinic_id, name, address, telemedicina)
select s.clinic_id, 'Telemedicina', '', true
from public.clinic_settings s
where s.telemedicine_enabled
  and not exists (
    select 1 from public.clinic_units u
    where u.clinic_id = s.clinic_id and u.telemedicina and u.archived_at is null
  );

-- Consulta marcada na agenda da telemedicina e consulta por video, venha de
-- onde vier (robo, Agenda, "marcar retorno" no prontuario). Assim nenhuma tela
-- precisa lembrar de mandar a modalidade - e o lembrete da vespera, que diz
-- "por video" olhando a modalidade, continua certo.
create or replace function private.modalidade_pela_unidade()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.unit_id is not null and exists (
    select 1 from public.clinic_units u where u.id = new.unit_id and u.telemedicina
  ) then
    new.modality := 'telemedicina';
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_modalidade_pela_unidade on public.appointments;
create trigger appointments_modalidade_pela_unidade
  before insert or update of unit_id on public.appointments
  for each row execute function private.modalidade_pela_unidade();

-- As consultas por video que ja existiam vao para a agenda da telemedicina.
-- Inclui a do Caio (03/10, 14:00), que motivou tudo isto.
--
-- O indice de horario unico e por unidade: se duas consultas de video caissem
-- no mesmo instante (nao deveria, era o mesmo medico), a segunda fica onde
-- esta em vez de derrubar a migration inteira.
update public.appointments a
   set unit_id = tele.id
  from public.clinic_units tele
 where tele.clinic_id = a.clinic_id
   and tele.telemedicina
   and tele.archived_at is null
   and a.modality = 'telemedicina'
   and a.unit_id is distinct from tele.id
   and (
     a.status = 'cancelled'
     or not exists (
       select 1 from public.appointments b
       where b.unit_id = tele.id
         and b.starts_at = a.starts_at
         and b.status <> 'cancelled'
         and b.id <> a.id
     )
   );

-- ---------------------------------------------------------------
-- Horarios livres, agora cruzando a telemedicina com as unidades fisicas
-- ---------------------------------------------------------------
create or replace function public.available_slots(p_unit_id uuid)
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

  v_primeiro_dia := (now() at time zone v_tz)::date;
  v_ultimo_dia := v_primeiro_dia + v_horizon_days;

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
comment on function public.available_slots(uuid) is
  'Horarios livres de uma unidade, considerando regras semanais, excecoes, consultas marcadas (inclusive as de video, que ocupam o mesmo medico), reservas provisorias ainda validas e antecedencia minima.';

grant execute on function public.available_slots(uuid) to authenticated, service_role;
