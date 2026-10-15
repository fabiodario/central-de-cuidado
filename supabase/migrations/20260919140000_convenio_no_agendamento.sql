begin;

/**
 * O robô passa a perguntar se a consulta é pelo convênio.
 *
 * Desde 19/09/2026 o Dr. Marcello atende Trasmontano em Santos. Até aqui o
 * agendamento não tinha onde guardar isso: a família marcava, chegava com a
 * carteirinha e a recepção descobria na hora - sem saber se ia faturar pelo
 * plano ou receber particular, e sem tempo de conferir elegibilidade.
 *
 * O convênio é DADO DA UNIDADE, e não uma exceção escrita no código. Amanhã o
 * consultório aceita outro plano, ou passa a aceitar em São Paulo, e isso se
 * resolve numa linha de banco em vez de uma publicação. Unidade com o campo
 * vazio não pergunta nada, e o fluxo dela continua exatamente como era.
 *
 * Três colunas, cada uma num lugar diferente porque respondem a perguntas
 * diferentes:
 *
 *  - clinic_units.accepts_insurance: o que ESTA unidade aceita. É o que o robô
 *    lê para decidir se pergunta, e o texto que ele mostra no botão.
 *  - whatsapp_conversations.booking_insurance: o que a pessoa respondeu,
 *    guardado enquanto ela ainda escolhe dia e horário. Morre quando a
 *    conversa termina, como os outros campos de booking.
 *  - appointments.insurance: o que ficou valendo para aquela consulta. É o que
 *    a recepção lê na Agenda, e o que sobrevive à conversa.
 */

alter table public.clinic_units
  add column if not exists accepts_insurance text not null default '';

comment on column public.clinic_units.accepts_insurance is
  'Nome do convenio aceito nesta unidade. Vazio = so particular, e o robo nao pergunta.';

alter table public.appointments
  add column if not exists insurance text not null default '';

comment on column public.appointments.insurance is
  'Convenio informado no agendamento. Vazio = particular.';

alter table public.whatsapp_conversations
  add column if not exists booking_insurance text;

comment on column public.whatsapp_conversations.booking_insurance is
  'Resposta do convenio enquanto o agendamento esta em andamento.';

-- No sistema do Dr. Marcello aqui vinha o dado da clinica dele: Santos aceita
-- Trasmontano (update em toda unidade com "santos" no nome e o campo vazio).
--
-- No banco do Dr. Fabio (15/10/2026) esse update saiu; as tres colunas acima
-- ficam, porque o agendamento do robo depende delas. O filtro pegaria tambem a
-- unidade de Santos do Dr. Fabio, se ela ja existisse quando isto rodasse, e
-- ela passaria a oferecer Trasmontano, que ele nao atende. Os convenios dele
-- (Porto Saude, Unimed Santos e Santa Saude, so em Santos) entram no cadastro
-- da unidade, pela tela ou na carga inicial da clinica. Esta migration ainda
-- nao tinha sido aplicada no banco do Dr. Fabio, entao foi ajustada aqui
-- mesmo; o original esta no repositorio do Dr. Marcello.

commit;
