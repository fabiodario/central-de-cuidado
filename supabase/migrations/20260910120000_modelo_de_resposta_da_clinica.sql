begin;

/**
 * O modelo que leva a resposta da equipe fora da janela de 24 horas.
 *
 * Até aqui, passadas as 24 horas desde a última mensagem do paciente, a equipe
 * só podia mandar o convite: "responda para a gente conversar". Quem escreveu
 * "vocês atendem convênio?" às 17h e voltou no dia seguinte recebia um pedido
 * para escrever de novo, em vez da resposta - e a pergunta continuava sem
 * resposta por mais um dia.
 *
 * Este modelo carrega o texto da clínica dentro dele. A equipe digita na tela
 * de sempre e a mensagem sai, com a moldura que a Meta aprovou:
 *
 *   Olá, {{1}}. Aqui é o consultório do Dr. Marcello Ruiz.
 *
 *   {{2}}
 *
 *   Se precisar, é só responder por aqui.
 *
 * O convite continua existindo: são dois caminhos, não uma troca. Ele serve
 * quando o assunto é longo, ou quando é melhor a família escrever primeiro.
 *
 * Categoria utilidade, e isso não é detalhe burocrático: utilidade é resposta a
 * algo que a pessoa pediu. Usar para divulgação derruba a nota do número na
 * Meta e pode restringir o envio da clínica inteira.
 */

alter table public.clinic_settings
  add column if not exists whatsapp_reply_template_name text not null default 'resposta_da_clinica';

comment on column public.clinic_settings.whatsapp_reply_template_name is
  'Modelo de utilidade que leva o texto da equipe fora da janela de 24h. Dois parametros: nome e mensagem.';

grant update (whatsapp_reply_template_name) on table public.clinic_settings to authenticated;

commit;
