// Ligar e desligar o acompanhamento automatico em Preferencias (17/10/2026,
// pedido do Edu): a clinica desligada nao recebe nada do disparo das 9h, e as
// outras seguem como sempre. No "npm run test:bot".
// ACOMPANHAMENTO_TS aponta para outra copia do modulo (para provar que o teste
// pega o defeito com a trava desligada).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSync } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const AQUI = dirname(fileURLToPath(import.meta.url))
const fonte = process.env.ACOMPANHAMENTO_TS ?? join(AQUI, '..', 'supabase', 'functions', '_shared', 'disparo-do-acompanhamento.ts')
const saida = join(AQUI, 'disparo-do-acompanhamento.build.mjs')
buildSync({ entryPoints: [fonte], format: 'esm', outfile: saida, logLevel: 'warning' })
const { escolherParaEnviar } = await import(`${pathToFileURL(saida).href}?v=${Date.now()}`)
// Sem CR: o git no Windows grava CRLF, e os trechos procurados aqui sao com \n.
const ler = (...partes) => readFileSync(join(AQUI, '..', ...partes), 'utf8').replace(/\r\n/g, '\n')

let ok = 0
async function caso(nome, fn) {
  try {
    await fn()
    ok++
  } catch (erro) {
    console.error('FALHOU:', nome)
    throw erro
  }
}

const TRES_DIAS_ATRAS = '2026-10-14T12:00:00.000Z'
const vencido = (id, clinica, falhou = null) => ({ id, clinic_id: clinica, whatsapp_failed_at: falhou })

await caso('a clinica que desligou nao recebe nada do disparo; as outras seguem', () => {
  const vencidos = [vencido('a1', 'ligada'), vencido('d1', 'desligada'), vencido('a2', 'ligada'), vencido('d2', 'desligada')]
  const r = escolherParaEnviar(vencidos, { clinicasDesligadas: new Set(['desligada']), tresDiasAtras: TRES_DIAS_ATRAS })
  assert.deepEqual(r.enviar.map((v) => v.id), ['a1', 'a2'])
  assert.equal(r.desligados, 2, 'o resumo do disparo conta quantos ficaram de fora')
  const todas = escolherParaEnviar(vencidos, { clinicasDesligadas: new Set(), tresDiasAtras: TRES_DIAS_ATRAS })
  assert.equal(todas.enviar.length, 4, 'sem ninguem desligado, sai tudo, como antes')
  assert.equal(todas.desligados, 0)
})

await caso('recusado pela Meta ha menos de 3 dias espera; mais antigo tenta de novo (trava de 24/09/2026)', () => {
  const vencidos = [vencido('novo', 'c'), vencido('recente', 'c', '2026-10-16T09:00:00.000Z'), vencido('antigo', 'c', '2026-10-10T09:00:00.000Z')]
  const r = escolherParaEnviar(vencidos, { clinicasDesligadas: new Set(), tresDiasAtras: TRES_DIAS_ATRAS })
  assert.deepEqual(r.enviar.map((v) => v.id), ['novo', 'antigo'])
})

await caso('o disparo le quem desligou em consulta separada, e sem conseguir ler nao envia nada', () => {
  const disparo = ler('supabase', 'functions', 'whatsapp-dispatch', 'index.ts')
  assert.match(disparo, /\.select\('id,clinic_id,patient_id,followup_key,due_date,whatsapp_failed_at'\)/, 'a clinica de cada vencido')
  assert.match(disparo, /\.eq\('acompanhamento_automatico', false\)/)
  assert.match(disparo, /escolherParaEnviar\(vencidos \?\? \[\], \{ clinicasDesligadas, tresDiasAtras \}\)/)
  // Coluna nova so na consulta propria: na dos vencidos, derrubaria o disparo
  // inteiro enquanto a migration nao rodou.
  const consultaDosVencidos = disparo.slice(disparo.indexOf(".from('followups')"), disparo.indexOf('.limit(500)'))
  assert.doesNotMatch(consultaDosVencidos, /acompanhamento_automatico/)
  // Erro que nao e "coluna ainda nao existe" para o envio do dia.
  assert.match(disparo, /erroDaOpcao && erroDaOpcao\.code !== '42703'\) \{[\s\S]{0,200}return json\([\s\S]{0,160}, 500\)/)
})

await caso('o banco: ligado por padrao, e a tela pode gravar (grant da coluna)', () => {
  const sql = ler('supabase', 'migrations', '20261017140000_acompanhamento_automatico_ligado.sql')
  assert.match(sql, /add column if not exists acompanhamento_automatico boolean not null default true/)
  assert.match(sql, /grant update \(acompanhamento_automatico\) on table public\.clinic_settings to authenticated/)
})

await caso('Preferencias: o botao esta na secao do acompanhamento, so o responsavel muda, os dois lados pedem confirmacao e salvar confere a linha', () => {
  const tela = ler('src', 'sections', 'Settings.tsx')
  const secao = tela.slice(tela.indexOf('Acompanhamento automático</p>'), tela.indexOf('</section>', tela.indexOf('Acompanhamento automático</p>')))
  assert.match(secao, /<EnvioDoAcompanhamento \/>/)
  const botao = ler('src', 'sections', 'EnvioDoAcompanhamento.tsx')
  assert.match(botao, /membership\.role === 'owner'/)
  assert.match(botao, /titulo: 'Ligar o acompanhamento automático\?'/)
  assert.match(botao, /titulo: 'Desligar o acompanhamento automático\?'/)
  const repo = ler('src', 'lib', 'repository.ts')
  const salvar = repo.slice(repo.indexOf('export async function saveAcompanhamentoAutomatico'), repo.indexOf('export interface UltimaLeituraDoJev'))
  assert.match(salvar, /\.select\('acompanhamento_automatico'\)/)
  assert.match(salvar, /throw new Error/)
  const lerOpcao = repo.slice(repo.indexOf('export async function getAcompanhamentoAutomatico'), repo.indexOf('export async function saveAcompanhamentoAutomatico'))
  assert.match(lerOpcao, /!== false/, 'sem a coluna ou sem linha, ligado (o padrao)')
})

console.log(`acompanhamento-automatico: ${ok} casos ok`)
