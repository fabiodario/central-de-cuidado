// Quem recebe o aviso da mudanca de Santos (26/09/2026).
//
// O envio e unico e vai para familias de verdade: um erro aqui manda endereco
// e totem para quem tem consulta por video, ou para quem ainda vai a Liferty
// no dia 30. Cada caso abaixo e um desses enganos.
import { motivoParaNaoAvisar, dataEHoraDoAviso, ehLivanceSantos } from './aviso-mudanca.build.mjs'
import { textoDoModelo } from './modelos.build.mjs'

let passou = 0
const falhas = []
function conferir(titulo, condicao, detalhe = '') {
  if (condicao) passou++
  else falhas.push(`${titulo}${detalhe ? ` | ${detalhe}` : ''}`)
}

const base = {
  status: 'scheduled',
  modality: 'presencial',
  confirmed_by_clinic: true,
  starts_at: '2026-10-02T12:20:00Z',
  unidade: 'Livance · Santos',
}

conferir('Consulta presencial confirmada na Livance em outubro recebe', motivoParaNaoAvisar(base) === null)
conferir('Telemedicina presa a Livance NAO recebe', motivoParaNaoAvisar({ ...base, modality: 'telemedicina' }) === 'telemedicina')
conferir('Solicitacao pendente NAO recebe', motivoParaNaoAvisar({ ...base, confirmed_by_clinic: false }) !== null)
conferir('Cancelada NAO recebe', motivoParaNaoAvisar({ ...base, status: 'cancelled' }) !== null)
conferir('Falta ja marcada NAO recebe', motivoParaNaoAvisar({ ...base, status: 'no_show' }) !== null)
conferir('Ibirapuera NAO recebe', motivoParaNaoAvisar({ ...base, unidade: 'Livance Ibirapuera - São Paulo' }) === 'outra unidade')
conferir('Liferty NAO recebe', motivoParaNaoAvisar({ ...base, unidade: 'Liferty · Santos' }) === 'outra unidade')
conferir('30/09 23:59 em Sao Paulo ainda e antes da virada',
  motivoParaNaoAvisar({ ...base, starts_at: '2026-10-01T02:59:00Z' }) === 'antes de 01/10')
conferir('01/10 00:00 em Sao Paulo ja recebe',
  motivoParaNaoAvisar({ ...base, starts_at: '2026-10-01T03:00:00Z' }) === null)
conferir('Consulta sem modalidade gravada conta como presencial', motivoParaNaoAvisar({ ...base, modality: null }) === null)

conferir('Nome com hifen tambem e a Livance Santos', ehLivanceSantos('Livance - Santos'))
conferir('Santo Andre nao e Santos', !ehLivanceSantos('Livance · Santo André'))

const { data, hora } = dataEHoraDoAviso('2026-10-02T12:20:00Z')
conferir('Data curta com dia da semana', data === 'sexta, 02/10', data)
conferir('Hora no fuso de Sao Paulo', hora === '09:20', hora)
conferir('Sabado sem "-feira" para cortar', dataEHoraDoAviso('2026-10-03T12:00:00Z').data === 'sábado, 03/10')

const texto = textoDoModelo('mudanca_santos_livance', ['Maria', data, hora]) ?? ''
conferir('O registro da conversa tem o texto que a familia le', texto.includes('Sua consulta de sexta, 02/10 às 09:20 em Santos'), texto.slice(0, 120))
conferir('O registro fala do pagamento no totem', texto.includes('Ainda no totem, faça o pagamento'))
conferir('Nenhum {{n}} sobra no texto', !/\{\{\d+\}\}/.test(texto))

if (falhas.length) {
  console.error(`aviso-mudanca: ${falhas.length} falha(s)\n - ${falhas.join('\n - ')}`)
  process.exit(1)
}
console.log(`aviso-mudanca: ${passou} verificações ok`)
