// Os sinais que dizem se a Memed esta pronta, aberta na tela, e qual receita
// foi excluida, nos dois motores dela (o antigo e o sinapse v4, ver
// src/lib/sinais-da-memed.ts). Os enderecos sao os que a Memed usava em
// 25/10/2026.
import { ehQuadroDaV4, idDaReceitaExcluida, memedNaTela, prontaParaComando } from './sinais-da-memed.build.mjs'

let ok = 0
let falhas = 0
function confere(nome, cond, detalhe) {
  if (cond) ok++
  else {
    falhas++
    console.error('FALHOU:', nome, detalhe ?? '')
  }
}

const antigo = (nome, display = 'block') => ({
  id: `mdhub-module-${nome}`,
  src: `https://partners.memed.com.br/modulos/${nome}/index.html`,
  display,
  visibility: 'visible',
})
const v4 = (visibility = 'hidden', src = 'https://v4-embedded.memed.com.br/') => ({ id: '', src, display: 'block', visibility })
const doSistema = { id: '', src: 'https://fabiodario.github.io/central-de-cuidado/simuladorbot/?no-sistema', display: 'block', visibility: 'visible' }

// Pronta para comando
confere('motor antigo: pronta quando o modulo da prescricao existe', prontaParaComando([antigo('plataforma.prescricao')], undefined))
confere('motor antigo: outro modulo ainda nao basta', !prontaParaComando([antigo('plataforma.usuario')], { v4Ready: false }))
// O caso de 25/10/2026: v4 pronto, sem o iframe do motor antigo.
confere('v4: pronta pelo aviso da Memed', prontaParaComando([v4()], { v4Ready: true }))
confere('v4: aviso de nao pronta e respeitado', !prontaParaComando([v4()], { v4Ready: false }))
confere('v4 sem o aviso (renomeado): vale o iframe do v4', prontaParaComando([v4()], {}))
confere('v4 sem o gate na pagina: vale o iframe do v4', prontaParaComando([v4()], undefined))
confere('nada da Memed na pagina: nao esta pronta', !prontaParaComando([doSistema], undefined))
confere('pagina vazia: nao esta pronta', !prontaParaComando([], null))

// Endereco do v4
confere('v4 de producao', ehQuadroDaV4(v4()))
confere('v4 de homologacao', ehQuadroDaV4(v4('hidden', 'https://v4-embedded-integrations.memed.com.br/')))
confere('outro site com v4-embedded no caminho nao conta', !ehQuadroDaV4(v4('hidden', 'https://exemplo.com/v4-embedded.memed.com.br/')))
confere('dominio parecido nao conta', !ehQuadroDaV4(v4('hidden', 'https://v4-embedded.memed.com.br.exemplo.com/')))

// Aberta na tela
confere('v4 escondido nao esta na tela', !memedNaTela([v4('hidden')]))
confere('v4 visivel esta na tela', memedNaTela([v4('visible')]))
confere('antigo com display none nao esta na tela', !memedNaTela([antigo('plataforma.prescricao', 'none')]))
confere('antigo visivel esta na tela', memedNaTela([antigo('plataforma.prescricao')]))
confere('iframe do proprio sistema nao e a Memed', !memedNaTela([doSistema]))

// Receita excluida: a Memed manda o id nu (catalogo de eventos do v4).
confere('id nu em numero', idDaReceitaExcluida(169351) === '169351')
confere('id nu em texto', idDaReceitaExcluida('169351') === '169351')
confere('objeto { id } da documentacao', idDaReceitaExcluida({ id: 1234 }) === '1234')
confere('sem id nao exclui nada', idDaReceitaExcluida({}) === null && idDaReceitaExcluida(null) === null && idDaReceitaExcluida(undefined) === null)
confere('texto vazio nao exclui nada', idDaReceitaExcluida('  ') === null)

console.log(`Sinais da Memed: ${ok} verificações passaram.`)
if (falhas) {
  console.error(`FALHAS: ${falhas}`)
  process.exit(1)
}
