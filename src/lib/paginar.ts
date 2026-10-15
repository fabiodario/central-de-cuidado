/**
 * Buscar TODAS as linhas de uma consulta, pagina por pagina (24/09/2026).
 *
 * O Supabase devolve no maximo 1.000 linhas por consulta e corta o resto sem
 * erro nenhum. Em 24/09/2026 a tabela de mensagens passou de 1.000 (1.672) e
 * a lista de conversas deixou de enxergar tudo antes de 15/09: conversas
 * antigas, como a da Sueli e a do Mauro, ficaram sem nenhuma mensagem
 * carregada, pareciam "nunca respondidas" e voltavam para o topo como
 * pendentes - "abrindo sozinhas", do ponto de vista da recepcao.
 *
 * Pede de 1.000 em 1.000 ate vir uma pagina vazia. Parar na primeira pagina
 * menor que 1.000 seria mais barato, mas se o limite do servidor um dia for
 * ajustado para menos, o corte silencioso voltaria. Uma consulta a mais por
 * carga e o preco de nao depender disso.
 *
 * A consulta precisa de uma ordem estavel (com id no desempate), senao a mesma
 * linha pode cair em duas paginas e outra em nenhuma.
 */

export const TAMANHO_DA_PAGINA = 1000

// Teto de seguranca: 50 paginas = 50 mil linhas. Chegar aqui e sinal de que a
// tela precisa de outra estrategia (resumo no servidor), e isso tem que gritar.
export const MAXIMO_DE_PAGINAS = 50

type Pagina<T> = { data: T[] | null; error: unknown }

export async function buscarTodas<T>(
  pedirPagina: (de: number, ate: number) => PromiseLike<Pagina<T>>,
  tamanho = TAMANHO_DA_PAGINA,
): Promise<{ data: T[]; error: unknown }> {
  const todas: T[] = []
  for (let pagina = 0; pagina < MAXIMO_DE_PAGINAS; pagina++) {
    const de = pagina * tamanho
    const { data, error } = await pedirPagina(de, de + tamanho - 1)
    if (error) return { data: todas, error }
    const linhas = data ?? []
    if (linhas.length === 0) return { data: todas, error: null }
    todas.push(...linhas)
  }
  console.warn(
    `buscarTodas: parou no teto de ${MAXIMO_DE_PAGINAS} paginas (${todas.length} linhas). ` +
      'O que passou disso NAO foi carregado.',
  )
  return { data: todas, error: null }
}
