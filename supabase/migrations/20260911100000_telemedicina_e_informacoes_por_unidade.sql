begin;

/**
 * Telemedicina, informações por unidade e urgência.
 *
 * Três pedidos do dr. Marcello, em 11/09/2026, que mexem no mesmo lugar: o que
 * o robô diz quando alguém pergunta "quanto custa" e como ele marca.
 *
 * 1. O valor não é um só. Santos custa R$ 450 e São Paulo R$ 550, então a
 *    resposta de informações precisa perguntar onde antes de responder. O
 *    texto deixa de ser um campo único da clínica e passa a ser um por unidade.
 *
 * 2. Telemedicina vira uma opção de atendimento, com valor próprio (R$ 450 e
 *    retorno presencial em 30 dias). Ela não tem agenda própria: usa os
 *    horários das unidades físicas, porque é o mesmo médico no mesmo dia. Por
 *    isso a consulta continua presa à unidade que cedeu o horário, e o que
 *    muda é a modalidade.
 *
 * 3. Quem pede telemedicina pode dizer que é urgência. Aí o robô não marca:
 *    transfere para a equipe com uma bandeira própria, para saltar na lista.
 */

-- ---------------------------------------------------------------
-- 1. Texto de informações por unidade
-- ---------------------------------------------------------------

alter table public.clinic_units
  add column if not exists info_text text not null default '';

comment on column public.clinic_units.info_text is
  'O que o robo responde quando a familia pede informacoes desta unidade: valor, pagamento, endereco, o que levar.';

alter table public.clinic_units
  drop constraint if exists clinic_units_info_text_length;
alter table public.clinic_units
  add constraint clinic_units_info_text_length check (char_length(info_text) <= 1024);

-- ---------------------------------------------------------------
-- 2. Telemedicina
-- ---------------------------------------------------------------

alter table public.clinic_settings
  add column if not exists telemedicine_enabled boolean not null default true,
  add column if not exists telemedicine_info_text text not null default '';

comment on column public.clinic_settings.telemedicine_enabled is
  'Se o robo oferece telemedicina como opcao de informacao e de agendamento.';
comment on column public.clinic_settings.telemedicine_info_text is
  'O que o robo responde quando a familia pede informacoes sobre a telemedicina.';

grant update (telemedicine_enabled, telemedicine_info_text) on table public.clinic_settings to authenticated;

-- A modalidade da consulta. Presencial e o de sempre; telemedicina usa o
-- horario de uma unidade fisica, mas acontece por video.
alter table public.appointments
  add column if not exists modality text not null default 'presencial';

alter table public.appointments
  drop constraint if exists appointments_modality_check;
alter table public.appointments
  add constraint appointments_modality_check check (modality in ('presencial', 'telemedicina'));

comment on column public.appointments.modality is
  'presencial ou telemedicina. A unidade continua sendo a que cedeu o horario.';

-- O robo precisa lembrar, entre uma mensagem e outra, que a pessoa escolheu
-- telemedicina - senao ao escolher o dia ele marcaria presencial.
alter table public.whatsapp_conversations
  add column if not exists booking_modality text;

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_booking_modality_check;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_booking_modality_check check (
    booking_modality is null or booking_modality in ('presencial', 'telemedicina')
  );

-- ---------------------------------------------------------------
-- 3. Urgência na bandeira de atenção
-- ---------------------------------------------------------------

alter table public.whatsapp_conversations
  drop constraint if exists whatsapp_conversations_attention_reason_check;
alter table public.whatsapp_conversations
  add constraint whatsapp_conversations_attention_reason_check check (
    attention_reason is null
    or attention_reason in (
      'atendente', 'remarcacao', 'cancelamento', 'ajuda', 'falha', 'cancelou_sozinho', 'urgencia'
    )
  );

-- ---------------------------------------------------------------
-- 4. Os textos, como o dr. passou em 11/09/2026
--
-- No sistema do Dr. Marcello aqui vinham os textos DELE: valor de Santos, Sao
-- Paulo e telemedicina, "nao atendemos convenio", enderecos da Liferty e da
-- Livance e "carteirinha de vacinacao da crianca", nas unidades, na
-- telemedicina e em quatro respostas prontas.
--
-- No banco do Dr. Fabio (15/10/2026) esses updates sairam; as partes 1 a 3
-- ficam. Os filtros nao olhavam a clinica: "santos" no nome pegaria a unidade
-- de Santos do Dr. Fabio, e a resposta de Convenios era trocada sem condicao
-- nenhuma. Se a clinica dele ja existisse quando isto rodasse, o robo dele
-- passaria a dizer o preco e o endereco do Dr. Marcello e que nao atende
-- convenio. Os textos do Dr. Fabio sao os de src/simulador/dados.ts,
-- cadastrados pela tela ou na carga inicial da clinica. Esta migration ainda
-- nao tinha sido aplicada no banco do Dr. Fabio, entao foi ajustada aqui
-- mesmo; o original esta no repositorio do Dr. Marcello.
-- ---------------------------------------------------------------

commit;
