// Coexistencia (27/10/2026): o numero do consultorio no app WhatsApp Business
// e na API ao mesmo tempo. Ver supabase/functions/_shared/coexistencia.ts. Os
// avisos seguem o formato da documentacao da Meta ("Onboarding WhatsApp
// Business app users"), com telefones inventados (o repositorio e publico).
// Sem Meta e sem banco de verdade. Para provar que um caso pega o defeito,
// ver DESLIGAR em tests/montar-para-teste.mjs.
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bancoCom, conferirDesligar, lerComTrocas, montar } from './montar-para-teste.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SHARED = join(AQUI, '..', 'supabase', 'functions', '_shared')
const C = await montar(join(SHARED, 'coexistencia.ts'), join(AQUI, 'coexistencia.build.mjs'))
const { BancoFalso } = await montar(join(AQUI, '..', 'src', 'simulador', 'banco-falso.ts'), join(AQUI, 'banco-falso.build.mjs'))

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

const CLINICA = 'b5d0f6a2-3c71-4e8a-9f2d-7a1c4e9b0d63'
const NUMERO_ID = '700000000000001'
const CONSULTORIO = '551333330000'
// Celular com o nono digito; o WhatsApp antigo manda sem ele.
const ANA = '5513991110001'
const ANA_SEM_NOVE = '551391110001'
const BETO = '5513991110002'

const ferramentas = () => {
  const baixados = []
  return {
    baixados,
    corpo: (m) => (m.type === 'text' ? m.text?.body ?? '' : m[m.type]?.caption || `[${m.type}]`),
    midia: (m) => m.image ?? m.audio ?? m.document ?? null,
    guardarAnexo: async (clinica, id, midia) => {
      baixados.push(id)
      return { path: `${clinica}/${id}`, mime: midia.mime_type ?? 'application/octet-stream' }
    },
  }
}

function banco(tabelas = {}, opcoes = {}) {
  const b = new BancoFalso(
    {
      clinic_settings: [{ clinic_id: CLINICA, whatsapp_phone_number_id: NUMERO_ID }],
      whatsapp_conversations: [],
      whatsapp_messages: [],
      whatsapp_contatos_do_celular: [],
      patients: [],
      ...tabelas,
    },
    {},
  )
  const admin = bancoCom(b, opcoes)
  // O Postgres sem a coluna nova: o insert com "origem" volta com erro.
  if (opcoes.semOrigem) {
    const from = admin.from.bind(admin)
    admin.from = (tabela) => {
      const pedido = from(tabela)
      if (tabela !== 'whatsapp_messages') return pedido
      const insert = pedido.insert.bind(pedido)
      pedido.insert = (valores) => {
        const linhas = Array.isArray(valores) ? valores : [valores]
        if (linhas.some((l) => 'origem' in l)) {
          const r = { data: null, error: { code: 'PGRST204', message: "Could not find the 'origem' column of 'whatsapp_messages'" } }
          return { then: (okk, ko) => Promise.resolve(r).then(okk, ko) }
        }
        return insert(valores)
      }
      return pedido
    }
  }
  return { b, admin }
}

const valor = (extra) => ({
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: CONSULTORIO, phone_number_id: NUMERO_ID },
  ...extra,
})
const texto = (from, id, timestamp, body, status = 'READ') => ({
  from,
  id,
  timestamp: String(timestamp),
  type: 'text',
  text: { body },
  history_context: { status },
})
// 20/10/2026 13:00 em Sao Paulo = 16:00 UTC.
const T0 = Date.UTC(2026, 9, 20, 16, 0, 0) / 1000
const historico = (threads, metadata = { phase: 1, chunk_order: 1, progress: 55 }) =>
  valor({ history: [{ metadata, threads }] })

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

await caso('131060 e mensagem que so o celular mostra; outro unsupported nao', async () => {
  assert.equal(C.soNoCelular({ type: 'unsupported', errors: [{ code: 131060, title: 'Unsupported message type' }] }), true)
  assert.equal(C.soNoCelular({ type: 'unsupported', errors: [{ code: 131051 }] }), false)
  assert.equal(C.soNoCelular({ type: 'unsupported' }), false, 'ligacao pelo WhatsApp segue o caminho de antes')
  assert.equal(C.soNoCelular({ type: 'text', errors: [{ code: 131060 }] }), false)
  assert.equal(C.soNoCelular(null), false)
})

