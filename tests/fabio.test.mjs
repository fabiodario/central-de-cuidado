// O que o robo ganhou no consultorio do Dr. Fabio Dario (15/10/2026).
//
// O motor e o do Dr. Marcello, e tests/atendimento.test.mjs continua provando
// o perfil pediatrico de origem (clinica "c1"). Aqui fica o perfil 'geral' do
// otorrino, conversando pelo simulador com a identidade de verdade:
//  - o alerta de sangramento (pedido do Dr. Fabio, relatorio da Cintia);
//  - os varios convenios de Santos;
//  - a ficha de quem pode ser adulto: motivo da consulta, responsavel so de
//    menor de idade, ano com dois digitos;
//  - as frases faladas com o proprio paciente.
import assert from 'node:assert/strict'
import { falouDeSangramento, faltamNaFicha } from './atendimento.build.mjs'
import { Simulacao } from './simulador.build/sessao.mjs'
import { IDENTIDADES, FAMILIAS } from './simulador.build/dados.mjs'
import { copiarAgenda } from './simulador.build/agenda.mjs'

let ok = 0
async function caso(nome, fn) {
  try {
    await fn()
    ok++
  } catch (erro) {
    console.error('FALHOU:', nome)
    throw erro
  }
}

const FABIO = IDENTIDADES.fabio
// Quarta, 14/10/2026, 10:00 e 22:00 em Brasilia.
const QUARTA_10H = Date.parse('2026-10-14T13:00:00Z')
const QUARTA_22H = Date.parse('2026-10-15T01:00:00Z')

function nova(familia = 'nova', inicio = QUARTA_10H, agenda) {
  let agora = inicio
  return new Simulacao(FABIO, FAMILIAS[familia], { relogio: () => new Date((agora += 30000)), ...(agenda ? { agenda } : {}) })
}

/** Conversa por texto ou por toque ("#id"), devolvendo a ultima rodada. */
async function conversar(s, passos) {
  let ultima = null
  let rodada = null
  for (const passo of passos) {
    let entrada = { texto: passo }
    if (passo.startsWith('#')) {
      const id = passo.slice(1)
      const opcao = ultima?.toques?.opcoes.find((o) => o.id === id)
      assert.ok(opcao, `o toque ${id} nao existe (tem: ${ultima?.toques?.opcoes.map((o) => o.id).join(', ') ?? 'nenhum'})`)
      entrada = { texto: opcao.titulo, idDoToque: id }
    }
    rodada = await s.enviarDaFamilia(entrada)
    ultima = [...rodada.respostas].reverse().find((m) => m.toques) ?? ultima
  }
  return { ...rodada, texto: rodada.respostas.map((m) => m.texto).join('\n'), ultima }
}

// ---------------------------------------------------------------
// Sangramento: a leitura da frase
// ---------------------------------------------------------------

await caso('sangramento: as formas que avisam', () => {
  for (const frase of [
    'meu nariz está sangrando muito',
    'Sangramento nasal frequente',
    'saiu sangue do ouvido',
    'tive uma hemorragia depois da cirurgia',
    'acho que é epistaxe',
    'meu nariz não para de sangrar',
    'NÃO PARA DE SANGRAR',
    'secreção sanguinolenta',
    'sangrou de novo hoje',
    'tive sangramento ontem mas hoje não sangrou',
  ]) {
    assert.equal(falouDeSangramento(frase), true, frase)
  }
})

await caso('sangramento: negado ou nome de exame nao avisa', () => {
  for (const frase of [
    'nariz entupido, sem sangramento',
    'não tem sangramento nenhum',
    'nunca sangrou',
    'não teve hemorragia',
    'preciso do pedido de exame de sangue',
    'quando faço a coleta de sangue?',
    'nariz entupido e ronco',
    'quero marcar uma consulta',
  ]) {
    assert.equal(falouDeSangramento(frase), false, frase)
  }
})

// ---------------------------------------------------------------
// Sangramento: a conversa
// ---------------------------------------------------------------

