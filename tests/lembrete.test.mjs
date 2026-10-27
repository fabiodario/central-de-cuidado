// Bateria da resposta ao lembrete de consulta.
//
// Esta parte do sistema nao tinha teste nenhum ate 31/08/2026, e o preco
// apareceu num caso real: o Nelson confirmou a consulta, a confirmacao nao
// chegou na plataforma, e a causa so foi encontrada garimpando o banco de
// producao. Cada caso abaixo existe para que um erro desses falhe aqui, em dois
// segundos, e nao la, em silencio.
import { readFileSync } from 'node:fs'
import {
  acompanhamentoEncerraConversa,
  avisoDaResposta,
  depoisDoAcompanhamento,
  depoisDoPedidoDeSair,
  lembreteRecente,
  respostaAoAcompanhamento,
  equipeFalouRecentemente,
  equipeSeguraORobo,
  interpretarResposta,
  mudancaDaConsulta,
  respondendoEnvioNosso,
  janelaDeLembrete,
  fimDoDiaLocal,
  oQueFoiEscolhido,
  unidadeNoLembrete,
} from './lembrete.build.mjs'

let passou = 0
const falhas = []

function conferir(titulo, condicao, detalhe = '') {
  if (condicao) passou++
  else falhas.push(`${titulo}${detalhe ? ` | ${detalhe}` : ''}`)
}

const AGORA = new Date('2026-08-31T20:00:00Z').getTime()
const HORA = 3600 * 1000
const quando = (horasAtras) => new Date(AGORA - horasAtras * HORA).toISOString()

// ---------------------------------------------------------------------------
// A janela: quando "1" quer dizer "confirmo" e quando quer dizer "menu"
// ---------------------------------------------------------------------------

conferir(
  'Lembrete de duas horas atrás ainda está na janela',
  respondendoEnvioNosso({ created_at: quando(2), appointment_id: 'a1' }, AGORA) === true,
)

conferir(
  'Lembrete de três dias atrás já saiu da janela',
  respondendoEnvioNosso({ created_at: quando(72), appointment_id: 'a1' }, AGORA) === false,
)

conferir(
  'Mensagem nossa sem consulta nem acompanhamento não abre janela',
  respondendoEnvioNosso({ created_at: quando(1), appointment_id: null, followup_id: null }, AGORA) ===
    false,
)

conferir(
  'Acompanhamento também abre a janela, não só a consulta',
  respondendoEnvioNosso({ created_at: quando(5), followup_id: 'f1' }, AGORA) === true,
)

conferir('Conversa sem nenhuma mensagem nossa não abre janela', respondendoEnvioNosso(null, AGORA) === false)

// Giovana, 13/10/2026: o aviso de cancelamento dizia "digite 2 para escolher
// uma nova data", e o 2 virou "remarcar" de uma consulta ja cancelada.
conferir(
  'Aviso de consulta cancelada não abre janela: o 2 volta a ser do menu',
  respondendoEnvioNosso({ created_at: quando(0.1), appointment_id: 'a1' }, AGORA, false) === false,
)
conferir(
  'Consulta ainda marcada continua abrindo a janela',
  respondendoEnvioNosso({ created_at: quando(0.1), appointment_id: 'a1' }, AGORA, true) === true,
)
conferir(
  'Sem saber o estado da consulta, vale o comportamento de antes',
  respondendoEnvioNosso({ created_at: quando(0.1), appointment_id: 'a1' }, AGORA) === true,
)

// ---------------------------------------------------------------------------
// O robô calado enquanto gente conversa
// ---------------------------------------------------------------------------

conferir(
  'Equipe escreveu há uma hora: o robô não interrompe',
  equipeFalouRecentemente({ created_at: quando(1) }, AGORA) === true,
)

conferir(
  'Equipe escreveu ontem: o robô volta a atender',
  equipeFalouRecentemente({ created_at: quando(20) }, AGORA) === false,
)

