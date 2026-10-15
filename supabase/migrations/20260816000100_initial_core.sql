begin;

-- Core schema for the initial, single-clinic follow-up application.
-- The tenant key is kept on every clinical table so isolation remains explicit
-- if the product later supports more than one clinic per account.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

do $migration$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'clinic_role'
  ) then
    create type public.clinic_role as enum ('owner', 'clinician', 'staff', 'viewer');
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'membership_status'
  ) then
    create type public.membership_status as enum ('active', 'suspended');
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'patient_sex'
  ) then
    create type public.patient_sex as enum ('F', 'M', 'O');
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'followup_key'
  ) then
    create type public.followup_key as enum ('d30', 'm90');
  end if;

  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'followup_status'
  ) then
    create type public.followup_status as enum ('pending', 'opened', 'completed');
  end if;
end
$migration$;

create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/Sao_Paulo',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint clinics_name_length check (char_length(btrim(name)) between 2 and 120),
  constraint clinics_timezone_length check (char_length(btrim(timezone)) between 1 and 80)
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint profiles_full_name_length check (char_length(full_name) <= 200)
);

create table if not exists public.clinic_memberships (
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.clinic_role not null default 'staff',
  status public.membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (clinic_id, user_id)
);

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  name text not null,
  guardian_name text not null default '',
  birth_date date,
  sex public.patient_sex not null default 'O',
  phone text not null default '',
  city text not null default '',
  neighborhood text not null default '',
  insurance text not null default '',
  cid text not null default '',
  unit text not null default '',
  consultation_date date not null,
  notes text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint patients_id_clinic_unique unique (id, clinic_id),
  constraint patients_name_length check (char_length(btrim(name)) between 1 and 200),
  constraint patients_guardian_name_length check (char_length(guardian_name) <= 200),
  constraint patients_phone_length check (char_length(phone) <= 32),
  constraint patients_city_length check (char_length(city) <= 120),
  constraint patients_neighborhood_length check (char_length(neighborhood) <= 120),
  constraint patients_insurance_length check (char_length(insurance) <= 160),
  constraint patients_cid_length check (char_length(cid) <= 32),
  constraint patients_unit_length check (char_length(unit) <= 160)
);

create table if not exists public.followups (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null,
  clinic_id uuid not null,
  followup_key public.followup_key not null,
  status public.followup_status not null default 'pending',
  due_date date not null,
  opened_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint followups_patient_clinic_fk
    foreign key (patient_id, clinic_id)
    references public.patients (id, clinic_id)
    on delete restrict,
  constraint followups_patient_key_unique unique (patient_id, followup_key)
);

