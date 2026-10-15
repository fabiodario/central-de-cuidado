// Painel de familias simuladas (14/10/2026): uma familia conversa com o robo
// de producao, dentro do simulador (src/simulador), mensagem por mensagem.
//
// A ideia veio do "painel de compradores" do pacote founder-skill: em vez de
// esperar a familia real tropecar (os 7 defeitos de 13 e 14/10 so apareceram
// assim), varias familias inventadas - com pressa, com erro de digitacao, com
// dois filhos, com sintoma - conversam antes. Quem faz o papel da familia e um
// agente; este script so reproduz a conversa e mostra o que o robo respondeu.
//
// Uso:  node tests/painel/conversar.mjs tests/painel/familias/<nome>.json
// O arquivo:
//   { "identidade": "marcello", "familia": "nova" | "cadastrada" | "irmaos" | "com_consulta",
//     "inicio": "2026-10-14T13:00:00Z",
//     "mensagens": [ { "texto": "Oi" }, { "toque": "2" }, { "anexo": true },
//                    { "equipe": "texto da secretaria" }, { "espera_min": 90 } ] }
// Cada execucao refaz a conversa inteira do zero (relogio fixo, 45 s entre
// mensagens): o resultado e sempre o mesmo para as mesmas mensagens.
//
// Precisa do simulador empacotado (npm run test:bot faz isso).
import { readFileSync } from 'node:fs'

const [arquivo] = process.argv.slice(2)
if (!arquivo) {
  console.error('Uso: node tests/painel/conversar.mjs <familia.json>')
  process.exit(2)
}
const roteiro = JSON.parse(readFileSync(arquivo, 'utf8'))

const avisos = []
const warn = console.warn
console.warn = (...a) => (String(a[0]).startsWith('[simulador]') ? avisos.push(a.join(' ')) : undefined)
const { Simulacao } = await import('../simulador.build/sessao.mjs')
const { IDENTIDADES, FAMILIAS } = await import('../simulador.build/dados.mjs')

const identidade = IDENTIDADES[roteiro.identidade ?? 'marcello']
const familia = FAMILIAS[roteiro.familia ?? 'nova']
if (!identidade || !familia) {
  console.error('identidade ou familia desconhecida')
  process.exit(2)
}
let agora = new Date(roteiro.inicio ?? '2026-10-14T13:00:00Z')
const s = new Simulacao(identidade, familia, { relogio: () => agora })

const hora = (d) => d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const recuo = (t, n = 4) => t.split('\n').map((l) => ' '.repeat(n) + l).join('\n')

console.log(`Clínica: ${identidade.rotulo} · Família: ${familia.rotulo} (${familia.descricao})`)
if (s.consultas().length) console.log(`Consultas já marcadas: ${s.consultas().map((c) => `${hora(new Date(c.starts_at))} ${c.unidade}`).join('; ')}`)
console.log('')

let ultimosToques = null
let n = 0
for (const passo of roteiro.mensagens ?? []) {
  if (passo.espera_min) {
    agora = new Date(agora.getTime() + passo.espera_min * 60000)
    console.log(`  … ${passo.espera_min} min depois …\n`)
    continue
  }
  n += 1
  if (passo.equipe) {
    s.responderComoEquipe(passo.equipe)
    console.log(`[${n}] EQUIPE (${hora(agora)}): ${passo.equipe}\n`)
    agora = new Date(agora.getTime() + 45000)
    continue
  }
  let texto = passo.texto ?? ''
  let idDoToque
  if (passo.toque !== undefined) {
    idDoToque = String(passo.toque)
    const opcao = ultimosToques?.opcoes.find((o) => o.id === idDoToque)
    if (!opcao) console.log(`  (aviso: a opção "${idDoToque}" não existe na última lista/botões)`)
    texto = opcao?.titulo ?? texto
  }
  const r = await s.enviarDaFamilia({ texto, idDoToque, anexo: Boolean(passo.anexo) })
  console.log(`[${n}] FAMÍLIA (${hora(agora)}): ${passo.anexo ? '📷 [foto/arquivo] ' : ''}${idDoToque ? `[tocou] ${texto}` : texto}`)
  if (r.respostas.length === 0) console.log('    ROBÔ: (silêncio)')
  for (const m of r.respostas) {
    console.log(`    ROBÔ:\n${recuo(m.texto, 6)}`)
    if (m.toques) {
      ultimosToques = m.toques
      const tipo = m.toques.tipo === 'lista' ? `lista "${m.toques.rotulo}"` : 'botões'
      console.log(`      [${tipo}] ${m.toques.opcoes.map((o) => `${o.id} = ${o.titulo}`).join(' | ')}`)
    }
  }
  const bastidores = r.registros.map((x) => x.titulo + (x.detalhe ? ` (${x.detalhe})` : ''))
  if (bastidores.length) console.log(`    · bastidores: ${bastidores.join(' · ')}`)
  console.log('')
  agora = new Date(agora.getTime() + 45000)
}

console.log('--- estado no fim ---')
console.log(`Etapa do robô: ${s.etapa ?? 'nenhuma'} · Situação: ${s.situacao}${s.motivo ? ` (${s.motivo})` : ''}`)
const consultas = s.consultas()
console.log(`Consultas: ${consultas.length ? consultas.map((c) => `${hora(new Date(c.starts_at))} ${c.unidade} [${c.status}]${c.contact_name ? ` ${c.contact_name}` : ''}`).join('; ') : 'nenhuma'}`)
if (avisos.length) console.log(`AVISOS DO SIMULADOR: ${avisos.join(' | ')}`)
console.warn = warn
