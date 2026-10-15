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
`atendimento.ts`: as diferenças são só os pontos do perfil.

## Simulador (reuniões)

`src/simulador`: o robô de verdade com banco falso no navegador. Identidade em
`dados.ts`, roteiros em `roteiros.ts`. Sem banco configurado ele abre sem
login.

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
`tests/fabio.test.mjs`, que cobre o que é só dele (sangramento, convênios,
ficha de adulto e criança). Nenhum roteiro pode mostrar texto do Dr. Marcello
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
