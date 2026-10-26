// O arquivo do paciente que a Meta recusou depois de aceitar (25/10/2026, vindo
// do sistema do Dr. Marcello). Ver supabase/functions/_shared/anexos-pendentes.ts
// e anexo-para-equipe.ts. Sem Meta e sem banco de verdade; telefones
// inventados (o repositorio e publico). Para provar que um caso pega o
// defeito, ver DESLIGAR em tests/montar-para-teste.mjs.
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bancoCom, conferirDesligar, lerComTrocas, montar } from './montar-para-teste.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SHARED = join(AQUI, '..', 'supabase', 'functions', '_shared')
const P = await montar(join(SHARED, 'anexos-pendentes.ts'), join(AQUI, 'anexos-pendentes.build.mjs'))
const X = await montar(join(SHARED, 'anexo-para-equipe.ts'), join(AQUI, 'anexo-para-equipe.build.mjs'))
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
const agora = new Date('2026-10-25T16:40:00Z')
const envio = (extra) => ({
  clinic_id: FABIO,
  conversation_id: 'conv-1',
  numero: MEDICO,
  tipo: 'audio',
  caminho: `${FABIO}/wamid.A`,
  nome: null,
  quem: 'Paciente de Teste',
  recebido_em: '2026-10-25T16:35:04Z',
  meta_id: null,
  situacao: 'enviado',
  erro: null,
  tentativas: 1,
  nota_em: null,
  ...extra,
})
const JANELA = [{ code: 131047, title: 'Re-engagement message', error_data: { details: 'Message failed to send because more than 24 hours have passed since the customer last replied to this number.' } }]
const banco = (tabelas, opcoes) => {
  const b = new BancoFalso({ anexos_para_equipe: [], conversation_notes: [], ...tabelas }, {})
  return { b, admin: bancoCom(b, opcoes) }
}
const comAcervo = (admin) => {
  admin.storage = { from: () => ({ createSignedUrl: async (caminho) => ({ data: { signedUrl: `https://acervo/${caminho}` }, error: null }) }) }
  return admin
}

await caso('a recusa que chega depois: os dois envios ficam pendentes, e a conversa ganha UMA nota', async () => {
  const { b, admin } = banco({ anexos_para_equipe: [envio({ id: 'e1', meta_id: 'wamid.2' }), envio({ id: 'e2', numero: DAYANE, meta_id: 'wamid.4' })] })
  assert.equal(await P.acompanharEnvioDoAnexo(admin, 'wamid.2', 'failed', JANELA, agora), true)
  assert.equal(await P.acompanharEnvioDoAnexo(admin, 'wamid.4', 'failed', JANELA, agora), true)
  assert.ok(b.linhas('anexos_para_equipe').every((l) => l.situacao === 'pendente'))
  const notas = b.linhas('conversation_notes')
  assert.equal(notas.length, 1, 'o mesmo audio recusado nos dois celulares e uma coisa so')
  assert.match(notas[0].texto, /^⚠️ O áudio não chegou aos celulares: a Meta só deixa mandar arquivo/)
  assert.match(notas[0].texto, /Vai sozinho assim que o celular escrever/)
  assert.equal(notas[0].conversation_id, 'conv-1')
})

await caso('entregue: marca entregue, sem nota; id que nao e de arquivo segue o webhook', async () => {
  const { b, admin } = banco({ anexos_para_equipe: [envio({ id: 'e1', meta_id: 'wamid.2' })] })
  assert.equal(await P.acompanharEnvioDoAnexo(admin, 'wamid.2', 'delivered', null, agora), true)
  assert.equal(b.linhas('anexos_para_equipe')[0].situacao, 'entregue')
  assert.equal(b.linhas('conversation_notes').length, 0)
  assert.equal(await P.acompanharEnvioDoAnexo(admin, 'wamid.do-paciente', 'failed', JANELA, agora), false)
})

await caso('sem a tabela (migration nao chegou): devolve false e nao quebra', async () => {
  const { admin } = banco({}, { semTabela: ['anexos_para_equipe'] })
  assert.equal(await P.acompanharEnvioDoAnexo(admin, 'wamid.2', 'failed', JANELA, agora), false)
  await P.registrarEnvioDoAnexo(admin, { clinicId: FABIO, numero: MEDICO, tipo: 'image', caminho: 'x', quem: 'Q', recebidoEm: agora.toISOString(), metaId: null, ok: false })
  const enviar = async () => {
    throw new Error('nao devia mandar nada')
  }
  assert.equal(await P.entregarAnexosPendentes(comAcervo(admin), FABIO, MEDICO, enviar, agora), 0)
})

