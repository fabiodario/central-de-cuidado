// Logo por clinica (27/09/2026).
//
// Espelho do Dr. Fabio Dario (15/10/2026): a marca propria deste sistema e a
// dele. Clinica sem marca cadastrada entra com a do produto, como sempre.
import { marcaDaClinica, marcaSemClinicaConhecida } from './marca.build.mjs'
import { CLINICA_DR_FABIO } from './quem-atende.build.mjs'

let ok = 0
let falhas = 0
function confere(nome, cond, detalhe) {
  if (cond) ok++
  else {
    falhas++
    console.error('FALHOU:', nome, detalhe ?? '')
  }
}

const FABIO = CLINICA_DR_FABIO
const OUTRA = '00000000-0000-0000-0000-000000000000'

confere('clinica do Dr. Fabio com o logo dele', marcaDaClinica(FABIO).nome === 'Dr. Fábio Dario')
confere('clinica nova entra com a marca do produto', marcaDaClinica(OUTRA).nome === 'Central de Cuidado')
confere('logo do produto nao repete a etiqueta', marcaDaClinica(OUTRA).mostraEtiquetaDoProduto === false)
confere('logo do Dr. Fabio mantem a etiqueta', marcaDaClinica(FABIO).mostraEtiquetaDoProduto === true)
confere('clinica sem marca nao leva nome de medico no rodape', marcaDaClinica(OUTRA).nomeNoRodape === null)
confere('Dr. Fabio no rodape e na aba', marcaDaClinica(FABIO).nomeNoRodape === 'Dr. Fábio Dario' && /Fábio Dario/.test(marcaDaClinica(FABIO).titulo))
confere('nenhuma marca deste sistema cita o Dr. Marcello', ![marcaDaClinica(FABIO), marcaDaClinica(OUTRA)].some((m) => /Marcello/.test(JSON.stringify(m))))
// Sem window/localStorage (como no node): o login e a impressao ficam no logo da clinica deste sistema.
confere('sem clinica conhecida, login e impressao ficam no logo do Dr. Fabio', marcaSemClinicaConhecida(null).nome === 'Dr. Fábio Dario')
confere('impressao de outra clinica sai com Central de Cuidado', marcaSemClinicaConhecida(OUTRA).nome === 'Central de Cuidado')
confere('o acompanhamento pediatrico (v2) nao vale para o otorrino', marcaDaClinica(FABIO).acompanhamentoV2 === false)

console.log(`Marca: ${ok} verificações passaram.`)
if (falhas) {
  console.error(`FALHAS: ${falhas}`)
  process.exit(1)
}
