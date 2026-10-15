// Numero de teste da Meta na clinica de teste (27/09/2026).
// Numeros e chaves inventados.
import { chaveDoWhatsApp, foraDaListaDeTeste } from './whatsapp-teste.build.mjs'
import { avaliarSaude } from './saude-dos-envios.build.mjs'

let ok = 0
let falhas = 0
function confere(nome, cond, detalhe) {
  if (cond) ok++
  else {
    falhas++
    console.error('FALHOU:', nome, detalhe ?? '')
  }
}

// ---------------------------------------------------------------- chave por numero
{
  const ambiente = {
    WHATSAPP_ACCESS_TOKEN: 'chave-geral',
    WHATSAPP_ACCESS_TOKEN_111: 'chave-do-teste',
    WHATSAPP_ACCESS_TOKEN_222: '   ',
  }
  const ler = (nome) => ambiente[nome]
  confere('numero com chave propria usa a propria', chaveDoWhatsApp('111', ler) === 'chave-do-teste')
  confere('clinica real (sem chave propria) continua na geral', chaveDoWhatsApp('999', ler) === 'chave-geral')
  confere('chave propria em branco cai na geral', chaveDoWhatsApp('222', ler) === 'chave-geral')
  confere('sem numero usa a geral', chaveDoWhatsApp(null, ler) === 'chave-geral')
  confere('sem chave nenhuma devolve vazio', chaveDoWhatsApp('111', () => undefined) === undefined)
}

// ---------------------------------------------------------------- lista de teste
{
  confere('clinica real (lista nula) nunca trava', foraDaListaDeTeste(null, '13991234567') === false)
  confere('lista indefinida tambem nao trava', foraDaListaDeTeste(undefined, '13991234567') === false)
  confere('modo teste com lista vazia trava todo mundo', foraDaListaDeTeste([], '13991234567') === true)
  const lista = ['(13) 99123-4567']
  confere('numero da lista passa', foraDaListaDeTeste(lista, '13991234567') === false)
  confere('grafia da Meta sem o nono digito passa', foraDaListaDeTeste(lista, '551391234567') === false)
  confere('com 55 e nono digito passa', foraDaListaDeTeste(lista, '+55 13 99123-4567') === false)
  confere('paciente ficticio fora da lista e travado', foraDaListaDeTeste(lista, '11990000001') === true)
  confere('telefone vazio em modo teste e travado', foraDaListaDeTeste(lista, '') === true)
}

// ---------------------------------------------------------------- painel de saude
{
  const agora = new Date('2026-09-27T16:00:00Z')
  // O caso real de 27/09/2026: clinica de teste sem numero, com consultas
  // ficticias amanha. O cartao ficava vermelho.
  const semNumero = avaliarSaude({ whatsapp_conectado: false, lembretes_atrasados: 2, acompanhamentos_hoje_parados: 3 }, agora)
  confere('clinica sem WhatsApp fica desligada, nao vermelha', semNumero.situacao === 'desligado' && semNumero.problemas.length === 0, JSON.stringify(semNumero))

  const real = avaliarSaude({ whatsapp_conectado: true, lembretes_atrasados: 2 }, agora)
  confere('clinica com WhatsApp continua acusando atraso', real.situacao === 'normal' && real.problemas.some((p) => p.nivel === 'erro'), JSON.stringify(real))

  const antigo = avaliarSaude({ lembretes_atrasados: 1 }, agora)
  confere('resposta antiga (sem o campo novo) continua acusando', antigo.situacao === 'normal' && antigo.problemas.length === 1)

  const testeVazio = avaliarSaude({ whatsapp_conectado: true, modo_teste: true, telefones_teste: 0 }, agora)
  confere('modo teste sem celular avisa que nada sai', testeVazio.problemas.some((p) => /nenhum celular/.test(p.texto)), JSON.stringify(testeVazio))

  const testeCheio = avaliarSaude({ whatsapp_conectado: true, modo_teste: true, telefones_teste: 3 }, agora)
  confere('modo teste com celulares nao avisa nada', testeCheio.problemas.length === 0, JSON.stringify(testeCheio))
  confere('resumo diz que e modo teste', /modo teste \(3 celulares\)/.test(testeCheio.resumo), testeCheio.resumo)
  confere('clinica real nao fala de modo teste', !/modo teste/.test(real.resumo), real.resumo)
}

console.log(`WhatsApp de teste (27/09): ${ok} verificações passaram.`)
if (falhas) {
  console.error(`FALHAS: ${falhas}`)
  process.exit(1)
}
