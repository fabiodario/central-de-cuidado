// A resposta do medico ao alerta de urgencia, pelo WhatsApp dele (17/10/2026,
// pedido do Edu). Regra em supabase/functions/_shared/resposta-ao-alerta.ts.
// Banco e Meta de mentira: o que se testa e o que chega ao paciente, ao
// medico e ao registro. No fim, o mesmo caminho no simulador. Telefones
// inventados (o repositorio e publico). No "npm run test:bot". Para provar
// que um caso pega o defeito, ver DESLIGAR em tests/montar-para-teste.mjs.
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bancoCom, conferirDesligar, lerComTrocas, montar } from './montar-para-teste.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SHARED = join(AQUI, '..', 'supabase', 'functions', '_shared')
const R = await montar(join(SHARED, 'resposta-ao-alerta.ts'), join(AQUI, 'resposta-ao-alerta.build.mjs'))
const V = await montar(join(SHARED, 'veredito.ts'), join(AQUI, 'veredito-do-alerta.build.mjs'))
const { BancoFalso } = await montar(join(AQUI, '..', 'src', 'simulador', 'banco-falso.ts'), join(AQUI, 'banco-falso.build.mjs'))
const S = await montar(join(AQUI, '..', 'src', 'simulador', 'sessao.ts'), join(AQUI, 'sessao-do-alerta.build.mjs'))
const { IDENTIDADES, FAMILIAS } = await montar(join(AQUI, '..', 'src', 'simulador', 'dados.ts'), join(AQUI, 'dados-do-alerta.build.mjs'))
const ler = (...partes) => lerComTrocas(join(AQUI, '..', ...partes))

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

const FABIO = 'b5d0f6a2-3c71-4e8a-9f2d-7a1c4e9b0d63'
const MEDICO = '5513900000001'
const DAYANE = '5513900000002'
const PACIENTE = '5513900000009'
const AGORA = new Date('2026-10-18T02:30:00Z')
const haMinutos = (m) => new Date(AGORA.getTime() - m * 60000).toISOString()
const A1 = '11111111-1111-4111-8111-111111111111'
const A2 = '22222222-2222-4222-8222-222222222222'

function alerta(extra = {}) {
  return {
    id: A1, clinic_id: FABIO, conversation_id: 'conv-1', teste: false, motivo: 'sangramento', quem: 'Paciente de Teste',
    mensagens: ['wamid.ALERTA1'], veredito: null, veredito_por: null, veredito_em: null,
    rascunho: null, rascunho_de: null, rascunho_em: null, criado_em: haMinutos(30), ...extra,
  }
}

function cenario({ alertas = [alerta()], ultimaDoPaciente = haMinutos(35), semTabela = [], status = 'open', metaRecusa = null } = {}) {
  const banco = new BancoFalso(
    {
      alertas_de_urgencia: alertas,
      whatsapp_conversations: [
        { id: 'conv-1', clinic_id: FABIO, wa_id: PACIENTE, patient_id: 'p1', status, needs_attention: true, attention_reason: 'sangramento', booking_state: 'aguardando_dia' },
      ],
      whatsapp_messages: [{ conversation_id: 'conv-1', direction: 'inbound', message_type: 'text', created_at: ultimaDoPaciente }],
    },
    {},
  )
  const enviados = []
  const amb = {
    admin: bancoCom(banco, { semTabela }),
    clinicId: FABIO,
    agora: AGORA,
    numeros: [MEDICO, DAYANE],
    enviarWhatsApp: async (para, conteudo) => {
      enviados.push({ para, conteudo })
      if (metaRecusa && para === PACIENTE) return { ok: false, erro: metaRecusa }
      return { ok: true, id: `wamid.${enviados.length}` }
    },
  }
  const textoDe = (e) => e.conteudo.text?.body ?? e.conteudo.interactive?.body?.text ?? ''
  const para = (numero) => enviados.filter((e) => e.para === numero).map(textoDe)
  const conversa = () => banco.linhas('whatsapp_conversations')[0]
  const linha = (id = A1) => banco.linhas('alertas_de_urgencia').find((a) => a.id === id)
  return { banco, enviados, amb, para, textoDe, conversa, linha }
}
const toque = (payload) => ({ type: 'button', button: { payload, text: 'x' } })
const toqueInterativo = (id) => ({ type: 'interactive', interactive: { button_reply: { id, title: 'x' } } })
const texto = (body, citado = null) => ({ type: 'text', text: { body }, ...(citado ? { context: { id: citado } } : {}) })
const notas = (banco) => banco.linhas('conversation_notes').map((n) => n.texto)
const eventos = (banco) => banco.linhas('whatsapp_bot_events').map((e) => `${e.evento} ${e.detalhe}`)

// ---- Pecas puras ----

