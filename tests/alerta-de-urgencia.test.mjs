// Alerta de urgencia no WhatsApp pessoal do medico, com botoes (17/10/2026,
// pedido do Edu). Regra em supabase/functions/_shared/alerta-de-urgencia.ts.
// Sem Meta e sem banco de verdade: um envio de mentira e o banco falso do
// simulador. Telefones inventados (o repositorio e publico). No "npm run
// test:bot". Para provar que um caso pega o defeito, ver DESLIGAR em
// tests/montar-para-teste.mjs.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bancoCom, conferirDesligar, lerComTrocas, montar } from './montar-para-teste.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SHARED = join(AQUI, '..', 'supabase', 'functions', '_shared')
const A = await montar(join(SHARED, 'alerta-de-urgencia.ts'), join(AQUI, 'alerta-de-urgencia.build.mjs'))
const { textoDoModelo } = await montar(join(SHARED, 'modelos.ts'), join(AQUI, 'modelos-do-alerta.build.mjs'))
const { BancoFalso } = await montar(join(AQUI, '..', 'src', 'simulador', 'banco-falso.ts'), join(AQUI, 'banco-falso.build.mjs'))
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
const AGORA = new Date('2026-10-18T02:14:00Z')

// O token do WhatsApp vem do ambiente do Deno; aqui, de mentira.
globalThis.Deno = { env: { get: (nome) => (nome === 'WHATSAPP_ACCESS_TOKEN' ? 'token-de-teste' : undefined) } }

await caso('numeros: 55 + DDD + celular, com o nono digito, sem repetir, o medico primeiro', () => {
  const n = A.numerosDoAlerta('(13) 99000-0001\n13990000001, 5513990000001\n123\n(11) 98888-0002')
  assert.deepEqual(n, ['5513990000001', '5511988880002'])
  assert.deepEqual(A.numerosDoAlerta(['5513990000001']), ['5513990000001'])
  assert.deepEqual(A.numerosDoAlerta(null), [])
  assert.deepEqual(A.numerosDoAlerta(''), [])
  // Celular antigo sem o 9: a Meta so entrega com ele.
  assert.deepEqual(A.numerosDoAlerta('13 9000-0001'), ['5513990000001'])
  assert.deepEqual(A.numerosDoAlerta(`${DAYANE}\n${MEDICO}`), [DAYANE, MEDICO], 'a ordem e a da tela: o primeiro e o medico')
})

await caso('so quando a conversa ENTRA em urgencia ou sangramento', () => {
  const alerta = (atencaoAntes, motivoAntes, motivoAgora) => A.deveAlertar({ atencaoAntes, motivoAntes, motivoAgora })
  assert.equal(alerta(false, null, 'urgencia'), true)
  assert.equal(alerta(false, null, 'sangramento'), true, 'o alerta pedido pelo Dr. Fabio')
  assert.equal(alerta(true, 'atendente', 'urgencia'), true, 'da fila da equipe para a urgencia')
  assert.equal(alerta(true, 'urgencia', 'urgencia'), false, 'o paciente escrevendo de novo na mesma urgencia nao repete')
  assert.equal(alerta(true, 'sangramento', 'sangramento'), false)
  assert.equal(alerta(true, 'sangramento', 'urgencia'), false, 'sangramento que vira urgencia e a mesma ocorrencia')
  assert.equal(alerta(false, 'urgencia', 'urgencia'), true, 'urgencia resolvida e nova urgencia alerta de novo')
  assert.equal(alerta(false, null, 'atendente'), false)
  assert.equal(alerta(true, 'urgencia', null), false)
})

