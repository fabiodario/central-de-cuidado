begin;

-- The automatic-RLS project option installs this event-trigger function in
-- public. It must continue to run internally, but it does not need to be
-- callable through the Data API.
revoke all on function public.rls_auto_enable()
  from public, anon, authenticated;

-- Cover the composite foreign key used when patients are archived or checked.
create index if not exists followups_patient_clinic_idx
  on public.followups (patient_id, clinic_id);

-- Keep the user-facing defaults explicitly encoded as UTF-8 in migrations.
--
-- Espelho do Dr. Fabio (15/10/2026): os textos sao os do Dr. Fabio, iguais a
-- DEFAULT_TEMPLATES em src/lib/store.ts. No sistema de origem eram os do Dr.
-- Marcello, e o default vale para toda clinica criada depois. Ajustada aqui
-- mesmo porque ainda nao tinha sido aplicada no banco do Dr. Fabio (ver
-- 20260816000100).
alter table public.clinic_settings
  alter column template_d30 set default
    'Olá! Aqui é da equipe do Dr. Fábio Dario, otorrinolaringologista. Já se passaram 30 dias da consulta de {nome}. Como {pronome} está? Está respirando melhor? Se precisar de qualquer auxílio, é só responder por aqui. 💙',
  alter column template_m90 set default
    'Olá! Aqui é da equipe do Dr. Fábio Dario. Já se passaram 3 meses da consulta de {nome} e gostaríamos de saber como {pronome} está. Está tudo bem? Qualquer necessidade, estamos à disposição. 💙';

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

revoke all on function private.handle_new_auth_user()
  from public, anon, authenticated;

revoke all on function public.bootstrap_current_user_clinic(text)
  from public, anon, authenticated;
grant execute on function public.bootstrap_current_user_clinic(text)
  to authenticated;

commit;
