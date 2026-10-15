-- Privilegios de tabela para o service_role usado pelas Edge Functions.
--
-- Contexto do bug que esta migration corrige:
-- O service_role tem o atributo BYPASSRLS, o que faz as policies de RLS serem
-- ignoradas. Isso NAO substitui privilegio de tabela - sao dois controles
-- independentes no Postgres. As migrations anteriores executaram
-- "revoke all on table ... from public, anon, authenticated", e o service_role
-- perdeu junto o acesso que herdava de PUBLIC.
--
-- Resultado: toda leitura feita pelas Edge Functions falhava com
-- "permission denied for table followups". A versao antiga de whatsapp-send
-- tratava qualquer erro dessa consulta como linha inexistente e mostrava
-- "Acompanhamento nao encontrado", escondendo a causa real.

grant usage on schema public to service_role;

-- Usadas por whatsapp-send
grant select, update on table public.followups to service_role;
grant select, update on table public.patients to service_role;
grant select on table public.consultations to service_role;
grant select on table public.clinic_settings to service_role;

-- Usadas por whatsapp-send e meta-webhook
grant select, insert, update on table public.whatsapp_conversations to service_role;
grant select, insert, update on table public.whatsapp_messages to service_role;
grant select, insert on table public.whatsapp_webhook_events to service_role;
