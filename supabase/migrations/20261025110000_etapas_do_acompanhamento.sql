begin;

-- Vindo do sistema do Dr. Marcello (20261019180000, de 19/10/2026), trazido
-- em 25/10/2026 com data nova: a publicacao so aplica migration posterior a
-- ultima que ja esta no banco. O padrao continua com as tres etapas: nada muda
-- no Dr. Fabio ate alguem escolher em Preferencias.

/**
 * Quais etapas do acompanhamento a clinica usa (19/10/2026).
 *
 * O Dr. Marcello pediu que a familia receba o acompanhamento so em 30 e 90
 * dias, sem o de 15; o Edu pediu que a escolha fique em Preferencias, para
 * mudar quando quiserem. Ate aqui toda consulta nascia com as tres etapas
 * (ver 20260908140100_acompanhamento_de_15_dias).
 *
 * followup_etapas guarda as etapas ligadas. O padrao e as tres, para nada
 * mudar ate alguem escolher. Pelo menos uma: desligar o acompanhamento
 * inteiro e outra decisao, que nao cabe num clique sem querer.
 */
alter table public.clinic_settings
  add column if not exists followup_etapas text[] not null default array['d15', 'd30', 'm90'];

alter table public.clinic_settings
  drop constraint if exists clinic_settings_followup_etapas_check;
alter table public.clinic_settings
  add constraint clinic_settings_followup_etapas_check
  check (followup_etapas <@ array['d15', 'd30', 'm90'] and cardinality(followup_etapas) >= 1);

comment on column public.clinic_settings.followup_etapas is
  'Etapas do acompanhamento que a clinica usa (d15, d30, m90). Consulta nova so gera estas; desligar uma tira da fila os envios pendentes dela.';

grant update (followup_etapas) on table public.clinic_settings to authenticated;

/** As etapas ligadas de uma clinica; sem linha de ajustes, as tres. */
create or replace function private.etapas_do_acompanhamento(p_clinic uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    (select s.followup_etapas from public.clinic_settings s where s.clinic_id = p_clinic),
    array['d15', 'd30', 'm90']
  )
$function$;

/**
 * Consulta nova: a mesma funcao de 08/09/2026, gerando so as etapas ligadas.
 */
create or replace function private.handle_consultation_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  archive_time timestamptz := now();
  etapas text[] := private.etapas_do_acompanhamento(new.clinic_id);
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
  select
    new.id, new.patient_id, new.clinic_id, etapa.chave::public.followup_key, 'pending',
    new.consultation_date + etapa.dias, new.created_by, new.updated_by, new.archived_at
  from (values ('d15', 15), ('d30', 30), ('m90', 90)) as etapa (chave, dias)
  where etapa.chave = any (etapas)
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

/**
 * Mudou a escolha em Preferencias:
 *
 *  - etapa desligada: o envio pendente dela sai da fila (arquivado), mesmo o
 *    atrasado - o "15 dias" que ainda nao saiu nao deve sair mais. O que ja foi
 *    enviado ou concluido fica como esta: e historia.
 *  - etapa ligada: volta para as consultas ativas cuja data ainda vai chegar.
 *    Quem ja passou do ponto nao ganha um contato atrasado (mesma regra de
 *    08/09/2026).
 */
create or replace function private.aplicar_etapas_do_acompanhamento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.followup_etapas is not distinct from old.followup_etapas then
    return new;
  end if;

  update public.followups f
  set archived_at = now()
  where f.clinic_id = new.clinic_id
    and f.archived_at is null
    and f.status = 'pending'
    and f.whatsapp_sent_at is null
    and not (f.followup_key::text = any (new.followup_etapas));

  insert into public.followups as atual (
    consultation_id, patient_id, clinic_id, followup_key, status, due_date,
    created_by, updated_by, archived_at
  )
  select
    c.id, c.patient_id, c.clinic_id, etapa.chave::public.followup_key, 'pending',
    c.consultation_date + etapa.dias, c.created_by, c.updated_by, null
  from public.consultations c
  cross join (values ('d15', 15), ('d30', 30), ('m90', 90)) as etapa (chave, dias)
  where c.clinic_id = new.clinic_id
    and c.archived_at is null
    and etapa.chave = any (new.followup_etapas)
    and not (etapa.chave = any (old.followup_etapas))
    and c.consultation_date + etapa.dias >= current_date
    and exists (
      select 1 from public.followups f
      where f.consultation_id = c.id and f.archived_at is null
    )
  on conflict (consultation_id, followup_key) do update
    set archived_at = null
    where atual.archived_at is not null
      and atual.status = 'pending'
      and atual.whatsapp_sent_at is null;

  return new;
end
$function$;

drop trigger if exists aplicar_etapas_do_acompanhamento on public.clinic_settings;
create trigger aplicar_etapas_do_acompanhamento
after update of followup_etapas on public.clinic_settings
for each row execute function private.aplicar_etapas_do_acompanhamento();

commit;
