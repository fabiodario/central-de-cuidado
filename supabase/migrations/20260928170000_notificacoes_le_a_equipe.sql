begin;

/**
 * O aviso no celular precisa ler quem e da equipe (28/09/2026).
 *
 * avisarEquipe (_shared/push-da-equipe.ts) so manda para quem ainda esta
 * ativo na clinica, e le isso de clinic_memberships pelo service role. O
 * service role nao tinha SELECT nessa tabela: a consulta voltava erro, o erro
 * nao era conferido, a lista de ativos saia vazia e a funcao desistia sem
 * escrever nada. As 10:21 e 10:28 de 28/09 duas familias pediram a equipe com
 * dois celulares inscritos, e nenhum aviso saiu - sem erro em lugar nenhum.
 *
 * So leitura. O codigo passa a gritar quando essa leitura falha.
 */

grant select on table public.clinic_memberships to service_role;

commit;
