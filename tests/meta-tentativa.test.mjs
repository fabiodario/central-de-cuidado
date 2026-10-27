// Mais uma tentativa no erro passageiro da Meta (26/10/2026, vindo do sistema
// do Dr. Marcello). Ver supabase/functions/_shared/meta-tentativa.ts.
import { buildSync } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const AQUI = dirname(fileURLToPath(import.meta.url))
const saida = join(AQUI, 'meta-tentativa.build.mjs')
buildSync({ entryPoints: [join(AQUI, '..', 'supabase/functions/_shared/meta-tentativa.ts')], format: 'esm', outfile: saida, logLevel: 'warning' })
const { postarNaMeta, ESPERA_DA_NOVA_TENTATIVA_MS } = await import(`${pathToFileURL(saida).href}?v=${Date.now()}`)

let ok = 0
const falhas = []
const confere = (nome, cond, detalhe = '') => (cond ? ok++ : falhas.push(`${nome} ${detalhe}`))

const erro = (code, status = 500) => new Response(JSON.stringify({ error: { code, message: 'Something went wrong' } }), { status })
const certo = () => new Response(JSON.stringify({ messages: [{ id: 'wamid.ok' }] }), { status: 200 })
const roteiro = (...respostas) => {
  const chamadas = []
  return {
    chamadas,
    buscar: async (url, init) => {
      chamadas.push(init.body)
      return respostas[Math.min(chamadas.length - 1, respostas.length - 1)]()
    },
  }
}
const esperas = []
const esperar = async (ms) => { esperas.push(ms) }

{
  const r = roteiro(() => erro(131000), certo)
  const resposta = await postarNaMeta('https://graph/x', { method: 'POST', body: '{"a":1}' }, { buscar: r.buscar, esperar })
  const corpo = await resposta.json()
  confere('131000 e depois certo: devolve o certo', resposta.ok && corpo.messages[0].id === 'wamid.ok', JSON.stringify(corpo))
  confere('131000: tenta duas vezes, com o mesmo corpo', r.chamadas.length === 2 && r.chamadas[1] === '{"a":1}', JSON.stringify(r.chamadas))
  confere('131000: espera antes da segunda', esperas.at(-1) === ESPERA_DA_NOVA_TENTATIVA_MS, JSON.stringify(esperas))
}
{
  const r = roteiro(() => erro(131000), () => erro(131000))
  const resposta = await postarNaMeta('https://graph/x', { method: 'POST', body: '{}' }, { buscar: r.buscar, esperar })
  const corpo = await resposta.json()
  confere('131000 duas vezes: so duas tentativas, e quem chamou ainda le o erro', r.chamadas.length === 2 && !resposta.ok && corpo.error.code === 131000)
}
{
  const r = roteiro(() => erro(131047, 400), certo)
  const resposta = await postarNaMeta('https://graph/x', { method: 'POST', body: '{}' }, { buscar: r.buscar, esperar })
  const corpo = await resposta.json()
  confere('janela fechada (131047): nao repete, e o corpo continua legivel', r.chamadas.length === 1 && corpo.error.code === 131047, JSON.stringify(corpo))
}
{
  const r = roteiro(() => erro(131016, 503), certo)
  await postarNaMeta('https://graph/x', { method: 'POST', body: '{}' }, { buscar: r.buscar, esperar })
  confere('131016 (servico fora) tambem repete', r.chamadas.length === 2)
}
{
  const r = roteiro(certo)
  await postarNaMeta('https://graph/x', { method: 'POST', body: '{}' }, { buscar: r.buscar, esperar })
  confere('deu certo de primeira: uma chamada so', r.chamadas.length === 1)
}
{
  const r = roteiro(() => new Response('<html>erro</html>', { status: 502 }), certo)
  await postarNaMeta('https://graph/x', { method: 'POST', body: '{}' }, { buscar: r.buscar, esperar })
  confere('erro sem codigo da Meta: nao adivinha, nao repete', r.chamadas.length === 1)
}

console.log(`meta-tentativa: ${ok} verificacoes ok`)
if (falhas.length) {
  for (const f of falhas) console.log('✗ ' + f)
  process.exit(1)
}
