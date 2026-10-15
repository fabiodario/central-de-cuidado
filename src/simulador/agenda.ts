/**
 * A agenda do simulador: o que a aba "Agenda" edita e o robo le.
 *
 * Mesmo modelo do sistema (migration 20260824000000_agenda.sql): unidades,
 * periodos semanais (availability_rules), excecoes por data
 * (schedule_exceptions, fechado ou horario extra) e as preferencias da agenda
 * em clinic_settings. A configuracao vira linhas dessas tabelas no banco
 * falso, e o robo de producao as le do jeito de sempre.
 *
 * horariosLivres e o available_slots do banco
 * (20261003150000_agenda_propria_da_telemedicina.sql) reescrito em TypeScript.
 * Se a funcao do banco mudar a regra, esta precisa mudar junto - senao a
 * demonstracao oferece horarios que a clinica de verdade nao ofereceria.
 */
import type { Linha } from './banco-falso'

export type Periodo = { id: string; weekday: number; inicio: string; fim: string }

export type UnidadeDaAgenda = {
  id: string
  nome: string
  endereco: string
  /** O texto da opcao 1 do menu: valor, endereco, o que levar. Pode ter {valor}. */
  informacoes: string
  /**
   * Valor da consulta em centavos (clinic_units.price_cents, 14/10/2026).
   * Opcional: agenda salva no navegador antes disso nao tem, e fica sem valor.
   */
  valor?: number | null
  /** Convenio aceito; vazio = so particular, e o robo nao pergunta. */
  convenio: string
  /** A agenda da telemedicina (no maximo uma), como no sistema desde 03/10/2026. */
  telemedicina: boolean
  periodos: Periodo[]
}

/** unidadeId nulo = todas as unidades, como em schedule_exceptions. */
export type DataExtra = { id: string; data: string; inicio: string; fim: string; unidadeId: string | null }
export type Bloqueio = { id: string; data: string; motivo: string; unidadeId: string | null }

export type AgendaDaClinica = {
  versao: 1
  unidades: UnidadeDaAgenda[]
  datasExtras: DataExtra[]
  bloqueios: Bloqueio[]
  preferencias: {
    /** schedule_slot_minutes */
    duracao: number
    /** schedule_horizon_days */
    janela: number
    /** schedule_min_notice_hours */
    antecedencia: number
  }
  telemedicinaAtiva: boolean
  /** clinic_settings.telemedicine_price_cents (14/10/2026). */
  telemedicinaValor?: number | null
}

export const DIAS_DA_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']

/** Brasil sem horario de verao desde 2019: Brasilia e sempre UTC-3. */
export function emBrasilia(dia: string, hora: string): Date {
  return new Date(`${dia}T${hora.slice(0, 5)}:00-03:00`)
}

export function diaDeBrasilia(d: Date): string {
  return new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}

export function somarDias(dia: string, n: number): string {
  return new Date(Date.parse(`${dia}T12:00:00Z`) + n * 24 * 3600 * 1000).toISOString().slice(0, 10)
}

/**
 * As linhas das tabelas do banco que esta agenda representa.
 *
 * Texto da unidade vazio fica vazio, como no banco: o robo manda so o texto
 * geral. Ate 14/10/2026 aqui entrava um texto com nome e endereco, e a
 * demonstracao respondia diferente da clinica de teste que ela espelha.
 */
export function tabelasDaAgenda(agenda: AgendaDaClinica, clinicId: string) {
  return {
    clinic_units: agenda.unidades.map((u) => ({
      id: u.id,
      clinic_id: clinicId,
      name: u.nome,
      address: u.endereco,
      info_text: u.informacoes,
      price_cents: u.valor ?? null,
      accepts_insurance: u.convenio.trim() || null,
      telemedicina: u.telemedicina,
      archived_at: null,
    })),
    availability_rules: agenda.unidades.flatMap((u) =>
      u.periodos.map((p) => ({
        id: p.id,
        clinic_id: clinicId,
        unit_id: u.id,
        weekday: p.weekday,
        starts_at: p.inicio,
        ends_at: p.fim,
      })),
    ),
    schedule_exceptions: [
      ...agenda.bloqueios.map((b) => ({
        id: b.id,
        clinic_id: clinicId,
        unit_id: b.unidadeId,
        exception_date: b.data,
        is_closed: true,
        starts_at: null,
        ends_at: null,
        reason: b.motivo,
      })),
      ...agenda.datasExtras.map((e) => ({
        id: e.id,
        clinic_id: clinicId,
        unit_id: e.unidadeId,
        exception_date: e.data,
        is_closed: false,
        starts_at: e.inicio,
        ends_at: e.fim,
        reason: '',
      })),
    ],
    configuracoes: {
      telemedicine_enabled: agenda.telemedicinaAtiva,
      telemedicine_price_cents: agenda.telemedicinaValor ?? null,
      schedule_slot_minutes: agenda.preferencias.duracao,
      schedule_horizon_days: agenda.preferencias.janela,
      schedule_min_notice_hours: agenda.preferencias.antecedencia,
    },
  }
}

