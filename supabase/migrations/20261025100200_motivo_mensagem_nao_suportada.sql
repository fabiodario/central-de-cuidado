-- Etiqueta "Tentou falar (ligacao?)". Vindo do sistema do Dr. Marcello
-- (20261016180000, de 16/10/2026), trazido em 25/10/2026 com data nova. Ver
-- destinoDaNaoSuportada em supabase/functions/_shared/mensagem-recebida.ts.
--
-- La, um contato mandou duas vezes algo que o WhatsApp entrega como
-- "[unsupported]" - provavelmente uma ligacao - e o menu do robo voltou
-- "Message undeliverable" nas duas. Agora o robo nao responde e a conversa vai
-- para a equipe com este motivo, que diz para usar um modelo aprovado.
--
-- A lista e a de 20261015130000 (com 'sangramento', do Dr. Fabio) mais
-- 'nao_suportada'. A do sistema do Dr. Marcello nao tem 'sangramento': copiada
-- como estava, ela derrubaria toda conversa acesa por sangramento. A funcao
-- sobe junto e, se esta migration nao chegar, grava 'atendente' no lugar
-- (plano B no webhook).

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_attention_reason_check;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_attention_reason_check check (
    attention_reason is null
    or attention_reason in (
      'atendente', 'remarcacao', 'cancelamento', 'ajuda', 'falha', 'cancelou_sozinho',
      'urgencia', 'anexo', 'documento', 'farmacia', 'numero_errado', 'sangramento',
      'nao_suportada'
    )
  );
