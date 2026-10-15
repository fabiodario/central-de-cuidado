begin;

/**
 * Sao Paulo tambem paga pelo link da Livance: SEM EFEITO NO BANCO DO DR.
 * FABIO (15/10/2026).
 *
 * O que fazia no sistema do Dr. Marcello: trocava "pix ou dinheiro" pelo link
 * de pagamento da Livance no texto da unidade de Sao Paulo e na resposta de
 * valores da clinica DELE (filtrava pelo id da clinica dele).
 *
 * Por que nao vale aqui: e a forma de pagamento do consultorio do Dr.
 * Marcello, num predio que o Dr. Fabio nao usa. Num banco novo o filtro pelo
 * id ja nao acharia nada; os dados dele so nao tem por que viajar neste
 * projeto.
 *
 * Esta migration ainda nao tinha sido aplicada no banco do Dr. Fabio, entao
 * foi esvaziada aqui mesmo. O arquivo fica para a lista de migrations
 * continuar igual a do sistema de origem; o original esta no repositorio do
 * Dr. Marcello.
 */

commit;
