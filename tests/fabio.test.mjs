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
import { readFileSync } from 'node:fs'
import {
  falouDeSangramento, faltamNaFicha, sinalDeAlarme, falouDePosOperatorio,
  recusaDeEscolha, sangramentoAtivo, nomeDito, despedida, pediuAgendamento, horaEscrita,
  chamandoAlguem, pediuAtendente, perguntouSeTemAlguem, naoFoiRespondida, etiquetaQueFica,
  avisoDoLembrete, negouConsulta, pareceBotao,
} from './atendimento.build.mjs'
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
  // Pos-operatorio e sangramento ativo: a primeira frase manda ir (rodada 2).
  assert.match(r.texto, /procure o pronto-socorro agora, sem esperar a nossa resposta/)
  assert.match(r.texto, /Em caso de urgência, emergência ou sangramento intenso/)
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
  // A urgencia avisa o celular (desde 16/10/2026, como em producao), mas nao
  // como sangramento.
  assert.equal(r.alertas.length, 1)
  assert.match(r.alertas[0].titulo, /^🚨 Urgência/)
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

// ---------------------------------------------------------------
// Painel de pacientes simulados (16/10/2026)
//
// 40 pacientes, cada um em duas redacoes, conversando com o robo de verdade
// (tests/painel). Cada caso abaixo e uma falha que o juiz achou, com a frase
// do paciente simulado. Na primeira rodada, 14 de 80 conversas passaram.
// ---------------------------------------------------------------

await caso('sinal de alarme: as frases do painel avisam', () => {
  const casos = [
    ['socorro meu filho de 4 anos enfiou um feijao no nariz e nao sai, o que eu faço??', 'corpo_estranho'],
    ['ajuda meu filho colocou um grao de feijao na narina e nao sai oq eu faco, ele tem 4 anos', 'corpo_estranho'],
    ['Bom dia. Engoli uma espinha de peixe ontem no jantar e está doendo muito para engolir.', 'corpo_estranho'],
    ['espinha de peixe presa na garganta desde ontem, nao consigo nem engolir agua direito', 'corpo_estranho'],
    ['entrou um bicho no ouvido do meu filho', 'corpo_estranho'],
    ['meu filho engoliu uma pilha', 'corpo_estranho'],
    ['Acordei hoje sem ouvir nada do ouvido direito. Ontem à noite estava normal.', 'surdez'],
    ['qria marcar consulta o mais rapido possivel, acordei surda do ouvido direito', 'surdez'],
    ['perdi a audição de repente', 'surdez'],
    ['bom dia to com tontura mto forte vomitando nao consigo fica de pe', 'tontura'],
    ['tudo rodando nao consigo levanta ja vomitei 3 vez', 'tontura'],
    ['to mal nao paro de vomita oq eu faço', 'tontura'],
    ['Meu bebê de 8 meses está com um barulho estranho pra respirar e parece muito cansado', 'respiracao'],
    ['meu bb de 8 meses ta chiando mto pra respira e cansadinho oq eu faço', 'respiracao'],
    ['ele ta com falta de ar, é grave??', 'respiracao'],
    ['ele está respirando com dificuldade AGORA', 'respiracao'],
    ['não consigo engolir nem água', 'engolir'],
    ['minha garganta ta tao inflamada que nao desce nem agua', 'engolir'],
    ['acordei com a boca torta', 'rosto'],
    ['operei as amígdalas e estou com febre', 'pos_operatorio'],
    ['to passando mal', 'mal_estar'],
  ]
  for (const [frase, tipo] of casos) assert.equal(sinalDeAlarme(frase), tipo, frase)
})

await caso('sinal de alarme: a queixa de sempre do consultorio nao vira pronto-socorro', () => {
  for (const frase of [
    'nariz entupido há meses',
    'tenho dificuldade para respirar pelo nariz',
    'não consigo respirar pelo nariz à noite',
    'meu filho não respira direito à noite, ronca muito',
    'ele faz barulho pra respirar quando dorme',
    'ronco muito e acordo cansado',
    'tenho um chiado no ouvido',
    'zumbido no ouvido há 2 anos',
    'tenho labirintite, queria marcar',
    'tontura de vez em quando',
    'dor de garganta',
    'estou com uma espinha no nariz',
    'faz anos que não escuto direito do ouvido esquerdo',
    'a cirurgia de septo dói muito?',
    'durmo muito mal',
    'quero marcar para meu filho de 4 anos',
    'coloquei soro no nariz',
  ]) {
    assert.equal(sinalDeAlarme(frase), null, frase)
  }
})

await caso('feijao no nariz: pronto-socorro na primeira resposta, alerta, urgencia, e nada de propaganda', async () => {
  const s = nova('nova')
  const r = await conversar(s, ['socorro meu filho de 4 anos enfiou um feijao no nariz e nao sai, o que eu faço??'])
  assert.match(r.texto, /Pelo que você contou, procure atendimento agora, sem esperar pela consulta/)
  assert.match(r.texto, /Pronto-Socorro mais próximo que atenda ao seu plano de saúde/)
  assert.doesNotMatch(r.texto, /Respirar bem é viver melhor/)
  assert.equal(r.alertas.length, 1)
  assert.equal(s.motivo, 'urgencia')
  assert.equal(s.etapa, 'atendente')
})

await caso('surdez subita no pedido de marcar: urgencia, e nao a agenda comum', async () => {
  const s = nova('nova')
  const r = await conversar(s, ['qria marcar consulta o mais rapido possivel, acordei surda do ouvido direito'])
  assert.match(r.texto, /procure atendimento agora/)
  assert.doesNotMatch(r.texto, /Em qual unidade/)
  assert.equal(s.motivo, 'urgencia')
})

// O 192 saiu da mensagem padrao (16/10/2026, decisao do Edu): soava como se o
// medico nao quisesse resolver. Fica so para quem diz que nao tem como ir.
await caso('bebe com barulho pra respirar: pronto-socorro agora, sem o 192 na mensagem padrao', async () => {
  const s = nova('nova')
  const r = await conversar(s, ['Meu bebê de 8 meses está com um barulho estranho pra respirar e parece muito cansado, o que eu faço??'])
  assert.match(r.texto, /procure atendimento agora/)
  assert.doesNotMatch(r.texto, /192/)
  assert.equal(s.motivo, 'urgencia')
})

await caso('alarme no meio do agendamento: orienta, avisa, e a agenda continua de pe', async () => {
  const s = nova('nova')
  await conversar(s, ['Oi', '2', '2', '4'])
  assert.equal(s.etapa, 'aguardando_dia')
  const r = await conversar(s, ['so sexta?? nao tem nada hj? nao consigo engolir'])
  assert.match(r.texto, /procure atendimento agora/)
  assert.match(r.texto, /Se ainda quiser marcar uma consulta para depois/)
  assert.equal(r.alertas.length, 1)
  assert.equal(s.etapa, 'aguardando_dia', 'nao podia ler "sexta" e abrir os horarios')
})

await caso('alarme fora do horario: nao espere a nossa resposta', async () => {
  const s = nova('nova', QUARTA_22H)
  const r = await conversar(s, ['tudo rodando nao consigo levanta ja vomitei 3 vez'])
  assert.match(r.texto, /fora do horário de atendimento/)
  assert.match(r.texto, /Não espere a nossa resposta/)
})

await caso('"socorro" e "e emergencia" sao urgencia; "nao e emergencia" nao e', async () => {
  for (const frase of ['socorro', 'e emergencia']) {
    const s = nova('nova')
    await conversar(s, ['Oi'])
    const r = await conversar(s, [frase])
    assert.match(r.texto, /Entendi que é urgência/, frase)
    assert.equal(s.motivo, 'urgencia', frase)
  }
  const s = nova('nova')
  await conversar(s, ['Oi'])
  await conversar(s, ['não é emergência, só queria saber o endereço'])
  assert.notEqual(s.motivo, 'urgencia')
})

await caso('sangramento na fila: "vou pro PS ou espero?" recebe o nao espere, e nunca enderecos', async () => {
  const s = nova('cadastrada')
  await conversar(s, ['Operei o septo há uma semana e está saindo sangue pela boca e pelo nariz'])
  assert.equal(s.motivo, 'sangramento')
  for (const pergunta of [
    'Está saindo bastante, já cuspi várias vezes. Vou para o pronto-socorro do hospital onde operei ou espero o Dr. Fábio me ligar?',
    'Não entendi. Eu vou para o pronto-socorro agora?',
    'vo pro ps entao ou espero o dr me ligar?',
  ]) {
    const r = await conversar(s, [pergunta])
    assert.match(r.texto, /O alerta já está com o Dr\. Fábio e a Dayane/, pergunta)
    assert.match(r.texto, /Não espere a nossa resposta/, pergunta)
    assert.doesNotMatch(r.texto, /Onde o Dr\. Fábio atende|continua na fila/, pergunta)
  }
})

await caso('sangramento repetido tambem diz para nao esperar', async () => {
  const s = nova('nova')
  await conversar(s, ['faz uns 20 min q ta saindo sangue do nariz e nao para oq eu faço'])
  const r = await conversar(s, ['ta descendo sangue pela garganta tbm. vou pro ps ou espero vcs?'])
  assert.match(r.texto, /Não espere a nossa resposta/)
})

await caso('operado escrevendo vai para a equipe, sem propaganda', async () => {
  assert.equal(falouDePosOperatorio('oi bom dia, operei o septo com o dr fabio semana passada'), true)
  assert.equal(falouDePosOperatorio('vou operar o septo, quanto custa?'), false)
  const s = nova('cadastrada')
  const r = await conversar(s, ['oi bom dia, operei o septo com o dr fabio semana passada'])
  assert.doesNotMatch(r.texto, /Respirar bem é viver melhor/)
  assert.match(r.texto, /equipe do Dr\. Fábio, que acompanha o pós-operatório/)
  assert.equal(s.etapa, 'atendente')
})

await caso('pedido de remedio: a trava clinica pega, e a insistencia recebe a frase curta', async () => {
  for (const frase of [
    'posso tomar amoxicilina pra sinusite? so hj ate passar no medico',
    'garganta inflamada e o corpo quente faz 2 dias, qual anti inflamatorio eu tomo? nimesulida serve?',
    'posso pingar otosporin no ouvido? ta saindo pus',
  ]) {
    const s = nova('nova')
    const r = await conversar(s, [frase])
    assert.match(r.texto, /não posso orientar sobre sintomas, exames ou remédios/, frase)
    assert.doesNotMatch(r.texto, /Respirar bem é viver melhor/, frase)
  }
  const s = nova('nova')
  await conversar(s, ['posso tomar amoxicilina pra sinusite?'])
  const r = await conversar(s, ['ta mas posso ou nao? sobrou umas capsulas aqui, tomo 1 hj e pronto?'])
  assert.match(r.texto, /só o Dr\. Fábio pode orientar, depois de examinar/)
  assert.doesNotMatch(r.texto, /Dúvidas sobre a consulta/, 'o menu inteiro nao se repete')
})

// --- Pedido de gente, "alo", outro medico ---

