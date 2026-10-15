begin;

/**
 * Gatilho manual do aviso da mudanca de Santos: SEM EFEITO NO BANCO DO DR.
 * FABIO (15/10/2026).
 *
 * O que fazia no sistema do Dr. Marcello: criava
 * private.disparar_aviso_mudanca_santos(p_simular), chamada a mao no editor
 * SQL para disparar a Edge Function aviso-mudanca-santos - um envio unico, as
 * familias dele, avisando que o atendimento em Santos ia da Liferty para a
 * Livance em 01/10/2026. A URL do projeto Supabase DELE estava escrita aqui.
 *
 * Por que nao vale aqui: nao ha mudanca de Santos a avisar, e a funcao, se
 * existisse neste banco, mandaria o aviso de outra clinica aos pacientes do
 * Dr. Fabio. Entao o gatilho nao e criado. A Edge Function
 * aviso-mudanca-santos nao esta na lista do deploy-pages.yml e nao deve ser
 * publicada neste projeto.
 *
 * Esta migration ainda nao tinha sido aplicada no banco do Dr. Fabio, entao
 * foi esvaziada aqui mesmo. O arquivo fica para a lista de migrations
 * continuar igual a do sistema de origem; o original esta no repositorio do
 * Dr. Marcello.
 */

commit;
