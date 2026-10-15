begin;

/**
 * Permissao do servidor nas tabelas das notificacoes (28/09/2026).
 *
 * Neste projeto tabela nova NAO ganha permissao automatica para o service
 * role - as outras migrations dao grant explicito (whatsapp_bot_events,
 * whatsapp_webhook_events). A 20260928120000 esqueceu, e o primeiro toque em
 * "Ativar avisos" no celular voltou com "permission denied for table
 * push_chaves": a funcao notificar-equipe nao conseguia nem ler a chave.
 *
 * O webhook tambem ficaria mudo: avisarEquipe le push_inscricoes pelo service
 * role, recebia o mesmo erro e so escrevia um aviso no log.
 */

grant select, insert on table public.push_chaves to service_role;
grant select, insert, update, delete on table public.push_inscricoes to service_role;

commit;