await caso('pedido de gente dentro da frase vai para a equipe, sem "Como e a consulta"', async () => {
  for (const frase of [
    'NINGUEM ME RESPONDE, QUERO FALAR COM UMA PESSOA',
    'ATENDENTE!!!',
    'Queria falar com a Dayane, é sobre um pedido de exame',
    'dayane?',
    'Oi, a Dayane está?',
    'bom dia dayane, aqui é a Sonia. o dr fabio me deu um pedido de exame e preciso tirar uma duvida com vc',
    'gostaria de falar com alguém sobre o valor',
  ]) {
    const s = nova('nova')
    await conversar(s, ['Oi'])
    const r = await conversar(s, [frase])
    assert.match(r.texto, /direcionando você para alguém da nossa equipe/, frase)
    assert.doesNotMatch(r.texto, /Como é a consulta/, frase)
    assert.equal(s.etapa, 'atendente', frase)
  }
})

await caso('quem reclama da demora ouve um pedido de desculpas', async () => {
  const s = nova('nova')
  const r = await conversar(s, ['CADE A ATENDENTE??? TO TENTANDO FAZ 2 DIAS'])
  assert.match(r.texto, /^Desculpe a demora! 🙏/)
  assert.equal(s.etapa, 'atendente')
})

await caso('paciente com o nome da secretaria nao vai para a equipe', async () => {
  const s = nova('nova')
  await conversar(s, ['Oi', '#2', '#1', '#1', '#1'])
  assert.equal(s.etapa, 'dados_nome')
  await conversar(s, ['Dayane Souza Lima'])
  assert.equal(s.etapa, 'dados_nascimento', 'na ficha, o nome e resposta')
  const s2 = nova('nova')
  const r = await conversar(s2, ['Oi, aqui é a Dayane, quero marcar uma consulta'])
  assert.match(r.texto, /Em qual unidade/)
})

await caso('na fila, pedir gente de novo recebe o aviso uma vez', async () => {
  const s = nova('nova')
  await conversar(s, ['Oi', '9'])
  const r1 = await conversar(s, ['alguem ai?'])
  assert.match(r1.texto, /Sua conversa já está na fila da nossa equipe/)
  const r2 = await conversar(s, ['9'])
  assert.equal(r2.respostas.length, 0, 'o aviso nao se repete logo abaixo')
})

await caso('"alo", "alguem ai?" e "??" recebem "estou aqui", e nao "nao entendi"', async () => {
  for (const frase of ['alo', 'alguem ai?', '??']) {
    const s = nova('nova')
    await conversar(s, ['Oi'])
    const r = await conversar(s, [frase])
    assert.match(r.texto, /Estou aqui! Sou o atendimento automático do consultório/, frase)
    assert.doesNotMatch(r.texto, /Não entendi/, frase)
  }
})

await caso('outro medico citado: aqui e o consultorio do Dr. Fabio', async () => {
  for (const [frase, nome] of [
    ['É do consultório do Dr. Marcelo? Quero remarcar com ele.', 'O Dr\\. Marcelo'],
    ['preciso remarca minha consulta c dr marcelo', 'O Dr\\. Marcelo'],
    ['quero marcar com a dra Ana', 'A Dra\\. Ana'],
  ]) {
    const s = nova('nova')
    const r = await conversar(s, [frase])
    assert.match(r.texto, new RegExp(`Aqui é o consultório do Dr\\. Fábio\\. ${nome} não atende aqui`), frase)
  }
  for (const frase of [
    'boa dia. queria marca uma consulta com o doutor. tenho zumbido no ouvido e nao escuto bem',
    'oi bebe de 1 ano pode passar com o dr? queria marcar mas nao sei se é cedo demais',
    'quero marcar com o dr fabio',
  ]) {
    const s = nova('nova')
    const r = await conversar(s, [frase])
    assert.doesNotMatch(r.texto, /não atende aqui/, frase)
  }
})

// --- Respostas prontas ---

await caso('respostas prontas novas: video, estacionamento, horarios, exames, guia, retorno, aparelho e audio', async () => {
  for (const [pergunta, esperado] of [
    ['Dá pra fazer a consulta online, por vídeo?', /As consultas com o Dr\. Fábio são \*presenciais\*/],
    ['tem lugar pra estacionar?', /A informação de estacionamento de cada unidade a nossa equipe confirma/],
    ['Vocês atendem aos sábados?', /Não há atendimento à noite nem aos fins de semana/],
    ['vcs fazem audiometria ai? e nasofibroscopia tbm?', /Quais exames são feitos no consultório/],
    ['Para consultar eu preciso de guia ou de encaminhamento do clínico geral?', /Se o seu plano pede guia, autorização ou encaminhamento/],
    ['o retorno é pago?', /O prazo do retorno e se ele é cobrado/],
    ['Vocês vendem aparelho auditivo?', /Sobre aparelho auditivo, a nossa equipe confirma/],
    ['posso mandar audio? escrevo mal', /Pode mandar áudio, sim/],
  ]) {
    const s = nova('nova')
    const r = await conversar(s, [pergunta])
    assert.match(r.texto, esperado, pergunta)
  }
})

await caso('assunto que a equipe confirma: responde, acende para a equipe e deixa marcar', async () => {
  const s = nova('nova')
  const r = await conversar(s, ['oi quanto custa a consulta particular?'])
  assert.match(r.texto, /a nossa equipe passa por aqui/)
  assert.match(r.texto, /Já passei sua pergunta para a nossa equipe/)
  assert.equal(s.motivo, 'atendente')
  assert.equal(s.etapa, 'menu', 'a conversa nao vai para a fila')
  const r2 = await conversar(s, ['ta, queria marcar em higienopolis terça a tarde'])
  assert.match(r2.texto, /Horários de terça, 20\/10 \(tarde\)/)
})

await caso('a mesma pergunta de novo vai para a equipe, e nunca "esta logo acima"', async () => {
  const s = nova('nova')
  await conversar(s, ['Dá pra fazer a consulta online, por vídeo?'])
  const r = await conversar(s, ['Mas e por vídeo, tem teleconsulta?'])
  assert.match(r.texto, /Para não repetir a mesma resposta, passei sua pergunta para a nossa equipe/)
  assert.doesNotMatch(r.texto, /logo acima/)
  assert.equal(s.etapa, 'atendente')
})

await caso('"nao respondeu" vai para a equipe', async () => {
  const s = nova('nova')
  await conversar(s, ['quanto tempo dura a consulta?'])
  const r = await conversar(s, ['Obrigada, mas não respondeu. E o retorno, paga de novo?'])
  assert.match(r.texto, /Desculpe! 🙏 Estou direcionando você/)
})

await caso('pergunta com dois assuntos recebe as duas respostas', async () => {
  const s = nova('nova')
  const r = await conversar(s, ['Bom dia! Quanto tempo dura a consulta com o Dr. Fábio? E o retorno é cobrado à parte?'])
  assert.match(r.texto, /A consulta dura cerca de 40 minutos/)
  assert.match(r.texto, /O prazo do retorno e se ele é cobrado/)
  assert.doesNotMatch(r.texto, /Consulta com o Dr\. Fábio\*/, '"quanto tempo" nao e pergunta de valor')
})

await caso('plano que nao e atendido e dito com o nome, tambem na segunda pergunta', async () => {
  const s = nova('nova')
  const r = await conversar(s, ['aceita amil?'])
  assert.match(r.texto, /O plano \*Amil\* não está entre os convênios atendidos pelo Dr\. Fábio/)
  const s2 = nova('nova')
  await conversar(s2, ['vocês atendem convênio?'])
  const r2 = await conversar(s2, ['mas a amil nao cobre?'])
  assert.match(r2.texto, /O plano \*Amil\* não está entre os convênios atendidos/)
  assert.doesNotMatch(r2.texto, /Para não repetir/)
})

await caso('Unimed de outra cidade nao vira a Unimed Santos', async () => {
  const s = nova('cadastrada')
  await conversar(s, ['Oi', '2', '2'])
  assert.equal(s.etapa, 'aguardando_convenio')
  const r = await conversar(s, ['tenho unimed paulistana'])
  assert.match(r.texto, /O plano \*Unimed Paulistana\* não está entre os convênios atendidos em Santos · Boqueirão/)
  assert.equal(s.etapa, 'aguardando_convenio')
})

await caso('pergunta sobre recibo nao e pedido de nota, e reembolso nao abre a agenda', async () => {
  const s = nova('nova')
  const r = await conversar(s, ['Bom dia. Tenho Bradesco Saúde. Consigo pedir reembolso da consulta com o Dr. Fábio? Vocês dão recibo ou nota fiscal?'])
  assert.doesNotMatch(r.texto, /Anotei o pedido de \*nota fiscal/)
  assert.doesNotMatch(r.texto, /Em qual unidade/)
  assert.match(r.texto, /Emitimos recibo para você pedir reembolso/)
  assert.match(r.texto, /O plano \*Bradesco Saúde\* não está entre os convênios atendidos/)
})

await caso('rinoplastia e cirurgia pelo convenio: valor e cobertura a equipe confirma', async () => {
  let s = nova('nova')
  let r = await conversar(s, ['Oi, tudo bem? O Dr. Fábio faz rinoplastia? Quanto custa a cirurgia mais ou menos?'])
  assert.match(r.texto, /O valor de cirurgias, como a rinoplastia, é passado depois da consulta de avaliação/)
  assert.doesNotMatch(r.texto, /R\$/)
  s = nova('nova')
  r = await conversar(s, ['porto saude cobre operaçao de septo? quero ter certeza'])
  assert.match(r.texto, /Valores e cobertura do seu plano a nossa equipe confirma/)
})

await caso('"boa noite" e cumprimento, e "qual o horario de atendimento?" e respondido sem abrir a agenda', async () => {
  let s = nova('nova')
  let r = await conversar(s, ['Boa noite'])
  assert.doesNotMatch(r.texto, /Dias e horários/)
  assert.match(r.texto, /Como podemos ajudar hoje/)
  s = nova('nova')
  r = await conversar(s, ['Qual o horário de atendimento? Atende à noite?'])
  assert.match(r.texto, /Não há atendimento à noite nem aos fins de semana/)
  assert.doesNotMatch(r.texto, /Em qual unidade/)
})

// --- Agenda: o que o pedido ja diz ---

await caso('o pedido ja diz plano e unidade: direto para as datas, com o convenio guardado', async () => {
  for (const [frase, plano] of [
    ['oi tenho unimed santos, sinusite toda hora, qro marcar com otorrino em santos', 'Unimed Santos'],
    ['oi, sinusite de novo. queria consulta semana q vem de manha pela unimed santos. ana paula ribeiro, 34 anos', 'Unimed Santos'],
    ['ola aqui e o antonio meu plano e santa saude quero uma consulta em santos', 'Santa Saúde'],
  ]) {
    const s = nova('nova')
    const r = await conversar(s, [frase])
    assert.equal(s.etapa, 'aguardando_dia', frase)
    assert.match(r.texto, /Datas disponíveis em Santos · Boqueirão/, frase)
    await conversar(s, ['1', '1'])
    assert.equal(s.consultas()[0].insurance, plano, frase)
  }
})

await caso('a queixa contada no pedido vira o motivo da consulta, sem perguntar de novo', async () => {
  const s = nova('cadastrada')
  await conversar(s, ['oi, sinusite toda hora, quero marcar em santos pela unimed santos', '1'])
  const r = await conversar(s, ['1'])
  assert.match(r.texto, /Consulta marcada!/)
  assert.doesNotMatch(r.texto, /motivo da consulta/)
  assert.match(r.texto, /💳 Unimed Santos/)
  assert.match(String(s.consultas()[0].intake_complaint), /sinusite toda hora/)
})