conferir(
  'Ninguém da equipe escreveu: o robô atende',
  equipeFalouRecentemente(null, AGORA) === false,
)

// Toque numa opcao do robo e pedido de marcar vencem a regra das 12h
// (26/10/2026, vindo do sistema do Dr. Marcello: la, a equipe escreveu "tente
// primeiro o menu", e o toque na lista e o "Oi quero marcar" ficaram sem
// resposta).
conferir(
  'Equipe falou e o paciente tocou numa lista do robô: o robô responde',
  equipeSeguraORobo(true, 'interactive') === false,
)
conferir(
  'Equipe falou e o paciente digitou: o robô continua calado',
  equipeSeguraORobo(true, 'text') === true,
)
conferir(
  'Equipe falou e o paciente tocou num botão de modelo (lembrete): continua a regra',
  equipeSeguraORobo(true, 'button') === true,
)
conferir(
  'Equipe falou e o paciente digitou um pedido de agendamento: o robô responde',
  equipeSeguraORobo(true, 'text', true) === false,
)
conferir(
  'Equipe não falou: nada segura o robô',
  equipeSeguraORobo(false, 'text') === false && equipeSeguraORobo(false, 'interactive') === false,
)

// Destravar (01/10/2026): a equipe devolveu a conversa ao robo. O Edu
// destravou, escreveu "Oi" 6h depois da equipe e o robo seguia calado.
conferir(
  'Equipe falou há 6h mas destravou depois: o robô volta a atender',
  equipeFalouRecentemente({ created_at: quando(6) }, AGORA, quando(1)) === false,
)

conferir(
  'Destravou e a equipe voltou a escrever depois: o robô se cala de novo',
  equipeFalouRecentemente({ created_at: quando(1) }, AGORA, quando(6)) === true,
)

// ---------------------------------------------------------------------------
// O que a pessoa quis dizer
// ---------------------------------------------------------------------------

const casos = [
  // [texto, dentroDaJanela, campo esperado]
  ['CONFIRMAR', true, 'confirma'],
  ['confirmar', true, 'confirma'],
  ['Confirmo', true, 'confirma'],
  ['1', true, 'confirma'],
  ['REMARCAR', true, 'remarca'],
  ['reagendar', true, 'remarca'],
  ['2', true, 'remarca'],
  ['CANCELAR', true, 'cancela'],
  ['cancelar consulta', true, 'cancela'],
  ['3', true, 'cancela'],
]

for (const [texto, janela, campo] of casos) {
  const r = interpretarResposta(texto, janela)
  conferir(`"${texto}" dentro da janela é ${campo}`, r[campo] === true && r.respondeuLembrete === true)
}

// O ponto mais importante da bateria: o mesmo "1" fora da janela NAO pode ser
// confirmacao, senao quem digita 1 no menu confirma uma consulta sem querer.
for (const numero of ['1', '2', '3']) {
  const r = interpretarResposta(numero, false)
  conferir(
    `"${numero}" fora da janela é opção de menu, não resposta ao lembrete`,
    r.respondeuLembrete === false,
  )
}

// A palavra escrita tambem so vale na janela: quem digita CANCELAR no meio de
// um agendamento esta desistindo do agendamento, nao cancelando consulta.
conferir(
  'CANCELAR fora da janela não desmarca consulta',
  interpretarResposta('CANCELAR', false).respondeuLembrete === false,
)

conferir(
  'Acentos e espaços não atrapalham',
  interpretarResposta('  Confirmar  ', true).confirma === true,
)

conferir(
  'Texto qualquer não vira resposta ao lembrete',
  interpretarResposta('bom dia, tudo bem?', true).respondeuLembrete === false,
)

// Cumprimento nao e resposta ao acompanhamento: "tudo bem?" e pergunta, e
// trata-la como "estou bem" faria o robo se calar diante de um bom dia.
conferir(
  '"bom dia, tudo bem?" não é a resposta "Estou bem"',
  interpretarResposta('bom dia, tudo bem?', true).isWell === false,
)

