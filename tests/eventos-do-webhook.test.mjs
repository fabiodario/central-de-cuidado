// Mensagem que falha no meio do processamento nao pode se perder no reenvio
// da Meta (24/09/2026), nem quando a execucao e derrubada por tempo e o catch
// nao roda (23/10/2026). Ver supabase/functions/_shared/eventos-do-webhook.ts.

import { ABANDONO_MS, RegistroDeEventos } from './eventos-do-webhook.build.mjs'

let passou = 0
const falhas = []
function confere(titulo, condicao) {
  if (condicao) passou++
  else falhas.push(titulo)
}

// Relogio da tabela e do registro, para simular minutos passando.
let agoraMs = Date.parse('2026-10-23T13:01:00Z')
const relogio = () => new Date(agoraMs)

// Tabela falsa com chave unica, como a de verdade. `antiga` = sem concluir e
// retomar (o comportamento de antes de 23/10).
function tabelaFalsa({ apagarFalha = false, retomarFalha = false, antiga = false } = {}) {
  const linhas = new Map()
  const t = {
    linhas,
    chaves: { has: (k) => linhas.has(k) },
    inserir: async (linha) =>
      linhas.has(linha.event_key)
        ? { error: { code: '23505', message: 'duplicate key' } }
        : (linhas.set(linha.event_key, { gravadoEm: agoraMs, concluido: false }), { error: null }),
    apagar: async (chave) => {
      if (apagarFalha) return { error: { message: 'permission denied' } }
      linhas.delete(chave)
      return { error: null }
    },
  }
  if (antiga) return t
  t.concluir = async (chave) => {
    const l = linhas.get(chave)
    if (l) l.concluido = true
    return { error: null }
  }
  t.retomar = async (chave, gravadoAntesDe) => {
    if (retomarFalha) return { data: null, error: { message: 'permission denied' } }
    const l = linhas.get(chave)
    if (!l || l.concluido || !(l.gravadoEm < Date.parse(gravadoAntesDe))) return { data: [], error: null }
    l.gravadoEm = agoraMs
    return { data: [{ event_key: chave }], error: null }
  }
  return t
}

// O webhook de verdade, reduzido: registra, processa, e no erro libera.
// `derrubarEm`: a plataforma mata a execucao ali - nem catch nem conclusao.
async function receber(tabela, ids, { falharEm = null, derrubarEm = null } = {}) {
  const registro = new RegistroDeEventos(tabela, relogio)
  const processadas = []
  try {
    for (const id of ids) {
      await registro.concluir()
      if ((await registro.registrar(`message:${id}`, 'message', {})) === 'repetido') continue
      if (id === derrubarEm) return { status: 504, processadas }
      if (id === falharEm) throw new Error('banco fora do ar')
      processadas.push(id)
    }
    await registro.concluir()
    return { status: 200, processadas }
  } catch {
    await registro.desfazerEmCurso()
    return { status: 500, processadas }
  }
}

function silenciar(fn) {
  const [aviso, erro] = [console.warn, console.error]
  console.warn = () => {}
  console.error = () => {}
  return fn().finally(() => {
    console.warn = aviso
    console.error = erro
  })
}

// 1. Aviso repetido de algo que deu certo continua sendo ignorado - mesmo muito depois.
{
  const t = tabelaFalsa()
  await receber(t, ['A'])
  agoraMs += 60 * 60 * 1000
  const r = await receber(t, ['A'])
  confere('Repetido que deu certo e ignorado', r.status === 200 && r.processadas.length === 0)
}

// 2. O caso de 24/09: falhou no meio, a Meta reenvia, e a mensagem e processada.
{
  const t = tabelaFalsa()
  const primeira = await silenciar(() => receber(t, ['B'], { falharEm: 'B' }))
  confere('Falha devolve 500 para a Meta reenviar', primeira.status === 500)
  const reenvio = await receber(t, ['B'])
  confere('Reenvio depois da falha e processado', reenvio.processadas.includes('B'))
}