await caso('parametros que a Meta aceita: sem quebra de linha, sem CPF, e-mail e telefone, com limite', () => {
  const p = A.parametrosDoAlerta({
    motivo: 'sangramento',
    quem: 'Paciente de Teste',
    texto:
      'Meu nariz está sangrando muito\n\nmeu CPF 123.456.789-09, e-mail teste@exemplo.com, liga no (13) 99000-0003    por favor ' +
      'x'.repeat(400),
    agora: AGORA,
  })
  assert.equal(p.length, 4)
  assert.equal(p[0], 'sangramento')
  assert.equal(p[2], '23:14', 'hora de Brasilia')
  for (const x of p) assert.doesNotMatch(x, /[\n\t]| {4,}/)
  assert.doesNotMatch(p[3], /123\.456\.789-09|teste@exemplo\.com|99000-0003/)
  assert.match(p[3], /\[cpf\].*\[e-mail\].*\[telefone\]/)
  assert.ok(p[3].length <= 300 && p[3].endsWith('…'))
  assert.equal(A.parametrosDoAlerta({ motivo: 'urgencia', quem: '', texto: '', agora: AGORA })[1], '-', 'vazio vira traco: a Meta recusa parametro vazio')
  assert.equal(A.parametrosDoAlerta({ motivo: 'urgencia', quem: 'x', texto: 'y', agora: AGORA })[0], 'urgência')
  // Datas e horarios nao sao telefone.
  assert.equal(A.semDadosPessoais('desde 12/10/2026 as 14:30, 3 dias'), 'desde 12/10/2026 as 14:30, 3 dias')
})

await caso('quem: o paciente, o perfil ou o final do numero, nunca o numero inteiro', () => {
  assert.equal(A.quemNoAlerta({ pacientes: [{ name: 'Paciente de Teste' }], nomeDoPerfil: 'Perfil', telefone: '5513990000009' }), 'Paciente de Teste')
  assert.equal(A.quemNoAlerta({ pacientes: [{ name: 'A' }, { name: 'B' }], nomeDoPerfil: 'Perfil', telefone: '5513990000009' }), 'Perfil')
  assert.equal(A.quemNoAlerta({ pacientes: [], nomeDoPerfil: '', telefone: '5513990000009' }), 'Paciente sem cadastro (final 0009)')
})

await caso('os dois modelos: o texto que vai para a Meta, sem travessao, dentro do limite', () => {
  const p = A.parametrosDoAlerta({ motivo: 'urgencia', quem: 'Paciente de Teste', texto: 'Engoli uma espinha de peixe', agora: AGORA })
  const sem = textoDoModelo(A.MODELO_DO_ALERTA, p)
  const com = textoDoModelo(A.MODELO_COM_BOTOES, p)
  assert.equal(sem, '🚨 Alerta de urgência na Central de Cuidado.\n\nPaciente de Teste escreveu às 23:14:\n"Engoli uma espinha de peixe"\n\nO robô já respondeu ao paciente. Veja a conversa na Central de Cuidado para avaliar e responder.')
  assert.match(com, /Toque num botão ou responda a esta mensagem com a orientação, que eu repasso ao paciente\.\n\n\[É urgente · Pode aguardar · Eu respondo\]$/)
  for (const t of [sem, com]) {
    assert.doesNotMatch(t, /[\u2013\u2014]/)
    assert.ok(t.length <= 1024)
    assert.doesNotMatch(t, /\{\{\d\}\}/, 'os quatro parametros preenchidos')
  }
  assert.deepEqual(A.BOTOES_DO_ALERTA.map((b) => b.titulo), ['É urgente', 'Pode aguardar', 'Eu respondo'])
  for (const b of A.BOTOES_DO_ALERTA) assert.ok(b.titulo.length <= 20, 'a Meta limita o botao a 20 caracteres')
  assert.equal(A.VALIDADE_DO_ALERTA_S, 43200, 'validade de 12 horas')
  // O LEIA-ME (fora do repositorio) lista o texto que o Edu cadastra na Meta.
  const leiaMe = join(AQUI, '..', '..', 'LEIA-ME - Projeto Dr Fabio Dario.md')
  if (existsSync(leiaMe)) {
    const texto = readFileSync(leiaMe, 'utf8').replace(/\r\n/g, '\n')
    for (const linha of [
      '🚨 Alerta de {{1}} na Central de Cuidado.',
      '{{2}} escreveu às {{3}}:',
      'O robô já respondeu ao paciente. Veja a conversa na Central de Cuidado para avaliar e responder.',
      'O robô já respondeu ao paciente. Toque num botão ou responda a esta mensagem com a orientação, que eu repasso ao paciente.',
    ]) {
      assert.ok(texto.includes(linha), `o LEIA-ME tem o texto do modelo: ${linha}`)
    }
  }
})