await caso('irmaos: "pro teo" e o Theo, e "pelo porto em santos" vai direto para as datas', async () => {
  const s = nova('irmaos')
  const r = await conversar(s, ['bom dia queria marca consulta pro teo pelo porto em santos'])
  assert.equal(s.etapa, 'aguardando_dia')
  assert.match(r.texto, /pela \*Porto Saúde\*/)
  await conversar(s, ['1', '1'])
  const [consulta] = s.consultas()
  assert.equal(consulta.patient_id, 'paciente-theo')
  assert.equal(consulta.insurance, 'Porto Saúde')
  const s2 = nova('irmaos')
  await conversar(s2, ['Oi', '2'])
  assert.equal(s2.etapa, 'aguardando_paciente')
  await conversar(s2, ['teo'])
  assert.equal(s2.etapa, 'aguardando_unidade', '"teo" e o Theo')
})

await caso('plano que nao vale na unidade pedida, ou em nenhuma: avisa antes da lista', async () => {
  const s = nova('nova')
  const r = await conversar(s, ['Oi! Quero marcar uma consulta no Tatuapé pela Unimed'])
  assert.match(r.texto, /Em \*Tatuapé · São Paulo\* a consulta é particular/)
  assert.match(r.texto, /A \*Unimed Santos\* é atendida em \*Santos · Boqueirão\*/)
  const s2 = nova('nova')
  const r2 = await conversar(s2, ['Oi, bom dia. Queria marcar uma consulta em Santos pela Amil'])
  assert.match(r2.texto, /O plano \*Amil\* não está entre os convênios atendidos/)
})

await caso('voltar de Santos pela Unimed para o Tatuape nao leva o convenio junto', async () => {
  const s = nova('cadastrada')
  await conversar(s, ['Oi', '2', '2', '2'])
  assert.equal(s.etapa, 'aguardando_dia')
  await conversar(s, ['VOLTAR', '3', '1', '1'])
  const [consulta] = s.consultas()
  assert.equal(consulta.unit_id, 'unidade-tatuape')
  assert.equal(consulta.insurance, '', 'o Tatuape e so particular')
})

// --- Agenda: dia e hora como se fala ---

await caso('"sexta dia 23", "23", "quinta 22": o dia do mes vale; "sexta dia 22", que nao bate, nao escolhe', async () => {
  for (const [passos, frase, esperado] of [
    [['Oi', '2', '2', '4'], 'sexta dia 23', /Horários de sexta, 23\/10/],
    [['Oi', '2', '2', '4'], '23', /Horários de sexta, 23\/10/],
    [['Oi', '2', '3'], 'ta, entao particular mesmo. quinta 22', /Horários de quinta, 22\/10/],
    [['Oi', '2', '2', '4'], 'sexta dia 22', /As sextas com horário livre são: 16\/10, 23\/10 e 30\/10/],
  ]) {
    const s = nova('cadastrada')
    await conversar(s, passos)
    const r = await conversar(s, [frase])
    assert.match(r.texto, esperado, frase)
  }
})

await caso('hora por extenso, com o periodo, e numero que e hora', async () => {
  for (const [passos, hora, esperado] of [
    [['Oi', '2', '2', '4', '2'], 'as duas horas da tarde', /segunda, 19\/10 às 14:00/],
    [['Oi', '2', '2', '4', '2'], '2 da tarde', /segunda, 19\/10 às 14:00/],
    [['Oi', '2', '2', '4', '2'], '4 da tarde', /segunda, 19\/10 às 16:00/],
    [['Oi', '2', '2', '4', '2'], '2pm', /segunda, 19\/10 às 14:00/],
    [['Oi', '2', '2', '4', '1'], 'nove e vinte', /sexta, 16\/10 às 09:20/],
    [['Oi', '2', '2', '4', '1'], '10', /sexta, 16\/10 às 10:00/],
  ]) {
    const s = nova('cadastrada')
    await conversar(s, passos)
    assert.equal(s.etapa, 'aguardando_horario', hora)
    const r = await conversar(s, [hora])
    assert.match(r.texto, esperado, hora)
  }
})

await caso('dia que nao cabe na lista: a manha, a tarde citada, "Ver a tarde", e a hora vale para o dia inteiro', async () => {
  const s = nova('cadastrada')
  let r = await conversar(s, ['Oi', '2', '1', '1'])
  assert.match(r.texto, /Horários de terça, 20\/10 \(manhã\)/)
  assert.match(r.texto, /À tarde também há: 14:00, 14:40, 15:20, 16:00, 16:40, 17:20/)
  assert.ok(r.ultima.toques.opcoes.some((o) => o.id === 'TARDE' && o.titulo === '🌇 Ver a tarde'), 'a lista oferece a tarde')
  // O toque chega como o id da opcao (ver enviarDaFamilia).
  r = await conversar(s, ['TARDE'])
  assert.match(r.texto, /Horários de terça, 20\/10 \(tarde\)/)
  const s2 = nova('cadastrada')
  await conversar(s2, ['Oi', '2', '1', '1'])
  r = await conversar(s2, ['tem as 16h? de manha ele dorme'])
  assert.match(r.texto, /terça, 20\/10 às 16:00/, 'o 16:00 estava livre, fora dos seis da manha')
})

await caso('"segunda de manha" num dia so de tarde diz isso e cita as manhas; a lista de dias diz o periodo', async () => {
  const s = nova('cadastrada')
  let r = await conversar(s, ['Oi', '2', '2', '4'])
  assert.match(r.texto, /\*1\* sexta, 16\/10 \(manhã · 6 horários\)/)
  assert.match(r.texto, /\*2\* segunda, 19\/10 \(tarde · 6 horários\)/)
  r = await conversar(s, ['segunda de manha'])
  assert.match(r.texto, /Em segunda, 19\/10 só há horário à tarde/)
  assert.match(r.texto, /De manhã, os próximos dias são: sexta, 16\/10, quarta, 21\/10, sexta, 23\/10/)
})

await caso('"nao tem nada antes?" e pergunta: o primeiro horario, e a unidade que tem antes', async () => {
  const s = nova('nova')
  await conversar(s, ['Oi', '2', '1'])
  assert.equal(s.etapa, 'aguardando_dia')
  const r = await conversar(s, ['Só dia 20? Não tem nada antes?'])
  assert.match(r.texto, /O primeiro horário em \*Higienópolis · São Paulo\* é terça, 20\/10 às 08:00/)
  assert.match(r.texto, /Em \*Tatuapé · São Paulo\* há antes: quinta, 15\/10 às 14:00/)
  assert.doesNotMatch(r.texto, /Horários de/)
  assert.equal(s.etapa, 'aguardando_dia')
})

await caso('"qual tem horario mais cedo", "a q tiver amanha" e "o quanto antes" escolhem a unidade do primeiro horario', async () => {
  for (const frase of ['qual tem horario mais cedo', 'tanto faz, a q tiver mais cedo', 'a q tiver amanha']) {
    const s = nova('nova')
    await conversar(s, ['Oi', '2'])
    const r = await conversar(s, [frase])
    assert.match(r.texto, /O horário mais cedo é em \*Tatuapé · São Paulo\*: quinta, 15\/10 às 14:00/, frase)
    assert.match(r.texto, /Datas disponíveis em Tatuapé/, frase)
  }
  const s = nova('nova')
  const r = await conversar(s, ['Bom dia, preciso de uma consulta o quanto antes, particular, em qualquer unidade. Qual o primeiro horário?'])
  assert.match(r.texto, /O horário mais cedo é em \*Tatuapé · São Paulo\*/)
  assert.doesNotMatch(r.texto, /Consulta com o Dr\. Fábio\*/, '"particular" e "o quanto antes" nao sao pergunta de valor')
})

await caso('unidade com erro de digitacao, correcao no meio dos dias e "outra unidade"', async () => {
  let s = nova('nova')
  await conversar(s, ['Oi', '2'])
  let r = await conversar(s, ['higienopoli'])
  assert.match(r.texto, /Datas disponíveis em Higienópolis/)
  s = nova('nova')
  await conversar(s, ['Oi', '2', '2', '4'])
  r = await conversar(s, ['nao, higienopolis'])
  assert.match(r.texto, /Datas disponíveis em Higienópolis/)
  s = nova('nova')
  await conversar(s, ['Oi', '2', '2', '4'])
  r = await conversar(s, ['quero ver outra unidade'])
  assert.match(r.texto, /Em qual unidade/)
})

await caso('resposta pronta na escolha da unidade vem com a lista numerada de novo', async () => {
  const s = nova('nova')
  await conversar(s, ['Oi', '2'])
  const r = await conversar(s, ['qual o endereço de cada uma?'])
  assert.match(r.texto, /Onde o Dr\. Fábio atende/)
  assert.match(r.texto, /\*1\* Higienópolis · São Paulo/)
  const r2 = await conversar(s, ['1'])
  assert.match(r2.texto, /Datas disponíveis em Higienópolis/, 'o 1 vale pela lista nova')
})

await caso('sabado: no pedido e na lista de dias, nenhuma unidade tem', async () => {
  const s = nova('nova')
  const r = await conversar(s, ['queria marcar sabado de manha'])
  assert.match(r.texto, /Não temos horário livre no sábado em nenhuma unidade/)
  const s2 = nova('nova')
  await conversar(s2, ['Oi', '2', '3'])
  const r2 = await conversar(s2, ['nao tem sabado?'])
  assert.match(r2.texto, /Nesta unidade, e nas outras também, não temos horário livre no sábado/)
})

await caso('comprovante diz convenio ou particular', async () => {
  const s = nova('cadastrada')
  const r = await conversar(s, ['Oi', '2', '3', '1', '1', 'nariz entupido'])
  assert.match(r.texto, /Consulta marcada!/)
  assert.match(r.texto, /💳 Particular/)
})

// --- Ficha, remarcar e cancelar ---

await caso('ficha: a muleta antes do nome sai, e "eu mesma" nao e nome', async () => {
  const s = nova('nova')
  await conversar(s, ['Oi', '#2', '#1', '#1', '#1'])
  await conversar(s, ['ja falei, ana paula ribeiro'])
  assert.equal(s.consultas()[0].intake_patient_name, 'Ana Paula Ribeiro')
  const s2 = nova('nova')
  await conversar(s2, ['Oi', '#2', '#1', '#1', '#1', 'Lucas Pereira', '10/06/2017'])
  assert.equal(s2.etapa, 'dados_responsavel')
  await conversar(s2, ['eu, renata andrade'])
  assert.equal(s2.consultas()[0].intake_guardian, 'Renata Andrade')
  const s3 = nova('nova')
  await conversar(s3, ['Oi', '#2', '#1', '#1', '#1', 'Lucas Pereira', '10/06/2017'])
  const r3 = await conversar(s3, ['eu mesma'])
  assert.equal(s3.etapa, 'dados_responsavel')
  assert.match(r3.texto, /Não consegui ler o nome/)
})

await caso('ficha: "eu queria 16h nao 14h" vai para a troca de horario, e nao vira nome', async () => {
  const s = nova('nova')
  await conversar(s, ['Oi', '#2', '#2', '#4', '#2', '#1'])
  assert.equal(s.etapa, 'dados_nome')
  const r = await conversar(s, ['nao!! eu queria 16h nao 14h'])
  // Desde a rodada 3 do painel, a consulta que acabou de ser marcada troca sem
  // o SIM da remarcacao: o mesmo dia, as 16h, e a das 14h cai.
  assert.match(r.texto, /às 16:00\* está guardado/)
  const marcadas = s.consultas().filter((c) => c.status === 'scheduled')
  assert.equal(marcadas.length, 1, 'a das 14h tinha de cair quando a das 16h entrou')
  assert.ok(!s.consultas().some((c) => c.intake_patient_name === 'Nao!! Eu Queria'))
})

