-- Vindo do sistema do Dr. Marcello (20261023150000, de 23/10/2026), trazido
-- em 25/10/2026 com data nova: a publicacao so aplica migration posterior a
-- ultima que ja esta no banco.
--
-- 1. Evento do webhook so vale como "feito" quando o processamento termina.
--
-- La, uma mae respondeu o dia da consulta com o Supabase instavel. A
-- plataforma derrubou a funcao por tempo (504) e funcao derrubada nao chega ao
-- catch que libera a chave (20260924100000). A chave ficou, os reenvios da
-- Meta foram descartados como repetidos e a familia ficou sem resposta, sem
-- erro em lugar nenhum. Agora o webhook grava concluded_at ao terminar cada
-- evento; chave sem conclusao e com mais de 3 minutos e de uma execucao que
-- morreu, e o reenvio a retoma. Ver
-- supabase/functions/_shared/eventos-do-webhook.ts.

alter table public.whatsapp_webhook_events
  add column if not exists concluded_at timestamptz;

-- O que ja estava gravado foi processado pelo codigo antigo: conta como
-- concluido, senao um reenvio tardio da Meta seria retomado e respondido de novo.
update public.whatsapp_webhook_events
  set concluded_at = processed_at
  where concluded_at is null;

-- concluir e retomar sao UPDATE; o service_role so tinha select, insert e
-- delete (20260823193000, 20260924100000). Sem isto a retomada falha e o
-- webhook volta a descartar, como antes.
grant update on table public.whatsapp_webhook_events to service_role;

-- 2. Notas internas gravadas pelas Edge Functions.
--
-- O alerta de urgencia (alerta-de-urgencia.ts e resposta-ao-alerta.ts, com
-- service_role) grava nota interna na conversa, mas a tabela so foi liberada
-- para authenticated (20260925140000). No sistema do Dr. Marcello, em 23/10:
-- "permission denied for table conversation_notes" - o alerta saiu para os
-- celulares, mas a nota nunca apareceu na conversa. Aqui o furo era o mesmo.
grant select, insert on table public.conversation_notes to service_role;
