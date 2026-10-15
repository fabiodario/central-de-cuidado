-- Modulo de agenda: unidades, horarios de atendimento, bloqueios e consultas
-- marcadas. E a base tanto do calendario na tela quanto do agendamento que o
-- paciente faz sozinho pelo WhatsApp.
--
-- Ate aqui "unidade" era so um texto livre no cadastro do paciente, usado como
-- indicador. Agora vira entidade de verdade, porque cada unidade tem horario
-- proprio e o paciente precisa escolher onde quer ser atendido.

-- ---------------------------------------------------------------
-- Preferencias da agenda (por clinica, editaveis no painel)
-- ---------------------------------------------------------------

alter table public.clinic_settings
  add column if not exists schedule_slot_minutes integer not null default 30,
  add column if not exists schedule_horizon_days integer not null default 15,
  add column if not exists schedule_min_notice_hours integer not null default 2;

alter table public.clinic_settings
  drop constraint if exists clinic_settings_slot_minutes_valid;
alter table public.clinic_settings
  add constraint clinic_settings_slot_minutes_valid
  check (schedule_slot_minutes between 5 and 240);

alter table public.clinic_settings
  drop constraint if exists clinic_settings_horizon_valid;
alter table public.clinic_settings
  add constraint clinic_settings_horizon_valid
  check (schedule_horizon_days between 1 and 180);

alter table public.clinic_settings
  drop constraint if exists clinic_settings_notice_valid;
alter table public.clinic_settings
  add constraint clinic_settings_notice_valid
  check (schedule_min_notice_hours between 0 and 168);

comment on column public.clinic_settings.schedule_slot_minutes is
  'Duracao de cada bloco da agenda, em minutos.';
comment on column public.clinic_settings.schedule_horizon_days is
  'Ate quantos dias a frente o paciente pode escolher horario.';
comment on column public.clinic_settings.schedule_min_notice_hours is
  'Anteced encia minima: impede o paciente de marcar para daqui a pouco.';

-- ---------------------------------------------------------------
-- Unidades de atendimento
-- ---------------------------------------------------------------

create table if not exists public.clinic_units (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  name text not null,
  address text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint clinic_units_id_clinic_unique unique (id, clinic_id),
  constraint clinic_units_name_length check (char_length(btrim(name)) between 1 and 160),
  constraint clinic_units_address_length check (char_length(address) <= 400)
);

create index if not exists clinic_units_clinic_idx
  on public.clinic_units (clinic_id) where archived_at is null;

-- ---------------------------------------------------------------
-- Regras semanais de atendimento
-- Ex.: unidade X atende segunda das 08:00 as 12:00.
-- ---------------------------------------------------------------

create table if not exists public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  unit_id uuid not null,
  weekday smallint not null,
  starts_at time not null,
  ends_at time not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint availability_rules_unit_fk
    foreign key (unit_id, clinic_id) references public.clinic_units (id, clinic_id) on delete cascade,
  -- 0 = domingo, seguindo o extract(dow) do Postgres
  constraint availability_rules_weekday_valid check (weekday between 0 and 6),
  constraint availability_rules_period_valid check (ends_at > starts_at)
);

create index if not exists availability_rules_unit_idx
  on public.availability_rules (unit_id, weekday);

-- ---------------------------------------------------------------
-- Excecoes: feriado, ferias, congresso, ou horario extra pontual
-- ---------------------------------------------------------------

create table if not exists public.schedule_exceptions (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  unit_id uuid,
  exception_date date not null,
  is_closed boolean not null default true,
  starts_at time,
  ends_at time,
  reason text not null default '',
  created_at timestamptz not null default now(),
  constraint schedule_exceptions_unit_fk
    foreign key (unit_id, clinic_id) references public.clinic_units (id, clinic_id) on delete cascade,
  constraint schedule_exceptions_reason_length check (char_length(reason) <= 240),
  -- Fechado nao precisa de horario; horario extra precisa dos dois.
  constraint schedule_exceptions_period_valid check (
    (is_closed and starts_at is null and ends_at is null)
    or (not is_closed and starts_at is not null and ends_at is not null and ends_at > starts_at)
  )
);

create index if not exists schedule_exceptions_lookup_idx
  on public.schedule_exceptions (clinic_id, exception_date);

comment on column public.schedule_exceptions.unit_id is
  'Nulo significa que a excecao vale para todas as unidades da clinica.';

-- ---------------------------------------------------------------
-- Consultas marcadas
-- ---------------------------------------------------------------

do $$ begin
  create type public.appointment_status as enum
    ('scheduled', 'attended', 'cancelled', 'no_show');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.appointment_source as enum ('clinic', 'whatsapp');
exception when duplicate_object then null;
end $$;

create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  unit_id uuid not null,
  patient_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.appointment_status not null default 'scheduled',
  source public.appointment_source not null default 'clinic',
  patient_note text not null default '',
  staff_note text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint appointments_unit_fk
    foreign key (unit_id, clinic_id) references public.clinic_units (id, clinic_id) on delete restrict,
  constraint appointments_patient_fk
    foreign key (patient_id, clinic_id) references public.patients (id, clinic_id) on delete restrict,
  constraint appointments_period_valid check (ends_at > starts_at),
  constraint appointments_notes_length check (
    char_length(patient_note) <= 500 and char_length(staff_note) <= 500
  )
);

-- Impede dois pacientes no mesmo horario da mesma unidade. Consultas canceladas
-- ficam de fora, para o horario poder ser reaproveitado.
create unique index if not exists appointments_slot_unique
  on public.appointments (unit_id, starts_at)
  where status <> 'cancelled';

create index if not exists appointments_clinic_period_idx
  on public.appointments (clinic_id, starts_at);
create index if not exists appointments_patient_idx
  on public.appointments (patient_id) where patient_id is not null;

drop trigger if exists clinic_units_set_updated_at on public.clinic_units;
create trigger clinic_units_set_updated_at
before update on public.clinic_units
for each row execute function private.set_updated_at();

drop trigger if exists availability_rules_set_updated_at on public.availability_rules;
create trigger availability_rules_set_updated_at
before update on public.availability_rules
for each row execute function private.set_updated_at();

drop trigger if exists appointments_set_updated_at on public.appointments;
create trigger appointments_set_updated_at
before update on public.appointments
for each row execute function private.set_updated_at();