await caso('remarcar: o pedido vai direto para a confirmacao, e a data nova sai na mesma unidade', async () => {
  const s = nova('com_consulta')
  let r = await conversar(s, ['Bom dia, preciso remarcar minha consulta'])
  assert.match(r.texto, /Vamos remarcar esta consulta/)
  r = await conversar(s, ['SIM'])
  assert.match(r.texto, /Vamos achar outra data em \*Santos · Boqueirão\*/)
  assert.equal(s.etapa, 'aguardando_dia')
})

await caso('na tela da consulta a frase vale, e "nao vou precisar mais ir" e desmarcar', async () => {
  let s = nova('com_consulta')
  await conversar(s, ['Oi', '4'])
  assert.equal(s.etapa, 'minha_consulta')
  let r = await conversar(s, ['quero trocar'])
  assert.match(r.texto, /Vamos remarcar esta consulta/)
  s = nova('com_consulta')
  await conversar(s, ['Oi', '4'])
  r = await conversar(s, ['cancela'])
  assert.match(r.texto, /Confirma o cancelamento desta consulta/)
  s = nova('com_consulta')
  r = await conversar(s, ['oi, to melhor ja, nao vou precisar mais ir na consulta'])
  assert.match(r.texto, /Confirma o cancelamento desta consulta/)
})

await caso('"e normal levar bebe no otorrino?" e pergunta de secretaria, e nao clinica', async () => {
  const s = nova('nova')
  const r = await conversar(s, ['Oi, bom dia. Desculpa a pergunta, mas o Dr. Fábio atende bebê? Meu filho tem 1 ano. É normal levar bebê no otorrino?'])
  assert.match(r.texto, /atende \*crianças e adultos\*/)
  assert.doesNotMatch(r.texto, /não posso orientar/)
})

// ---------------------------------------------------------------
// Rodada 2 do painel de pacientes simulados (16/10/2026)
// ---------------------------------------------------------------

await caso('rodada 2: "17:20 nao da pra mim, deixa" nao marca nada, e "14h nao posso, so 16h" marca as 16h', async () => {
  let s = nova('nova')
  await conversar(s, ['Oi', '2', '3', '1'])
  assert.equal(s.etapa, 'aguardando_horario')
  let r = await conversar(s, ['17:20 nao da pra mim, deixa. vlw'])
  assert.match(r.texto, /não marquei nada/)
  assert.equal(s.consultas().filter((c) => c.status === 'scheduled').length, 0)
  s = nova('nova')
  await conversar(s, ['Oi', '2', '3', '1'])
  r = await conversar(s, ['14h nao posso, so 16h'])
  assert.match(r.texto, /às 16:00\* está guardado/)
  s = nova('nova')
  await conversar(s, ['Oi', '2', '3', '1'])
  r = await conversar(s, ['17:20 nao da pra mim'])
  assert.match(r.texto, /não marquei esse horário/)
  assert.equal(s.etapa, 'aguardando_horario')
  assert.equal(recusaDeEscolha('as 14h nao da?'), null, 'pergunta nao e recusa')
})

await caso('rodada 2: desistir no meio da ficha pergunta se desmarca, e o SIM desmarca', async () => {
  for (const frase of ['cancelar', 'nao!! eu falei q nao da. nao quero marcar, cancela isso']) {
    const s = nova('nova')
    await conversar(s, ['Oi', '2', '3', '1', '1'])
    assert.equal(s.etapa, 'dados_nome', frase)
    const r = await conversar(s, [frase])
    assert.match(r.texto, /Confirma o cancelamento desta consulta/, frase)
    await conversar(s, ['sim'])
    assert.equal(s.consultas()[0].status, 'cancelled', frase)
  }
})

await caso('rodada 2: sangramento que nao para manda ir ja na primeira frase; o de sempre diz quando nao esperar', async () => {
  assert.equal(sangramentoAtivo('socorro meu nariz ta jorrando sangue faz uns 20 min e nao para'), true)
  assert.equal(sangramentoAtivo('operei o septo e esta saindo sangue pela boca'), true)
  assert.equal(sangramentoAtivo('as vezes sangra o nariz'), false)
  assert.equal(sangramentoAtivo('meu nariz está sangrando'), false)
  let s = nova('nova')
  let r = await conversar(s, ['socorro meu nariz ta jorrando sangue faz uns 20 min e nao para'])
  assert.match(r.texto, /🚨 \*Pelo que você contou, procure o pronto-socorro agora, sem esperar a nossa resposta\.\*/)
  assert.doesNotMatch(r.texto, /192/, 'o 192 so para quem diz que nao tem como ir')
  s = nova('nova')
  r = await conversar(s, ['meu nariz está sangrando'])
  assert.match(r.texto, /Se o sangramento não parou ou é forte, não espere a nossa resposta/)
  r = await conversar(s, ['continua sangrando, não para'])
  assert.match(r.texto, /O alerta já está com o Dr\. Fábio e a Dayane/, 'o aviso forte nao vem inteiro logo abaixo do primeiro')
})

await caso('rodada 2: "socorro" manda ir sem condicional; "consulta urgente" sem sintoma e pressa', async () => {
  let s = nova('nova')
  await conversar(s, ['Oi'])
  let r = await conversar(s, ['socorro'])
  assert.match(r.texto, /Se alguém está passando mal agora, procure atendimento sem esperar a nossa resposta/)
  assert.doesNotMatch(r.texto, /192/)
  s = nova('nova')
  await conversar(s, ['Oi'])
  r = await conversar(s, ['quero consulta urgente, o primeiro horario que tiver'])
  assert.equal(r.alertas.length, 0, 'pressa nao e alerta no celular do medico')
  assert.notEqual(s.motivo, 'urgencia')
  assert.match(r.texto, /O horário mais cedo é em/)
})

await caso('rodada 2: na fila de urgencia, marcar para amanha ouve o nao espere; sozinho ouve o 192; quem vai a UPA ouve a confirmacao', async () => {
  let s = nova('nova')
  await conversar(s, ['meu fiho botou um grao de feijao na narina e nao sai!! oq eu faço'])
  let r = await conversar(s, ['ele ta respirando normal. precisa ir agora msm? nao da pra marcar com o dr pra amanha?'])
  assert.match(r.texto, /não espere pela consulta nem pela nossa resposta: procure atendimento agora/)
  assert.match(r.texto, /Se ainda quiser marcar uma consulta para depois/)
  r = await conversar(s, ['mas nao da pra eu tentar tirar com uma pinça aqui?'])
  assert.match(r.texto, /Por aqui não dá para orientar o que fazer em casa/)
  r = await conversar(s, ['ta bom vou levar ele na upa agora'])
  assert.match(r.texto, /Isso\. A nossa equipe já sabe/)
  assert.equal(r.alertas.length, 0, 'quem ja esta indo nao reavisa o celular')
  s = nova('nova')
  await conversar(s, ['tudo girando aqui nao consigo levanta da cama ja vomitei umas 4 vez'])
  r = await conversar(s, ['to sozinho em casa'])
  assert.match(r.texto, /ligue \*192\* \(SAMU\): eles vão até você/)
  assert.doesNotMatch(r.texto, /orientar o que fazer em casa/, '"sozinho em casa" nao e pergunta de cuidado')
  s = nova('nova')
  await conversar(s, ['meu nariz ta sangrando ha 20 minutos e nao para'])
  r = await conversar(s, ['ok to indo pro PS da Unimed. depois vou precisar marcar consulta com o dr?'])
  assert.match(r.texto, /Depois do atendimento, quando quiser marcar a consulta/)
})

await caso('rodada 2: pergunta da agenda tem a resposta da agenda', async () => {
  let s = nova('nova')
  let r = await conversar(s, ['Qual o horário de atendimento? Atende à noite?'])
  assert.match(r.texto, /Dias e horários com vaga/)
  assert.match(r.texto, /\*Higienópolis · São Paulo\*: terça de manhã e à tarde, das 08:00 às 17:20/)
  assert.match(r.texto, /a última do dia começa às 17:20/)
  r = await conversar(s, ['E qual o último horário do dia? Só saio do trabalho às 18h'])
  assert.match(r.texto, /Às 18h já não há horário\. A última consulta do dia começa às 17:20/)
  assert.doesNotMatch(r.texto, /Dias e horários com vaga/, 'o resumo nao sai de novo logo abaixo do primeiro')
  s = nova('nova')
  r = await conversar(s, ['tem horario dps das 19h? so posso a noite'])
  // Sem o "agora" (rodada 3): sugeria que podia haver vaga a noite depois.
  assert.match(r.texto, /Às 19h não há horário em nenhuma unidade/)
  s = nova('nova')
  await conversar(s, ['Oi'])
  r = await conversar(s, ['e as 8 da manha tem?'])
  assert.match(r.texto, /Às 8h, o primeiro horário livre de cada unidade é: \*Santos · Boqueirão\* \(sexta, 16\/10 às 08:00\)/)
  s = nova('nova')
  r = await conversar(s, ['vcs abrem sabado de manha?'])
  assert.match(r.texto, /Aos sábados e domingos não há atendimento em nenhuma unidade/)
  s = nova('nova')
  await conversar(s, ['Oi', '2'])
  r = await conversar(s, ['e o ultimo da tarde é q horas?'])
  assert.match(r.texto, /a última do dia começa às 17:20/)
  assert.match(r.texto, /Em qual unidade/, 'a lista de unidades volta embaixo')
  assert.equal(pediuAgendamento('Preciso dessa garantia antes de marcar qualquer coisa'), false)
  assert.equal(pediuAgendamento('Não quero marcar agora, só queria saber até que horas o doutor atende'), false)
  assert.equal(pediuAgendamento('nao da pra marcar com o dr pra amanha?'), true)
})

await caso('rodada 2: o leitor de horas, palavra por palavra', () => {
  // "tomo 1 hj e pronto?" era lido como 13h: o "h" de "hj" nao e de hora.
  assert.equal(horaEscrita('tomo 1 hj e pronto?'), null)
  assert.equal(horaEscrita('tem vaga pra 2 hj?'), null)
  assert.deepEqual(horaEscrita('as 14h'), { hora: 14, minuto: null })
  assert.deepEqual(horaEscrita('10h30'), { hora: 10, minuto: 30 })
  assert.deepEqual(horaEscrita('pode ser as oito'), { hora: 8, minuto: null })
  assert.deepEqual(horaEscrita('as duas'), { hora: 14, minuto: null }, 'no consultorio, as duas e de tarde')
  assert.deepEqual(horaEscrita('as 6 da manha'), { hora: 6, minuto: null })
  assert.equal(horaEscrita('as duas unidades'), null, 'artigo, e nao hora')
})

