/**
 * Retorno marcado a partir do prontuario (25/09/2026).
 *
 * O medico escreve "Retorno em 30 dias" no campo Retorno e, ate aqui, era so
 * isso: um texto. Marcar de fato dependia de a familia ligar depois, ou do
 * acompanhamento automatico lembrar. Aqui o prazo escrito vira sugestao de
 * data, e a tela oferece os horarios livres perto dela.
 */

export const PRAZOS_DE_RETORNO = [
  { dias: 15, rotulo: '15 dias' },
  { dias: 30, rotulo: '30 dias' },
  { dias: 60, rotulo: '2 meses' },
  { dias: 90, rotulo: '3 meses' },
  { dias: 180, rotulo: '6 meses' },
] as const

function normalizar(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
}

const POR_EXTENSO: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6,
  sete: 7, oito: 8, nove: 9, dez: 10, doze: 12, quinze: 15, vinte: 20, trinta: 30,
}

/**
 * O prazo, em dias, escrito no campo Retorno. "30 dias", "1 mes", "3 meses",
 * "6 semanas", "1 ano", "tres meses". Nada reconhecivel -> null (a tela
 * pergunta, em vez de adivinhar).
 */
export function prazoDoRetorno(texto: string | null | undefined): number | null {
  const t = normalizar(String(texto ?? ''))
  const achado = t.match(
    /(\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|doze|quinze|vinte|trinta)\s*(dias?|d\b|semanas?|sem\b|mes(es)?|m\b|anos?)/,
  )
  if (!achado) return null
  const quantidade = /^\d+$/.test(achado[1]) ? Number(achado[1]) : POR_EXTENSO[achado[1]]
  if (!quantidade || quantidade <= 0) return null
  const unidade = achado[2]
  let dias: number
  if (unidade.startsWith('d')) dias = quantidade
  else if (unidade.startsWith('sem')) dias = quantidade * 7
  else if (unidade.startsWith('m')) dias = quantidade * 30
  else dias = quantidade * 365
  // Retorno em mais de dois anos nao e retorno: e erro de digitacao.
  return dias >= 1 && dias <= 730 ? dias : null
}

/** YYYY-MM-DD + dias, sem fuso no meio (meio-dia UTC nao vira outro dia). */
export function somarDias(iso: string, dias: number): string {
  const data = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  data.setUTCDate(data.getUTCDate() + dias)
  return data.toISOString().slice(0, 10)
}

/**
 * Onde procurar horario: alguns dias antes do alvo (retorno um pouco antes nao
 * atrapalha) e mais dias depois (a agenda perto da data pode estar cheia).
 */
export function janelaDoRetorno(alvo: string, hoje: string): { de: string; ate: string } {
  const antes = somarDias(alvo, -3)
  const de = antes < hoje ? hoje : antes
  return { de, ate: somarDias(alvo, 10) }
}

/** Horarios agrupados por dia, na ordem, para a tela. */
export function agruparPorDia(horarios: string[], fuso = 'America/Sao_Paulo'): { dia: string; horarios: string[] }[] {
  const formatoDoDia = new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' })
  const grupos = new Map<string, string[]>()
  for (const inicio of [...horarios].sort()) {
    const dia = formatoDoDia.format(new Date(inicio))
    const lista = grupos.get(dia)
    if (lista) lista.push(inicio)
    else grupos.set(dia, [inicio])
  }
  return [...grupos.entries()].map(([dia, lista]) => ({ dia, horarios: lista }))
}