await caso('o registro: nota que grita na falha, detalhe que cabe na coluna', () => {
  const certo = A.descreverEnvio([{ numero: MEDICO, ok: true }, { numero: DAYANE, ok: true }], FABIO, 'sangramento')
  assert.equal(certo.falhou, false)
  assert.equal(certo.detalhe, 'enviado 2/2')
  assert.equal(certo.nota, '🚨 Alerta de sangramento enviado no WhatsApp para 2 números (final 0001, final 0002).')
  const semModelo = A.descreverEnvio(
    [{ numero: MEDICO, ok: false, erro: '(#132001) Template name does not exist in the translation' }, { numero: DAYANE, ok: true }],
    FABIO,
  )
  assert.equal(semModelo.falhou, true)
  assert.match(semModelo.nota, /^⚠️ O alerta de urgência no WhatsApp NÃO chegou a final 0001: o modelo alerta_urgencia ainda não foi aprovado na Meta\. Avise o Dr\. Fábio por telefone\. Chegou a final 0002\.$/)
  assert.ok(semModelo.detalhe.length <= 120)
  const nenhum = A.descreverEnvio([], FABIO)
  assert.equal(nenhum.falhou, true)
  assert.match(nenhum.nota, /nenhum número cadastrado em Preferências\. Avise o Dr\. Fábio por telefone/)
})

// ---- O envio de ponta a ponta, com a Meta e o banco de mentira ----

function cenario({ numeros = [MEDICO, DAYANE], phoneId = '123', semTabela = [], semColuna = [] } = {}) {
  const banco = new BancoFalso(
    {
      clinic_settings: [{ clinic_id: FABIO, whatsapp_phone_number_id: phoneId, whatsapp_template_language: 'pt_BR', alerta_urgencia_telefones: numeros }],
      whatsapp_conversations: [{ id: 'conv-1', clinic_id: FABIO, wa_id: '5513990000009' }],
    },
    {},
  )
  return { banco, admin: bancoCom(banco, { semTabela, semColuna }) }
}
const pedido = { clinicId: FABIO, motivo: 'sangramento', quem: 'Paciente de Teste', texto: 'meu nariz está sangrando muito', agora: AGORA, conversationId: 'conv-1' }

/** A Meta de mentira, pela fetch: guarda o que foi pedido e responde como mandarem. */
function meta(responder = () => ({ ok: true, status: 200, corpo: { messages: [{ id: 'wamid.x' }] } })) {
  const pedidos = []
  const buscar = async (url, init) => {
    const corpo = JSON.parse(init.body)
    pedidos.push({ url, corpo, token: init.headers.Authorization })
    const r = responder(corpo, pedidos.length)
    return { ok: r.ok, status: r.status, json: async () => r.corpo }
  }
  return { pedidos, buscar }
}
const notas = (banco) => banco.linhas('conversation_notes').map((n) => n.texto)
const eventos = (banco) => banco.linhas('whatsapp_bot_events')

await caso('com a tabela: alerta registrado antes, modelo com botoes, payload com o id, ids da Meta guardados, nota e evento', async () => {
  const { banco, admin } = cenario()
  const m = meta((corpo, n) => ({ ok: true, status: 200, corpo: { messages: [{ id: `wamid.${n}` }] } }))
  const r = await A.enviarAlertaDeUrgencia(admin, pedido, A.whatsAppPelaApi('123', 'token-de-teste', m.buscar))
  assert.equal(r.falhou, false)
  assert.equal(m.pedidos.length, 2, 'um por numero')
  assert.deepEqual(m.pedidos.map((p) => p.corpo.to), [MEDICO, DAYANE])
  assert.match(m.pedidos[0].url, /\/123\/messages$/, 'pelo numero do robo')
  const alerta = banco.linhas('alertas_de_urgencia')[0]
  assert.equal(alerta.quem, 'Paciente de Teste')
  assert.equal(alerta.conversation_id, 'conv-1')
  assert.equal(alerta.teste, false)
  assert.equal(alerta.motivo, 'sangramento')
  assert.match(alerta.id, /^[0-9a-f-]{36}$/)
  const t = m.pedidos[0].corpo.template
  assert.equal(t.name, 'alerta_urgencia_botoes')
  assert.equal(t.language.code, 'pt_BR')
  const botoes = t.components.filter((c) => c.type === 'button')
  assert.deepEqual(
    botoes.map((b) => [b.sub_type, b.index, b.parameters[0].payload]),
    [
      ['quick_reply', '0', `URG:${alerta.id}:urgente`],
      ['quick_reply', '1', `URG:${alerta.id}:nao_urgente`],
      ['quick_reply', '2', `URG:${alerta.id}:responde`],
    ],
  )
  assert.equal(t.components[0].parameters[0].text, 'sangramento')
  assert.deepEqual(alerta.mensagens, ['wamid.1', 'wamid.2'], 'e assim que a resposta "em cima" do alerta e reconhecida')
  assert.deepEqual(notas(banco), ['🚨 Alerta de sangramento enviado no WhatsApp para 2 números (final 0001, final 0002).'])
  assert.deepEqual(eventos(banco).map((e) => [e.evento, e.detalhe, e.conversation_id]), [['alerta_urgencia', 'enviado 2/2', 'conv-1']])
})