await caso('a janela abriu: vai o pendente daquele celular, com a linha de quem e de quando antes', async () => {
  const { b, admin } = banco({
    anexos_para_equipe: [
      // Sem o 55: a grafia do cadastro pode ser outra.
      envio({ id: 'e1', situacao: 'pendente', numero: '13900000001' }),
      envio({ id: 'e2', situacao: 'pendente', numero: DAYANE }),
      envio({ id: 'e3', situacao: 'pendente', numero: MEDICO, recebido_em: '2026-10-10T10:00:00Z' }),
      envio({ id: 'e4', situacao: 'entregue', numero: MEDICO, meta_id: 'wamid.9' }),
    ],
  })
  const mandados = []
  const enviar = async (para, conteudo) => {
    mandados.push([para, conteudo])
    return { ok: true, id: `wamid.novo${mandados.length}` }
  }
  const foram = await P.entregarAnexosPendentes(comAcervo(admin), FABIO, MEDICO, enviar, agora)
  assert.equal(foram, 1)
  assert.equal(mandados.length, 2)
  assert.equal(mandados[0][1].type, 'text')
  assert.equal(mandados[0][1].text.body, '📎 Áudio que Paciente de Teste mandou às 13:35 de 25/10:')
  assert.equal(mandados[1][1].type, 'audio')
  assert.equal(mandados[1][1].audio.link, `https://acervo/${FABIO}/wamid.A`)
  const e1 = b.linhas('anexos_para_equipe').find((l) => l.id === 'e1')
  assert.equal(e1.situacao, 'reenviado')
  assert.equal(e1.meta_id, 'wamid.novo2')
  assert.equal(e1.tentativas, 2)
  assert.equal(b.linhas('anexos_para_equipe').find((l) => l.id === 'e2').situacao, 'pendente', 'o do outro celular espera ele escrever')
  assert.equal(b.linhas('anexos_para_equipe').find((l) => l.id === 'e3').situacao, 'pendente', 'mais de 7 dias nao vai')
})

await caso('foto pendente: a linha antes e a foto com a legenda; recusado de novo continua pendente', async () => {
  let { admin } = banco({ anexos_para_equipe: [envio({ id: 'e1', situacao: 'pendente', tipo: 'image' })] })
  const mandados = []
  await P.entregarAnexosPendentes(comAcervo(admin), FABIO, MEDICO, async (para, c) => {
    mandados.push(c)
    return { ok: true, id: 'w' }
  }, agora)
  assert.deepEqual(mandados.map((m) => m.type), ['text', 'image'])
  assert.equal(mandados[1].image.caption, '📎 Enviado por Paciente de Teste pela Central de Cuidado')
  const segundo = banco({ anexos_para_equipe: [envio({ id: 'e1', situacao: 'pendente' })] })
  admin = segundo.admin
  await P.entregarAnexosPendentes(comAcervo(admin), FABIO, MEDICO, async () => ({ ok: false, erro: 'recusado' }), agora)
  const e1 = segundo.b.linhas('anexos_para_equipe')[0]
  assert.equal(e1.situacao, 'pendente')
  assert.equal(e1.tentativas, 2)
  assert.equal(e1.erro, 'recusado')
})

await caso('textos: 131047, a nota de outra recusa e o cabecalho', () => {
  assert.equal(P.recusaPelaJanela(JANELA), true)
  assert.equal(P.recusaPelaJanela([{ code: 131026 }]), false)
  assert.equal(P.recusaPelaJanela(null), false)
  assert.match(P.notaDaRecusa('image', false, 'Message undeliverable'), /^⚠️ A foto não chegou aos celulares \(Message undeliverable\)/)
  assert.equal(X.cabecalhoDoAnexo('document', '', '2026-10-25T16:35:04Z'), '📎 Documento que o paciente mandou às 13:35 de 25/10:')
  for (const t of [P.notaDaRecusa('audio', true), P.notaDaRecusa('video', false, 'x'), X.cabecalhoDoAnexo('image', 'Ana', '2026-10-25T16:35:04Z')]) {
    assert.doesNotMatch(t, new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`), 'sem travessao nem meia-risca')
  }
})

await caso('a migration: tabela com a conversa deste sistema, RLS forcada, so o servidor escreve', () => {
  const m = ler('supabase', 'migrations', '20261025120000_anexos_para_equipe.sql')
  assert.match(m, /Vindo do sistema do Dr\. Marcello/)
  assert.match(m, /create table if not exists public\.anexos_para_equipe/)
  assert.match(m, /conversation_id uuid references public\.whatsapp_conversations\(id\)/)
  assert.match(m, /check \(situacao in \('enviado', 'entregue', 'pendente', 'reenviado'\)\)/)
  assert.match(m, /alter table public\.anexos_para_equipe force row level security/)
  assert.match(m, /revoke all on table public\.anexos_para_equipe from public, anon, authenticated/)
  assert.match(m, /grant select on table public\.anexos_para_equipe to authenticated/)
  assert.doesNotMatch(m, /supabase\.co/i, 'nada de URL de projeto')
})

conferirDesligar()
console.log(`anexos pendentes: ${ok} casos ok`)
