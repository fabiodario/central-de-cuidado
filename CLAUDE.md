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
escrita de um jeito que a regra ainda não lia. O painel acha falhas novas a
cada rodada, mas não mede quanto falta. Rode de novo depois de mudança grande
no robô; o resultado de cada rodada fica anotado no README do painel.

Resposta pronta pode **chamar a equipe** (`bot_answers.hand_off`, desde
16/10/2026): o robô responde e acende a conversa para a equipe, sem tirar a
pessoa do menu. É o caminho para o que o consultório ainda não informou
(estacionamento, exames, guia, retorno, valor). Quando a resposta mudar em
`src/simulador/dados.ts`, `node scripts/respostas-prontas-sql.mjs` gera o SQL
que leva a mudança ao banco da clínica.

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

## node_modules fica fora do OneDrive

A pasta `node_modules` do projeto é uma junção para
`%LOCALAPPDATA%\fabio-dario-sistema\node_modules`: são 27 mil arquivos que o
OneDrive não precisa sincronizar, e o npm falha quando o OneDrive trava um
deles. Os `.bat` recriam a junção em outro computador. Não troque por uma pasta
comum.

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
