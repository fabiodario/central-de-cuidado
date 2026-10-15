-- Agendamento pelo WhatsApp.
--
-- O paciente escreve "agendar", o sistema pergunta a unidade, lista os horarios
-- realmente livres e marca. Regra da clinica:
--   - paciente ja cadastrado marca direto;
--   - pessoa sem cadastro gera uma solicitacao que a recepcao confirma em ate
--     24h, com o horario reservado nesse periodo para ninguem tomar a vaga.

-- ---------------------------------------------------------------
-- Consultas: quem marcou sem cadastro, e a reserva provisoria
-- ---------------------------------------------------------------

alter table public.appointments
  add column if not exists contact_name text not null default '',
  add column if not exists contact_phone text not null default '',
  add column if not exists confirmed_by_clinic boolean not null default true,
  add column if not exists hold_expires_at timestamptz;

comment on column public.appointments.contact_name is
  'Nome informado por quem marcou sem estar cadastrado como paciente.';
comment on column public.appointments.contact_phone is
  'Telefone de quem marcou pelo WhatsApp, para a recepcao retornar.';
comment on column public.appointments.confirmed_by_clinic is
  'Falso enquanto for uma solicitacao de pessoa sem cadastro aguardando a equipe.';
comment on column public.appointments.hold_expires_at is
  'Ate quando a vaga fica reservada para uma solicitacao nao confirmada.';

alter table public.appointments
  drop constraint if exists appointments_contact_length;
alter table public.appointments
  add constraint appointments_contact_length check (
    char_length(contact_name) <= 160 and char_length(contact_phone) <= 20
  );

create index if not exists appointments_aguardando_idx
  on public.appointments (clinic_id, hold_expires_at)
  where confirmed_by_clinic = false and status = 'scheduled';

-- ---------------------------------------------------------------
-- Estado da conversa
--
-- O fluxo tem etapas ("qual unidade?", "qual horario?") e o webhook e sem
-- memoria entre mensagens. Guardar o estado na propria conversa evita criar
-- tabela nova e some junto com ela quando a conversa e apagada.
-- ---------------------------------------------------------------

alter table public.whatsapp_conversations
  add column if not exists booking_state text,
  add column if not exists booking_options jsonb,
  add column if not exists booking_unit_id uuid,
  add column if not exists booking_updated_at timestamptz;

comment on column public.whatsapp_conversations.booking_state is
  'Etapa do agendamento: aguardando_unidade, aguardando_horario, ou nulo.';
comment on column public.whatsapp_conversations.booking_options is
  'O que foi listado na ultima pergunta, para traduzir a resposta "2" no item certo.';

-- ---------------------------------------------------------------
-- Horarios livres: ignorar reserva provisoria vencida
--
-- Sem isto, uma solicitacao que ninguem confirmou seguraria a vaga para sempre.
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
      where a.unit_id = p_unit_id
        and a.status <> 'cancelled'
        -- Solicitacao sem confirmacao que passou do prazo nao segura mais a
        -- vaga: ela volta a ser oferecida.
        and (a.hold_expires_at is null or a.hold_expires_at > now())
        and a.starts_at < c.fim
        and a.ends_at > c.inicio
    )
  order by c.inicio;
end;
$fn$;

comment on function public.available_slots(uuid) is
  'Horarios livres de uma unidade, considerando regras semanais, excecoes, consultas marcadas, reservas provisorias ainda validas e antecedencia minima.';

grant execute on function public.available_slots(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------
-- Faxina das reservas vencidas
--
-- O available_slots ja ignora as vencidas, mas o indice de horario unico nao -
-- sem cancelar de verdade, a vaga aparece livre e a marcacao falha.
-- ---------------------------------------------------------------

create or replace function public.liberar_reservas_vencidas()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  liberadas integer;
begin
  with alteradas as (
    update public.appointments
       set status = 'cancelled',
           cancelled_at = now(),
           staff_note = case
             when staff_note = '' then 'Solicitacao expirada sem confirmacao da equipe.'
             else staff_note || ' | Solicitacao expirada sem confirmacao da equipe.'
           end
     where status = 'scheduled'
       and confirmed_by_clinic = false
       and hold_expires_at is not null
       and hold_expires_at <= now()
    returning 1
  )
  select count(*) into liberadas from alteradas;
  return liberadas;
end;
$$;

revoke all on function public.liberar_reservas_vencidas() from public, anon;
grant execute on function public.liberar_reservas_vencidas() to authenticated, service_role;

-- De hora em hora: uma vaga nao pode ficar presa o dia inteiro por causa de
-- uma solicitacao que ninguem respondeu.
select cron.unschedule('liberar-reservas-vencidas')
where exists (
  select 1 from cron.job where jobname = 'liberar-reservas-vencidas'
);

select cron.schedule(
  'liberar-reservas-vencidas',
  '5 * * * *',
  $$select public.liberar_reservas_vencidas()$$
);
