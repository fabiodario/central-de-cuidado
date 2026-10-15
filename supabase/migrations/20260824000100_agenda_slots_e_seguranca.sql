-- Motor de horarios livres + RLS e privilegios do modulo de agenda.

-- ---------------------------------------------------------------
-- Horarios livres de uma unidade
--
-- Combina as regras semanais, as excecoes e as consultas ja marcadas para
-- devolver so o que o paciente pode realmente escolher. Fica no banco, e nao
-- na Edge Function, porque a mesma resposta precisa servir para a tela da
-- equipe e para o WhatsApp - duas implementacoes divergiriam com o tempo.
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

  select coalesce(settings.schedule_slot_minutes, 30),
         coalesce(settings.schedule_horizon_days, 15),
         coalesce(settings.schedule_min_notice_hours, 2)
    into v_slot_minutes, v_horizon_days, v_notice_hours
  from public.clinic_settings settings
  where settings.clinic_id = v_clinic_id;

  v_slot_minutes := coalesce(v_slot_minutes, 30);
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
    and not exists (
      select 1
      from public.appointments a
      where a.unit_id = p_unit_id
        and a.status <> 'cancelled'
        and a.starts_at = c.inicio
    )
  order by c.inicio;
end;
$fn$;

comment on function public.available_slots(uuid) is
  'Horarios livres de uma unidade, ja considerando regras semanais, excecoes, consultas marcadas e antecedencia minima.';

-- ---------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------

alter table public.clinic_units enable row level security;
alter table public.availability_rules enable row level security;
alter table public.schedule_exceptions enable row level security;
alter table public.appointments enable row level security;

alter table public.clinic_units force row level security;
alter table public.availability_rules force row level security;
alter table public.schedule_exceptions force row level security;
alter table public.appointments force row level security;

-- Ler: qualquer membro ativo da clinica.
drop policy if exists clinic_units_select_member on public.clinic_units;
create policy clinic_units_select_member on public.clinic_units
for select to authenticated using ((select private.is_clinic_member(clinic_id)));

drop policy if exists availability_rules_select_member on public.availability_rules;
create policy availability_rules_select_member on public.availability_rules
for select to authenticated using ((select private.is_clinic_member(clinic_id)));

drop policy if exists schedule_exceptions_select_member on public.schedule_exceptions;
create policy schedule_exceptions_select_member on public.schedule_exceptions
for select to authenticated using ((select private.is_clinic_member(clinic_id)));

drop policy if exists appointments_select_member on public.appointments;
create policy appointments_select_member on public.appointments
for select to authenticated using ((select private.is_clinic_member(clinic_id)));

-- Escrever: so quem tem perfil de edicao. Configurar agenda e marcar consulta
-- nao sao acoes para o perfil somente-visualizacao.
drop policy if exists clinic_units_write_editor on public.clinic_units;
create policy clinic_units_write_editor on public.clinic_units
for all to authenticated
using ((select private.is_clinic_editor(clinic_id)))
with check ((select private.is_clinic_editor(clinic_id)));

drop policy if exists availability_rules_write_editor on public.availability_rules;
create policy availability_rules_write_editor on public.availability_rules
for all to authenticated
using ((select private.is_clinic_editor(clinic_id)))
with check ((select private.is_clinic_editor(clinic_id)));

drop policy if exists schedule_exceptions_write_editor on public.schedule_exceptions;
create policy schedule_exceptions_write_editor on public.schedule_exceptions
for all to authenticated
using ((select private.is_clinic_editor(clinic_id)))
with check ((select private.is_clinic_editor(clinic_id)));

drop policy if exists appointments_write_editor on public.appointments;
create policy appointments_write_editor on public.appointments
for all to authenticated
using ((select private.is_clinic_editor(clinic_id)))
with check ((select private.is_clinic_editor(clinic_id)));

-- ---------------------------------------------------------------
-- Privilegios
--
-- RLS nao substitui privilegio de tabela: foi exatamente essa confusao que
-- fez o envio pelo WhatsApp falhar com "Acompanhamento nao encontrado".
-- ---------------------------------------------------------------

revoke all on table public.clinic_units from public, anon, authenticated;
revoke all on table public.availability_rules from public, anon, authenticated;
revoke all on table public.schedule_exceptions from public, anon, authenticated;
revoke all on table public.appointments from public, anon, authenticated;

grant select, insert, update, delete on table public.clinic_units to authenticated;
grant select, insert, update, delete on table public.availability_rules to authenticated;
grant select, insert, update, delete on table public.schedule_exceptions to authenticated;
grant select, insert, update on table public.appointments to authenticated;

grant update (schedule_slot_minutes, schedule_horizon_days, schedule_min_notice_hours)
  on table public.clinic_settings to authenticated;

-- O agendamento pelo WhatsApp roda na Edge Function, sem usuario logado.
grant select on table public.clinic_units to service_role;
grant select on table public.availability_rules to service_role;
grant select on table public.schedule_exceptions to service_role;
grant select, insert, update on table public.appointments to service_role;

grant execute on function public.available_slots(uuid) to authenticated, service_role;