await caso('sangramento no horario: alerta para o Dr. Fabio e a Dayane, pronto-socorro do convenio, e a conversa vai para a equipe', async () => {
  const s = nova('nova')
  const r = await conversar(s, ['Oi, meu nariz está sangrando muito'])
  assert.equal(r.alertas.length, 1)
  assert.deepEqual(r.alertas[0].para, ['Dr. Fábio', 'Dayane'])
  assert.match(r.texto, /Já avisei o Dr\. Fábio e a Dayane no celular/)
  assert.match(r.texto, /Pronto-Socorro mais próximo que atenda ao seu plano de saúde \(Porto Saúde, Unimed, Santa Saúde\)/)
  assert.doesNotMatch(r.texto, /Ana Costa/, 'nenhum hospital fixo')
  assert.equal(s.motivo, 'sangramento')
  assert.equal(s.etapa, 'atendente')
})

await caso('sangramento fora do horario: nao espere a resposta, o alerta saiu do mesmo jeito', async () => {
  const s = nova('cadastrada', QUARTA_22H)
  const r = await conversar(s, ['Boa noite, operei o septo e está sangrando'])
  assert.equal(r.alertas.length, 1)
  assert.match(r.texto, /fora do horário de atendimento/)
  assert.match(r.texto, /Não espere a nossa resposta\. Em caso de urgência, emergência ou sangramento intenso/)
})

await caso('sangramento repetido: alerta de novo, texto curto', async () => {
  const s = nova('cadastrada')
  await conversar(s, ['meu nariz está sangrando'])
  const r = await conversar(s, ['continua sangrando, não para'])
  assert.equal(r.alertas.length, 1, 'cada mensagem nova reavisa o celular')
  assert.match(r.texto, /O alerta já está com o Dr\. Fábio e a Dayane/)
  assert.doesNotMatch(r.texto, /Já avisei/, 'o aviso inteiro nao se repete logo abaixo do primeiro')
})

await caso('sangramento no meio do agendamento: alerta, e a etapa continua de pe', async () => {
  const s = nova('cadastrada')
  await conversar(s, ['Oi', '2'])
  assert.equal(s.etapa, 'aguardando_unidade')
  const r = await conversar(s, ['ah, e as vezes sangra o nariz'])
  assert.equal(r.alertas.length, 1)
  assert.match(r.texto, /Para continuar de onde paramos/)
  assert.equal(s.etapa, 'aguardando_unidade', 'o agendamento nao podia se perder')
})

await caso('sangramento como motivo da consulta: fica anotado, alerta sai e a ficha segue', async () => {
  const s = nova('nova')
  await conversar(s, ['Oi', '#2', '#1', '#1', '#1', 'Paulo Henrique Souza', '03/02/1979'])
  assert.equal(s.etapa, 'dados_motivo')
  const r = await conversar(s, ['Tenho sangramento no nariz quase todo dia'])
  assert.equal(r.alertas.length, 1)
  assert.equal(s.etapa, 'dados_cpf', 'a ficha devia seguir para o CPF')
  assert.match(r.texto, /Enquanto isso, para terminar a ficha da consulta/)
  // A proxima mensagem e a resposta do CPF: convidar a "escrever o que esta
  // acontecendo" faria o relato cair como CPF que nao confere.
  assert.doesNotMatch(r.texto, /escreva aqui o que está acontecendo/)
  const [consulta] = s.consultas()
  assert.match(String(consulta.intake_complaint), /sangramento no nariz/i)
})

await caso('mae com dois filhos: o comprovante do fim da ficha traz o nome de quem vai consultar', async () => {
  const s = nova('irmaos')
  const r = await conversar(s, ['Oi', '#2', '#2', '#2', '#2', '#1', '#1', 'Ronca muito e dorme de boca aberta'])
  assert.match(r.texto, /Consulta marcada!/)
  assert.match(r.texto, /👤 Theo Souza Lima/, 'sem o nome, a mae nao sabe de qual filho e a consulta')
})

await caso('exame de sangue na 2a via nao dispara alerta', async () => {
  const s = nova('cadastrada')
  const r = await conversar(s, ['Oi', '5', '2', 'pedido de exame de sangue, hemograma'])
  assert.equal(r.alertas.length, 0)
  assert.notEqual(s.motivo, 'sangramento')
})

// ---------------------------------------------------------------
// Convenios
// ---------------------------------------------------------------

await caso('lista de unidades diz qual atende convenio', async () => {
  const s = nova('nova')
  const r = await conversar(s, ['Oi', '2'])
  assert.match(r.texto, /Santos · Boqueirão \([^)]*· convênio ou particular\)/)
  assert.match(r.texto, /Higienópolis · São Paulo \([^)]*· particular\)/)
})

