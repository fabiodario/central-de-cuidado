// SQL que leva as respostas prontas do simulador (src/simulador/dados.ts) para
// o banco da clinica (16/10/2026).
//
// A clinica do Dr. Fabio foi carregada em 15/10/2026 com as respostas do
// simulador. Quando elas mudam (o painel de pacientes simulados de 16/10 mudou
// palavras, textos e criou assuntos), o banco precisa acompanhar: e dele que o
// robo de verdade le.
//
// Atualiza pelo assunto (subject) o que ja existe e cria o que falta. Nao
// apaga nada: resposta que a clinica criou pela tela, com outro assunto,
// continua como esta. Precisa da coluna hand_off (migration
// 20261016120000_resposta_pronta_chama_a_equipe), entao rode depois da
// publicacao que aplica a migration.
//
// Como usar, depois de "npm run test:bot" (que monta tests/simulador.build):
//   node scripts/respostas-prontas-sql.mjs > respostas.sql
// e cole o conteudo no SQL Editor do Supabase do Dr. Fabio.
import { IDENTIDADES } from '../tests/simulador.build/dados.mjs'

const identidade = IDENTIDADES.fabio
const texto = (valor) => `'${String(valor).replace(/'/g, "''")}'`
const lista = (palavras) => `array[${palavras.map(texto).join(', ')}]::text[]`

const linhas = identidade.respostas.map(
  (r) =>
    `    (${texto(r.subject)}, ${lista(r.keywords)}, ${texto(r.answer)}, ${r.ask_unit ? 'true' : 'false'}, ` +
    `${r.hand_off ? 'true' : 'false'}, ${Number(r.position)})`,
)

const clinica = texto(identidade.clinicId)
console.log(`-- Respostas prontas do simulador para a clinica ${identidade.rotulo}.
-- Gerado por scripts/respostas-prontas-sql.mjs. Atualiza pelo assunto e cria
-- o que falta; nao apaga nada.
begin;

with novas(subject, keywords, answer, ask_unit, hand_off, position) as (
  values
${linhas.join(',\n')}
),
atualizadas as (
  update public.bot_answers b
     set keywords = n.keywords,
         answer = n.answer,
         ask_unit = n.ask_unit,
         hand_off = n.hand_off,
         position = n.position,
         is_active = true
    from novas n
   where b.clinic_id = ${clinica}
     and b.subject = n.subject
  returning b.subject
)
insert into public.bot_answers (clinic_id, subject, keywords, answer, ask_unit, hand_off, position, is_active)
select ${clinica}, n.subject, n.keywords, n.answer, n.ask_unit, n.hand_off, n.position, true
  from novas n
 where not exists (
   select 1 from public.bot_answers b where b.clinic_id = ${clinica} and b.subject = n.subject
 );

commit;

-- Conferir:
-- select position, subject, ask_unit, hand_off, is_active, array_length(keywords, 1) as palavras
--   from public.bot_answers where clinic_id = ${clinica} order by position;`)