-- Textos padrao do acompanhamento (15/10/2026, espelho do Dr. Fabio): os mesmos
-- de DEFAULT_TEMPLATES em src/lib/store.ts. No sistema de origem eram os do
-- Dr. Marcello ("equipe do Dr. Marcello Ruiz, gastroenterologista
-- pediatrico"), e o default vale para toda clinica criada depois: a do Dr.
-- Fabio nasceria mandando acompanhamento em nome de outro medico. Esta
-- migration ainda nao tinha sido aplicada no banco do Dr. Fabio, entao foi
-- ajustada aqui mesmo. 20260816000200 repete o default e foi trocada igual.
create table if not exists public.clinic_settings (
  clinic_id uuid primary key references public.clinics (id) on delete restrict,
  template_d30 text not null default
    'Olá! Aqui é da equipe do Dr. Fábio Dario, otorrinolaringologista. Já se passaram 30 dias da consulta de {nome}. Como {pronome} está? Está respirando melhor? Se precisar de qualquer auxílio, é só responder por aqui. 💙',
  template_m90 text not null default
    'Olá! Aqui é da equipe do Dr. Fábio Dario. Já se passaram 3 meses da consulta de {nome} e gostaríamos de saber como {pronome} está. Está tudo bem? Qualquer necessidade, estamos à disposição. 💙',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinic_settings_template_d30_length
    check (char_length(template_d30) between 1 and 4096),
  constraint clinic_settings_template_m90_length
    check (char_length(template_m90) between 1 and 4096)
);

create index if not exists clinic_memberships_user_clinic_idx
  on public.clinic_memberships (user_id, clinic_id);

create index if not exists clinics_created_by_idx
  on public.clinics (created_by)
  where created_by is not null;

create index if not exists patients_clinic_active_updated_idx
  on public.patients (clinic_id, updated_at desc)
  where archived_at is null;

create index if not exists patients_clinic_name_idx
  on public.patients (clinic_id, name);

create index if not exists patients_created_by_idx
  on public.patients (created_by)
  where created_by is not null;

create index if not exists patients_updated_by_idx
  on public.patients (updated_by)
  where updated_by is not null;

create index if not exists followups_clinic_status_due_idx
  on public.followups (clinic_id, status, due_date)
  where archived_at is null;

create index if not exists followups_patient_idx
  on public.followups (patient_id);

create index if not exists followups_created_by_idx
  on public.followups (created_by)
  where created_by is not null;

create index if not exists followups_updated_by_idx
  on public.followups (updated_by)
  where updated_by is not null;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end
$function$;

create or replace function private.set_clinical_actor()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if current_user_id is not null then
      new.created_by := current_user_id;
      new.updated_by := current_user_id;
    end if;
  else
    new.created_by := old.created_by;
    if current_user_id is not null then
      new.updated_by := current_user_id;
    else
      new.updated_by := old.updated_by;
    end if;
  end if;

  return new;
end
$function$;

create or replace function private.prevent_clinic_id_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.clinic_id is distinct from old.clinic_id then
    raise exception 'clinic_id cannot be changed'
      using errcode = '22000';
  end if;

  return new;
end
$function$;

create or replace function private.prevent_followup_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.patient_id is distinct from old.patient_id
     or new.followup_key is distinct from old.followup_key then
    raise exception 'follow-up identity cannot be changed'
      using errcode = '22000';
  end if;

  return new;
end
$function$;

create or replace function private.normalize_followup_status()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    if new.status = 'opened' then
      new.opened_at := now();
      new.completed_at := null;
    elsif new.status = 'completed' then
      new.opened_at := null;
      new.completed_at := now();
    else
      new.opened_at := null;
      new.completed_at := null;
    end if;
    return new;
  end if;

  if old.status = 'completed' and new.status <> 'completed' then
    raise exception 'a completed follow-up cannot be reopened'
      using errcode = '22000';
  end if;

  if new.status = old.status then
    new.opened_at := old.opened_at;
    new.completed_at := old.completed_at;
  elsif new.status = 'opened' then
    new.opened_at := coalesce(old.opened_at, now());
    new.completed_at := null;
  elsif new.status = 'completed' then
    new.opened_at := old.opened_at;
    new.completed_at := now();
  else
    raise exception 'invalid follow-up status transition'
      using errcode = '22000';
  end if;

  return new;
end
$function$;

create or replace function private.create_patient_followups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.followups (
    patient_id,
    clinic_id,
    followup_key,
    status,
    due_date,
    created_by,
    updated_by
  )
  values
    (
      new.id,
      new.clinic_id,
      'd30',
      'pending',
      new.consultation_date + 30,
      new.created_by,
      new.updated_by
    ),
    (
      new.id,
      new.clinic_id,
      'm90',
      'pending',
      new.consultation_date + 90,
      new.created_by,
      new.updated_by
    )
  on conflict (patient_id, followup_key) do nothing;

  return new;
end
$function$;

create or replace function private.sync_patient_followups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.consultation_date is distinct from old.consultation_date then
    update public.followups
    set due_date = case followup_key
      when 'd30' then new.consultation_date + 30
      when 'm90' then new.consultation_date + 90
    end
    where patient_id = new.id
      and clinic_id = new.clinic_id
      and status = 'pending'
      and archived_at is null;
  end if;

  if new.archived_at is not null and old.archived_at is null then
    update public.followups
    set archived_at = new.archived_at
    where patient_id = new.id
      and clinic_id = new.clinic_id
      and archived_at is null;
  elsif new.archived_at is null and old.archived_at is not null then
    update public.followups
    set archived_at = null
    where patient_id = new.id
      and clinic_id = new.clinic_id
      and archived_at = old.archived_at;
  end if;

  return new;
end
$function$;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    left(
      coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'Usuário'
      ),
      200
    )
  )
  on conflict (id) do nothing;

  return new;
