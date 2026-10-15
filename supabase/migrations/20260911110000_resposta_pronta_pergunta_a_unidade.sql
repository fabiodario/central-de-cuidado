begin;

/**
 * Resposta pronta que pergunta onde é o atendimento antes de responder.
 *
 * "Quanto custa a consulta?" não tem uma resposta só: Santos é R$ 450, São
 * Paulo R$ 550 e a telemedicina R$ 450 com retorno presencial. Despejar os
 * três valores num parágrafo obriga a família a achar o dela no meio. Com este
 * interruptor ligado, o robô faz a mesma pergunta da opção 1 do menu - Santos,
 * São Paulo ou Telemedicina - e responde o texto daquele lugar, com valor,
 * pagamento e endereço certos.
 *
 * O texto da resposta continua existindo: vale quando a clínica tem um lugar
 * só (aí não há o que perguntar) e como reserva se o texto da unidade estiver
 * vazio.
 */

alter table public.bot_answers
  add column if not exists ask_unit boolean not null default false;

comment on column public.bot_answers.ask_unit is
  'Ligado, o robo pergunta a unidade (ou telemedicina) e responde o texto de informacoes dela, em vez do texto desta resposta.';

update public.bot_answers
set ask_unit = true
where subject = 'Valor e pagamento';

commit;

begin;

/**
 * O fecho comum das informações.
 *
 * O texto único de informações terminava com o que vale para qualquer
 * unidade: agendar pelo 2, equipe pelo 3, telefones e horário de atendimento.
 * Ao dividir as informações por unidade, essa parte ficou sem lugar. Ela volta
 * como fecho: o campo antigo (whatsapp_menu_info_text) passa a guardar só esse
 * trecho, e o robô o cola no fim do texto de qualquer unidade e da
 * telemedicina. Muda-se um telefone em um lugar, não em três.
 *
 * Só reescreve se o campo ainda tiver o valor antigo da consulta dentro - sinal
 * de que é o texto de antes da divisão, e não algo que a clínica já editou.
 *
 * No banco do Dr. Fabio (15/10/2026) esse update saiu; o comentario da coluna,
 * logo abaixo, fica. O fecho novo levava os telefones da recepcao do Dr.
 * Marcello, e o filtro era so "R$ 450" no texto: se a clinica do Dr. Fabio ja
 * existisse quando isto rodasse e cobrasse esse valor, os pacientes dele
 * receberiam os telefones de outra clinica. O fecho do Dr. Fabio e escrito
 * pela clinica em Preferencias. Esta migration ainda nao tinha sido aplicada
 * no banco do Dr. Fabio, entao foi ajustada aqui mesmo; o original esta no
 * repositorio do Dr. Marcello.
 */

comment on column public.clinic_settings.whatsapp_menu_info_text is
  'Fecho comum das informacoes: vai no fim do texto de qualquer unidade e da telemedicina (como agendar, equipe, telefones, horario).';

commit;
