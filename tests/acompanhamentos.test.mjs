// Fila de acompanhamentos: enviado nao e atrasado (25/09/2026). Dados inventados.
import { pendingFollowups, situacaoDoEnvio, dueCount } from './followup.build.mjs'

let ok = 0
let falhas = 0
function confere(nome, cond, detalhe) {
  if (cond) ok++
  else {
    falhas++
    console.error('FALHOU:', nome, detalhe ?? '')
  }
}

function paciente(id, dataConsulta, d15) {
  return {
    id,
    nome: `Paciente ${id}`,
    dataConsulta,
    followups: { d15, d30: { status: 'concluido' }, m90: { status: 'concluido' } },
  }
}

// Consulta ha 16 dias: o de 15 dias venceu ontem.
const hoje = new Date()
hoje.setDate(hoje.getDate() - 16)
const consulta = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`

const enviado = paciente('a', consulta, { id: 'f1', status: 'enviado', enviadoEm: '2026-09-24T12:00:00Z' })
const naoSaiu = paciente('b', consulta, { id: 'f2', status: 'pendente' })
const itens = pendingFollowups([enviado, naoSaiu])
const de = (id) => itens.find((i) => i.patient.id === id)

confere('enviado vai para "aguardando", e nao atrasado', de('a')?.urgencia === 'aguardando', de('a')?.urgencia)
confere('o que nao saiu continua atrasado', de('b')?.urgencia === 'atrasado', de('b')?.urgencia)
confere('contador do menu nao conta o enviado', dueCount([enviado, naoSaiu]) === 1)

confere('lida vence entregue', situacaoDoEnvio(['delivered', 'read', 'sent']) === 'lida')
confere('entregue', situacaoDoEnvio(['sent', 'delivered']) === 'entregue')
confere('so aceita pela Meta conta como enviada', situacaoDoEnvio(['accepted']) === 'enviada')
confere('falha seguida de reenvio que chegou nao e falha', situacaoDoEnvio(['failed', 'delivered']) === 'entregue')
confere('so falha e falha', situacaoDoEnvio(['failed']) === 'falhou')
confere('sem mensagem, sem situacao', situacaoDoEnvio([]) === null)

console.log(`Acompanhamentos: ${ok} verificações passaram.`)
if (falhas) {
  console.error(`FALHAS: ${falhas}`)
  process.exit(1)
}
