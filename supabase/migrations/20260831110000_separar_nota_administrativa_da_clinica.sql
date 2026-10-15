-- A nota da recepcao e a observacao clinica deixam de ser a mesma frase.
--
-- Ate aqui `patients.notes` e `consultations.notes` eram espelhadas nos dois
-- sentidos por gatilho, junto com data, CID e unidade. Na tela isso aparecia
-- como dois campos com nomes diferentes - "Nota administrativa" no cadastro e
-- "Observacoes" no prontuario - que na verdade eram um so.
--
-- O efeito e silencioso e ruim: a secretaria escreve "prefere contato a tarde",
-- o medico abre a consulta, escreve a observacao clinica dele por cima, e o
-- recado da recepcao some. Ou o contrario. Ninguem ve o apagamento acontecer,
-- porque cada um estava olhando para o proprio campo.
--
-- Data, CID e unidade continuam espelhados: ali o espelho e correto de
-- proposito, porque a ficha do paciente resume mesmo a ultima consulta. So
-- `notes` sai, porque so ela guarda dois assuntos diferentes.
--
-- Os textos que ja existem ficam onde estao. Como as duas colunas sao hoje
-- identicas, nada se perde: a partir de agora elas simplesmente divergem, cada
-- uma seguindo quem a escreve.

begin;

-- 1. Paciente novo nao leva mais a nota administrativa para dentro da primeira
--    consulta. "Prefere contato a tarde" nao e observacao clinica.
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
    new.created_by,
    new.updated_by,
    new.archived_at
  );

  return new;
end
$function$;

-- 2. Consulta nova atualiza a ficha do paciente com data, CID e unidade - e nao
--    mais com a observacao clinica.
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

-- 3. Editar a consulta nao reescreve mais a nota da recepcao.
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

-- 4. Editar o cadastro nao reescreve mais a observacao clinica da consulta.
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
     and row(new.consultation_date, new.cid, new.unit)
       is distinct from
       row(old.consultation_date, old.cid, old.unit) then
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
        unit = new.unit
      where id = current_consultation_id
        and row(consultation_date, cid, unit)
          is distinct from
          row(new.consultation_date, new.cid, new.unit);
    end if;
  end if;

  return new;
end
$function$;

-- 5. Os gatilhos deixam de acordar quando so `notes` muda. Sem isto a funcao
--    nova rodaria a toa a cada observacao clinica escrita.
drop trigger if exists patients_sync_consultations on public.patients;
create trigger patients_sync_consultations
after update of consultation_date, cid, unit, archived_at
on public.patients
for each row execute function private.sync_patient_consultations();

drop trigger if exists consultations_sync_active on public.consultations;
create trigger consultations_sync_active
after update of consultation_date, cid, unit, archived_at
on public.consultations
for each row execute function private.sync_active_consultation();

comment on column public.patients.notes is
  'Nota administrativa da recepcao sobre a pessoa: preferencia de contato, convenio, aviso de agenda. Nao e observacao clinica e nao vai para a consulta.';
comment on column public.consultations.notes is
  'Observacao clinica daquele atendimento. Vive na consulta e nao volta para a ficha do paciente.';

commit;