end
$function$;

create or replace function private.is_clinic_member(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.clinic_memberships membership
    join public.clinics clinic on clinic.id = membership.clinic_id
    join public.profiles profile on profile.id = membership.user_id
    where membership.clinic_id = p_clinic_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and clinic.archived_at is null
      and profile.archived_at is null
  );
$function$;

create or replace function private.is_clinic_owner(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.clinic_memberships membership
    join public.profiles profile on profile.id = membership.user_id
    where membership.clinic_id = p_clinic_id
      and membership.user_id = auth.uid()
      and membership.role = 'owner'
      and membership.status = 'active'
      and profile.archived_at is null
  );
$function$;

create or replace function private.is_clinic_editor(p_clinic_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.clinic_memberships membership
    join public.clinics clinic on clinic.id = membership.clinic_id
    join public.profiles profile on profile.id = membership.user_id
    where membership.clinic_id = p_clinic_id
      and membership.user_id = auth.uid()
      and membership.role in ('owner', 'clinician', 'staff')
      and membership.status = 'active'
      and clinic.archived_at is null
      and profile.archived_at is null
  );
$function$;

create or replace function private.shares_active_clinic(p_other_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.clinic_memberships mine
    join public.clinic_memberships theirs
      on theirs.clinic_id = mine.clinic_id
    join public.clinics clinic on clinic.id = mine.clinic_id
    where mine.user_id = auth.uid()
      and theirs.user_id = p_other_user_id
      and mine.status = 'active'
      and theirs.status = 'active'
      and clinic.archived_at is null
  );
$function$;

-- This is the one intentionally exposed SECURITY DEFINER function. It is
-- required to cross the bootstrap gap, when an authenticated user has no
-- membership and therefore cannot insert a clinic through RLS. Its caller can
-- choose only the clinic name; user identity always comes from auth.uid().
create or replace function public.bootstrap_current_user_clinic(clinic_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  normalized_name text := btrim(clinic_name);
  new_clinic_id uuid;
begin
  if current_user_id is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  if normalized_name is null
     or char_length(normalized_name) < 2
     or char_length(normalized_name) > 120 then
    raise exception 'clinic_name must contain between 2 and 120 characters'
      using errcode = '22023';
  end if;

  -- Serialize concurrent bootstrap attempts for the same Auth user.
  perform 1
  from auth.users
  where id = current_user_id
  for update;

  if not found then
    raise exception 'authenticated user no longer exists'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.clinic_memberships
    where user_id = current_user_id
  ) then
    raise exception 'user already belongs to a clinic'
      using errcode = '23505';
  end if;

  insert into public.profiles (id, full_name)
  select
    user_row.id,
    left(
      coalesce(
        nullif(btrim(user_row.raw_user_meta_data ->> 'full_name'), ''),
        nullif(split_part(coalesce(user_row.email, ''), '@', 1), ''),
        'Usuário'
      ),
      200
    )
  from auth.users user_row
  where user_row.id = current_user_id
  on conflict (id) do nothing;

  insert into public.clinics (name, created_by)
  values (normalized_name, current_user_id)
  returning id into new_clinic_id;

  insert into public.clinic_memberships (
    clinic_id,
    user_id,
    role,
    status
  )
  values (
    new_clinic_id,
    current_user_id,
    'owner',
    'active'
  );

  insert into public.clinic_settings (clinic_id)
  values (new_clinic_id);

  return new_clinic_id;
end
$function$;

drop trigger if exists clinics_set_updated_at on public.clinics;
create trigger clinics_set_updated_at
before update on public.clinics
for each row execute function private.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

drop trigger if exists clinic_memberships_set_updated_at on public.clinic_memberships;
create trigger clinic_memberships_set_updated_at
before update on public.clinic_memberships
for each row execute function private.set_updated_at();