// ---------------------------------------------------------------------------
// O rótulo do botão mora na Meta, não aqui
// ---------------------------------------------------------------------------
//
// O modelo aprovado manda de volta o proprio texto do botao. Enquanto a
// comparacao era exata, um botao escrito "Confirmar presenca" nao batia com
// nada: o paciente tocava em confirmar e a consulta continuava nao confirmada,
// sem erro nenhum na tela. Estes casos existem para que trocar o texto do botao
// na Meta nunca mais quebre o sistema em silencio.

for (const rotulo of ['Confirmar presença', 'Confirmar presenca', 'CONFIRMAR PRESENÇA', 'quero confirmar minha consulta']) {
  conferir(`"${rotulo}" confirma a consulta`, interpretarResposta(rotulo, true).confirma === true)
}

for (const rotulo of ['Preciso remarcar', 'quero remarcar', 'Reagendar consulta', 'preciso de outro horario']) {
  conferir(`"${rotulo}" pede remarcação`, interpretarResposta(rotulo, true).remarca === true)
}

for (const rotulo of ['Cancelar consulta', 'preciso cancelar', 'quero desmarcar']) {
  conferir(`"${rotulo}" cancela`, interpretarResposta(rotulo, true).cancela === true)
}

// A negacao que manda na palavra inverte o sentido: melhor cair no atendimento
// humano do que confirmar a presenca de quem acabou de dizer que nao vai.
for (const frase of [
  'não posso confirmar',
  'não vou poder confirmar',
  'não quero cancelar',
  'não vou conseguir confirmar',
  'não quero mais cancelar',
]) {
  const r = interpretarResposta(frase, true)
  conferir(`"${frase}" não é tratada como resposta ao lembrete`, r.respondeuLembrete === false)
}

// ...mas so a negacao que MANDA na palavra. Ate 22/09/2026 qualquer "nao" em
// qualquer lugar anulava o pedido inteiro, e uma mae ficou sem resposta: o
// "nao" dela era da explicacao, nao do pedido. (Nomes inventados: este
// repositorio e publico.)
//
// PARA PROVAR: volte `semNegacao` para a regra antiga (um "nao" em qualquer
// lugar) e estes casos caem.
{
  const real =
    'Bom dia! Aqui é a Marta, mãe da Helena, vou precisar reagendar a consulta, ' +
    'pois fiquei doente e não consegui levar ela para fazer os exames que o doutor pediu.'
  conferir(
    'Caso de 22/09: "reagendar ... pois não consegui" pede remarcação',
    interpretarResposta(real, true).remarca === true,
  )
}
for (const [frase, campo] of [
  ['Não vou conseguir ir. Preciso remarcar', 'remarca'],
  ['não posso ir amanhã, pode cancelar', 'cancela'],
  ['Não, quero confirmar sim', 'confirma'],
  ['eu não tenho como ir amanhã então quero remarcar', 'remarca'],
]) {
  conferir(`"${frase}" é entendida (${campo})`, interpretarResposta(frase, true)[campo] === true)
}

// Duvida declarada nunca confirma nem cancela sozinha: cancelar apaga a vaga.
{
  const r = interpretarResposta('não sei se vou conseguir confirmar', true)
  conferir('"não sei se vou conseguir confirmar" não confirma', r.confirma === false)
  const c = interpretarResposta('não sei se preciso cancelar', true)
  conferir('"não sei se preciso cancelar" não cancela', c.cancela === false)
}

conferir(
  '"Preciso de ajuda" continua chamando a equipe',
  interpretarResposta('Preciso de ajuda', false).pediuAjuda === true,
)

conferir(
  '"vou sair de viagem" não descadastra ninguém',
  interpretarResposta('vou sair de viagem', false).optedOut === false,
)

conferir(
  '"Não quero receber" descadastra',
  interpretarResposta('Não quero receber', false).optedOut === true,
)

