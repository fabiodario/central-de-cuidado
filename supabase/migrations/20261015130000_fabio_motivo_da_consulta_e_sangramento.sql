-- Consultorio do Dr. Fabio Dario (15/10/2026): o que o robo dele grava a mais.
--
-- 1. O motivo da consulta na ficha (intake_complaint). A Dayane ja pedia na
--    mensagem dela "o motivo da consulta ou sua principal queixa"; o robo
--    pergunta depois de marcar, opcional, e guarda na consulta - a queixa e da
--    consulta, e nao do cadastro. Texto livre, ate 300 caracteres pelo robo.
--
-- 2. O motivo de atencao 'sangramento'. Pedido do Dr. Fabio: qualquer mencao a
--    sangramento acende a conversa e manda a notificacao urgente para o
--    celular dele e o da Dayane (ver _shared/aviso-da-equipe.ts). Sem este
--    valor na lista, o update da conversa seria recusado - e o alerta, que e a
--    razao de existir disto, nunca sairia.
--
-- Idempotente: pode ser aplicada a mao e de novo pelo db push.
alter table public.appointments
  add column if not exists intake_complaint text;

comment on column public.appointments.intake_complaint is
  'Motivo da consulta ou principal queixa, como o paciente escreveu no WhatsApp (perfil geral, Dr. Fabio).';

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_attention_reason_check;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_attention_reason_check check (
    attention_reason is null
    or attention_reason in (
      'atendente', 'remarcacao', 'cancelamento', 'ajuda', 'falha', 'cancelou_sozinho',
      'urgencia', 'anexo', 'documento', 'farmacia', 'numero_errado', 'sangramento'
    )
  );