await caso('le o toque, a confirmacao, o "ok", o texto e o audio', () => {
  assert.deepEqual(R.lerRespostaDaEquipe(toque(`URG:${A1}:urgente`)), { tipo: 'veredito', alertaId: A1, veredito: 'urgente' })
  assert.deepEqual(R.lerRespostaDaEquipe(toque(`URG:${A1}:nao_urgente`)), { tipo: 'veredito', alertaId: A1, veredito: 'nao_urgente' })
  assert.equal(R.lerRespostaDaEquipe(toqueInterativo(`URGTXT:${A1}:enviar`))?.tipo, 'confirmacao')
  assert.equal(R.lerRespostaDaEquipe(toque('CONFIRMAR')), null, 'botao do lembrete nao e daqui')
  assert.equal(R.lerRespostaDaEquipe(toque(`URG:${A1}:aguardar`)), null, 'so os vereditos do alerta')
  assert.equal(R.lerRespostaDaEquipe(texto('Ok!'))?.tipo, 'visto')
  assert.equal(R.lerRespostaDaEquipe(texto('👍'))?.tipo, 'visto')
  assert.equal(R.lerRespostaDaEquipe(texto('Pode fazer compressa e me avisa'))?.tipo, 'texto')
  assert.equal(R.lerRespostaDaEquipe({ type: 'audio' })?.tipo, 'midia')
  assert.equal(R.lerRespostaDaEquipe(texto('oi', 'wamid.X'))?.citado, 'wamid.X')
})

await caso('o primeiro numero e o medico, com e sem o nono digito', () => {
  assert.equal(R.papelDoNumero('551300000001', [MEDICO, DAYANE]), null, 'fixo nao vira celular')
  assert.equal(R.papelDoNumero('13900000001', [MEDICO, DAYANE]), 'medico')
  assert.equal(R.papelDoNumero(DAYANE, [MEDICO, DAYANE]), 'equipe')
  assert.equal(R.papelDoNumero(PACIENTE, [MEDICO, DAYANE]), null)
})

await caso('o texto ao paciente: o veredito e o mesmo da tela; a equipe nao classifica', () => {
  assert.equal(R.textoParaOPaciente('urgente', 'medico', FABIO), V.textoDoVeredito('urgente', FABIO))
  assert.equal(R.textoParaOPaciente('nao_urgente', 'medico', FABIO), V.textoDoVeredito('nao_urgente', FABIO))
  assert.equal(R.textoParaOPaciente('urgente', 'equipe', FABIO), null)
  assert.equal(R.textoParaOPaciente('nao_urgente', 'equipe', FABIO), null)
  assert.equal(R.textoParaOPaciente('responde', 'medico', FABIO), '💙 O Dr. Fábio viu a sua mensagem e vai falar com você por aqui.')
  assert.equal(R.textoParaOPaciente('responde', 'equipe', FABIO), '💙 A nossa equipe viu a sua mensagem e vai falar com você por aqui.')
  assert.equal(R.textoParaOPaciente('texto', 'medico', FABIO, 'Oi'), '💬 Mensagem do Dr. Fábio: Oi')
  assert.equal(R.textoParaOPaciente('texto', 'equipe', FABIO, 'Oi'), '💬 Mensagem da equipe do consultório: Oi')
  for (const t of ['urgente', 'nao_urgente', 'responde', 'texto']) {
    assert.doesNotMatch(R.textoParaOPaciente(t, 'medico', FABIO, 'x'), /[\u2013\u2014]|crian[cç]a|fam[ií]lia/i)
  }
})

await caso('de qual alerta e o texto: o citado; sem citar, o unico das ultimas 6 horas', () => {
  const dois = [alerta(), alerta({ id: A2, quem: 'Outro Paciente', mensagens: ['wamid.ALERTA2'], criado_em: haMinutos(10) })]
  assert.equal(R.escolherAlerta(dois, 'wamid.ALERTA2', AGORA)?.alerta?.id, A2)
  assert.equal(R.escolherAlerta(dois, null, AGORA)?.ambiguos?.length, 2)
  assert.equal(R.escolherAlerta([alerta({ criado_em: haMinutos(7 * 60) })], null, AGORA), null)
  assert.equal(R.escolherAlerta([alerta({ criado_em: haMinutos(7 * 60) })], 'wamid.ALERTA1', AGORA)?.alerta?.id, A1, 'citado vale mesmo depois de 6 horas')
})

// ---- O caminho inteiro ----

await caso('"E urgente": o paciente recebe o texto da tela, o medico o OK, e fica tudo registrado', async () => {
  const c = cenario()
  assert.equal(await R.tratarRespostaDaEquipe(c.amb, MEDICO, toque(`URG:${A1}:urgente`)), true)
  assert.deepEqual(c.para(PACIENTE), [V.textoDoVeredito('urgente', FABIO)])
  assert.deepEqual(c.para(MEDICO), ['✅ Enviado para Paciente de Teste.'])
  assert.equal(c.linha().veredito, 'urgente')
  assert.equal(c.linha().veredito_por, MEDICO)
  assert.equal(c.conversa().needs_attention, false, 'como o veredito da tela: sai da lista')
  assert.deepEqual(notas(c.banco), ['🩺 O Dr. Fábio respondeu ao alerta: é urgente (pelo WhatsApp).'])
  assert.deepEqual(eventos(c.banco), ['veredito_urgencia urgente motivo=sangramento pelo=whatsapp medico'])
  const saida = c.banco.linhas('whatsapp_messages').find((m) => m.direction === 'outbound')
  assert.equal(saida.automatic, false, 'mensagem de gente, como o veredito da tela')
  assert.equal(saida.status, 'accepted')
})