await caso('os tres campos da coexistencia; messages segue no webhook', async () => {
  for (const campo of ['history', 'smb_message_echoes', 'smb_app_state_sync']) assert.equal(C.campoDoCelular(campo), true, campo)
  for (const campo of ['messages', 'account_update', undefined]) assert.equal(C.campoDoCelular(campo), false, String(campo))
})

await caso('status do historico no status do banco', async () => {
  assert.equal(C.statusDoHistorico('READ'), 'read')
  assert.equal(C.statusDoHistorico('PLAYED'), 'read')
  assert.equal(C.statusDoHistorico('DELIVERED'), 'delivered')
  assert.equal(C.statusDoHistorico('SENT'), 'sent')
  assert.equal(C.statusDoHistorico('PENDING'), 'queued')
  assert.equal(C.statusDoHistorico('ERROR'), 'failed')
  assert.equal(C.statusDoHistorico(undefined), 'sent')
})

await caso('historico: quem escreveu, quando, e o arquivo que ficou no celular', async () => {
  const f = ferramentas()
  const leitura = C.lerHistorico(
    historico([
      {
        id: ANA,
        messages: [
          texto(CONSULTORIO, 'wamid.H1', T0, 'Bom dia, segue o endereço.'),
          { from: CONSULTORIO, id: 'wamid.H2', timestamp: String(T0 + 15), type: 'media_placeholder', history_context: { status: 'PLAYED' } },
          // A Ana no WhatsApp antigo, sem o nono digito.
          texto(ANA_SEM_NOVE, 'wamid.H3', T0 + 60, 'Obrigada!'),
        ],
      },
    ]),
    f,
  )
  assert.equal(leitura.recusado, false)
  assert.deepEqual(leitura.partes, [{ fase: 1, parte: 1, progresso: 55 }])
  assert.equal(leitura.conversas.length, 1)
  const [h1, h2, h3] = leitura.conversas[0].mensagens
  assert.equal(leitura.conversas[0].contato, ANA)
  assert.equal(h1.direction, 'outbound')
  assert.equal(h1.status, 'read')
  assert.equal(h1.read_at, '2026-10-20T16:00:00.000Z')
  assert.equal(h1.created_at, '2026-10-20T16:00:00.000Z')
  assert.equal(h1.automatic, false, 'resposta da equipe: segura o robo 12 horas, como pela Central')
  assert.equal(h1.origem, 'historico')
  assert.equal(h2.message_type, 'media_placeholder')
  assert.equal(h2.body, C.TEXTO_ARQUIVO_DO_HISTORICO)
  assert.equal(h2.midia, null)
  assert.equal(h3.direction, 'inbound', 'sem o nono digito ainda e a Ana')
  assert.equal(h3.status, 'delivered')
  assert.equal(h3.body, 'Obrigada!')
})

await caso('historico recusado no app (2593109): nada a gravar, e diz', async () => {
  const leitura = C.lerHistorico(
    valor({ history: [{ errors: [{ code: 2593109, title: 'History sync is turned off by the business from the WhatsApp Business App' }] }] }),
    ferramentas(),
  )
  assert.equal(leitura.recusado, true)
  assert.equal(leitura.conversas.length, 0)
})

await caso('mensagem sem id ou sem data nao entra', async () => {
  const leitura = C.lerHistorico(
    historico([{ id: ANA, messages: [{ from: ANA, type: 'text', text: { body: 'x' }, timestamp: String(T0) }, { from: ANA, id: 'wamid.X', type: 'text', text: { body: 'y' } }] }]),
    ferramentas(),
  )
  assert.equal(leitura.conversas.length, 0)
})

