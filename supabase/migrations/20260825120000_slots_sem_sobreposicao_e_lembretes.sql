-- Duas correcoes na agenda:
--
-- 1) O motor de horarios so bloqueava o slot que comecava no MESMO minuto de
--    uma consulta existente. Bastava mudar a duracao padrao para o sistema
--    passar a oferecer horarios que caem em cima de consulta ja marcada.
--
-- 2) Lembrete automatico de consulta: uma mensagem X dias antes, pedindo que o
--    paciente confirme ou peca para reagendar. Padrao de 1 dia, configuravel.

-- ---------------------------------------------------------------
-- 1. Preferencias
-- ---------------------------------------------------------------

-- 40 minutos e o padrao de atendimento da clinica. Vale so para clinicas novas;
-- as existentes continuam com o que ja esta salvo.
alter table public.clinic_settings
  alter column schedule_slot_minutes set default 40;

alter table public.clinic_settings
  add column if not exists appointment_reminder_enabled boolean not null default true,
  add column if not exists appointment_reminder_days integer not null default 1,
  add column if not exists whatsapp_reminder_template_name text not null default 'lembrete_consulta';

alter table public.clinic_settings
  drop constraint if exists clinic_settings_reminder_days_valid;
alter table public.clinic_settings
  add constraint clinic_settings_reminder_days_valid
  check (appointment_reminder_days between 0 and 30);

comment on column public.clinic_settings.appointment_reminder_enabled is
  'Liga ou desliga o lembrete automatico de consulta.';
comment on column public.clinic_settings.appointment_reminder_days is
  'Quantos dias antes da consulta o lembrete e enviado. 1 = vespera, 0 = no proprio dia.';
comment on column public.clinic_settings.whatsapp_reminder_template_name is
  'Template aprovado na Meta usado no lembrete de consulta.';

-- O update em clinic_settings e liberado coluna a coluna. Sem este grant a
-- tela salva sem erro visivel e nada muda.
grant update (
  appointment_reminder_enabled,
  appointment_reminder_days,
  whatsapp_reminder_template_name
) on table public.clinic_settings to authenticated;

-- ---------------------------------------------------------------
-- 2. Estado do lembrete em cada consulta marcada
-- ---------------------------------------------------------------

alter table public.appointments
  add column if not exists reminder_sent_at timestamptz,
  add column if not exists reminder_failed_at timestamptz,
  add column if not exists reminder_failure_reason text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists reschedule_requested_at timestamptz;

comment on column public.appointments.confirmed_at is
  'Preenchido quando o paciente responde confirmando a presenca.';
comment on column public.appointments.reschedule_requested_at is
  'Preenchido quando o paciente pede para remarcar; a equipe ve isso na agenda.';

-- Quem ainda nao recebeu lembrete, por data. E a busca que o disparo faz todo dia.
create index if not exists appointments_reminder_pendente_idx
  on public.appointments (starts_at)
  where status = 'scheduled' and reminder_sent_at is null;

-- Liga a mensagem enviada a consulta, do mesmo jeito que followup_id ja fazia.
-- Sem isso o webhook nao sabe a qual consulta um "CONFIRMAR" se refere.
alter table public.whatsapp_messages
  add column if not exists appointment_id uuid references public.appointments (id) on delete restrict;

create index if not exists whatsapp_messages_appointment_idx
  on public.whatsapp_messages (appointment_id) where appointment_id is not null;

-- ---------------------------------------------------------------
-- 3. Motor de horarios: comparar o intervalo inteiro
-- ---------------------------------------------------------------

