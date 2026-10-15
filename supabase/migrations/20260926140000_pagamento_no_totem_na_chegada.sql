begin;

/**
 * Pagamento no totem da Livance Santos, na chegada: SEM EFEITO NO BANCO DO DR.
 * FABIO (15/10/2026).
 *
 * O que fazia no sistema do Dr. Marcello: corrigia, por replace() da frase
 * exata, o texto da unidade Livance · Santos que 20260926120000 escreveu
 * (pagamento no totem ao chegar, e nao depois da consulta), e avisava no log
 * se algum texto ainda dissesse "depois da consulta".
 *
 * Por que nao vale aqui: e texto da unidade DELE, que neste banco nunca
 * existiu (20260926120000 tambem ficou sem efeito). A conferencia ainda
 * poderia acusar, sem motivo, um texto do Dr. Fabio que falasse em "depois da
 * consulta" - por exemplo o retorno.
 *
 * Esta migration ainda nao tinha sido aplicada no banco do Dr. Fabio, entao
 * foi esvaziada aqui mesmo. O arquivo fica para a lista de migrations
 * continuar igual a do sistema de origem; o original esta no repositorio do
 * Dr. Marcello.
 */

commit;
