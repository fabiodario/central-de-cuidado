/**
 * Quem recebe o aviso da mudanca de Santos, e com que data e hora.
 *
 * A parte pura do envio unico de 26/09/2026 (ver aviso-mudanca-santos), fora
 * da funcao para poder ser testada sem Meta e sem banco. O aviso usa o modelo
 * mudanca_santos_livance, aprovado como Utilidade porque fala da consulta que
 * a familia JA tem - por isso so vai para quem tem consulta marcada.
 */

export const MODELO_DO_AVISO = 'mudanca_santos_livance'

/** 01/10/2026 00:00 em Sao Paulo: a primeira consulta que ja e na Livance. */
export const VIRADA = '2026-10-01T03:00:00.000Z'

/** A unidade nova, pelo nome sem acento, espaco nem separador. */
export function ehLivanceSantos(nome: string | null | undefined) {
  return String(nome ?? '').replace(/[^a-zA-Z0-9]+/g, '').toLowerCase() === 'livancesantos'
}

export type ConsultaDoAviso = {
  status: string
  modality?: string | null
  confirmed_by_clinic?: boolean | null
  starts_at: string
  unidade: string | null | undefined
}

/**
 * Por que uma consulta NAO recebe o aviso, ou null se recebe.
 *
 * Telemedicina fica de fora mesmo presa a Livance: ela usa o horario da
 * unidade, mas acontece por video - mandar endereco e totem para quem nao sai
 * de casa so confunde. Solicitacao ainda nao confirmada tambem: se a equipe
 * recusar, a familia teria recebido instrucoes de chegada para nada.
 */
export function motivoParaNaoAvisar(consulta: ConsultaDoAviso): string | null {
  if (!ehLivanceSantos(consulta.unidade)) return 'outra unidade'
  if (consulta.status !== 'scheduled') return `status ${consulta.status}`
  if (consulta.modality === 'telemedicina') return 'telemedicina'
  if (consulta.confirmed_by_clinic === false) return 'solicitacao ainda nao confirmada'
  if (new Date(consulta.starts_at).getTime() < new Date(VIRADA).getTime()) return 'antes de 01/10'
  return null
}

/**
 * "sexta, 02/10" e "09:20", no fuso da clinica.
 *
 * O dia da semana vai curto porque o modelo diz "Sua consulta de {{2}} as
 * {{3}}": "sexta-feira, 02/10" pesa na frase, e "02/10" sozinho obriga a
 * familia a abrir o calendario para saber se e amanha.
 */
export function dataEHoraDoAviso(iso: string, timezone = 'America/Sao_Paulo') {
  const data = new Date(iso)
  const semana = data
    .toLocaleDateString('pt-BR', { timeZone: timezone, weekday: 'long' })
    .split('-')[0]
    .trim()
  const diaMes = data.toLocaleDateString('pt-BR', { timeZone: timezone, day: '2-digit', month: '2-digit' })
  const hora = data.toLocaleTimeString('pt-BR', { timeZone: timezone, hour: '2-digit', minute: '2-digit' })
  return { data: `${semana}, ${diaMes}`, hora }
}