// ---------------------------------------------------------------------------
// Quem precisa aparecer para a equipe
// ---------------------------------------------------------------------------

conferir(
  'Confirmar não incomoda a equipe',
  interpretarResposta('CONFIRMAR', true).motivoAtencao === null,
)
conferir(
  'Remarcar chama a equipe',
  interpretarResposta('REMARCAR', true).motivoAtencao === 'remarcacao',
)
conferir(
  'Cancelar chama a equipe',
  interpretarResposta('CANCELAR', true).motivoAtencao === 'cancelamento',
)
conferir(
  'Pedido de ajuda chama a equipe mesmo fora da janela',
  interpretarResposta('preciso de ajuda', false).motivoAtencao === 'ajuda',
)
conferir('SAIR é descadastro, não resposta', interpretarResposta('sair', true).optedOut === true)

// ---------------------------------------------------------------------------
// O que é gravado na consulta
// ---------------------------------------------------------------------------

const AGORA_ISO = new Date(AGORA).toISOString()

const gravaConfirmar = mudancaDaConsulta(interpretarResposta('CONFIRMAR', true), AGORA_ISO)
conferir(
  'Confirmar grava a data e limpa pedido de remarcação anterior',
  gravaConfirmar.confirmed_at === AGORA_ISO && gravaConfirmar.reschedule_requested_at === null,
  JSON.stringify(gravaConfirmar),
)

const gravaCancelar = mudancaDaConsulta(interpretarResposta('CANCELAR', true), AGORA_ISO)
conferir(
  'Cancelar muda o status para liberar a vaga',
  gravaCancelar.status === 'cancelled' && gravaCancelar.cancelled_at === AGORA_ISO,
  JSON.stringify(gravaCancelar),
)

const gravaRemarcar = mudancaDaConsulta(interpretarResposta('REMARCAR', true), AGORA_ISO)
conferir(
  'Remarcar anota o pedido sem cancelar nada',
  gravaRemarcar.reschedule_requested_at === AGORA_ISO && gravaRemarcar.status === undefined,
  JSON.stringify(gravaRemarcar),
)

// ---------------------------------------------------------------------------
// O que a pessoa recebe de volta
// ---------------------------------------------------------------------------

for (const [texto, trecho] of [
  ['CONFIRMAR', 'confirmada'],
  ['CANCELAR', 'cancelada'],
  ['REMARCAR', 'remarcar'],
]) {
  const aviso = avisoDaResposta(interpretarResposta(texto, true))
  conferir(`Resposta a ${texto} confirma o que aconteceu`, aviso.toLowerCase().includes(trecho), aviso)
  // Nenhuma mensagem pode terminar sem dizer o proximo passo.
  conferir(`Resposta a ${texto} não deixa no vácuo`, aviso.includes('0'), aviso)
}

// ---------------------------------------------------------------------------

console.log('\n===== RESPOSTA AO LEMBRETE =====')
// ---- Botoes do acompanhamento ----
{
  const base = { confirma: false, remarca: false, cancela: false, respondeuLembrete: false, optedOut: false, isWell: false, pediuAjuda: false, motivoAtencao: null }
  conferir('estou bem recebe resposta', /Que bom/.test(respostaAoAcompanhamento({ ...base, isWell: true }) ?? ''))
  conferir('preciso de ajuda avisa a equipe', /equipe/.test(respostaAoAcompanhamento({ ...base, pediuAjuda: true, motivoAtencao: 'ajuda' }) ?? ''))
  conferir('nao quero receber confirma', /não enviaremos/.test(respostaAoAcompanhamento({ ...base, optedOut: true }) ?? ''))
  conferir('sem botao, sem resposta', respostaAoAcompanhamento(base) === null)
}