await caso('contatos da agenda: salvo, e apagado sem nome', async () => {
  const lidos = C.lerContatos(
    valor({
      state_sync: [
        { type: 'contact', contact: { full_name: 'Ana Teste Agenda', first_name: 'Ana', phone_number: ANA }, action: 'add', metadata: { timestamp: String(T0) } },
        { type: 'contact', contact: { phone_number: BETO }, action: 'remove', metadata: { timestamp: String(T0) } },
      ],
    }),
  )
  assert.deepEqual(lidos[0], { contato: ANA, nome: 'Ana Teste Agenda', removido: false, em: '2026-10-20T16:00:00.000Z' })
  assert.equal(lidos[1].removido, true)
  assert.equal(lidos[1].nome, null)
})

// ---------------------------------------------------------------------------
// Gravacao
// ---------------------------------------------------------------------------

await caso('historico grava a conversa ligada ao paciente, sem acender nada', async () => {
  const f = ferramentas()
  const { b, admin } = banco({
    patients: [{ id: 'pac-ana', clinic_id: CLINICA, name: 'Ana Teste', phone_digits: '13991110001', archived_at: null }],
  })
  const feito = await C.tratarAvisoDoCelular(
    admin,
    'history',
    historico([
      { id: ANA, messages: [texto(ANA, 'wamid.A1', T0, 'Quero marcar'), texto(CONSULTORIO, 'wamid.A2', T0 + 120, 'Tem quinta às 10h.')] },
    ]),
    f,
  )
  assert.equal(feito.clinica, CLINICA)
  assert.equal(feito.gravadas, 2)
  const [conversa] = b.linhas('whatsapp_conversations')
  assert.equal(conversa.wa_id, ANA)
  assert.equal(conversa.patient_id, 'pac-ana')
  assert.equal(conversa.last_message_at, '2026-10-20T16:02:00.000Z')
  assert.equal(conversa.needs_attention, undefined, 'historico nao pede atencao')
  assert.equal(conversa.unread_count, undefined, 'historico nao conta como nova')
  const mensagens = b.linhas('whatsapp_messages')
  assert.deepEqual(mensagens.map((m) => [m.external_message_id, m.direction, m.automatic, m.origem]), [
    ['wamid.A1', 'inbound', false, 'historico'],
    ['wamid.A2', 'outbound', false, 'historico'],
  ])
  assert.ok(mensagens.every((m) => m.conversation_id === conversa.id && m.patient_id === 'pac-ana' && m.clinic_id === CLINICA))
  assert.ok(mensagens.every((m) => !('midia' in m)), 'o bloco da midia nao vai ao banco')
})

await caso('a Meta manda de novo: nada duplica, e a conversa nao muda', async () => {
  const f = ferramentas()
  const { b, admin } = banco()
  const aviso = historico([{ id: ANA, messages: [texto(ANA, 'wamid.R1', T0, 'Oi')] }])
  await C.tratarAvisoDoCelular(admin, 'history', aviso, f)
  const segunda = await C.tratarAvisoDoCelular(admin, 'history', aviso, f)
  assert.equal(segunda.gravadas, 0)
  assert.equal(b.linhas('whatsapp_messages').length, 1)
  assert.equal(b.linhas('whatsapp_conversations').length, 1)
})

await caso('conversa que ja existe sem o nono digito e a mesma; mensagem antiga nao a faz descer', async () => {
  const f = ferramentas()
  const { b, admin } = banco({
    whatsapp_conversations: [{ id: 'conv-ana', clinic_id: CLINICA, wa_id: ANA_SEM_NOVE, patient_id: null, last_message_at: '2026-10-26T12:00:00.000Z' }],
  })
  await C.tratarAvisoDoCelular(admin, 'history', historico([{ id: ANA, messages: [texto(ANA, 'wamid.V1', T0, 'Oi')] }]), f)
  assert.equal(b.linhas('whatsapp_conversations').length, 1)
  assert.equal(b.linhas('whatsapp_messages')[0].conversation_id, 'conv-ana')
  assert.equal(b.linhas('whatsapp_conversations')[0].last_message_at, '2026-10-26T12:00:00.000Z')
})

await caso('conversa nova sem cadastro leva o nome da agenda do celular', async () => {
  const f = ferramentas()
  const { b, admin } = banco({
    whatsapp_contatos_do_celular: [{ clinic_id: CLINICA, wa_id: BETO, nome: 'Beto Convênio', removido_em: null }],
  })
  await C.tratarAvisoDoCelular(admin, 'history', historico([{ id: BETO, messages: [texto(BETO, 'wamid.B1', T0, 'Boa tarde')] }]), f)
  assert.equal(b.linhas('whatsapp_conversations')[0].nome_personalizado, 'Beto Convênio')
})

