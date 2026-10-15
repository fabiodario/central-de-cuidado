create table if not exists public.whatsapp_webhook_events (
  id bigint generated always as identity primary key,
  event_key text not null unique,
  event_kind text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

alter table public.whatsapp_webhook_events enable row level security;
alter table public.whatsapp_webhook_events force row level security;
revoke all on table public.whatsapp_webhook_events from public, anon, authenticated;

drop policy if exists whatsapp_webhook_events_deny_clients on public.whatsapp_webhook_events;
create policy whatsapp_webhook_events_deny_clients
on public.whatsapp_webhook_events for all to public
using (false)
with check (false);

-- The earlier private table is intentionally retained. Keeping it is harmless
-- and avoids destructive data changes during a production migration.
