import { supabase } from '@/lib/supabase'
import type { Leitura } from '../../supabase/functions/_shared/segunda-leitura.ts'
import type { LeitorDoJev } from './sessao'

/**
 * O Jev no simulador de dentro do sistema (17/10/2026, pedido do Edu): pergunta
 * pela funcao jev-ler, com a sessao do sistema. A chave da TypeSafe fica no
 * servidor. Nunca lanca: falhou, devolve modo null, e o simulador mostra a
 * falha em "O que aconteceu" em vez de seguir calado.
 */
export const perguntarAoJev: LeitorDoJev = async (entrada) => {
  try {
    const { data, error } = await supabase.functions.invoke('jev-ler', { body: entrada })
    if (error) return { modo: null, leitura: { ok: false, erro: error.message } }
    const modo = (data as { modo?: unknown } | null)?.modo
    if (modo !== 'desligada' && modo !== 'sombra' && modo !== 'ligada') {
      return { modo: null, leitura: { ok: false, erro: 'resposta estranha do servidor' } }
    }
    return { modo, leitura: ((data as { leitura?: Leitura | null }).leitura ?? null) }
  } catch (erro) {
    return { modo: null, leitura: { ok: false, erro: erro instanceof Error ? erro.message : String(erro) } }
  }
}
