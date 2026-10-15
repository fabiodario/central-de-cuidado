// Alergia, peso e altura que vao para a Memed quando a consulta aberta nao tem.
// Dados inventados.
import {
  dadosParaMemed,
  avisoDoQueFoiParaMemed,
  hojeEmSaoPaulo,
} from './dados-para-memed.build.mjs'

let ok = 0
let falhas = 0
function confere(nome, cond, detalhe) {
  if (cond) ok++
  else {
    falhas++
    console.error('FALHOU:', nome, detalhe ?? '')
  }
}

const c = (id, data, campos = {}) => ({ id, data, peso: '', altura: '', alergias: '', ...campos })
const HOJE = '2026-09-24'

{
  // O caso que motivou: alergia escrita na primeira consulta, retorno sem ela.
  const primeira = c('a', '2026-06-10', { alergias: 'Amoxicilina' })
  const retorno = c('b', '2026-09-24')
  const d = dadosParaMemed(retorno, [retorno, primeira], HOJE)
  confere('retorno herda a alergia da primeira consulta', d.alergias?.valor === 'Amoxicilina')
  confere('e diz de onde veio', d.alergias?.daConsultaAtual === false && d.alergias?.data === '2026-06-10')
}
{
  const atual = c('b', HOJE, { alergias: 'Dipirona', peso: '12,4' })
  const d = dadosParaMemed(atual, [atual, c('a', '2026-09-01', { alergias: 'Amoxicilina', peso: '11' })], HOJE)
  confere('a consulta atual manda na alergia', d.alergias?.valor === 'Dipirona' && d.alergias.daConsultaAtual)
  confere('a consulta atual manda no peso', d.peso?.valor === '12,4' && d.peso.daConsultaAtual)
}
{
  const atual = c('b', HOJE)
  const d = dadosParaMemed(atual, [atual, c('a', '2026-09-10', { peso: '11,2' })], HOJE)
  confere('peso de 14 dias atras vale', d.peso?.valor === '11,2')
}
{
  const atual = c('b', HOJE)
  const d = dadosParaMemed(atual, [atual, c('a', '2026-07-01', { peso: '10', altura: '80' })], HOJE)
  confere('peso de quase 3 meses atras NAO vale', d.peso === null)
  confere('altura de 85 dias ainda vale', d.altura?.valor === '80')
}
{
  // A mais recente com peso e velha, mas existe uma mais antiga ainda: nao
  // pode pular para ela.
  const atual = c('c', HOJE)
  const d = dadosParaMemed(atual, [c('a', '2026-01-01', { peso: '9' }), atual, c('b', '2026-06-01', { peso: '10' })], HOJE)
  confere('nao pula para consulta ainda mais antiga', d.peso === null)
}
{
  const atual = c('b', HOJE)
  const d = dadosParaMemed(atual, [atual, c('x', '2026-10-15', { alergias: 'Ibuprofeno', peso: '13' })], HOJE)
  confere('consulta futura nao e historico', d.alergias === null && d.peso === null)
}
{
  const d = dadosParaMemed(null, [c('a', '2026-09-20', { alergias: '<p><br></p>', peso: '12' })], HOJE)
  confere('sem consulta aberta usa o historico', d.peso?.valor === '12')
  confere('alergia so com HTML vazio nao conta', d.alergias === null)
}

// --- o aviso para o medico ---
const vazio = { semAlergia: false, reconhecidas: [], naoReconhecidas: [], falhas: [] }
const atualDipirona = { alergias: { valor: 'Dipirona', data: HOJE, daConsultaAtual: true }, peso: null, altura: null }
{
  const a = avisoDoQueFoiParaMemed(atualDipirona, { ...vazio, reconhecidas: [{ termo: 'dipirona', id: 622, nome: 'dipirona' }] }, true)
  confere('alerta ligado aparece', a?.tipo === 'info' && /ligado.*dipirona/.test(a.texto), JSON.stringify(a))
}
{
  const a = avisoDoQueFoiParaMemed(atualDipirona, { ...vazio, falhou: true }, null)
  confere('busca falhou e vermelho e diz NAO', a?.tipo === 'erro' && /NÃO está ligado/.test(a.texto))
}
{
  const a = avisoDoQueFoiParaMemed(atualDipirona, { ...vazio, reconhecidas: [{ termo: 'dipirona', id: 622, nome: 'dipirona' }] }, false)
  confere('Memed recusou e vermelho', a?.tipo === 'erro' && /recusou/.test(a.texto))
}
{
  const a = avisoDoQueFoiParaMemed(atualDipirona, { ...vazio, naoReconhecidas: ['aplv'] }, null)
  confere('alergia fora da lista aparece pelo nome', a?.tipo === 'info' && /aplv/.test(a.texto))
}
{
  const d = { alergias: null, peso: { valor: '11,2 kg', data: '2026-09-10', daConsultaAtual: false }, altura: null }
  const a = avisoDoQueFoiParaMemed(d, vazio, null)
  confere('peso de outra consulta e avisado com a data', a?.texto === 'Peso enviado: 11,2 kg, da consulta de 10/09.', a?.texto)
}
confere('nada a dizer, nada aparece', avisoDoQueFoiParaMemed({ alergias: null, peso: null, altura: null }, vazio, null) === null)
{
  const d = { alergias: { valor: 'amoxicilina', data: '2026-06-10', daConsultaAtual: false }, peso: null, altura: null }
  const a = avisoDoQueFoiParaMemed(d, { ...vazio, reconhecidas: [{ termo: 'amoxicilina', id: 174, nome: 'amoxicilina' }] }, true)
  confere('alergia herdada diz de qual consulta', /consulta de 10\/06/.test(a?.texto ?? ''), a?.texto)
}

// 23h30 de Sao Paulo ja e o dia seguinte em UTC: a data tem que ser a daqui.
confere('hoje no fuso de Sao Paulo', hojeEmSaoPaulo(new Date('2026-09-25T02:30:00Z')) === '2026-09-24')

console.log(`Dados para a Memed: ${ok} verificações passaram.`)
if (falhas) {
  console.error(`FALHAS: ${falhas}`)
  process.exit(1)
}
