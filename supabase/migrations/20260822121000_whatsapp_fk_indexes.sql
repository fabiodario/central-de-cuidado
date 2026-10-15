create index if not exists whatsapp_conversations_patient_clinic_idx
  on public.whatsapp_conversations (patient_id, clinic_id)
  where patient_id is not null;

create index if not exists whatsapp_messages_clinic_idx
  on public.whatsapp_messages (clinic_id);

create index if not exists whatsapp_messages_patient_clinic_idx
  on public.whatsapp_messages (patient_id, clinic_id)
  where patient_id is not null;
