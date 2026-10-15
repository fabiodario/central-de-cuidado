-- O paciente passa a ver, cancelar e remarcar a propria consulta pelo WhatsApp.
--
-- Ate aqui o menu so sabia informar, agendar e chamar gente. Quem ja tinha
-- consulta marcada e queria desmarcar nao tinha caminho nenhum: fora da janela
-- do lembrete, a unica saida era digitar ATENDENTE e esperar a secretaria.

-- ---------------------------------------------------------------
-- Remarcar sem perder a vaga no meio do caminho
--
-- Remarcar e "marcar a nova E cancelar a antiga". Cancelar primeiro deixaria a
-- pessoa sem nada caso ela desistisse no meio - e a vaga antiga ja teria ido
-- para outro. Entao a consulta a substituir fica anotada aqui e so e cancelada
-- depois que a nova entra.
-- ---------------------------------------------------------------

alter table public.whatsapp_conversations
  add column if not exists booking_replaces_id uuid;

comment on column public.whatsapp_conversations.booking_replaces_id is
  'Consulta que sera cancelada assim que a nova for marcada, num fluxo de remarcacao.';

comment on column public.whatsapp_conversations.booking_state is
  'Etapa da conversa automatica: menu, minha_consulta, confirmar_cancelamento, ja_tem_consulta, aguardando_paciente, aguardando_unidade, aguardando_dia, aguardando_horario, atendente, ou nulo.';

-- ---------------------------------------------------------------
-- Avisar o paciente quando a equipe confirma a solicitacao
--
-- Motivo novo para a bandeira de atencao: o proprio paciente cancelando pelo
-- WhatsApp abre um buraco na agenda que a recepcao pode querer preencher.
-- ---------------------------------------------------------------

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_attention_reason_check;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_attention_reason_check check (
    attention_reason is null
    or attention_reason in (
      'atendente', 'remarcacao', 'cancelamento', 'ajuda', 'falha', 'cancelou_sozinho'
    )
  );

-- ---------------------------------------------------------------
-- Consulta quente: "esta pessoa ja tem consulta futura marcada?"
--
-- Usada em tres lugares novos - antes de agendar, ao mostrar "minha consulta" e
-- ao avisar que ja existe uma marcada.
-- ---------------------------------------------------------------

create index if not exists appointments_contato_futuras_idx
  on public.appointments (clinic_id, contact_phone, starts_at)
  where status = 'scheduled';