await caso('rodada 2: "as oito", "as duas", dia e hora juntos, "depois das 16h" e a hora que a unidade nao tem', async () => {
  let s = nova('nova')
  await conversar(s, ['Oi', '2', '1', '1'])
  let r = await conversar(s, ['as oito'])
  assert.match(r.texto, /terça, 20\/10 às 08:00\* está guardado/)
  s = nova('nova')
  await conversar(s, ['Oi', '2', '3', '1'])
  r = await conversar(s, ['as duas'])
  assert.match(r.texto, /às 14:00\* está guardado/)
  s = nova('nova')
  await conversar(s, ['Oi', '2', '2', '4'])
  r = await conversar(s, ['sexta 16 as 8h'])
  assert.match(r.texto, /sexta, 16\/10 às 08:00\* está guardado/)
  s = nova('nova')
  await conversar(s, ['Oi', '2', '2', '4'])
  r = await conversar(s, ['seg dia 26 depois das 16h'])
  assert.match(r.texto, /Depois das 16h, neste dia, há: 16:40 e 17:20/)
  assert.equal(s.consultas().length, 0, 'depois das 16h nao e 16:00')
  s = nova('nova')
  await conversar(s, ['Oi', '2', '3'])
  r = await conversar(s, ['nao, quero de manha as 8h'])
  assert.match(r.texto, /Em \*Tatuapé · São Paulo\* não há horário livre às 8h\. Às 8h há em \*Santos · Boqueirão\*/)
  s = nova('nova')
  await conversar(s, ['Oi', '2'])
  r = await conversar(s, ['qualquer uma que tenha as 8h'])
  assert.match(r.texto, /O primeiro horário às 8h é em \*Santos · Boqueirão\*/)
})

await caso('rodada 2: o convenio dito junto da unidade, antes da pergunta de quem ou antes do pedido nao e perguntado de novo', async () => {
  let s = nova('nova')
  await conversar(s, ['Oi', '2'])
  let r = await conversar(s, ['santos pela porto'])
  assert.match(r.texto, /\*Santos · Boqueirão\*, pela \*Porto Saúde\*/)
  assert.equal(s.etapa, 'aguardando_dia')
  s = nova('nova')
  await conversar(s, ['Oi', '2'])
  r = await conversar(s, ['em santos eu tenho o santa saude'])
  assert.match(r.texto, /pela \*Santa Saúde\*/)
  s = nova('irmaos')
  await conversar(s, ['oi preciso marcar pro meu filho pela porto em santos'])
  r = await conversar(s, ['theo'])
  assert.match(r.texto, /\*Santos · Boqueirão\*, pela \*Porto Saúde\*/)
  s = nova('nova')
  await conversar(s, ['oi, tenho sinusite direto, queria passar com o dr pela unimed santos'])
  r = await conversar(s, ['nao, é com o dr fabio msm. quero marcar'])
  assert.match(r.texto, /pela \*Unimed Santos\*/)
  s = nova('nova')
  await conversar(s, ['Oi', '2', '2', '4'])
  r = await conversar(s, ['ah, é pela porto'])
  assert.match(r.texto, /Anotado: pela \*Porto Saúde\*/)
  await conversar(s, ['1', '1'])
  assert.equal(s.consultas()[0].insurance, 'Porto Saúde')
})

await caso('rodada 2: o nome dito na conversa vai para a ficha com SIM, e a queixa sai so da frase dela', async () => {
  assert.equal(nomeDito('Olá, bom dia! Meu nome é Ana Paula Ferreira, tenho 34 anos e gostaria de marcar'), 'Ana Paula Ferreira')
  assert.equal(nomeDito('sinusite de repeticao. unimed santos. ana paula ferreira, 34 anos'), 'Ana Paula Ferreira')
  assert.equal(nomeDito('aqui é a Dayane'), null, 'um nome so nao e oferecido')
  assert.equal(nomeDito('meu filho de 4 anos ronca'), null)
  const s = nova('nova')
  let r = await conversar(s, ['bom dia, quero marcar com o dr fabio semana q vem de manha se tiver. sinusite de repeticao. unimed santos. ana paula ferreira, 34 anos'])
  assert.match(r.texto, /Na semana que vem, de manhã: \*3\* quarta, 21\/10 e \*4\* sexta, 23\/10/)
  r = await conversar(s, ['4', '1'])
  assert.match(r.texto, /Se for \*Ana Paula Ferreira\*, responda \*SIM\*/)
  await conversar(s, ['sim'])
  const [consulta] = s.consultas()
  assert.equal(consulta.intake_patient_name, 'Ana Paula Ferreira')
  assert.equal(consulta.intake_complaint, 'sinusite de repeticao')
})

await caso('rodada 2: guia pelo clinico, bebe antes do que o Dr. trata, a pergunta da cirurgia manda, e a unidade do pedido nao e endereco', async () => {
  let s = nova('nova')
  let r = await conversar(s, ['oi pra consultar pela unimed precisa de pedido do clinico geral?'])
  assert.match(r.texto, /Guia e encaminhamento/)
  s = nova('nova')
  r = await conversar(s, ['oi queria marcar pro meu bb de 1 ano mas o dr atende nenem? nao sei se é normal levar no otorrino'])
  assert.match(r.texto, /atende \*crianças e adultos\*/)
  assert.doesNotMatch(r.texto, /Respirar bem é viver melhor/)
  s = nova('nova')
  r = await conversar(s, ['Bom dia. Tenho desvio de septo e quero fazer a cirurgia com o Dr. Fábio. Meu plano é Porto Saúde. A cirurgia de septo é coberta pelo convênio?'])
  assert.match(r.texto, /🩺 \*Cirurgia\*/)
  s = nova('nova')
  r = await conversar(s, ['Bom dia! Gostaria de agendar uma consulta particular com o Dr. Fábio na unidade de Higienópolis. Teria disponibilidade em alguma terça-feira à tarde?'])
  assert.doesNotMatch(r.texto, /Onde o Dr\. Fábio atende/, 'a unidade do pedido nao e pergunta de endereco')
  assert.match(r.texto, /Horários de terça, 20\/10 \(tarde\)/)
})

await caso('rodada 2: despedida com "quando", espera da equipe, quem esta ai, ingles e o 2 na fila', async () => {
  assert.equal(despedida('ah blz, entao fica pra quando eu for pra sp. obrigado'), true)
  let s = nova('nova')
  await conversar(s, ['quero falar com a dayane'])
  assert.equal(s.etapa, 'atendente')
  let r = await conversar(s, ['Vou esperar a equipe me confirmar'])
  assert.match(r.texto, /Combinado! A nossa equipe responde por aqui/)
  r = await conversar(s, ['2'])
  assert.match(r.texto, /Em qual unidade/, 'o 2 na fila abre a agenda')
  s = nova('nova', QUARTA_22H)
  r = await conversar(s, ['Boa noite, tem alguém online aí? Queria marcar uma consulta'])
  assert.match(r.texto, /Estou aqui!/)
  assert.match(r.texto, /Alguém da equipe responde amanhã/)
  assert.match(r.texto, /Em qual unidade/)
  s = nova('nova')
  await conversar(s, ['Hello! English please? Ear nose throat doctor, Sao Paulo, appointment'])
  r = await conversar(s, ['appointment'])
  assert.match(r.texto, /Our team already has your message/)
  s = nova('nova')
  await conversar(s, ['Oi'])
  r = await conversar(s, ['o doutor ja esta ciente do caso'])
  // Uma frase so para a passagem a equipe (rodada 2), e desde 16/10/2026 a
  // pergunta "urgencia ou duvida" com os dois botoes.
  assert.equal((r.texto.match(/passei sua mensagem para a nossa equipe/g) ?? []).length, 1, 'uma frase so para a passagem a equipe')
  assert.doesNotMatch(r.texto, /direcionando você/)
})

await caso('quando o robo nao entende, pergunta: urgencia ou duvida, com dois botoes', async () => {
  let s = nova('nova')
  await conversar(s, ['Oi'])
  let r = await conversar(s, ['o menino ta esquisito desde cedo, todo largadao no sofa'])
  assert.match(r.texto, /É uma \*urgência\* ou uma \*dúvida\*\? Toque abaixo/)
  assert.deepEqual(r.ultima.toques.opcoes.map((o) => o.id), ['URGENCIA', 'E_DUVIDA'])
  // O toque chega como o id, em texto (cada chamada de conversar comeca do zero).
  r = await conversar(s, ['URGENCIA'])
  assert.equal(r.alertas.length, 1, 'o toque em Urgencia avisa o celular da equipe')
  assert.match(r.texto, /não espere a nossa resposta/)
  assert.equal(s.motivo, 'urgencia')
  s = nova('nova')
  await conversar(s, ['Oi', 'o doutor ja esta ciente do caso'])
  r = await conversar(s, ['E_DUVIDA'])
  assert.equal(r.alertas.length, 0, 'duvida nao e alarme')
  assert.match(r.texto, /a sua dúvida já está com a nossa equipe/)
  assert.equal(s.etapa, 'atendente')
  // O toque numa mensagem antiga, com o menu na tela, tambem chega a equipe.
  s = nova('nova')
  await conversar(s, ['Oi'])
  r = await conversar(s, ['E_DUVIDA'])
  assert.match(r.texto, /a sua dúvida já está com a nossa equipe/)
  assert.equal(s.etapa, 'atendente')
})

await caso('rodada 2: so a hora na ficha e troca de horario, e a mesma hora nao troca nada', async () => {
  let s = nova('cadastrada')
  await conversar(s, ['Oi', '2', '3', '1', '1'])
  assert.equal(s.etapa, 'dados_motivo')
  let r = await conversar(s, ['16:40'])
  // O mesmo dia, as 16:40, direto (rodada 3): a consulta acabou de ser marcada.
  assert.match(r.texto, /quinta, 15\/10 às 16:40/)
  assert.ok(!s.consultas().some((c) => c.intake_complaint === '16:40'))
  s = nova('cadastrada')
  await conversar(s, ['Oi', '2', '3', '1', '1'])
  r = await conversar(s, ['14h'])
  assert.match(r.texto, /Sua consulta já está marcada para \*quinta, 15\/10 às 14:00\*/)
  assert.equal(s.etapa, 'dados_motivo')
})

// ---------------------------------------------------------------
// Rodada 3 do painel de pacientes simulados (16/10/2026)
// ---------------------------------------------------------------

await caso('rodada 3: urgencia escrita de outro jeito (operado, coagulo, chiadinho, tampou do nada)', async () => {
  assert.equal(falouDeSangramento('desde q acordei ta saindo coagulo pelo nariz'), true)
  assert.equal(falouDeSangramento('to cuspindo vermelho'), true)
  assert.equal(falouDeSangramento('nariz entupido, sem coagulo nenhum'), false)
  assert.equal(falouDePosOperatorio('to operado do septo faz 1 semana'), true)
  assert.ok(sinalDeAlarme('meu nenem de 8 meses ta com um chiadinho no peito e bem cansado desde ontem'))
  assert.equal(sinalDeAlarme('meu bebe de 6 meses ta muito cansado e abatido'), 'bebe')
  assert.equal(sinalDeAlarme('o ouvido direito tampou do nada ontem a noite e hoje to escutando quase nada dele'), 'surdez')
  // Cada jeito sozinho, para um nao cobrir o outro.
  assert.equal(sinalDeAlarme('desde ontem to escutando quase nada do ouvido esquerdo'), 'surdez')
  assert.equal(sinalDeAlarme('meu ouvido tampou do nada hoje de manha'), 'surdez')
  assert.equal(sinalDeAlarme('meu filho de 5 anos ta com um chiadinho no peito'), 'respiracao')
  assert.equal(sinalDeAlarme('meu nariz entupiu ontem a noite'), null, 'nariz entupido nao e surdez')
  assert.equal(sinalDeAlarme('chiado no ouvido faz tempo'), null, 'zumbido nao e falta de ar')
  const s = nova('cadastrada')
  const r = await conversar(s, ['bom dia. to operado do septo faz 1 semana. desde q acordei ta saindo coagulo pelo nariz e to cuspindo vermelho. é normal??'])
  assert.equal(r.alertas.length, 1)
  assert.match(r.texto, /procure o pronto-socorro agora, sem esperar a nossa resposta/)
})

