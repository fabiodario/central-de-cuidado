// Ultimo acesso na lista "Quem tem acesso" (18/10/2026, pedido do Edu: ver
// quem ainda usa o sistema antes de suspender alguem). No "npm run test:bot".
// ULTIMO_ACESSO_TS aponta para outra copia do modulo (para provar que o teste
// pega o defeito com a regra desligada).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSync } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const AQUI = dirname(fileURLToPath(import.meta.url))
const fonte = process.env.ULTIMO_ACESSO_TS ?? join(AQUI, '..', 'src', 'lib', 'ultimo-acesso.ts')
const saida = join(AQUI, 'ultimo-acesso.build.mjs')
buildSync({ entryPoints: [fonte], bundle: true, format: 'esm', outfile: saida, logLevel: 'warning' })
const { textoDoUltimoAcesso } = await import(`${pathToFileURL(saida).href}?v=${Date.now()}`)
// Sem CR: o git no Windows grava CRLF, e os trechos procurados aqui sao com \n.
const ler = (...partes) => readFileSync(join(AQUI, '..', ...partes), 'utf8').replace(/\r\n/g, '\n')

let ok = 0
function caso(nome, fn) {
  try {
    fn()
    ok++
  } catch (erro) {
    console.error('FALHOU:', nome)
    throw erro
  }
}

// Meio-dia de 18/10/2026 em Sao Paulo.
const AGORA = new Date('2026-10-18T15:00:00Z')

caso('sem a funcao no banco, nao mostra nada (e nao diz "nunca entrou")', () => {
  assert.equal(textoDoUltimoAcesso(undefined, AGORA), '')
})

caso('quem nunca entrou', () => {
  assert.equal(textoDoUltimoAcesso(null, AGORA), 'Nunca entrou')
})

caso('hoje, com a hora de Sao Paulo', () => {
  assert.equal(textoDoUltimoAcesso('2026-10-18T13:05:00Z', AGORA), 'Último acesso hoje, às 10:05')
})

caso('22h41 de ontem aqui e 18/10 em UTC: vale o dia de Sao Paulo', () => {
  assert.equal(textoDoUltimoAcesso('2026-10-18T01:41:00Z', AGORA), 'Último acesso ontem, às 22:41')
})

caso('mais antigo: so a data', () => {
  assert.equal(textoDoUltimoAcesso('2026-10-12T17:00:00Z', AGORA), 'Último acesso em 12 de out. de 2026')
})

caso('data que nao se le: nao mostra nada', () => {
  assert.equal(textoDoUltimoAcesso('ontem', AGORA), '')
})

const tela = ler('src', 'sections', 'AccessAdmin.tsx')
const banco = ler('supabase', 'migrations', '20261018120000_ultimo_acesso_da_equipe.sql')

caso('a tela le o ultimo acesso a parte: se falhar, a lista de acessos continua', () => {
  assert.match(tela, /listarUltimosAcessos\(membership\.clinicId\)\.catch\(/)
  assert.match(tela, /textoDoUltimoAcesso\(/)
})

caso('so o administrador da clinica le, e o navegador anonimo nem chama', () => {
  assert.match(banco, /security definer/)
  assert.match(banco, /set search_path = ''/)
  assert.match(banco, /if not private\.is_clinic_owner\(p_clinic\) then\s+raise exception/)
  assert.match(banco, /revoke all on function public\.ultimos_acessos_da_clinica\(uuid\) from public, anon;/)
})

caso('a renovacao da sessao conta, nao so a ultima entrada com senha', () => {
  assert.match(banco, /u\.last_sign_in_at/)
  assert.match(banco, /from auth\.sessions s/)
  assert.match(banco, /s\.refreshed_at at time zone 'UTC'/)
})

console.log(`ultimo acesso: ${ok} casos ok`)