// 3. No lote, so o evento que falhou e liberado; o que ja terminou nao repete.
{
  const t = tabelaFalsa()
  await silenciar(() => receber(t, ['C', 'D'], { falharEm: 'D' }))
  confere('Evento que terminou continua registrado', t.chaves.has('message:C'))
  confere('Evento que falhou foi liberado', !t.chaves.has('message:D'))
  agoraMs += 10 * 60 * 1000
  const reenvio = await receber(t, ['C', 'D'])
  confere('Reenvio do lote nao repete o que terminou', !reenvio.processadas.includes('C'))
  confere('Reenvio do lote processa o que falhou', reenvio.processadas.includes('D'))
}

// 4. Erro fora de qualquer evento nao libera nada.
{
  const t = tabelaFalsa()
  const registro = new RegistroDeEventos(t, relogio)
  await registro.registrar('message:E', 'message', {})
  await registro.concluir()
  confere('Sem evento em curso, nada e apagado', (await registro.desfazerEmCurso()) === null && t.chaves.has('message:E'))
}

// 5. Se nem apagar der certo, o erro original nao e escondido por outro.
{
  const t = tabelaFalsa({ apagarFalha: true })
  let lancou = false
  try {
    await silenciar(() => receber(t, ['F'], { falharEm: 'F' }))
  } catch {
    lancou = true
  }
  confere('Falha ao liberar nao lanca', !lancou)
}

// 6. O caso de 23/10 no sistema do Dr. Marcello: a plataforma derrubou a execucao por tempo, o
// catch nao rodou e a chave ficou. Os reenvios da Meta (2 a 4 min depois)
// tem que processar a mensagem, nao descarta-la como repetida.
{
  const t = tabelaFalsa()
  const derrubada = await receber(t, ['G'], { derrubarEm: 'G' })
  confere('Execucao derrubada nao processou', derrubada.status === 504 && derrubada.processadas.length === 0)
  agoraMs += ABANDONO_MS + 60 * 1000
  const reenvio = await silenciar(() => receber(t, ['G']))
  confere('Reenvio depois de execucao derrubada processa a mensagem', reenvio.processadas.includes('G'))
  confere('Mensagem retomada fica concluida', t.linhas.get('message:G')?.concluido === true)
  agoraMs += ABANDONO_MS + 60 * 1000
  const outro = await receber(t, ['G'])
  confere('Depois de retomada e concluida, nao processa de novo', outro.processadas.length === 0)
}

// 7. Reenvio que chega enquanto a primeira execucao ainda pode estar viva
// (menos de ABANDONO_MS) nao processa junto - responderia duas vezes.
{
  const t = tabelaFalsa()
  await receber(t, ['H'], { derrubarEm: 'H' })
  agoraMs += ABANDONO_MS - 30 * 1000
  const cedo = await receber(t, ['H'])
  confere('Reenvio cedo demais e descartado', cedo.processadas.length === 0)
}

// 8. Dois reenvios do mesmo evento abandonado: so um retoma.
{
  const t = tabelaFalsa()
  await receber(t, ['I'], { derrubarEm: 'I' })
  agoraMs += ABANDONO_MS + 60 * 1000
  const [um, dois] = await silenciar(() => Promise.all([receber(t, ['I']), receber(t, ['I'])]))
  confere('So um dos reenvios simultaneos retoma', um.processadas.length + dois.processadas.length === 1)
}

// 9. Se nao der para conferir o abandono, vale o comportamento antigo (descarta).
{
  const t = tabelaFalsa({ retomarFalha: true })
  await receber(t, ['J'], { derrubarEm: 'J' })
  agoraMs += ABANDONO_MS + 60 * 1000
  let lancou = false
  let r
  try {
    r = await silenciar(() => receber(t, ['J']))
  } catch {
    lancou = true
  }
  confere('Falha ao retomar nao lanca e descarta', !lancou && r.status === 200 && r.processadas.length === 0)
}

// 10. Tabela sem concluir/retomar (versao antiga) continua funcionando.
{
  const t = tabelaFalsa({ antiga: true })
  await receber(t, ['K'])
  agoraMs += ABANDONO_MS + 60 * 1000
  const r = await receber(t, ['K'])
  confere('Tabela antiga: repetido continua ignorado', r.processadas.length === 0)
}

console.log(`Eventos do webhook: ${passou} verificações passaram.`)
if (falhas.length) {
  for (const f of falhas) console.log('✗ ' + f)
  process.exit(1)
}