await caso('rodada 3: sangramento que nao para no meio da marcacao sai da agenda; PS e "to indo" na conversa de urgencia', async () => {
  let s = nova('nova')
  await conversar(s, ['oi bom dia quero marcar um horario'])
  let r = await conversar(s, ['na vdd é q meu nariz ta sangrano faz uns 20 min e nao para to com medo'])
  assert.doesNotMatch(r.texto, /Para continuar de onde paramos/)
  assert.equal(s.etapa, 'atendente')
  r = await conversar(s, ['qual ps vcs indicam aqui em santos? tenho porto saude'])
  assert.doesNotMatch(r.texto, /Datas disponíveis/)
  assert.match(r.texto, /O alerta já está com o Dr\. Fábio e a Dayane/)
  s = nova('nova')
  await conversar(s, ['Oi', '2'])
  r = await conversar(s, ['meu filho enfiou um feijao no nariz'])
  assert.equal(s.etapa, 'aguardando_unidade', 'o alarme deixa a agenda de pe, para depois')
  r = await conversar(s, ['pra qual pronto socorro eu levo?'])
  assert.match(r.texto, /não espere pela consulta nem pela nossa resposta/)
  assert.doesNotMatch(r.texto, /Em qual unidade/)
  r = await conversar(s, ['ta bom to indo'])
  assert.match(r.texto, /Isso\. A nossa equipe já sabe/)
  assert.equal(s.etapa, 'atendente')
})

await caso('rodada 3: na fila de urgencia, o 192 para quem nao tem como ir, e o pedido curto de socorro', async () => {
  const s = nova('nova')
  await conversar(s, ['tudo girando aqui nao consigo levanta da cama ja vomitei umas 4 vez'])
  let r = await conversar(s, ['minha mulher ta no trabalho nao tenho como i'])
  assert.match(r.texto, /ligue \*192\* \(SAMU\): eles vão até você/)
  r = await conversar(s, ['ajuda'])
  assert.match(r.texto, /Não espere a nossa resposta: procure o pronto-socorro agora/)
  assert.doesNotMatch(r.texto, /192/)
})

await caso('rodada 3: na urgencia, a consulta marcada tem resposta, e quem marca mesmo assim ouve o lembrete', async () => {
  let s = nova('com_consulta')
  await conversar(s, ['acordei sem ouvir nada do ouvido direito'])
  let r = await conversar(s, ['a consulta de segunda fica marcada ou nao?'])
  assert.match(r.texto, /continua marcada/)
  assert.match(r.texto, /procure atendimento hoje/)
  s = nova('nova')
  await conversar(s, ['Oi', '2'])
  await conversar(s, ['engoli uma espinha de peixe e doi muito pra engolir'])
  r = await conversar(s, ['3', '1', '1'])
  assert.match(r.texto, /está guardado/)
  assert.match(r.texto, /Lembrando: pelo que você contou, procure atendimento hoje mesmo/)
})

await caso('rodada 3: pergunta e reclamacao no meio da ficha tem resposta, e nao viram nome nem data', async () => {
  let s = nova('nova')
  await conversar(s, ['Oi', '2', '1', '1', '1'])
  assert.equal(s.etapa, 'dados_nome')
  let r = await conversar(s, ['Antes, só uma dúvida: qual é o valor da consulta particular?'])
  assert.match(r.texto, /O valor da consulta particular e as formas de pagamento a nossa equipe passa por aqui/)
  assert.match(r.texto, /Para continuar a ficha/)
  assert.equal(s.etapa, 'dados_nome')
  r = await conversar(s, ['perguntei se a amil devolve tudo'])
  assert.equal(s.etapa, 'dados_nome')
  assert.ok(!s.consultas()[0].intake_patient_name, 'a reclamacao nao vira nome')
  await conversar(s, ['Juliana Prado Castilho'])
  assert.equal(s.etapa, 'dados_nascimento')
  r = await conversar(s, ['vc nao responde nada q eu pergunto. tem alguem ai?'])
  assert.equal(s.etapa, 'dados_nascimento')
  assert.ok(!s.consultas()[0].intake_birth_date, 'a reclamacao nao vira data de nascimento')
  // Hora e data fora de ordem tambem nao viram nome nem queixa.
  s = nova('nova')
  await conversar(s, ['Oi', '2', '3', '1', '1'])
  r = await conversar(s, ['14h entao'])
  assert.match(r.texto, /Sua consulta já está marcada para \*quinta, 15\/10 às 14:00\*/)
  await conversar(s, ['as 8 da manha'])
  assert.ok(!s.consultas().some((c) => c.intake_patient_name === 'As'))
})

await caso('rodada 3: outra unidade na pergunta do convenio troca, e "nao aceita no Tatuape?" e pergunta', async () => {
  let s = nova('nova')
  await conversar(s, ['Oi', '2', '2'])
  assert.equal(s.etapa, 'aguardando_convenio')
  let r = await conversar(s, ['Ah, entendi. Então prefiro fazer particular no Tatuapé mesmo, que é perto de casa.'])
  assert.match(r.texto, /Datas disponíveis em Tatuapé/)
  s = nova('nova')
  await conversar(s, ['Oi', '2', '2'])
  r = await conversar(s, ['nao quero em santos, é longe'])
  assert.match(r.texto, /Tudo bem, em outra unidade/)
  s = nova('nova')
  await conversar(s, ['Oi', '2'])
  r = await conversar(s, ['ue mas unimed é tudo igual, nao aceita no tatuape mesmo?'])
  assert.match(r.texto, /Cada Unimed é uma cooperativa diferente/)
  assert.match(r.texto, /Em \*Tatuapé · São Paulo\* a consulta é particular/)
})

await caso('rodada 3: a semana que vem vale para o dia dito depois, e a troca de data na ficha leva a queixa junto', async () => {
  let s = nova('nova')
  await conversar(s, ['bom dia, to com sinusite de novo, queria uma consulta semana q vem de manha pela unimed santos'])
  let r = await conversar(s, ['pode ser sexta as 8'])
  assert.match(r.texto, /sexta, 23\/10 às 08:00\* está guardado/)
  assert.equal(s.consultas()[0].intake_complaint, 'to com sinusite de novo')
  s = nova('nova')
  await conversar(s, ['bom dia, to com sinusite de novo, queria uma consulta pela unimed santos'])
  await conversar(s, ['sexta dia 16 as 8h'])
  r = await conversar(s, ['a data ta errada, eu quero dia 23/10 e nao dia 16'])
  assert.match(r.texto, /Horários de sexta, 23\/10/)
  assert.doesNotMatch(r.texto, /Responda SIM/)
  await conversar(s, ['8h'])
  const marcadas = s.consultas().filter((c) => c.status === 'scheduled')
  assert.equal(marcadas.length, 1)
  assert.equal(marcadas[0].intake_complaint, 'to com sinusite de novo', 'a queixa da consulta antiga vem junto')
})

await caso('rodada 3: o SIM da remarcacao com o dia junto, e "15h" num dia que so tem 15:20', async () => {
  let s = nova('com_consulta')
  await conversar(s, ['oi nao vou conseguir ir na segunda, da pra mudar o dia?'])
  let r = await conversar(s, ['sim, pode ser sexta dia 23 de manha'])
  assert.match(r.texto, /Horários de sexta, 23\/10/)
  s = nova('nova')
  await conversar(s, ['Oi', '2', '3', '1'])
  r = await conversar(s, ['15h'])
  assert.match(r.texto, /Às 15h em ponto não há horário nesse dia; o mais perto é 15:20/)
  assert.equal(s.consultas().length, 0)
  r = await conversar(s, ['pode ser o ultimo horario'])
  assert.match(r.texto, /às 17:20\* está guardado/)
  assert.equal(horaEscrita('8 hrs')?.hora, 8)
  assert.equal(horaEscrita('dia 20 de manha'), null, 'dia do mes, e nao 20h')
  assert.equal(horaEscrita('sexta 23 de manha'), null, 'dia do mes sem a palavra dia')
  assert.equal(horaEscrita('qual das duas tem horario antes?'), null)
})

await caso('rodada 3: unidade, dia e hora numa frase marcam direto; "horario mais proximo" entre duas unidades', async () => {
  let s = nova('nova')
  await conversar(s, ['Oi', '2'])
  let r = await conversar(s, ['Então Tatuapé, quinta às 14h.'])
  assert.match(r.texto, /quinta, 15\/10 às 14:00\* está guardado/)
  s = nova('nova')
  await conversar(s, ['Oi'])
  r = await conversar(s, ['Quero marcar. Qual o horário mais próximo que vocês têm em São Paulo? Pode ser Higienópolis ou Tatuapé, particular.'])
  assert.match(r.texto, /O horário mais cedo é em \*Tatuapé · São Paulo\*/)
  // O mais cedo de todos (Tatuape) fica de fora quando nao foi citado.
  s = nova('nova')
  await conversar(s, ['Oi', '2'])
  r = await conversar(s, ['qual tem o horario mais proximo, higienopolis ou santos?'])
  assert.match(r.texto, /O horário mais cedo é em \*Santos · Boqueirão\*/)
})

await caso('rodada 3: horario da equipe, o 2 depois do resumo e a fila', async () => {
  let s = nova('nova')
  let r = await conversar(s, ['e aqui no whats vcs respondem ate q horas?'])
  assert.match(r.texto, /A nossa equipe responde por aqui de segunda a sexta, das 8h às 18h\. Fora desse horário/)
  assert.doesNotMatch(r.texto, /Dias e horários com vaga/, 'a pergunta e da equipe, e nao da agenda')
  s = nova('nova')
  r = await conversar(s, ['vcs abrem sabado?'])
  assert.match(r.texto, /A nossa equipe responde por aqui de segunda a sexta/)
  r = await conversar(s, ['2'])
  assert.match(r.texto, /Em qual unidade/, 'o 2 logo depois do resumo abre a agenda')
  s = nova('nova')
  await conversar(s, ['JA MANDEI MENSAGEM ONTEM E NINGUEM ME RESPONDEU. QUERO FALAR COM UMA PESSOA DE VERDADE'])
  r = await conversar(s, ['E VAI DEMORAR QUANTO TEMPO DESSA VEZ???'])
  assert.match(r.texto, /Sua conversa já está na fila da nossa equipe/)
  assert.doesNotMatch(r.texto, /Como é a consulta/)
  r = await conversar(s, ['ta bom obrigada fico esperando'])
  assert.match(r.texto, /Combinado!/)
  s = nova('nova')
  await conversar(s, ['porto saude cobre cirurgia de desvio de septo? preciso ter certeza', 'sim ou nao? cobre?'])
  r = await conversar(s, ['ta. entao marca uma consulta em santos pela porto'])
  assert.match(r.texto, /\*Santos · Boqueirão\*, pela \*Porto Saúde\*/)
})