// ---------------------------------------------------------------------------
// A janela de envio: quem recebe lembrete em cada passada
// ---------------------------------------------------------------------------
//
// Regra desde 21/09/2026: a passada da manha avisa o dia INTEIRO de amanha.
// Antes a janela era "24 horas a frente", e a consulta das 17:20 de amanha so
// era avisada as 17:20 de hoje - tarde demais para a familia se programar.
//
// PARA PROVAR QUE ESTES TESTES PEGAM O DEFEITO: em janelaDeLembrete, troque
// `fim: fimDoDiaLocal(...)` por `fim: new Date(agora.getTime() + dias*24*3600*1000)`
// (a regra antiga). Os casos "manha" abaixo caem.

const SP = 'America/Sao_Paulo'
const emSP = (texto) => new Date(`${texto}-03:00`) // Sao Paulo nao tem horario de verao desde 2019
const dentro = (janela, instante) => instante >= janela.inicio && instante < janela.fim

{
  // Passada da manha de segunda 21/09, 09:20. Amanha e terca 22/09.
  const janela = janelaDeLembrete(emSP('2026-09-21T09:20:00'), 1, SP)

  conferir(
    'Manha: o fim da janela e a meia-noite que encerra amanha',
    janela.fim.toISOString() === emSP('2026-09-23T00:00:00').toISOString(),
    `veio ${janela.fim.toISOString()}`,
  )
  conferir(
    'Manha: consulta das 14:00 de amanha entra',
    dentro(janela, emSP('2026-09-22T14:00:00')),
  )
  conferir(
    'Manha: consulta das 17:20 de amanha TAMBEM entra (era o que faltava)',
    dentro(janela, emSP('2026-09-22T17:20:00')),
  )
  conferir(
    'Manha: consulta das 09:00 de depois de amanha ainda nao entra',
    !dentro(janela, emSP('2026-09-23T09:00:00')),
  )
  conferir(
    'Manha: consulta de hoje daqui a 3 horas entra (marcou de manha para a tarde)',
    dentro(janela, emSP('2026-09-21T12:30:00')),
  )
  conferir(
    'Manha: consulta de hoje daqui a 1 hora NAO entra - perto demais, vira susto',
    !dentro(janela, emSP('2026-09-21T10:20:00')),
  )
}

{
  // A protecao de 31/08: quem marca DEPOIS da passada da manha para amanha e
  // pego na passada seguinte, e nao fica sem aviso.
  const janela = janelaDeLembrete(emSP('2026-09-21T15:20:00'), 1, SP)
  conferir(
    'Tarde: consulta marcada as 15h para amanha 09:00 entra na passada das 15:20',
    dentro(janela, emSP('2026-09-22T09:00:00')),
  )
}

{
  // O fuso: as 23:50 de Sao Paulo ainda e 21/09, mesmo que em UTC ja seja
  // 22/09 02:50. "Amanha" precisa continuar sendo 22/09.
  const janela = janelaDeLembrete(emSP('2026-09-21T23:50:00'), 1, SP)
  conferir(
    'Fuso: as 23:50 de SP, amanha ainda e 22/09 (em UTC ja virou o dia)',
    janela.fim.toISOString() === emSP('2026-09-23T00:00:00').toISOString(),
    `veio ${janela.fim.toISOString()}`,
  )
  // ...e as 00:10 de SP ja e 22/09, entao amanha e 23/09.
  const depois = janelaDeLembrete(emSP('2026-09-22T00:10:00'), 1, SP)
  conferir(
    'Fuso: as 00:10 de SP, amanha e 23/09',
    depois.fim.toISOString() === emSP('2026-09-24T00:00:00').toISOString(),
    `veio ${depois.fim.toISOString()}`,
  )
}

conferir(
  'Dois dias de antecedencia: fim da janela e o fim de depois de amanha',
  fimDoDiaLocal(emSP('2026-09-21T09:20:00'), 2, SP).toISOString() ===
    emSP('2026-09-24T00:00:00').toISOString(),
)