export type TabelasDaAgenda = {
  clinic_units: Linha[]
  availability_rules: Linha[]
  schedule_exceptions: Linha[]
  clinic_settings: Linha[]
  appointments: Linha[]
}

/** O coalesce do banco: nulo vira o padrao, zero continua zero. */
function numero(valor: unknown, padrao: number): number {
  const n = Number(valor)
  return valor === null || valor === undefined || !Number.isFinite(n) ? padrao : n
}

/**
 * Horarios livres de uma unidade, no formato de available_slots. A ordem dos
 * passos e a da funcao do banco: dias da janela, dias fechados, periodos
 * (semanais fora dos dias fechados, mais os horarios extras), horarios do
 * tamanho da consulta, antecedencia minima e consultas que ocupam o medico.
 */
export function horariosLivres(
  t: TabelasDaAgenda,
  unidadeId: string,
  agora: Date,
  /** available_slots_periodo (14/10/2026): sem periodo, a agenda aberta. */
  periodo?: { de?: string | null; ate?: string | null },
): { slot_start: string; slot_end: string }[] {
  const unidade = t.clinic_units.find((u) => u.id === unidadeId && !u.archived_at)
  if (!unidade) return []
  const clinicId = unidade.clinic_id
  const cfg = t.clinic_settings.find((s) => s.clinic_id === clinicId) ?? {}
  const minutos = numero(cfg.schedule_slot_minutes, 40)
  const janela = numero(cfg.schedule_horizon_days, 15)
  const antecedencia = numero(cfg.schedule_min_notice_hours, 2)
  if (minutos <= 0) return []
  const passo = minutos * 60 * 1000
  const minimo = agora.getTime() + antecedencia * 3600 * 1000

  // O medico e um so: a agenda de video para quando ha consulta em qualquer
  // unidade, e as fisicas param quando ha video.
  const eTele = Boolean(unidade.telemedicina)
  const daTele = new Set(t.clinic_units.filter((u) => u.telemedicina).map((u) => u.id))
  const ocupadas = t.appointments
    .filter(
      (a) =>
        a.status !== 'cancelled' &&
        (!a.hold_expires_at || new Date(String(a.hold_expires_at)).getTime() > agora.getTime()) &&
        (a.unit_id === unidadeId || (a.clinic_id === clinicId && (eTele || daTele.has(a.unit_id)))),
    )
    .map((a) => [new Date(String(a.starts_at)).getTime(), new Date(String(a.ends_at ?? a.starts_at)).getTime()])

  // As pontas de available_slots_periodo: nunca antes de hoje, nunca alem de
  // 180 dias, e sem "ate" a janela da clinica a partir do primeiro dia.
  const hoje = diaDeBrasilia(agora)
  const primeiro = periodo?.de && periodo.de > hoje ? periodo.de : hoje
  const pedidoAte = periodo?.ate ?? somarDias(primeiro, janela)
  const teto = somarDias(hoje, 180)
  const ultimo = pedidoAte < teto ? pedidoAte : teto
  const porInicio = new Map<number, { slot_start: string; slot_end: string }>()
  for (let dia = primeiro; dia <= ultimo; dia = somarDias(dia, 1)) {
    const diaDaSemana = new Date(`${dia}T12:00:00Z`).getUTCDay()
    const excecoes = t.schedule_exceptions.filter(
      (e) => e.exception_date === dia && e.clinic_id === clinicId && (e.unit_id == null || e.unit_id === unidadeId),
    )
    const fechado = excecoes.some((e) => e.is_closed)
    const periodos = [
      ...(fechado ? [] : t.availability_rules.filter((r) => r.unit_id === unidadeId && Number(r.weekday) === diaDaSemana)),
      ...excecoes.filter((e) => !e.is_closed),
    ]
    for (const p of periodos) {
      const fim = emBrasilia(dia, String(p.ends_at)).getTime()
      for (let inicio = emBrasilia(dia, String(p.starts_at)).getTime(); inicio + passo <= fim; inicio += passo) {
        if (inicio < minimo) continue
        if (ocupadas.some(([a, b]) => a < inicio + passo && b > inicio)) continue
        porInicio.set(inicio, { slot_start: new Date(inicio).toISOString(), slot_end: new Date(inicio + passo).toISOString() })
      }
    }
  }
  return [...porInicio.entries()].sort((a, b) => a[0] - b[0]).map(([, h]) => h)
}

/** Copia funda, para a tela editar sem mexer na agenda padrao da identidade. */
export function copiarAgenda(agenda: AgendaDaClinica): AgendaDaClinica {
  return JSON.parse(JSON.stringify(agenda)) as AgendaDaClinica
}

/** Agenda salva neste navegador tem de ter a forma de hoje; senao, padrao. */
export function agendaValida(valor: unknown): valor is AgendaDaClinica {
  const a = valor as AgendaDaClinica | null
  return Boolean(
    a &&
      a.versao === 1 &&
      Array.isArray(a.unidades) &&
      a.unidades.every((u) => typeof u.id === 'string' && typeof u.nome === 'string' && Array.isArray(u.periodos)) &&
      Array.isArray(a.datasExtras) &&
      Array.isArray(a.bloqueios) &&
      a.preferencias &&
      typeof a.preferencias.duracao === 'number',
  )
}
