begin;

-- Additive medical-record model. The legacy consultation summary remains on
-- patients so the current frontend keeps working while richer consultations
-- are introduced.

create table public.consultations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  patient_id uuid not null,
  consultation_date date not null,
  encounter_type text not null default 'initial',
  unit text not null default '',
  weight_kg numeric(6, 2),
  height_cm numeric(5, 2),
  chief_complaint text not null default '',
  clinical_history text not null default '',
  personal_history text not null default '',
  family_history text not null default '',
  allergies text not null default '',
  current_medications text not null default '',
  physical_exam text not null default '',
  assessment text not null default '',
  cid text not null default '',
  plan text not null default '',
  prescription text not null default '',
  return_plan text not null default '',
  notes text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint consultations_patient_clinic_fk
    foreign key (patient_id, clinic_id)
    references public.patients (id, clinic_id)
    on delete restrict,
  constraint consultations_identity_unique
    unique (id, patient_id, clinic_id),
  constraint consultations_encounter_type_check
    check (encounter_type in ('initial', 'return', 'telemedicine', 'other')),
  constraint consultations_unit_length
    check (char_length(unit) <= 160),
  constraint consultations_cid_length
    check (char_length(cid) <= 32),
  constraint consultations_weight_positive
    check (weight_kg is null or weight_kg between 0.01 and 500),
  constraint consultations_height_positive
    check (height_cm is null or height_cm between 0.01 and 300)
);

create index consultations_patient_active_date_idx
  on public.consultations (
    patient_id,
    clinic_id,
    consultation_date desc,
    created_at desc
  )
  where archived_at is null;

create index consultations_clinic_active_date_idx
  on public.consultations (clinic_id, consultation_date desc, created_at desc)
  where archived_at is null;

create index consultations_created_by_idx
  on public.consultations (created_by)
  where created_by is not null;

create index consultations_updated_by_idx
  on public.consultations (updated_by)
  where updated_by is not null;

create table private.consultation_audit (
  id bigint generated always as identity primary key,
  consultation_id uuid not null,
  clinic_id uuid not null,
  patient_id uuid not null,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  before_data jsonb not null,
  after_data jsonb not null
);

create index consultation_audit_consultation_changed_idx
  on private.consultation_audit (consultation_id, changed_at desc);

create index consultation_audit_clinic_changed_idx
  on private.consultation_audit (clinic_id, changed_at desc);

create or replace function private.is_clinic_clinician(p_clinic_id uuid)
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
      and membership.role in ('owner', 'clinician')
      and membership.status = 'active'
      and clinic.archived_at is null
      and profile.archived_at is null
  );
$function$;

create or replace function private.prevent_consultation_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.id is distinct from old.id
     or new.patient_id is distinct from old.patient_id
     or new.clinic_id is distinct from old.clinic_id then
    raise exception 'consultation identity cannot be changed'
      using errcode = '22000';
  end if;

  return new;
end
$function$;

create or replace function private.prevent_consultation_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'consultation audit is append-only'
    using errcode = '55000';
end
$function$;

create or replace function private.audit_consultation_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into private.consultation_audit (
    consultation_id,
    clinic_id,
    patient_id,
    changed_by,
    before_data,
    after_data
  )
  values (
    new.id,
    new.clinic_id,
    new.patient_id,
    auth.uid(),
    to_jsonb(old),
    to_jsonb(new)
  );

  return new;
end
$function$;

drop trigger if exists consultations_prevent_identity_change
  on public.consultations;
create trigger consultations_prevent_identity_change
before update on public.consultations
for each row execute function private.prevent_consultation_identity_change();

drop trigger if exists consultations_set_actor on public.consultations;
create trigger consultations_set_actor
before insert or update on public.consultations
for each row execute function private.set_clinical_actor();

drop trigger if exists consultations_set_updated_at on public.consultations;
create trigger consultations_set_updated_at
before update on public.consultations
for each row execute function private.set_updated_at();

drop trigger if exists consultations_audit_update on public.consultations;
create trigger consultations_audit_update
after update on public.consultations
for each row execute function private.audit_consultation_update();

