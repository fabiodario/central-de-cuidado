begin;

/**
 * Notas internas na conversa do WhatsApp (25/09/2026).
 *
 * Recado da equipe para a propria equipe, dentro da conversa, que a familia
 * nunca recebe. Em 24/09 uma mae escreveu "e paciente da Blue Med e o Dr.
 * Marcello ja esta ciente": o combinado ficou na cabeca de quem leu, e a
 * proxima pessoa a abrir a conversa nao teria como saber. Passagem de turno
 * ("liguei 15h, nao atendeu"), pendencia ("aguardando o Dr. sobre a receita")
 * e excecao combinada ficam registradas onde o assunto acontece.
 *
 * Nada aqui passa pela Meta: e uma tabela a parte, lida so pela tela.
 *
 * Qualquer membro da clinica le e escreve - a recepcao e quem mais usa. Nota
 * nao se edita nem se apaga: e registro de quem combinou o que, e quando.
 * Errou, escreve outra corrigindo.
 */

create table if not exists public.conversation_notes (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations (id) on delete cascade,
  texto text not null,
  autor_id uuid references auth.users (id) on delete set null,
  autor_nome text not null default '',
  criado_em timestamptz not null default now(),
  constraint conversation_notes_texto check (char_length(btrim(texto)) between 1 and 4000)
);

create index if not exists conversation_notes_conversa_idx
  on public.conversation_notes (conversation_id, criado_em);

/**
 * Autor, hora e a clinica certa vem do banco, nao do navegador. A clinica da
 * nota precisa ser a da conversa: sem isto, daria para pendurar uma nota numa
 * conversa de outra clinica informando o proprio clinic_id.
 */
create or replace function private.preparar_nota_da_conversa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  clinica uuid;
begin
  select c.clinic_id into clinica
  from public.whatsapp_conversations c
  where c.id = new.conversation_id;

  if clinica is null or clinica <> new.clinic_id then
    raise exception 'Conversa de outra clinica.' using errcode = '42501';
  end if;

  new.autor_id := auth.uid();
  new.criado_em := now();
  new.texto := btrim(new.texto);
  select coalesce(nullif(btrim(p.full_name), ''), '')
    into new.autor_nome
  from public.profiles p
  where p.id = auth.uid();
  new.autor_nome := coalesce(new.autor_nome, '');
  return new;
end
$function$;

drop trigger if exists conversation_notes_preparar on public.conversation_notes;
create trigger conversation_notes_preparar
before insert on public.conversation_notes
for each row execute function private.preparar_nota_da_conversa();

revoke all on function private.preparar_nota_da_conversa() from public, anon, authenticated;

alter table public.conversation_notes enable row level security;
alter table public.conversation_notes force row level security;

drop policy if exists "equipe le as notas da conversa" on public.conversation_notes;
create policy "equipe le as notas da conversa"
  on public.conversation_notes for select
  to authenticated
  using ((select private.is_clinic_member(clinic_id)));

drop policy if exists "equipe escreve nota na conversa" on public.conversation_notes;
create policy "equipe escreve nota na conversa"
  on public.conversation_notes for insert
  to authenticated
  with check ((select private.is_clinic_member(clinic_id)));

grant select, insert on public.conversation_notes to authenticated;

-- Tempo real: a nota que a colega escreveu aparece sem recarregar a tela.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_notes'
     ) then
    alter publication supabase_realtime add table public.conversation_notes;
  end if;
end
$$;

commit;