await caso('o arquivo do historico chega depois e entra no lugar do aviso', async () => {
  const f = ferramentas()
  const { b, admin } = banco()
  await C.tratarAvisoDoCelular(
    admin,
    'history',
    historico([{ id: ANA, messages: [{ from: ANA, id: 'wamid.F1', timestamp: String(T0), type: 'media_placeholder', history_context: { status: 'READ' } }] }]),
    f,
  )
  assert.equal(b.linhas('whatsapp_messages')[0].body, C.TEXTO_ARQUIVO_DO_HISTORICO)
  const feito = await C.tratarAvisoDoCelular(
    admin,
    'history',
    valor({ messages: [{ from: ANA, id: 'wamid.F1', timestamp: String(T0), type: 'image', image: { caption: 'Exame de ontem', mime_type: 'image/jpeg', id: '9001' } }] }),
    f,
  )
  assert.equal(feito.arquivos, 1)
  const [foto] = b.linhas('whatsapp_messages')
  assert.equal(b.linhas('whatsapp_messages').length, 1)
  assert.equal(foto.message_type, 'image')
  assert.equal(foto.body, 'Exame de ontem')
  assert.equal(foto.media_path, `${CLINICA}/wamid.F1`)
  assert.equal(foto.media_mime, 'image/jpeg')
})

await caso('o arquivo que chega antes do aviso entra como mensagem, e o aviso nao duplica', async () => {
  const f = ferramentas()
  const { b, admin } = banco()
  await C.tratarAvisoDoCelular(
    admin,
    'history',
    valor({ messages: [{ from: ANA, id: 'wamid.G1', timestamp: String(T0), type: 'audio', audio: { mime_type: 'audio/ogg', id: '9002' } }] }),
    f,
  )
  await C.tratarAvisoDoCelular(
    admin,
    'history',
    historico([{ id: ANA, messages: [{ from: ANA, id: 'wamid.G1', timestamp: String(T0), type: 'media_placeholder' }] }]),
    f,
  )
  const linhas = b.linhas('whatsapp_messages')
  assert.equal(linhas.length, 1)
  assert.equal(linhas[0].direction, 'inbound')
  assert.equal(linhas[0].media_path, `${CLINICA}/wamid.G1`)
})

await caso('a equipe escreveu pelo celular: resposta humana, conversa apagada como pela Central', async () => {
  const f = ferramentas()
  const { b, admin } = banco({
    whatsapp_conversations: [
      {
        id: 'conv-ana',
        clinic_id: CLINICA,
        wa_id: ANA,
        patient_id: 'pac-ana',
        last_message_at: '2026-10-20T15:00:00.000Z',
        needs_attention: true,
        attention_reason: 'atendente',
        unread_count: 3,
        status: 'resolved',
      },
    ],
  })
  const feito = await C.tratarAvisoDoCelular(
    admin,
    'smb_message_echoes',
    valor({ message_echoes: [{ from: CONSULTORIO, to: ANA, id: 'wamid.E1', timestamp: String(T0), type: 'text', text: { body: 'Oi Ana, é a Dayane.' } }] }),
    f,
  )
  assert.equal(feito.gravadas, 1)
  const [eco] = b.linhas('whatsapp_messages')
  assert.equal(eco.direction, 'outbound')
  assert.equal(eco.automatic, false, 'gente falando: o robo fica quieto 12 horas')
  assert.equal(eco.origem, 'celular')
  assert.equal(eco.status, 'sent')
  assert.equal(eco.patient_id, 'pac-ana')
  const [conversa] = b.linhas('whatsapp_conversations')
  assert.equal(conversa.needs_attention, false)
  assert.equal(conversa.attention_reason, null)
  assert.equal(conversa.unread_count, 0)
  assert.equal(conversa.status, 'open')
  assert.equal(conversa.last_message_at, '2026-10-20T16:00:00.000Z')
})

