-- Um nome so para cada unidade, igual ao do site: SEM EFEITO NO BANCO DO DR.
-- FABIO (15/10/2026).
--
-- O que fazia no sistema do Dr. Marcello: padronizava a grafia das unidades
-- DELE ("Liferty · Santos", "Livance · Santo Andre", "Livance · Vila Mariana")
-- na agenda, no cadastro dos pacientes e no prontuario, que apareciam escritas
-- de tres jeitos.
--
-- Por que nao vale aqui: sao os nomes das unidades da clinica do Dr. Marcello.
-- As do Dr. Fabio (Santos, Higienopolis, Tatuape) nascem com um nome so. Num
-- banco novo os updates nao achariam nada; os dados dele so nao tem por que
-- viajar neste projeto.
--
-- Esta migration ainda nao tinha sido aplicada no banco do Dr. Fabio, entao
-- foi esvaziada aqui mesmo. O arquivo fica para a lista de migrations
-- continuar igual a do sistema de origem; o original esta no repositorio do
-- Dr. Marcello.

select 1;
