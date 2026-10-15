-- Motivo de atencao "numero errado" (06/10/2026).
--
-- O cadastro do Rogerio Alves tem o telefone de outra pessoa. Ela respondeu
-- "Nao sou o Rogerio" ao lembrete de 30/09 e de novo ao de 07/10 - e as duas
-- vezes o robo ficou calado e a conversa acendeu como "Quer falar com a
-- equipe", que nao diz o que precisa ser feito: corrigir o telefone da ficha.
--
-- Idempotente: pode ser aplicada a mao e de novo pelo db push.
alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_attention_reason_check;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_attention_reason_check check (
    attention_reason is null
    or attention_reason in (
      'atendente', 'remarcacao', 'cancelamento', 'ajuda', 'falha', 'cancelou_sozinho',
      'urgencia', 'anexo', 'documento', 'farmacia', 'numero_errado'
    )
  );
