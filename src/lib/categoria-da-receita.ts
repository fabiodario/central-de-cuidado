/**
 * Em que categoria cai cada documento emitido pela Memed.
 *
 * Pedido em 23/09/2026: a lista de "Receitas emitidas" misturava hemograma,
 * probiotico, atestado e diazepam no mesmo azul. A Memed ja diz o que cada item
 * e, em dois campos que o memed-receita guarda:
 *
 *  - tipo: 'alopático', 'manipulado', 'dermocosmético', 'white-label',
 *    'exame' ou 'custom' (texto livre: atestado, relatorio, declaracao).
 *  - receituario: 'Simples', ou o talao especial - 'Antibióticos-2 vias',
 *    'Especial-2 vias (C1)', 'Notif. receita B (B1)' e parecidos.
 *
 * Receita especial vem primeiro de proposito: e a que tem regra (validade,
 * retencao na farmacia, notificacao) e a que a recepcao mais precisa achar
 * quando a familia liga dizendo que a farmacia recusou.
 */

export type CategoriaDaReceita = 'especial' | 'medicacao' | 'exame' | 'documento'

export interface ItemCategorizavel {
  tipo?: string | null
  receituario?: string | null
}

function sem(texto: string | null | undefined) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

export function categoriaDaReceita(itens: ItemCategorizavel[]): CategoriaDaReceita {
  if (itens.length === 0) return 'medicacao'
  // Qualquer item em talao especial torna o documento especial.
  if (itens.some((item) => sem(item.receituario) && sem(item.receituario) !== 'simples')) return 'especial'
  if (itens.every((item) => sem(item.tipo) === 'exame')) return 'exame'
  if (itens.every((item) => sem(item.tipo) === 'custom')) return 'documento'
  return 'medicacao'
}

/** Ordem em que as categorias aparecem na tela. */
export const ORDEM_DAS_CATEGORIAS: CategoriaDaReceita[] = ['especial', 'medicacao', 'exame', 'documento']
