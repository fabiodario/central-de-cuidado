begin;

/**
 * Rascunho do atendimento, salvo enquanto o medico escreve (25/09/2026).
 *
 * Ate aqui o texto so existia na tela ate alguem clicar em Salvar. Fechar a
 * aba sem querer, a queda de energia, o computador que reinicia para
 * atualizar, ou a propria saida automatica por inatividade (60 minutos) -
 * qualquer um deles levava a consulta inteira.
 *
 * Por que no banco, e nao no navegador: o prontuario e dado de saude, e o
 * navegador do consultorio e compartilhado. Guardar ali deixaria o texto de
 * um paciente num computador depois de o medico sair do sistema. Aqui ele
 * fica sob a mesma regra das consultas (so quem atende) e, alem disso, so o
 * autor enxerga o proprio rascunho.
 *
 * Um rascunho por pessoa, por paciente, por alvo: "nova" para consulta ainda
 * nao salva, ou o id da consulta que esta sendo editada. Sai quando a consulta
 * e salva ou quando o medico descarta.
 */

create table if not exists public.consultation_drafts (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  patient_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  alvo text not null,
  conteudo jsonb not null,
  updated_at timestamptz not null default now(),
  constraint consultation_drafts_patient_fk
    foreign key (patient_id, clinic_id)
    references public.patients (id, clinic_id)
    on delete cascade,
  constraint consultation_drafts_alvo_check
    check (alvo = 'nova' or alvo ~ '^[0-9a-f-]{36}$'),
  -- Um formulario inteiro cabe folgado; o teto so impede abuso.
  constraint consultation_drafts_tamanho
    check (pg_column_size(conteudo) < 1000000),
  constraint consultation_drafts_unico
    unique (user_id, patient_id, alvo)
);

create index if not exists consultation_drafts_clinic_idx
  on public.consultation_drafts (clinic_id);

alter table public.consultation_drafts enable row level security;
alter table public.consultation_drafts force row level security;

drop policy if exists "autor le o proprio rascunho" on public.consultation_drafts;
create policy "autor le o proprio rascunho"
  on public.consultation_drafts for select
  to authenticated
  using (user_id = (select auth.uid()) and (select private.is_clinic_clinician(clinic_id)));

drop policy if exists "autor grava o proprio rascunho" on public.consultation_drafts;
create policy "autor grava o proprio rascunho"
  on public.consultation_drafts for insert
  to authenticated
  with check (user_id = (select auth.uid()) and (select private.is_clinic_clinician(clinic_id)));

drop policy if exists "autor atualiza o proprio rascunho" on public.consultation_drafts;
create policy "autor atualiza o proprio rascunho"
  on public.consultation_drafts for update
  to authenticated
  using (user_id = (select auth.uid()) and (select private.is_clinic_clinician(clinic_id)))
  with check (user_id = (select auth.uid()) and (select private.is_clinic_clinician(clinic_id)));

drop policy if exists "autor apaga o proprio rascunho" on public.consultation_drafts;
create policy "autor apaga o proprio rascunho"
  on public.consultation_drafts for delete
  to authenticated
  using (user_id = (select auth.uid()) and (select private.is_clinic_clinician(clinic_id)));

grant select, insert, update, delete on public.consultation_drafts to authenticated;

commit;
