-- Vindo do sistema do Dr. Marcello (20261020180000_renomear_e_responder.sql),
-- trazido em 25/10/2026 com data nova.
begin;

/**
 * Nome da conversa escolhido pela equipe (20/10/2026, no sistema do Dr.
 * Marcello).
 *
 * La, o numero corporativo de um convenio marcou consulta para um paciente pelo
 * robo, e a ficha gravou aquele numero como telefone dele. Dali em diante a
 * conversa do convenio aparecia na tela com o nome do paciente, e a equipe nao
 * tinha como corrigir ali.
 *
 * O nome daqui so muda o que a tela mostra no cartao e no cabecalho. O
 * cadastro do paciente continua como esta. Nulo = nome do cadastro ou do
 * WhatsApp, como antes.
 */
alter table public.whatsapp_conversations
  add column if not exists nome_personalizado text;

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_nome_personalizado_tamanho;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_nome_personalizado_tamanho
  check (nome_personalizado is null or char_length(nome_personalizado) between 1 and 120);

comment on column public.whatsapp_conversations.nome_personalizado is
  'Nome que a equipe deu a esta conversa na tela (botao Renomear). Nao muda o cadastro do paciente. Nulo = nome do cadastro ou do WhatsApp.';

grant update (nome_personalizado) on table public.whatsapp_conversations to authenticated;

/**
 * Mensagem respondida (20/10/2026): o "responder" do WhatsApp.
 *
 * A equipe responde citando uma mensagem do paciente, e ele ve a citacao no
 * WhatsApp dele (context.message_id da Meta). Guardar aqui a mensagem citada
 * deixa a tela mostrar a mesma citacao em cima do balao. Tambem vale para o
 * paciente citando uma mensagem nossa.
 */
alter table public.whatsapp_messages
  add column if not exists responde_a uuid references public.whatsapp_messages(id) on delete set null;

comment on column public.whatsapp_messages.responde_a is
  'Mensagem que esta responde, citada no WhatsApp (context.message_id). Nulo = mensagem solta.';

/**
 * "Este numero nao e do paciente" (20/10/2026).
 *
 * Desliga a conversa do cadastro quando o telefone casou com o paciente errado
 * (numero de convenio, de empresa, de parente que marcou para varias pessoas).
 * A tela nao recebe permissao direta em patient_id: ligar a conversa a um
 * paciente qualquer continua so pelo vincular_contato_ao_paciente, que confere
 * o telefone. Aqui so se desliga.
 *
 * Se o cadastro continuar com este telefone, a proxima mensagem liga de novo:
 * corrigir o telefone do paciente e parte do conserto, e a tela avisa.
 */
create or replace function public.desvincular_conversa_do_paciente(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_clinic_id uuid;
begin
  select c.clinic_id into v_clinic_id
  from public.whatsapp_conversations c
  where c.id = p_conversation_id;

  if v_clinic_id is null then
    raise exception 'Conversa nao encontrada.';
  end if;

  if not (select private.is_clinic_editor(v_clinic_id)) then
    raise exception 'Sem permissao para mudar conversas nesta clinica.';
  end if;

  update public.whatsapp_conversations
  set patient_id = null
  where id = p_conversation_id;
end;
$fn$;

comment on function public.desvincular_conversa_do_paciente(uuid) is
  'Desliga a conversa do cadastro do paciente, quando o telefone casou com o paciente errado.';

revoke all on function public.desvincular_conversa_do_paciente(uuid) from public, anon;
grant execute on function public.desvincular_conversa_do_paciente(uuid) to authenticated;

commit;