conferir(
  'Zero dias: fim da janela e o fim de hoje',
  fimDoDiaLocal(emSP('2026-09-21T09:20:00'), 0, SP).toISOString() ===
    emSP('2026-09-22T00:00:00').toISOString(),
)


// ---------------------------------------------------------------------------
// Toque em lista antiga (caso real de 22/09/2026)
// ---------------------------------------------------------------------------
//
// PARA PROVAR: em oQueFoiEscolhido, devolva sempre `toque.id`. O caso da lista
// antiga cai - e era ele que marcava o horario que ninguem escolheu.
{
  const real = { id: '4', titulo: 'sexta, 02/10', respondeA: 'wamid.LISTA_DE_DATAS', ultimoEnvio: 'wamid.LISTA_DE_HORARIOS' }
  conferir(
    'Toque numa lista antiga usa o texto do item, não o número',
    oQueFoiEscolhido(real) === 'sexta, 02/10',
    `veio ${oQueFoiEscolhido(real)}`,
  )
  conferir(
    'Toque na lista mais recente usa o número, como sempre',
    oQueFoiEscolhido({ ...real, respondeA: 'wamid.LISTA_DE_HORARIOS' }) === '4',
  )
  conferir(
    'Sem saber qual foi a última mensagem, fica como sempre foi',
    oQueFoiEscolhido({ ...real, ultimoEnvio: null }) === '4',
  )
  conferir(
    'Evento sem contexto fica como sempre foi',
    oQueFoiEscolhido({ ...real, respondeA: null }) === '4',
  )
  conferir(
    'Texto digitado passa direto',
    oQueFoiEscolhido({ id: '', titulo: 'quero marcar' }) === 'quero marcar',
  )
}

// ---------------------------------------------------------------------------
// Contexto do acompanhamento pos-consulta (03/10/2026)
// ---------------------------------------------------------------------------
//
// O "Que bom saber!" do robo nao pode apagar o contexto: quem decide e o
// acompanhamento mais recente, nao a ultima mensagem nossa.
conferir('Acompanhamento de 1h atrás ainda vale', depoisDoAcompanhamento({ created_at: quando(1) }, AGORA) === true)
conferir('Acompanhamento de 47h atrás ainda vale', depoisDoAcompanhamento({ created_at: quando(47) }, AGORA) === true)
// 7 dias desde 06/10/2026: o pai do Samuel respondeu 3 dias depois.
conferir('Real 06/10: acompanhamento de 3 dias atrás ainda vale', depoisDoAcompanhamento({ created_at: quando(72) }, AGORA) === true)
conferir('Acompanhamento de 8 dias atrás já não vale', depoisDoAcompanhamento({ created_at: quando(8 * 24) }, AGORA) === false)

// Lembrete que já não é a última mensagem (real 06/10/2026, Leandro).
conferir('Lembrete de 7h atrás é recente', lembreteRecente({ created_at: quando(7) }, AGORA) === true)
conferir('Lembrete de 3 dias atrás não é recente', lembreteRecente({ created_at: quando(72) }, AGORA) === false)
conferir('Real 06/10: "Confirmado" com lembrete recente confirma', interpretarResposta('Confirmado', false, true).confirma === true)
conferir('Mas "1" sem o lembrete ser a última mensagem continua sendo menu', interpretarResposta('1', false, true).confirma === false)
conferir('E "cancelar" fora da janela não cancela a consulta', interpretarResposta('cancelar', false, true).cancela === false)
conferir('Sem lembrete recente, "Confirmado" solto não confirma nada', interpretarResposta('Confirmado', false, false).confirma === false)
conferir('Sem acompanhamento, não vale', depoisDoAcompanhamento(null, AGORA) === false)
conferir('Relógio torto (no futuro) não vale', depoisDoAcompanhamento({ created_at: quando(-2) }, AGORA) === false)

conferir(
  'Botao "Estamos bem" do acompanhamento v2 e resposta positiva',
  interpretarResposta('Estamos bem', true).isWell === true,
)

