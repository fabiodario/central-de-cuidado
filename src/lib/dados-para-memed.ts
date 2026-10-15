/**
 * Alergias, peso e altura que acompanham o paciente ate a Memed (24/09/2026).
 *
 * Ate aqui ia so o que estava escrito NA consulta aberta. Dois furos:
 *
 *  - alergia e do paciente, nao da consulta. Escrita uma vez, no primeiro
 *    atendimento, ela nao era repetida nos retornos - e no retorno a Memed
 *    abria sem alergia nenhuma;
 *  - o medico que abre a receita antes de pesar a crianca mandava peso vazio.
 *
 * Por isso: se a consulta atual nao tem, vale a mais recente que tem. Com
 * limite de idade para peso e altura, porque crianca cresce - um peso de tres
 * meses atras numa receita de hoje e informacao errada, nao informacao velha.
 * Alergia nao tem limite: nao prescreve.
 *
 * A tela mostra de onde veio cada dado ("peso de 12/09"), para o medico nunca
 * ser surpreendido por um numero que ele nao digitou hoje.
 */

export type ConsultaComDados = {
  id: string
  data: string // YYYY-MM-DD
  peso: string
  altura: string
  alergias: string
}

/** Peso so vale ate 30 dias; altura muda mais devagar, 90. */
export const DIAS_DO_PESO = 30
export const DIAS_DA_ALTURA = 90

export type DadoComOrigem = { valor: string; data: string | null; daConsultaAtual: boolean }

export type DadosParaMemed = {
  alergias: DadoComOrigem | null
  peso: DadoComOrigem | null
  altura: DadoComOrigem | null
}

function temConteudo(texto: string | null | undefined) {
  return String(texto ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim().length > 0
}

function diasEntre(deIso: string, ateIso: string) {
  const de = Date.parse(`${deIso.slice(0, 10)}T12:00:00Z`)
  const ate = Date.parse(`${ateIso.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(de) || Number.isNaN(ate)) return Infinity
  return Math.round((ate - de) / 86_400_000)
}

function procurar(
  campo: 'alergias' | 'peso' | 'altura',
  atual: ConsultaComDados | null,
  todas: ConsultaComDados[],
  hoje: string,
  limiteEmDias: number | null,
): DadoComOrigem | null {
  if (atual && temConteudo(atual[campo])) {
    return { valor: atual[campo], data: atual.data || null, daConsultaAtual: true }
  }
  // Mais recente primeiro, sem confiar na ordem em que a lista chegou. So
  // consultas ate hoje: uma consulta futura rascunhada nao e historico.
  const anteriores = todas
    .filter((c) => c.id !== atual?.id && c.data && c.data.slice(0, 10) <= hoje.slice(0, 10))
    .sort((a, b) => b.data.localeCompare(a.data))
  for (const consulta of anteriores) {
    if (!temConteudo(consulta[campo])) continue
    if (limiteEmDias !== null && diasEntre(consulta.data, hoje) > limiteEmDias) return null
    return { valor: consulta[campo], data: consulta.data, daConsultaAtual: false }
  }
  return null
}

/** Data de hoje no fuso da clinica, YYYY-MM-DD. */
export function hojeEmSaoPaulo(agora = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(agora)
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? ''
  return `${valor('year')}-${valor('month')}-${valor('day')}`
}

function diaMes(iso: string | null) {
  if (!iso) return ''
  const [, mes, dia] = iso.slice(0, 10).split('-')
  return `${dia}/${mes}`
}

/** O mesmo formato que memed.ts devolve (repetido aqui para testar sem Supabase). */
export type ResultadoDasAlergias = {
  semAlergia: boolean
  reconhecidas: { termo: string; id: number; nome: string }[]
  naoReconhecidas: string[]
  falhas: string[]
  falhou?: boolean
}

export type AvisoParaMedico = { tipo: 'ok' | 'erro' | 'info'; texto: string }

/**
 * Uma frase para o medico sobre o que foi para a Memed alem do cadastro.
 *
 * Vermelho quando o alerta de alergia NAO esta ligado apesar de haver alergia
 * escrita (busca falhou, comando recusado). Amarelo quando algo pede um olhar:
 * alergia que nao existe na lista de remedios, dado que veio de consulta
 * anterior. Nada, quando nao ha nada a dizer.
 */
export function avisoDoQueFoiParaMemed(
  dados: DadosParaMemed,
  alergias: ResultadoDasAlergias,
  alergiasEnviadas: boolean | null,
): AvisoParaMedico | null {
  const frases: string[] = []
  let tipo: AvisoParaMedico['tipo'] = 'info'

  const origemDaAlergia =
    dados.alergias && !dados.alergias.daConsultaAtual ? ` (anotadas na consulta de ${diaMes(dados.alergias.data)})` : ''
  const nomes = [...new Set(alergias.reconhecidas.map((a) => a.nome))]

  if (alergias.falhou || (alergias.falhas.length && !nomes.length)) {
    tipo = 'erro'
    frases.push(
      'Não consegui conferir as alergias na Memed agora: o alerta de alergia NÃO está ligado nesta receita. Confira o prontuário antes de prescrever.',
    )
  } else if (nomes.length && alergiasEnviadas === false) {
    tipo = 'erro'
    frases.push(
      `A Memed recusou as alergias (${nomes.join(', ')}): o alerta NÃO está ligado nesta receita.`,
    )
  } else if (nomes.length) {
    frases.push(`Alerta de alergia ligado na Memed: ${nomes.join(', ')}${origemDaAlergia}.`)
  }

  if (alergias.falhas.length && nomes.length) {
    tipo = 'erro'
    frases.push(`Não consegui conferir: ${alergias.falhas.join(', ')} (sem alerta para essas).`)
  }
  if (alergias.naoReconhecidas.length) {
    frases.push(
      `Não está na lista de remédios da Memed: ${alergias.naoReconhecidas.join(', ')}. Se for remédio, cadastre a alergia direto na Memed.`,
    )
  }

  if (dados.peso && !dados.peso.daConsultaAtual) {
    frases.push(`Peso enviado: ${dados.peso.valor.replace(/\s*kg\s*$/i, '')} kg, da consulta de ${diaMes(dados.peso.data)}.`)
  }

  if (!frases.length) return null
  return { tipo, texto: frases.join(' ') }
}

export function dadosParaMemed(
  atual: ConsultaComDados | null,
  todas: ConsultaComDados[],
  hoje: string,
): DadosParaMemed {
  return {
    alergias: procurar('alergias', atual, todas, hoje, null),
    peso: procurar('peso', atual, todas, hoje, DIAS_DO_PESO),
    altura: procurar('altura', atual, todas, hoje, DIAS_DA_ALTURA),
  }
}
