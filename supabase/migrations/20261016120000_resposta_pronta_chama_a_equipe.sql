begin;

/**
 * Resposta pronta que também chama a equipe (16/10/2026).
 *
 * O painel de pacientes simulados (tests/painel) achou o mesmo buraco em
 * vários assuntos: estacionamento, exames feitos no consultório, guia do
 * convênio, regra do retorno, aparelho auditivo, valor da consulta. O
 * consultório ainda não informou essas coisas, e o certo é dizer que a equipe
 * confirma. Mas a resposta pronta só respondia: "a nossa equipe passa por
 * aqui" saía, e ninguém da equipe ficava sabendo. O paciente esperava uma
 * resposta que não vinha.
 *
 * Ligado, o robô manda o texto e põe a conversa na fila da equipe, como o
 * "falar com a equipe" do menu. Quando o consultório informar o assunto, basta
 * escrever a resposta completa e desligar.
 */

alter table public.bot_answers
  add column if not exists hand_off boolean not null default false;

comment on column public.bot_answers.hand_off is
  'Ligado, o robo responde o texto e passa a conversa para a equipe (assunto que a equipe confirma).';

commit;