await caso('foto mandada pelo celular vem com o arquivo; eco repetido nao mexe de novo', async () => {
  const f = ferramentas()
  const { b, admin } = banco()
  const aviso = valor({
    message_echoes: [{ from: CONSULTORIO, to: BETO, id: 'wamid.E2', timestamp: String(T0), type: 'image', image: { mime_type: 'image/png', id: '9003' } }],
  })
  await C.tratarAvisoDoCelular(admin, 'smb_message_echoes', aviso, f)
  assert.equal(b.linhas('whatsapp_messages')[0].media_path, `${CLINICA}/wamid.E2`)
  assert.deepEqual(f.baixados, ['wamid.E2'])
  b.linhas('whatsapp_conversations')[0].needs_attention = true
  await C.tratarAvisoDoCelular(admin, 'smb_message_echoes', aviso, f)
  assert.equal(b.linhas('whatsapp_messages').length, 1)
  assert.deepEqual(f.baixados, ['wamid.E2'], 'nao baixa de novo')
  assert.equal(b.linhas('whatsapp_conversations')[0].needs_attention, true, 'o reenvio nao apaga um pedido novo')
})

await caso('agenda do celular: o nome vai para a conversa sem cadastro e sem nome dado pela equipe', async () => {
  const { b, admin } = banco({
    whatsapp_conversations: [
      { id: 'sem-nada', clinic_id: CLINICA, wa_id: ANA, patient_id: null, nome_personalizado: null },
      { id: 'com-cadastro', clinic_id: CLINICA, wa_id: BETO, patient_id: 'pac-beto', nome_personalizado: null },
    ],
  })
  const aviso = (nome, telefone, action = 'add') =>
    valor({ state_sync: [{ type: 'contact', contact: nome ? { full_name: nome, first_name: nome, phone_number: telefone } : { phone_number: telefone }, action, metadata: { timestamp: String(T0) } }] })
  await C.tratarAvisoDoCelular(admin, 'smb_app_state_sync', aviso('Ana da Agenda', ANA), ferramentas())
  await C.tratarAvisoDoCelular(admin, 'smb_app_state_sync', aviso('Beto da Agenda', BETO), ferramentas())
  const conversa = (id) => b.linhas('whatsapp_conversations').find((c) => c.id === id)
  assert.equal(conversa('sem-nada').nome_personalizado, 'Ana da Agenda')
  assert.equal(conversa('com-cadastro').nome_personalizado, null, 'o nome do cadastro ganha')
  assert.equal(b.linhas('whatsapp_contatos_do_celular').length, 2)

  // Mudou na agenda: o nome que era da agenda acompanha.
  await C.tratarAvisoDoCelular(admin, 'smb_app_state_sync', aviso('Ana Paula da Agenda', ANA), ferramentas())
  assert.equal(conversa('sem-nada').nome_personalizado, 'Ana Paula da Agenda')
  // A equipe renomeou na Central: a agenda nao passa por cima.
  conversa('sem-nada').nome_personalizado = 'Ana (mãe do Leo)'
  await C.tratarAvisoDoCelular(admin, 'smb_app_state_sync', aviso('Ana P.', ANA), ferramentas())
  assert.equal(conversa('sem-nada').nome_personalizado, 'Ana (mãe do Leo)')
  // Apagado da agenda: fica a data, a conversa nao perde o nome.
  await C.tratarAvisoDoCelular(admin, 'smb_app_state_sync', aviso(null, ANA, 'remove'), ferramentas())
  const ana = b.linhas('whatsapp_contatos_do_celular').find((l) => l.wa_id === ANA)
  assert.equal(ana.removido_em, '2026-10-20T16:00:00.000Z')
  assert.equal(conversa('sem-nada').nome_personalizado, 'Ana (mãe do Leo)')
})

await caso('banco sem a coluna origem: grava sem ela', async () => {
  const { b, admin } = banco({}, { semOrigem: true })
  const feito = await C.tratarAvisoDoCelular(admin, 'history', historico([{ id: ANA, messages: [texto(ANA, 'wamid.O1', T0, 'Oi'), texto(ANA, 'wamid.O2', T0 + 1, 'Tudo bem?')] }]), ferramentas())
  assert.equal(feito.gravadas, 2)
  assert.ok(b.linhas('whatsapp_messages').every((m) => !('origem' in m)))
})

