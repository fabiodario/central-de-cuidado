import type { Publico } from './publico'

/** Uma barra do grafico: de `de` a `ate` anos completos, inclusive. Sem `ate`, "e mais". */
export type FaixaEtaria = { rotulo: string; de: number; ate: number | null }

/**
 * As faixas do grafico "Faixa etaria" da Visao geral, pelo perfil (15/10/2026).
 *
 * As de origem sao da gastropediatria do Dr. Marcello: quatro faixas ate os 13
 * anos e um "14+" para o resto. No otorrino a maioria e adulta, e o grafico
 * mostraria quase todo mundo na ultima barra. No perfil 'geral' as criancas
 * ficam em tres faixas (ate 5, escolar, adolescente) e os adultos ganham as
 * deles.
 */
export function faixasEtarias(publico: Publico): FaixaEtaria[] {
  if (publico === 'geral') {
    return [
      { rotulo: '0 a 5 anos', de: 0, ate: 5 },
      { rotulo: '6 a 12 anos', de: 6, ate: 12 },
      { rotulo: '13 a 17 anos', de: 13, ate: 17 },
      { rotulo: '18 a 39 anos', de: 18, ate: 39 },
      { rotulo: '40 a 59 anos', de: 40, ate: 59 },
      { rotulo: '60+ anos', de: 60, ate: null },
    ]
  }
  return [
    { rotulo: '0 a 2 anos', de: 0, ate: 2 },
    { rotulo: '3 a 5 anos', de: 3, ate: 5 },
    { rotulo: '6 a 9 anos', de: 6, ate: 9 },
    { rotulo: '10 a 13 anos', de: 10, ate: 13 },
    { rotulo: '14+ anos', de: 14, ate: null },
  ]
}

/**
 * Quantos pacientes caem em cada faixa.
 *
 * Idade desconhecida (nascimento em branco) fica fora de todas. Ate 15/10/2026
 * ela contava como 0 anos e engordava a primeira barra; no otorrino, o adulto
 * cadastrado sem data aparecia como bebe.
 */
export function contarPorFaixa(
  idades: (number | null)[],
  faixas: FaixaEtaria[],
): { rotulo: string; valor: number }[] {
  return faixas.map((faixa) => ({
    rotulo: faixa.rotulo,
    valor: idades.filter((idade) => idade !== null && idade >= faixa.de && (faixa.ate === null || idade <= faixa.ate))
      .length,
  }))
}
