/**
 * Horario de atendimento da equipe, e a frase que o robo diz sobre ele.
 *
 * Ate 24/09/2026 "Atendemos de segunda a sexta, das 8h as 18h. Fora desse
 * horario, respondemos no proximo dia util" estava copiado em seis lugares, e
 * saia igual as 10h de uma terca e as 23h de um sabado. De noite a familia
 * ficava sem saber se a resposta vinha em minutos ou na segunda-feira.
 *
 * Agora o horario mora aqui, uma vez so, e fora dele a frase diz QUANDO a
 * equipe volta: "hoje, a partir das 8h", "amanha", "na segunda-feira".
 *
 * Feriado entra na conta desde 25/09/2026. As 10h de 12 de outubro (uma
 * segunda) o robo dizia "Atendemos de segunda a sexta" - como se houvesse
 * alguem ali - e a familia esperava resposta num dia sem ninguem. A lista e a
 * mesma que a Agenda ja bloqueia (migration feriados_nacionais): nacionais,
 * Sexta-feira Santa, Corpus Christi e os pontos facultativos de Carnaval e
 * Cinzas, calculados a partir da Pascoa para qualquer ano. Feriado municipal
 * nao entra: nao ha lista segura dos tres municipios, e inventar data e pior.
 */

export const EXPEDIENTE = {
  /** 0 = domingo ... 6 = sabado. */
  dias: [1, 2, 3, 4, 5],
  inicio: 8,
  fim: 18,
  fuso: 'America/Sao_Paulo',
  texto: 'segunda a sexta, das 8h às 18h',
}

const NOME_DO_DIA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']
const DIA_DA_SEMANA: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** Domingo de Pascoa (algoritmo de Meeus/Jones/Butcher), em UTC. */
function pascoa(ano: number): Date {
  const a = ano % 19
  const b = Math.floor(ano / 100)
  const c = ano % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const mes = Math.floor((h + l - 7 * m + 114) / 31)
  const dia = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(ano, mes - 1, dia))
}

function iso(data: Date) {
  return data.toISOString().slice(0, 10)
}

function somar(data: Date, dias: number) {
  return new Date(data.getTime() + dias * 86_400_000)
}

/** Feriados do ano, "YYYY-MM-DD" -> nome. */
export function feriadosDoAno(ano: number): Map<string, string> {
  const p = pascoa(ano)
  const fixos: [string, string][] = [
    ['01-01', 'Confraternização Universal'],
    ['04-21', 'Tiradentes'],
    ['05-01', 'Dia do Trabalho'],
    ['09-07', 'Independência do Brasil'],
    ['10-12', 'Nossa Senhora Aparecida'],
    ['11-02', 'Finados'],
    ['11-15', 'Proclamação da República'],
    ['11-20', 'Consciência Negra'],
    ['12-25', 'Natal'],
  ]
  const mapa = new Map<string, string>(fixos.map(([md, nome]) => [`${ano}-${md}`, nome]))
  mapa.set(iso(somar(p, -48)), 'Carnaval')
  mapa.set(iso(somar(p, -47)), 'Carnaval')
  mapa.set(iso(somar(p, -46)), 'Quarta-feira de Cinzas')
  mapa.set(iso(somar(p, -2)), 'Sexta-feira Santa')
  mapa.set(iso(somar(p, 60)), 'Corpus Christi')
  return mapa
}

/** O nome do feriado nesta data (YYYY-MM-DD), ou null. */
export function feriado(data: string): string | null {
  const ano = Number(data.slice(0, 4))
  if (!Number.isFinite(ano)) return null
  return feriadosDoAno(ano).get(data.slice(0, 10)) ?? null
}

/** Data, dia da semana e hora no fuso da clinica, sem depender do fuso da maquina. */
function relogioDaClinica(agora: Date) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: EXPEDIENTE.fuso,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(agora)
  const pega = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? ''
  return {
    data: `${pega('year')}-${pega('month')}-${pega('day')}`,
    dia: DIA_DA_SEMANA[pega('weekday')] ?? 1,
    hora: Number(pega('hour')) + Number(pega('minute')) / 60,
  }
}

function diaDeAtendimento(data: string, diaDaSemana: number) {
  return EXPEDIENTE.dias.includes(diaDaSemana) && !feriado(data)
}

export function dentroDoExpediente(agora: Date = new Date()): boolean {
  const { data, dia, hora } = relogioDaClinica(agora)
  return diaDeAtendimento(data, dia) && hora >= EXPEDIENTE.inicio && hora < EXPEDIENTE.fim
}

/** "hoje, a partir das 8h" / "amanhã, a partir das 8h" / "na segunda-feira, a partir das 8h". */
export function quandoAEquipeVolta(agora: Date = new Date()): string {
  const { data, dia, hora } = relogioDaClinica(agora)
  const aPartir = `a partir das ${EXPEDIENTE.inicio}h`
  if (diaDeAtendimento(data, dia) && hora < EXPEDIENTE.inicio) return `hoje, ${aPartir}`
  const hoje = new Date(`${data}T12:00:00Z`)
  // Ate 14 dias: Carnaval colado no fim de semana ainda cabe com folga.
  for (let passo = 1; passo <= 14; passo++) {
    const proximo = somar(hoje, passo)
    const diaDaSemana = proximo.getUTCDay()
    if (!diaDeAtendimento(iso(proximo), diaDaSemana)) continue
    if (passo === 1) return `amanhã, ${aPartir}`
    // Mais de uma semana adiante, o dia da semana sozinho confunde: vai a data.
    if (passo > 6) return `em ${iso(proximo).slice(8, 10)}/${iso(proximo).slice(5, 7)}, ${aPartir}`
    return `na ${NOME_DO_DIA[diaDaSemana]}, ${aPartir}`
  }
  return aPartir
}

/**
 * A frase que acompanha "ja avisei a equipe". No horario, so informa o
 * expediente; fora dele, diz quando a resposta vem. Em feriado, diz que e
 * feriado - "fora do horario" numa segunda as 10h pareceria erro.
 */
export function avisoDeHorario(agora: Date = new Date()): string {
  if (dentroDoExpediente(agora)) return `Atendemos de ${EXPEDIENTE.texto}.`
  const { data, dia } = relogioDaClinica(agora)
  const nomeDoFeriado = EXPEDIENTE.dias.includes(dia) ? feriado(data) : null
  if (nomeDoFeriado) {
    return (
      `Hoje é feriado (${nomeDoFeriado}) e a equipe não está atendendo. ` +
      `Alguém responde ${quandoAEquipeVolta(agora)}.`
    )
  }
  return (
    `Agora estamos fora do horário de atendimento (${EXPEDIENTE.texto}). ` +
    `Alguém da equipe responde ${quandoAEquipeVolta(agora)}.`
  )
}