await caso('Santos: os tres planos e o particular na lista', async () => {
  const s = nova('nova')
  const r = await conversar(s, ['Oi', '2', '2'])
  assert.equal(s.etapa, 'aguardando_convenio')
  assert.deepEqual(r.ultima.toques.opcoes.map((o) => o.titulo), ['Porto Saúde', 'Unimed Santos', 'Santa Saúde', 'Particular', 'Falar com a equipe', 'Voltar ao menu'])
})

for (const [escrito, plano] of [['unimed', 'Unimed Santos'], ['é porto', 'Porto Saúde'], ['Santa Saúde', 'Santa Saúde'], ['3', 'Santa Saúde'], ['vai ser particular', '']]) {
  await caso(`convenio escrito "${escrito}" vira ${plano || 'particular'} na consulta`, async () => {
    const s = nova('cadastrada')
    await conversar(s, ['Oi', '2', '2', escrito])
    assert.equal(s.etapa, 'aguardando_dia', `"${escrito}" devia escolher e seguir para as datas`)
    await conversar(s, ['1', '1'])
    const [consulta] = s.consultas()
    assert.equal(consulta.insurance, plano)
  })
}

await caso('plano que Santos nao atende: explica, oferece o particular e nao diz "nao entendi"', async () => {
  const s = nova('nova')
  const r = await conversar(s, ['Oi', '2', '2', 'Tenho Amil, dá pra usar?'])
  assert.match(r.texto, /O plano \*Amil\* não está entre os convênios atendidos em Santos · Boqueirão/)
  assert.match(r.texto, /Porto Saúde, Unimed Santos e Santa Saúde/)
  assert.doesNotMatch(r.texto, /Não entendi/)
  assert.equal(s.etapa, 'aguardando_convenio')
})

await caso('Higienopolis e particular: nao pergunta convenio', async () => {
  const s = nova('nova')
  await conversar(s, ['Oi', '2', '1'])
  assert.equal(s.etapa, 'aguardando_dia')
})

// ---------------------------------------------------------------
// A ficha de quem pode ser adulto
// ---------------------------------------------------------------

await caso('adulto: sem responsavel, com o motivo da consulta, e a contagem certa', async () => {
  const s = nova('nova')
  let r = await conversar(s, ['Oi', '#2', '#1', '#1', '#1'])
  assert.match(r.texto, /Para completar a ficha da consulta, 5 perguntas rápidas/)
  assert.match(r.texto, /nome completo do paciente\*\?/)
  r = await conversar(s, ['Carla Mendes Rocha', '22/08/1988'])
  assert.equal(s.etapa, 'dados_motivo', 'adulto nao devia receber a pergunta do responsavel')
  assert.match(r.texto, /motivo da consulta/)
  await conversar(s, ['Ronco e nariz entupido', 'PULAR', 'carla@exemplo.com'])
  const [consulta] = s.consultas()
  assert.equal(consulta.intake_complaint, 'Ronco e nariz entupido')
  assert.equal(s.pacientes().length, 1, 'o cadastro devia nascer no fim da ficha')
})

await caso('ano com dois digitos: "15/03/85" e adulto, e o cadastro guarda 1985', async () => {
  const s = nova('nova')
  await conversar(s, ['Oi', '#2', '#1', '#1', '#1', 'Joana Ribeiro', '15/03/85'])
  assert.equal(s.etapa, 'dados_motivo')
  await conversar(s, ['PULAR', 'PULAR', 'PULAR'])
  const [paciente] = s.pacientes()
  assert.equal(paciente.birth_date, '1985-03-15')
})

await caso('menor de idade: o responsavel e perguntado', async () => {
  const s = nova('nova')
  await conversar(s, ['Oi', '#2', '#1', '#1', '#1', 'Lucas Pereira', '10/06/2017'])
  assert.equal(s.etapa, 'dados_responsavel')
})

await caso('paciente cadastrado: so o motivo da consulta', async () => {
  const s = nova('cadastrada')
  const r = await conversar(s, ['Oi', '#2', '#1', '#1', '#1'])
  assert.match(r.texto, /Para completar a ficha da consulta, uma pergunta rápida/)
  assert.equal(s.etapa, 'dados_motivo')
})

