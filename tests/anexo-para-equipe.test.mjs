// A foto, o audio ou o documento do paciente junto do alerta (25/10/2026,
// vindo do sistema do Dr. Marcello). Ver supabase/functions/_shared/anexo-para-equipe.ts.
// Para provar que um caso pega o defeito, ver DESLIGAR em tests/montar-para-teste.mjs.
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bancoCom, conferirDesligar, montar } from './montar-para-teste.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SHARED = join(AQUI, '..', 'supabase', 'functions', '_shared')
const X = await montar(join(SHARED, 'anexo-para-equipe.ts'), join(AQUI, 'anexo-para-equipe.build.mjs'))
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

await caso('o que vai como arquivo: foto, audio, documento e video; figurinha e localizacao nao', () => {
  for (const t of ['image', 'audio', 'voice', 'document', 'video']) assert.equal(X.anexoQueVai(t), true, t)
  for (const t of ['sticker', 'location', 'contacts', 'text', '', null, undefined]) assert.equal(X.anexoQueVai(t), false, String(t))
})

await caso('a mensagem de arquivo para a Meta: legenda de quem mandou, audio sem legenda, documento com nome', () => {
  const link = 'https://acervo/x'
  assert.deepEqual(X.mensagemDoAnexo({ tipo: 'image', link }, 'Ana Souza'), { type: 'image', image: { link, caption: '📎 Enviado por Ana Souza pela Central de Cuidado' } })
  assert.deepEqual(X.mensagemDoAnexo({ tipo: 'video', link }, ' '), { type: 'video', video: { link, caption: '📎 Enviado pelo paciente pela Central de Cuidado' } })
  assert.deepEqual(X.mensagemDoAnexo({ tipo: 'document', link, nome: 'exame.pdf' }, 'Ana'), {
    type: 'document',
    document: { link, caption: '📎 Enviado por Ana pela Central de Cuidado', filename: 'exame.pdf' },
  })
  assert.deepEqual(X.mensagemDoAnexo({ tipo: 'voice', link }, 'Ana'), { type: 'audio', audio: { link } }, 'a Meta nao aceita legenda no audio')
  assert.equal(X.mensagemDoAnexo({ tipo: 'sticker', link }, 'Ana'), null)
  assert.equal(X.mensagemDoAnexo({ tipo: 'image', link: '' }, 'Ana'), null, 'sem link, nao vai')
})

await caso('a nota: so quando nao foi, com o porque e o que acontece depois', () => {
  assert.equal(X.notaDoAnexo('image', []), '')
  assert.equal(X.notaDoAnexo('image', [{ numero: '5513900000001', ok: true }]), '')
  const nota = X.notaDoAnexo('audio', [{ numero: '5513900000001', ok: true }, { numero: '5513900000002', ok: false, erro: '(#131047)' }])
  assert.match(nota, /^⚠️ O áudio não foi para final 0002: a Meta só deixa mandar arquivo/)
  assert.match(nota, /Vai sozinho quando esse celular escrever/)
  assert.doesNotMatch(nota, new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`), 'sem travessao nem meia-risca')
})

await caso('o arquivo de pouco antes: o ultimo do paciente, com link, so dentro do prazo e so do que vai', async () => {
  const banco = new BancoFalso(
    {
      whatsapp_messages: [
        { id: 'm1', conversation_id: 'conv-1', direction: 'inbound', message_type: 'image', media_path: 'c/antiga', created_at: '2026-10-25T16:00:00Z' },
        { id: 'm2', conversation_id: 'conv-1', direction: 'inbound', message_type: 'image', media_path: 'c/nova', created_at: '2026-10-25T16:38:00Z' },
        { id: 'm3', conversation_id: 'conv-1', direction: 'outbound', message_type: 'image', media_path: 'c/nossa', created_at: '2026-10-25T16:39:00Z' },
        { id: 'm4', conversation_id: 'conv-1', direction: 'inbound', message_type: 'text', media_path: null, created_at: '2026-10-25T16:39:30Z' },
        { id: 'm5', conversation_id: 'conv-2', direction: 'inbound', message_type: 'audio', media_path: 'c/outra', created_at: '2026-10-25T16:39:40Z' },
      ],
    },
    {},
  )
  const admin = bancoCom(banco)
  admin.storage = { from: () => ({ createSignedUrl: async (caminho) => ({ data: { signedUrl: `https://acervo/${caminho}` }, error: null }) }) }
  const desde = new Date('2026-10-25T16:30:00Z')
  assert.deepEqual(await X.anexoRecenteDaConversa(admin, 'conv-1', desde), {
    tipo: 'image',
    link: 'https://acervo/c/nova',
    caminho: 'c/nova',
    recebidoEm: '2026-10-25T16:38:00Z',
  })
  assert.equal(await X.anexoRecenteDaConversa(admin, 'conv-1', new Date('2026-10-25T16:39:00Z')), undefined, 'fora do prazo nao vai')
  const semAcervo = bancoCom(banco)
  assert.equal(await X.anexoRecenteDaConversa(semAcervo, 'conv-1', desde), undefined, 'sem o acervo, o alerta vai sem o arquivo')
  const quebrado = bancoCom(banco, { semTabela: ['whatsapp_messages'] })
  assert.equal(await X.anexoRecenteDaConversa(quebrado, 'conv-1', desde), undefined, 'nunca lanca')
})

conferirDesligar()
console.log(`anexo para a equipe: ${ok} casos ok`)
