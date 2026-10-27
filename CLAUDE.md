# Central de Cuidado: consultório Dr. Fábio Dario (otorrino)

Espelho, feito em 15/10/2026, do sistema do Dr. Marcello Ruiz
(`C:\Users\Edu\Desktop\dr marcelo\sistema-followup`, gastropediatria, **em
produção com pacientes reais**), adaptado ao consultório do Dr. Fábio Dario:
otorrinolaringologista, unidades em Santos (Boqueirão), Higienópolis e Tatuapé,
secretária Dayane.

**Este sistema ainda NÃO está em produção.** Desde 15/10/2026 tem repositório
público (`fabiodario/central-de-cuidado`, publicado no GitHub Pages pelo
Actions) e projeto Supabase (`fabiodario`, ref `dqqksiycsgdrunultysd`, São
Paulo), mas ainda não tem número de WhatsApp (Meta) nem pacientes. O que se
usa hoje é o simulador do robô, nas reuniões. O documento de passagem com o
que falta está em `../LEIA-ME - Projeto Dr Fabio Dario.md`.

**O repositório é público.** Nada de dado de paciente de verdade em código,
comentário ou teste: os casos herdados do Dr. Marcello foram trocados por nomes
inventados antes do primeiro envio. Caso novo vira comentário sem o nome.

Stack: React 19 + TypeScript + Vite + Tailwind no navegador; Supabase (Postgres
com RLS forçada, Edge Functions em Deno, Storage) no servidor.

## Nunca encostar no sistema do Dr. Marcello

O código veio do repositório dele, e várias coisas apontavam para a produção
dele. Já foi neutralizado, e precisa continuar assim:

- `PUBLICAR.bat` publica em `fabiodario/central-de-cuidado` e recusa o
  repositório do Dr. Marcello.
