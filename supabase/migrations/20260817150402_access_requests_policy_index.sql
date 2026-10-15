begin;

drop policy access_requests_select_requester on public.access_requests;
drop policy access_requests_select_clinic_owner on public.access_requests;

create policy access_requests_select_authorized
  on public.access_requests
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or (select private.is_clinic_owner(clinic_id))
  );

create index access_requests_reviewed_by_idx
  on public.access_requests (reviewed_by)
  where reviewed_by is not null;

commit;

