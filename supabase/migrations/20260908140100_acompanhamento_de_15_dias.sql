begin;

/**
 * Acompanhamento de 15 dias, parte 2: gerar e manter.
 *
 * As duas funcoes abaixo sao as mesmas de 31/08/2026, com o 15 acrescentado.
 * Toda consulta nova passa a nascer com tres acompanhamentos; mudar a data da
 * consulta move os tres.
 */
create or replace function private.handle_consultation_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  archive_time timestamptz := now();
begin
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
      new.id, new.patient_id, new.clinic_id, 'd15', 'pending',
      new.consultation_date + 15, new.created_by, new.updated_by, new.archived_at
    ),
    (
      new.id, new.patient_id, new.clinic_id, 'd30', 'pending',
      new.consultation_date + 30, new.created_by, new.updated_by, new.archived_at
    ),
    (
      new.id, new.patient_id, new.clinic_id, 'm90', 'pending',
      new.consultation_date + 90, new.created_by, new.updated_by, new.archived_at
    )
  on conflict (consultation_id, followup_key) do nothing;

  if new.archived_at is null then
    update public.patients patient
    set
      consultation_date = new.consultation_date,
      cid = new.cid,
      unit = new.unit
    where patient.id = new.patient_id
      and patient.clinic_id = new.clinic_id
      and patient.archived_at is null
      and row(patient.consultation_date, patient.cid, patient.unit)
        is distinct from row(new.consultation_date, new.cid, new.unit);
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
        when 'd15' then new.consultation_date + 15
        when 'd30' then new.consultation_date + 30
        when 'm90' then new.consultation_date + 90
      end
      where consultation_id = new.id
        and patient_id = new.patient_id
        and clinic_id = new.clinic_id
        and archived_at is null;
    end if;

    if row(new.consultation_date, new.cid, new.unit)
       is distinct from
       row(old.consultation_date, old.cid, old.unit) then
      update public.patients patient
      set
        consultation_date = new.consultation_date,
        cid = new.cid,
        unit = new.unit
      where patient.id = new.patient_id
        and patient.clinic_id = new.clinic_id
        and patient.archived_at is null
        and row(patient.consultation_date, patient.cid, patient.unit)
          is distinct from row(new.consultation_date, new.cid, new.unit);
    end if;
  end if;

  return new;
end
$function$;

-- Consultas ativas que ainda vao chegar aos 15 dias ganham o acompanhamento
-- agora. As que ja passaram desse ponto ficam como estao: criar um contato
-- "atrasado" para uma consulta de dois meses atras so encheria a fila.
insert into public.followups (
  consultation_id, patient_id, clinic_id, followup_key, status, due_date,
  created_by, updated_by, archived_at
)
select
  c.id, c.patient_id, c.clinic_id, 'd15', 'pending', c.consultation_date + 15,
  c.created_by, c.updated_by, null
from public.consultations c
where c.archived_at is null
  and c.consultation_date + 15 >= current_date
  and exists (
    select 1 from public.followups f
    where f.consultation_id = c.id and f.archived_at is null
  )
on conflict (consultation_id, followup_key) do nothing;

commit;
