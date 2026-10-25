// Fila de acompanhamentos: enviado nao e atrasado (25/09/2026). Dados inventados.
import { pendingFollowups, situacaoDoEnvio, dueCount, etapasPorExtenso } from './followup.build.mjs'

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

// Etapas ligadas em Preferencias (19/10/2026): o Dr. Marcello tirou a de 15
// dias. O "15 dias" que nao saiu nao pode aparecer nem contar como atrasado.
const so30e90 = ['d30', 'm90']
confere('etapa desligada nao entra na fila', !pendingFollowups([naoSaiu], so30e90).some((i) => i.key === 'd15'))
confere('etapa desligada nao conta no menu', dueCount([enviado, naoSaiu], so30e90) === 0, String(dueCount([enviado, naoSaiu], so30e90)))
confere('sem escolha, as tres etapas valem', pendingFollowups([naoSaiu]).some((i) => i.key === 'd15'))
// Acompanhamento arquivado (23/10/2026, caso do sistema do Dr. Marcello): a ficha guarda a data da
// consulta, mas sem linha no banco nada sai - e a tela nao pode mostrar.
const arquivado = paciente('c', consulta, { status: 'pendente' })
confere('sem acompanhamento no banco nao entra na fila', !pendingFollowups([arquivado]).length && dueCount([arquivado]) === 0, JSON.stringify(pendingFollowups([arquivado]).map((i) => i.key)))
confere('etapas por extenso: tres', etapasPorExtenso(['d15', 'd30', 'm90']) === '15 dias, 30 dias e 3 meses', etapasPorExtenso(['d15', 'd30', 'm90']))
confere('etapas por extenso: duas, na ordem certa', etapasPorExtenso(['m90', 'd30']) === '30 dias e 3 meses', etapasPorExtenso(['m90', 'd30']))
confere('etapas por extenso: uma', etapasPorExtenso(['d30']) === '30 dias')

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