await caso('modelo com botoes ainda em analise: cai no sem botoes, e o resto ja vai direto', async () => {
  const { admin } = cenario()
  const m = meta((corpo) =>
    corpo.template.name === 'alerta_urgencia_botoes'
      ? { ok: false, status: 404, corpo: { error: { code: 132001, message: 'Template name does not exist in the translation' } } }
      : { ok: true, status: 200, corpo: { messages: [{ id: 'wamid.x' }] } },
  )
  const r = await A.enviarAlertaDeUrgencia(admin, pedido, A.whatsAppPelaApi('123', 'token-de-teste', m.buscar))
  assert.deepEqual(m.pedidos.map((p) => p.corpo.template.name), ['alerta_urgencia_botoes', 'alerta_urgencia', 'alerta_urgencia'])
  assert.ok(r.envios.every((e) => e.ok))
  assert.equal(m.pedidos[1].corpo.template.components.length, 1, 'sem botoes, so o corpo')
})

await caso('sem a tabela dos alertas (migration nao chegou): sai sem botoes, e a nota fica', async () => {
  const { banco, admin } = cenario({ semTabela: ['alertas_de_urgencia'] })
  const m = meta()
  const r = await A.enviarAlertaDeUrgencia(admin, pedido, A.whatsAppPelaApi('123', 'token-de-teste', m.buscar))
  assert.equal(r.alertaId, null)
  assert.deepEqual(m.pedidos.map((p) => p.corpo.template.name), ['alerta_urgencia', 'alerta_urgencia'])
  assert.equal(notas(banco).length, 1)
})