drop trigger if exists patients_prevent_clinic_change on public.patients;
create trigger patients_prevent_clinic_change
before update on public.patients
for each row execute function private.prevent_clinic_id_change();

drop trigger if exists patients_set_actor on public.patients;
create trigger patients_set_actor
before insert or update on public.patients
for each row execute function private.set_clinical_actor();

drop trigger if exists patients_set_updated_at on public.patients;
create trigger patients_set_updated_at
before update on public.patients
for each row execute function private.set_updated_at();

drop trigger if exists patients_create_followups on public.patients;
create trigger patients_create_followups
after insert on public.patients
for each row execute function private.create_patient_followups();

drop trigger if exists patients_sync_followups on public.patients;
create trigger patients_sync_followups
after update of consultation_date, archived_at on public.patients
for each row execute function private.sync_patient_followups();

drop trigger if exists followups_prevent_clinic_change on public.followups;
create trigger followups_prevent_clinic_change
before update on public.followups
for each row execute function private.prevent_clinic_id_change();

drop trigger if exists followups_prevent_identity_change on public.followups;
create trigger followups_prevent_identity_change
before update on public.followups
for each row execute function private.prevent_followup_identity_change();

drop trigger if exists followups_normalize_status on public.followups;
create trigger followups_normalize_status
before insert or update on public.followups
for each row execute function private.normalize_followup_status();

drop trigger if exists followups_set_actor on public.followups;
create trigger followups_set_actor
before insert or update on public.followups
for each row execute function private.set_clinical_actor();

drop trigger if exists followups_set_updated_at on public.followups;
create trigger followups_set_updated_at
before update on public.followups
for each row execute function private.set_updated_at();

drop trigger if exists clinic_settings_set_updated_at on public.clinic_settings;
create trigger clinic_settings_set_updated_at
before update on public.clinic_settings
for each row execute function private.set_updated_at();

drop trigger if exists on_auth_user_created_followup_app on auth.users;
create trigger on_auth_user_created_followup_app
after insert on auth.users
for each row execute function private.handle_new_auth_user();

-- Backfill profiles for Auth users created before this migration.
insert into public.profiles (id, full_name)
select
  auth_user.id,
  left(
    coalesce(
      nullif(btrim(auth_user.raw_user_meta_data ->> 'full_name'), ''),
      nullif(split_part(coalesce(auth_user.email, ''), '@', 1), ''),
      'Usuário'
    ),
    200
  )
from auth.users auth_user
on conflict (id) do nothing;

alter table public.clinics enable row level security;
alter table public.profiles enable row level security;
alter table public.clinic_memberships enable row level security;
alter table public.patients enable row level security;
alter table public.followups enable row level security;
alter table public.clinic_settings enable row level security;

alter table public.clinics force row level security;
alter table public.profiles force row level security;
alter table public.clinic_memberships force row level security;
alter table public.patients force row level security;
alter table public.followups force row level security;
alter table public.clinic_settings force row level security;

drop policy if exists clinics_select_member on public.clinics;
create policy clinics_select_member
on public.clinics
for select
to authenticated
using (
  (select private.is_clinic_member(id))
  or (select private.is_clinic_owner(id))
);

drop policy if exists clinics_update_owner on public.clinics;
create policy clinics_update_owner
on public.clinics
for update
to authenticated
using ((select private.is_clinic_owner(id)))
with check ((select private.is_clinic_owner(id)));

drop policy if exists profiles_select_self_or_coworker on public.profiles;
create policy profiles_select_self_or_coworker
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or (select private.shares_active_clinic(id))
);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists clinic_memberships_select_member on public.clinic_memberships;
create policy clinic_memberships_select_member
on public.clinic_memberships
for select
to authenticated
using ((select private.is_clinic_member(clinic_id)));

drop policy if exists patients_select_member on public.patients;
create policy patients_select_member
on public.patients
for select
to authenticated
using ((select private.is_clinic_member(clinic_id)));

drop policy if exists patients_insert_member on public.patients;
create policy patients_insert_member
on public.patients
for insert
to authenticated
with check ((select private.is_clinic_editor(clinic_id)));

