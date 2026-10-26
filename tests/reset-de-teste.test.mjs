// RESET de teste (25/10/2026, pedido do Edu, TEMPORARIO: sai antes do numero
// oficial). Ver supabase/functions/_shared/reset-de-teste.ts. Banco de
// mentira, telefones inventados (o repositorio e publico). Para provar que um
// caso pega o defeito, ver DESLIGAR em tests/montar-para-teste.mjs.
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bancoCom, conferirDesligar, lerComTrocas, montar } from './montar-para-teste.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SHARED = join(AQUI, '..', 'supabase', 'functions', '_shared')
const R = await montar(join(SHARED, 'reset-de-teste.ts'), join(AQUI, 'reset-de-teste.build.mjs'))
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
const OUTRA = 'c1'
const TESTADOR = '5513990000005'
const OUTRO = '5513990000006'
const AGORA = new Date('2026-10-25T22:00:00Z')

await caso('so a palavra RESET, sozinha', () => {
  for (const t of ['RESET', 'reset', ' Reset! ', 'reset.']) assert.equal(R.pediuReset(t), true, t)
  for (const t of ['reseta', 'reset a conversa', 'quero resetar', 'resetar', '', null, 'RESET?']) assert.equal(R.pediuReset(t), false, String(t))
})

await caso('so em modo teste e so para quem esta na lista (com e sem o 55 e o nono digito)', async () => {
  const com = (lista) => bancoCom(new BancoFalso({ clinic_settings: [{ clinic_id: FABIO, whatsapp_telefones_teste: lista }] }, {}))
  assert.equal(await R.podeResetar(com(['13990000005']), FABIO, TESTADOR), true)
  assert.equal(await R.podeResetar(com([TESTADOR]), FABIO, '1390000005'), true, 'numero antigo sem o 9')
  assert.equal(await R.podeResetar(com([TESTADOR]), FABIO, OUTRO), false, 'fora da lista')
  assert.equal(await R.podeResetar(com(null), FABIO, TESTADOR), false, 'clinica de verdade: lista nula, RESET e mensagem comum')
  assert.equal(await R.podeResetar(com([]), FABIO, TESTADOR), false, 'lista vazia')
  const semColuna = bancoCom(new BancoFalso({ clinic_settings: [] }, {}), { semColuna: ['whatsapp_telefones_teste'] })
  assert.equal(await R.podeResetar(semColuna, FABIO, TESTADOR), false, 'sem a coluna: nao reseta')
})

function cenario() {
  const consulta = (extra) => ({ clinic_id: FABIO, status: 'scheduled', contact_phone: TESTADOR, starts_at: '2026-10-28T13:00:00Z', ...extra })
  const alerta = (extra) => ({ clinic_id: FABIO, conversation_id: 'conv-1', teste: false, criado_em: '2026-10-25T21:30:00Z', ...extra })
  const banco = new BancoFalso(
    {
      appointments: [
        consulta({ id: 'a1' }),
        consulta({ id: 'a2', contact_phone: '13990000005', starts_at: '2026-10-30T13:00:00Z' }),
        consulta({ id: 'a3', starts_at: '2026-10-20T13:00:00Z' }),
        consulta({ id: 'a4', contact_phone: OUTRO }),
        consulta({ id: 'a5', clinic_id: OUTRA }),
      ],
      alertas_de_urgencia: [alerta({ id: 'u1' }), alerta({ id: 'u2', conversation_id: 'conv-2', teste: true }), alerta({ id: 'u3', criado_em: '2026-10-23T21:30:00Z' }), alerta({ id: 'u4', clinic_id: OUTRA })],
      whatsapp_conversations: [
        {
          id: 'conv-1',
          clinic_id: FABIO,
          wa_id: TESTADOR,
          booking_state: 'aguardando_dia',
          booking_options: ['x'],
          booking_unit_id: 'u-1',
          booking_patient_id: 'p-1',
          booking_replaces_id: 'a9',
          booking_intake_id: 'a9',
          booking_insurance: 'Porto Saúde',
          booking_modality: 'presencial',
          auto_replies_while_waiting: 3,
          menu_sent_at: '2026-10-25T21:00:00Z',
          needs_attention: true,
          attention_reason: 'urgencia',
          robo_desligado_em: '2026-10-25T21:10:00Z',
          status: 'resolved',
        },
      ],
      conversation_notes: [],
    },
    {},
  )
  return { banco, admin: bancoCom(banco) }
}

