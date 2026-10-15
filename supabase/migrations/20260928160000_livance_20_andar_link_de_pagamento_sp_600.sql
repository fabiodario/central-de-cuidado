begin;

/**
 * Livance: andar, link de pagamento e valor de Sao Paulo: SEM EFEITO NO BANCO
 * DO DR. FABIO (15/10/2026).
 *
 * O que fazia no sistema do Dr. Marcello: corrigia o andar da Livance, trocava
 * o pagamento no totem pelo link que a Livance envia e subia o valor de Sao
 * Paulo, nos textos das unidades, nas respostas prontas e no perfil do
 * WhatsApp da clinica DELE (filtrava pelo id da clinica dele).
 *
 * Por que nao vale aqui: sao andar, pagamento e preco do consultorio do Dr.
 * Marcello. Num banco novo o filtro pelo id ja nao acharia nada, mas os
 * dados dele nao tem por que viajar neste projeto, e a conferencia do fim
 * olharia uma clinica que nao existe aqui.
 *
 * Esta migration ainda nao tinha sido aplicada no banco do Dr. Fabio, entao
 * foi esvaziada aqui mesmo. O arquivo fica para a lista de migrations
 * continuar igual a do sistema de origem; o original esta no repositorio do
 * Dr. Marcello.
 */

commit;
