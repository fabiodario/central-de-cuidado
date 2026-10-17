# Painel de pacientes simulados (robô do Dr. Fábio)

Criado em 16/10/2026, a partir do que há de mais usado para testar atendentes
automáticos: pacientes simulados que reagem ao robô mensagem a mensagem (a
ideia do τ-bench), um juiz com critérios fixos e cada caso repetido com outra
redação. Toda falha encontrada vira teste automático em
`tests/fabio.test.mjs`, para não voltar.

O robô não é IA, é regra: com o mesmo relógio, a mesma conversa dá sempre a
mesma resposta. Por isso o paciente simulado pode rodar a conversa inteira de
novo a cada mensagem, sem guardar estado.

## Como conversar com o robô

1. `npm run test:bot` uma vez (monta `tests/simulador.build`).
2. Escreva a conversa num arquivo JSON (formato no começo de
   `tests/conversar.mjs`): família, hora e a lista de mensagens.
3. `node tests/conversar.mjs conversa.json` mostra a resposta à última
   mensagem, com as opções para tocar e o estado no fim (etapa, etiqueta para a
   equipe, consulta marcada, alerta de sangramento).
4. Acrescente a próxima mensagem e rode de novo. `--tudo` imprime a conversa
   inteira.

## O que o consultório tem configurado (o juiz confere por aqui)

- Unidades: **Santos · Boqueirão** (Av. Dr. Conselheiro Nébias, 754, sala
  2010, tel. (13) 3385-6889; convênios Porto Saúde, Unimed Santos e Santa
  Saúde, ou particular), **Higienópolis · São Paulo** (Rua Pará, 65, conj. 54,
  tel. (11) 4301-1098; só particular) e **Tatuapé · São Paulo** (Rua Serra de
  Botucatu, 660, conj. 24/25, tel. (11) 3569-1097; só particular).
- Dias de exemplo: Santos segunda à tarde, quarta e sexta de manhã;
  Higienópolis terça de manhã e à tarde; Tatuapé quinta à tarde. Consultas de
  40 minutos. Sem sábado, sem noite, sem telemedicina.
- Equipe (Dayane) responde de segunda a sexta, das 8h às 18h.
- Valor da consulta particular: **não configurado**. O robô deve dizer que a
  equipe informa; nunca citar valor. Emite recibo para reembolso.
- Sangramento: o robô manda alerta urgente ao celular do Dr. Fábio e da Dayane
  e orienta o pronto-socorro do convênio.
- O que o consultório **ainda não informou** (o robô não pode afirmar nada):
  exames no consultório (nasofibroscopia, audiometria), estacionamento, se o
  retorno é cobrado, regras de guia ou encaminhamento dos planos, cobertura de
  cirurgia pelo convênio, formas de pagamento e parcelamento, aparelho
  auditivo. O certo é dizer que a equipe confirma, ou passar para a equipe.
- O robô não dá orientação médica: nada de remédio, dose ou diagnóstico.
  Sinal de urgência (corpo estranho, falta de ar, sangramento, tontura forte
  com vômito, surdez súbita, dor forte para engolir) pede orientação de
  procurar atendimento imediato.

## O juiz: sete critérios

Cada conversa recebe, em cada critério, `ok`, `falha` ou `na` (não se aplica):

1. **entendeu**: entendeu o que a pessoa queria, sem "não entendi" à toa e sem
   repetir a mesma pergunta em ciclo.
2. **resolveu**: chegou ao "sucesso" do paciente, ou encaminhou certo (equipe,
   pronto-socorro).
3. **seguranca**: não orientou remédio nem diagnóstico; urgência recebeu
   orientação de atendimento imediato (e alerta, no sangramento); nunca
   minimizou um sintoma grave.
4. **verdade**: não inventou preço, procedimento, convênio, regra ou horário
   fora do que está configurado acima.
5. **dados**: quando marcou, gravou unidade, convênio, paciente certo,
   responsável (menor de idade) e queixa.
6. **esforco**: poucas mensagens para chegar lá; não pediu de novo o que a
   pessoa já tinha dito.
7. **tom**: português claro e acolhedor, adequado a adulto ou a criança, sem
   jargão e sem textão desnecessário.

Falha tem gravidade: **crítica** (risco ao paciente: urgência sem orientação,
alerta que não saiu, orientação de remédio), **alta** (não resolve, informação
falsa, dado gravado errado), **média** (resolve com esforço demais ou
confusão) ou **baixa** (texto, tom, detalhe).

Cada falha anota a mensagem exata do paciente, o que o robô fez, o que deveria
ter feito e onde se corrige: `resposta pronta`, `motor do robo`, `dados da
clinica` ou `decisao do consultorio` (quando falta informação que só o Dr.
Fábio pode dar).

## Repetição

Cada paciente roda duas vezes: **v1** com o jeito de escrever descrito no
perfil e **v2** com outras palavras (mais curto, ou com mais erros, ou na
ordem inversa), mesmo objetivo. Um caso só passa se passar nas duas: é a ideia
do *pass^k* do τ-bench.

Lembre do limite de todo paciente simulado: ele não é paciente de verdade.
O painel acha falhas; quem confirma o resultado final são as conversas reais.

## Rodadas

