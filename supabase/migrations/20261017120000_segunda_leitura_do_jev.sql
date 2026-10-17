-- A segunda leitura pelo Jev (TypeSafe AI) ligada e desligada pela tela
-- (17/10/2026, pedido do Edu).
--
-- O prototipo de 17/10/2026 lia o modo de um segredo das Edge Functions
-- (JEV_SEGUNDA_LEITURA): ligar ou desligar pedia o painel do Supabase. Agora o
-- modo mora aqui, e o responsavel pela clinica troca em Preferencias. A chave
-- da TypeSafe continua so nos segredos das Edge Functions (TYPESAFE_API_KEY):
-- chave nao vai para o banco nem para a tela.
--
--   desligada  o robo nao chama o Jev (padrao);
--   sombra     o Jev le e a nota fica em whatsapp_bot_events, sem mudar nada
--              para o paciente;
--   ligada     le, registra e age (ver supabase/functions/_shared/segunda-leitura.ts).
--
-- Em sombra ou ligada, o texto da mensagem do paciente vai para a TypeSafe AI,
-- nos Estados Unidos: esta na politica de privacidade (secao 4) desde
-- 17/10/2026, com o OK do Dr. Fabio.

alter table public.clinic_settings
  add column if not exists jev_segunda_leitura text not null default 'desligada'
    constraint clinic_settings_jev_segunda_leitura_valida
    check (jev_segunda_leitura in ('desligada', 'sombra', 'ligada'));

comment on column public.clinic_settings.jev_segunda_leitura is
  'Segunda leitura das mensagens pelo Jev (TypeSafe AI): desligada, sombra ou ligada.';

-- O update em clinic_settings e liberado coluna a coluna (ver 20260829180000):
-- sem este grant a tela nao grava. Quem pode gravar continua sendo so o
-- responsavel pela clinica (politica clinic_settings_update_owner).
grant update (jev_segunda_leitura) on table public.clinic_settings to authenticated;
