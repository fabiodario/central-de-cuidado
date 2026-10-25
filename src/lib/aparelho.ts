/**
 * Em que aparelho o colega esta com a Central aberta (21/10/2026).
 *
 * O Edu: "nao precisa aparecer a bolinha verde, porque a foto ja mostra que
 * esta online; tem como ficar um icone pequeno mostrando se a pessoa esta pelo
 * PC ou celular?". Cada aba conta o proprio aparelho na presenca; a mesma
 * pessoa com a Central no computador e no celular aparece com os dois.
 */
export type Aparelho = 'computador' | 'celular'

/** Celular: tela de toque como ponteiro principal, ou o navegador se diz movel. */
export function aparelhoDaTela(ambiente: { toquePrincipal: boolean; userAgent: string }): Aparelho {
  if (ambiente.toquePrincipal) return 'celular'
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ambiente.userAgent) ? 'celular' : 'computador'
}

/** Os aparelhos de todas as abas da pessoa, sem repetir, computador primeiro. */
export function aparelhosDe(entradas: readonly { aparelho?: string | null }[]): Aparelho[] {
  const tem = (a: Aparelho) => entradas.some((e) => e.aparelho === a)
  return (['computador', 'celular'] as const).filter(tem)
}

export function descreverAparelhos(aparelhos: readonly Aparelho[]): string {
  if (aparelhos.length === 2) return 'no computador e no celular'
  if (aparelhos[0] === 'celular') return 'no celular'
  if (aparelhos[0] === 'computador') return 'no computador'
  return 'online'
}
