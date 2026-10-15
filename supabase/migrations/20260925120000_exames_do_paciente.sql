begin;

/**
 * Exames anexados ao prontuario (25/09/2026).
 *
 * Os exames chegavam por WhatsApp, e-mail ou em papel, e ficavam no celular de
 * alguem ou numa pasta do computador. Na consulta, o medico perguntava "trouxe
 * o exame?" e dependia da familia. Aqui eles passam a morar no prontuario do
 * paciente: PDF ou foto, com a data do exame e um titulo.
 *
 * Mesma regra das consultas: so quem atende ve e anexa. O arquivo fica num
 * acervo privado, com a pasta pelo id da clinica (como o dos assinados), e o
 * link para abrir vale poucos minutos.
 *
 * Remover e esconder, nao apagar: exame que ja embasou uma conduta faz parte
 * do prontuario, e um clique errado nao pode leva-lo. A linha ganha a data e
 * o autor da remocao, e o arquivo continua no acervo.
 */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'exames',
  'exames',
  false,
  20971520,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

create table if not exists public.patient_exams (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  patient_id uuid not null,
  titulo text not null,
  data_exame date,
  caminho text not null unique,
  mime text not null default '',
  tamanho integer not null default 0,
  enviado_por uuid references auth.users (id) on delete set null,
  enviado_em timestamptz not null default now(),
  removido_em timestamptz,
  removido_por uuid references auth.users (id) on delete set null,
  constraint patient_exams_patient_fk
    foreign key (patient_id, clinic_id)
    references public.patients (id, clinic_id)
    on delete restrict,
  constraint patient_exams_titulo check (char_length(btrim(titulo)) between 1 and 200),
  -- O caminho comeca pela clinica e pelo paciente da propria linha: sem isto,
  -- daria para registrar um exame apontando para o arquivo de outro paciente.
  constraint patient_exams_caminho check (
    caminho like (clinic_id::text || '/' || patient_id::text || '/%')
  )
);

create index if not exists patient_exams_paciente_idx
  on public.patient_exams (clinic_id, patient_id, data_exame desc);

/** Autor e hora vem do banco; e a unica mudanca aceita depois e a remocao. */
create or replace function private.preparar_exame()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    new.enviado_por := auth.uid();
    new.enviado_em := now();
    new.removido_em := null;
    new.removido_por := null;
    new.titulo := btrim(new.titulo);
    return new;
  end if;

  if new.id is distinct from old.id
     or new.clinic_id is distinct from old.clinic_id
     or new.patient_id is distinct from old.patient_id
     or new.caminho is distinct from old.caminho
     or new.mime is distinct from old.mime
     or new.tamanho is distinct from old.tamanho
     or new.enviado_por is distinct from old.enviado_por
     or new.enviado_em is distinct from old.enviado_em then
    raise exception 'O arquivo de um exame nao muda: anexe um novo.'
      using errcode = 'P0001';
  end if;

  if old.removido_em is not null and new.removido_em is null then
    raise exception 'Exame removido nao volta pela tela.' using errcode = 'P0001';
  end if;

  if new.removido_em is not null and old.removido_em is null then
    new.removido_em := now();
    new.removido_por := auth.uid();
  end if;

  return new;
end
$function$;

drop trigger if exists patient_exams_preparar on public.patient_exams;
create trigger patient_exams_preparar
before insert or update on public.patient_exams
for each row execute function private.preparar_exame();

revoke all on function private.preparar_exame() from public, anon, authenticated;

alter table public.patient_exams enable row level security;
alter table public.patient_exams force row level security;

drop policy if exists "quem atende ve os exames" on public.patient_exams;
create policy "quem atende ve os exames"
  on public.patient_exams for select
  to authenticated
  using ((select private.is_clinic_clinician(clinic_id)));

drop policy if exists "quem atende anexa exame" on public.patient_exams;
create policy "quem atende anexa exame"
  on public.patient_exams for insert
  to authenticated
  with check ((select private.is_clinic_clinician(clinic_id)));

drop policy if exists "quem atende remove exame" on public.patient_exams;
create policy "quem atende remove exame"
  on public.patient_exams for update
  to authenticated
  using ((select private.is_clinic_clinician(clinic_id)))
  with check ((select private.is_clinic_clinician(clinic_id)));

-- Sem delete: remover e marcar (ver acima).
grant select, insert, update on public.patient_exams to authenticated;

-- Acervo: <clinic_id>/<patient_id>/<arquivo>. Ler e gravar, so quem atende
-- naquela clinica. Sem apagar nem sobrescrever pelo navegador.
drop policy if exists "quem atende le exames do acervo" on storage.objects;
create policy "quem atende le exames do acervo"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'exames'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and private.is_clinic_clinician(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "quem atende grava exames no acervo" on storage.objects;
create policy "quem atende grava exames no acervo"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'exames'
    and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    and private.is_clinic_clinician(((storage.foldername(name))[1])::uuid)
  );

commit;