await caso('vale o primeiro veredito: o segundo toque nao manda nada ao paciente', async () => {
  const c = cenario()
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, toque(`URG:${A1}:urgente`))
  const antes = c.para(PACIENTE).length
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, toque(`URG:${A1}:nao_urgente`))
  assert.equal(c.para(PACIENTE).length, antes)
  assert.equal(c.para(MEDICO).at(-1), 'Esse alerta já foi respondido (é urgente). Nada novo foi enviado ao paciente.')
  assert.equal(c.linha().veredito, 'urgente')
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, toque(`URG:${A1}:responde`))
  assert.equal(c.para(PACIENTE).length, antes, '"Eu respondo" depois do veredito tambem nao sai')
})

await caso('"Pode aguardar": o botao de marcar, o "se piorar" e a conversa na fila da equipe', async () => {
  const c = cenario()
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, toque(`URG:${A1}:nao_urgente`))
  const msg = c.enviados.find((e) => e.para === PACIENTE)
  assert.deepEqual(msg.conteudo.interactive.action.buttons.map((b) => b.reply), [{ id: 'MARCAR_AGORA', title: 'Marcar uma consulta' }])
  assert.match(c.textoDe(msg), /Marcar uma consulta\* para ver os horários mais próximos\. Se piorar, é só escrever aqui\.$/)
  assert.equal(c.conversa().attention_reason, 'atendente')
  assert.equal(c.conversa().needs_attention, true)
  assert.equal(c.conversa().booking_state, 'atendente', 'e nessa etapa que o toque em Marcar uma consulta funciona')
})

await caso('so o medico classifica; a equipe pode dizer que responde, e o medico ainda classifica depois', async () => {
  const c = cenario()
  await R.tratarRespostaDaEquipe(c.amb, DAYANE, toque(`URG:${A1}:urgente`))
  assert.match(c.para(DAYANE).at(-1), /^Só o Dr\. Fábio classifica a urgência pelos botões/)
  assert.equal(c.para(PACIENTE).length, 0)
  assert.equal(c.linha().veredito, null)
  await R.tratarRespostaDaEquipe(c.amb, DAYANE, toque(`URG:${A1}:responde`))
  assert.equal(c.para(PACIENTE).at(-1), '💙 A nossa equipe viu a sua mensagem e vai falar com você por aqui.')
  assert.equal(c.conversa().attention_reason, 'sangramento', '"Eu respondo" nao tira a conversa da urgencia')
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, toque(`URG:${A1}:urgente`))
  assert.equal(c.para(PACIENTE).at(-1), V.textoDoVeredito('urgente', FABIO))
})

await caso('texto do medico: so vai depois do Enviar, e so quem escreveu confirma', async () => {
  const c = cenario()
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, texto('Pode fazer compressa fria e me avise em 1 hora', 'wamid.ALERTA1'))
  assert.equal(c.para(PACIENTE).length, 0, 'nada ao paciente antes do Enviar')
  const pergunta = c.enviados.at(-1)
  assert.equal(pergunta.para, MEDICO)
  assert.equal(c.textoDe(pergunta), 'Vou mandar para Paciente de Teste, como mensagem do Dr. Fábio:\n\n"Pode fazer compressa fria e me avise em 1 hora"\n\nConfirma?')
  assert.deepEqual(pergunta.conteudo.interactive.action.buttons.map((b) => b.reply.title), ['Enviar', 'Cancelar'])
  await R.tratarRespostaDaEquipe(c.amb, DAYANE, toqueInterativo(`URGTXT:${A1}:enviar`))
  assert.match(c.para(DAYANE).at(-1), /escrita por outra pessoa/)
  assert.equal(c.para(PACIENTE).length, 0)
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, toqueInterativo(`URGTXT:${A1}:enviar`))
  assert.deepEqual(c.para(PACIENTE), ['💬 Mensagem do Dr. Fábio: Pode fazer compressa fria e me avise em 1 hora'])
  assert.equal(c.linha().rascunho, null)
  assert.equal(c.linha().veredito, 'texto')
  assert.equal(c.conversa().attention_reason, 'sangramento', 'o texto nao classifica: a conversa segue acesa')
  // O medico ainda pode classificar depois do texto.
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, toque(`URG:${A1}:nao_urgente`))
  assert.equal(c.para(PACIENTE).at(-1), V.textoDoVeredito('nao_urgente', FABIO))
})

