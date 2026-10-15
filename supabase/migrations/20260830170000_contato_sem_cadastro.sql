-- Quem escreve no WhatsApp sem estar cadastrado aparecia na tela como "Contato
-- sem cadastro", sem nome e sem telefone. A equipe nao sabia com quem estava
-- falando nem tinha como transformar aquilo em paciente.

-- ---------------------------------------------------------------
-- 1. O nome que a pessoa usa no proprio WhatsApp
--
-- A Meta manda isso em todo evento, no bloco `contacts`. Nao e nome
-- verificado - vem "Ana", "Mae do Pedro" ou "Ana <3" - entao serve para a
-- equipe reconhecer a conversa, nunca como nome de prontuario.
-- ---------------------------------------------------------------

alter table public.whatsapp_conversations
  add column if not exists profile_name text not null default '';

comment on column public.whatsapp_conversations.profile_name is
  'Nome que a pessoa configurou no WhatsApp dela. Nao verificado: usar so para identificar a conversa.';

-- ---------------------------------------------------------------
-- 2. Ligar o historico ao paciente recem-cadastrado
--
-- O webhook so procura o paciente pelo telefone quando a mensagem chega. Se a
-- secretaria cadastrar a pessoa depois, a conversa continuaria orfa ate a
-- proxima mensagem - e a consulta que a pessoa marcou pelo WhatsApp ficaria
-- para sempre sem dono, fora do prontuario e fora dos acompanhamentos.
--
-- E security definer porque a tela nao tem (nem deve ter) permissao de escrever
-- em whatsapp_messages. A checagem de quem pode fazer isso e explicita logo no
-- comeco do corpo.
-- ---------------------------------------------------------------

create or replace function public.vincular_contato_ao_paciente(p_patient_id uuid)
returns table (conversas integer, mensagens integer, consultas integer)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_clinic_id uuid;
  v_digits text;
  v_variantes text[];
  v_conversas uuid[];
  v_qtd_conversas integer := 0;
  v_qtd_mensagens integer := 0;
  v_qtd_consultas integer := 0;
begin
  select p.clinic_id, p.phone_digits
    into v_clinic_id, v_digits
  from public.patients p
  where p.id = p_patient_id and p.archived_at is null;

  if v_clinic_id is null then
    raise exception 'Paciente nao encontrado.';
  end if;

  if not (select private.is_clinic_editor(v_clinic_id)) then
    raise exception 'Sem permissao para vincular conversas nesta clinica.';
  end if;

  if coalesce(v_digits, '') = '' then
    return query select 0, 0, 0;
    return;
  end if;

  -- O wa_id chega da Meta com o 55 na frente; o cadastro costuma ter so o DDD.
  -- Comparar as duas formas evita perder o vinculo por causa disso.
  v_variantes := array[
    v_digits,
    '55' || v_digits,
    regexp_replace(v_digits, '^55', '')
  ];

  with alteradas as (
    update public.whatsapp_conversations c
       set patient_id = p_patient_id
     where c.clinic_id = v_clinic_id
       and c.patient_id is null
       and c.wa_id = any(v_variantes)
    returning c.id
  )
  select array_agg(id), count(*) into v_conversas, v_qtd_conversas from alteradas;

  if v_conversas is null or array_length(v_conversas, 1) is null then
    return query select 0, 0, 0;
    return;
  end if;

  with alteradas as (
    update public.whatsapp_messages m
       set patient_id = p_patient_id
     where m.conversation_id = any(v_conversas)
       and m.patient_id is null
    returning 1
  )
  select count(*) into v_qtd_mensagens from alteradas;

  -- Consulta marcada pelo WhatsApp antes do cadastro: o telefone e a unica
  -- ligacao que existia entre a pessoa e a vaga reservada.
  with alteradas as (
    update public.appointments a
       set patient_id = p_patient_id
     where a.clinic_id = v_clinic_id
       and a.patient_id is null
       and a.status <> 'cancelled'
       and regexp_replace(coalesce(a.contact_phone, ''), '[^0-9]', '', 'g') = any(v_variantes)
    returning 1
  )
  select count(*) into v_qtd_consultas from alteradas;

  return query select v_qtd_conversas, v_qtd_mensagens, v_qtd_consultas;
end;
$fn$;

comment on function public.vincular_contato_ao_paciente(uuid) is
  'Liga conversas, mensagens e consultas do WhatsApp ao paciente recem-cadastrado, casando pelo telefone.';

revoke all on function public.vincular_contato_ao_paciente(uuid) from public, anon;
grant execute on function public.vincular_contato_ao_paciente(uuid) to authenticated;