await caso('rodada 3: engano de numero, consulta com o outro medico, documento com problema e a Daiane', async () => {
  let s = nova('nova')
  await conversar(s, ['Oi'])
  let r = await conversar(s, ['ah entao errei o numero, desculpa'])
  assert.match(r.texto, /Sem problema! 🙂/)
  assert.notEqual(s.etapa, 'atendente')
  s = nova('nova')
  await conversar(s, ['Bom dia, é do consultório do Dr. Marcelo? Preciso remarcar a minha consulta com ele'])
  r = await conversar(s, ['Ué, mas foi nesse número que eu marquei. Tenho consulta dia 20 com ele, não é o otorrino?'])
  assert.match(r.texto, /Neste número não há consulta marcada com o Dr\. Fábio/)
  assert.doesNotMatch(r.texto, /Respirar bem/)
  s = nova('nova')
  await conversar(s, ['Oi'])
  r = await conversar(s, ['o pedido de exame que a Dra mandou esta faltando o carimbo'])
  assert.match(r.texto, /confere o documento/)
  assert.equal(s.etapa, 'atendente')
  assert.equal(pediuAtendente('so quero falar com a daiane'), true)
  assert.equal(chamandoAlguem('ei'), true)
  assert.equal(perguntouSeTemAlguem('vcs tao respondendo agora ou é robo? ja ta tarde ne'), true)
  assert.equal(naoFoiRespondida('Não perguntei de retorno de consulta.'), true)
})

await caso('rodada 3: "consulta" sozinha marca, e o segundo "nao entendi" e curto', async () => {
  const s = nova('nova')
  await conversar(s, ['Oi'])
  let r = await conversar(s, ['xyz'])
  assert.match(r.texto, /Não entendi\. Responda com o número da opção/)
  r = await conversar(s, ['abc'])
  assert.match(r.texto, /Não entendi ainda 🙏/)
  assert.doesNotMatch(r.texto, /Dúvidas sobre a consulta/, 'o menu inteiro nao vem de novo')
  r = await conversar(s, ['consulta'])
  assert.match(r.texto, /Em qual unidade/)
})

await caso('rodada 3: o assunto vence o valor no empate, duas perguntas tem duas respostas, e agradecer nao e pergunta', async () => {
  let s = nova('nova')
  let r = await conversar(s, ['o retorno tem q pagar de novo?'])
  assert.match(r.texto, /🔁 \*Retorno\*/)
  s = nova('nova')
  r = await conversar(s, ['bom dia minha filha queria saber do aparelio pra escutar melhor qto fica'])
  assert.match(r.texto, /Aparelho auditivo/)
  s = nova('nova')
  r = await conversar(s, ['Qual é o endereço do consultório de Santos? E tem estacionamento no local? Vou de carro.'])
  assert.match(r.texto, /Onde o Dr\. Fábio atende/)
  assert.match(r.texto, /Estacionamento/)
  s = nova('nova')
  r = await conversar(s, ['e demora qto a consulta?'])
  assert.match(r.texto, /dura cerca de 40 minutos/)
  s = nova('nova')
  await conversar(s, ['Vocês fazem nasofibroscopia no consultório?'])
  r = await conversar(s, ['Certo. Obrigado, fico aguardando o retorno.'])
  assert.match(r.texto, /Por nada!/)
  assert.doesNotMatch(r.texto, /Retorno/)
})

await caso('rodada 3: "sesta feira", "medico do ouvido" nao e queixa, e "da nota fiscal?" e pergunta', async () => {
  let s = nova('nova')
  await conversar(s, ['Oi', '2', '2', '4'])
  let r = await conversar(s, ['pode ser na sesta feira'])
  assert.match(r.texto, /Horários de sexta|As sextas com horário livre/)
  s = nova('nova')
  await conversar(s, ['boa dia moça aqui e o antonio quero marca o medico do ouvido'])
  r = await conversar(s, ['3', '1', '1'])
  assert.match(r.texto, /motivo da consulta|5 perguntas/)
  assert.ok(!s.consultas()[0].intake_complaint, '"medico do ouvido" nao e a queixa')
  s = nova('nova')
  r = await conversar(s, ['da nota fiscal? quero pedir reembolso no bradesco'])
  assert.doesNotMatch(r.texto, /Anotei o pedido de \*nota fiscal/)
})

// ---------------------------------------------------------------
// A etiqueta que fica (25/10/2026, vindo do sistema do Dr. Marcello)
// ---------------------------------------------------------------

await caso('etiqueta: sangramento e urgencia nao descem por outra; pendencia nao vira so informativa', () => {
  const acesa = (motivo) => ({ needs_attention: true, attention_reason: motivo })
  assert.equal(etiquetaQueFica(acesa('sangramento'), 'atendente'), 'sangramento')
  assert.equal(etiquetaQueFica(acesa('sangramento'), 'cancelou_sozinho'), 'sangramento')
  assert.equal(etiquetaQueFica(acesa('urgencia'), 'documento'), 'urgencia')
  assert.equal(etiquetaQueFica(acesa('sangramento'), 'urgencia'), 'urgencia', 'de uma urgencia para outra, vale a nova')
  assert.equal(etiquetaQueFica(acesa('atendente'), 'cancelou_sozinho'), 'atendente', 'o pedido nao some da fila')
  assert.equal(etiquetaQueFica(acesa('cancelou_sozinho'), 'atendente'), 'atendente')
  assert.equal(etiquetaQueFica({ needs_attention: false, attention_reason: 'sangramento' }, 'atendente'), 'atendente', 'apagada pela equipe: vale a nova')
  assert.equal(etiquetaQueFica(null, 'anexo'), 'anexo')
})

await caso('etiqueta: no simulador, o sangramento continua no topo quando o robo levanta outra', async () => {
  const s = nova('nova')
  await conversar(s, ['Meu nariz está sangrando muito e não para'])
  assert.equal(s.conversa.attention_reason, 'sangramento')
  const r = await conversar(s, ['número errado, não sou essa pessoa'])
  assert.ok(r.registros.some((x) => /Número errado/.test(x.titulo)), 'o robo levantou "numero errado" nesta mensagem')
  assert.equal(s.conversa.attention_reason, 'sangramento', 'o numero errado nao tira a conversa do sangramento')
  const webhook = readFileSync(new URL('../supabase/functions/meta-webhook/index.ts', import.meta.url), 'utf8')
  assert.match(webhook, /const etiqueta = etiquetaQueFica\(conversaAnterior, resultado\.atencao\)/)
  assert.match(webhook, /\.update\(\{ needs_attention: true, attention_reason: etiqueta \}\)/)
})

// ---------------------------------------------------------------
// Correcoes do motor vindas do sistema do Dr. Marcello (25/10/2026)
// ---------------------------------------------------------------

await caso('lembrete da vespera: so promete quando ele vem', () => {
  const tz = 'America/Sao_Paulo'
  // Quarta 14/10 as 10h; o lembrete roda aos :20, das 9h20 as 19h20.
  const dezDaManha = new Date(QUARTA_10H)
  assert.equal(avisoDoLembrete('2026-10-14T18:00:00Z', tz, dezDaManha), '', 'consulta hoje: nao ha vespera')
  assert.match(avisoDoLembrete('2026-10-15T18:00:00Z', tz, dezDaManha), /^\*Um dia antes da consulta enviamos/, 'amanha, marcada de manha: vem')
  assert.match(avisoDoLembrete('2026-10-20T18:00:00Z', tz, dezDaManha), /Um dia antes/)
  const depoisDaUltimaRodada = new Date('2026-10-14T22:30:00Z') // 19h30 em Brasilia
  assert.equal(avisoDoLembrete('2026-10-15T18:00:00Z', tz, depoisDaUltimaRodada), '', 'amanha, marcada depois das 19h20: nao vem')
  assert.match(avisoDoLembrete('2026-10-15T18:00:00Z', tz, new Date('2026-10-14T22:10:00Z')), /Um dia antes/, 'as 19h10 ainda da tempo')
})

await caso('"eu nao passei em consulta": desculpas e a equipe, nunca a agenda', async () => {
  for (const frase of [
    'Eu não passei em consulta',
    'nunca fui no Dr. Fábio',
    'não tive consulta nenhuma com o doutor',
    'Não houve essa consulta',
    'faltei, não deu pra ir',
  ]) {
    assert.equal(negouConsulta(frase), true, frase)
  }
  for (const frase of ['não consegui marcar consulta', 'quero marcar uma consulta', 'não sei se tenho consulta', 'a consulta foi ótima']) {
    assert.equal(negouConsulta(frase), false, frase)
  }
  const s = nova('nova')
  await conversar(s, ['Oi'])
  const r = await conversar(s, ['Eu não passei em consulta'])
  assert.match(r.texto, /^Desculpe pela mensagem! 🙏 Passei para a nossa equipe conferir o cadastro/)
  assert.doesNotMatch(r.texto, /Em qual unidade|horários/i)
  assert.equal(s.conversa.attention_reason, 'atendente')
})

await caso('botao velho no meio da ficha nao vira nome do paciente', () => {
  for (const t of ['Escolher outra data', 'Falar com a equipe', 'Confirmar', 'Voltar ao menu']) assert.equal(pareceBotao(t), true, t)
  for (const t of ['Ana Paula Ribeiro', 'Antônio Carlos', 'Fábio Dario']) assert.equal(pareceBotao(t), false, t)
})

// ---------------------------------------------------------------
// Rodada 5 do painel (25/10/2026, robo com as melhorias do Dr. Marcello)
// ---------------------------------------------------------------

await caso('rodada 5: tontura com o gerundio falado e o "ta" no meio acende na primeira mensagem', async () => {
  assert.equal(sinalDeAlarme('tontera forte a casa ta girano. vomitano. nao paro de pe'), 'tontura')
  assert.equal(sinalDeAlarme('tudo rodano, vomitei varias vez, nao levanto da cama'), 'tontura', 'a critica da rodada 4')
  // Cada jeito sozinho, para um nao cobrir o outro.
  assert.equal(sinalDeAlarme('a casa ta girando e ja vomitei'), 'tontura')
  assert.equal(sinalDeAlarme('tontera forte desde cedo'), 'tontura')
  assert.equal(sinalDeAlarme('tudo girano e ja vomitei duas vez'), 'tontura')
  assert.equal(sinalDeAlarme('faz um ano que tenho tontura leve as vezes'), null)
  const s = nova('nova')
  const r = await conversar(s, ['tontera forte a casa ta girano. vomitano. nao paro de pe'])
  assert.equal(r.noMedico.length, 1, 'o alerta no WhatsApp sai na primeira mensagem')
  assert.doesNotMatch(r.texto, /Seja muito bem-vindo/)
})

await caso('rodada 5: na fila de urgencia, quem nao consegue ir recebe o 192, e nunca silencio', async () => {
  const s = nova('nova')
  await conversar(s, ['bom dia. tontura mt forte desde cedo, ja vomitei 3 vez e nao consigo fica em pe'])
  let r = await conversar(s, ['como vo se nem consigo levanta'])
  assert.match(r.texto, /ligue \*192\* \(SAMU\): eles vão até você/)
  r = await conversar(s, ['nao da pra ir nao consigo anda'])
  assert.match(r.texto, /Ligue 192 \(SAMU\) agora/, 'o 192 ja saiu, e a insistencia tem resposta')
  r = await conversar(s, ['chama uma ambulancia pra mim pfv'])
  assert.match(r.texto, /Por aqui não conseguimos chamar a ambulância/)
  // O lembrete com o 192 quando o de antes saiu sem ele: o comeco igual nao
  // e repeticao.
  const s2 = nova('nova')
  await conversar(s2, ['bom dia. tontura mt forte desde cedo, ja vomitei 3 vez e nao consigo fica em pe', 'to muito mal'])
  r = await conversar(s2, ['nao da pra ir nao consigo anda'])
  assert.match(r.texto, /O alerta já está com a nossa equipe[\s\S]*ligue \*192\*/)
})