await caso('cancelar, texto longo demais e o Enviar sem rascunho', async () => {
  const c = cenario()
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, texto('liga pra ela agora', 'wamid.ALERTA1'))
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, toqueInterativo(`URGTXT:${A1}:cancelar`))
  assert.equal(c.para(PACIENTE).length, 0)
  assert.equal(c.para(MEDICO).at(-1), 'Cancelado: nada foi enviado ao paciente.')
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, toqueInterativo(`URGTXT:${A1}:enviar`))
  assert.match(c.para(MEDICO).at(-1), /Não achei a mensagem para enviar/)
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, texto('x'.repeat(R.LIMITE_DO_TEXTO + 1)))
  assert.match(c.para(MEDICO).at(-1), /passa de 800 caracteres/)
  assert.equal(c.linha().rascunho, null, 'o texto longo nao vira rascunho sem botao de confirmar')
  // No limite, a confirmacao ainda cabe com os botoes.
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, texto('y'.repeat(R.LIMITE_DO_TEXTO)))
  assert.equal(c.enviados.at(-1).conteudo.type, 'interactive')
})

await caso('"ok", audio, dois alertas, nenhum alerta, fora da lista, sem a tabela', async () => {
  const c = cenario()
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, texto('ok'))
  assert.equal(c.para(MEDICO).at(-1), '👍 Anotado.')
  assert.deepEqual(notas(c.banco), ['🩺 O Dr. Fábio viu o alerta (pelo WhatsApp).'])
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, { type: 'audio', audio: { id: 'a' } })
  assert.match(c.para(MEDICO).at(-1), /só consigo repassar texto/)
  assert.equal(c.para(PACIENTE).length, 0)

  // Com dois avisos, o "ok" pergunta de qual (o texto vai para a escolha num toque, abaixo).
  const dois = cenario({ alertas: [alerta(), alerta({ id: A2, quem: 'Outro Paciente', mensagens: ['wamid.ALERTA2'], criado_em: haMinutos(5) })] })
  await R.tratarRespostaDaEquipe(dois.amb, MEDICO, texto('ok'))
  assert.match(dois.para(MEDICO).at(-1), /Há 2 avisos recentes \(Outro Paciente, Paciente de Teste\)\. Para eu saber de qual paciente é, segure a mensagem do aviso certo/)

  const velho = cenario({ alertas: [alerta({ criado_em: haMinutos(10 * 60) })] })
  assert.equal(await R.tratarRespostaDaEquipe(velho.amb, MEDICO, texto('oi, tudo bem?')), false, 'sem alerta em 6 horas: segue o robo')
  assert.equal(await R.tratarRespostaDaEquipe(cenario().amb, PACIENTE, texto('oi')), false, 'fora da lista: segue o robo')
  assert.equal(await R.tratarRespostaDaEquipe(cenario({ semTabela: ['alertas_de_urgencia'] }).amb, MEDICO, toque(`URG:${A1}:urgente`)), false, 'sem a tabela: segue o robo')
})

await caso('janela de 24 horas fechada: nada sai, o medico fica sabendo e o alerta volta a ficar em aberto', async () => {
  const c = cenario({ alertas: [alerta({ criado_em: haMinutos(26 * 60) })], ultimaDoPaciente: haMinutos(26 * 60) })
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, toque(`URG:${A1}:urgente`))
  assert.equal(c.para(PACIENTE).length, 0)
  assert.equal(c.para(MEDICO).at(-1), '⚠️ Não consegui enviar para Paciente de Teste: a janela de 24 horas do WhatsApp do paciente fechou. Responda pela Central.')
  assert.equal(c.linha().veredito, null, 'a tela de Respostas ainda pode dar o veredito')
  assert.match(notas(c.banco)[0], /NÃO chegou ao paciente: a janela de 24 horas/)
  assert.deepEqual(eventos(c.banco), ['veredito_urgencia urgente motivo=sangramento pelo=whatsapp medico nao chegou'])
})

await caso('a Meta recusa o envio ao paciente: o alerta volta a ficar em aberto e a conversa nao muda', async () => {
  const c = cenario({ metaRecusa: 'Meta recusou' })
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, toque(`URG:${A1}:nao_urgente`))
  assert.equal(c.linha().veredito, null)
  assert.equal(c.conversa().attention_reason, 'sangramento')
  assert.match(c.para(MEDICO).at(-1), /^⚠️ Não consegui enviar/)
  assert.equal(c.banco.linhas('whatsapp_messages').find((m) => m.direction === 'outbound').status, 'failed', 'a falha fica no historico')
})

await caso('paciente que pediu para nao receber: nada sai', async () => {
  const c = cenario({ status: 'opted_out' })
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, toque(`URG:${A1}:urgente`))
  assert.equal(c.para(PACIENTE).length, 0)
  assert.match(c.para(MEDICO).at(-1), /pediu para não receber mensagens/)
})

await caso('o veredito pela tela fecha o alerta: o toque depois no WhatsApp nao manda outro', async () => {
  const c = cenario()
  await R.marcarVereditoDaTela(c.amb.admin, 'conv-1', 'urgente', AGORA)
  assert.equal(c.linha().veredito_por, 'tela')
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, toque(`URG:${A1}:nao_urgente`))
  assert.equal(c.para(PACIENTE).length, 0)
  assert.equal(c.para(MEDICO).at(-1), 'Esse alerta já foi respondido pela tela de Respostas (é urgente). Nada novo foi enviado ao paciente.')
  // Sem a tabela, a tela segue: o veredito ja chegou ao paciente.
  await R.marcarVereditoDaTela(cenario({ semTabela: ['alertas_de_urgencia'] }).amb.admin, 'conv-1', 'urgente', AGORA)
})