drop policy if exists patients_update_member on public.patients;
create policy patients_update_member
on public.patients
for update
to authenticated
using ((select private.is_clinic_editor(clinic_id)))
with check ((select private.is_clinic_editor(clinic_id)));

drop policy if exists followups_select_member on public.followups;
create policy followups_select_member
on public.followups
for select
to authenticated
using ((select private.is_clinic_member(clinic_id)));

drop policy if exists followups_update_member on public.followups;
create policy followups_update_member
on public.followups
for update
to authenticated
using ((select private.is_clinic_editor(clinic_id)))
with check ((select private.is_clinic_editor(clinic_id)));

drop policy if exists clinic_settings_select_member on public.clinic_settings;
create policy clinic_settings_select_member
on public.clinic_settings
for select
to authenticated
using ((select private.is_clinic_member(clinic_id)));

drop policy if exists clinic_settings_update_owner on public.clinic_settings;
create policy clinic_settings_update_owner
on public.clinic_settings
for update
to authenticated
using ((select private.is_clinic_owner(clinic_id)))
with check ((select private.is_clinic_owner(clinic_id)));

-- No table is available to anonymous callers, and no client role receives
-- DELETE. Patients are archived through archived_at instead.
revoke all on table public.clinics from public, anon, authenticated;
revoke all on table public.profiles from public, anon, authenticated;
revoke all on table public.clinic_memberships from public, anon, authenticated;
revoke all on table public.patients from public, anon, authenticated;
revoke all on table public.followups from public, anon, authenticated;
revoke all on table public.clinic_settings from public, anon, authenticated;

grant select on table public.clinics to authenticated;
grant update (name, timezone, archived_at) on table public.clinics to authenticated;

grant select on table public.profiles to authenticated;
grant update (full_name) on table public.profiles to authenticated;

grant select on table public.clinic_memberships to authenticated;

grant select, insert on table public.patients to authenticated;
grant update (
  name,
  guardian_name,
  birth_date,
  sex,
  phone,
  city,
  neighborhood,
  insurance,
  cid,
  unit,
  consultation_date,
  notes,
  archived_at
) on table public.patients to authenticated;

grant select on table public.followups to authenticated;
grant update (status) on table public.followups to authenticated;

grant select on table public.clinic_settings to authenticated;
grant update (template_d30, template_m90) on table public.clinic_settings to authenticated;

revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.set_clinical_actor() from public, anon, authenticated;
revoke all on function private.prevent_clinic_id_change() from public, anon, authenticated;
revoke all on function private.prevent_followup_identity_change() from public, anon, authenticated;
revoke all on function private.normalize_followup_status() from public, anon, authenticated;
revoke all on function private.create_patient_followups() from public, anon, authenticated;
revoke all on function private.sync_patient_followups() from public, anon, authenticated;
revoke all on function private.handle_new_auth_user() from public, anon, authenticated;
revoke all on function private.is_clinic_member(uuid) from public, anon, authenticated;
revoke all on function private.is_clinic_owner(uuid) from public, anon, authenticated;
revoke all on function private.is_clinic_editor(uuid) from public, anon, authenticated;
revoke all on function private.shares_active_clinic(uuid) from public, anon, authenticated;

grant usage on schema private to authenticated;
grant execute on function private.is_clinic_member(uuid) to authenticated;
grant execute on function private.is_clinic_owner(uuid) to authenticated;
grant execute on function private.is_clinic_editor(uuid) to authenticated;
grant execute on function private.shares_active_clinic(uuid) to authenticated;

revoke all on function public.bootstrap_current_user_clinic(text)
  from public, anon, authenticated;
grant execute on function public.bootstrap_current_user_clinic(text)
  to authenticated;

comment on function public.bootstrap_current_user_clinic(text) is
  'Creates the authenticated user''s first clinic, owner membership, and settings atomically; refuses users with any existing membership.';

comment on column public.followups.opened_at is
  'Timestamp when the prepared WhatsApp action was opened; this is not proof that a message was sent.';

commit;