// Endereco no lembrete e na confirmacao (09/10/2026): duas familias foram ao
// endereco antigo de Santos com o lembrete dizendo so o nome da unidade.
conferir(
  'Lembrete leva o endereço junto do nome da unidade',
  unidadeNoLembrete('presencial', 'Livance · Santos', 'Av. Anna Costa, 228, 20º andar, Gonzaga, Santos - SP') ===
    'Livance · Santos (Av. Anna Costa, 228, 20º andar, Gonzaga, Santos - SP)',
)
conferir(
  'CEP e quebra de linha saem do endereço do lembrete',
  unidadeNoLembrete('presencial', 'Livance Ibirapuera', 'Rua Agostinho Rodrigues Filho, 550,\nVila Clementino - CEP 04026-040') ===
    'Livance Ibirapuera (Rua Agostinho Rodrigues Filho, 550, Vila Clementino)',
)
conferir('Telemedicina continua "virtual"', unidadeNoLembrete('telemedicina', 'Telemedicina', '') === 'virtual (consulta por vídeo)')
conferir('Sem endereço, só o nome', unidadeNoLembrete('presencial', 'Livance · Santos', '') === 'Livance · Santos')
conferir(
  'Confirmação repete onde é a consulta',
  avisoDaResposta(interpretarResposta('1', true), 'Livance · Santos (Av. Anna Costa, 228)').includes('📍 Livance · Santos (Av. Anna Costa, 228)'),
)

// "Estamos bem" encerra a conversa (feriado de 12/10/2026: a equipe respondeu
// pelo modelo pago tres familias que o robo ja tinha atendido).
conferir('"Estamos bem" sem pendência encerra a conversa', acompanhamentoEncerraConversa(interpretarResposta('Estamos bem', true), false) === true)
conferir('"Estamos bem" com pedido em aberto não encerra', acompanhamentoEncerraConversa(interpretarResposta('Estamos bem', true), true) === false)
conferir('"Preciso de ajuda" não encerra', acompanhamentoEncerraConversa(interpretarResposta('Preciso de ajuda', true), false) === false)

// "Tirem meu numero da lista" (painel, 14/10/2026) e descadastro; frase com
// "parar" sobre remedio nao e.
for (const [frase, esperado] of [
  ['tirem meu número da lista por favor', true],
  ['remove meu telefone', true],
  ['parem de me mandar mensagem', true],
  ['quero me descadastrar', true],
  ['o médico mandou parar de dar o remédio', false],
  ['pode tirar uma dúvida?', false],
]) {
  conferir(`Descadastro: "${frase}"`, interpretarResposta(frase, false).optedOut === esperado)
}

// Dois pedidos de sair (15/10/2026): o do acompanhamento para so o
// acompanhamento; "tirem meu numero" para tudo, lembrete inclusive.
for (const [frase, tudo] of [
  ['Não quero receber', false],
  ['SAIR', false],
  ['não quero mais receber', false],
  ['não quero receber nada', true],
  ['tirem meu número da lista por favor', true],
  ['parem de me mandar mensagem', true],
  ['quero me descadastrar', true],
]) {
  const r = interpretarResposta(frase, false)
  conferir(`Sair "${frase}": ${tudo ? 'tudo' : 'só acompanhamento'}`, r.optedOut && r.paraTudo === tudo)
}
conferir('Só acompanhamento: a resposta fala em acompanhamento',
  /acompanhamento/.test(respostaAoAcompanhamento(interpretarResposta('Não quero receber', false)) ?? ''))
conferir('Tudo: a resposta diz que nem lembrete sai',
  /nem lembrete/.test(respostaAoAcompanhamento(interpretarResposta('tirem meu número', false)) ?? ''))