await caso('alerta de teste: a resposta funcionou, e nada sai', async () => {
  const c = cenario({ alertas: [alerta({ teste: true, conversation_id: null, quem: 'Teste da Central' })] })
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, toque(`URG:${A1}:urgente`))
  assert.match(c.para(MEDICO).at(-1), /Era um alerta de teste/)
  assert.equal(c.para(PACIENTE).length, 0)
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, texto('testando'))
  assert.match(c.para(MEDICO).at(-1), /Era um alerta de teste/)
})

await caso('a tela de Respostas: o "nao e urgente" leva o botao, e o veredito fecha o alerta do WhatsApp', () => {
  const f = ler('supabase', 'functions', 'whatsapp-reply', 'index.ts')
  assert.match(f, /if \(veredito && botoesDoVeredito\(veredito\)\) toques = \{ botoes: botoesDoVeredito\(veredito\) \}/)
  assert.match(f, /await marcarVereditoDaTela\(admin, visivel\.id, veredito, new Date\(\)\)/)
  assert.ok(f.indexOf('await marcarVereditoDaTela(') > f.indexOf("evento: 'veredito_urgencia',"), 'depois de o veredito chegar ao paciente')
  assert.match(ler('src', 'sections', 'VereditoDaUrgencia.tsx'), /botoesDoVeredito\(veredito\) \? ', com o botão Marcar uma consulta' : ''/)
})

// ---- 25/10/2026: as pecas do primeiro dia de uso do Dr. Marcello ----

const B = '33333333-3333-4333-8333-333333333333'
function doisAvisos(extra = {}) {
  return cenario({
    alertas: [alerta(), alerta({ id: A2, conversation_id: 'conv-2', quem: 'Outro Paciente', mensagens: ['wamid.ALERTA2'], criado_em: haMinutos(5) })],
    ...extra,
  })
}
function comSegundaConversa(c) {
  c.banco.linhas('whatsapp_conversations').push({ id: 'conv-2', clinic_id: FABIO, wa_id: '5513900000008', patient_id: 'p2', status: 'open', needs_attention: true, attention_reason: 'urgencia' })
  c.banco.linhas('whatsapp_messages').push({ conversation_id: 'conv-2', direction: 'inbound', message_type: 'text', created_at: haMinutos(6) })
  return c
}

await caso('dois avisos: o texto pergunta para qual paciente, e o toque no nome ja envia', async () => {
  const c = comSegundaConversa(doisAvisos())
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, texto('Pode fazer compressa fria'))
  const pergunta = c.enviados.at(-1)
  assert.equal(pergunta.para, MEDICO)
  assert.match(c.textoDe(pergunta), /^Para qual paciente vai esta mensagem\?\n\n"Pode fazer compressa fria"/)
  const botoes = pergunta.conteudo.interactive.action.buttons.map((b) => b.reply)
  assert.deepEqual(botoes.map((b) => b.title), ['Outro Paciente', 'Paciente de Teste', 'Cancelar'], 'o aviso mais novo primeiro')
  assert.equal(c.para(PACIENTE).length, 0, 'nada sai antes do toque')
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, toqueInterativo(botoes[0].id))
  assert.deepEqual(c.para('5513900000008'), ['💬 Mensagem do Dr. Fábio: Pode fazer compressa fria'])
  assert.equal(c.para(PACIENTE).length, 0, 'o outro paciente nao recebe')
  assert.equal(c.linha(A1).rascunho, null, 'o texto sai do outro aviso tambem')
  assert.equal(c.linha(A2).rascunho, null)
  // A proxima, sem citar, segue para o mesmo paciente (a conversa ativa).
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, texto('E me avise em 1 hora'))
  assert.match(c.para(MEDICO).at(-1), /^Vou mandar para Outro Paciente, como mensagem do Dr\. Fábio:/)
})

await caso('dois avisos e um novo depois da resposta: pergunta de novo; com tres, a lista', async () => {
  const c = comSegundaConversa(doisAvisos())
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, toque('URG:' + A2 + ':responde'))
  assert.equal(c.linha(A2).respondido_por, MEDICO)
  c.banco.linhas('alertas_de_urgencia').push(alerta({ id: B, conversation_id: 'conv-3', quem: 'Terceiro Paciente', mensagens: ['wamid.ALERTA3'], criado_em: new Date(AGORA.getTime() + 1000).toISOString() }))
  const depois = new Date(AGORA.getTime() + 60000)
  await R.tratarRespostaDaEquipe({ ...c.amb, agora: depois }, MEDICO, texto('Como esta agora?'))
  const lista = c.enviados.at(-1).conteudo.interactive
  assert.equal(lista.type, 'list', 'com tres avisos, a lista')
  assert.deepEqual(lista.action.sections[0].rows.map((r) => r.title), ['Terceiro Paciente', 'Outro Paciente', 'Paciente de Teste', 'Cancelar'])
  // O toque na lista volta em list_reply.
  const linha = lista.action.sections[0].rows[3].id
  assert.equal(R.lerRespostaDaEquipe({ type: 'interactive', interactive: { list_reply: { id: linha, title: 'Cancelar' } } })?.tipo, 'confirmacao')
  await R.tratarRespostaDaEquipe({ ...c.amb, agora: depois }, MEDICO, { type: 'interactive', interactive: { list_reply: { id: linha, title: 'Cancelar' } } })
  assert.equal(c.para(MEDICO).at(-1), 'Cancelado: nada foi enviado ao paciente.')
  assert.ok(c.banco.linhas('alertas_de_urgencia').every((a) => a.rascunho === null), 'cancelar apaga o texto de todos os avisos')
})

