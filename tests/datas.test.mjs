// Data de nascimento digitada pela familia na ficha do WhatsApp.
//
// Em 22/09/2026 uma mae escreveu "25/07/23" e o cadastro saiu sem data de
// nascimento, porque so ano com quatro digitos era aceito. Sem essa data a
// Memed recusa a receita.
//
// PARA PROVAR QUE ESTE TESTE PEGA O DEFEITO: troque `(\d{2}|\d{4})` por
// `(\d{4})` em _shared/datas.ts. Os casos de dois digitos caem.
import { dataDeNascimentoIso } from './datas.build.mjs'

let passou = 0
const falhas = []
const conferir = (titulo, condicao, detalhe = '') => {
  if (condicao) passou++
  else falhas.push(`${titulo}${detalhe ? ` | ${detalhe}` : ''}`)
}
const HOJE = new Date('2026-09-22T12:00:00Z')
const ler = (t) => dataDeNascimentoIso(t, HOJE)

conferir('Caso real: "25/07/23" vira 2023-07-25', ler('25/07/23') === '2023-07-25', `veio ${ler('25/07/23')}`)
conferir('Quatro digitos continuam valendo', ler('22/06/2020') === '2020-06-22')
conferir('Dia e mes de um digito', ler('5/3/2019') === '2019-03-05')
conferir('Separador com ponto', ler('05.03.2019') === '2019-03-05')
conferir('Separador com traco', ler('05-03-19') === '2019-03-05')
conferir('"10" e 2010: adolescente ainda e paciente', ler('01/01/10') === '2010-01-01')
conferir('"26" e 2026: bebe deste ano', ler('01/01/26') === '2026-01-01')

// O que NAO pode virar data no prontuario.
conferir('"30" em 2026 nao vira 1930 nem 2030', ler('01/01/30') === null)
conferir('31/02 nao existe', ler('31/02/2020') === null)
conferir('29/02 em ano bissexto existe', ler('29/02/2020') === '2020-02-29')
conferir('29/02 em ano comum nao existe', ler('29/02/2021') === null)
conferir('Mes 13 nao existe', ler('01/13/2020') === null)
conferir('Nascimento no futuro e erro de digitacao', ler('01/12/2026') === null)
conferir('Texto livre fica sem data', ler('março de 2019') === null)
// Painel de familias simuladas (14/10/2026): mes por extenso e data no meio
// da frase eram aceitos na ficha e o cadastro saia sem data.
conferir('Mês por extenso', ler('12 de março de 2020') === '2020-03-12', `veio ${ler('12 de março de 2020')}`)
conferir('Mês abreviado sem "de"', ler('5 mar 2019') === '2019-03-05')
conferir('Mês por extenso em maiúsculas', ler('12 DE MARCO DE 2020') === '2020-03-12')
conferir('Data no meio da frase', ler('Lucas Ferreira Campos, nasceu 03/05/2022') === '2022-05-03')
conferir('Data depois de uma reclamação', ler('ja falei kkk 03/05/2022') === '2022-05-03')
conferir('Duas datas na frase: nenhuma', ler('nasceu 03/05/2022, consulta 21/10/2026') === null)
conferir('Hora não vira data', ler('as 10:30') === null)
conferir('Telefone não vira data', ler('13 99123-4567') === null)
conferir('Vazio fica sem data', ler('') === null)

console.log(`Datas: ${passou} verificações passaram.`)
if (falhas.length) {
  console.log(`FALHAS: ${falhas.length}`)
  for (const f of falhas) console.log(`✗ ${f}`)
  process.exit(1)
}
