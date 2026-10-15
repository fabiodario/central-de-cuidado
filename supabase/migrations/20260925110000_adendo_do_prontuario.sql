begin;

/**
 * Adendo em atendimento assinado (25/09/2026).
 *
 * Desde 06/09 o banco recusa qualquer alteracao numa consulta assinada, e a
 * mensagem de erro ja dizia "registre um adendo" - mas o adendo nao existia.
 * O caminho que sobrava era abrir uma consulta nova com a data de hoje so para
 * dizer "na consulta de ontem, onde se le X, leia-se Y", espalhando a correcao
 * longe do que ela corrige.
 *
 * A regra e a da nao-rasura (Res. CFM 1.638/2002): o original fica intacto e
 * a anotacao nova entra datada e com autor. Por isso esta tabela so aceita
 * INSERT - nem o proprio autor edita ou apaga um adendo depois de gravado. E
 * cada adendo entra na mesma corrente de integridade das consultas: o selo
 * "Integro" do prontuario passa a cobrir os adendos tambem.
 *
 * O adendo nao e assinado digitalmente (ainda): a assinatura ICP-Brasil vale
 * sobre o PDF do atendimento. Ele fica registrado com autor, hora e hash.
 */

create table if not exists public.consultation_addenda (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  patient_id uuid not null,
  consultation_id uuid not null,
  texto text not null,
  autor_id uuid references auth.users (id) on delete set null,
  autor_nome text not null default '',
  criado_em timestamptz not null default now(),
  constraint consultation_addenda_consultation_fk
    foreign key (consultation_id, patient_id, clinic_id)
    references public.consultations (id, patient_id, clinic_id)
    on delete restrict,
  constraint consultation_addenda_texto
    check (char_length(btrim(texto)) between 1 and 20000)
);

create index if not exists consultation_addenda_consulta_idx
  on public.consultation_addenda (consultation_id, criado_em);
create index if not exists consultation_addenda_paciente_idx
  on public.consultation_addenda (clinic_id, patient_id);

/**
 * Quem escreve e quando nao vem do navegador: o banco preenche. E o adendo so
 * existe para atendimento ja assinado - no rascunho, corrige-se o proprio
 * texto, que e o que o medico espera.
 */
create or replace function private.preparar_adendo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  assinada timestamptz;
begin
  select c.signed_at into assinada
  from public.consultations c
  where c.id = new.consultation_id
    and c.patient_id = new.patient_id
    and c.clinic_id = new.clinic_id;

  if assinada is null then
    raise exception 'Adendo so existe para atendimento assinado. Este ainda pode ser editado.'
      using errcode = 'P0001';
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

drop trigger if exists consultation_addenda_preparar on public.consultation_addenda;
create trigger consultation_addenda_preparar
before insert on public.consultation_addenda
for each row execute function private.preparar_adendo();

create or replace function private.recusar_mudanca_de_adendo()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception 'Adendo nao se altera nem se apaga: registre um novo adendo.'
    using errcode = '55000';
end
$function$;

drop trigger if exists consultation_addenda_imutavel on public.consultation_addenda;
create trigger consultation_addenda_imutavel
before update or delete on public.consultation_addenda
for each row execute function private.recusar_mudanca_de_adendo();

/**
 * O adendo entra na corrente de auditoria do prontuario. before_data vazio e
 * after_data com o adendo inteiro: quem conferir a corrente ve exatamente o
 * que foi acrescentado, por quem e quando.
 */
create or replace function private.auditar_adendo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into private.consultation_audit (
    consultation_id, clinic_id, patient_id, changed_by, before_data, after_data
  ) values (
    new.consultation_id,
    new.clinic_id,
    new.patient_id,
    new.autor_id,
    '{}'::jsonb,
    jsonb_build_object('adendo', to_jsonb(new))
  );
  return new;
end
$function$;

drop trigger if exists consultation_addenda_auditar on public.consultation_addenda;
create trigger consultation_addenda_auditar
after insert on public.consultation_addenda
for each row execute function private.auditar_adendo();

revoke all on function private.preparar_adendo() from public, anon, authenticated;
revoke all on function private.auditar_adendo() from public, anon, authenticated;
revoke all on function private.recusar_mudanca_de_adendo() from public, anon, authenticated;

alter table public.consultation_addenda enable row level security;
alter table public.consultation_addenda force row level security;

drop policy if exists "quem atende le os adendos" on public.consultation_addenda;
create policy "quem atende le os adendos"
  on public.consultation_addenda for select
  to authenticated
  using ((select private.is_clinic_clinician(clinic_id)));

drop policy if exists "quem atende escreve adendo" on public.consultation_addenda;
create policy "quem atende escreve adendo"
  on public.consultation_addenda for insert
  to authenticated
  with check ((select private.is_clinic_clinician(clinic_id)));

-- So leitura e insercao. Sem update e delete de proposito (ver acima).
grant select, insert on public.consultation_addenda to authenticated;

commit;
