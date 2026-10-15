create index if not exists followups_consultation_patient_clinic_idx
  on public.followups (consultation_id, patient_id, clinic_id);

