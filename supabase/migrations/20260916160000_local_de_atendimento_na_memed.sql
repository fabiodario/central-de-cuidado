begin;

/**
 * O local de atendimento que a Memed imprime na receita.
 *
 * A Anvisa passou a exigir endereço, cidade e telefone do prescritor na
 * emissão, e a Memed abriu uma tela de Identificação pedindo isso a cada
 * receita. O sistema já mandava esses dados - só que com os nomes errados de
 * campo, então a Memed descartava tudo em silêncio e a tela continuava
 * aparecendo em branco.
 *
 * Duas colunas nascem aqui:
 *
 * CNES: a Memed passou a exigir o número do estabelecimento de saúde de quem
 * integra a partir de agora. Cada unidade tem o seu (a sala da Liferty em
 * Santos não é o mesmo estabelecimento da Livance em São Paulo), por isso a
 * coluna é da unidade e não da clínica. Fica vazia até a clínica levantar os
 * números; vazia, o sistema simplesmente não envia o campo.
 *
 * memed_cadastro_dados: a assinatura do que foi enviado da última vez para o
 * cadastro do médico na Memed. Antes havia só uma data de "já completei", e
 * com ela o envio nunca mais acontecia - foi assim que o telefone errado ficou
 * preso lá dentro, sendo recusado pela validação deles a cada receita. Com a
 * assinatura, mudou o telefone ou o e-mail em Preferências, o cadastro é
 * reenviado sozinho na próxima prescrição.
 */

alter table public.clinic_units
  add column if not exists cnes text not null default '';

comment on column public.clinic_units.cnes is
  'Cadastro Nacional de Estabelecimentos de Saude desta unidade. Vazio = nao enviado a Memed.';

alter table public.clinic_settings
  add column if not exists memed_cadastro_dados text;

comment on column public.clinic_settings.memed_cadastro_dados is
  'Assinatura do ultimo cadastro enviado a Memed. Diferente do atual = reenvia.';

-- clinic_units já tem grant de tabela inteira (select, insert, update, delete)
-- desde 20260824000100, e ele alcança colunas novas. Quem separa quem vê o quê
-- ali é a RLS por clínica, não o grant por coluna - ao contrário de
-- clinic_settings, onde cada campo editável precisa ser liberado um a um.

commit;
