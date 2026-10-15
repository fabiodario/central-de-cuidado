-- O webhook passa a apagar a chave de um evento que falhou no meio, para o
-- reenvio da Meta ser processado em vez de descartado como repetido.
--
-- Ate 24/09/2026 uma falha no processamento (banco fora, tempo esgotado)
-- devolvia 500, a Meta reenviava, e o reenvio encontrava a chave ja gravada:
-- a mensagem da familia nunca entrava no sistema, sem erro em lugar nenhum.
-- Ver supabase/functions/_shared/eventos-do-webhook.ts.
--
-- O service_role so tinha select e insert nesta tabela (20260823193000). Sem o
-- delete, a liberacao falharia - e ela registra o erro no log, mas a mensagem
-- continuaria se perdendo. Esta migration roda antes das funcoes no deploy.

grant delete on table public.whatsapp_webhook_events to service_role;
