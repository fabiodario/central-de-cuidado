// Bateria do texto que vai para o PDF assinado.
//
// Este e o unico teste do projeto em que um erro nao da tela quebrada nem
// mensagem errada: da um documento com valor juridico dizendo uma coisa
// diferente do que o medico escreveu. Depois de assinado nao ha conserto -
// so um adendo admitindo o erro. Por isso cada caso aqui e um jeito concreto
// de o texto sair torto.
import {
  blocosDaConsulta,
  htmlParaTexto,
  idadeEm,
  identificacaoDoPaciente,
  medidasDaConsulta,
  quebrarEmLinhas,
  tituloDoAtendimento,
} from './prontuario.build.mjs'

let passou = 0
const falhas = []

function conferir(titulo, condicao, detalhe = '') {
  if (condicao) passou++
  else falhas.push(`${titulo}${detalhe ? ` | ${detalhe}` : ''}`)
}

const consultaVazia = {
  consultation_date: '2026-09-03',
  encounter_type: 'initial',
  unit: 'Santos',
  weight_kg: null,
  height_cm: null,
  chief_complaint: '',
  clinical_history: '',
  personal_history: '',
  family_history: '',
  allergies: '',
  current_medications: '',
  physical_exam: '',
  assessment: '',
  cid: '',
  plan: '',
  prescription: '',
  return_plan: '',
}

// ---------------------------------------------------------------------------
// HTML do editor virando texto
// ---------------------------------------------------------------------------

conferir(
  'Parágrafos separados não grudam numa linha só',
  htmlParaTexto('<p>Dipirona 500mg</p><p>Amoxicilina 250mg</p>') ===
    'Dipirona 500mg\nAmoxicilina 250mg',
  JSON.stringify(htmlParaTexto('<p>Dipirona 500mg</p><p>Amoxicilina 250mg</p>')),
)

conferir(
  'Item de lista se anuncia como item',
  htmlParaTexto('<ul><li>Febre</li><li>Tosse</li></ul>') === '• Febre\n• Tosse',
  JSON.stringify(htmlParaTexto('<ul><li>Febre</li><li>Tosse</li></ul>')),
)

conferir(
  '<br> vira quebra de linha',
  htmlParaTexto('Manhã<br>Noite') === 'Manhã\nNoite',
)

conferir(
  'Negrito e itálico somem sem levar o texto junto',
  htmlParaTexto('<p>Dor <strong>forte</strong> à <em>palpação</em></p>') ===
    'Dor forte à palpação',
  JSON.stringify(htmlParaTexto('<p>Dor <strong>forte</strong> à <em>palpação</em></p>')),
)

conferir(
  '&nbsp; vira espaço de verdade',
  htmlParaTexto('<p>10&nbsp;mg</p>') === '10 mg',
)

conferir(
  '&amp; é decodificado por último e não engole o resto',
  htmlParaTexto('<p>&amp;lt;3 anos</p>') === '&lt;3 anos',
  JSON.stringify(htmlParaTexto('<p>&amp;lt;3 anos</p>')),
)

conferir(
  'Sinal de menor escapado volta como menor',
  htmlParaTexto('<p>Peso &lt; 10 kg</p>') === 'Peso < 10 kg',
)

conferir(
  'Parágrafos vazios do editor não viram buracos',
  htmlParaTexto('<p>A</p><p></p><p></p><p>B</p>') === 'A\n\nB',
  JSON.stringify(htmlParaTexto('<p>A</p><p></p><p></p><p>B</p>')),
)

conferir('Campo nulo devolve vazio', htmlParaTexto(null) === '')
conferir('Só tags devolve vazio', htmlParaTexto('<p></p><br>') === '')

// ---------------------------------------------------------------------------
// Idade - em pediatria os meses sao informacao clinica
// ---------------------------------------------------------------------------

conferir('Bebê de 8 meses aparece em meses', idadeEm('2026-01-03', '2026-09-03') === '8 meses')
conferir('Um mês no singular', idadeEm('2026-08-03', '2026-09-03') === '1 mês')
conferir(
  'Abaixo de dois anos continua em meses',
  idadeEm('2025-01-03', '2026-09-03') === '20 meses',
  idadeEm('2025-01-03', '2026-09-03'),
)
conferir('A partir de dois anos vira anos', idadeEm('2024-09-03', '2026-09-03') === '2 anos')
conferir(
  'Anos e meses quando sobra resto',
  idadeEm('2024-03-03', '2026-09-03') === '2 anos e 6 meses',
  idadeEm('2024-03-03', '2026-09-03'),
)
conferir(
  'Aniversário ainda não feito no mês não conta a mais',
  idadeEm('2024-09-20', '2026-09-03') === '23 meses',
  idadeEm('2024-09-20', '2026-09-03'),
)
conferir('Sem data de nascimento não inventa idade', idadeEm(null, '2026-09-03') === '')
conferir(
  'Nascimento depois da consulta não vira idade negativa',
  idadeEm('2027-01-01', '2026-09-03') === '',
)

// ---------------------------------------------------------------------------
// Medidas
// ---------------------------------------------------------------------------

conferir(
  'Peso, altura e IMC juntos, com vírgula decimal',
  medidasDaConsulta({ ...consultaVazia, weight_kg: 32.5, height_cm: 138 }) ===
    'Peso 32,5 kg · Altura 138 cm · IMC 17,1',
  medidasDaConsulta({ ...consultaVazia, weight_kg: 32.5, height_cm: 138 }),
)