drop trigger if exists consultation_audit_prevent_update_delete
  on private.consultation_audit;
create trigger consultation_audit_prevent_update_delete
before update or delete on private.consultation_audit
for each row execute function private.prevent_consultation_audit_mutation();

drop trigger if exists consultation_audit_prevent_truncate
  on private.consultation_audit;
create trigger consultation_audit_prevent_truncate
before truncate on private.consultation_audit
for each statement execute function private.prevent_consultation_audit_mutation();

-- Every existing patient represents one legacy initial consultation. Preserve
-- original actors and timestamps; auth.uid() is null during this backfill, so
-- the actor trigger leaves these supplied values intact.
insert into public.consultations (
  clinic_id,
  patient_id,
  consultation_date,
  encounter_type,
  unit,
  cid,
  notes,
  created_by,
  updated_by,
  created_at,
  updated_at,
  archived_at
)
select
  patient.clinic_id,
  patient.id,
  patient.consultation_date,
  'initial',
  patient.unit,
  patient.cid,
  patient.notes,
  patient.created_by,
  patient.updated_by,
  patient.created_at,
  patient.updated_at,
  patient.archived_at
from public.patients patient;

alter table public.followups
  add column consultation_id uuid;

-- Linking a technical parent should not make an old follow-up look clinically
-- edited today. Other guards remain active during the backfill.
alter table public.followups
  disable trigger followups_set_updated_at;

update public.followups followup
set consultation_id = consultation.id
from public.consultations consultation
where consultation.patient_id = followup.patient_id
  and consultation.clinic_id = followup.clinic_id
  and consultation.encounter_type = 'initial';

alter table public.followups
  enable trigger followups_set_updated_at;

alter table public.followups
  alter column consultation_id set not null;

alter table public.followups
  drop constraint followups_patient_key_unique;

alter table public.followups
  add constraint followups_consultation_key_unique
    unique (consultation_id, followup_key),
  add constraint followups_consultation_patient_clinic_fk
    foreign key (consultation_id, patient_id, clinic_id)
    references public.consultations (id, patient_id, clinic_id)
    on delete restrict;

create index followups_consultation_clinic_idx
  on public.followups (consultation_id, clinic_id);

create or replace function private.prevent_followup_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.consultation_id is distinct from old.consultation_id
     or new.patient_id is distinct from old.patient_id
     or new.followup_key is distinct from old.followup_key then
    raise exception 'follow-up identity cannot be changed'
      using errcode = '22000';
  end if;

  return new;
end
$function$;

drop trigger if exists patients_create_followups on public.patients;
drop trigger if exists patients_sync_followups on public.patients;

drop function if exists private.create_patient_followups();
drop function if exists private.sync_patient_followups();

create or replace function private.create_patient_initial_consultation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.consultations (
    clinic_id,
    patient_id,
    consultation_date,
    encounter_type,
    unit,
    cid,
    notes,
    created_by,
    updated_by,
    archived_at
  )
  values (
    new.clinic_id,
    new.id,
    new.consultation_date,
    'initial',
    new.unit,
    new.cid,
    new.notes,
    new.created_by,
    new.updated_by,
    new.archived_at
  );

  return new;
end
$function$;

create or replace function private.handle_consultation_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  archive_time timestamptz := now();
begin
  -- Serialize simultaneous encounters for the same patient so only the newest
  -- cycle of active follow-ups remains visible.
  perform 1
  from public.patients patient
  where patient.id = new.patient_id
    and patient.clinic_id = new.clinic_id
  for update;

  if new.archived_at is null then
    update public.followups
    set archived_at = archive_time
    where patient_id = new.patient_id
      and clinic_id = new.clinic_id
      and archived_at is null;
  end if;

  insert into public.followups (
    consultation_id,
    patient_id,
    clinic_id,
    followup_key,
    status,
    due_date,
    created_by,
    updated_by,
    archived_at
  )
  values
    (
      new.id,
      new.patient_id,
      new.clinic_id,
      'd30',
      'pending',
      new.consultation_date + 30,
      new.created_by,
      new.updated_by,
      new.archived_at
    ),
    (
      new.id,
      new.patient_id,
      new.clinic_id,
      'm90',
      'pending',
      new.consultation_date + 90,
      new.created_by,
      new.updated_by,
      new.archived_at
    )
  on conflict (consultation_id, followup_key) do nothing;

  if new.archived_at is null then
    update public.patients patient
    set
      consultation_date = new.consultation_date,
      cid = new.cid,
      unit = new.unit,
      notes = new.notes
    where patient.id = new.patient_id
      and patient.clinic_id = new.clinic_id
      and patient.archived_at is null
      and row(
        patient.consultation_date,
        patient.cid,
        patient.unit,
        patient.notes
      ) is distinct from row(
        new.consultation_date,
        new.cid,
        new.unit,
        new.notes
      );
  end if;

  return new;
