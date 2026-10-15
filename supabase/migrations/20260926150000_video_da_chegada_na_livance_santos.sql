begin;

/**
 * Video da chegada na Livance Santos nas respostas do robo: SEM EFEITO NO
 * BANCO DO DR. FABIO (15/10/2026).
 *
 * O que fazia no sistema do Dr. Marcello: acrescentava o link de um reel do
 * Instagram da Livance (totem, check-in, chamada na sala de espera) ao texto
 * da unidade Livance · Santos e a resposta de endereco, e avisava no log se
 * nao coubesse.
 *
 * Por que nao vale aqui: e o predio da clinica DELE. Neste banco a unidade
 * nunca existiu (20260926120000 tambem ficou sem efeito), e a conferencia do
 * fim gritaria no log do deploy a toa.
 *
 * Esta migration ainda nao tinha sido aplicada no banco do Dr. Fabio, entao
 * foi esvaziada aqui mesmo. O arquivo fica para a lista de migrations
 * continuar igual a do sistema de origem; o original esta no repositorio do
 * Dr. Marcello.
 */

commit;
