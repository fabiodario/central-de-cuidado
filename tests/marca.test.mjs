// Logo por clinica (27/09/2026).
//
// Espelho do Dr. Fabio Dario (15/10/2026): a marca propria deste sistema e a
// dele. Clinica sem marca cadastrada entra com a do produto, como sempre.
import { logoNoFundoEscuro, marcaDaClinica, marcaSemClinicaConhecida } from './marca.build.mjs'
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

// Logo no fundo escuro (15/10/2026). O do Dr. Fabio e colorido: pintado de
// branco pelo filtro do logo do produto, os tres circulos viravam manchas. E a
// caixa mais estreita que o logo o achatava. (O build deste teste carrega os
// PNG como data URL para os dois arquivos poderem ser comparados.)
const escuroFabio = logoNoFundoEscuro(marcaDaClinica(FABIO))
const escuroProduto = logoNoFundoEscuro(marcaDaClinica(OUTRA))
confere('logo do Dr. Fabio no fundo escuro sai sem o filtro que pinta de branco', !/invert|brightness-0/.test(escuroFabio.classe), escuroFabio.classe)
confere(
  'logo do Dr. Fabio no fundo escuro e a versao propria, nao a do fundo claro',
  /^data:image\/png/.test(escuroFabio.src ?? '') && escuroFabio.src !== marcaDaClinica(FABIO).src,
)
confere('logo do produto continua pintado de branco no fundo escuro', /brightness-0 invert/.test(escuroProduto.classe), escuroProduto.classe)
confere('nenhum logo e achatado na caixa', [escuroFabio, escuroProduto].every((l) => /object-contain/.test(l.classe)))

console.log(`Marca: ${ok} verificações passaram.`)
if (falhas) {
  console.error(`FALHAS: ${falhas}`)
  process.exit(1)
}
