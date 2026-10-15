begin;

/**
 * Santos muda da Liferty para a Livance: SEM EFEITO NO BANCO DO DR. FABIO
 * (15/10/2026).
 *
 * O que fazia no sistema do Dr. Marcello: criava a unidade "Livance · Santos"
 * (endereco, texto, agenda e bloqueios copiados da Liferty), trocava os
 * enderecos nas respostas prontas, criava a tarefa
 * private.mudar_santos_para_livance e a agendava no pg_cron ate a virada de
 * 01/10/2026.
 *
 * Por que nao vale aqui: e a mudanca de endereco da clinica DELE. O Dr. Fabio
 * nao tem Liferty nem Livance. Num banco novo os updates nao achariam nada,
 * mas a tarefa e o job do cron seriam criados do mesmo jeito, e a conferencia
 * do fim gritaria no log do deploy por uma unidade que nunca existiu aqui.
 * Entao nada e criado.
 *
 * Esta migration ainda nao tinha sido aplicada no banco do Dr. Fabio, entao
 * foi esvaziada aqui mesmo. O arquivo fica para a lista de migrations
 * continuar igual a do sistema de origem; o original esta no repositorio do
 * Dr. Marcello.
 */

commit;
