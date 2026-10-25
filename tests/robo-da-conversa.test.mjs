// Robo desligado so numa conversa (23/10/2026). Ver
// supabase/functions/_shared/robo-da-conversa.ts.
import { buildSync } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

// Vindo do sistema do Dr. Marcello (25/10/2026). Monta o modulo na hora.
const AQUI = dirname(fileURLToPath(import.meta.url))
const saida = join(AQUI, 'robo-da-conversa.build.mjs')
buildSync({ entryPoints: [join(AQUI, '..', 'supabase', 'functions', '_shared', 'robo-da-conversa.ts')], bundle: true, format: 'esm', outfile: saida, logLevel: 'warning' })
const { roboRespondeNaConversa } = await import(`${pathToFileURL(saida).href}?v=${Date.now()}`)

let ok = 0
const falhas = []
const confere = (nome, cond) => (cond ? ok++ : falhas.push(nome))

confere('Clinica ligada e conversa sem chave: responde', roboRespondeNaConversa({ ligadoNaClinica: true, desligadoNaConversaEm: null }))
confere('Conversa desligada pela equipe: calado, mesmo com a clinica ligada', !roboRespondeNaConversa({ ligadoNaClinica: true, desligadoNaConversaEm: '2026-10-23T16:00:00Z' }))
confere('Clinica desligada: calado em todas', !roboRespondeNaConversa({ ligadoNaClinica: false, desligadoNaConversaEm: null }))
confere('Coluna ainda inexistente (undefined): responde como antes', roboRespondeNaConversa({ ligadoNaClinica: true, desligadoNaConversaEm: undefined }))
confere('Ajuste da clinica sem valor: calado (como antes)', !roboRespondeNaConversa({ ligadoNaClinica: null, desligadoNaConversaEm: null }))

console.log(`robo da conversa: ${ok} verificacoes ok`)
if (falhas.length) {
  for (const f of falhas) console.log('✗ ' + f)
  process.exit(1)
}