await caso('so o nome do paciente escolhe a conversa, e nada vai para ele', async () => {
  const c = comSegundaConversa(doisAvisos())
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, texto('do Outro Paciente'))
  assert.equal(c.para(MEDICO).at(-1), 'Certo: as próximas mensagens vão para Outro Paciente. Escreva o que quer mandar.')
  assert.equal(c.para('5513900000008').length, 0)
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, texto('Pode tomar o remédio'))
  assert.match(c.para(MEDICO).at(-1), /^Vou mandar para Outro Paciente/)
  // Frase com o nome nao e escolha.
  assert.equal(R.pacientePeloNome('Outro, pode tomar agua', [alerta({ quem: 'Outro Paciente' })]), null)
  assert.equal(R.pacientePeloNome('outro paciente', [alerta({ quem: 'Outro Paciente' }), alerta({ id: A2, quem: 'Outro Paciente' })]), null, 'dois com o mesmo nome: nao escolhe')
})

await caso('"Mandar para o celular": o "Eu respondo" volta ao paciente, com nota e evento do pedido', async () => {
  const c = cenario({ alertas: [alerta({ motivo: 'pedido' })] })
  await R.tratarRespostaDaEquipe(c.amb, DAYANE, toque('URG:' + A1 + ':responde'))
  assert.deepEqual(c.para(PACIENTE), ['💙 A nossa equipe viu a sua mensagem e vai falar com você por aqui.'])
  assert.deepEqual(notas(c.banco), ['🩺 A equipe respondeu pelo celular: vai responder (pelo WhatsApp).'])
  assert.deepEqual(eventos(c.banco), ['resposta_ao_pedido responde pelo=whatsapp equipe'], 'fora da conta das urgencias')
  // A tela de Respostas nao fecha pedido.
  await R.marcarVereditoDaTela(c.amb.admin, 'conv-1', 'urgente', AGORA)
  assert.notEqual(c.linha().veredito_por, 'tela')
})

await caso('o paciente responde depois: vai aos dois celulares, e a resposta em cima volta para ele', async () => {
  const c = cenario({ alertas: [alerta({ motivo: 'pedido' })] })
  assert.equal(await R.repassarRespostaDoPaciente(c.amb, { conversationId: 'conv-1', quem: 'Paciente de Teste', texto: 'Obrigada' }), false, 'ninguem respondeu pelo celular ainda: nao repassa')
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, toque('URG:' + A1 + ':responde'))
  const antes = c.enviados.length
  assert.equal(await R.repassarRespostaDoPaciente(c.amb, { conversationId: 'conv-1', quem: 'Paciente de Teste', texto: 'Ainda esta sangrando um pouco' }), true)
  const repasses = c.enviados.slice(antes)
  assert.deepEqual(repasses.map((e) => e.para), [MEDICO, DAYANE], 'aos dois celulares')
  assert.equal(c.textoDe(repasses[0]), '💬 Paciente de Teste respondeu:\n\n"Ainda esta sangrando um pouco"\n\nPara responder, escreva aqui: vai para Paciente de Teste.')
  assert.equal(repasses[0].conteudo.interactive.action.buttons[0].reply.id, 'URG:' + A1 + ':responde')
  const ids = c.linha().mensagens
  assert.ok(ids.includes('wamid.' + (antes + 1)), 'a mensagem repassada entra nos ids do aviso')
  // A resposta em cima do repasse volta para o mesmo paciente.
  await R.tratarRespostaDaEquipe(c.amb, MEDICO, texto('Faça compressão por 10 minutos', 'wamid.' + (antes + 1)))
  assert.match(c.para(MEDICO).at(-1), /^Vou mandar para Paciente de Teste/)
  // Foto vira aviso legivel.
  await R.repassarRespostaDoPaciente(c.amb, { conversationId: 'conv-1', quem: 'Paciente de Teste', texto: '[image]' })
  assert.match(c.para(MEDICO).at(-1), /📷 Mandou uma foto \(veja na Central\)/)
})

