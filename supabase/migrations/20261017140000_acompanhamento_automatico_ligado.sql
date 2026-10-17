-- Ligar e desligar o envio automatico dos acompanhamentos de 15, 30 e 90 dias
-- pela tela (17/10/2026, pedido do Edu).
--
-- Ate aqui o disparo das 9h (whatsapp-dispatch, pelo pg_cron) mandava todo
-- acompanhamento vencido de toda clinica, e parar exigia mexer no cron. Agora o
-- responsavel pela clinica desliga em Preferencias. Ligado por padrao: nada
-- muda para quem ja usa.
--
-- Desligado, so o envio automatico para. A equipe continua enviando um por um
-- na tela de Acompanhamentos, e os lembretes de consulta seguem como sempre. Ao
-- religar, saem os vencidos nos ultimos 14 dias (a janela do disparo).

alter table public.clinic_settings
  add column if not exists acompanhamento_automatico boolean not null default true;

comment on column public.clinic_settings.acompanhamento_automatico is
  'Envio automatico das 9h dos acompanhamentos de 15, 30 e 90 dias. Desligado, a equipe envia pela tela.';

-- O update em clinic_settings e liberado coluna a coluna (ver 20260829180000):
-- sem este grant a tela nao grava. Quem pode gravar continua sendo so o
-- responsavel pela clinica (politica clinic_settings_update_owner).
grant update (acompanhamento_automatico) on table public.clinic_settings to authenticated;
