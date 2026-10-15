// buscarTodas: a lista de conversas nao pode perder linha no corte de 1.000.
// Caso real (24/09/2026): 1.672 mensagens, so 1.000 chegavam, e conversas
// antigas voltavam como pendentes.
import { buscarTodas, MAXIMO_DE_PAGINAS } from './paginar.build.mjs'

let falhas = 0
let ok = 0
function confere(nome, cond) {
  if (cond) ok++
  else {
    falhas++
    console.error('FALHOU:', nome)
  }
}

// Servidor falso com o mesmo comportamento do Supabase: nunca devolve mais que
// `corte` linhas, por maior que seja o intervalo pedido.
function servidor(total, corte = 1000) {
  const linhas = Array.from({ length: total }, (_, i) => ({ id: i }))
  let chamadas = 0
  const pedir = async (de, ate) => {
    chamadas++
    return { data: linhas.slice(de, Math.min(ate + 1, de + corte)), error: null }
  }
  return { pedir, chamadas: () => chamadas }
}

{
  const s = servidor(1672)
  const { data, error } = await buscarTodas(s.pedir)
  confere('1.672 linhas chegam todas (o caso de 24/09)', data.length === 1672)
  confere('sem erro', error === null)
  confere('ultima linha e a mais antiga', data[1671].id === 1671)
  confere('sem repeticao', new Set(data.map((l) => l.id)).size === 1672)
}

{
  // Servidor com limite MENOR que a pagina: parar na primeira pagina "curta"
  // cortaria aqui. Tem que seguir ate vir vazio.
  const s = servidor(1200, 500)
  const { data } = await buscarTodas(s.pedir, 500)
  confere('limite do servidor menor que a pagina nao corta', data.length === 1200)
}

{
  const s = servidor(0)
  const { data } = await buscarTodas(s.pedir)
  confere('tabela vazia devolve lista vazia', data.length === 0)
  confere('tabela vazia gasta uma consulta so', s.chamadas() === 1)
}

{
  const s = servidor(1000)
  const { data } = await buscarTodas(s.pedir)
  confere('exatamente 1.000 nao perde nem duplica', data.length === 1000)
}

{
  let n = 0
  const pedir = async () => {
    n++
    return n === 2 ? { data: null, error: { message: 'caiu' } } : { data: [{ id: n }], error: null }
  }
  const { error } = await buscarTodas(pedir, 1)
  confere('erro no meio devolve o erro (nao finge que acabou)', error?.message === 'caiu')
}

{
  // Teto: nunca termina sozinho, tem que parar e avisar.
  const avisos = []
  const original = console.warn
  console.warn = (m) => avisos.push(m)
  const pedir = async () => ({ data: [{ id: 1 }], error: null })
  const { data } = await buscarTodas(pedir, 1)
  console.warn = original
  confere('para no teto de paginas', data.length === MAXIMO_DE_PAGINAS)
  confere('e avisa que parou', avisos.length === 1 && /NAO foi carregado/.test(avisos[0]))
}

console.log(`paginar: ${ok} verificacoes ok, ${falhas} falha(s)`)
if (falhas) process.exit(1)