end
$function$;

create or replace function private.sync_active_consultation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  is_active boolean;
begin
  if new.archived_at is not null and old.archived_at is null then
    update public.followups
    set archived_at = new.archived_at
    where consultation_id = new.id
      and patient_id = new.patient_id
      and clinic_id = new.clinic_id
      and archived_at is null;
  end if;

  select exists (
    select 1
    from public.followups followup
    where followup.consultation_id = new.id
      and followup.patient_id = new.patient_id
      and followup.clinic_id = new.clinic_id
      and followup.archived_at is null
  )
  into is_active;

  if new.archived_at is null and is_active then
    if new.consultation_date is distinct from old.consultation_date then
      update public.followups
      set due_date = case followup_key
        when 'd30' then new.consultation_date + 30
        when 'm90' then new.consultation_date + 90
      end
      where consultation_id = new.id
        and patient_id = new.patient_id
        and clinic_id = new.clinic_id
        and archived_at is null;
    end if;

    if row(new.consultation_date, new.cid, new.unit, new.notes)
       is distinct from
       row(old.consultation_date, old.cid, old.unit, old.notes) then
      update public.patients patient
      set
        consultation_date = new.consultation_date,
        cid = new.cid,
        unit = new.unit,
        notes = new.notes
      where patient.id = new.patient_id
        and patient.clinic_id = new.clinic_id
        and patient.archived_at is null
        and row(
          patient.consultation_date,
          patient.cid,
          patient.unit,
          patient.notes
        ) is distinct from row(
          new.consultation_date,
          new.cid,
          new.unit,
          new.notes
        );
    end if;
  end if;

  return new;
end
$function$;

create or replace function private.sync_patient_consultations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  current_consultation_id uuid;
begin
  -- A consultation trigger writes the legacy summary back to patients. Do not
  -- mirror that nested write into the consultation a second time.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.archived_at is not null and old.archived_at is null then
    update public.consultations
    set archived_at = new.archived_at
    where patient_id = new.id
      and clinic_id = new.clinic_id
      and archived_at is null;
  elsif new.archived_at is null and old.archived_at is not null then
    update public.consultations
    set archived_at = null
    where patient_id = new.id
      and clinic_id = new.clinic_id
      and archived_at = old.archived_at;

    update public.followups
    set archived_at = null
    where patient_id = new.id
      and clinic_id = new.clinic_id
      and archived_at = old.archived_at;
  end if;

  if new.archived_at is null
     and row(new.consultation_date, new.cid, new.unit, new.notes)
       is distinct from
       row(old.consultation_date, old.cid, old.unit, old.notes) then
    select consultation.id
    into current_consultation_id
    from public.consultations consultation
    where consultation.patient_id = new.id
      and consultation.clinic_id = new.clinic_id
      and consultation.archived_at is null
    order by
      exists (
        select 1
        from public.followups followup
        where followup.consultation_id = consultation.id
          and followup.archived_at is null
      ) desc,
      consultation.consultation_date desc,
      consultation.created_at desc
    limit 1;

    if current_consultation_id is not null then
      update public.consultations
      set
        consultation_date = new.consultation_date,
        cid = new.cid,
        unit = new.unit,
        notes = new.notes
      where id = current_consultation_id
        and row(consultation_date, cid, unit, notes)
          is distinct from
          row(new.consultation_date, new.cid, new.unit, new.notes);
    end if;
  end if;

  return new;
