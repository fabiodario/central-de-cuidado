/**
 * Reserva sem cadastro: lembrete e cancelamento (01/10/2026).
 *
 * O caso: a familia marca pelo robo e para no meio da ficha - sem o nome da
 * crianca. A reserva fica segurando o horario e a recepcao so descobre na
 * vespera. Nos 30 dias ate 01/10, 9 reservas ficaram assim; a equipe cancelou
 * 8 a mao.
 *
 * A regra combinada com o Edu:
 *
 *   - 6h depois da ultima mensagem da familia, um lembrete pedindo o que
 *     falta (empurrado para o horario comercial, 8h-21h);
 *   - 23h depois, sem o cadastro, a reserva e cancelada e a familia avisada.
 *
 * Por que 23h e nao mais: texto livre no WhatsApp so sai dentro de 24h da
 * ultima mensagem DA FAMILIA (nossa mensagem nao renova nada). As duas cabem
 * nessa janela e saem de graca. Se a familia responder qualquer coisa, a
 * janela renova e o relogio recomeca.
 *
 * Cancelar sozinho so quando e seguro. Nao cancela - chama a equipe - quando:
 *   - a consulta e antes de o prazo vencer (o horario perdido nao seria
 *     reaproveitado, e a familia pode estar a caminho);
 *   - o lembrete nunca saiu (cancelar sem avisar antes seria injusto);
 *   - a janela ja fechou (o aviso de cancelamento nao teria como sair).
 *
 * Regra pura, sem banco e sem relogio proprio, para o teste cobrir
 * (tests/ficha-pendente.test.mjs).
 */

export type Decisao = 'esperar' | 'lembrar' | 'cancelar' | 'chamar_equipe'

export type SituacaoDaReserva = {
  /** Agora, em ms. */
  agora: number
  /** Ultima mensagem DA FAMILIA na conversa (ISO). */
  ultimaDaFamilia: string
  /** Quando o lembrete saiu, se saiu (ISO). */
  lembreteEm: string | null
  /** Inicio da consulta (ISO). */
  inicioDaConsulta: string
  /** Fuso da clinica, para o horario comercial. */
  fuso: string
  horasAteLembrete?: number
  horasAteCancelar?: number
}

const HORA = 60 * 60 * 1000
/** Margem antes de a janela fechar: depois disso, nao se manda mais nada. */
const MARGEM_DA_JANELA = 30 * 60 * 1000
/** O lembrete precisa deixar pelo menos isto para a familia responder. */
const TEMPO_MINIMO_PARA_RESPONDER = 2 * HORA
/** Consulta a menos disto do prazo: nao cancela, chama a equipe. */
const FOLGA_DA_CONSULTA = 2 * HORA

const ABRE = 8 // 8h
const FECHA = 21 // ate 20h59

function horaLocal(ms: number, fuso: string): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: fuso, hour: 'numeric', hourCycle: 'h23' }).format(new Date(ms)),
  )
}

function comercial(ms: number, fuso: string): boolean {
  const h = horaLocal(ms, fuso)
  return h >= ABRE && h < FECHA
}

/** Primeiro instante em horario comercial a partir de ms (de 15 em 15 min). */
function paraFrente(ms: number, fuso: string): number {
  let t = ms
  for (let i = 0; i < 4 * 24 && !comercial(t, fuso); i++) t += 15 * 60 * 1000
  return t
}

/** Ultimo instante em horario comercial ate ms (de 15 em 15 min). */
function paraTras(ms: number, fuso: string): number {
  let t = ms
  for (let i = 0; i < 4 * 24 && !comercial(t, fuso); i++) t -= 15 * 60 * 1000
  return t
}

export function horarios(s: SituacaoDaReserva) {
  const base = new Date(s.ultimaDaFamilia).getTime()
  const fechaJanela = base + 24 * HORA

  // Cancelamento: 23h, ou antes se cair de madrugada (adiantar pode; atrasar
  // sairia da janela).
  let cancelar = base + (s.horasAteCancelar ?? 23) * HORA
  if (!comercial(cancelar, s.fuso)) cancelar = paraTras(cancelar, s.fuso)

  // Lembrete: 6h, empurrado para o horario comercial - mas sempre deixando
  // tempo para responder antes do cancelamento.
  let lembrar = paraFrente(base + (s.horasAteLembrete ?? 6) * HORA, s.fuso)
  if (lembrar > cancelar - TEMPO_MINIMO_PARA_RESPONDER) {
    lembrar = paraTras(cancelar - TEMPO_MINIMO_PARA_RESPONDER, s.fuso)
  }
  // Nunca antes de a familia ter escrito, e nunca antes do previsto em horas
  // corridas quando o horario comercial empurrou para tras demais.
  if (lembrar < base) lembrar = base

  return { lembrar, cancelar, fechaJanela }
}

export function decidir(s: SituacaoDaReserva): Decisao {
  const { lembrar, cancelar, fechaJanela } = horarios(s)
  const inicio = new Date(s.inicioDaConsulta).getTime()
  const janelaAberta = s.agora < fechaJanela - MARGEM_DA_JANELA

  if (s.agora < lembrar) return 'esperar'

  if (!s.lembreteEm) {
    // Hora do lembrete. Com a janela fechada nao da para mandar texto: quem
    // resolve e a equipe, por telefone.
    if (!janelaAberta) return 'chamar_equipe'
    // Passou ate do prazo de cancelar sem lembrete (sistema fora do ar):
    // nao cancela sem ter avisado antes.
    if (s.agora >= cancelar) return 'chamar_equipe'
    return 'lembrar'
  }

  if (s.agora < cancelar) return 'esperar'

  if (!janelaAberta) return 'chamar_equipe'
  if (inicio <= cancelar + FOLGA_DA_CONSULTA) return 'chamar_equipe'
  return 'cancelar'
}
