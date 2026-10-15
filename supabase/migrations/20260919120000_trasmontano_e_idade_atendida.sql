begin;

/**
 * Trasmontano em Santos e resposta de idade atendida: SEM EFEITO NO BANCO DO
 * DR. FABIO (15/10/2026).
 *
 * O que fazia no sistema do Dr. Marcello: reescrevia a resposta pronta de
 * Convenios (Trasmontano em Santos, o resto particular) e os textos das
 * unidades e da telemedicina, e criava a resposta "Idade atendida" ("O Dr.
 * Marcello atende desde recem-nascidos ate 19 anos") para toda clinica.
 *
 * Por que nao vale aqui: os dois assuntos sao da clinica DELE. O Dr. Fabio
 * atende adultos e criancas, e os convenios dele sao outros (Porto Saude,
 * Unimed Santos e Santa Saude em Santos). Num banco novo a tabela ainda
 * estaria vazia; mas se a clinica do Dr. Fabio ja existisse quando esta
 * migration rodasse (um db push que parou no meio e foi retomado depois), ele
 * ganharia uma resposta com o nome de outro medico e a de convenios trocada
 * pela do Dr. Marcello. Entao nada e escrito.
 *
 * A licao de robo que veio junto (tirar "atende" e "atendem" das palavras de
 * Convenios, que pegavam "voces atendem bebes?") ja esta nas respostas
 * prontas do Dr. Fabio em src/simulador/dados.ts, que nao tem essas palavras.
 *
 * Esta migration ainda nao tinha sido aplicada no banco do Dr. Fabio, entao
 * foi esvaziada aqui mesmo. O arquivo fica para a lista de migrations
 * continuar igual a do sistema de origem; o original esta no repositorio do
 * Dr. Marcello.
 */

commit;