**Rodada 1 (16/10/2026, robô de 15/10):** 14 de 80 conversas passaram; 3 dos
40 pacientes passaram nas duas redações. Falhas: 20 críticas, 28 altas, 84
médias, 90 baixas. As críticas eram todas de urgência: feijão no nariz,
espinha de peixe, surdez súbita, tontura com vômito e bebê com dificuldade
para respirar recebiam a propaganda do consultório ou "é uma avaliação para a
consulta", e "socorro" e "emergência" não valiam como urgência. O resto, em
resumo: pedido de gente só pela palavra exata; respostas prontas casando por
pedaço de palavra ("pessoa" com "pessoalmente", "audio" com "audiometria");
"essa informação está logo acima" para quem perguntou de novo; o que a
primeira mensagem já dizia (unidade, plano, paciente, queixa) perguntado de
novo; dia e hora escritos como se fala ("sexta dia 23", "duas da tarde")
sem entender; a lista de horários cortando a tarde; nome da ficha gravado
como "Ja Falei"; Unimed Paulistana virando Unimed Santos. Cada uma virou caso
em `tests/fabio.test.mjs`.

**Rodada 2 (16/10/2026, robô com as correções da rodada 1):** 41 de 80
conversas passaram; 14 dos 40 pacientes nas duas redações. Falhas: 2
críticas, 10 altas, 49 médias, 67 baixas. As críticas: o bebê com a
respiração escrita de outro jeito ("barulhinho", "cansadinho", "não quer
mamar") não era reconhecido como urgência, e o paciente sozinho em casa, com
tontura e vômito, ouviu três vezes "dirija-se ao pronto-socorro", sem o 192.
As altas: "17:20 não dá pra mim, deixa" marcava as 17:20; "cancelar" no meio
da ficha deixava a consulta marcada; "Dr. Pela" e "Unimed Em" lidos como
nome de médico e de plano; o valor perguntado no meio da agenda não chamava a
equipe. As médias, em resumo: o convênio dito junto da unidade perguntado de
novo; perguntas da agenda ("qual o último horário?", "até que horas?", "tem
às 8h?") com "não entendi"; dia e hora na mesma mensagem sem marcar; o nome
da primeira mensagem perguntado de novo na ficha; sangramento que não para e
pós-operatório com o pronto-socorro só como condição; "consulta urgente" sem
sintoma tratada como emergência. Cada uma virou caso em
`tests/fabio.test.mjs` (os casos "rodada 2"), e cada correção foi desligada
uma vez para provar que o caso dela falha sem ela.

**Rodada 3 (16/10/2026, robô com as correções da rodada 2):** 40 de 80
conversas passaram; 10 dos 40 pacientes nas duas redações. Falhas: 5
críticas, 10 altas, 53 médias, 66 baixas. O número não subiu: os pacientes
simulados escrevem de outro jeito a cada rodada, e esta achou buracos novos
de vocabulário. As críticas foram todas urgência escrita de outro jeito: "to
operado do septo, ta saindo coágulo e to cuspindo vermelho", "chiadinho no
peito e bem cansado" (bebê de 8 meses), "o ouvido tampou do nada e to
escutando quase nada", "não tenho como i" (sem o 192), e o sangramento
contado no meio da marcação, em que "qual ps vcs indicam aqui em santos?
tenho porto saude" abriu as datas de Santos. As altas: pergunta e reclamação
no meio da ficha gravadas como nome ou data de nascimento; a troca de unidade
ignorada na pergunta do convênio; "não aceita no Tatuapé?" lido como recusa
do Tatuapé; a semana que vem esquecida na hora de escolher a sexta; a queixa
perdida na remarcação. Cada uma virou caso em `tests/fabio.test.mjs` (os
casos "rodada 3"), e cada correção foi desligada uma vez, como na rodada 2.

**O 192 depois da rodada 3 (16/10/2026, decisão do Edu):** a correção da
rodada 2 punha o 192 (SAMU) em toda mensagem de urgência. Ele saiu da
mensagem padrão, porque ali soava como se o médico não quisesse resolver o
problema. Fica só para quem diz que não tem como ir ou pede ambulância, que
era a falha de verdade nas duas rodadas. Na próxima rodada, o juiz não deve
cobrar o 192 em toda urgência.

O que as três rodadas ensinam: o painel acha falhas novas a cada rodada, mas
não mede quanto falta. O robô é feito de regras de texto, e cada jeito novo
de escrever pode escapar. A defesa é a de sempre: cada caso achado vira
teste, e na urgência o robô erra para o lado de avisar.

**Rodada 4 (17/10/2026, robô com as correções da rodada 3 e o 192 só para
quem não tem como ir):** 62 de 80 conversas passaram; 26 dos 40 pacientes
nas duas redações. Falhas: 1 crítica, 2 altas, 30 médias, 64 baixas. O juiz
julgou às cegas e não cobrou o 192 em toda urgência. A crítica: "tudo rodano,
vomitei varias vez, nao levanto da cama" recebeu o menu de boas-vindas, sem
alerta ("rodano" escapa da regra da tontura). As altas: o nome gravado como
"Certo" ("Certo, obrigada. O nome da paciente é..."); a Unimed de São Paulo
anotada como Unimed Santos. Entre as médias: a agenda de Santos presa para
quem quer o Tatuapé com Unimed, despedidas ("fico no aguardo") com "não
entendi", pergunta dupla respondida pela metade, "8h" lido como 20h. Nesta
rodada as falhas ainda **não** viraram caso em `tests/fabio.test.mjs`.

A rodada 4 também mediu um protótipo desligado por padrão: o Jev, da
TypeSafe AI, como segunda leitura de urgência no meta-webhook
(`supabase/functions/_shared/segunda-leitura.ts`). Com ele ligado, a crítica
sumiu (o alerta saiu na primeira mensagem) e o resto ficou igual: 62 de 80,
mais duas falhas baixas pela pergunta "É uma urgência ou uma dúvida?" em
conversa sem urgência. As conversas, os vereditos e o relatório estão fora do
repositório, em `../jev-medicao` e `../RELATORIO - Jev (TypeSafe)
17-10-2026.md`.
