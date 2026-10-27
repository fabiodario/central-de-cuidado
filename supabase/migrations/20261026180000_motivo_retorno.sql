-- Etiqueta "Retorno: avaliar pedido" (26/10/2026, vinda do sistema do
-- Dr. Marcello no mesmo dia). Ver explicarOuPassarORetorno em
-- supabase/functions/_shared/atendimento.ts.
--
-- Pedido do Edu: quando o paciente insiste num retorno fora da regra (data
-- depois do prazo, retorno ja usado), o robo explica duas vezes e, na
-- terceira, passa para a equipe avaliar com o medico. A conversa ganha esta
-- etiqueta, laranja, para a equipe saber o que decidir antes de abrir.
--
-- A lista e a de 20261025100200 (com 'sangramento', do Dr. Fabio) mais
-- 'retorno'. A do sistema do Dr. Marcello nao tem 'sangramento': copiada como
-- estava, ela derrubaria toda conversa acesa por sangramento. A funcao sobe
-- depois desta migration; se nao subir, o webhook grava 'atendente' no lugar
-- (plano B).

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_attention_reason_check;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_attention_reason_check check (
    attention_reason is null
    or attention_reason in (
      'atendente', 'remarcacao', 'cancelamento', 'ajuda', 'falha', 'cancelou_sozinho',
      'urgencia', 'anexo', 'documento', 'farmacia', 'numero_errado', 'sangramento',
      'nao_suportada', 'retorno'
    )
  );
