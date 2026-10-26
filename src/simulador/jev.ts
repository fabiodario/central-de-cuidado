import { supabase } from '@/lib/supabase'
import type { Leitura } from '../../supabase/functions/_shared/segunda-leitura.ts'
import type { LeituraDoCaminho } from '../../supabase/functions/_shared/caminho-pelo-jev.ts'
import type { LeitorDoCaminho, LeitorDoJev } from './sessao'

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

/**
 * O caminho pelo Jev no simulador do sistema (26/10/2026, ver
 * _shared/caminho-pelo-jev.ts): a mesma funcao jev-ler, com acao 'caminho'.
 * Nunca lanca, como o de cima.
 */
export const perguntarOCaminhoAoJev: LeitorDoCaminho = async (entrada) => {
  try {
    const { data, error } = await supabase.functions.invoke('jev-ler', { body: { acao: 'caminho', ...entrada } })
    if (error) return { modo: null, leitura: { ok: false, erro: error.message } }
    const modo = (data as { modo?: unknown } | null)?.modo
    if (modo !== 'desligada' && modo !== 'sombra' && modo !== 'ligada') {
      return { modo: null, leitura: { ok: false, erro: 'resposta estranha do servidor' } }
    }
    return { modo, leitura: ((data as { leitura?: LeituraDoCaminho | null }).leitura ?? null) }
  } catch (erro) {
    return { modo: null, leitura: { ok: false, erro: erro instanceof Error ? erro.message : String(erro) } }
  }
}