create or replace function public.available_slots(p_unit_id uuid)
returns table (slot_start timestamptz, slot_end timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_clinic_id uuid;
  v_tz text;
  v_slot_minutes integer;
  v_horizon_days integer;
  v_notice_hours integer;
  v_primeiro_dia date;
  v_ultimo_dia date;
begin
  select unit.clinic_id, coalesce(clinic.timezone, 'America/Sao_Paulo')
    into v_clinic_id, v_tz
  from public.clinic_units unit
  join public.clinics clinic on clinic.id = unit.clinic_id
  where unit.id = p_unit_id and unit.archived_at is null;

  if v_clinic_id is null then
    return;
  end if;

  select coalesce(settings.schedule_slot_minutes, 40),
         coalesce(settings.schedule_horizon_days, 15),
         coalesce(settings.schedule_min_notice_hours, 2)
    into v_slot_minutes, v_horizon_days, v_notice_hours
  from public.clinic_settings settings
  where settings.clinic_id = v_clinic_id;

  v_slot_minutes := coalesce(v_slot_minutes, 40);
  v_horizon_days := coalesce(v_horizon_days, 15);
  v_notice_hours := coalesce(v_notice_hours, 2);

  -- O "hoje" precisa ser o da clinica, nao o do servidor em UTC. Perto da
  -- meia-noite os dois divergem e a agenda mostraria o dia errado.
  v_primeiro_dia := (now() at time zone v_tz)::date;
  v_ultimo_dia := v_primeiro_dia + v_horizon_days;

  return query
  with dias as (
    select generate_series(v_primeiro_dia, v_ultimo_dia, interval '1 day')::date as dia
  ),
  -- Excecao que fecha o dia elimina qualquer atendimento nele.
  fechados as (
    select d.dia
    from dias d
    join public.schedule_exceptions e
      on e.exception_date = d.dia
     and e.clinic_id = v_clinic_id
     and e.is_closed
     and (e.unit_id is null or e.unit_id = p_unit_id)
  ),
  -- Periodos validos: a regra semanal, ou o horario extra de uma excecao.
  periodos as (
    select d.dia, r.starts_at, r.ends_at
    from dias d
    join public.availability_rules r
      on r.unit_id = p_unit_id
     and r.weekday = extract(dow from d.dia)::smallint
    where d.dia not in (select dia from fechados)
    union all
    select d.dia, e.starts_at, e.ends_at
    from dias d
    join public.schedule_exceptions e
      on e.exception_date = d.dia
     and e.clinic_id = v_clinic_id
     and not e.is_closed
     and (e.unit_id is null or e.unit_id = p_unit_id)
  ),
  blocos as (
    select
      ((p.dia + p.starts_at) at time zone v_tz) as inicio_local,
      ((p.dia + p.ends_at) at time zone v_tz) as fim_local
    from periodos p
  ),
  candidatos as (
    select
      gs as inicio,
      gs + make_interval(mins => v_slot_minutes) as fim
    from blocos b,
    lateral generate_series(
      b.inicio_local,
      b.fim_local - make_interval(mins => v_slot_minutes),
      make_interval(mins => v_slot_minutes)
    ) as gs
  )
  select distinct c.inicio, c.fim
  from candidatos c
  where c.inicio >= now() + make_interval(hours => v_notice_hours)
    -- Sobreposicao de intervalos, e nao igualdade de inicio. Comparar so o
    -- inicio deixava passar horario que cai dentro de uma consulta ja marcada
    -- sempre que a duracao padrao mudava depois do agendamento.
    and not exists (
      select 1
      from public.appointments a
      where a.unit_id = p_unit_id
        and a.status <> 'cancelled'
        and a.starts_at < c.fim
        and a.ends_at > c.inicio
    )
  order by c.inicio;
end;
$fn$;

comment on function public.available_slots(uuid) is
  'Horarios livres de uma unidade, ja considerando regras semanais, excecoes, sobreposicao com consultas marcadas e antecedencia minima.';

grant execute on function public.available_slots(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------
-- 4. Disparo diario dos lembretes
--
-- No espelho do Dr. Fabio (15/10/2026) a URL sai de private.url_da_funcao
-- (project_url no Vault, ver 20260823210000), e nao mais escrita aqui: era a
-- do projeto Supabase do Dr. Marcello.
-- ---------------------------------------------------------------

create or replace function private.dispatch_appointment_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  secret text;
begin
  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'cron_secret'
  limit 1;

  if secret is null then
    raise warning 'cron_secret ausente no Vault; lembretes ignorados';
    return;
  end if;

  perform net.http_post(
    url := private.url_da_funcao('appointment-reminders'),
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', secret
    ),
    timeout_milliseconds := 120000
  );
end;
$$;

revoke all on function private.dispatch_appointment_reminders() from public, anon, authenticated;

-- 13:00 UTC = 10:00 em Brasilia. Uma hora depois do disparo de acompanhamentos,
-- para os dois nao competirem pela mesma janela de execucao.
select cron.unschedule('lembretes-consulta-diario')
where exists (
  select 1 from cron.job where jobname = 'lembretes-consulta-diario'
);

select cron.schedule(
  'lembretes-consulta-diario',
  '0 13 * * *',
  $$select private.dispatch_appointment_reminders()$$
);