await caso('ficha pendente do lembrete: adulto nao deve responsavel', () => {
  const base = { patient_id: null, intake_patient_name: 'Carla', intake_cpf: '', intake_email: '' }
  const adulto = faltamNaFicha({ ...base, intake_birth_date: '22/08/1988', intake_guardian: '' }, FABIO.clinicId)
  assert.equal(adulto.faltaObrigatoria, false, 'adulto com nome e data tem o obrigatorio')
  assert.ok(!adulto.faltam.includes('responsavel'))
  const crianca = faltamNaFicha({ ...base, intake_birth_date: '10/06/2017', intake_guardian: '' }, FABIO.clinicId)
  assert.equal(crianca.faltaObrigatoria, true, 'crianca sem responsavel ainda deve o obrigatorio')
  assert.ok(crianca.faltam.includes('responsavel'))
})

// ---------------------------------------------------------------
// Falando com o proprio paciente
// ---------------------------------------------------------------

await caso('menu: a frase da Dayane, sem "seu filho"', async () => {
  const s = nova('nova')
  const r = await conversar(s, ['Oi'])
  assert.match(r.texto, /Seja muito bem-vindo\(a\) ao consultório do Dr\. Fábio Dario/)
  assert.match(r.texto, /Estamos à disposição para ajudar com informações, agendamentos e dúvidas/)
  assert.doesNotMatch(r.texto, /seu filho|criança/)
})

await caso('paciente adulto cadastrado e cumprimentado pelo nome', async () => {
  const s = nova('cadastrada')
  const r = await conversar(s, ['Oi'])
  assert.match(r.texto, /^Olá, Ricardo! 👋/)
})

await caso('mae com filho cadastrado: o vocativo sai, como na pediatria', async () => {
  const s = new Simulacao(FABIO, { ...FAMILIAS.irmaos, pacientes: ['helena'] }, { relogio: () => new Date(QUARTA_10H) })
  const r = await conversar(s, ['Oi'])
  assert.match(r.texto, /^Olá! 👋 Que bom falar com você de novo/)
})

await caso('assunto clinico: o robo nao orienta, e nao fala em crianca', async () => {
  const s = nova('cadastrada')
  const r = await conversar(s, ['Estou com sinusite e dor de cabeça, posso tomar antibiótico?'])
  assert.match(r.texto, /é lá que o Dr\. Fábio examina e decide o que precisa investigar/)
  assert.doesNotMatch(r.texto, /criança/)
})

await caso('urgencia sem sangramento: pronto-socorro do convenio, sem alerta de sangramento', async () => {
  const s = nova('cadastrada')
  const r = await conversar(s, ['é urgente, estou com muita falta de ar'])
  assert.equal(r.alertas.length, 0)
  assert.equal(s.motivo, 'urgencia')
  assert.match(r.texto, /Pronto-Socorro mais próximo que atenda ao seu plano de saúde/)
  assert.doesNotMatch(r.texto, /criança/)
})

await caso('perguntas do dia a dia caem nas respostas do consultorio', async () => {
  const pares = [
    ['Vocês tratam ronco?', /Respirar bem é viver melhor/],
    ['O Dr. Fábio faz rinoplastia?', /Função e estética em equilíbrio/],
    ['Vocês atendem Porto Saúde?', /Porto Saúde\*, \*Unimed Santos\* e \*Santa Saúde/],
    ['Atende criança?', /atende \*crianças e adultos\*/],
    ['O que preciso levar na consulta?', /Para a consulta, traga/],
  ]
  for (const [pergunta, esperado] of pares) {
    const s = nova('nova')
    const r = await conversar(s, [pergunta])
    assert.match(r.texto, esperado, pergunta)
  }
})

await caso('a agenda mexida na tela nao derruba o perfil: unidade com um plano so segue o caminho de sempre', async () => {
  const agenda = copiarAgenda(FABIO.agendaPadrao)
  agenda.unidades = agenda.unidades.map((u) => (u.id === 'unidade-santos' ? { ...u, convenio: 'Unimed Santos' } : u))
  const s = nova('nova', QUARTA_10H, agenda)
  const r = await conversar(s, ['Oi', '2', '2'])
  assert.deepEqual(r.ultima.toques.opcoes.map((o) => o.titulo), ['Unimed Santos', 'Particular'])
})

console.log(`fabio.test: ${ok} casos ok`)
