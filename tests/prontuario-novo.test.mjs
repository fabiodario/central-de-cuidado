// Heranca das consultas anteriores, prazo do retorno e curvas da OMS.
// Dados inventados.
import {
  herancaDasAnteriores,
  aplicarHeranca,
  desfazerHeranca,
  temConteudo,
} from './continuidade-da-consulta.build.mjs'
import { prazoDoRetorno, somarDias, janelaDoRetorno, agruparPorDia } from './retorno.build.mjs'
import {
  lmsNaIdade,
  valorNoEscore,
  escoreZ,
  pontosDoPaciente,
  classificar,
  idadeEmMeses,
  idadeLegivel,
  janelaDeIdade,
} from './curvas.build.mjs'
import { readFileSync } from 'node:fs'

let ok = 0
let falhas = 0
function confere(nome, cond, detalhe) {
  if (cond) ok++
  else {
    falhas++
    console.error('FALHOU:', nome, detalhe ?? '')
  }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const HOJE = '2026-09-25'
const vazio = { alergias: '', antecedentesPessoais: '', antecedentesFamiliares: '', medicamentos: '' }
const c = (id, data, campos = {}) => ({ id, data, criadoEm: `${data}T10:00:00Z`, ...vazio, ...campos })

// ---------------------------------------------------------------- heranca
{
  const lista = [
    c('a', '2026-03-01', { antecedentesPessoais: 'Prematuro 34s', alergias: 'Amoxicilina' }),
    c('b', '2026-06-01', { medicamentos: 'Omeprazol 10 mg' }),
    c('c', '2026-09-01', { medicamentos: 'Omeprazol 20 mg', alergias: '<p><br></p>' }),
    c('futura', '2026-12-01', { alergias: 'Dipirona' }),
  ]
  const h = herancaDasAnteriores(lista, null, HOJE)
  const mapa = Object.fromEntries(h.map((x) => [x.campo, x]))
  confere('alergia vem da consulta que a tem, mesmo antiga', mapa.alergias?.valor === 'Amoxicilina' && mapa.alergias.data === '2026-03-01')
  confere('HTML vazio nao conta como alergia', mapa.alergias?.valor !== '<p><br></p>')
  confere('medicamentos vem da mais recente', mapa.medicamentos?.valor === 'Omeprazol 20 mg')
  confere('antecedentes da primeira consulta continuam', mapa.antecedentesPessoais?.valor === 'Prematuro 34s')
  confere('campo que nunca foi escrito nao aparece', !mapa.antecedentesFamiliares)
  confere('consulta futura nao e historico', h.every((x) => x.valor !== 'Dipirona'))
  confere('a propria consulta nao herda de si', herancaDasAnteriores([c('x', '2026-09-01', { alergias: 'Ovo' })], 'x', HOJE).length === 0)

  const form = { ...vazio, medicamentos: 'Escrito hoje', queixa: 'dor' }
  const { formulario, aplicada } = aplicarHeranca(form, h)
  confere('nao sobrescreve o que foi escrito hoje', formulario.medicamentos === 'Escrito hoje')
  confere('preenche o campo vazio', formulario.alergias === 'Amoxicilina')
  confere('aplicada lista so o que entrou', !aplicada.some((x) => x.campo === 'medicamentos'))
  confere('campos de fora da heranca ficam', formulario.queixa === 'dor')

  const editado = { ...formulario, antecedentesPessoais: 'Prematuro 34s, UTI 10 dias' }
  const desfeito = desfazerHeranca(editado, aplicada)
  confere('desfazer limpa o herdado intacto', desfeito.alergias === '')
  confere('desfazer preserva o que o medico editou', desfeito.antecedentesPessoais === 'Prematuro 34s, UTI 10 dias')
  confere('temConteudo com nbsp e vazio', !temConteudo('&nbsp; <br>') && temConteudo('<p>x</p>'))
}

// ---------------------------------------------------------------- retorno
const prazos = [
  ['Retorno em 30 dias', 30],
  ['retorno 1 mês', 30],
  ['Retornar em 3 meses com exames', 90],
  ['<p>Retorno em <b>6 semanas</b></p>', 42],
  ['retorno em tres meses', 90],
  ['Retorno 1 ano', 365],
  ['15d', 15],
  ['2m', 60],
  ['Retorno se piorar', null],
  ['', null],
  ['Retorno em 40 anos', null],
]
for (const [texto, esperado] of prazos) {
  confere(`prazo de "${texto}"`, prazoDoRetorno(texto) === esperado, String(prazoDoRetorno(texto)))
}
confere('somar dias atravessa o mes', somarDias('2026-09-25', 30) === '2026-10-25')
confere('somar dias atravessa o ano', somarDias('2026-12-20', 15) === '2027-01-04')
confere('janela comeca 3 dias antes', igual(janelaDoRetorno('2026-10-25', HOJE), { de: '2026-10-22', ate: '2026-11-04' }))
confere('janela nunca comeca no passado', janelaDoRetorno('2026-09-26', HOJE).de === HOJE)
{
  const grupos = agruparPorDia(['2026-10-23T12:00:00Z', '2026-10-22T13:00:00Z', '2026-10-22T02:30:00Z'])
  // 02:30 UTC de 22/10 e 23:30 de 21/10 em Sao Paulo.
  confere('agrupa pelo dia de Sao Paulo', igual(grupos.map((g) => g.dia), ['2026-10-21', '2026-10-22', '2026-10-23']), JSON.stringify(grupos))
}

// ---------------------------------------------------------------- curvas
// Confere o calculo contra as linhas de desvio publicadas pela OMS (tabela de
// peso para idade, meninos, 0 a 5 anos), que vem arredondadas a 0,1 kg.
{
  const oms = JSON.parse(readFileSync(new URL('./fixtures/oms-peso-meninos-sd.json', import.meta.url), 'utf8'))
  let pior = 0
  for (const linha of oms) {
    const lms = lmsNaIdade('peso', 'M', linha.mes)
    for (const [z, publicado] of [[-2, linha.m2], [0, linha.z0], [2, linha.p2], [3, linha.p3]]) {
      pior = Math.max(pior, Math.abs(valorNoEscore(lms.L, lms.M, lms.S, z) - publicado))
    }
  }
  confere('linhas -2, 0, +2, +3 batem com a OMS (0 a 60 meses)', pior <= 0.051, `pior diferenca ${pior}`)
}
{
  const lms = lmsNaIdade('altura', 'F', 120)
  const valor = valorNoEscore(lms.L, lms.M, lms.S, 1.5)
  confere('escore-z desfaz o valor no escore', Math.abs(escoreZ(valor, lms.L, lms.M, lms.S) - 1.5) < 1e-9)
  const meio = lmsNaIdade('peso', 'M', 12.5)
  const antes = lmsNaIdade('peso', 'M', 12)
  const depois = lmsNaIdade('peso', 'M', 13)
  confere('interpola entre os meses', Math.abs(meio.M - (antes.M + depois.M) / 2) < 1e-9)
  confere('fora da tabela nao inventa', lmsNaIdade('peso', 'M', 121) === null && lmsNaIdade('imc', 'F', 229) === null)
}
{
  const nascimento = '2024-03-10'
  const consultas = [
    { data: '2025-03-10', peso: '9,6', altura: '75,7' },
    { data: '2025-09-10', peso: '', altura: '82' },
    { data: '2026-03-10', peso: '12,2 kg', altura: '87,1' },
    { data: '2026-03-10', peso: '12,2', altura: '87,1' },
  ]
  const peso = pontosDoPaciente(consultas, nascimento, 'M', 'peso')
  confere('consulta sem peso fica de fora do peso', peso.length === 2, JSON.stringify(peso))
  confere('mesmo dia vale uma vez', new Set(peso.map((p) => p.data)).size === peso.length)
  confere('peso mediano aos 12 meses da z perto de 0', Math.abs(peso[0].z) < 0.1, String(peso[0].z))
  const imc = pontosDoPaciente(consultas, nascimento, 'M', 'imc')
  confere('IMC so com peso e altura do mesmo dia', imc.length === 2)
  confere('idade em meses', Math.abs(idadeEmMeses(nascimento, '2025-03-10') - 12) < 0.05)
  confere('idade legivel', idadeLegivel(12) === '1 a' && idadeLegivel(27.4) === '2 a 3 m' && idadeLegivel(5) === '5 m')
  // O aniversario de 1 ano (365 dias) nao pode sair "11 m".
  confere('aniversario exato vira ano cheio', idadeLegivel(idadeEmMeses(nascimento, '2025-03-10')) === '1 a' && idadeLegivel(idadeEmMeses(nascimento, '2026-03-10')) === '2 a')
  confere('medida antes do nascimento fica de fora', pontosDoPaciente([{ data: '2024-01-01', peso: '3', altura: '' }], nascimento, 'M', 'peso').length === 0)
  const [de, ate] = janelaDeIdade(peso, 30, 'peso')
  confere('janela cobre os pontos e a idade atual', de <= 12 && ate >= 30)
}
confere('baixo peso abaixo de -2', classificar('peso', -2.5, 20) === 'Baixo peso')
confere('estatura adequada acima de -2', classificar('altura', 2.8, 20) === 'Estatura adequada')
confere('IMC antes dos 5: risco de sobrepeso', classificar('imc', 1.5, 30) === 'Risco de sobrepeso')
confere('IMC depois dos 5: sobrepeso', classificar('imc', 1.5, 80) === 'Sobrepeso')
confere('IMC acima de +3 aos 10 anos: obesidade grave', classificar('imc', 3.2, 120) === 'Obesidade grave')

console.log(`Prontuário (herança, retorno, curvas): ${ok} verificações passaram.`)
if (falhas) {
  console.error(`FALHAS: ${falhas}`)
  process.exit(1)
}