await caso('o RESET: cancela as consultas futuras deste telefone, encerra os alertas de 24 horas, zera a conversa e anota', async () => {
  const { banco, admin } = cenario()
  const r = await R.resetarConversaDeTeste(admin, { clinicId: FABIO, conversationId: 'conv-1', telefone: TESTADOR, agora: AGORA })
  assert.deepEqual(r, { consultas: 2, alertas: 2, falhas: [] })
  const status = Object.fromEntries(banco.linhas('appointments').map((a) => [a.id, a.status]))
  assert.deepEqual(status, { a1: 'cancelled', a2: 'cancelled', a3: 'scheduled', a4: 'scheduled', a5: 'scheduled' })
  const a1 = banco.linhas('appointments').find((a) => a.id === 'a1')
  assert.equal(a1.cancellation_reason, 'RESET de teste')
  assert.equal(a1.cancelled_at, AGORA.toISOString())
  assert.deepEqual(banco.linhas('alertas_de_urgencia').map((a) => a.id).sort(), ['u3', 'u4'], 'os de mais de 24 horas e os de outra clinica ficam')
  const c = banco.linhas('whatsapp_conversations')[0]
  for (const campo of ['booking_state', 'booking_options', 'booking_unit_id', 'booking_patient_id', 'booking_replaces_id', 'booking_intake_id', 'booking_insurance', 'booking_modality', 'menu_sent_at', 'attention_reason', 'robo_desligado_em']) {
    assert.equal(c[campo], null, campo)
  }
  assert.equal(c.auto_replies_while_waiting, 0)
  assert.equal(c.needs_attention, false)
  assert.equal(c.status, 'open')
  assert.deepEqual(banco.linhas('conversation_notes').map((n) => [n.conversation_id, n.texto]), [
    ['conv-1', '🔄 RESET de teste pelo celular final 0005: 2 consultas de teste canceladas, 2 alertas encerrados, conversa recomeçada.'],
  ])
})

await caso('uma parte que falha nao impede as outras, e a resposta diz o que nao deu', async () => {
  const { banco } = cenario()
  const admin = bancoCom(banco, { semTabela: ['alertas_de_urgencia'] })
  const r = await R.resetarConversaDeTeste(admin, { clinicId: FABIO, conversationId: 'conv-1', telefone: TESTADOR, agora: AGORA })
  assert.deepEqual(r, { consultas: 2, alertas: 0, falhas: ['alertas'] })
  assert.equal(banco.linhas('whatsapp_conversations')[0].booking_state, null, 'a conversa foi zerada mesmo assim')
  assert.match(R.respostaDoReset(r), /⚠️ Não deu para zerar: alertas\. Avise o Edu\./)
})

await caso('os textos: singular e plural, e sem travessao', () => {
  const um = R.respostaDoReset({ consultas: 1, alertas: 0, falhas: [] })
  assert.equal(
    um,
    '🔄 *RESET de teste*: a conversa recomeçou do zero.\n\n• 1 consulta de teste cancelada\n• 0 alertas de urgência encerrados\n\nPode testar de novo: mande *Oi*.',
  )
  const nota = R.notaDoReset({ consultas: 0, alertas: 1, falhas: ['conversa'] }, '5513990000005')
  assert.equal(nota, '🔄 RESET de teste pelo celular final 0005: 0 consultas de teste canceladas, 1 alerta encerrado, conversa recomeçada. ⚠️ Não deu para zerar: conversa.')
  for (const t of [um, nota]) assert.doesNotMatch(t, new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`))
})

await caso('o webhook: lido antes da resposta ao alerta, sem repasse, e para antes do robo', () => {
  const w = ler('supabase', 'functions', 'meta-webhook', 'index.ts')
  const lido = w.indexOf('const ehReset = pediuReset(messageBody(message)) && (await podeResetar(admin, clinicId, waId))')
  assert.ok(lido > 0)
  assert.ok(lido < w.indexOf('const tratada = await tratarRespostaDaEquipe('), 'antes da resposta ao alerta')
  assert.match(w, /if \(numerosDoAlerta\?\.length && !ehReset\) \{\n\s*const tratada = await tratarRespostaDaEquipe\(/)
  assert.match(w, /if \(numerosDoAlerta\?\.length && !ehReset\) \{\n\s*await repassarRespostaDoPaciente\(/)
  const bloco = w.indexOf('if (ehReset) {')
  assert.ok(bloco > w.indexOf("if (messageError) throw messageError"), 'o RESET fica gravado na conversa')
  assert.ok(bloco < w.indexOf('const roboLigadoAqui = roboRespondeNaConversa('), 'antes do robo')
  assert.match(w.slice(bloco, bloco + 900), /await responder\(respostaDoReset\(zerado\)\)[\s\S]*continue\n/)
})

conferirDesligar()
console.log(`reset de teste: ${ok} casos ok`)