await caso('repasse: texto livre recusado vira o modelo; sem a tabela ou alerta de teste, nao repassa', async () => {
  const c = cenario({ alertas: [alerta({ respondido_em: haMinutos(10), respondido_por: MEDICO })] })
  c.amb.enviarWhatsApp = async (para, conteudo) => {
    c.enviados.push({ para, conteudo })
    return conteudo.type === 'template' ? { ok: true, id: 'wamid.m' + c.enviados.length } : { ok: false, erro: '(#131047) Re-engagement message' }
  }
  assert.equal(await R.repassarRespostaDoPaciente(c.amb, { conversationId: 'conv-1', quem: '', texto: 'oi' }), true)
  const modelos = c.enviados.filter((e) => e.conteudo.type === 'template')
  assert.equal(modelos.length, 2)
  assert.equal(modelos[0].conteudo.template.name, 'pedido_equipe')
  assert.deepEqual(modelos[0].conteudo.template.components[0].parameters.map((p) => p.text).slice(2), ['respondeu à sua mensagem', 'oi'])
  assert.equal(modelos[0].conteudo.template.components[1].parameters[0].payload, 'URG:' + A1 + ':responde')
  assert.equal(await R.repassarRespostaDoPaciente(cenario({ semTabela: ['alertas_de_urgencia'] }).amb, { conversationId: 'conv-1', quem: 'x', texto: 'oi' }), false)
  const teste = cenario({ alertas: [alerta({ teste: true, respondido_em: haMinutos(10), respondido_por: MEDICO })] })
  assert.equal(await R.repassarRespostaDoPaciente(teste.amb, { conversationId: 'conv-1', quem: 'x', texto: 'oi' }), false)
  const velho = cenario({ alertas: [alerta({ respondido_em: haMinutos(7 * 60), respondido_por: MEDICO })] })
  assert.equal(await R.repassarRespostaDoPaciente(velho.amb, { conversationId: 'conv-1', quem: 'x', texto: 'oi' }), false, 'depois de 6 horas, nao')
})

await caso('repasse com arquivo (25/10/2026): vai atras do texto livre; quem so recebeu o modelo fica com ele pendente', async () => {
  const c = cenario({ alertas: [alerta({ respondido_em: haMinutos(10), respondido_por: MEDICO })] })
  // O medico esta na janela de 24 horas (acabou de responder); a Dayane nao.
  c.amb.enviarWhatsApp = async (para, conteudo) => {
    c.enviados.push({ para, conteudo })
    if (para === DAYANE && conteudo.type !== 'template') return { ok: false, erro: '(#131047) Re-engagement message' }
    return { ok: true, id: 'wamid.r' + c.enviados.length }
  }
  const foto = { tipo: 'image', link: 'https://acervo/foto', caminho: 'c/wamid.F', recebidoEm: new Date().toISOString() }
  assert.equal(await R.repassarRespostaDoPaciente(c.amb, { conversationId: 'conv-1', quem: 'Paciente de Teste', texto: '[image]', anexo: foto }), true)
  assert.deepEqual(
    c.enviados.map((e) => [e.para, e.conteudo.type]),
    [[MEDICO, 'interactive'], [MEDICO, 'image'], [DAYANE, 'interactive'], [DAYANE, 'template']],
    'para a Dayane, o modelo, e nao o arquivo (seria recusado)',
  )
  assert.equal(c.enviados[1].conteudo.image.caption, '📎 Enviado por Paciente de Teste pela Central de Cuidado')
  const registros = c.banco.linhas('anexos_para_equipe')
  assert.deepEqual(registros.map((r) => [r.numero, r.situacao]), [[MEDICO, 'enviado'], [DAYANE, 'pendente']], 'o da Dayane vai quando ela escrever')
})

await caso('o webhook: o repasse depois de gravar a mensagem do paciente, e a migration das colunas', () => {
  const f = ler('supabase', 'functions', 'meta-webhook', 'index.ts')
  const repasse = f.indexOf('await repassarRespostaDoPaciente(')
  assert.ok(repasse > f.indexOf('if (messageError) throw messageError'), 'a mensagem ja esta gravada')
  assert.ok(repasse > f.indexOf('const tratada = await tratarRespostaDaEquipe('), 'mensagem do medico nao e repassada')
  assert.match(f.slice(repasse, repasse + 700), /conversationId: conversation\.id/)
  const m = ler('supabase', 'migrations', '20261025100600_pedido_no_celular.sql')
  assert.match(m, /add column if not exists respondido_por text/)
  assert.match(m, /alertas_de_urgencia_respondido_idx/)
})

// ---- No simulador: o alerta que o medico receberia, e os botoes ----

function simulacao(familia = 'nova') {
  let agora = Date.parse('2026-10-14T13:00:00Z')
  return new S.Simulacao(IDENTIDADES.fabio, FAMILIAS[familia], { relogio: () => new Date((agora += 30000)) })
}