// Pedido de sair e a mensagem seguinte (15/10/2026). O "ok, obrigado" nao
// desfaz o pedido; a mae que volta para marcar e atendida normalmente.
conferir('Pedido de sair: fica fora da lista', depoisDoPedidoDeSair('open', true, 'tirem meu numero') === 'opted_out')
conferir('"Ok, obrigado" depois de sair: continua fora', depoisDoPedidoDeSair('opted_out', false, 'Ok, obrigado!') === 'opted_out')
conferir('Volta meses depois para marcar: conversa reabre e o robô atende', depoisDoPedidoDeSair('opted_out', false, 'Oi, queria marcar o retorno do Vicente') === 'open')
conferir('Conversa comum: continua aberta', depoisDoPedidoDeSair('resolved', false, 'oi') === 'open')

// "Confirma" e o "sim" depois do lembrete (20/10/2026 no sistema do Dr.
// Marcello, trazido em 25/10/2026): la, "Confirma" deixou a consulta "sem resposta".
for (const texto of ['Confirma', 'confirma!', 'Confirmada', 'confirmamos sim', 'Confirmei']) {
  conferir(`"${texto}" depois do lembrete confirma`, interpretarResposta(texto, true, false, true).confirma === true)
}
conferir('"Confirma" com lembrete recente (não a última) confirma', interpretarResposta('Confirma', false, true, false).confirma === true)
// O lembrete pergunta "Podemos confirmar sua presença?": "sim" responde.
for (const texto of ['Sim', 'sim!', 'Ok', 'ok, obrigada', 'Sim, estarei lá', 'Vou sim', 'estarei lá', 'Com certeza 👍', 'Certo']) {
  conferir(`"${texto}" logo depois do lembrete confirma`, interpretarResposta(texto, true, false, true).confirma === true)
}
// ... mas so depois do PROPRIO lembrete: depois do acompanhamento, "sim" e outra conversa.
conferir('"Sim" depois do acompanhamento não confirma consulta', interpretarResposta('Sim', true, false, false).confirma === false)
conferir('"ok" sem o lembrete como última mensagem não confirma', interpretarResposta('ok', false, true, false).confirma === false)
// "nao" na frase e o pedido junto mandam mais que o "sim".
conferir('"sim, não vou conseguir" não confirma', interpretarResposta('sim, não vou conseguir', true, false, true).confirma === false)
conferir('"Sim, mas preciso remarcar" é remarcar', (() => { const r = interpretarResposta('Sim, mas preciso remarcar', true, false, true); return r.remarca && !r.confirma })())
conferir('"Não posso confirmar" continua não confirmando', interpretarResposta('Não posso confirmar', true, false, true).confirma === false)
conferir('"sim" no meio de outra frase não confirma', interpretarResposta('tem estacionamento sim?', true, false, true).confirma === false)
// O botao "Escolher outra data" da confirmacao e pedido de remarcar.
conferir('"Escolher outra data" remarca', interpretarResposta('Escolher outra data', true).remarca === true)
conferir('"não quero outra data" não remarca', interpretarResposta('não quero outra data, está ótimo', true).remarca === false)
// O webhook passa a ultima mensagem nossa: so o lembrete (consulta, sem acompanhamento, modelo).
{
  const webhook = readFileSync(new URL('../supabase/functions/meta-webhook/index.ts', import.meta.url), 'utf8')
  conferir('Webhook: ultimaFoiLembrete pelo modelo da consulta', /ultimaFoiLembrete = respondendoEnvioNosso && Boolean\(u\?\.appointment_id && !u\.followup_id && u\.template_name\)/.test(webhook))
  conferir('Webhook: interpretarResposta recebe ultimaFoiLembrete', /comLembreteRecente && !equipeFalouRecentemente,\s*ultimaFoiLembrete,\s*\)/.test(webhook))
}

console.log(`VERIFICAÇÕES QUE PASSARAM: ${passou}`)
console.log(`FALHAS: ${falhas.length}`)
if (falhas.length) {
  console.log('')
  for (const f of falhas) console.log(`✗ ${f}`)
  process.exit(1)
}

