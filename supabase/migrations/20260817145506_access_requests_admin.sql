begin;

create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  requested_name text not null default '' check (char_length(requested_name) <= 200),
  requested_email text not null default '' check (char_length(requested_email) <= 320),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null
);

create index access_requests_clinic_status_requested_at_idx
  on public.access_requests (clinic_id, status, requested_at asc);

alter table public.access_requests enable row level security;
alter table public.access_requests force row level security;

revoke all on table public.access_requests from public, anon;
grant select on table public.access_requests to authenticated;

create policy access_requests_select_requester
  on public.access_requests
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy access_requests_select_clinic_owner
  on public.access_requests
  for select
  to authenticated
  using ((select private.is_clinic_owner(clinic_id)));

-- New accounts receive only a pending request. The request is not a membership
-- and cannot grant access until an existing clinic owner approves it.
create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_clinic_id uuid;
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), '')
  )
  on conflict (id) do update
    set full_name = excluded.full_name;

  select clinics.id
    into default_clinic_id
  from public.clinics
  where clinics.archived_at is null
  order by clinics.created_at asc
  limit 1;

  if default_clinic_id is not null then
    insert into public.access_requests (
      clinic_id,
      user_id,
      requested_name,
      requested_email
    )
    values (
      default_clinic_id,
      new.id,
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), ''),
      coalesce(new.email, '')
    )
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

create or replace function public.approve_access_request(
  request_id uuid,
  assigned_role public.clinic_role default 'staff'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  request_row public.access_requests%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  if assigned_role not in ('clinician'::public.clinic_role, 'staff'::public.clinic_role, 'viewer'::public.clinic_role) then
    raise exception 'The owner role cannot be assigned from an access request.' using errcode = '22023';
  end if;

  select *
    into request_row
  from public.access_requests
  where id = request_id
  for update;

  if not found then
    raise exception 'Access request not found.' using errcode = 'P0002';
  end if;

  if request_row.status <> 'pending' then
    raise exception 'This access request has already been reviewed.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.clinic_memberships memberships
    where memberships.clinic_id = request_row.clinic_id
      and memberships.user_id = current_user_id
      and memberships.role = 'owner'::public.clinic_role
      and memberships.status = 'active'::public.membership_status
  ) then
    raise exception 'Only an active clinic owner can approve access.' using errcode = '42501';
  end if;

  insert into public.clinic_memberships (clinic_id, user_id, role, status)
  values (request_row.clinic_id, request_row.user_id, assigned_role, 'active'::public.membership_status)
  on conflict (clinic_id, user_id) do update
    set role = excluded.role,
        status = 'active'::public.membership_status,
        updated_at = now();

  update public.access_requests
  set status = 'approved',
      reviewed_at = now(),
      reviewed_by = current_user_id
  where id = request_row.id;
end;
$$;

create or replace function public.reject_access_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  request_row public.access_requests%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '42501';
  end if;

  select *
    into request_row
  from public.access_requests
  where id = request_id
  for update;

  if not found then
    raise exception 'Access request not found.' using errcode = 'P0002';
  end if;

  if request_row.status <> 'pending' then
    raise exception 'This access request has already been reviewed.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1
    from public.clinic_memberships memberships
    where memberships.clinic_id = request_row.clinic_id
      and memberships.user_id = current_user_id
      and memberships.role = 'owner'::public.clinic_role
      and memberships.status = 'active'::public.membership_status
  ) then
    raise exception 'Only an active clinic owner can reject access.' using errcode = '42501';
  end if;

  update public.access_requests
  set status = 'rejected',
      reviewed_at = now(),
      reviewed_by = current_user_id
  where id = request_row.id;
end;
$$;

revoke all on function public.approve_access_request(uuid, public.clinic_role) from public, anon;
revoke all on function public.reject_access_request(uuid) from public, anon;
grant execute on function public.approve_access_request(uuid, public.clinic_role) to authenticated;
grant execute on function public.reject_access_request(uuid) to authenticated;

-- The initial clinic is already set up. New accounts must go through approval.
revoke execute on function public.bootstrap_current_user_clinic(text) from authenticated;

commit;

