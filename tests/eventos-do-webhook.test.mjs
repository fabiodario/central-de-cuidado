// Mensagem que falha no meio do processamento nao pode se perder no reenvio
// da Meta (24/09/2026). Ver supabase/functions/_shared/eventos-do-webhook.ts.

import { RegistroDeEventos } from './eventos-do-webhook.build.mjs'

let passou = 0
const falhas = []
function confere(titulo, condicao) {
  if (condicao) passou++
  else falhas.push(titulo)
}

// Tabela falsa com chave unica, como a de verdade.
function tabelaFalsa({ apagarFalha = false } = {}) {
  const chaves = new Set()
  return {
    chaves,
    inserir: async (linha) =>
      chaves.has(linha.event_key)
        ? { error: { code: '23505', message: 'duplicate key' } }
        : (chaves.add(linha.event_key), { error: null }),
    apagar: async (chave) => {
      if (apagarFalha) return { error: { message: 'permission denied' } }
      chaves.delete(chave)
      return { error: null }
    },
  }
}

// O webhook de verdade, reduzido: registra, processa, e no erro libera.
async function receber(tabela, ids, falharEm = null) {
  const registro = new RegistroDeEventos(tabela)
  const processadas = []
  try {
    for (const id of ids) {
      registro.concluir()
      if ((await registro.registrar(`message:${id}`, 'message', {})) === 'repetido') continue
      if (id === falharEm) throw new Error('banco fora do ar')
      processadas.push(id)
    }
    return { status: 200, processadas }
  } catch {
    await registro.desfazerEmCurso()
    return { status: 500, processadas }
  }
}

// 1. Aviso repetido de algo que deu certo continua sendo ignorado.
{
  const t = tabelaFalsa()
  await receber(t, ['A'])
  const r = await receber(t, ['A'])
  confere('Repetido que deu certo e ignorado', r.status === 200 && r.processadas.length === 0)
}

// 2. O caso de 24/09: falhou no meio, a Meta reenvia, e a mensagem e processada.
{
  const t = tabelaFalsa()
  const primeira = await receber(t, ['B'], 'B')
  confere('Falha devolve 500 para a Meta reenviar', primeira.status === 500)
  const reenvio = await receber(t, ['B'])
  confere('Reenvio depois da falha e processado', reenvio.processadas.includes('B'))
}

// 3. No lote, so o evento que falhou e liberado; o que ja terminou nao repete.
{
  const t = tabelaFalsa()
  await receber(t, ['C', 'D'], 'D')
  confere('Evento que terminou continua registrado', t.chaves.has('message:C'))
  confere('Evento que falhou foi liberado', !t.chaves.has('message:D'))
  const reenvio = await receber(t, ['C', 'D'])
  confere('Reenvio do lote nao repete o que terminou', !reenvio.processadas.includes('C'))
  confere('Reenvio do lote processa o que falhou', reenvio.processadas.includes('D'))
}

// 4. Erro fora de qualquer evento nao libera nada.
{
  const t = tabelaFalsa()
  const registro = new RegistroDeEventos(t)
  await registro.registrar('message:E', 'message', {})
  registro.concluir()
  confere('Sem evento em curso, nada e apagado', (await registro.desfazerEmCurso()) === null && t.chaves.has('message:E'))
}

// 5. Se nem apagar der certo, o erro original nao e escondido por outro.
{
  const t = tabelaFalsa({ apagarFalha: true })
  const erroOriginal = console.error
  console.error = () => {}
  let lancou = false
  try {
    await receber(t, ['F'], 'F')
  } catch {
    lancou = true
  }
  console.error = erroOriginal
  confere('Falha ao liberar nao lanca', !lancou)
}

console.log(`Eventos do webhook: ${passou} verificações passaram.`)
if (falhas.length) {
  for (const f of falhas) console.log('✗ ' + f)
  process.exit(1)
}
