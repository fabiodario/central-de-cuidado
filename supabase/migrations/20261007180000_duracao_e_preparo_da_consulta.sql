begin;

/**
 * Duracao e preparo na resposta "O que levar e como e a consulta": SEM EFEITO
 * NO BANCO DO DR. FABIO (15/10/2026).
 *
 * O que fazia no sistema do Dr. Marcello: acrescentava a resposta pronta da
 * clinica DELE (filtrava pelo id dela) que a consulta dura de 40 minutos a 1
 * hora e nao tem preparo, e avisava no log do deploy quando o trecho
 * esperado nao estava la.
 *
 * Por que nao vale aqui: duracao e preparo sao do consultorio do Dr. Marcello.
 * Num banco novo o filtro pelo id ja nao acharia nada - e por isso mesmo o
 * aviso de "editada na tela?" sairia em todo primeiro db push do Dr. Fabio,
 * sem querer dizer nada. Aviso que nao quer dizer nada ensina a ignorar os
 * que querem. A duracao do Dr. Fabio (consultas de 40 min, a confirmar) entra
 * nas respostas prontas dele.
 *
 * Esta migration ainda nao tinha sido aplicada no banco do Dr. Fabio, entao
 * foi esvaziada aqui mesmo. O arquivo fica para a lista de migrations
 * continuar igual a do sistema de origem; o original esta no repositorio do
 * Dr. Marcello.
 */

commit;