await caso('simulador: o alerta chega no WhatsApp do medico uma vez, com os tres botoes', async () => {
  const s = simulacao()
  const r = await s.enviarDaFamilia({ texto: 'Meu nariz está sangrando muito e não para' })
  assert.equal(r.noMedico.length, 1)
  assert.match(r.noMedico[0].texto, /^🚨 Alerta de sangramento na Central de Cuidado\.\n\n.+ escreveu às \d\d:\d\d:\n"Meu nariz está sangrando muito e não para"/)
  assert.deepEqual(r.noMedico[0].toques.opcoes.map((o) => o.titulo), ['É urgente', 'Pode aguardar', 'Eu respondo'])
  assert.ok(r.registros.some((g) => g.titulo === '🚨 Alerta de sangramento enviado no WhatsApp para 2 números (final 0001, final 0002).'))
  assert.equal(r.alertas.length, 1, 'a notificacao do navegador continua')
  const de_novo = await s.enviarDaFamilia({ texto: 'continua sangrando' })
  assert.equal(de_novo.noMedico.length, 0, 'na mesma urgencia, nao repete')
  assert.equal(de_novo.alertas.length, 1, 'a notificacao, sim')
})

await caso('simulador: "Pode aguardar" volta ao paciente com o botao, e o toque nele abre o agendamento', async () => {
  const s = simulacao()
  // Sinal de alarme no meio de um agendamento: o robo manda ao pronto-socorro
  // e deixa a etapa de pe ("se ainda quiser marcar para depois"). Sem a etapa
  // da fila no veredito, o toque em Marcar uma consulta ficava sem resposta
  // nenhuma (conferido em 17/10/2026, desligando a correcao).
  await s.enviarDaFamilia({ texto: 'Quero marcar uma consulta' })
  const r = await s.enviarDaFamilia({ texto: 'Engoli uma espinha de peixe e está doendo muito' })
  assert.equal(s.etapa, 'aguardando_unidade', 'a urgencia deixou a etapa do agendamento')
  const aguardar = r.noMedico[0].toques.opcoes.find((o) => o.titulo === 'Pode aguardar')
  const t = await s.responderComoMedico({ toque: aguardar })
  assert.equal(t.paraOPaciente.length, 1)
  assert.equal(t.paraOPaciente[0].texto, V.textoDoVeredito('nao_urgente', FABIO))
  assert.deepEqual(t.paraOPaciente[0].toques.opcoes, [{ id: 'MARCAR_AGORA', titulo: 'Marcar uma consulta' }])
  assert.equal(t.noMedico.at(-1).texto, `✅ Enviado para ${FAMILIAS.nova.nomeDoPerfil}.`)
  assert.equal(s.motivo, 'atendente')
  const etapa = s.etapa
  const marcar = await s.enviarDaFamilia({ texto: 'Marcar uma consulta', idDoToque: 'MARCAR_AGORA' })
  assert.ok(marcar.respostas.length > 0, 'o robo responde ao toque mesmo com a equipe na conversa')
  assert.doesNotMatch(marcar.respostas.map((m) => m.texto).join('\n'), /não entendi/i)
  assert.match(marcar.respostas.map((m) => m.texto).join('\n'), /unidade|Santos/i)
  assert.equal(etapa, 'atendente', 'o veredito deixou a conversa na etapa da fila da equipe')
})

await caso('simulador: o veredito pela tela fecha o alerta; o texto do medico vai depois do Enviar', async () => {
  const s = simulacao()
  const r = await s.enviarDaFamilia({ texto: 'Meu nariz está sangrando muito e não para' })
  const v = await s.darVeredito('urgente')
  assert.match(v.mensagem.texto, /procure o pronto-socorro agora/)
  const urgente = r.noMedico[0].toques.opcoes.find((o) => o.titulo === 'Pode aguardar')
  const t = await s.responderComoMedico({ toque: urgente })
  assert.equal(t.paraOPaciente.length, 0)
  assert.match(t.noMedico.at(-1).texto, /já foi respondido pela tela de Respostas/)

  const outra = simulacao()
  await outra.enviarDaFamilia({ texto: 'Meu nariz está sangrando muito e não para' })
  const rascunho = await outra.responderComoMedico({ texto: 'Pode vir amanhã cedo que eu encaixo' })
  assert.equal(rascunho.paraOPaciente.length, 0)
  const enviar = rascunho.noMedico.at(-1).toques.opcoes.find((o) => o.titulo === 'Enviar')
  const enviado = await outra.responderComoMedico({ toque: enviar })
  assert.deepEqual(enviado.paraOPaciente.map((m) => m.texto), ['💬 Mensagem do Dr. Fábio: Pode vir amanhã cedo que eu encaixo'])
  assert.ok(enviado.registros.some((g) => /O Dr\. Fábio respondeu ao alerta: mandou uma mensagem/.test(g.titulo)))
})

await caso('simulador: o "nao e urgente" da tela tambem leva o botao de marcar', async () => {
  const s = simulacao()
  await s.enviarDaFamilia({ texto: 'Meu nariz está sangrando muito e não para' })
  const v = await s.darVeredito('nao_urgente')
  assert.deepEqual(v.mensagem.toques.opcoes, [{ id: 'MARCAR_AGORA', titulo: 'Marcar uma consulta' }])
})

conferirDesligar()
console.log(`resposta ao alerta: ${ok} casos ok`)
