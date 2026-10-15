/** Pedaco puro das notas internas: testavel sem Supabase. Ver notas-da-conversa.ts. */

export type NotaNaLinha = { id: string; texto: string; autorNome: string; criadoEm: string }

/**
 * Mensagens e notas numa linha do tempo so, pela hora. Nota e mensagem com o
 * mesmo horario: a mensagem vem antes (a nota costuma comentar o que chegou).
 */
export function linhaDoTempo<M extends { createdAt: string }>(
  mensagens: M[],
  notas: NotaNaLinha[],
): ({ tipo: 'mensagem'; item: M } | { tipo: 'nota'; item: NotaNaLinha })[] {
  const itens = [
    ...mensagens.map((item) => ({ tipo: 'mensagem' as const, item, quando: item.createdAt, ordem: 0 })),
    ...notas.map((item) => ({ tipo: 'nota' as const, item, quando: item.criadoEm, ordem: 1 })),
  ]
  itens.sort((a, b) => Date.parse(a.quando) - Date.parse(b.quando) || a.ordem - b.ordem)
  return itens.map((i) => (i.tipo === 'mensagem' ? { tipo: 'mensagem', item: i.item } : { tipo: 'nota', item: i.item }))
}