conferir(
  'Só o peso não inventa IMC',
  medidasDaConsulta({ ...consultaVazia, weight_kg: 32.5 }) === 'Peso 32,5 kg',
)

conferir('Sem medidas, linha vazia', medidasDaConsulta(consultaVazia) === '')

// ---------------------------------------------------------------------------
// Blocos: campo vazio NAO entra
// ---------------------------------------------------------------------------

const consultaCheia = {
  ...consultaVazia,
  weight_kg: 20,
  height_cm: 110,
  chief_complaint: '<p>Dor abdominal há 3 dias</p>',
  physical_exam: '<p>Abdome flácido</p>',
  assessment: '<p>Constipação funcional</p>',
  plan: '<ul><li>Aumentar fibras</li><li>Retorno em 30 dias</li></ul>',
}

const blocos = blocosDaConsulta(consultaCheia)
const titulos = blocos.map((b) => b.titulo)

conferir(
  'Alergias em branco não vira bloco "Alergias: —"',
  !titulos.includes('Alergias'),
  titulos.join(', '),
)

conferir(
  'Os blocos preenchidos aparecem na ordem clínica',
  titulos.join(' > ') === 'Medidas > Queixa principal > Exame físico > Hipótese diagnóstica > Conduta',
  titulos.join(' > '),
)

conferir(
  'A conduta em lista mantém os itens separados',
  blocos.find((b) => b.titulo === 'Conduta')?.texto === '• Aumentar fibras\n• Retorno em 30 dias',
  JSON.stringify(blocos.find((b) => b.titulo === 'Conduta')?.texto),
)

conferir(
  'Consulta sem nada escrito não gera bloco nenhum',
  blocosDaConsulta(consultaVazia).length === 0,
)

conferir(
  'Campo só com tag vazia não vira bloco',
  blocosDaConsulta({ ...consultaVazia, allergies: '<p><br></p>' }).length === 0,
)

// ---------------------------------------------------------------------------
// Identificacao e titulo
// ---------------------------------------------------------------------------

const identificacao = identificacaoDoPaciente(
  {
    name: 'Ana Beatriz Souza',
    birth_date: '2019-05-10',
    sex: 'F',
    guardian_name: 'Marina Souza',
    insurance: 'Bradesco Saúde',
  },
  consultaVazia,
)[0].texto

conferir(
  'Identificação traz nome, nascimento com idade, sexo, responsável e convênio',
  identificacao ===
    'Ana Beatriz Souza\nNascimento 10/05/2019 (7 anos e 3 meses) · Feminino\nResponsável: Marina Souza\nConvênio: Bradesco Saúde',
  JSON.stringify(identificacao),
)

const semDados = identificacaoDoPaciente(
  { name: 'João', birth_date: null, sex: null, guardian_name: null, insurance: null },
  consultaVazia,
)[0].texto

conferir(
  'Paciente sem cadastro completo mostra só o nome, sem linhas vazias',
  semDados === 'João',
  JSON.stringify(semDados),
)

conferir(
  'Título do atendimento tem tipo, data e unidade',
  tituloDoAtendimento(consultaVazia) === 'Consulta inicial · 03/09/2026 · Santos',
  tituloDoAtendimento(consultaVazia),
)

conferir(
  'Tipo desconhecido não quebra o título',
  tituloDoAtendimento({ ...consultaVazia, encounter_type: 'sei_la', unit: null }) ===
    'Atendimento · 03/09/2026',
  tituloDoAtendimento({ ...consultaVazia, encounter_type: 'sei_la', unit: null }),
)

// ---------------------------------------------------------------------------
// Quebra de linha - aqui "medir" e o numero de caracteres
// ---------------------------------------------------------------------------

const medir = (s) => s.length

conferir(
  'Texto curto fica numa linha só',
  quebrarEmLinhas('Dor abdominal', 20, medir).join('|') === 'Dor abdominal',
)

conferir(
  'Texto longo quebra entre palavras',
  quebrarEmLinhas('Dor abdominal há três dias sem febre', 15, medir).join('|') ===
    'Dor abdominal|há três dias|sem febre',
  quebrarEmLinhas('Dor abdominal há três dias sem febre', 15, medir).join('|'),
)

conferir(
  'Palavra maior que a linha é partida em vez de sumir da margem',
  quebrarEmLinhas('pneumoultramicroscopicossilicovulcanoconiotico', 10, medir).every(
    (l) => l.length <= 10,
  ),
  quebrarEmLinhas('pneumoultramicroscopicossilicovulcanoconiotico', 10, medir).join('|'),
)

conferir(
  'Nenhuma letra se perde ao partir a palavra',
  quebrarEmLinhas('pneumoultramicroscopicossilicovulcanoconiotico', 10, medir).join('') ===
    'pneumoultramicroscopicossilicovulcanoconiotico',
)

conferir(
  'Linha em branco entre parágrafos é preservada',
  quebrarEmLinhas('A\n\nB', 20, medir).join('|') === 'A||B',
  quebrarEmLinhas('A\n\nB', 20, medir).join('|'),
)

// ---------------------------------------------------------------------------

console.log(`\nProntuário: ${passou} verificações passaram.`)
if (falhas.length) {
  console.error(`\n${falhas.length} falharam:`)
  for (const falha of falhas) console.error(`  - ${falha}`)
  process.exit(1)
}
