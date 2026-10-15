// Quem atende nas frases fixas do robo (27/09/2026).
//
// Espelho do Dr. Fabio Dario (15/10/2026): o padrao deste sistema e o Dr.
// Fabio. O perfil pediatrico do Dr. Marcello so existe para a clinica "c1" dos
// testes do motor (tests/atendimento.test.mjs), que foram escritos para ele.
import { quemAtende, CLINICA_DR_FABIO } from './quem-atende.build.mjs'

let ok = 0
let falhas = 0
function confere(nome, cond, detalhe) {
  if (cond) ok++
  else {
    falhas++
    console.error('FALHOU:', nome, detalhe ?? '')
  }
}

const fabio = quemAtende(CLINICA_DR_FABIO)
confere('clinica do Dr. Fabio: o Dr. Fábio', fabio.o === 'o Dr. Fábio' && fabio.O === 'O Dr. Fábio')
confere('clinica do Dr. Fabio: fala com o proprio paciente', fabio.publico === 'geral')
confere('clinica do Dr. Fabio: alerta de sangramento para ele e a Dayane', fabio.alertaDeSangramento === 'o Dr. Fábio e a Dayane')
confere(
  'clinica do Dr. Fabio: pronto-socorro com os convenios, sem hospital fixo',
  /Porto Saúde, Unimed, Santa Saúde/.test(fabio.prontoSocorro ?? '') && !/Ana Costa/.test(fabio.prontoSocorro ?? ''),
)
confere('sem clinica, o Dr. Fabio', quemAtende(null).o === 'o Dr. Fábio')
confere('clinica desconhecida, o Dr. Fabio (nunca o medico de outra clinica)', quemAtende('outra-clinica').o === 'o Dr. Fábio')

// O motor de origem, so para os testes dele.
const origem = quemAtende('c1')
confere('clinica dos testes do motor (c1): o perfil pediatrico', origem.o === 'o Dr. Marcello' && origem.publico === 'pediatria')
confere('perfil pediatrico sem o modulo de sangramento', origem.alertaDeSangramento === null)
confere('nenhuma frase do Dr. Fabio cita o Dr. Marcello', !/Marcello/.test(JSON.stringify(fabio)), JSON.stringify(fabio))

console.log(`Quem atende: ${ok} verificações passaram.`)
if (falhas) {
  console.error(`FALHAS: ${falhas}`)
  process.exit(1)
}