- `.github/workflows` lê o projeto Supabase de variáveis do repositório
  (`SUPABASE_PROJECT_REF`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`) e para se
  apontarem para o banco do Dr. Marcello.
- Essas travas são o único lugar do projeto com o nome do repositório e o ref
  do banco dele. Se um grep achar o ref, o domínio ou o e-mail dele em outro
  arquivo, é defeito.
- Não existe `.env.local`. Quando o banco do Dr. Fábio existir, ele entra aqui,
  e nunca a URL ou a chave do Dr. Marcello.
- As migrations herdadas foram limpas em 15/10/2026, antes do primeiro
  `db push` no banco do Dr. Fábio. O cron monta o endereço das Edge Functions
  com `private.url_da_funcao`, que lê a `project_url` do Vault: **nunca
  escreva a URL de um projeto Supabase numa migration.** O que era dado só da
  clínica do Dr. Marcello (Livance, Liferty, Trasmontano, textos, preços,
  telefones, nome e CRM) virou migration sem efeito, com o motivo no
  cabeçalho. Migration nova portada do sistema dele: conferir antes se traz
  URL, id de clínica ou texto dele.
- O que o Dr. Fábio ainda não tem (domínio, e-mail) está como `PREENCHER-...`.
  Um grep por `PREENCHER` mostra tudo; a lista explicada está no LEIA-ME.

## O robô: um motor, dois perfis

`supabase/functions/_shared/atendimento.ts` é o mesmo motor do Dr. Marcello. O
que muda de clínica para clínica fica em `_shared/quem-atende.ts`:

- `publico: 'geral'` (Dr. Fábio): fala com o próprio paciente, adulto ou
  criança; a ficha pergunta o motivo da consulta e só pede o responsável para
  menor de idade; vários convênios por unidade.
- `alertaDeSangramento`: pedido do Dr. Fábio. Qualquer menção a sangramento
  acende a conversa com `sangramento` e manda notificação urgente para o
  celular dele e da Dayane (`_shared/aviso-da-equipe.ts`).
- O perfil `pediatria` (Dr. Marcello) só existe para a clínica `c1` dos testes
  do motor. **O padrão deste sistema é o Dr. Fábio.**

Ao portar correções do robô do Dr. Marcello para cá, compare os dois
`atendimento.ts`. Até 15/10/2026 as diferenças eram só os pontos do perfil;
desde 16/10/2026 o motor daqui tem também as correções do painel de pacientes
simulados (abaixo), que o do Dr. Marcello não tem. Elas estão marcadas nos
comentários com "16/10/2026, painel": um grep acha todas.

Mais três pontos do perfil, de 16/10/2026: `sinaisDeAlarme` (corpo estranho,
falta de ar, surdez súbita, tontura forte com vômito, não conseguir engolir,
rosto torto: pronto-socorro na hora e conversa acesa como urgência),
`equipe` (o nome da Dayane na mensagem é pedido de gente) e `nomesDoMedico`
(outro médico citado ouve que este é outro consultório).

## Painel de pacientes simulados (tests/painel)

Desde 16/10/2026: 40 pacientes (`tests/painel/pacientes.json`), cada um em
duas redações, conversam com o robô de verdade por `tests/conversar.mjs`, e um
juiz confere sete critérios (`tests/painel/README.md`). Toda falha achada vira
caso em `tests/fabio.test.mjs`, e a correção é desligada uma vez para provar
que o caso falha sem ela. Rodadas de 16/10/2026: 14, 41 e 40 de 80 conversas
passaram; as falhas críticas foram de 20 para 2 e depois 5, todas de urgência
escrita de um jeito que a regra ainda não lia. Rodada 5 (25/10/2026): 52 de
80, e desde ela `conversar.mjs` mostra o alerta no WhatsApp do Dr. Fábio e da
Dayane, que o juiz confere (saiu nas 14 urgências, nenhum alarme falso). O
painel acha falhas novas a cada rodada, mas não mede quanto falta. Rode de
novo depois de mudança grande no robô; o resultado de cada rodada fica
anotado no README do painel.

Resposta pronta pode **chamar a equipe** (`bot_answers.hand_off`, desde
16/10/2026): o robô responde e acende a conversa para a equipe, sem tirar a
pessoa do menu. É o caminho para o que o consultório ainda não informou
(estacionamento, exames, guia, retorno, valor). Quando a resposta mudar em
`src/simulador/dados.ts`, `node scripts/respostas-prontas-sql.mjs` gera o SQL
que leva a mudança ao banco da clínica.

## Segunda leitura pelo Jev (TypeSafe AI)

Desde 17/10/2026 o robô pode pedir ao Jev, da TypeSafe AI, uma nota de
urgência para cada mensagem escrita (`_shared/segunda-leitura.ts`, chamado no
`meta-webhook`). O Jev só acrescenta cuidado: a partir de 0,2 manda a pergunta
Urgência ou Dúvida, a partir de 0,5 acende a urgência. Nunca tira urgência da
regra, nunca muda a resposta, nunca marca consulta, e qualquer falha deixa o
robô como sempre.

- O modo (desligado, só observar, ligado) fica em Preferências
  (`clinic_settings.jev_segunda_leitura`, só o responsável muda). A chave fica
  só nos segredos das Edge Functions (`TYPESAFE_API_KEY`), nunca no banco nem
  na tela. Ligado sem chave, cada leitura fica registrada como "falhou: sem
  chave", e Preferências mostra.
- No simulador de dentro do sistema (17/10/2026), o Jev também lê: o
  simulador pergunta pela função `jev-ler` (sessão obrigatória, só quem tem
  acesso ativo à clínica, desligado nem chama a TypeSafe), aplica a mesma
  `decidirSegundaLeitura` do webhook e mostra a nota em "O que aconteceu" e o
  selo "Jev ligado" no topo. O arquivo da reunião, sem login, segue sem o Jev.
- Os limiares foram medidos com a versão fixa `jev-1.13.0` e a pergunta
  palavra por palavra: mudar um dos dois pede medir de novo (`../jev-medicao`,
  fora do repositório).
- O texto do paciente vai para os Estados Unidos: está na política de
  privacidade (seção 4), com o OK do Dr. Fábio.
- Testes em `tests/segunda-leitura.test.mjs`, dentro do `npm run test:bot`.

## O Jev escolhendo o caminho (26/10/2026)

Pedido do Edu: o robô nunca travado. Quando a regra responde "Não entendi"
(evento `nao_entendi` ou o texto), o webhook pergunta ao Jev, numa chamada só,
o assunto (marcar, remarcar, cancelar, ver a consulta, valor, convênio,
endereço ou horário, documento, equipe, agradecimento, urgência, outro) e qual
opção da lista que está valendo a pessoa escolheu, ou nenhuma
(`_shared/caminho-pelo-jev.ts`). O Jev não responde nada ao paciente: o robô
roda de novo com o número da opção, ou com uma frase que a regra entende com
certeza naquela etapa (`rotaDoAssunto`), na conversa como estava antes do
"Não entendi" (`estadoParaSeguir`).

- Limiares medidos em `../jev-caminho` (fora do repositório): opção a partir
  de 0,5 segue, de 0,2 a 0,5 pergunta "Você quis dizer X?" com o botão Sim
  (id `JEV:opcao:N`); assunto a partir de 0,8 segue, de 0,5 a 0,8 pergunta
  (id `JEV:assunto:A`). Mudou a pergunta ou a versão `jev-1.13.0`, mede de novo.
- Valor, convênio, endereço e equipe respondem na etapa, sem desmanchar o
  agendamento; remarcar, cancelar, ver a consulta, documento e marcar vão pelo
  menu. Cancelar e remarcar sempre caem na confirmação do robô; no meio do
  agendamento, cancelar é desistir (`CANCELAR`) e remarcar na lista de
  horários é `VOLTAR`.
- Fica de fora: ficha (`dados_*`), fila da equipe, confirmação do
  cancelamento, conversa de urgência, toque e foto, e quando a segunda leitura
  já viu urgência. Liga e desliga junto com a segunda leitura; em "só observar"
  registra o que faria (`jev_caminho` em `whatsapp_bot_events`).
- O simulador faz o mesmo (`leitorDoCaminho`; no sistema, `jev-ler` com
  `acao: 'caminho'`). Testes em `tests/caminho-pelo-jev.test.mjs`.

## Consulta e retorno (26/10/2026, vindo do sistema do Dr. Marcello)

Toda consulta dá direito a UM retorno, no prazo que o médico define no
prontuário; o retorno não abre outro. A regra mora em
`supabase/functions/_shared/prazo-do-retorno.ts` e é a mesma no prontuário
(`ConsultaOuRetorno` em `PatientRecord.tsx`, ponte em
`src/lib/consulta-ou-retorno.ts`), no cabeçalho da conversa
(`PrazoDoRetorno`), na etiqueta da Agenda e no robô.

- `consultations.visita` ('consulta' ou 'retorno') e `retorno_ate` são
  administrativas: ficam fora da trava da consulta assinada e são gravadas em
  UPDATE separado (`gravarVisita`). Sem marcação, a classificação é deduzida
  pela sequência de visitas (prontuário e agenda que passou) e aparece como
  "sugerido"/"a confirmar". **O robô só usa o que o médico marcou.**
- No robô (`atendimento.ts`, bloco "Retorno incluido"): datas só até o prazo,
  "Retorno marcado!", data pedida depois do prazo explicada
  (`dataDepoisDoPrazo`, nos passos do dia e do horário), e na terceira
  explicação a equipe com a etiqueta `retorno` (`explicarOuPassarORetorno`).
  Telefone sem o paciente pedindo retorno: nome e nascimento ou CPF (estado
  `aguardando_crianca_do_retorno`, nome herdado do Dr. Marcello). **Diferença
  daqui:** essa busca só acontece depois que a clínica marcou a primeira
  consulta ou retorno no prontuário (`clinicaMarcaORetorno`), porque os
  pacientes de antes do sistema estão no ISA. Sem a regra da Trasmontano.
- Do mesmo dia: na fila, pedido de marcar abre a agenda e remarcar/cancelar
  mostra a consulta, com a equipe conversando ou não (fica de fora a frase
  comprida que não pede nada, `conversaDaEquipe`); `equipeSeguraORobo` em
  `lembrete.ts` (toque e pedido vencem a regra das 12 horas); resposta pronta
  sem mudança vai como automática; `_shared/meta-tentativa.ts` repete o envio
  no erro passageiro da Meta; a Agenda mostra o convênio
  (`src/lib/convenio-do-horario.ts`) com filtro.
- Testes: `tests/prazo-do-retorno.test.mjs`, `tests/consulta-ou-retorno.test.mjs`,
  `tests/meta-tentativa.test.mjs`, `tests/convenio-do-horario.test.mjs` e o
  bloco "Retorno incluido" de `tests/atendimento.test.mjs` (o caso aceita
  `clinicId` para rodar no perfil do Dr. Fábio).

## Coexistência: o número no app e na API (27/10/2026)

O número fixo do consultório vai para a API sem sair do app WhatsApp Business
dos aparelhos. `_shared/coexistencia.ts` trata os três avisos que a Meta manda
nesse caso, chamados no `meta-webhook` antes do filtro de `messages`:

- `history`: as conversas dos últimos 6 meses do app, uma vez. Entram com a
  data original e `origem = 'historico'`, ligadas ao paciente do telefone, sem
  robô, sem alerta e sem "novas". Foto e áudio vêm como `media_placeholder`;
  o arquivo, quando vem (só o das duas últimas semanas), chega num segundo
  `history` com `messages` e entra no lugar.
- `smb_message_echoes`: o que a equipe escreve pelo app. Entra como resposta
  da equipe (`automatic = false`, `origem = 'celular'`), e por isso segura o
  robô pelas 12 horas, como a resposta pela Central; a conversa fica como
  depois de uma resposta pelo `whatsapp-reply`.
- `smb_app_state_sync`: contatos da agenda do celular
  (`whatsapp_contatos_do_celular`). O nome vira `nome_personalizado` só da
  conversa sem cadastro que ninguém renomeou.
- `soNoCelular`: o `unsupported` com erro 131060 é ignorado (a mensagem de
  verdade chega em seguida, ou está no app). `account_update` com
  `PARTNER_REMOVED` vira erro no log.

O `external_message_id` (único) impede duplicar: a Meta repete aviso e manda
o histórico em pedaços fora de ordem. A coluna `origem` é lida e gravada à
parte (sem a migration, grava sem ela). A Central mostra "pelo celular" e "do
celular" no balão. Testes em `tests/coexistencia.test.mjs`. O que falta para
ligar (Tech Provider, Cadastro Incorporado, os dois pedidos `smb_app_data` em
24 horas) está no LEIA-ME, "Número do consultório na API (coexistência)".

## BirdID na Memed (27/10/2026)

O Dr. Fábio assina com o BirdID, que na Memed se chama `soluti`. A lista de
certificadoras que o sistema manda à Memed é `CERTIFICADORAS_DA_MEMED`
(`src/lib/sinais-da-memed.ts`); a do Dr. Marcello é só `vidaas`. Ao portar o
`memed.ts` de lá, não trazer a lista dele: `tests/sinais-da-memed.test.mjs`
confere. A assinatura do prontuário (`assinar-consulta`, BRy) segue com
VIDaaS e desligada sem licença.

## Veredito da urgência (17/10/2026)

Conversa acesa como urgência ou sangramento ganha, na tela de Respostas, os
botões "É urgente" e "Não é urgente", só para owner e clinician
(`VereditoDaUrgencia.tsx`). O `whatsapp-reply` (campo `veredito`) monta no
servidor o texto fixo em nome do médico (`_shared/veredito.ts`), manda ao
paciente, muda a conversa (urgente sai da lista; não urgente fica como
"atendente", na etapa da fila, com o botão "Marcar uma consulta") e registra
`veredito_urgencia` em `whatsapp_bot_events`, para comparar com a nota do Jev
e com a regra. O mesmo veredito vem também pelo WhatsApp do médico (abaixo). O paciente nunca espera o clique: a
orientação de segurança já saiu na hora. Os textos falam em nome do médico:
mudar a redação é decisão dele. Testes em `tests/veredito.test.mjs`; o
simulador tem os mesmos botões no painel da equipe.

## Alerta de urgência no WhatsApp do médico (17/10/2026)

Quando a conversa **entra** em urgência ou sangramento (`deveAlertar`), o
`meta-webhook` manda, a qualquer hora, um modelo aprovado da Meta para cada
número de `clinic_settings.alerta_urgencia_telefones` (Preferências; o
primeiro é o do médico), depois da resposta ao paciente e junto da
notificação do navegador, que continua. Envio em
`_shared/alerta-de-urgencia.ts`: modelo `alerta_urgencia_botoes`, com recuo
para `alerta_urgencia` enquanto o com botões não é aprovado; cada alerta
registrado antes em `alertas_de_urgencia`, com o id nos botões
(`URG:<id>:urgente|nao_urgente|responde`).

- A volta (`_shared/resposta-ao-alerta.ts`) roda no webhook **antes** do robô
  do paciente: toque nos botões, resposta citando o alerta ou texto até 6 h
  depois. "É urgente" e "Pode aguardar" são o mesmo veredito da tela de
  Respostas (`veredito.ts`: mesmo texto, mesma mudança na conversa, mesmo
  evento `veredito_urgencia`). Só o primeiro número classifica; vale o
  primeiro veredito (update condicional), pelo WhatsApp ou pela tela
  (`marcarVereditoDaTela` no `whatsapp-reply`); texto livre só vai depois do
  "Enviar"; envio que não chega desfaz a marca.
- Falha grita: todo envio e toda resposta viram nota na conversa e evento.
- Os textos dos modelos estão em `_shared/modelos.ts` e no LEIA-ME (que o
  teste confere); mudou na Meta, muda nos dois.
- O simulador usa as mesmas peças, com a Meta de mentira (`peloWhatsApp` em
  `sessao.ts`): o cartão "WhatsApp do Dr. Fábio Dario" mostra o alerta e deixa
  tocar nos botões e responder como ele.
- **O arquivo do paciente vai junto** (25/10/2026, técnica do sistema do
  Dr. Marcello): foto, áudio, vídeo ou documento logo atrás do alerta; o que
  chega depois, com o alerta aberto (`alertaEmAberto`), vai sozinho; no
  repasse depois do "Eu respondo" e no "Mandar para o celular" também. Fora
  da janela de 24 horas da Meta o arquivo fica pendente (`anexos_para_equipe`)
  e vai quando aquele celular escrever. Arquivo de conversa comum fica só na
  Central. Ver `_shared/anexo-para-equipe.ts` e `_shared/anexos-pendentes.ts`.
- Testes em `tests/alerta-de-urgencia.test.mjs`,
  `tests/resposta-ao-alerta.test.mjs`, `tests/anexo-para-equipe.test.mjs` e
  `tests/anexos-pendentes.test.mjs`. Para provar que um caso pega o defeito
  sem mexer no código, `DESLIGAR` (ver `tests/montar-para-teste.mjs`) troca um
  trecho na hora de montar.

## RESET de teste (25/10/2026, TEMPORÁRIO)

No número de teste, quem está na lista de teste (`whatsapp_telefones_teste`)
escreve só RESET e recomeça do zero: consultas futuras desse telefone
canceladas, conversa zerada, alertas das últimas 24 horas apagados e o
cadastro do telefone apagado com o que é dele (arquivado, se tiver adendo de
prontuário, que o banco não deixa apagar) (ver
`_shared/reset-de-teste.ts`). É lido no `meta-webhook` antes da resposta ao
alerta e para antes do robô. Com a lista nula (clínica de verdade) não faz
nada, mas **sai antes do número oficial**: o arquivo, o `ehReset` do webhook e
`tests/reset-de-teste.test.mjs`. Pedido do Edu.

## Simulador (reuniões)

`src/simulador`: o robô de verdade com banco falso no navegador. Identidade em
`dados.ts`, roteiros em `roteiros.ts`. Sem banco configurado ele abre sem
login.

- **Dentro do sistema** (16/10/2026): o cartão "Simulador do robô", no topo de
  Respostas (`src/sections/SimuladorNasRespostas.tsx`), abre
  `simuladorbot/?no-sistema` num quadro, com a sessão do sistema. Com login,
  o simulador lê a configuração de verdade da clínica (`ler-clinica.ts` +
  `da-clinica.ts`): unidades, horários, exceções, saudação e respostas
  prontas. "Ler a clínica de novo" recarrega depois de uma mudança. Abre para
  quem tem acesso ativo a uma clínica. Pacientes e consultas nunca são lidos,
  e nada é gravado.
- Os dados de `dados.ts` precisam caber nas regras do banco (máximo de 40
  palavras por resposta pronta, tamanhos de texto): a clínica real foi
  carregada com eles, e `tests/simulador.test.mjs` confere.

- `GERAR SIMULADOR.bat` (ou `npm run simulador:arquivo`): confere o robô e gera
  `SIMULADOR - Dr Fabio Dario.html`, arquivo único que abre com duplo clique,
  sem internet. Gerar de novo depois de qualquer mudança.
- `SIMULAR CONVERSAS.bat` (ou `npm run simular`): imprime todos os roteiros como
  texto, para **ler** antes da reunião.
- Dias, horários e valor da consulta são de EXEMPLO até o consultório
  confirmar. A aba Agenda do simulador edita na hora.

## Testes

`npm run test:bot` (ou `TESTAR BOT.bat`): o motor inteiro no perfil de origem
(~1.240 verificações), o simulador com os roteiros do Dr. Fábio e
`tests/fabio.test.mjs`, que cobre o que é só dele (sangramento, sinais de
alarme, convênios, ficha de adulto e criança) e cada falha do painel de
pacientes simulados. Nenhum roteiro pode mostrar texto do Dr. Marcello
nem chamar paciente adulto de "criança": o teste do simulador barra.

**Prove que o teste pega o defeito**: desligue a correção e confirme que ele
falha. Um teste que passa com o conserto desativado não testa nada.

## node_modules dentro do OneDrive (desde 17/10/2026)

Até 17/10/2026 a pasta `node_modules` era uma junção para
`%LOCALAPPDATA%\fabio-dario-sistema\node_modules`, para o OneDrive não
sincronizar 27 mil arquivos. Nesse dia, no primeiro PUBLICAR com dois cliques,
os programas abertos pelo Windows não atravessaram a junção ("'eslint' não é
reconhecido"), embora os comandos rodados pelo Claude atravessassem. O
`npm install` do PUBLICAR trocou a junção por uma pasta comum dentro do projeto
(200 MB), e o Edu decidiu deixar assim por enquanto: todos os projetos dele
ficam no OneDrive para abrir em qualquer computador.

- **Não recrie a junção:** ela quebra o PUBLICAR com dois cliques. Teste do
  jeito do Edu (dois cliques) antes de mexer nisso de novo.
- Se um `npm install` falhar com arquivo travado, pause o OneDrive e rode de
  novo.
- A cópia antiga em `%LOCALAPPDATA%\fabio-dario-sistema` ficou sem uso; apagar
  só com o OK do Edu.

## Regras herdadas do sistema do Dr. Marcello (continuam valendo)

- **Migration aplicada nunca se edita.** Correção vem em arquivo novo.
  `supabase db push` para na primeira que falha.
- **Coluna nova: o Postgres recusa a query inteira.** Coluna recém-criada é
  lida em consulta separada, dentro de try/catch.
- **Falha silenciosa é pior que falha barulhenta.** Se o caminho de erro é
  silencioso, faça-o gritar.
- **Comentários explicam o porquê**, com a data e o caso real. Em português,
  sem acento nos comentários de código.
- Texto para paciente e documentos: sem travessão nem meia-risca.
