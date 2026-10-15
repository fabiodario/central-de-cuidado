begin;

/**
 * Link de pagamento da Livance sem prometer prazo: SEM EFEITO NO BANCO DO DR.
 * FABIO (15/10/2026).
 *
 * O que fazia no sistema do Dr. Marcello: trocava "assim que a consulta e
 * agendada" por "antes da consulta" nos textos de pagamento da Livance da
 * clinica DELE (filtrava pelo id da clinica dele).
 *
 * Por que nao vale aqui: e o texto de pagamento do consultorio do Dr.
 * Marcello. Num banco novo o filtro pelo id ja nao acharia nada; os dados dele
 * so nao tem por que viajar neste projeto.
 *
 * Esta migration ainda nao tinha sido aplicada no banco do Dr. Fabio, entao
 * foi esvaziada aqui mesmo. O arquivo fica para a lista de migrations
 * continuar igual a do sistema de origem; o original esta no repositorio do
 * Dr. Marcello.
 */

commit;
