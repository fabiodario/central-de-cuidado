-- Modelos de texto reutilizaveis no prontuario.
--
-- Gastropediatria repete muita frase: orientacao de dieta, preparo de exame,
-- retorno padrao. Hoje isso e redigitado a cada consulta, e o que se repete a
-- mao acaba saindo diferente cada vez.
--
-- Os modelos sao DA CLINICA, nao de cada profissional. Hoje quem escreve
-- prontuario e uma pessoa so; dividir por autor agora criaria uma coluna para
-- separar o que ninguem precisa separar. Se entrar outro medico, acrescentar um
-- `owner_id` opcional depois e barato - o contrario, juntar o que ja nasceu
-- separado, nao e.
--
-- `field` guarda a chave do campo do formulario ("conduta", "prescricao") para
-- o modelo aparecer so onde faz sentido. Vazio significa "serve em qualquer
-- campo". Nao ha CHECK contra uma lista fixa de proposito: a lista de campos
-- vive na tela, e um CHECK aqui viraria uma migration toda vez que ela mudasse.

begin;

create table if not exists public.note_templates (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete restrict,
  field text not null default '',
  title text not null,
  body text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Aposentar em vez de apagar, como no resto do prontuario: um modelo antigo
  -- pode ter sido usado em consulta que ainda sera lida.
  archived_at timestamptz,
  constraint note_templates_title_length check (char_length(title) between 1 and 80),
  constraint note_templates_body_length check (char_length(body) <= 8000),
  constraint note_templates_field_length check (char_length(field) <= 40)
);

comment on table public.note_templates is
  'Textos prontos para reusar nos campos do prontuario. Sao da clinica inteira, nao de cada profissional.';
comment on column public.note_templates.field is
  'Chave do campo do formulario onde o modelo aparece. Vazio serve em qualquer campo.';

-- A busca e sempre "os modelos deste campo, nesta clinica, ainda ativos".
create index if not exists note_templates_clinic_field_idx
  on public.note_templates (clinic_id, field)
  where archived_at is null;

-- Autoria e data de alteracao ficam a cargo dos mesmos gatilhos que o resto do
-- prontuario ja usa. O cliente nao manda quem escreveu - ele nao teria como
-- provar, e a policy nao o obrigaria a dizer a verdade.
drop trigger if exists note_templates_set_actor on public.note_templates;
create trigger note_templates_set_actor
before insert or update on public.note_templates
for each row execute function private.set_clinical_actor();

drop trigger if exists note_templates_set_updated_at on public.note_templates;
create trigger note_templates_set_updated_at
before update on public.note_templates
for each row execute function private.set_updated_at();

alter table public.note_templates enable row level security;
alter table public.note_templates force row level security;

drop policy if exists note_templates_select on public.note_templates;
create policy note_templates_select on public.note_templates
  for select to authenticated
  using ((select private.is_clinic_member(clinic_id)));

drop policy if exists note_templates_insert on public.note_templates;
create policy note_templates_insert on public.note_templates
  for insert to authenticated
  with check ((select private.is_clinic_clinician(clinic_id)));

drop policy if exists note_templates_update on public.note_templates;
create policy note_templates_update on public.note_templates
  for update to authenticated
  using ((select private.is_clinic_clinician(clinic_id)))
  with check ((select private.is_clinic_clinician(clinic_id)));

-- Sem policy de delete: aposentadoria e via archived_at.

revoke all on table public.note_templates from public, anon, authenticated;
grant select on table public.note_templates to authenticated;
-- Coluna a coluna, como em consultations. Coluna nova que nao entrar aqui fica
-- silenciosamente sem gravar - foi assim que o projeto ja se queimou antes.
grant insert (clinic_id, field, title, body)
  on table public.note_templates to authenticated;
grant update (field, title, body, archived_at)
  on table public.note_templates to authenticated;

commit;
