do $$ begin
  create type public.whatsapp_message_direction as enum ('inbound', 'outbound');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.whatsapp_message_status as enum ('queued', 'accepted', 'sent', 'delivered', 'read', 'failed');
exception when duplicate_object then null;
end $$;

alter table public.patients
  add column if not exists phone_digits text
    generated always as (regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) stored,
  add column if not exists whatsapp_opt_in_at timestamptz,
  add column if not exists whatsapp_opt_out_at timestamptz,
  add column if not exists whatsapp_consent_source text;

alter table public.clinic_settings
  add column if not exists whatsapp_waba_id text,
  add column if not exists whatsapp_phone_number_id text,
  add column if not exists whatsapp_template_name text not null default 'acompanhamento_pos_consulta',
  add column if not exists whatsapp_template_language text not null default 'pt_BR';

alter table public.followups
  add column if not exists whatsapp_sent_at timestamptz,
  add column if not exists whatsapp_delivered_at timestamptz,
  add column if not exists whatsapp_read_at timestamptz,
  add column if not exists whatsapp_failed_at timestamptz,
  add column if not exists whatsapp_failure_reason text;

create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  patient_id uuid,
  wa_id text not null,
  display_phone text not null default '',
  status text not null default 'open' check (status in ('open', 'resolved', 'opted_out')),
  needs_attention boolean not null default false,
  unread_count integer not null default 0 check (unread_count >= 0),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_conversations_patient_clinic_fk
    foreign key (patient_id, clinic_id) references public.patients(id, clinic_id) on delete restrict,
  constraint whatsapp_conversations_clinic_wa_unique unique (clinic_id, wa_id)
);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete restrict,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete restrict,
  patient_id uuid,
  followup_id uuid references public.followups(id) on delete restrict,
  external_message_id text,
  direction public.whatsapp_message_direction not null,
  message_type text not null default 'text',
  body text not null default '',
  template_name text,
  status public.whatsapp_message_status not null default 'queued',
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  constraint whatsapp_messages_patient_clinic_fk
    foreign key (patient_id, clinic_id) references public.patients(id, clinic_id) on delete restrict,
  constraint whatsapp_messages_external_id_unique unique (external_message_id)
);

create table if not exists public.whatsapp_webhook_events (
  id bigint generated always as identity primary key,
  event_key text not null unique,
  event_kind text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

create index if not exists patients_clinic_phone_digits_idx
  on public.patients (clinic_id, phone_digits) where archived_at is null;
create index if not exists whatsapp_conversations_clinic_recent_idx
  on public.whatsapp_conversations (clinic_id, last_message_at desc);
create index if not exists whatsapp_conversations_attention_idx
  on public.whatsapp_conversations (clinic_id, needs_attention, last_message_at desc)
  where needs_attention;
create index if not exists whatsapp_messages_conversation_created_idx
  on public.whatsapp_messages (conversation_id, created_at desc);
create index if not exists whatsapp_messages_followup_idx
  on public.whatsapp_messages (followup_id) where followup_id is not null;

drop trigger if exists whatsapp_conversations_set_updated_at on public.whatsapp_conversations;
create trigger whatsapp_conversations_set_updated_at
before update on public.whatsapp_conversations
for each row execute function private.set_updated_at();

alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.whatsapp_webhook_events enable row level security;
alter table public.whatsapp_conversations force row level security;
alter table public.whatsapp_messages force row level security;
alter table public.whatsapp_webhook_events force row level security;

drop policy if exists whatsapp_conversations_select_member on public.whatsapp_conversations;
create policy whatsapp_conversations_select_member
on public.whatsapp_conversations for select to authenticated
using ((select private.is_clinic_member(clinic_id)));

drop policy if exists whatsapp_conversations_update_editor on public.whatsapp_conversations;
create policy whatsapp_conversations_update_editor
on public.whatsapp_conversations for update to authenticated
using ((select private.is_clinic_editor(clinic_id)))
with check ((select private.is_clinic_editor(clinic_id)));

drop policy if exists whatsapp_messages_select_member on public.whatsapp_messages;
create policy whatsapp_messages_select_member
on public.whatsapp_messages for select to authenticated
using ((select private.is_clinic_member(clinic_id)));

revoke all on table public.whatsapp_conversations from public, anon, authenticated;
revoke all on table public.whatsapp_messages from public, anon, authenticated;
revoke all on table public.whatsapp_webhook_events from public, anon, authenticated;

grant select on table public.whatsapp_conversations to authenticated;
grant update (status, needs_attention, unread_count) on table public.whatsapp_conversations to authenticated;
grant select on table public.whatsapp_messages to authenticated;
grant update (whatsapp_opt_in_at, whatsapp_opt_out_at, whatsapp_consent_source) on table public.patients to authenticated;

-- Conta e numero do WhatsApp da clinica do Dr. Marcello, filtrados pelo id
-- dela. No banco do Dr. Fabio (15/10/2026) esse id nao existe e o update nao
-- acha nada; ficou como no sistema de origem. Os ids do Dr. Fabio entram
-- quando o numero dele estiver na Meta.
update public.clinic_settings
set whatsapp_waba_id = '1095145476282142',
    whatsapp_phone_number_id = '1263379623523237',
    whatsapp_template_name = 'acompanhamento_pos_consulta',
    whatsapp_template_language = 'pt_BR'
where clinic_id = '1ffde840-a905-4300-b4fd-51571fcefdc0';

comment on table public.whatsapp_messages is
  'Operational WhatsApp messages only. Do not store diagnosis, prescriptions, or clinical notes here.';
comment on column public.patients.whatsapp_opt_in_at is
  'Timestamp when the clinic recorded the patient or guardian consent for WhatsApp follow-up.';
