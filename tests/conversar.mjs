// Conversa com o robo de verdade, uma mensagem por vez (16/10/2026).
//
// Feito para o painel de pacientes simulados: quem faz o papel do paciente
// (uma pessoa ou um agente) le a resposta do robo, decide a proxima mensagem,
// acrescenta no arquivo e roda de novo. O robo nao e IA, e regra: com o mesmo
// relogio, a mesma conversa da sempre a mesma resposta, entao rodar a conversa
// inteira de novo a cada mensagem e exato, e nao precisa guardar estado.
//
// Usa o motor de producao (atendimento.ts) e os dados do Dr. Fabio
// (src/simulador/dados.ts, os mesmos carregados no banco), num banco falso.
// Nada sai daqui: nenhum WhatsApp, nenhum banco de verdade.
//
// Como rodar (depois de "npm run test:bot", que monta tests/simulador.build):
//   node tests/conversar.mjs conversa.json          so a resposta a ultima mensagem
//   node tests/conversar.mjs conversa.json --tudo   a conversa inteira
//
// conversa.json:
//   {
//     "familia": "nova",            nova | cadastrada | irmaos | com_consulta
//     "hora": "manha",              manha (quarta 10h) | noite (quarta 22h) | sabado (10h)
//     "mensagens": [
//       "Oi, quero marcar uma consulta",
//       { "toque": "Santos" },      toca a opcao pelo titulo (ou pelo id) da ultima lista/botoes
//       { "anexo": true },          manda uma foto
//       { "equipe": "Oi, aqui e a Dayane" }   a equipe responde pela tela
//     ]
//   }
import { readFileSync } from 'node:fs'
import { Simulacao } from './simulador.build/sessao.mjs'
import { IDENTIDADES, FAMILIAS } from './simulador.build/dados.mjs'

const [arquivo, ...flags] = process.argv.slice(2)
if (!arquivo) {
  console.error('uso: node tests/conversar.mjs conversa.json [--tudo]')
  process.exit(1)
}
const tudo = flags.includes('--tudo')
const roteiro = JSON.parse(readFileSync(arquivo, 'utf8'))
const familia = FAMILIAS[roteiro.familia ?? 'nova']
if (!familia) {
  console.error(`familia desconhecida: ${roteiro.familia} (use nova, cadastrada, irmaos ou com_consulta)`)
  process.exit(1)
}

// Relogio fixo: a mesma conversa tem de dar a mesma resposta em qualquer dia.
const INICIO = {
  manha: Date.parse('2026-10-14T13:00:00Z'), // quarta, 10h em Brasilia
  noite: Date.parse('2026-10-15T01:00:00Z'), // quarta, 22h
  sabado: Date.parse('2026-10-17T13:00:00Z'), // sabado, 10h
}[roteiro.hora ?? 'manha']
if (!INICIO) {
  console.error(`hora desconhecida: ${roteiro.hora} (use manha, noite ou sabado)`)
  process.exit(1)
}

let agora = INICIO
const s = new Simulacao(IDENTIDADES.fabio, familia, { relogio: () => new Date((agora += 45000)) })

const semAcento = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const hora = (d) => d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
const recuo = (texto) => String(texto).split('\n').map((l) => `    ${l}`).join('\n')

function descreverToques(m) {
  if (!m.toques) return ''
  const linhas = m.toques.opcoes.map((o) => `      - "${o.titulo}"${o.descricao ? ` (${o.descricao})` : ''}  [id: ${o.id}]`)
  const tipo = m.toques.tipo === 'lista' ? `LISTA "${m.toques.rotulo}"` : 'BOTOES'
  return `\n    ${tipo}, para tocar:\n${linhas.join('\n')}`
}

function acharOpcao(ultima, alvo) {
  const opcoes = ultima?.toques?.opcoes ?? []
  const a = semAcento(alvo)
  return (
    opcoes.find((o) => o.id === alvo) ??
    opcoes.find((o) => semAcento(o.titulo) === a) ??
    opcoes.find((o) => semAcento(o.titulo).startsWith(a)) ??
    opcoes.find((o) => semAcento(o.titulo).includes(a))
  )
}

const transcricao = []
let ultimaComToques = null
let ultimoBloco = []

for (const [i, passo] of roteiro.mensagens.entries()) {
  const bloco = []
  if (typeof passo === 'object' && 'equipe' in passo) {
    const r = s.responderComoEquipe(passo.equipe)
    bloco.push(`[${hora(r.mensagem.em)}] EQUIPE (${IDENTIDADES.fabio.equipe}): ${passo.equipe}`)
    transcricao.push(...bloco)
    ultimoBloco = bloco
    continue
  }
  let entrada
  if (typeof passo === 'object' && 'toque' in passo) {
    const opcao = acharOpcao(ultimaComToques, passo.toque)
    if (!opcao) {
      const havia = (ultimaComToques?.toques?.opcoes ?? []).map((o) => `"${o.titulo}"`).join(', ') || 'nenhuma'
      console.log(transcricao.join('\n'))
      console.log(`\n!!! Mensagem ${i + 1}: nao existe opcao "${passo.toque}" para tocar. Opcoes da ultima mensagem: ${havia}`)
      process.exit(2)
    }
    entrada = { texto: opcao.titulo, idDoToque: opcao.id }
  } else if (typeof passo === 'object' && 'anexo' in passo) {
    entrada = { texto: passo.texto ?? '', anexo: true }
  } else {
    entrada = { texto: String(passo) }
  }

  const r = await s.enviarDaFamilia(entrada)
  const como = entrada.anexo ? ' (mandou uma foto)' : entrada.idDoToque ? ' (tocou na opcao)' : ''
  bloco.push(`[${hora(r.familia.em)}] PACIENTE${como}: ${r.familia.texto}`)
  for (const a of r.alertas) bloco.push(`    >>> NOTIFICACAO URGENTE no celular de ${a.para.join(' e ')}: ${a.titulo}`)
  if (r.respostas.length === 0) bloco.push('    (robo em silencio)')
  for (const m of r.respostas) bloco.push(`[${hora(m.em)}] ROBO:\n${recuo(m.texto)}${descreverToques(m)}`)
  ultimaComToques = [...r.respostas].reverse().find((m) => m.toques) ?? (r.respostas.length ? null : ultimaComToques)
  transcricao.push(...bloco)
  ultimoBloco = bloco
}

console.log((tudo ? transcricao : ultimoBloco).join('\n'))

// Como a conversa aparece para a equipe, e o que ficou gravado.
const marcadas = s.consultas().filter((c) => c.status === 'scheduled')
console.log('\n--- ESTADO')
console.log(`etapa do robo: ${s.etapa ?? 'nenhuma'} | situacao: ${s.situacao}${s.motivo ? ` | etiqueta para a equipe: ${s.motivo}` : ''}`)
for (const c of marcadas) {
  console.log(
    `consulta marcada: ${new Date(c.starts_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} | ${c.unidade} | ` +
      `${c.insurance || 'particular'} | paciente: ${c.intake_patient_name || c.contact_name || '?'}` +
      `${c.intake_guardian ? ` | responsavel: ${c.intake_guardian}` : ''}${c.intake_complaint ? ` | queixa: ${c.intake_complaint}` : ''}`,
  )
}
const canceladas = s.consultas().filter((c) => c.status === 'cancelled')
for (const c of canceladas) console.log(`consulta cancelada: ${new Date(c.starts_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} | ${c.unidade}`)
