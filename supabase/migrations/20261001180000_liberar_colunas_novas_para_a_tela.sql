begin;

/**
 * Libera para a tela as duas colunas novas de 01/10/2026.
 *
 * Neste banco o navegador (role authenticated) so altera colunas liberadas
 * uma a uma - profiles, por exemplo, so tinha full_name. As migrations
 * 20261001120000 (foto da equipe) e 20261001160000 (Destravar) criaram
 * colunas que a TELA grava, e esqueceram o grant: o Edu trocou a foto e
 * recebeu "permission denied for table profiles" - a foto subiu, o perfil nao
 * guardou. O Destravar teria o mesmo defeito, calado (o update da hora e
 * separado e so avisa no log).
 *
 * As politicas de RLS continuam valendo: cada um so altera o proprio perfil,
 * e so conversa da propria clinica.
 */

grant update (avatar_path) on table public.profiles to authenticated;
grant update (robo_liberado_em) on table public.whatsapp_conversations to authenticated;

commit;