await caso('rodada 5: intervalo de dose e remedio, e nao horario de consulta', async () => {
  const s = nova('nova')
  await conversar(s, ['posso tomar amoxi q tenho em casa? to com sinusite acho'])
  const r = await conversar(s, ['so fala se pode ou nao rapidinho, de 8 em 8h ta bom?'])
  assert.doesNotMatch(r.texto, /Tem, sim|primeiro horário livre/)
  assert.match(r.texto, /remédio e sintoma só o Dr\. Fábio pode orientar/)
  const s2 = nova('nova')
  const r2 = await conversar(s2, ['tem horario as 8h?'])
  assert.match(r2.texto, /Às 8h/, 'a hora da agenda continua valendo')
})

await caso('rodada 5: a Unimed de Sao Paulo e a que "pega em todo lugar" nao viram a Unimed Santos', async () => {
  let s = nova('nova')
  let r = await conversar(s, ['quero marcar uma consulta pela unimed, a minha é a Unimed daqui de São Paulo'])
  assert.doesNotMatch(r.texto, /Pela \*Unimed Santos\*/)
  assert.match(r.texto, /O plano \*Unimed de São Paulo\* não está entre os convênios/)
  assert.match(r.texto, /Cada Unimed é uma cooperativa diferente/)
  s = nova('nova')
  r = await conversar(s, ['quero marcar pela unimed, a minha pega em todo lugar'])
  assert.doesNotMatch(r.texto, /Pela \*Unimed Santos\*/)
  assert.match(r.texto, /Unimed de outra cidade/)
  s = nova('nova')
  r = await conversar(s, ['quero marcar pela unimed santos'])
  assert.match(r.texto, /pela \*Unimed Santos\*/, 'a Unimed Santos continua valendo')
  s = nova('nova')
  r = await conversar(s, ['tenho unimed, pode ser em qualquer lugar, quero marcar'])
  assert.doesNotMatch(r.texto, /Unimed de outra cidade/, '"qualquer lugar" ali e a unidade, e nao o plano')
})

await caso('rodada 5: "é o Davi Oliveira Costa" grava so o nome', async () => {
  const s = nova('nova')
  await conversar(s, ['Oi', '#2', '#1', '#1', '#1'])
  await conversar(s, ['é o Davi Oliveira Costa'])
  assert.equal(s.consultas()[0].intake_patient_name, 'Davi Oliveira Costa')
})

await caso('rodada 5: a pergunta de remedio nao vira a queixa da consulta', async () => {
  const s = nova('nova')
  await conversar(s, ['posso pinga umas gota no ouvido? ta saindo pus e doendo mt. qual o horario mais proximo q vcs tem'])
  await conversar(s, ['o horario mais proximo?? to em santos', 'particular', '1', '1', 'Andre Luiz Ferreira', '12/03/1990', 'pular', 'pular'])
  const [consulta] = s.consultas()
  assert.ok(consulta, 'a consulta saiu')
  assert.match(consulta.intake_complaint ?? '', /pus e doendo/)
  assert.doesNotMatch(consulta.intake_complaint ?? '', /posso pinga/)
})

await caso('rodada 5: despedida, desculpa e "so queria saber" nao viram "nao entendi"', async () => {
  for (const frase of ['puts, ok vlw', 'Eu que agradeço. Tenha um ótimo dia!', 'Ah, então eu me enganei mesmo. Desculpa, obrigada!']) {
    const s = nova('nova')
    await conversar(s, ['Oi'])
    const r = await conversar(s, [frase])
    assert.match(r.texto, /Por nada!/, frase)
    assert.notEqual(s.motivo, 'atendente', `${frase}: nao acende a conversa`)
  }
  assert.equal(despedida('nao quero marcar agora nao, so queria saber msm. obg'), true)
  assert.equal(despedida('ah ok, era so pra saber mesmo, obrigada'), true, 'so o "era so pra saber"')
  // Na pergunta do convenio, a desistencia sai da marcacao.
  const s = nova('nova')
  await conversar(s, ['Oi', '2', '2'])
  assert.equal(s.etapa, 'aguardando_convenio')
  const r = await conversar(s, ['nao quero marcar agora nao, so queria saber msm. obg'])
  assert.match(r.texto, /Tudo bem, não marquei nada/)
  assert.doesNotMatch(r.texto, /Responda com o número do convênio/)
})

await caso('rodada 5: unidade com dia e hora e pedido de marcar, e nunca a lista de enderecos', async () => {
  let s = nova('nova')
  let r = await conversar(s, ['Certo. Mesmo assim já quero deixar marcado: Higienópolis, terça à tarde.'])
  assert.doesNotMatch(r.texto, /Onde o Dr\. Fábio atende/)
  assert.match(r.texto, /Horários de terça, 20\/10 \(tarde\)/)
  assert.equal(pediuAgendamento('deixa marcado pra mim em Higienópolis'), true, 'o "deixa marcado" sozinho, sem dia')
  s = nova('nova')
  await conversar(s, ['Oi'])
  r = await conversar(s, ['quero a de terça às 8h em Higienópolis'])
  assert.doesNotMatch(r.texto, /Onde o Dr\. Fábio atende/)
  assert.match(r.texto, /Horários de terça, 20\/10/)
  // A unidade negada nao leva a outra junto.
  s = nova('nova')
  await conversar(s, ['Oi', '2'])
  r = await conversar(s, ['nao gente, santos nao. tatuape'])
  assert.match(r.texto, /Datas disponíveis em Tatuapé/)
  // O endereco continua respondendo quem pergunta.
  s = nova('nova')
  r = await conversar(s, ['qual o endereço de Higienópolis?'])
  assert.match(r.texto, /Onde o Dr\. Fábio atende/)
})

// ---------------------------------------------------------------
// O arquivo do paciente junto do alerta (25/10/2026, pedido do Edu)
// ---------------------------------------------------------------

await caso('anexo: a foto com "sangrando" na legenda dispara o alerta e vai atras dele; a de depois vai sozinha; a de conversa comum fica na Central', async () => {
  const s = nova('nova')
  let r = await s.enviarDaFamilia({ texto: 'meu nariz ta sangrando muito, olha', anexo: true })
  assert.equal(r.alertas.length, 1, 'a legenda e lida, como no webhook')
  assert.deepEqual(r.noMedico.map((m) => (m.anexo ? 'arquivo' : 'alerta')), ['alerta', 'arquivo'])
  assert.match(r.noMedico[1].texto, /^📷 Foto\n📎 Enviado por Carla pela Central de Cuidado$/)
  r = await s.enviarDaFamilia({ texto: 'ainda ta saindo' })
  assert.equal(r.noMedico.length, 0, 'texto depois do alerta nao manda nada ao WhatsApp do medico')
  r = await s.enviarDaFamilia({ texto: '', anexo: true })
  assert.deepEqual(r.noMedico.map((m) => (m.anexo ? 'arquivo' : 'alerta')), ['arquivo'], 'so o arquivo, com o alerta ainda aberto')
  const comum = nova('nova')
  r = await comum.enviarDaFamilia({ texto: 'segue o exame', anexo: true })
  assert.equal(r.noMedico.length, 0, 'arquivo de conversa comum nao toca o celular (relatorio da Cintia)')
})

// ---------------------------------------------------------------
// A pergunta de cancelar (26/10/2026, sondagem das etapas para o Jev)
// ---------------------------------------------------------------

await caso('cancelar: "quero mudar o dia" remarca e nao cancela; pergunta nao e sim; o sim continua valendo', async () => {
  const cancelou = (s) => s.consultas().some((c) => c.status === 'cancelled')
  for (const frase of ['quero mudar o dia', 'quero remarcar', 'na verdade quero só trocar o horario']) {
    const s = nova('com_consulta')
    await conversar(s, ['Oi', '4', 'cancelar'])
    const r = await conversar(s, [frase])
    assert.equal(cancelou(s), false, `"${frase}" nao cancela a consulta`)
    assert.match(r.texto, /Vamos remarcar esta consulta/, `"${frase}" vai para a remarcacao`)
  }
  for (const frase of ['pode me ligar?', 'quero falar com alguem antes', 'deixa quieto']) {
    const s = nova('com_consulta')
    await conversar(s, ['Oi', '4', 'cancelar'])
    await conversar(s, [frase])
    assert.equal(cancelou(s), false, `"${frase}" nao cancela a consulta`)
  }
  for (const frase of ['quero', 'quero sim', 'pode', 'ok', 'sim, pode cancelar por favor', 'quero cancelar sim']) {
    const s = nova('com_consulta')
    await conversar(s, ['Oi', '4', 'cancelar'])
    const r = await conversar(s, [frase])
    assert.equal(cancelou(s), true, `"${frase}" confirma o cancelamento`)
    assert.match(r.texto, /Consulta cancelada/)
  }
  // Na remarcacao nada cai agora: "pode ser na semana que vem" continua sendo sim.
  const s = nova('com_consulta')
  await conversar(s, ['Oi', '4', 'remarcar'])
  const r = await conversar(s, ['pode ser na semana que vem'])
  assert.equal(cancelou(s), false)
  assert.match(r.texto, /Vamos achar outra data/)
})

await caso('"qual o horário de atendimento?" responde com os dias e horarios, no menu e no meio do agendamento', async () => {
  let s = nova('nova')
  await conversar(s, ['Oi'])
  let r = await conversar(s, ['qual o horário de atendimento?'])
  assert.match(r.texto, /Dias e horários com vaga/)
  assert.doesNotMatch(r.texto, /Não consegui entender/)
  s = nova('nova')
  await conversar(s, ['Oi', 'quero marcar uma consulta', '2', '1'])
  r = await conversar(s, ['horario de atendimento'])
  assert.match(r.texto, /Dias e horários com vaga/)
  assert.equal(s.etapa, 'aguardando_dia', 'a escolha do dia continua de pe')
})

await caso('ficha: cortesia e pedido de outra coisa nao viram o nome do paciente; nome de verdade passa', async () => {
  for (const frase of ['obrigado', 'ok, obrigado', 'Certo', 'valeu', 'preciso da 2ª via da receita']) {
    const s = nova('nova')
    await conversar(s, ['Oi', 'quero marcar uma consulta', '2', '1', '1', '1'])
    const r = await conversar(s, [frase])
    assert.equal(s.etapa, 'dados_nome', `"${frase}" nao e nome`)
    assert.match(r.texto, /Não consegui ler o nome/)
  }
  for (const nome of ['Tatiana Souza', 'Valéria Certo Lima', 'joao pedro da silva']) {
    const s = nova('nova')
    await conversar(s, ['Oi', 'quero marcar uma consulta', '2', '1', '1', '1'])
    await conversar(s, [nome])
    assert.equal(s.etapa, 'dados_nascimento', `"${nome}" e nome`)
  }
})

console.log(`fabio.test: ${ok} casos ok`)