await caso('a Meta recusa: nao lanca, a nota manda ligar e o evento diz que falhou', async () => {
  const { banco, admin } = cenario()
  const m = meta(() => ({ ok: false, status: 400, corpo: { error: { code: 131030, message: 'Recipient phone number not in allowed list' } } }))
  const r = await A.enviarAlertaDeUrgencia(admin, pedido, A.whatsAppPelaApi('123', 'token-de-teste', m.buscar))
  assert.equal(r.falhou, true)
  assert.match(notas(banco)[0], /^⚠️ O alerta de sangramento no WhatsApp NÃO chegou a final 0001, final 0002: \(#131030\) Recipient phone number not in allowed list\. Avise o Dr\. Fábio por telefone\.$/)
  assert.match(eventos(banco)[0].detalhe, /^falhou 2\/2/)
})

await caso('rede fora: nao lanca e registra', async () => {
  const { banco, admin } = cenario({ numeros: [MEDICO] })
  const r = await A.enviarAlertaDeUrgencia(admin, pedido, async () => {
    throw new Error('rede fora')
  })
  assert.equal(r.envios.length, 1)
  assert.equal(r.envios[0].ok, false)
  assert.match(notas(banco)[0], /NÃO chegou a final 0001: Error: rede fora/)
})

await caso('sem numero salvo: nao chama a Meta, e a conversa fica com o aviso', async () => {
  let chamou = false
  const { banco, admin } = cenario({ numeros: [] })
  const r = await A.enviarAlertaDeUrgencia(admin, pedido, async () => {
    chamou = true
    return { ok: true, id: null }
  })
  assert.equal(chamou, false)
  assert.equal(r.envios.length, 0)
  assert.match(notas(banco)[0], /^⚠️ O alerta de sangramento no WhatsApp NÃO saiu: nenhum número cadastrado em Preferências/)
  assert.equal(eventos(banco)[0].detalhe, 'sem numero cadastrado')
})

await caso('banco sem a coluna dos numeros: nao chama a Meta, nao derruba, e grita', async () => {
  let chamou = false
  const { banco, admin } = cenario({ semColuna: ['alerta_urgencia_telefones'] })
  const r = await A.enviarAlertaDeUrgencia(admin, pedido, async () => {
    chamou = true
    return { ok: true, id: null }
  })
  assert.equal(chamou, false)
  assert.equal(r.falhou, true)
  assert.match(notas(banco)[0], /não consegui ler os números do alerta/)
})

await caso('o WhatsApp da clinica sem numero no servidor: falha com o motivo, e nao em silencio', async () => {
  const { banco, admin } = cenario({ numeros: [MEDICO], phoneId: null })
  const r = await A.enviarAlertaDeUrgencia(admin, pedido)
  assert.equal(r.envios[0].ok, false)
  assert.match(notas(banco)[0], /WhatsApp da clínica sem número no servidor/)
})

await caso('alerta de teste da tela: marcado como teste, sem conversa e sem nota', async () => {
  const { banco, admin } = cenario()
  const m = meta()
  await A.enviarAlertaDeUrgencia(admin, { ...pedido, conversationId: undefined, numeros: [MEDICO] }, A.whatsAppPelaApi('123', 'x', m.buscar))
  assert.equal(banco.linhas('alertas_de_urgencia')[0].teste, true)
  assert.equal(banco.linhas('alertas_de_urgencia')[0].conversation_id, null)
  assert.equal(notas(banco).length, 0)
  assert.deepEqual(m.pedidos.map((p) => p.corpo.to), [MEDICO])
})

await caso('o envio de verdade: token da clinica e o codigo do erro da Meta', async () => {
  const m = meta(() => ({ ok: false, status: 400, corpo: { error: { code: 132001, message: 'x' } } }))
  const r = await A.whatsAppPelaApi('999', 'token-de-teste', m.buscar)(MEDICO, { type: 'text', text: { body: 'oi' } })
  assert.deepEqual(r, { ok: false, erro: '(#132001) x', codigo: 132001 })
  assert.equal(m.pedidos[0].token, 'Bearer token-de-teste')
  assert.equal(m.pedidos[0].corpo.messaging_product, 'whatsapp')
  const semToken = await A.whatsAppPelaApi('999', undefined, m.buscar)(MEDICO, {})
  assert.equal(semToken.ok, false)
})

// ---- "Mandar para o celular" (25/10/2026, vindo do sistema do Dr. Marcello) ----

const daCentral = { clinicId: FABIO, motivo: 'pedido', assunto: 'enviado pela Central', quem: 'Paciente de Teste', texto: 'Queria saber se posso viajar de avião', agora: AGORA, conversationId: 'conv-1' }

await caso('pedido: o texto do modelo, sem travessao, com o assunto, e o LEIA-ME igual', () => {
  const p = A.parametrosDoPedido(daCentral)
  assert.deepEqual(p, ['Paciente de Teste', '23:14', 'enviado pela Central', 'Queria saber se posso viajar de avião'])
  const t = textoDoModelo(A.MODELO_DO_PEDIDO, p)
  assert.equal(
    t,
    '📋 Pedido para a equipe na Central de Cuidado.\n\nPaciente de Teste escreveu às 23:14.\nAssunto: enviado pela Central\n"Queria saber se posso viajar de avião"\n\n' +
      'Para responder ao paciente, responda a esta mensagem com o texto, que eu repasso. Ou toque em Eu respondo.\n\n[Eu respondo]',
  )
  assert.doesNotMatch(t, new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]|crian[cç]a|fam[ií]lia`, 'i'))
  assert.ok(t.length <= 1024)
  const leiaMe = join(AQUI, '..', '..', 'LEIA-ME - Projeto Dr Fabio Dario.md')
  if (existsSync(leiaMe)) {
    const texto = readFileSync(leiaMe, 'utf8').replace(/\r\n/g, '\n')
    for (const linha of ['📋 Pedido para a equipe na Central de Cuidado.', '{{1}} escreveu às {{2}}.', 'Assunto: {{3}}', 'Para responder ao paciente, responda a esta mensagem com o texto, que eu repasso. Ou toque em Eu respondo.']) {
      assert.ok(texto.includes(linha), `o LEIA-ME tem o texto do pedido: ${linha}`)
    }
  }
})

await caso('pedido: o modelo pedido_equipe com o "Eu respondo" do aviso, registrado como pedido, nota que diz que foi', async () => {
  const { banco, admin } = cenario()
  const m = meta((corpo, n) => ({ ok: true, status: 200, corpo: { messages: [{ id: `wamid.${n}` }] } }))
  const r = await A.enviarAlertaDeUrgencia(admin, daCentral, A.whatsAppPelaApi('123', 'token-de-teste', m.buscar))
  assert.equal(r.falhou, false)
  const aviso = banco.linhas('alertas_de_urgencia')[0]
  assert.equal(aviso.motivo, 'pedido')
  const t = m.pedidos[0].corpo.template
  assert.equal(t.name, 'pedido_equipe')
  assert.deepEqual(t.components.filter((c) => c.type === 'button').map((b) => b.parameters[0].payload), [`URG:${aviso.id}:responde`])
  assert.deepEqual(m.pedidos.map((p) => p.corpo.to), [MEDICO, DAYANE], 'aos dois celulares')
  assert.deepEqual(aviso.mensagens, ['wamid.1', 'wamid.2'])
  // A nota em branco fazia o botao parecer que nao tinha feito nada.
  assert.deepEqual(notas(banco), ['📲 Conversa enviada para o WhatsApp de 2 números (final 0001, final 0002). A resposta de lá volta para o paciente.'])
  assert.deepEqual(eventos(banco).map((e) => [e.evento, e.detalhe]), [['pedido_equipe', 'enviado 2/2']], 'evento proprio, fora da conta das urgencias')
})

await caso('pedido sem o modelo aprovado: vai como texto com o botao, e quem nao escreveu nas 24 horas fica sabendo', async () => {
  const { banco, admin } = cenario()
  const m = meta((corpo) =>
    corpo.type === 'template'
      ? { ok: false, status: 404, corpo: { error: { code: 132001, message: 'Template name does not exist in the translation' } } }
      : corpo.to === DAYANE
        ? { ok: false, status: 400, corpo: { error: { code: 131047, message: 'Re-engagement message' } } }
        : { ok: true, status: 200, corpo: { messages: [{ id: 'wamid.t' }] } },
  )
  const r = await A.enviarAlertaDeUrgencia(admin, daCentral, A.whatsAppPelaApi('123', 'token-de-teste', m.buscar))
  assert.deepEqual(m.pedidos.map((p) => p.corpo.type), ['template', 'interactive', 'interactive'], 'o modelo uma vez so; depois, texto')
  const texto = m.pedidos[1].corpo.interactive
  assert.match(texto.body.text, /^📋 Pedido para a equipe na Central de Cuidado\./)
  assert.doesNotMatch(texto.body.text, /\[Eu respondo\]/, 'o botao vai de verdade, nao como texto')
  assert.equal(texto.action.buttons[0].reply.id, `URG:${r.alertaId}:responde`)
  assert.equal(r.falhou, true)
  assert.match(notas(banco)[0], /^⚠️ A conversa NÃO chegou ao celular final 0002: o modelo pedido_equipe ainda não foi aprovado na Meta, e esse celular não escreveu para o número da clínica nas últimas 24 horas\. Responda o paciente por aqui\. Chegou a final 0001\.$/)
})

await caso('pedido sem numero salvo: nao chama a Meta, e a nota manda responder pela Central (sem telefonema)', async () => {
  let chamou = false
  const { banco, admin } = cenario({ numeros: [] })
  const r = await A.enviarAlertaDeUrgencia(admin, daCentral, async () => {
    chamou = true
    return { ok: true, id: null }
  })
  assert.equal(chamou, false)
  assert.equal(r.falhou, true)
  assert.match(notas(banco)[0], /^⚠️ A conversa NÃO foi para o celular: nenhum número cadastrado em Preferências/)
  assert.doesNotMatch(notas(banco)[0], /por telefone/)
})

await caso('o botao da Central: qualquer pessoa com acesso a conversa, pela sessao dela, como pedido', () => {
  const f = ler('supabase', 'functions', 'notificar-equipe', 'index.ts')
  const bloco = f.slice(f.indexOf("if (corpo.acao === 'encaminhar')"), f.indexOf("return json({ error: 'Ação desconhecida.' }, 400)"))
  assert.match(bloco, /await userClient\(autorizacao\)\s*\.from\('whatsapp_conversations'\)/, 'a RLS decide quem ve a conversa')
  assert.match(bloco, /if \(erroDaConversa \|\| !conversa\) return json\(\{ error: 'Sem acesso a esta conversa\.' \}, 403\)/)
  assert.match(bloco, /motivo: 'pedido'/)
  assert.match(bloco, /conversationId: conversa\.id/)
  const tela = ler('src', 'sections', 'Conversations.tsx')
  assert.match(tela, /await mandarParaOCelular\(clinicId, conversa\)/)
  assert.match(tela, /\{doCelular && \(/, 'a nota do resultado aparece embaixo do botao')
  const m = ler('supabase', 'migrations', '20261025100600_pedido_no_celular.sql')
  assert.match(m, /check \(motivo in \('urgencia', 'sangramento', 'pedido'\)\)/)
  assert.match(m, /add column if not exists respondido_em timestamptz/)
})

// ---- Onde as pecas entram ----

await caso('o webhook: a resposta do medico antes do robo do paciente, e o alerta junto da notificacao', () => {
  const f = ler('supabase', 'functions', 'meta-webhook', 'index.ts')
  const resposta = f.indexOf('const tratada = await tratarRespostaDaEquipe(')
  assert.ok(resposta > 0)
  assert.ok(resposta < f.indexOf('const grafias = variantesDoTelefone(waId)'), 'antes de qualquer coisa do paciente')
  assert.ok(resposta > f.indexOf("if ((await registro.registrar(`message:${externalId}`"), 'depois da trava do reenvio da Meta')
  assert.match(f.slice(resposta, resposta + 600), /if \(tratada\) continue/)
  const aviso = f.indexOf('const envio = avisarEquipe(admin, clinicId, aviso)')
  const alerta = f.indexOf('const alerta = enviarAlertaDeUrgencia(admin, {')
  assert.ok(aviso > 0 && alerta > aviso, 'a notificacao do navegador continua, e o alerta vem depois dela')
  assert.match(f.slice(alerta - 400, alerta), /if \(deveAlertar\(\{ atencaoAntes: Boolean\(conversaAnterior\?\.needs_attention\), motivoAntes, motivoAgora \}\)\) \{/)
  assert.match(f.slice(alerta, alerta + 700), /EdgeRuntime\.waitUntil\(alerta\)/, 'fora do caminho da resposta ao paciente')
})

await caso('o teste da tela: so quem atende, e pelo mesmo envio', () => {
  const f = ler('supabase', 'functions', 'notificar-equipe', 'index.ts')
  const bloco = f.slice(f.indexOf("if (corpo.acao === 'alerta_teste')"), f.indexOf("if (corpo.acao === 'encaminhar')"))
  assert.match(bloco, /clinicaDeQuemAtende\(userClient\(autorizacao\), corpo\.clinicId\)/)
  assert.match(bloco, /enviarAlertaDeUrgencia\(admin, \{/)
  assert.doesNotMatch(bloco, /conversationId/, 'o teste nao tem paciente do outro lado')
})

await caso('a migration: coluna, tabela, RLS forcada e so o servidor escreve', () => {
  const m = ler('supabase', 'migrations', '20261017200000_alerta_de_urgencia_no_whatsapp.sql')
  assert.match(m, /add column if not exists alerta_urgencia_telefones text\[\] not null default '\{\}'::text\[\]/)
  assert.match(m, /grant update \(alerta_urgencia_telefones\) on table public\.clinic_settings to authenticated/)
  assert.match(m, /create table if not exists public\.alertas_de_urgencia/)
  assert.match(m, /veredito in \('urgente', 'nao_urgente', 'responde', 'texto'\)/)
  assert.match(m, /alter table public\.alertas_de_urgencia force row level security/)
  assert.match(m, /revoke all on table public\.alertas_de_urgencia from public, anon, authenticated/)
  assert.match(m, /grant select on table public\.alertas_de_urgencia to authenticated/)
  assert.doesNotMatch(m, /supabase\.co|marcello/i, 'nada de URL de projeto nem do sistema do Dr. Marcello')
})

conferirDesligar()
console.log(`alerta de urgencia: ${ok} casos ok`)