await caso('banco sem a tabela da agenda: contato se perde sem derrubar; historico segue', async () => {
  const { b, admin } = banco({}, { semTabela: ['whatsapp_contatos_do_celular'] })
  const erros = []
  const avisar = console.error
  const alertar = console.warn
  console.error = (...a) => erros.push(a.join(' '))
  console.warn = () => {}
  try {
    const feito = await C.tratarAvisoDoCelular(
      admin,
      'smb_app_state_sync',
      valor({ state_sync: [{ type: 'contact', contact: { full_name: 'Ana', phone_number: ANA }, action: 'add', metadata: { timestamp: String(T0) } }] }),
      ferramentas(),
    )
    assert.equal(feito.contatos, 0)
    assert.ok(erros.some((e) => e.includes('agenda do celular')), 'grita no log')
    await C.tratarAvisoDoCelular(admin, 'history', historico([{ id: ANA, messages: [texto(ANA, 'wamid.T1', T0, 'Oi')] }]), ferramentas())
    assert.equal(b.linhas('whatsapp_messages').length, 1)
  } finally {
    console.error = avisar
    console.warn = alertar
  }
})

await caso('numero que nao e de clinica nenhuma: nada gravado', async () => {
  const { b, admin } = banco()
  const aviso = historico([{ id: ANA, messages: [texto(ANA, 'wamid.N1', T0, 'Oi')] }])
  aviso.metadata.phone_number_id = '999'
  const feito = await C.tratarAvisoDoCelular(admin, 'history', aviso, ferramentas())
  assert.equal(feito.clinica, null)
  assert.equal(b.linhas('whatsapp_messages').length, 0)
})

await caso('corrida: o lote bate em mensagem gravada agora por outra entrega, e o resto entra', async () => {
  const { b, admin } = banco()
  const from = admin.from.bind(admin)
  admin.from = (tabela) => {
    const pedido = from(tabela)
    if (tabela !== 'whatsapp_messages') return pedido
    const insert = pedido.insert.bind(pedido)
    pedido.insert = (valores) => {
      const linhas = Array.isArray(valores) ? valores : [valores]
      if (linhas.length > 1 || linhas[0].external_message_id === 'wamid.C1') {
        const r = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "whatsapp_messages_external_id_unique"' } }
        return { then: (okk, ko) => Promise.resolve(r).then(okk, ko) }
      }
      return insert(valores)
    }
    return pedido
  }
  const feito = await C.tratarAvisoDoCelular(
    admin,
    'history',
    historico([{ id: ANA, messages: [texto(ANA, 'wamid.C1', T0, 'Oi'), texto(ANA, 'wamid.C2', T0 + 1, 'Alguém?')] }]),
    ferramentas(),
  )
  assert.equal(feito.gravadas, 1)
  assert.deepEqual(b.linhas('whatsapp_messages').map((m) => m.external_message_id), ['wamid.C2'])
})

// ---------------------------------------------------------------------------
// O webhook
// ---------------------------------------------------------------------------

await caso('meta-webhook: os avisos do celular antes do filtro de "messages", e o 131060 calado', async () => {
  const fonte = lerComTrocas(join(AQUI, '..', 'supabase', 'functions', 'meta-webhook', 'index.ts'))
  const rota = fonte.indexOf('if (campoDoCelular(change.field))')
  const filtro = fonte.indexOf("if (change.field !== 'messages') continue")
  assert.ok(rota > 0 && rota < filtro, 'a coexistencia e tratada antes de o webhook descartar o que nao e "messages"')
  assert.match(fonte, /tratarAvisoDoCelular\(admin, String\(change\.field\), doCelular,/)
  const reacao = fonte.indexOf("if (message.type === 'reaction') continue")
  const calado = fonte.indexOf('if (soNoCelular(message)) {')
  const registro = fonte.indexOf("registro.registrar(`message:${externalId}`")
  assert.ok(reacao > 0 && calado > reacao && calado < registro, 'o 131060 sai antes de registrar e de chamar o robo')
})

conferirDesligar()
console.log(`Coexistencia: ${ok} casos passaram.`)