end
$function$;

drop trigger if exists patients_create_initial_consultation
  on public.patients;
create trigger patients_create_initial_consultation
after insert on public.patients
for each row execute function private.create_patient_initial_consultation();

drop trigger if exists patients_sync_consultations on public.patients;
create trigger patients_sync_consultations
after update of consultation_date, cid, unit, notes, archived_at
on public.patients
for each row execute function private.sync_patient_consultations();

drop trigger if exists consultations_handle_insert on public.consultations;
create trigger consultations_handle_insert
after insert on public.consultations
for each row execute function private.handle_consultation_insert();

drop trigger if exists consultations_sync_active on public.consultations;
create trigger consultations_sync_active
after update of consultation_date, cid, unit, notes, archived_at
on public.consultations
for each row execute function private.sync_active_consultation();

drop trigger if exists followups_prevent_identity_change on public.followups;
create trigger followups_prevent_identity_change
before update on public.followups
for each row execute function private.prevent_followup_identity_change();

alter table public.consultations enable row level security;
alter table public.consultations force row level security;

drop policy if exists consultations_select_clinician on public.consultations;
create policy consultations_select_clinician
on public.consultations
for select
to authenticated
using ((select private.is_clinic_clinician(clinic_id)));

drop policy if exists consultations_insert_clinician on public.consultations;
create policy consultations_insert_clinician
on public.consultations
for insert
to authenticated
with check ((select private.is_clinic_clinician(clinic_id)));

drop policy if exists consultations_update_clinician on public.consultations;
create policy consultations_update_clinician
on public.consultations
for update
to authenticated
using ((select private.is_clinic_clinician(clinic_id)))
with check ((select private.is_clinic_clinician(clinic_id)));

-- Data API exposure is explicit. Anonymous callers and client-side DELETE are
-- intentionally excluded; clinical records are retired through archived_at.
revoke all on table public.consultations
  from public, anon, authenticated;
grant select on table public.consultations to authenticated;
grant insert (
  clinic_id,
  patient_id,
  consultation_date,
  encounter_type,
  unit,
  weight_kg,
  height_cm,
  chief_complaint,
  clinical_history,
  personal_history,
  family_history,
  allergies,
  current_medications,
  physical_exam,
  assessment,
  cid,
  plan,
  prescription,
  return_plan,
  notes
) on table public.consultations to authenticated;
grant update (
  consultation_date,
  encounter_type,
  unit,
  weight_kg,
  height_cm,
  chief_complaint,
  clinical_history,
  personal_history,
  family_history,
  allergies,
  current_medications,
  physical_exam,
  assessment,
  cid,
  plan,
  prescription,
  return_plan,
  notes,
  archived_at
) on table public.consultations to authenticated;

revoke all on table private.consultation_audit
  from public, anon, authenticated;
revoke all on sequence private.consultation_audit_id_seq
  from public, anon, authenticated;

revoke all on function private.is_clinic_clinician(uuid)
  from public, anon, authenticated;
revoke all on function private.prevent_consultation_identity_change()
  from public, anon, authenticated;
revoke all on function private.prevent_consultation_audit_mutation()
  from public, anon, authenticated;
revoke all on function private.audit_consultation_update()
  from public, anon, authenticated;
revoke all on function private.prevent_followup_identity_change()
  from public, anon, authenticated;
revoke all on function private.create_patient_initial_consultation()
  from public, anon, authenticated;
revoke all on function private.handle_consultation_insert()
  from public, anon, authenticated;
revoke all on function private.sync_active_consultation()
  from public, anon, authenticated;
revoke all on function private.sync_patient_consultations()
  from public, anon, authenticated;

grant execute on function private.is_clinic_clinician(uuid)
  to authenticated;

comment on table public.consultations is
  'Versioned patient encounters. The latest encounter with active follow-ups is mirrored into legacy patient summary columns.';

comment on table private.consultation_audit is
  'Append-only before/after history for every consultation update; inaccessible through the Data API.';

comment on column public.followups.consultation_id is
  'Consultation that originated this 30-day or 90-day follow-up.';

commit;

