import type { SupabaseClient } from '@supabase/supabase-js'
import { invokeWithFormData, supabase } from '@/lib/supabase'
import type {
  Consultation,
  ConsultationDraft,
  Db,
  FollowupKey,
  FollowupState,
  FollowupStatus,
  Patient,
} from '@/types/patient'
import type { PatientDraft } from '@/lib/store'
import type { Database } from '@/types/database'
import { buscarTodas } from '@/lib/paginar'
import { comNonoDigito } from '../../supabase/functions/_shared/telefone-br.ts'
import {
  consultasQueNaoAconteceram,
  diaEmSaoPaulo,
  temProntuario,
  type ConsultaDaAgenda,
  type ConsultaDoAcompanhamento,
  type HorarioDaAgenda,
} from '../../supabase/functions/_shared/consulta-aconteceu.ts'
import { pacientesAtendidos } from '@/lib/paciente-atendido'

type PatientInsert = Database['public']['Tables']['patients']['Insert']
type PatientUpdate = Database['public']['Tables']['patients']['Update']
type ConsultationInsert = Database['public']['Tables']['consultations']['Insert']
type ConsultationUpdate = Database['public']['Tables']['consultations']['Update']
type AccessRequestRow = Database['public']['Tables']['access_requests']['Row']

export type ClinicRole = Database['public']['Enums']['clinic_role']

export interface CurrentMembership {
  clinicId: string
  role: ClinicRole
}

export interface AccessRequest {
  id: string
  name: string
  email: string
  requestedAt: string
}

export const PENDING_ACCESS_MESSAGE =
  'Seu cadastro está aguardando aprovação do administrador da clínica.'

type PatientRow = {
  id: string
  clinic_id: string
  name: string
  guardian_name: string | null
  birth_date: string | null
  sex: 'F' | 'M' | 'O'
  phone: string
  // Opcionais ate a migration da prescricao rodar no banco, pelo mesmo motivo
  // das colunas de assinatura: os tipos gerados ainda nao as conhecem.
  cpf?: string | null
  email?: string | null
  city: string | null
  neighborhood: string | null
  insurance: string | null
  cid: string | null
  unit: string | null
  consultation_date: string
  notes: string | null
  created_at: string
}

type FollowupRow = {
  id: string
  patient_id: string
  followup_key: FollowupKey
  status: 'pending' | 'opened' | 'completed' | 'pendente' | 'enviado' | 'concluido'
  opened_at: string | null
  consultation_id?: string | null
  semConsulta?: boolean
}

type SettingsRow = {
  template_d15?: string
  template_d30: string
  template_m90: string
}

type ConsultationRow = {
  id: string
  clinic_id: string
  patient_id: string
  consultation_date: string
  encounter_type: 'initial' | 'return' | 'telemedicine' | 'other'
  unit: string
  weight_kg: number | null
  height_cm: number | null
  chief_complaint: string
  clinical_history: string
  personal_history: string
  family_history: string
  allergies: string
  current_medications: string
  physical_exam: string
  assessment: string
  cid: string
  plan: string
  prescription: string
  return_plan: string
  notes: string
  created_at: string
  // Opcionais porque os tipos gerados do Supabase so passam a conhece-las
  // depois que a migration da assinatura roda no banco. Ate la a consulta
  // simplesmente nao tem assinatura - que e exatamente o que o codigo assume.
  signed_at?: string | null
  signed_by_name?: string | null
  signed_pdf_path?: string | null
}

const FOLLOWUP_KEYS: FollowupKey[] = ['d15', 'd30', 'm90']

function message(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error && 'message' in error) return String(error.message)
  return 'Não foi possível acessar o banco de dados.'
}

function fail(error: unknown): never {
  throw new Error(message(error))
}

function toUiStatus(status: FollowupRow['status']): FollowupStatus {
  if (status === 'opened' || status === 'enviado') return 'enviado'
  if (status === 'completed' || status === 'concluido') return 'concluido'
  return 'pendente'
}

function toDbStatus(status: FollowupStatus) {
  if (status === 'enviado') return 'opened'
  if (status === 'concluido') return 'completed'
  return 'pending'
}

function emptyFollowups(): Record<FollowupKey, FollowupState> {
  return {
    d15: { status: 'pendente' },
    d30: { status: 'pendente' },
    m90: { status: 'pendente' },
  }
}

function mapPatient(row: PatientRow, followupRows: FollowupRow[]): Patient {
  const followups = emptyFollowups()
  for (const item of followupRows) {
    followups[item.followup_key] = {
      id: item.id,
      status: toUiStatus(item.status),
      enviadoEm: item.opened_at ?? undefined,
      ...(item.semConsulta ? { semConsulta: true } : {}),
    }
  }

  return {
    id: row.id,
    nome: row.name,
    responsavel: row.guardian_name ?? '',
    nascimento: row.birth_date ?? '',
    sexo: row.sex,
    telefone: row.phone,
    cpf: row.cpf ?? '',
    email: row.email ?? '',
    cidade: row.city ?? '',
    bairro: row.neighborhood ?? '',
    convenio: row.insurance ?? '',
    cid: row.cid ?? '',
    unidade: row.unit ?? '',
    dataConsulta: row.consultation_date,
    observacoes: row.notes ?? '',
    criadoEm: row.created_at,
    criadoAutomaticamenteEm: (row as { auto_created_at?: string | null }).auto_created_at ?? '',
    nomeDoContatoEm: (row as { name_from_contact_at?: string | null }).name_from_contact_at ?? '',
    followups,
  }
}

function mapConsultation(row: ConsultationRow): Consultation {
  return {
    id: row.id,
    patientId: row.patient_id,
    data: row.consultation_date,
    tipo: row.encounter_type,
    unidade: row.unit,
    peso: row.weight_kg === null ? '' : String(row.weight_kg),
    altura: row.height_cm === null ? '' : String(row.height_cm),
    queixa: row.chief_complaint,
    historiaEvolucao: row.clinical_history,
    antecedentesPessoais: row.personal_history,
    antecedentesFamiliares: row.family_history,
    alergias: row.allergies,
    medicamentos: row.current_medications,
    exameFisico: row.physical_exam,
    avaliacao: row.assessment,
    cid: row.cid,
    conduta: row.plan,
    prescricao: row.prescription,
    retorno: row.return_plan,
    observacoes: row.notes,
    criadoEm: row.created_at,
    assinadoEm: row.signed_at ?? null,
    assinadoPor: row.signed_by_name ?? null,
    arquivoAssinado: row.signed_pdf_path ?? null,
  }
}

function decimalOrNull(value: string) {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return null
  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function consultationPayload(
  clinicId: string,
  patientId: string,
  draft: ConsultationDraft,
): ConsultationInsert {
  return {
    clinic_id: clinicId,
    patient_id: patientId,
    consultation_date: draft.data,
    encounter_type: draft.tipo,
    unit: draft.unidade.trim(),
    weight_kg: decimalOrNull(draft.peso),
    height_cm: decimalOrNull(draft.altura),
    chief_complaint: draft.queixa.trim(),
    clinical_history: draft.historiaEvolucao.trim(),
    personal_history: draft.antecedentesPessoais.trim(),
    family_history: draft.antecedentesFamiliares.trim(),
    allergies: draft.alergias.trim(),
    current_medications: draft.medicamentos.trim(),
    physical_exam: draft.exameFisico.trim(),
    assessment: draft.avaliacao.trim(),
    cid: draft.cid.trim(),
    plan: draft.conduta.trim(),
    prescription: draft.prescricao.trim(),
    return_plan: draft.retorno.trim(),
    notes: draft.observacoes.trim(),
  }
}

/**
 * Colunas que o banco ja tem mas os tipos gerados ainda nao conhecem.
 *
 * Some quando os tipos forem regerados depois da migration da prescricao. Ate
 * la, sem esta abertura o CPF seria descartado em silencio no caminho para o
 * banco - o mesmo tipo de bug que ja custou uma tarde neste projeto.
 */
type ColunasNovasDoPaciente = {
  cpf?: string | null
  email?: string | null
  auto_created_at?: string | null
}

function patientCreatePayload(
  draft: PatientDraft,
): Omit<PatientInsert, 'clinic_id'> & ColunasNovasDoPaciente {
  return {
    cpf: draft.cpf.replace(/\D/g, '') || null,
    email: draft.email.trim() || null,
    name: draft.nome.trim(),
    guardian_name: draft.responsavel.trim(),
    birth_date: draft.nascimento || null,
    sex: draft.sexo,
    // Celular sem o 9 ganha o 9 ao gravar (16/10/2026, vindo do sistema do Dr.
    // Marcello): o envio para o numero de 8 digitos voltava "Message
    // undeliverable". Ver telefone-br.ts.
    phone: comNonoDigito(draft.telefone),
    city: draft.cidade.trim(),
    neighborhood: draft.bairro.trim(),
    insurance: draft.convenio.trim(),
    cid: draft.cid.trim(),
    unit: draft.unidade.trim(),
    consultation_date: draft.dataConsulta,
    notes: draft.observacoes.trim(),
  }
}

function patientUpdatePayload(patch: Partial<Patient>): PatientUpdate & ColunasNovasDoPaciente {
  const payload: PatientUpdate & ColunasNovasDoPaciente = {}
  if (patch.cpf !== undefined) payload.cpf = patch.cpf.replace(/\D/g, '') || null
  if (patch.email !== undefined) payload.email = patch.email.trim() || null
  if (patch.nome !== undefined) payload.name = patch.nome.trim()
  if (patch.responsavel !== undefined) payload.guardian_name = patch.responsavel.trim()
  if (patch.nascimento !== undefined) payload.birth_date = patch.nascimento || null
  if (patch.sexo !== undefined) payload.sex = patch.sexo
  if (patch.telefone !== undefined) payload.phone = comNonoDigito(patch.telefone)
  if (patch.cidade !== undefined) payload.city = patch.cidade.trim()
  if (patch.bairro !== undefined) payload.neighborhood = patch.bairro.trim()
  if (patch.convenio !== undefined) payload.insurance = patch.convenio.trim()
  if (patch.cid !== undefined) payload.cid = patch.cid.trim()
  if (patch.unidade !== undefined) payload.unit = patch.unidade.trim()
  if (patch.dataConsulta !== undefined) payload.consultation_date = patch.dataConsulta
  if (patch.observacoes !== undefined) payload.notes = patch.observacoes.trim()
  // Salvou pela tela: alguem leu o cadastro. A marca de "criado sozinho" perde
  // o sentido no instante em que uma pessoa confere - mante-la viraria um aviso
  // que ninguem consegue tirar.
  payload.auto_created_at = null
  return payload
}

async function followupsForPatient(clinicId: string, patientId: string) {
  const { data, error } = await supabase
    .from('followups')
    .select('id,patient_id,followup_key,status,opened_at')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .is('archived_at', null)

  if (error) fail(error)
  return (data ?? []) as FollowupRow[]
}

async function patientById(clinicId: string, patientId: string) {
  const { data, error } = await supabase
    .from('patients')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('id', patientId)
    .is('archived_at', null)
    .single()

  if (error) fail(error)
  const followups = await followupsForPatient(clinicId, patientId)
  return mapPatient(data as PatientRow, followups)
}

export async function getCurrentMembership(): Promise<CurrentMembership | null> {
  const { data: membership, error: membershipError } = await supabase
    .from('clinic_memberships')
    .select('clinic_id,role')
    // Suspenso nao entra (24/09/2026): sem este filtro a tela abria como se o
    // acesso existisse e cada consulta voltava vazia, sem explicar por que.
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (membershipError) fail(membershipError)
  if (!membership?.clinic_id) return null
  return {
    clinicId: String(membership.clinic_id),
    role: membership.role as ClinicRole,
  }
}

export async function ensureClinic() {
  const membership = await getCurrentMembership()
  if (membership) return membership.clinicId
  throw new Error(PENDING_ACCESS_MESSAGE)
}

export async function listPendingAccessRequests(clinicId: string): Promise<AccessRequest[]> {
  const { data, error } = await supabase
    .from('access_requests')
    .select('id,requested_name,requested_email,requested_at')
    .eq('clinic_id', clinicId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })

  if (error) fail(error)
  return ((data ?? []) as Pick<AccessRequestRow, 'id' | 'requested_name' | 'requested_email' | 'requested_at'>[]).map(
    (request) => ({
      id: request.id,
      name: request.requested_name || 'Usuário sem nome',
      email: request.requested_email,
      requestedAt: request.requested_at,
    }),
  )
}

export async function approveAccessRequest(requestId: string, role: Exclude<ClinicRole, 'owner'>) {
  const { error } = await supabase.rpc('approve_access_request', {
    request_id: requestId,
    assigned_role: role,
  })
  if (error) fail(error)
}

export interface AcessoDaClinica {
  userId: string
  nome: string
  email: string
  papel: ClinicRole
  situacao: 'active' | 'suspended'
  desde: string
  /** Responsavel pelo sistema: ninguem altera este acesso pela tela. */
  protegido: boolean
}

/** Quem tem vinculo com a clinica. So o dono enxerga (ver migration 20260924150000). */
export async function listarAcessos(clinicId: string): Promise<AcessoDaClinica[]> {
  const { data, error } = await (supabase.rpc as unknown as (
    nome: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>)('listar_acessos_da_clinica', {
    p_clinic: clinicId,
  })
  if (error) fail(error)
  type Linha = {
    user_id: string
    nome: string
    email: string
    papel: ClinicRole
    situacao: 'active' | 'suspended'
    desde: string
    protegido?: boolean
  }
  return ((data ?? []) as Linha[]).map((l) => ({
    userId: l.user_id,
    nome: l.nome,
    email: l.email,
    papel: l.papel,
    situacao: l.situacao,
    desde: l.desde,
    protegido: Boolean(l.protegido),
  }))
}

/**
 * Ultimo acesso de cada pessoa da clinica (18/10/2026). Funcao separada da
 * lista, para a lista nao cair se esta falhar (migration 20261018120000).
 * user_id -> data ISO, ou null para quem nunca entrou.
 */
export async function listarUltimosAcessos(clinicId: string): Promise<Record<string, string | null>> {
  const { data, error } = await (supabase.rpc as unknown as (
    nome: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>)('ultimos_acessos_da_clinica', {
    p_clinic: clinicId,
  })
  if (error) fail(error)
  const mapa: Record<string, string | null> = {}
  for (const l of (data ?? []) as { user_id: string; ultimo_acesso: string | null }[]) {
    mapa[l.user_id] = l.ultimo_acesso ?? null
  }
  return mapa
}

/**
 * Muda perfil e/ou suspende. O banco recusa mexer no proprio acesso, no do
 * responsavel pelo sistema, e so deixa o responsavel promover administrador.
 */
export async function alterarAcesso(
  clinicId: string,
  userId: string,
  papel: ClinicRole,
  situacao: 'active' | 'suspended',
) {
  const { error } = await (supabase.rpc as unknown as (
    nome: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ error: { message: string } | null }>)('alterar_acesso', {
    p_clinic: clinicId,
    p_user: userId,
    p_papel: papel,
    p_situacao: situacao,
  })
  if (error) fail(error)
}

export async function rejectAccessRequest(requestId: string) {
  const { error } = await supabase.rpc('reject_access_request', { request_id: requestId })
  if (error) fail(error)
}

/* ------------------------------------------------------------------ *
 * Agenda
 *
 * Os horarios livres NAO sao calculados aqui: vem da funcao available_slots
 * no banco. A mesma resposta precisa servir para esta tela e para o
 * agendamento pelo WhatsApp, e duas implementacoes divergiriam com o tempo.
 * ------------------------------------------------------------------ */

export interface Unit {
  id: string
  name: string
  address: string
  /** Numero do estabelecimento de saude. Vazio ate a clinica levantar. */
  cnes: string
  /**
   * E a agenda da telemedicina (03/10/2026), e nao um lugar. Ver a migration
   * 20261003150000_agenda_propria_da_telemedicina.sql.
   */
  telemedicina?: boolean
  /** O que o robo responde na opcao 1 sobre esta unidade. Pode ter {valor}. */
  infoText?: string
  /** Valor da consulta em centavos (14/10/2026). Nulo = ainda nao preenchido. */
  priceCents?: number | null
}

export interface AvailabilityRule {
  id: string
  unitId: string
  weekday: number
  startsAt: string
  endsAt: string
}

export interface ScheduleException {
  id: string
  unitId: string | null
  date: string
  isClosed: boolean
  startsAt: string | null
  endsAt: string | null
  reason: string
}

export interface SchedulePreferences {
  slotMinutes: number
  horizonDays: number
  minNoticeHours: number
  /** Liga ou desliga o lembrete automatico de consulta. */
  reminderEnabled: boolean
  /** Dias antes da consulta. 1 = vespera, 0 = no proprio dia. */
  reminderDays: number
}

export interface Appointment {
  id: string
  unitId: string
  patientId: string | null
  patientName: string
  startsAt: string
  endsAt: string
  status: 'scheduled' | 'attended' | 'cancelled' | 'no_show'
  source: 'clinic' | 'whatsapp'
  staffNote: string
  /** Nome e telefone de quem marcou pelo WhatsApp sem ter cadastro. */
  contactName: string
  contactPhone: string
  /** Falso enquanto for solicitacao de pessoa sem cadastro aguardando a equipe. */
  confirmedByClinic: boolean
  /** Ate quando a vaga fica reservada para essa solicitacao. */
  holdExpiresAt: string | null
  /** Quando o proprio paciente respondeu ao lembrete confirmando presenca. */
  confirmedAt: string | null
  /** Quando o paciente pediu para remarcar, respondendo ao lembrete. */
  rescheduleRequestedAt: string | null
  /** Quando o lembrete da vespera saiu. Nulo enquanto nao foi enviado. */
  reminderSentAt: string | null
  /** Falta marcada pelo sistema de madrugada, e nao pela equipe. */
  faltaAutomatica?: boolean
  /**
   * Quando a Meta recusou o lembrete, e por que.
   *
   * O banco guarda isso desde sempre; a tela nao mostrava. Em 20/09/2026
   * descobrimos que os lembretes estavam parados havia tres semanas por um
   * erro de maiusculas no nome do segredo do cron - e nada na tela dizia. Uma
   * falha que so existe no banco e uma falha que ninguem ve.
   */
  reminderFailedAt: string | null
  reminderFailureReason: string | null
  /**
   * O que a familia informou pelo WhatsApp ao marcar. Declarado por mensagem,
   * sem ninguem conferir: a equipe le, confere e transforma em cadastro.
   */
  ficha: {
    nome: string
    nascimento: string
    responsavel: string
    cpf: string
    email: string
    /** Consulta por video. A unidade e a que cedeu o horario. */
    telemedicina: boolean
  }
  /** Quantas vezes esta consulta ja trocou de data. Zero na primeira. */
  rescheduleCount: number
  /** Convenio informado no agendamento. Vazio = particular. */
  insurance: string
  /**
   * A data da consulta anterior, quando esta marcacao cai dentro dos 30 dias.
   *
   * Nula quando nao e retorno, quando o paciente nao tem cadastro, ou quando
   * ele veio de antes do sistema e a consulta antiga nunca foi registrada aqui.
   * Serve para a etiqueta na agenda avisar a recepcao, nao para decidir preco.
   */
  retornoDe: string | null
}

export const WEEKDAY_LABEL = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta',
  'Sábado',
]

export async function listUnits(clinicId: string): Promise<Unit[]> {
  const { data, error } = await supabase
    .from('clinic_units')
    .select('id,name,address,cnes')
    .eq('clinic_id', clinicId)
    .is('archived_at', null)
    .order('name')
  if (error) fail(error)
  const unidades: Unit[] = data ?? []
  const [tele, textos, valores] = await Promise.all([
    idsDaTelemedicina(clinicId),
    textosDasUnidades(clinicId),
    valoresDasUnidades(clinicId),
  ])
  return unidades
    .map((u) => ({
      ...u,
      telemedicina: tele.has(u.id),
      infoText: textos.get(u.id) ?? '',
      priceCents: valores.get(u.id) ?? null,
    }))
    // A telemedicina por ultimo: e a agenda "extra", e as unidades fisicas
    // continuam na ordem de sempre.
    .sort((a, b) => Number(a.telemedicina) - Number(b.telemedicina))
}

/**
 * Unidades desativadas, so para o Historico da agenda (15/10/2026, pedido do
 * Dr. Marcello): quem foi atendido na Liferty antes da mudanca para a Livance
 * continua consultavel. Nunca para marcar, e por isso fica fora de listUnits,
 * que alimenta o calendario, a configuracao e o robo.
 */
export async function listInactiveUnits(clinicId: string): Promise<Unit[]> {
  const { data, error } = await supabase
    .from('clinic_units')
    .select('id,name,address,cnes')
    .eq('clinic_id', clinicId)
    .not('archived_at', 'is', null)
    .order('name')
  if (error) fail(error)
  return data ?? []
}

/**
 * Quais unidades sao a agenda da telemedicina (03/10/2026).
 *
 * Coluna nova, em consulta separada: se o banco ainda nao a tem, a Agenda
 * abre igual, so sem a marca de video - em vez de nao abrir.
 */
async function idsDaTelemedicina(clinicId: string): Promise<Set<string>> {
  try {
    const { data, error } = await tabelaCrua('clinic_units')
      .select('id,telemedicina')
      .eq('clinic_id', clinicId)
      .order('name', { ascending: true })
    if (error) throw error
    return new Set(
      ((data ?? []) as { id: string; telemedicina?: boolean | null }[])
        .filter((u) => u.telemedicina === true)
        .map((u) => u.id),
    )
  } catch (erro) {
    console.warn('Sem a coluna clinic_units.telemedicina; agenda sem a marca de video', erro)
    return new Set()
  }
}

/**
 * O texto do robo de cada unidade, para o cartao da unidade na Agenda.
 *
 * Separado da lista: se falhar, a Agenda abre e o cartao mostra o texto vazio
 * com aviso, em vez de a agenda inteira nao abrir.
 */
async function textosDasUnidades(clinicId: string): Promise<Map<string, string>> {
  try {
    const { data, error } = await tabelaCrua('clinic_units')
      .select('id,info_text')
      .eq('clinic_id', clinicId)
      .order('name', { ascending: true })
    if (error) throw error
    return new Map(((data ?? []) as { id: string; info_text?: string | null }[]).map((u) => [u.id, u.info_text ?? '']))
  } catch (erro) {
    console.warn('Nao consegui ler os textos do robo das unidades', erro)
    return new Map()
  }
}

/**
 * Valor da consulta por unidade (coluna nova, 14/10/2026), em consulta propria:
 * sem a coluna, a Agenda abre igual e o cartao so mostra o valor vazio.
 */
async function valoresDasUnidades(clinicId: string): Promise<Map<string, number>> {
  try {
    const { data, error } = await tabelaCrua('clinic_units')
      .select('id,price_cents')
      .eq('clinic_id', clinicId)
      .order('name', { ascending: true })
    if (error) throw error
    const valores = new Map<string, number>()
    for (const u of (data ?? []) as { id: string; price_cents?: number | null }[]) {
      if (u.price_cents) valores.set(u.id, u.price_cents)
    }
    return valores
  } catch (erro) {
    console.warn('Sem a coluna clinic_units.price_cents; valores das unidades vazios', erro)
    return new Map()
  }
}

/**
 * Cadastra a unidade ja com o valor da consulta (14/10/2026): unidade sem valor
 * e unidade em que o {valor} do robo nao tem o que mostrar.
 */
export async function createUnit(clinicId: string, name: string, address: string, priceCents: number): Promise<Unit> {
  // price_cents nao esta nos tipos gerados (src/types/database.ts), como as
  // outras colunas recentes da unidade.
  const inserir = (supabase.from as unknown as (n: string) => {
    insert: (valores: Record<string, unknown>) => {
      select: (colunas: string) => {
        single: () => PromiseLike<{ data: Unit | null; error: { message: string } | null }>
      }
    }
  })('clinic_units')
  const { data, error } = await inserir
    .insert({ clinic_id: clinicId, name: name.trim(), address: address.trim(), price_cents: priceCents })
    .select('id,name,address,cnes')
    .single()
  if (error || !data) fail(error ?? { message: 'A unidade não voltou do banco depois de cadastrada.' })
  return data as Unit
}

export type DadosDaUnidade = {
  name: string
  address: string
  cnes: string
  /** Nulo so na agenda da telemedicina: o valor dela mora em clinic_settings. */
  priceCents: number | null
  infoText: string
}

/**
 * Salva o cartao da unidade inteiro, num UPDATE so.
 *
 * Um so de proposito: ou entra tudo, ou nada muda. Salvar o valor e o texto em
 * duas idas deixaria, numa falha no meio, o texto novo dizendo {valor} com o
 * valor antigo - ou o contrario. A tela ja recusou o que estava errado antes de
 * chegar aqui; o check do banco e a ultima trava.
 */
export async function saveUnit(unitId: string, dados: Partial<DadosDaUnidade>) {
  const atualizar = (supabase.from as unknown as (n: string) => {
    update: (valores: Record<string, unknown>) => {
      eq: (coluna: string, valor: string) => PromiseLike<{ error: { message: string } | null }>
    }
  })('clinic_units')
  const { error } = await atualizar
    .update({
      // So o que veio: o cartao da telemedicina nao mexe em endereco nem texto
      // da unidade (o texto dela fica em clinic_settings).
      ...(dados.name !== undefined ? { name: dados.name.trim() } : {}),
      ...(dados.address !== undefined ? { address: dados.address.trim() } : {}),
      ...(dados.cnes !== undefined ? { cnes: dados.cnes.replace(/\D/g, '') } : {}),
      ...(dados.priceCents !== undefined ? { price_cents: dados.priceCents } : {}),
      ...(dados.infoText !== undefined ? { info_text: dados.infoText.trim() } : {}),
    })
    .eq('id', unitId)
  if (error) fail(error)
}

/**
 * Guarda o CNES da unidade.
 *
 * Existe porque a unidade nasceu sem esse campo e não havia como editá-la:
 * dava para cadastrar e arquivar, nada no meio. Trocar o número de um
 * estabelecimento não deveria custar recadastrar a unidade e perder o vínculo
 * das consultas antigas com ela.
 */
export async function saveUnitCnes(unitId: string, cnes: string) {
  const { error } = await supabase
    .from('clinic_units')
    .update({ cnes: cnes.replace(/\D/g, '') })
    .eq('id', unitId)
  if (error) fail(error)
}

/** Arquiva em vez de apagar: agendamentos antigos continuam apontando para a unidade. */
export async function archiveUnit(unitId: string) {
  const { error } = await supabase
    .from('clinic_units')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', unitId)
  if (error) fail(error)
}

export async function listAvailabilityRules(unitId: string): Promise<AvailabilityRule[]> {
  const { data, error } = await supabase
    .from('availability_rules')
    .select('id,unit_id,weekday,starts_at,ends_at')
    .eq('unit_id', unitId)
    .order('weekday')
    .order('starts_at')
  if (error) fail(error)
  return (data ?? []).map((row) => ({
    id: row.id,
    unitId: row.unit_id,
    weekday: row.weekday,
    startsAt: row.starts_at.slice(0, 5),
    endsAt: row.ends_at.slice(0, 5),
  }))
}

export async function createAvailabilityRule(
  clinicId: string,
  unitId: string,
  weekday: number,
  startsAt: string,
  endsAt: string,
) {
  const { error } = await supabase
    .from('availability_rules')
    .insert({ clinic_id: clinicId, unit_id: unitId, weekday, starts_at: startsAt, ends_at: endsAt })
  if (error) fail(error)
}

export async function deleteAvailabilityRule(ruleId: string) {
  const { error } = await supabase.from('availability_rules').delete().eq('id', ruleId)
  if (error) fail(error)
}

export async function listScheduleExceptions(clinicId: string): Promise<ScheduleException[]> {
  const { data, error } = await supabase
    .from('schedule_exceptions')
    .select('id,unit_id,exception_date,is_closed,starts_at,ends_at,reason')
    .eq('clinic_id', clinicId)
    .gte('exception_date', new Date().toISOString().slice(0, 10))
    .order('exception_date')
  if (error) fail(error)
  return (data ?? []).map((row) => ({
    id: row.id,
    unitId: row.unit_id,
    date: row.exception_date,
    isClosed: row.is_closed,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    reason: row.reason,
  }))
}

export async function createScheduleException(
  clinicId: string,
  date: string,
  reason: string,
  unitId: string | null,
) {
  const { error } = await supabase.from('schedule_exceptions').insert({
    clinic_id: clinicId,
    unit_id: unitId,
    exception_date: date,
    is_closed: true,
    reason: reason.trim(),
  })
  if (error) fail(error)
}

export async function deleteScheduleException(exceptionId: string) {
  const { error } = await supabase.from('schedule_exceptions').delete().eq('id', exceptionId)
  if (error) fail(error)
}

// ---------------------------------------------------------------------------
// Medico e clinica: o que sai em documentos (assinatura, receita, cadastros)
// ---------------------------------------------------------------------------

export interface DadosDaClinica {
  /** Nome do medico como vai no documento assinado e na receita. */
  medicoNome: string
  crm: string
  /** Telefone de contato da clinica, impresso na receita. */
  telefone: string
  /** Segundo telefone, quando a clinica tem dois. Sai junto na receita. */
  telefone2: string
  /** E-mail do medico para cadastros externos (Memed). */
  medicoEmail: string
  /** Data de nascimento do medico (YYYY-MM-DD); a Memed exige. */
  medicoNascimento: string
}

// Estas colunas existem no banco e os tipos gerados ainda nao as conhecem.
// Enquanto os tipos nao forem regerados, a leitura e a escrita passam por
// uma consulta sem tipo, como as receitas.
type LinhaDaClinica = {
  signer_name: string | null
  signer_crm: string | null
  clinic_phone: string | null
  clinic_phone_alt?: string | null
  prescriber_email: string | null
  prescriber_birth_date: string | null
}

export async function getDadosDaClinica(clinicId: string): Promise<DadosDaClinica> {
  const { data, error } = await tabelaCrua('clinic_settings')
    .select('signer_name,signer_crm,clinic_phone,clinic_phone_alt,prescriber_email,prescriber_birth_date')
    .eq('clinic_id', clinicId)
    .order('clinic_id', { ascending: true })
  if (error) fail(error)
  const linha = ((data ?? []) as LinhaDaClinica[])[0]
  return {
    medicoNome: linha?.signer_name ?? '',
    crm: linha?.signer_crm ?? '',
    telefone: linha?.clinic_phone ?? '',
    telefone2: linha?.clinic_phone_alt ?? '',
    medicoEmail: linha?.prescriber_email ?? '',
    medicoNascimento: linha?.prescriber_birth_date ?? '',
  }
}

export async function saveDadosDaClinica(clinicId: string, dados: DadosDaClinica) {
  const atualizar = (supabase.from as unknown as (n: string) => {
    update: (valores: Record<string, unknown>) => {
      eq: (coluna: string, valor: string) => PromiseLike<{ error: { message: string } | null }>
    }
  })('clinic_settings')
  const { error } = await atualizar
    .update({
      signer_name: dados.medicoNome.trim() || null,
      signer_crm: dados.crm.trim() || null,
      clinic_phone: dados.telefone.trim(),
      clinic_phone_alt: dados.telefone2.trim(),
      prescriber_email: dados.medicoEmail.trim() || null,
      prescriber_birth_date: dados.medicoNascimento || null,
    })
    .eq('clinic_id', clinicId)
  if (error) fail(error)
}

export async function getSchedulePreferences(clinicId: string): Promise<SchedulePreferences> {
  const { data, error } = await supabase
    .from('clinic_settings')
    // Precisa ser uma string literal unica: concatenar quebra a inferencia de
    // tipos do supabase-js e o retorno vira GenericStringError.
    .select('schedule_slot_minutes,schedule_horizon_days,schedule_min_notice_hours,appointment_reminder_enabled,appointment_reminder_days')
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (error) fail(error)
  return {
    slotMinutes: data?.schedule_slot_minutes ?? 40,
    horizonDays: data?.schedule_horizon_days ?? 15,
    minNoticeHours: data?.schedule_min_notice_hours ?? 2,
    reminderEnabled: data?.appointment_reminder_enabled ?? true,
    reminderDays: data?.appointment_reminder_days ?? 1,
  }
}

export async function saveSchedulePreferences(clinicId: string, prefs: SchedulePreferences) {
  const { error } = await supabase
    .from('clinic_settings')
    .update({
      schedule_slot_minutes: prefs.slotMinutes,
      schedule_horizon_days: prefs.horizonDays,
      schedule_min_notice_hours: prefs.minNoticeHours,
      appointment_reminder_enabled: prefs.reminderEnabled,
      appointment_reminder_days: prefs.reminderDays,
    })
    .eq('clinic_id', clinicId)
  if (error) fail(error)
}

export async function listAvailableSlots(unitId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('available_slots', { p_unit_id: unitId })
  if (error) fail(error)
  return (data ?? []).map((row) => row.slot_start)
}

/**
 * As colunas da ficha, que os tipos gerados ainda nao conhecem.
 *
 * Some quando os tipos forem regerados depois desta migration. Ate la o
 * cliente recusaria os nomes na compilacao.
 */
type LinhaComFicha = {
  intake_patient_name?: string | null
  intake_birth_date?: string | null
  intake_guardian?: string | null
  intake_cpf?: string | null
  intake_email?: string | null
}

const FICHA_VAZIA = { nome: '', nascimento: '', responsavel: '', cpf: '', email: '', telemedicina: false, convenio: '' }

/**
 * A ficha que a familia preencheu pelo WhatsApp, por consulta.
 *
 * Consulta a parte porque os tipos gerados ainda nao conhecem estas colunas;
 * pedi-las na consulta principal faria a compilacao recusar todas as outras.
 * Se falhar, a agenda continua inteira - a ficha e complemento.
 */
async function fichasDasConsultas(clinicId: string, unitId: string) {
  const vazio = new Map<string, typeof FICHA_VAZIA>()
  try {
    const { data, error } = await tabelaCrua('appointments')
      .select('id,intake_patient_name,intake_birth_date,intake_guardian,intake_cpf,intake_email,modality,insurance')
      .eq('clinic_id', clinicId)
      .eq('unit_id', unitId)
      .order('id', { ascending: true })
    if (error) return vazio
    for (const linha of ((data ?? []) as (LinhaComFicha & { id: string; modality?: string | null })[])) {
      vazio.set(linha.id, {
        nome: linha.intake_patient_name ?? '',
        nascimento: linha.intake_birth_date ?? '',
        responsavel: linha.intake_guardian ?? '',
        cpf: linha.intake_cpf ?? '',
        email: linha.intake_email ?? '',
        // Vem junto da ficha porque estas colunas sao mais novas que os tipos
        // gerados, e uma consulta crua so ja paga todas.
        telemedicina: linha.modality === 'telemedicina',
        convenio: (linha as { insurance?: string | null }).insurance ?? '',
      })
    }
  } catch {
    // Antes da migration rodar a tabela nao tem as colunas. A agenda segue.
  }
  return vazio
}

/**
 * Meia-noite de hoje, no relógio de quem está olhando a tela.
 *
 * A agenda passou a começar aqui, e não em "agora". Antes, a consulta das 8h
 * sumia da tela às 8h01: quem estava na recepção não conseguia nem conferir
 * quem já tinha chegado, e marcar presença seria impossível num horário que
 * some sozinho. O dia inteiro fica à vista até virar meia-noite.
 */
function inicioDeHoje() {
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)
  return hoje.toISOString()
}

export async function listAppointments(clinicId: string, unitId: string): Promise<Appointment[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select('id,unit_id,patient_id,starts_at,ends_at,status,source,staff_note,contact_name,contact_phone,confirmed_by_clinic,hold_expires_at,confirmed_at,reschedule_requested_at,reminder_sent_at,reminder_failed_at,reminder_failure_reason,reschedule_count')
    .eq('clinic_id', clinicId)
    .eq('unit_id', unitId)
    .neq('status', 'cancelled')
    .gte('starts_at', inicioDeHoje())
    .order('starts_at')
  if (error) fail(error)

  const rows = data ?? []
  const patientIds = [...new Set(rows.map((r) => r.patient_id).filter(Boolean))] as string[]
  // consultation_date junto do nome: e a data da ultima consulta do paciente, e
  // e ela que diz se a proxima e retorno. Vem do cadastro, e nao do prontuario,
  // de proposito: a recepcao enxerga o cadastro, e e a recepcao quem precisa
  // desta informacao na hora de cobrar.
  const { data: patients } = patientIds.length
    ? await supabase.from('patients').select('id,name,consultation_date').in('id', patientIds)
    : { data: [] }
  const nameById = new Map((patients ?? []).map((p) => [p.id, p.name]))
  const ultimaConsultaPorPaciente = new Map(
    (patients ?? []).map((p) => [p.id, (p as { consultation_date?: string | null }).consultation_date ?? null]),
  )
  const fichas = await fichasDasConsultas(clinicId, unitId)

  return rows.map((row) => ({
    id: row.id,
    unitId: row.unit_id,
    patientId: row.patient_id,
    patientName:
      (row.patient_id && nameById.get(row.patient_id)) ||
      row.contact_name ||
      'Sem paciente vinculado',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    source: row.source,
    staffNote: row.staff_note,
    ficha: fichas.get(row.id) ?? FICHA_VAZIA,
    contactName: row.contact_name,
    // Formatado ja aqui: quem le a agenda precisa conferir um numero, e
    // "5511987654321" nao se confere de bater o olho.
    contactPhone: formatarTelefone(row.contact_phone || ''),
    confirmedByClinic: row.confirmed_by_clinic,
    holdExpiresAt: row.hold_expires_at,
    confirmedAt: row.confirmed_at,
    rescheduleRequestedAt: row.reschedule_requested_at,
    reminderSentAt: row.reminder_sent_at,
    reminderFailedAt: row.reminder_failed_at,
    reminderFailureReason: row.reminder_failure_reason,
    rescheduleCount: row.reschedule_count ?? 0,
    insurance: fichas.get(row.id)?.convenio ?? '',
    retornoDe: dataDoRetorno(
      row.patient_id ? ultimaConsultaPorPaciente.get(row.patient_id) ?? null : null,
      row.starts_at,
    ),
  }))
}

/**
 * O que já passou: dias anteriores a hoje, do mais recente para trás.
 *
 * Diferente da agenda em dois pontos, e os dois de propósito. Traz os
 * cancelados, porque histórico sem cancelamento mente sobre como o dia foi.
 * E vem em ordem decrescente, porque quem abre o histórico quer ver ontem, e
 * não o primeiro dia de atendimento da clínica.
 */
export async function listAppointmentHistory(
  clinicId: string,
  unitId: string,
  dias = 90,
): Promise<Appointment[]> {
  const desde = new Date()
  desde.setHours(0, 0, 0, 0)
  desde.setDate(desde.getDate() - dias)

  const { data, error } = await supabase
    .from('appointments')
    .select('id,unit_id,patient_id,starts_at,ends_at,status,source,staff_note,contact_name,contact_phone,confirmed_by_clinic,hold_expires_at,confirmed_at,reschedule_requested_at,reminder_sent_at,reminder_failed_at,reminder_failure_reason,reschedule_count')
    .eq('clinic_id', clinicId)
    .eq('unit_id', unitId)
    .gte('starts_at', desde.toISOString())
    .lt('starts_at', inicioDeHoje())
    .order('starts_at', { ascending: false })
  if (error) fail(error)

  const rows = data ?? []
  const patientIds = [...new Set(rows.map((r) => r.patient_id).filter(Boolean))] as string[]
  const { data: patients } = patientIds.length
    ? await supabase.from('patients').select('id,name').in('id', patientIds)
    : { data: [] }
  const nameById = new Map((patients ?? []).map((p) => [p.id, p.name]))
  // Só pelo convênio: o histórico não mostra ficha, mas a recepção precisa
  // saber pelo que aquela consulta foi faturada.
  const [fichas, automaticas] = await Promise.all([
    fichasDasConsultas(clinicId, unitId),
    faltasAutomaticas(clinicId, unitId),
  ])

  return rows.map((row) => ({
    faltaAutomatica: automaticas.has(row.id),
    id: row.id,
    unitId: row.unit_id,
    patientId: row.patient_id,
    patientName:
      (row.patient_id && nameById.get(row.patient_id)) ||
      row.contact_name ||
      'Sem paciente vinculado',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    source: row.source,
    staffNote: row.staff_note,
    ficha: FICHA_VAZIA,
    contactName: row.contact_name,
    contactPhone: formatarTelefone(row.contact_phone || ''),
    confirmedByClinic: row.confirmed_by_clinic,
    holdExpiresAt: row.hold_expires_at,
    confirmedAt: row.confirmed_at,
    rescheduleRequestedAt: row.reschedule_requested_at,
    reminderSentAt: row.reminder_sent_at,
    reminderFailedAt: row.reminder_failed_at,
    reminderFailureReason: row.reminder_failure_reason,
    rescheduleCount: row.reschedule_count ?? 0,
    insurance: fichas.get(row.id)?.convenio ?? '',
    retornoDe: null,
  }))
}

/**
 * Registra que o paciente compareceu, ou que faltou.
 *
 * Os dois estados existem no banco desde a primeira migration da agenda, em
 * 24/08/2026, e nunca foram gravados por ninguém: toda consulta nascia
 * "scheduled" e morria assim. Sem isso não existe taxa de falta, que é o
 * número que uma clínica mais quer ver e o que justifica a confirmação na
 * véspera.
 *
 * Aceita voltar para "marcada": quem clicou errado precisa poder desfazer, e
 * um registro de presença errado é pior do que nenhum.
 */
export async function marcarPresenca(
  appointmentId: string,
  presenca: 'attended' | 'no_show' | 'scheduled',
) {
  const { error } = await supabase
    .from('appointments')
    .update({ status: presenca })
    .eq('id', appointmentId)
  if (error) fail(error)
  // Clique da equipe manda: a marca de falta automatica sai. Pedido a parte
  // porque a coluna e mais nova que os tipos - e se ainda nao existir, o
  // clique continua valendo.
  try {
    await semTipo.from('appointments').update({ no_show_automatico_em: null }).eq('id', appointmentId)
  } catch {
    // sem a coluna, nada a limpar
  }
}

/** Cliente sem tipo, para colunas mais novas que os tipos gerados. */
const semTipo = supabase as unknown as SupabaseClient

/**
 * Quais consultas do historico levaram falta automatica (dia seguinte sem
 * prontuario, ver a migration faltou_automatico). Consulta a parte e em
 * try/catch: sem a coluna, o historico abre igual, so sem a etiqueta.
 */
async function faltasAutomaticas(clinicId: string, unitId: string): Promise<Set<string>> {
  try {
    const { data, error } = await semTipo
      .from('appointments')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('unit_id', unitId)
      .eq('status', 'no_show')
      .not('no_show_automatico_em', 'is', null)
    if (error) return new Set()
    return new Set((data ?? []).map((linha) => linha.id as string))
  } catch {
    return new Set()
  }
}

/**
 * Marca presença sozinha quando o médico salva a evolução da consulta.
 *
 * Se existe prontuário escrito daquele dia, o paciente esteve lá - não há
 * cenário em que alguém redija a evolução de quem faltou. Poupa a recepção de
 * clicar, que é o tipo de tarefa que se esquece justamente nos dias cheios.
 *
 * Só mexe em consulta que ainda está "marcada". Se a recepção já registrou
 * falta, o registro dela vale: ela estava lá e o sistema não.
 *
 * Nunca interrompe o salvamento do prontuário. O prontuário é o documento; a
 * presença é a etiqueta em cima dele.
 */
async function marcarPresencaPeloProntuario(
  clinicId: string,
  patientId: string,
  data: string,
) {
  try {
    const dia = data.slice(0, 10)
    if (!dia) return
    // O dia no relógio de quem atende, e não em UTC. Sem o "Z" o JavaScript lê
    // a data como local: em Santos, a consulta das 22h é 01h UTC do dia
    // seguinte, e uma janela em UTC deixaria o fim do expediente de fora.
    const inicio = new Date(`${dia}T00:00:00`)
    const fim = new Date(`${dia}T23:59:59.999`)

    // A consulta nem sempre está ligada à ficha. Quando a equipe marca pela
    // Agenda, ela digita nome e telefone na mão e o appointment nasce sem
    // patient_id - é o caso da maioria da agenda desta clínica. Procurar só
    // pelo vínculo deixaria de marcar justamente esses.
    const { data: ficha } = await supabase
      .from('patients')
      .select('name,phone')
      .eq('id', patientId)
      .maybeSingle()

    // Últimos 8 dígitos: a agenda guarda o telefone com o 55 do país e o
    // cadastro sem ele. O número do assinante é o que sobrevive aos dois
    // formatos, ao nono dígito e ao DDD escrito de jeitos diferentes.
    const digitos = (ficha?.phone ?? '').replace(/\D/g, '')
    const finalDoTelefone = digitos.length >= 8 ? digitos.slice(-8) : ''
    // Vírgula e parênteses quebram a sintaxe do filtro "ou" do PostgREST.
    const nome = (ficha?.name ?? '').trim().replace(/[(),]/g, ' ')

    // Irmaos (24/09/2026). Numa gastropediatria a mae marca os dois filhos com
    // o proprio celular. Casar por telefone com "ou" marcava presenca no irmao
    // que faltou quando o medico salvava a evolucao do outro. Agora:
    //  - consulta ligada a uma ficha so casa pela ficha;
    //  - consulta sem ficha casa pelo nome; pelo telefone, so se for a UNICA
    //    consulta sem ficha daquele telefone no dia. Havendo duas, o telefone
    //    nao diz qual e qual, e marcar nenhuma e melhor que marcar a errada.
    const ids = new Set<string>()
    const { data: doDia } = await supabase
      .from('appointments')
      .select('id,patient_id,contact_name,contact_phone')
      .eq('clinic_id', clinicId)
      .eq('status', 'scheduled')
      .gte('starts_at', inicio.toISOString())
      .lte('starts_at', fim.toISOString())

    const semFicha = (doDia ?? []).filter((a) => !a.patient_id)
    const mesmoNome = (a: { contact_name: string | null }) =>
      Boolean(nome) && (a.contact_name ?? '').trim().toLowerCase() === nome.toLowerCase()
    const mesmoTelefone = (a: { contact_phone: string | null }) =>
      Boolean(finalDoTelefone) && (a.contact_phone ?? '').replace(/\D/g, '').endsWith(finalDoTelefone)

    for (const a of doDia ?? []) if (a.patient_id === patientId) ids.add(a.id)
    for (const a of semFicha) if (mesmoNome(a)) ids.add(a.id)
    const peloTelefone = semFicha.filter(mesmoTelefone)
    if (peloTelefone.length === 1) ids.add(peloTelefone[0].id)

    if (ids.size > 0) {
      await supabase
        .from('appointments')
        .update({ status: 'attended' })
        .in('id', [...ids])
        .eq('status', 'scheduled')
    }

    // Falta que o sistema marcou sozinho de madrugada (25/09/2026): o medico
    // escreveu o prontuario so depois, entao a pessoa veio. Vale a mesma
    // regra de casamento de cima. Falta marcada pela equipe nao entra aqui -
    // o filtro pela marca automatica garante.
    const { data: faltas } = await semTipo
      .from('appointments')
      .select('id,patient_id,contact_name,contact_phone')
      .eq('clinic_id', clinicId)
      .eq('status', 'no_show')
      .not('no_show_automatico_em', 'is', null)
      .gte('starts_at', inicio.toISOString())
      .lte('starts_at', fim.toISOString())
    const listaDeFaltas = (faltas ?? []) as { id: string; patient_id: string | null; contact_name: string | null; contact_phone: string | null }[]
    const desfazer = new Set<string>()
    for (const a of listaDeFaltas) if (a.patient_id === patientId) desfazer.add(a.id)
    const faltasSemFicha = listaDeFaltas.filter((a) => !a.patient_id)
    for (const a of faltasSemFicha) if (mesmoNome(a)) desfazer.add(a.id)
    const faltaPeloTelefone = faltasSemFicha.filter(mesmoTelefone)
    if (faltaPeloTelefone.length === 1) desfazer.add(faltaPeloTelefone[0].id)
    if (desfazer.size > 0) {
      await semTipo
        .from('appointments')
        .update({ status: 'attended', no_show_automatico_em: null })
        .in('id', [...desfazer])
        .not('no_show_automatico_em', 'is', null)
    }
  } catch (causa) {
    console.warn('Não consegui marcar presença a partir do prontuário', causa)
  }
}

/**
 * A data da consulta anterior, quando esta marcacao e retorno.
 *
 * Retorno em ate 30 dias esta incluido no valor da consulta, e quem olha a
 * agenda nao tem como saber disso: "retorno" so existe dentro do prontuario,
 * escrito pelo medico no fim do atendimento. A recepcao cobrava no escuro.
 *
 * A conta e simples de proposito - ultima consulta, 30 dias, acabou. Nao vale
 * como veredicto: devolve a data para a etiqueta MOSTRAR, e quem decide o que
 * cobrar continua sendo a pessoa. A regra dos 30 dias e do consultorio, e
 * consultorio abre excecao.
 *
 * Estritamente ANTES: consulta e marcacao no mesmo dia e a propria consulta
 * sendo registrada, nao um retorno dela.
 */
function dataDoRetorno(ultimaConsulta: string | null, inicioDaMarcacao: string): string | null {
  if (!ultimaConsulta) return null
  const anterior = new Date(`${ultimaConsulta}T12:00:00`)
  const marcada = new Date(inicioDaMarcacao)
  if (Number.isNaN(anterior.getTime()) || Number.isNaN(marcada.getTime())) return null

  const dias = Math.floor((marcada.getTime() - anterior.getTime()) / 86_400_000)
  return dias > 0 && dias <= 30 ? ultimaConsulta : null
}

export type MotivoDeLigar = 'remarcar' | 'lembrete_falhou' | 'sem_resposta' | 'sem_telefone'

export interface PendenciaDeLigar {
  id: string
  unitId: string
  unitName: string
  nome: string
  telefone: string
  startsAt: string
  motivo: MotivoDeLigar
  detalhe: string | null
}

/**
 * "Ligar hoje": consultas de agora ate o fim de amanha que pedem uma ligacao
 * da recepcao, na clinica inteira (24/09/2026).
 *
 * As mesmas etiquetas ja apareciam no cartao da Agenda, mas so na unidade
 * selecionada: quem trabalhava em Santos nao via o "pediu para remarcar" de
 * Sao Paulo. Aqui vem tudo junto, em ordem de horario, com o motivo.
 *
 * Mesmas regras das etiquetas, na mesma prioridade: pediu para remarcar >
 * lembrete falhou > lembrete sem resposta > sem telefone. Uma linha por
 * consulta, com o motivo mais forte.
 */
export async function listLigarHoje(clinicId: string): Promise<PendenciaDeLigar[]> {
  const agora = new Date()
  const fimDeAmanha = new Date(agora)
  fimDeAmanha.setDate(fimDeAmanha.getDate() + 1)
  fimDeAmanha.setHours(23, 59, 59, 999)

  const { data, error } = await supabase
    .from('appointments')
    .select(
      'id,unit_id,patient_id,contact_name,contact_phone,starts_at,confirmed_at,reschedule_requested_at,reminder_sent_at,reminder_failed_at,reminder_failure_reason',
    )
    .eq('clinic_id', clinicId)
    .eq('status', 'scheduled')
    .eq('confirmed_by_clinic', true)
    .gte('starts_at', agora.toISOString())
    .lte('starts_at', fimDeAmanha.toISOString())
    .order('starts_at', { ascending: true })
  if (error) fail(error)
  const rows = data ?? []
  if (rows.length === 0) return []

  const patientIds = [...new Set(rows.map((r) => r.patient_id).filter(Boolean))] as string[]
  const [{ data: pacientes }, { data: units }] = await Promise.all([
    patientIds.length
      ? supabase.from('patients').select('id,name,phone').in('id', patientIds)
      : Promise.resolve({ data: [] as { id: string; name: string; phone: string | null }[] }),
    supabase.from('clinic_units').select('id,name').eq('clinic_id', clinicId),
  ])
  const pacientePorId = new Map((pacientes ?? []).map((p) => [p.id, p]))
  const nomePorUnidade = new Map((units ?? []).map((u) => [u.id, u.name]))

  const lista: PendenciaDeLigar[] = []
  for (const row of rows) {
    const paciente = row.patient_id ? pacientePorId.get(row.patient_id) : undefined
    const telefone = (paciente?.phone || row.contact_phone || '').trim()
    let motivo: MotivoDeLigar | null = null
    if (row.reschedule_requested_at && !row.confirmed_at) motivo = 'remarcar'
    else if (!row.reminder_sent_at && row.reminder_failed_at) motivo = 'lembrete_falhou'
    else if (row.reminder_sent_at && !row.confirmed_at) motivo = 'sem_resposta'
    else if (!row.reminder_sent_at && telefone.replace(/\D/g, '').length < 10) motivo = 'sem_telefone'
    if (!motivo) continue
    lista.push({
      id: row.id,
      unitId: row.unit_id,
      unitName: nomePorUnidade.get(row.unit_id) ?? 'Unidade',
      nome: paciente?.name || row.contact_name || 'Sem nome',
      telefone: formatarTelefone(telefone),
      startsAt: row.starts_at,
      motivo,
      detalhe: motivo === 'lembrete_falhou' ? row.reminder_failure_reason ?? null : null,
    })
  }
  return lista
}

export interface PendingRequest {
  id: string
  unitId: string
  unitName: string
  contactName: string
  contactPhone: string
  startsAt: string
  /** Ate quando a vaga fica presa. Passou disso, a faxina horaria devolve. */
  holdExpiresAt: string | null
}

/**
 * Solicitacoes feitas pelo WhatsApp por quem nao tem cadastro, esperando a
 * equipe confirmar.
 *
 * Consulta a clinica inteira, e nao uma unidade: o aviso precisa aparecer para
 * quem abre o sistema, sem depender de a pessoa lembrar de olhar cada agenda.
 */
export async function listPendingRequests(clinicId: string): Promise<PendingRequest[]> {
  const { data, error } = await supabase
    .from('appointments')
    .select('id,unit_id,contact_name,contact_phone,starts_at,hold_expires_at')
    .eq('clinic_id', clinicId)
    .eq('status', 'scheduled')
    .eq('confirmed_by_clinic', false)
    .order('starts_at', { ascending: true })

  if (error) fail(error)
  const rows = data ?? []
  if (rows.length === 0) return []

  const { data: units } = await supabase
    .from('clinic_units')
    .select('id,name')
    .eq('clinic_id', clinicId)
  const nomePorUnidade = new Map((units ?? []).map((u) => [u.id, u.name]))

  return rows.map((row) => ({
    id: row.id,
    unitId: row.unit_id,
    unitName: nomePorUnidade.get(row.unit_id) ?? 'Unidade',
    contactName: row.contact_name || '',
    contactPhone: formatarTelefone(row.contact_phone || ''),
    startsAt: row.starts_at,
    holdExpiresAt: row.hold_expires_at,
  }))
}

/**
 * Ajustes que a equipe faz numa consulta ja marcada.
 *
 * Vale principalmente para o que chegou pelo WhatsApp: corrigir um nome mal
 * digitado, anotar um recado, e sobretudo dizer de quem e aquela consulta.
 * Enquanto patientId for nulo, a consulta nao entra no prontuario nem nos
 * acompanhamentos de 15, 30 e 90 dias.
 */
export async function updateAppointmentDetails(
  appointmentId: string,
  dados: {
    contactName: string
    contactPhone: string
    staffNote: string
    patientId: string | null
  },
) {
  const { error } = await supabase
    .from('appointments')
    .update({
      contact_name: dados.contactName.trim().slice(0, 160),
      contact_phone: comNonoDigito(dados.contactPhone).slice(0, 20),
      staff_note: dados.staffNote.trim(),
      patient_id: dados.patientId,
    })
    .eq('id', appointmentId)
  if (error) fail(error)
}

/**
 * Avisa pelo WhatsApp que a equipe confirmou a solicitacao.
 *
 * Sem isto a pessoa recebia "confirmamos em ate 24 horas" e nunca mais ouvia
 * falar: a proxima noticia era o lembrete da vespera. Falhar aqui nao desfaz a
 * confirmacao - a consulta ja esta valida, so o aviso nao saiu.
 */
export async function notifyAppointmentConfirmed(
  clinicId: string,
  appointmentId: string,
): Promise<{ avisou: boolean; motivo?: string }> {
  const { data: consulta, error } = await supabase
    .from('appointments')
    .select('starts_at,contact_phone,unit_id')
    .eq('id', appointmentId)
    .maybeSingle()
  if (error) fail(error)
  const digitos = (consulta?.contact_phone ?? '').replace(/\D/g, '')
  if (!digitos) return { avisou: false, motivo: 'sem telefone' }

  // O wa_id chega com 55 na frente; o cadastro pode ter so o DDD.
  const variantes = [digitos, `55${digitos}`, digitos.replace(/^55/, '')]
  const { data: conversa } = await supabase
    .from('whatsapp_conversations')
    .select('id')
    .eq('clinic_id', clinicId)
    .in('wa_id', variantes)
    .limit(1)
    .maybeSingle()
  if (!conversa) return { avisou: false, motivo: 'sem conversa' }

  const { data: unidade } = await supabase
    .from('clinic_units')
    .select('name,address')
    .eq('id', consulta!.unit_id)
    .maybeSingle()

  const quando = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(consulta!.starts_at))

  const texto =
    `Consulta confirmada!\n\n${quando}\n${unidade?.name ?? ''}` +
    `${unidade?.address ? `\n${unidade.address}` : ''}\n\n` +
    'Um dia antes enviamos um lembrete. Digite MENU se precisar de alguma coisa.'

  try {
    await sendConversationReply(conversa.id, texto, true)
    return { avisou: true }
  } catch (causa) {
    return { avisou: false, motivo: causa instanceof Error ? causa.message : 'falha no envio' }
  }
}

/** A recepcao aceita a solicitacao feita pelo WhatsApp por quem nao tem cadastro. */
export async function confirmAppointment(appointmentId: string) {
  const { error } = await supabase
    .from('appointments')
    .update({ confirmed_by_clinic: true, hold_expires_at: null })
    .eq('id', appointmentId)
  if (error) fail(error)
}

/**
 * A equipe registra que o paciente confirmou presenca (20/10/2026, vindo do
 * sistema do Dr. Marcello).
 *
 * Ate aqui so o lembrete gravava confirmed_at. La, um paciente respondeu
 * "Confirma" - palavra que o robo ainda nao reconhecia - e a consulta ficou
 * "lembrete enviado, sem resposta" na vespera, sem botao nenhum para a equipe
 * corrigir. Serve tambem para quem confirma por ligacao. Diferente de
 * confirmAppointment, que e a clinica aceitando a marcacao e avisando: aqui
 * ninguem e avisado, so fica registrado. So vale para consulta ainda marcada.
 */
export async function registrarPresencaConfirmada(appointmentId: string, confirmada: boolean) {
  const { error } = await semTipo
    .from('appointments')
    .update(confirmada ? { confirmed_at: new Date().toISOString(), reschedule_requested_at: null } : { confirmed_at: null })
    .eq('id', appointmentId)
    .eq('status', 'scheduled')
  if (error) fail(error)
}

export async function createAppointment(
  clinicId: string,
  unitId: string,
  patientId: string | null,
  startsAt: string,
  slotMinutes: number,
  staffNote = '',
  /**
   * Nome e WhatsApp de quem ainda nao tem cadastro.
   *
   * Sem eles a consulta marcada pela equipe para alguem de fora da base ficava
   * muda: o lembrete da vespera nao tem para onde ir, e na vespera o sistema
   * tambem nao consegue criar o cadastro. Dois campos resolvem os dois.
   */
  contato: { nome: string; telefone: string } = { nome: '', telefone: '' },
) {
  const endsAt = new Date(new Date(startsAt).getTime() + slotMinutes * 60000).toISOString()
  const { error } = await supabase.from('appointments').insert({
    clinic_id: clinicId,
    unit_id: unitId,
    patient_id: patientId,
    starts_at: startsAt,
    ends_at: endsAt,
    source: 'clinic',
    staff_note: staffNote.trim(),
    contact_name: contato.nome.trim(),
    contact_phone: comNonoDigito(contato.telefone),
  })
  // O indice unico do banco e a garantia real contra dois pacientes no mesmo
  // horario. Traduzimos o erro tecnico para algo que a recepcao entenda.
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new Error('Este horário acabou de ser ocupado. Atualize a agenda e escolha outro.')
    }
    fail(error)
  }
}

/**
 * Os motivos que o consultorio usa de verdade.
 *
 * Lista curta de proposito: cinco cobrem quase tudo, e uma lista longa faz a
 * pessoa escolher "outro" so para nao ler. O sexto e livre, para o caso raro.
 *
 * O texto e escrito do ponto de vista de quem vai LER a mensagem, e nao de quem
 * cancela: cada um destes vai inteiro para o WhatsApp do paciente.
 */
export const MOTIVOS_DE_CANCELAMENTO = [
  'Imprevisto do médico',
  'Emergência com outro paciente',
  'Problema de saúde do médico',
  'A unidade não vai funcionar nesse dia',
  'A pedido do paciente',
] as const

/**
 * Cancelamento que e so arrumacao da agenda (05/10/2026): consulta duplicada,
 * marcada errada, refeita para ligar a ficha. Nao vai para o paciente - nao ha
 * nada para ele saber. Ate aqui a recepcao escolhia "A pedido do paciente"
 * para isso, e a Ana Vitoria recebeu "foi cancelada, conforme voce pediu" de
 * uma consulta que continuava de pe.
 */
export const MOTIVO_CORRECAO_INTERNA = 'Correção na agenda (marcação duplicada ou errada)'

export interface ResultadoDoCancelamento {
  avisado: boolean
  enviadoPara?: string | null
  /** Por que o paciente nao soube. So vem quando avisado e falso. */
  motivoDoSilencio?: string
}

/**
 * Cancela e avisa numa operacao so.
 *
 * Antes disto o botao da agenda apenas liberava o horario, e o paciente
 * descobria o cancelamento ao chegar na unidade. A funcao devolve se o aviso
 * chegou, porque quando nao chega alguem precisa telefonar.
 */
export async function cancelAppointment(
  appointmentId: string,
  motivo: string,
  avisarPaciente = true,
  sugerirDatas = true,
) {
  const { data, error } = await supabase.functions.invoke('appointment-cancel', {
    body: { appointmentId, motivo, avisarPaciente, sugerirDatas },
  })
  if (error) throw new Error(await motivoDaFalha(error, 'Não foi possível cancelar a consulta.'))
  return data as ResultadoDoCancelamento
}

/*
 * Sem tela desde 11/09/2026.
 *
 * O bloco "Canceladas sem aviso" saiu da Agenda: o aviso falhava por um erro
 * de busca da conversa, e não por acaso - corrigido o erro, a lista virou um
 * alarme que só tocava para cancelamentos em que a clínica escolheu não avisar.
 * As duas funções abaixo ficam de pé porque o servidor ainda sabe reenviar
 * (appointment-cancel com apenasAvisar) e trazer a lista de volta é uma tela,
 * não um sistema.
 */

/** Uma consulta já cancelada em que o paciente ficou sem saber. */
export interface CancelamentoSemAviso {
  id: string
  quando: string
  paciente: string
  unidade: string
  motivo: string
}

/**
 * Cancelamentos recentes que ninguém soube.
 *
 * O aviso pode falhar por muita coisa: a Meta fora do ar, o modelo ainda não
 * aprovado, a equipe escolhendo "não avisar" para ligar e esquecendo depois.
 * Quando falha, a família continua achando que tem consulta marcada - e
 * aparece na unidade, com a criança, no dia.
 *
 * Sete dias porque depois disso a consulta já passou e ligar é o certo, não
 * mandar mensagem sobre um horário que ficou para trás.
 */
export async function listCancelamentosSemAviso(clinicId: string): Promise<CancelamentoSemAviso[]> {
  const desde = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const { data, error } = await tabelaCrua('appointments')
    .select('id,starts_at,contact_name,patient_id,cancellation_reason,cancelled_at,clinic_units(name)')
    .eq('clinic_id', clinicId)
    .eq('status', 'cancelled')
    .is('cancellation_notified_at', null)
    .gte('cancelled_at', desde)
    .order('cancelled_at', { ascending: false })

  // Lista de apoio: se falhar, a agenda continua inteira.
  if (error) return []

  type Linha = {
    id: string
    starts_at: string
    contact_name: string | null
    patient_id: string | null
    cancellation_reason: string | null
    clinic_units: { name?: string } | { name?: string }[] | null
  }
  const linhas = (data ?? []) as Linha[]

  // O nome do cadastro vale mais do que o do contato, quando existe.
  const ids = [...new Set(linhas.map((l) => l.patient_id).filter(Boolean))] as string[]
  const { data: pacientes } = ids.length
    ? await supabase.from('patients').select('id,name').in('id', ids)
    : { data: [] }
  const nomePorId = new Map((pacientes ?? []).map((p) => [p.id, p.name]))

  return linhas.map((linha) => {
    const unidade = Array.isArray(linha.clinic_units) ? linha.clinic_units[0] : linha.clinic_units
    return {
      id: linha.id,
      quando: linha.starts_at,
      paciente:
        (linha.patient_id && nomePorId.get(linha.patient_id)) ||
        linha.contact_name ||
        'Contato sem cadastro',
      unidade: unidade?.name ?? '',
      motivo: linha.cancellation_reason ?? '',
    }
  })
}

/** Reenvia o aviso de uma consulta que já está cancelada. */
export async function avisarCancelamento(appointmentId: string) {
  const { data, error } = await supabase.functions.invoke('appointment-cancel', {
    body: { appointmentId, apenasAvisar: true },
  })
  if (error) throw new Error(await motivoDaFalha(error, 'Não foi possível enviar o aviso.'))
  return data as ResultadoDoCancelamento
}

export interface ResumoDoPaciente {
  /** Mensagens que o paciente mandou, em todas as conversas. */
  contatos: number
  /** Consultas que ja aconteceram: passaram da data e nao foram canceladas. */
  realizadas: number
  /** Consultas futuras ainda de pe. */
  agendadas: number
  cancelamentos: number
}

/**
 * O historico do paciente em quatro numeros.
 *
 * Serve para quem abre a conversa saber com quem esta falando antes de
 * responder: alguem que ja veio cinco vezes e alguem que cancelou tres seguidas
 * merecem tratamentos diferentes, e hoje isso so aparecia garimpando telas.
 */
export async function resumoDoPaciente(clinicId: string, patientId: string) {
  const agora = new Date().toISOString()

  const [contatos, realizadas, agendadas, cancelamentos] = await Promise.all([
    supabase
      .from('whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq('patient_id', patientId)
      .eq('direction', 'inbound'),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .neq('status', 'cancelled')
      .lt('starts_at', agora),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .neq('status', 'cancelled')
      .gte('starts_at', agora),
    supabase
      .from('appointments')
      .select('id', { count: 'exact', head: true })
      .eq('clinic_id', clinicId)
      .eq('patient_id', patientId)
      .eq('status', 'cancelled'),
  ])

  return {
    contatos: contatos.count ?? 0,
    realizadas: realizadas.count ?? 0,
    agendadas: agendadas.count ?? 0,
    cancelamentos: cancelamentos.count ?? 0,
  } satisfies ResumoDoPaciente
}

/* ------------------------------------------------------------------ *
 * Conversas do WhatsApp
 *
 * O webhook grava as respostas dos pacientes em whatsapp_conversations e
 * whatsapp_messages. Estas funcoes existem para que essas respostas apareçam
 * na tela: sem elas o paciente responde "Preciso de ajuda" e ninguem ve.
 * ------------------------------------------------------------------ */

/**
 * Telefone do jeito que se le em voz alta. O banco guarda so digitos, com o 55
 * na frente, e "5511912345678" na tela nao ajuda ninguem a conferir um numero.
 */
export function formatarTelefone(digitos: string) {
  const limpo = (digitos ?? '').replace(/\D/g, '')
  const nacional = limpo.startsWith('55') && limpo.length > 11 ? limpo.slice(2) : limpo
  if (nacional.length === 11) {
    return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 7)}-${nacional.slice(7)}`
  }
  if (nacional.length === 10) {
    return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 6)}-${nacional.slice(6)}`
  }
  return limpo
}

export interface Conversation {
  id: string
  patientId: string | null
  patientName: string
  /**
   * Nome que a pessoa configurou no WhatsApp dela. Serve para reconhecer a
   * conversa; nao e nome verificado e nunca substitui o cadastro.
   */
  profileName: string
  phone: string
  /** So digitos, para casar com o cadastro e montar o pre-cadastro. */
  phoneDigits: string
  status: 'open' | 'resolved' | 'opted_out'
  needsAttention: boolean
  /**
   * Por que a conversa pede alguem da equipe. 'atendente' e o paciente pedindo
   * para falar com gente; 'falha' e o sistema admitindo que travou. Os dois
   * merecem destaque diferente de uma resposta comum.
   */
  attentionReason:
    | 'atendente'
    | 'remarcacao'
    | 'cancelamento'
    | 'ajuda'
    | 'falha'
    | 'anexo'
    | 'cancelou_sozinho'
    | 'urgencia'
    | 'documento'
    | 'farmacia'
    | 'numero_errado'
    // Alerta de sangramento do Dr. Fabio (15/10/2026).
    | 'sangramento'
    // Talvez uma ligacao, sem a janela de 24h (16/10/2026, vindo do sistema do Dr. Marcello).
    | 'nao_suportada'
    | null
  /** Etapa em que o robo parou nesta conversa. Nulo quando nao ha nada aberto. */
  bookingState: string | null
  /** Saiu so do acompanhamento (15/10/2026): lembrete e resposta continuam. */
  semAcompanhamento?: boolean
  unreadCount: number
  lastMessageAt: string | null
  lastMessage: string
  /**
   * Todo o texto trocado nesta conversa, em minusculas, so para a busca. Vem
   * das mensagens que a listagem ja carrega para descobrir a ultima de cada
   * conversa - nao custa consulta nova.
   */
  textoBusca: string
  /**
   * Alguem da equipe escreveu DEPOIS da ultima mensagem do paciente.
   *
   * Existe porque abrir a conversa ja apaga a marca de atencao: quem le para
   * saber do que se trata perde o sinal e, meia hora depois, nao distingue mais
   * o que respondeu do que deixou para responder. Voltar na conversa uma a uma
   * era a unica forma de conferir.
   *
   * A resposta do robo nao conta. Ela sai sozinha em toda conversa e, se
   * contasse, praticamente tudo apareceria como resolvido - justamente o
   * contrario do que a marca serve para dizer. Por isso a pergunta e sobre
   * mensagem humana (automatic = false), que o banco separa desde 30/08/2026.
   */
  respondidaPelaEquipe: boolean
  /**
   * Nome dado pela equipe (botao Renomear, 20/10/2026, vindo do sistema do Dr.
   * Marcello). Quando existe, ja vem em patientName; este campo diz que o nome
   * e da equipe, e nao do cadastro.
   */
  nomePersonalizado?: string | null
  /** Nome do paciente do cadastro ligado a conversa, mesmo com nome da equipe. */
  nomeDoCadastro?: string | null
  /** A equipe desligou o robo so nesta conversa (23/10/2026). */
  roboDesligado?: boolean
}

export interface ConversationMessage {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  status: string
  templateName: string | null
  createdAt: string
  failureReason: string | null
  /** Link temporario do anexo, quando a mensagem trouxe arquivo. */
  anexoUrl: string | null
  /** Tipo do arquivo, para a tela decidir entre imagem, audio ou link. */
  anexoMime: string | null
  /** Caminho no acervo, para gerar um link novo na hora de abrir. */
  anexoPath: string | null
  /** Mensagem que esta responde, citada como no WhatsApp (20/10/2026). */
  respondeA?: string | null
}

/**
 * A lista de conversas, resumida no banco (25/09/2026).
 *
 * Ver a migration resumo_das_conversas: em vez de baixar todas as mensagens
 * para achar a ultima de cada conversa, o banco devolve uma linha por
 * conversa. Se a funcao ainda nao existir (migration nao rodou), cai no
 * caminho antigo e avisa no console - a lista nunca deixa de abrir.
 */
export async function listConversations(clinicId: string): Promise<Conversation[]> {
  try {
    const { data, error } = await buscarTodas((de, ate) =>
      (supabase as unknown as SupabaseClient).rpc('resumo_das_conversas', { p_clinic: clinicId }).range(de, ate),
    )
    if (error) throw error
    type Linha = {
      id: string
      patient_id: string | null
      display_phone: string | null
      wa_id: string | null
      profile_name: string | null
      status: string
      needs_attention: boolean
      attention_reason: string | null
      booking_state: string | null
      unread_count: number
      last_message_at: string | null
      ultima_mensagem: string | null
      respondida: boolean
    }
    const vistas = new Set<string>()
    const linhas = (data as Linha[]).filter((l) => !vistas.has(l.id) && vistas.add(l.id))
    const patientIds = [...new Set(linhas.map((l) => l.patient_id).filter(Boolean))] as string[]
    const { data: pacientes } = patientIds.length
      ? await supabase.from('patients').select('id,name').in('id', patientIds)
      : { data: [] as { id: string; name: string }[] }
    const nomePorId = new Map((pacientes ?? []).map((p) => [p.id, p.name]))
    // Coluna nova, lida a parte: sem ela, so a etiqueta some.
    const semAcompanhamento = new Set<string>()
    if (patientIds.length) {
      try {
        const { data: sairam, error } = await semTipo
          .from('patients')
          .select('id')
          .in('id', patientIds)
          .not('followup_opt_out_at', 'is', null)
        if (error) throw error
        for (const p of (sairam ?? []) as { id: string }[]) semAcompanhamento.add(p.id)
      } catch (erro) {
        console.warn('Sem patients.followup_opt_out_at; a etiqueta "Sem acompanhamento" fica de fora', erro)
      }
    }
    // Nome dado pela equipe (20/10/2026, vindo do sistema do Dr. Marcello):
    // coluna nova, lida a parte - sem ela, vale o nome do cadastro, como antes.
    const nomeDaEquipe = new Map<string, string>()
    try {
      const { data: renomeadas, error } = await semTipo
        .from('whatsapp_conversations')
        .select('id,nome_personalizado')
        .eq('clinic_id', clinicId)
        .not('nome_personalizado', 'is', null)
      if (error) throw error
      for (const c of (renomeadas ?? []) as { id: string; nome_personalizado: string }[]) {
        if (c.nome_personalizado.trim()) nomeDaEquipe.set(c.id, c.nome_personalizado.trim())
      }
    } catch (erro) {
      console.warn('Sem whatsapp_conversations.nome_personalizado; vale o nome do cadastro', erro)
    }
    // Robo desligado so nesta conversa (23/10/2026): coluna nova, lida a
    // parte - sem ela, o botao mostra o robo ligado, como o webhook o trata.
    const roboDesligado = new Set<string>()
    try {
      const { data: desligadas, error } = await semTipo
        .from('whatsapp_conversations')
        .select('id')
        .eq('clinic_id', clinicId)
        .not('robo_desligado_em', 'is', null)
      if (error) throw error
      for (const c of (desligadas ?? []) as { id: string }[]) roboDesligado.add(c.id)
    } catch (erro) {
      console.warn('Sem whatsapp_conversations.robo_desligado_em; o botao do robo por conversa fica como ligado', erro)
    }
    return linhas.map((row) => ({
      id: row.id,
      patientId: row.patient_id,
      semAcompanhamento: Boolean(row.patient_id && semAcompanhamento.has(row.patient_id)),
      patientName:
        nomeDaEquipe.get(row.id) || (row.patient_id && nomePorId.get(row.patient_id)) || 'Contato sem cadastro',
      nomePersonalizado: nomeDaEquipe.get(row.id) ?? null,
      nomeDoCadastro: (row.patient_id && nomePorId.get(row.patient_id)) || null,
      profileName: row.profile_name ?? '',
      phone: formatarTelefone(row.display_phone || row.wa_id || ''),
      phoneDigits: (row.display_phone || row.wa_id || '').replace(/\D/g, ''),
      status: row.status as Conversation['status'],
      needsAttention: row.needs_attention,
      attentionReason: (row.attention_reason ?? null) as Conversation['attentionReason'],
      bookingState: row.booking_state ?? null,
      unreadCount: row.unread_count,
      lastMessageAt: row.last_message_at,
      lastMessage: row.ultima_mensagem ?? '',
      // A busca no texto agora e feita no banco (buscarNasConversas).
      textoBusca: '',
      respondidaPelaEquipe: row.respondida,
      roboDesligado: roboDesligado.has(row.id),
    })) as Conversation[]
  } catch (causa) {
    console.warn('Resumo das conversas indisponível; usando o caminho antigo (baixa todas as mensagens)', causa)
    return listConversationsAntigo(clinicId)
  }
}

/** Conversas cujo texto contem o termo, procuradas no banco. null = busca indisponivel. */
export async function buscarNasConversas(clinicId: string, termo: string): Promise<Set<string> | null> {
  try {
    const { data, error } = await (supabase as unknown as SupabaseClient).rpc('buscar_nas_conversas', {
      p_clinic: clinicId,
      p_termo: termo,
    })
    if (error) throw error
    return new Set(((data ?? []) as { conversation_id: string }[]).map((l) => l.conversation_id))
  } catch (causa) {
    console.warn('Busca no texto das conversas indisponível', causa)
    return null
  }
}

async function listConversationsAntigo(clinicId: string): Promise<Conversation[]> {
  // Paginado, e nao uma consulta so: ver paginar.ts - o corte de 1.000 linhas
  // fez conversas antigas "abrirem sozinhas" em 24/09/2026.
  const { data, error } = await buscarTodas((de, ate) =>
    supabase
      .from('whatsapp_conversations')
      // Uma linha so, por mais longa que fique: o supabase-js le esta string em
      // tempo de compilacao para saber o tipo do resultado, e concatenar com +
      // faz ele desistir e devolver GenericStringError em todos os campos.
      .select('id,patient_id,display_phone,wa_id,profile_name,status,needs_attention,attention_reason,booking_state,unread_count,last_message_at')
      .eq('clinic_id', clinicId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('id')
      .range(de, ate),
  )

  if (error) fail(error)
  // Uma conversa que muda de posicao entre uma pagina e outra pode vir duas
  // vezes; a lista nao pode mostrar o mesmo cartao duplicado.
  const vistas = new Set<string>()
  const rows = data.filter((row) => !vistas.has(row.id) && vistas.add(row.id))
  if (rows.length === 0) return []

  // Nomes dos pacientes e ultima mensagem de cada conversa, em duas consultas
  // em vez de uma por conversa.
  const patientIds = [...new Set(rows.map((row) => row.patient_id).filter(Boolean))] as string[]
  const [patientsResult, messagesResult] = await Promise.all([
    patientIds.length
      ? supabase.from('patients').select('id,name').in('id', patientIds)
      : Promise.resolve({ data: [], error: null }),
    // Esta e a consulta que estourou: 1.672 mensagens em 24/09/2026, e so as
    // 1.000 mais novas chegavam. Toda conversa sem mensagem depois de 15/09
    // ficava sem "ultima mensagem" e sem resposta da equipe - e voltava a
    // aparecer como pendente.
    buscarTodas((de, ate) =>
      supabase
        .from('whatsapp_messages')
        .select('conversation_id,body,created_at,direction,automatic,status')
        .eq('clinic_id', clinicId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(de, ate),
    ),
  ])
  if (patientsResult.error) fail(patientsResult.error)
  if (messagesResult.error) fail(messagesResult.error)

  const nameById = new Map((patientsResult.data ?? []).map((p) => [p.id, p.name]))
  const lastBodyByConversation = new Map<string, string>()
  const textoPorConversa = new Map<string, string[]>()
  // Quem falou por ultimo, ignorando o robo. A lista ja vem da mais nova para a
  // mais antiga, entao a primeira mensagem que interessa de cada conversa e a
  // que decide - e o resto daquela conversa nao muda mais o veredito.
  const respondidaPorConversa = new Map<string, boolean>()
  for (const message of messagesResult.data ?? []) {
    if (!lastBodyByConversation.has(message.conversation_id)) {
      lastBodyByConversation.set(message.conversation_id, message.body)
    }
    if (!respondidaPorConversa.has(message.conversation_id)) {
      const doPaciente = message.direction === 'inbound'
      // Nao conta como resposta (23/09/2026): mensagem que falhou, porque nao
      // chegou; e o convite para retomar, porque ele nao responde nada - a
      // equipe esta esperando a familia, e a conversa nao pode encolher como
      // se estivesse encerrada.
      const convite = String(message.body ?? '').startsWith('Mensagem enviada para retomar o atendimento')
      const daEquipe =
        message.direction === 'outbound' &&
        message.automatic === false &&
        message.status !== 'failed' &&
        !convite
      if (doPaciente) respondidaPorConversa.set(message.conversation_id, false)
      else if (daEquipe) respondidaPorConversa.set(message.conversation_id, true)
    }
    const acumulado = textoPorConversa.get(message.conversation_id)
    if (acumulado) acumulado.push(message.body)
    else textoPorConversa.set(message.conversation_id, [message.body])
  }

  return rows.map((row) => ({
    id: row.id,
    patientId: row.patient_id,
    patientName: (row.patient_id && nameById.get(row.patient_id)) || 'Contato sem cadastro',
    profileName: row.profile_name ?? '',
    phone: formatarTelefone(row.display_phone || row.wa_id),
    phoneDigits: (row.display_phone || row.wa_id || '').replace(/\D/g, ''),
    status: row.status as Conversation['status'],
    needsAttention: row.needs_attention,
    attentionReason: (row.attention_reason ?? null) as Conversation['attentionReason'],
    bookingState: row.booking_state ?? null,
    unreadCount: row.unread_count,
    lastMessageAt: row.last_message_at,
    lastMessage: lastBodyByConversation.get(row.id) ?? '',
    textoBusca: (textoPorConversa.get(row.id) ?? []).join(' \n ').toLowerCase(),
    // Sem nenhuma mensagem humana nem do paciente - so o robo falou - a
    // conversa nao esta respondida: nao houve resposta nenhuma da equipe.
    respondidaPelaEquipe: respondidaPorConversa.get(row.id) ?? false,
  }))
}

/**
 * Liga conversas, mensagens e consultas do WhatsApp ao paciente recem-cadastrado.
 *
 * O robo so procura o paciente pelo telefone quando a mensagem chega. Sem esta
 * costura, cadastrar alguem depois deixaria a conversa como "Contato sem
 * cadastro" ate a proxima mensagem - e a consulta que a pessoa marcou sozinha
 * ficaria sem dono, fora do prontuario.
 */
export async function vincularContatoAoPaciente(patientId: string) {
  const { data, error } = await supabase.rpc('vincular_contato_ao_paciente', {
    p_patient_id: patientId,
  })
  if (error) fail(error)
  const linha = Array.isArray(data) ? data[0] : data
  return {
    conversas: linha?.conversas ?? 0,
    mensagens: linha?.mensagens ?? 0,
    consultas: linha?.consultas ?? 0,
  }
}

/**
 * O que o WhatsApp disse das mensagens de cada acompanhamento: lida,
 * entregue, enviada ou falhou (25/09/2026). A fila de acompanhamentos usa
 * para mostrar "Lida" em vez de um generico "enviado", e para devolver aos
 * atrasados o que falhou - enviado que nao chegou nao e enviado.
 */
export async function situacaoDosAcompanhamentos(followupIds: string[]): Promise<Map<string, string[]>> {
  const porAcompanhamento = new Map<string, string[]>()
  if (!followupIds.length) return porAcompanhamento
  // Em lotes: centenas de ids numa URL so estouram o limite do PostgREST.
  for (let i = 0; i < followupIds.length; i += 150) {
    const lote = followupIds.slice(i, i + 150)
    const { data, error } = await supabase
      .from('whatsapp_messages')
      .select('followup_id,status')
      .in('followup_id', lote)
      .eq('direction', 'outbound')
    if (error) fail(error)
    for (const linha of data ?? []) {
      if (!linha.followup_id) continue
      const lista = porAcompanhamento.get(linha.followup_id)
      if (lista) lista.push(linha.status)
      else porAcompanhamento.set(linha.followup_id, [linha.status])
    }
  }
  return porAcompanhamento
}

export async function listConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .select('id,direction,body,status,template_name,created_at,failure_reason')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) fail(error)
  const linhas = data ?? []
  const anexos = await anexosDasMensagens(conversationId)
  // Citacao (20/10/2026, vindo do sistema do Dr. Marcello): coluna nova, lida a
  // parte - sem ela, so a citacao some.
  const citada = new Map<string, string>()
  try {
    const { data: comCitacao, error: erroDaCitacao } = await semTipo
      .from('whatsapp_messages')
      .select('id,responde_a')
      .eq('conversation_id', conversationId)
      .not('responde_a', 'is', null)
    if (erroDaCitacao) throw erroDaCitacao
    for (const m of (comCitacao ?? []) as { id: string; responde_a: string }[]) citada.set(m.id, m.responde_a)
  } catch (erro) {
    console.warn('Sem whatsapp_messages.responde_a; as citacoes ficam de fora', erro)
  }

  return linhas.map((row) => ({
    id: row.id,
    direction: row.direction,
    body: row.body,
    status: row.status,
    templateName: row.template_name,
    createdAt: row.created_at,
    failureReason: row.failure_reason,
    anexoUrl: anexos.get(row.id)?.url ?? null,
    anexoMime: anexos.get(row.id)?.mime ?? null,
    anexoPath: anexos.get(row.id)?.path ?? null,
    respondeA: citada.get(row.id) ?? null,
  }))
}

/**
 * Os anexos da conversa, cada um com um link temporario.
 *
 * Consulta a parte, dentro de try/catch, porque as colunas sao mais novas que
 * os tipos gerados - e porque a conversa tem de abrir mesmo que o acervo esteja
 * fora do ar. Foi a licao de 19/09/2026: pedir coluna nova na consulta
 * principal derrubou a tela inteira quando a migration ainda nao tinha rodado.
 *
 * O link dura cinco minutos e nasce na hora. O arquivo e foto de exame, de
 * lesao, de crianca - link permanente seria prontuario circulando solto.
 */
async function anexosDasMensagens(conversationId: string) {
  const vazio = new Map<string, { url: string; mime: string | null; path: string }>()
  try {
    // O encadeamento cru termina num order() para virar promessa; a ordem
    // nao importa aqui, so o fato de a consulta ser executada.
    const { data, error } = await tabelaCrua('whatsapp_messages')
      .select('id,media_path,media_mime')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
    if (error) return vazio

    const comArquivo = ((data ?? []) as { id: string; media_path?: string | null; media_mime?: string | null }[])
      .filter((linha) => linha.media_path)
    if (comArquivo.length === 0) return vazio

    const { data: links } = await supabase.storage
      .from('whatsapp-anexos')
      .createSignedUrls(comArquivo.map((linha) => linha.media_path as string), 300)

    const porCaminho = new Map((links ?? []).map((l) => [l.path ?? '', l.signedUrl]))
    for (const linha of comArquivo) {
      const url = porCaminho.get(linha.media_path as string)
      if (url) vazio.set(linha.id, { url, mime: linha.media_mime ?? null, path: linha.media_path as string })
    }
  } catch {
    // Antes da migration rodar nao ha coluna nem acervo. A conversa segue.
  }
  return vazio
}

/**
 * Link novo, de cinco minutos, para abrir um anexo agora (25/09/2026).
 *
 * O link que vem com a conversa nasce quando ela abre; quem deixava a tela
 * aberta e clicava num anexo meia hora depois recebia "link expirado". Agora o
 * clique pede um link na hora - e ele continua valendo so cinco minutos.
 */
export async function linkDoAnexo(caminho: string): Promise<string> {
  const { data, error } = await supabase.storage.from('whatsapp-anexos').createSignedUrl(caminho, 300)
  if (error || !data?.signedUrl) throw new Error('Não consegui abrir o anexo. Tente de novo.')
  return data.signedUrl
}

/**
 * Zera o contador de nao lidas. So isso: a bandeira de atencao fica.
 *
 * Abrir e LER, e ler nao e atender. Ate 23/09/2026 abrir a conversa baixava a
 * bandeira de quase todos os motivos (so 2a via e farmacia sobreviviam). O
 * problema apareceu com "Quer falar com a equipe": quem administra o sistema
 * abria a conversa para acompanhar o robo, a etiqueta vermelha sumia, e a
 * recepcao do Dr. Marcello - que e quem responde de verdade - nunca via o
 * pedido. A familia ficava esperando uma pessoa que nao sabia que era esperada.
 *
 * Agora nenhum motivo cai na leitura. A bandeira baixa quando alguem da equipe
 * responde pela tela (whatsapp-reply), quando concluem a conversa ou quando
 * destravam o robo. Cada um desses e uma decisao; abrir para olhar nao e.
 */
export async function markConversationSeen(conversationId: string) {
  const { error } = await supabase
    .from('whatsapp_conversations')
    .update({ unread_count: 0 })
    .eq('id', conversationId)
  if (error) fail(error)
}

/**
 * Solta o robo numa conversa.
 *
 * Zera a etapa em que ele parou e apaga a bandeira de atencao, para a proxima
 * mensagem do paciente comecar do menu. Nao apaga mensagem, consulta nem
 * cadastro: so o rascunho do atendimento automatico.
 */
export async function resetConversationBot(
  conversationId: string,
  /**
   * Grava a hora do Destravar, que faz o robo ignorar o que a equipe escreveu
   * antes. Falso no Concluir (09/10/2026): a equipe tem o costume de escrever
   * "Em que posso ajudar?" e concluir em seguida para limpar a lista. Com a
   * hora gravada, a resposta da familia - que era para a equipe - recebia o
   * menu do robo (Juliana e Bianca, 08 e 09/10). Concluir limpa a etapa presa;
   * so o Destravar devolve a conversa ao robo antes das 12h.
   */
  liberarRobo = true,
) {
  const { error } = await supabase
    .from('whatsapp_conversations')
    .update({
      booking_state: null,
      booking_options: null,
      booking_unit_id: null,
      booking_patient_id: null,
      booking_replaces_id: null,
      // A coluna existe no banco; os tipos gerados ainda nao a conhecem.
      ...({ booking_intake_id: null } as Record<string, unknown>),
      booking_updated_at: new Date().toISOString(),
      // Zerar tambem o menu_sent_at faz o robo poder recomecar na hora, sem
      // esperar o intervalo que evita repetir o menu.
      menu_sent_at: null,
      // E a contagem de respostas prontas dadas na espera pela equipe: soltar o
      // robo com o limite ja estourado seria soltar pela metade.
      ...({ auto_replies_while_waiting: 0 } as Record<string, unknown>),
      needs_attention: false,
      attention_reason: null,
    })
    .eq('id', conversationId)
  if (error) fail(error)

  // A hora do Destravar (01/10/2026): o robo deixa de contar o que a equipe
  // escreveu antes dela. Update separado porque a coluna e nova - se o banco
  // ainda nao a tem, o destravar de cima continua valendo e so isto se perde.
  if (!liberarRobo) return
  const { error: erroDaHora } = await (supabase as unknown as SupabaseClient)
    .from('whatsapp_conversations')
    .update({ robo_liberado_em: new Date().toISOString() })
    .eq('id', conversationId)
  if (erroDaHora) console.warn('Destravar: nao consegui gravar a hora; o robo pode seguir calado ate 12h', erroDaHora)
}

export interface AutoReplySettings {
  enabled: boolean
  /** Saudacao mostrada acima do menu para quem nao esta cadastrado. */
  text: string
  /** Saudacao para quem o sistema reconhece pelo telefone. Aceita {nome}. */
  knownText: string
  /** Conteudo da opcao 1 do menu: valores, contatos e orientacoes. */
  infoText: string
}

/** Menu automatico enviado a quem escreve para o numero da clinica. */
export async function getAutoReply(clinicId: string): Promise<AutoReplySettings> {
  const { data, error } = await supabase
    .from('clinic_settings')
    .select(
      'whatsapp_autoreply_enabled,whatsapp_autoreply_text,whatsapp_autoreply_known_text,whatsapp_menu_info_text',
    )
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (error) fail(error)
  return {
    enabled: data?.whatsapp_autoreply_enabled ?? false,
    text: data?.whatsapp_autoreply_text ?? '',
    knownText: data?.whatsapp_autoreply_known_text ?? '',
    infoText: data?.whatsapp_menu_info_text ?? '',
  }
}

export async function saveAutoReply(clinicId: string, prefs: AutoReplySettings) {
  const { error } = await supabase
    .from('clinic_settings')
    .update({
      whatsapp_autoreply_enabled: prefs.enabled,
      whatsapp_autoreply_text: prefs.text,
      whatsapp_autoreply_known_text: prefs.knownText,
      whatsapp_menu_info_text: prefs.infoText,
    })
    .eq('clinic_id', clinicId)
  if (error) fail(error)
}

/** A segunda leitura das mensagens pelo Jev (ver supabase/functions/_shared/segunda-leitura.ts). */
export type ModoDoJev = 'desligada' | 'sombra' | 'ligada'

/**
 * O modo do Jev (17/10/2026), em consulta separada: a coluna e nova, e o
 * Postgres recusa a query inteira quando uma coluna nao existe.
 */
export async function getModoDoJev(clinicId: string): Promise<ModoDoJev> {
  const { data, error } = await (supabase as unknown as SupabaseClient)
    .from('clinic_settings')
    .select('jev_segunda_leitura')
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (error) fail(error)
  const modo = String(data?.jev_segunda_leitura ?? '')
  return modo === 'ligada' || modo === 'sombra' ? modo : 'desligada'
}

export async function saveModoDoJev(clinicId: string, modo: ModoDoJev): Promise<void> {
  const { data, error } = await (supabase as unknown as SupabaseClient)
    .from('clinic_settings')
    .update({ jev_segunda_leitura: modo })
    .eq('clinic_id', clinicId)
    .select('jev_segunda_leitura')
  if (error) fail(error)
  // Quem nao e o responsavel pela clinica passa pela politica do banco sem
  // erro e sem mudar linha nenhuma. Sem esta conferencia a tela diria "salvo".
  if (!data?.length || data[0]?.jev_segunda_leitura !== modo) {
    throw new Error('Não foi possível salvar: só o responsável pela clínica muda esta opção.')
  }
}

/**
 * O envio automatico das 9h dos acompanhamentos de 15, 30 e 90 dias
 * (17/10/2026), em consulta separada: a coluna e nova. Ligado por padrao.
 */
export async function getAcompanhamentoAutomatico(clinicId: string): Promise<boolean> {
  const { data, error } = await (supabase as unknown as SupabaseClient)
    .from('clinic_settings')
    .select('acompanhamento_automatico')
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (error) fail(error)
  return data?.acompanhamento_automatico !== false
}

export async function saveAcompanhamentoAutomatico(clinicId: string, ligado: boolean): Promise<void> {
  const { data, error } = await (supabase as unknown as SupabaseClient)
    .from('clinic_settings')
    .update({ acompanhamento_automatico: ligado })
    .eq('clinic_id', clinicId)
    .select('acompanhamento_automatico')
  if (error) fail(error)
  // Mesma conferencia do modo do Jev: sem linha gravada de volta, a tela nao
  // pode dizer "salvo".
  if (!data?.length || data[0]?.acompanhamento_automatico !== ligado) {
    throw new Error('Não foi possível salvar: só o responsável pela clínica muda esta opção.')
  }
}

export interface UltimaLeituraDoJev {
  detalhe: string
  quando: string
}

/** O ultimo evento segunda_leitura do robo, para Preferencias mostrar se o Jev esta lendo. */
export async function getUltimaLeituraDoJev(clinicId: string): Promise<UltimaLeituraDoJev | null> {
  const { data, error } = await (supabase as unknown as SupabaseClient)
    .from('whatsapp_bot_events')
    .select('detalhe,criado_em')
    .eq('clinic_id', clinicId)
    .eq('evento', 'segunda_leitura')
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) fail(error)
  return data ? { detalhe: String(data.detalhe ?? ''), quando: String(data.criado_em) } : null
}

/**
 * Os celulares do alerta de urgencia no WhatsApp (17/10/2026, ver
 * supabase/functions/_shared/alerta-de-urgencia.ts), o do medico primeiro. Em
 * consulta separada: a coluna e nova, e o Postgres recusa a query inteira
 * quando uma coluna nao existe.
 */
export async function getTelefonesDoAlerta(clinicId: string): Promise<string[]> {
  const { data, error } = await (supabase as unknown as SupabaseClient)
    .from('clinic_settings')
    .select('alerta_urgencia_telefones')
    .eq('clinic_id', clinicId)
    .maybeSingle()
  if (error) fail(error)
  const lista = data?.alerta_urgencia_telefones
  return Array.isArray(lista) ? lista.map(String) : []
}

export async function saveTelefonesDoAlerta(clinicId: string, numeros: string[]): Promise<void> {
  const { data, error } = await (supabase as unknown as SupabaseClient)
    .from('clinic_settings')
    .update({ alerta_urgencia_telefones: numeros })
    .eq('clinic_id', clinicId)
    .select('alerta_urgencia_telefones')
  if (error) fail(error)
  // Mesma conferencia do modo do Jev: sem linha gravada de volta, a tela nao
  // pode dizer "salvo".
  if (!data?.length) throw new Error('Não foi possível salvar: só o responsável pela clínica muda os números do alerta.')
}

export interface ResultadoDoAlertaDeTeste {
  nota: string
  falhou: boolean
}

/** O alerta de teste, no WhatsApp dos numeros salvos (botao em Preferencias). */
export async function testarAlertaDeUrgencia(clinicId: string): Promise<ResultadoDoAlertaDeTeste> {
  const { data, error } = await supabase.functions.invoke('notificar-equipe', { body: { acao: 'alerta_teste', clinicId } })
  if (error) throw new Error(await motivoDaFuncao(error, data, 'Não foi possível mandar o alerta de teste.'))
  const r = data as { nota?: string; falhou?: boolean; error?: string } | null
  if (r?.error) throw new Error(r.error)
  return { nota: String(r?.nota ?? ''), falhou: Boolean(r?.falhou) }
}

export interface UltimoAlerta {
  quem: string
  quando: string
  teste: boolean
  veredito: string | null
  enviado: boolean
}

/** O ultimo alerta de urgencia da clinica, para Preferencias mostrar se o alerta esta saindo. */
export async function getUltimoAlerta(clinicId: string): Promise<UltimoAlerta | null> {
  const { data, error } = await (supabase as unknown as SupabaseClient)
    .from('alertas_de_urgencia')
    .select('quem,criado_em,teste,veredito,mensagens')
    .eq('clinic_id', clinicId)
    .order('criado_em', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) fail(error)
  if (!data) return null
  return {
    quem: String(data.quem ?? ''),
    quando: String(data.criado_em),
    teste: Boolean(data.teste),
    veredito: (data.veredito as string | null) ?? null,
    enviado: Array.isArray(data.mensagens) && data.mensagens.length > 0,
  }
}

/**
 * Liga ou desliga o robo inteiro de uma vez (23/10/2026, vindo do sistema do
 * Dr. Marcello, onde o Edu pediu um botao de emergencia depois que o robo
 * ofereceu horario e preco para quem so tinha dito "eu nao passei em
 * consulta"). A chave e a mesma do menu automatico, mas grava SO ela:
 * saveAutoReply regravaria tambem os textos, e um rascunho meio editado no
 * painel iria para o ar junto com o clique. Devolve o valor que ficou no banco,
 * para a tela mostrar o que vale de fato.
 */
export async function ligarRobo(clinicId: string, ligado: boolean): Promise<boolean> {
  const { data, error } = await supabase
    .from('clinic_settings')
    .update({ whatsapp_autoreply_enabled: ligado })
    .eq('clinic_id', clinicId)
    .select('whatsapp_autoreply_enabled')
    .single()
  if (error) fail(error)
  return Boolean(data?.whatsapp_autoreply_enabled)
}

/**
 * Ate quando a equipe pode responder em texto livre nesta conversa.
 * A Meta so permite isso por 24h depois da ultima mensagem do paciente; depois
 * disso, apenas modelo aprovado. Devolve null quando o paciente nunca escreveu.
 */
export async function getReplyWindow(conversationId: string): Promise<string | null> {
  // "[unsupported]" (talvez uma ligacao) nao abre a janela de 24h: responder
  // texto livre ali volta "Message undeliverable" (16/10/2026, vindo do sistema
  // do Dr. Marcello).
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .neq('message_type', 'unsupported')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) fail(error)
  if (!data) return null
  return new Date(new Date(data.created_at).getTime() + 24 * 3600 * 1000).toISOString()
}

/**
 * O motivo, em português, que a Edge Function devolveu.
 *
 * As funções recusam com uma frase pronta ("esta pessoa não tem consulta futura
 * marcada", "a janela de 24 horas fechou"). Só que o supabase-js embrulha
 * qualquer status fora do 2xx num FunctionsHttpError cujo `context` é a Response
 * crua - e ali `body` é um stream, não o JSON já lido. Nós líamos
 * `context.body.error`, que é sempre undefined: o motivo real se perdia e a tela
 * mostrava a frase genérica, ou nada que explicasse o 409 do console.
 *
 * O `clone()` existe porque o corpo só pode ser lido uma vez.
 */
async function motivoDaFuncao(causa: unknown, data: unknown, padrao: string): Promise<string> {
  const contexto = (causa as { context?: unknown }).context
  if (contexto instanceof Response) {
    try {
      const corpo = (await contexto.clone().json()) as { error?: string } | null
      if (corpo?.error) return corpo.error
    } catch {
      // Corpo vazio ou que não é JSON: fica o texto padrão.
    }
  }
  return (data as { error?: string } | null)?.error || padrao
}

/**
 * Manda o menu do robo para a conversa e devolve a pessoa ao atendimento
 * automatico. So funciona com a janela de 24h aberta, como qualquer mensagem.
 */
export async function sendConversationMenu(conversationId: string) {
  const { data, error } = await supabase.functions.invoke('whatsapp-reply', {
    body: { conversationId, menu: true },
  })
  if (error) {
    throw new Error(await motivoDaFuncao(error, data, 'Não foi possível enviar o menu.'))
  }
  if ((data as { error?: string } | null)?.error) {
    throw new Error((data as { error: string }).error)
  }
}

/**
 * O veredito de quem atende sobre uma urgencia (17/10/2026, ver
 * supabase/functions/_shared/veredito.ts): o servidor manda o texto fixo ao
 * paciente, muda o motivo da conversa e registra o veredito.
 */
export async function sendUrgencyVerdict(conversationId: string, veredito: 'urgente' | 'nao_urgente') {
  const { data, error } = await supabase.functions.invoke('whatsapp-reply', {
    body: { conversationId, veredito },
  })
  if (error) {
    throw new Error(await motivoDaFuncao(error, data, 'Não foi possível enviar o veredito.'))
  }
  if ((data as { error?: string } | null)?.error) {
    throw new Error((data as { error: string }).error)
  }
}

/**
 * Manda os horarios livres de uma unidade pela lista tocavel do robo
 * (14/10/2026, botao "Mandar horarios"). A familia toca no dia e no horario,
 * e o robo marca a consulta.
 *
 * Com irmaos no mesmo telefone e sem paciente escolhido, nada e enviado:
 * volta a lista para a equipe escolher de quem e a consulta.
 */
export type PedidoDeHorarios = {
  /** Id da unidade, ou 'telemedicina'. */
  unidade: string
  de?: string | null
  ate?: string | null
  pacienteId?: string | null
}

export async function sendConversationSlots(
  conversationId: string,
  pedido: PedidoDeHorarios,
): Promise<{ escolherPaciente?: { id: string; nome: string }[] }> {
  const { data, error } = await supabase.functions.invoke('whatsapp-reply', {
    body: { conversationId, horarios: pedido },
  })
  if (error) {
    throw new Error(await motivoDaFuncao(error, data, 'Não foi possível mandar os horários.'))
  }
  const resposta = data as { error?: string; escolherPaciente?: { id: string; nome: string }[] } | null
  if (resposta?.error) throw new Error(resposta.error)
  return { escolherPaciente: resposta?.escolherPaciente }
}

/**
 * Refaz as perguntas do cadastro na conversa, a pedido da equipe.
 *
 * Para quem marcou e abandonou a ficha: em vez de ligar atrás do CPF, a
 * recepção dispara o questionário e o robô conduz, como teria feito na hora.
 */
export async function sendConversationQuestionnaire(conversationId: string) {
  const { data, error } = await supabase.functions.invoke('whatsapp-reply', {
    body: { conversationId, questionario: true },
  })
  if (error) {
    throw new Error(await motivoDaFuncao(error, data, 'Não foi possível enviar o questionário.'))
  }
  if ((data as { error?: string } | null)?.error) {
    throw new Error((data as { error: string }).error)
  }
}

/**
 * Envia um arquivo da equipe (PDF, imagem, Word, Excel), com o texto como
 * legenda. Mesma funcao do texto, em formulario: o servidor revalida a janela
 * de 24h, guarda o arquivo no acervo e manda pela Meta (24/09/2026).
 */
export async function sendConversationFile(conversationId: string, arquivo: File, legenda: string, respondeA: string | null = null) {
  const corpo = new FormData()
  corpo.append('conversationId', conversationId)
  corpo.append('text', legenda)
  corpo.append('arquivo', arquivo)
  if (respondeA) corpo.append('respondeA', respondeA)
  await invokeWithFormData('whatsapp-reply', corpo)
}

/** Envia uma resposta escrita pela equipe. O servidor revalida a janela de 24h. */
export async function sendConversationReply(
  conversationId: string,
  text: string,
  /** Verdadeiro para aviso do sistema; falso para o que a equipe digitou. */
  automatico = false,
  /** Mensagem citada, como o "responder" do WhatsApp (20/10/2026). */
  respondeA: string | null = null,
) {
  const { data, error } = await supabase.functions.invoke('whatsapp-reply', {
    body: { conversationId, text, automatico, ...(respondeA ? { respondeA } : {}) },
  })
  if (error) {
    // O corpo da resposta traz a mensagem em portugues; o error do invoke traz
    // so "non-2xx status code", que nao ajuda ninguem na tela.
    throw new Error(await motivoDaFuncao(error, data, 'Não foi possível enviar a mensagem.'))
  }
  if ((data as { error?: string } | null)?.error) {
    throw new Error((data as { error: string }).error)
  }
}

/**
 * Da um nome a conversa, na tela (20/10/2026, vindo do sistema do Dr.
 * Marcello). Vazio volta ao nome do cadastro ou do WhatsApp. O cadastro do
 * paciente nao muda.
 */
export async function renomearConversa(conversationId: string, nome: string) {
  const limpo = nome.trim().replace(/\s+/g, ' ').slice(0, 120)
  const { error } = await semTipo
    .from('whatsapp_conversations')
    .update({ nome_personalizado: limpo || null })
    .eq('id', conversationId)
  if (error) {
    throw new Error(
      /nome_personalizado/.test(error.message ?? '')
        ? 'O sistema ainda está sendo atualizado. Tente renomear de novo em alguns minutos.'
        : 'Não foi possível renomear a conversa.',
    )
  }
}

/**
 * Liga ou desliga o robo so nesta conversa (23/10/2026, vindo do sistema do
 * Dr. Marcello). O botao geral calava o robo para todos os pacientes; o Edu
 * queria por conversa. Grava so a coluna nova e confere o que ficou no banco:
 * botao dizendo "desligado" com o robo ainda falando e o pior resultado
 * possivel aqui.
 */
export async function desligarRoboNaConversa(conversationId: string, desligar: boolean): Promise<boolean> {
  const { data, error } = await semTipo
    .from('whatsapp_conversations')
    .update({ robo_desligado_em: desligar ? new Date().toISOString() : null })
    .eq('id', conversationId)
    .select('robo_desligado_em')
    .single()
  if (error) {
    throw new Error(
      /robo_desligado_em/.test(error.message ?? '')
        ? 'O sistema ainda está sendo atualizado. Tente de novo em alguns minutos.'
        : 'Não foi possível mudar o robô desta conversa.',
    )
  }
  return Boolean((data as { robo_desligado_em?: string | null } | null)?.robo_desligado_em)
}

/**
 * "Este numero nao e do paciente": desliga a conversa do cadastro (20/10/2026).
 * Ver desvincular_conversa_do_paciente.
 */
export async function desligarConversaDoPaciente(conversationId: string) {
  const { error } = await semTipo.rpc('desvincular_conversa_do_paciente', {
    p_conversation_id: conversationId,
  })
  if (error) fail(error)
}

/**
 * Marca a conversa como resolvida sem apagar o historico.
 *
 * Solta o robo junto. Ate 23/09/2026 concluir so mudava o status, e uma
 * conversa com o robo parado no meio de uma etapa ("aguardando_convenio",
 * depois que o Trasmontano saiu) continuava com o cartao aberto e o botao
 * Destravar - a tela nao encolhe conversa com robo preso, de proposito. Quem
 * conclui esta dizendo que nada ali espera a clinica; o rascunho do
 * agendamento vai junto, e a proxima mensagem da familia comeca do menu.
 */
export async function resolveConversation(conversationId: string) {
  // Primeiro o robo: se isto falhar, a conversa nao fica "concluida" com o
  // robo ainda preso, que e o estado que gerou a pergunta.
  await resetConversationBot(conversationId, false)
  const { error } = await supabase
    .from('whatsapp_conversations')
    .update({ status: 'resolved', needs_attention: false, attention_reason: null, unread_count: 0 })
    .eq('id', conversationId)
  if (error) fail(error)
}

/**
 * Desfaz o "resolvida".
 *
 * Marcar como resolvida e um clique num botao pequeno, ao lado de outros, e
 * ate 09/09/2026 nao havia como desmarcar: a conversa so voltava a "aberta"
 * quando o paciente escrevesse de novo. Um erro de clique nao deveria depender
 * de outra pessoa para se corrigir.
 *
 * Nao reacende a bandeira de atencao nem mexe nas nao lidas: quem reabre esta
 * olhando para a conversa agora.
 */
/**
 * A equipe decide voltar a falar com quem pediu para sair (15/10/2026). Sem
 * isto, a conversa so reabria quando a pessoa escrevesse de novo (ver
 * depoisDoPedidoDeSair no webhook), e ate la a equipe nao conseguia responder.
 * Com paciente vinculado, tira tambem a marca do cadastro, senao lembrete e
 * acompanhamento continuariam barrados sem ninguem saber por que.
 */
export async function voltarAEnviarMensagens(conversationId: string, patientId: string | null) {
  const { error } = await supabase
    .from('whatsapp_conversations')
    .update({ status: 'open' })
    .eq('id', conversationId)
  if (error) fail(error)
  if (patientId) {
    // semTipo: a coluna existe desde 22/08/2026, mas os tipos gerados nao a conhecem.
    const { error: erroDoCadastro } = await semTipo
      .from('patients')
      .update({ whatsapp_opt_out_at: null })
      .eq('id', patientId)
    if (erroDoCadastro) fail(erroDoCadastro)
    // A marca so do acompanhamento (15/10/2026), a parte: a coluna pode faltar.
    const { error: semColuna } = await semTipo
      .from('patients')
      .update({ followup_opt_out_at: null })
      .eq('id', patientId)
    if (semColuna) console.warn('Sem patients.followup_opt_out_at para limpar', semColuna)
  }
}

export async function unresolveConversation(conversationId: string) {
  const { error } = await supabase
    .from('whatsapp_conversations')
    .update({ status: 'open' })
    .eq('id', conversationId)
  if (error) fail(error)
}

/**
 * Marca os acompanhamentos pendentes cuja consulta nao aconteceu (23/10/2026,
 * vindo do sistema do Dr. Marcello): o envio automatico os segura, e a tela
 * dizia "sai automatico hoje as 9h". Mesma regra do servidor
 * (consultasQueNaoAconteceram). Se a leitura falhar, a tela fica como antes - e
 * o console diz.
 */
async function marcarSemConsulta(clinicId: string, linhas: FollowupRow[]) {
  try {
    const pendentes = linhas.filter((l) => toUiStatus(l.status) === 'pendente' && l.consultation_id)
    const ids = [...new Set(pendentes.map((l) => String(l.consultation_id)))]
    if (!ids.length) return
    const consultas: ConsultaDaAgenda[] = []
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await semTipo
        .from('consultations')
        .select('id,clinic_id,patient_id,consultation_date,chief_complaint,clinical_history,assessment,plan')
        .eq('clinic_id', clinicId)
        .in('id', ids.slice(i, i + 100))
      if (error) throw error
      consultas.push(...((data ?? []) as ConsultaDaAgenda[]))
    }
    const pacientes = [...new Set(consultas.map((c) => c.patient_id))]
    const agenda: HorarioDaAgenda[] = []
    for (let i = 0; i < pacientes.length; i += 100) {
      const { data, error } = await semTipo
        .from('appointments')
        .select('patient_id,clinic_id,starts_at,status')
        .eq('clinic_id', clinicId)
        .in('patient_id', pacientes.slice(i, i + 100))
      if (error) throw error
      agenda.push(...((data ?? []) as HorarioDaAgenda[]))
    }
    const fora = consultasQueNaoAconteceram(consultas, agenda)
    for (const l of pendentes) if (fora.has(String(l.consultation_id))) l.semConsulta = true
  } catch (erro) {
    console.warn('Nao consegui conferir as consultas dos acompanhamentos; a etiqueta "nao sai sozinho" fica de fora', erro)
  }
}

/**
 * Separa atendidos de pre-agendados (25/10/2026, vindo do sistema do Dr.
 * Marcello; ver lib/paciente-atendido.ts).
 *
 * Leitura a parte e em try/catch: se falhar, ninguem e marcado e a tela fica
 * como antes, todo mundo junto - perder a separacao e arranhao, perder a lista
 * de pacientes nao. O prontuario so e lido de quem a agenda nao resolveu, e so
 * volta para quem enxerga consultas (a recepcao recebe vazio, sem erro).
 */
async function marcarAtendidos(clinicId: string, pacientes: Patient[]) {
  try {
    const { data: agenda, error } = await buscarTodas((de, ate) =>
      supabase
        .from('appointments')
        .select('patient_id,starts_at,status')
        .eq('clinic_id', clinicId)
        .not('patient_id', 'is', null)
        .order('id')
        .range(de, ate),
    )
    if (error) throw error
    const horarios = ((agenda ?? []) as { patient_id: string; starts_at: string; status: string }[]).map((a) => ({
      patientId: a.patient_id,
      startsAt: a.starts_at,
      status: a.status,
    }))
    const hoje = diaEmSaoPaulo(new Date().toISOString())
    let atendidos = pacientesAtendidos(pacientes, horarios, new Set(), hoje)

    const restantes = pacientes.filter((p) => !atendidos.has(p.id)).map((p) => p.id)
    const comProntuario = new Set<string>()
    for (let i = 0; i < restantes.length; i += 100) {
      const { data: consultas, error: erroDasConsultas } = await semTipo
        .from('consultations')
        .select('patient_id,chief_complaint,clinical_history,assessment,plan')
        .eq('clinic_id', clinicId)
        .in('patient_id', restantes.slice(i, i + 100))
      if (erroDasConsultas) throw erroDasConsultas
      for (const c of (consultas ?? []) as (ConsultaDoAcompanhamento & { patient_id: string })[]) {
        if (temProntuario(c)) comProntuario.add(c.patient_id)
      }
    }
    if (comProntuario.size) atendidos = pacientesAtendidos(pacientes, horarios, comProntuario, hoje)
    for (const p of pacientes) p.atendido = atendidos.has(p.id)
  } catch (erro) {
    console.warn('Nao consegui separar atendidos de pre-agendados; a lista fica toda junta', erro)
  }
}

export async function fetchDb(
  clinicId: string,
  defaults: Record<FollowupKey, string>,
): Promise<Db> {
  // Pacientes e acompanhamentos paginados pelo mesmo motivo das mensagens (ver
  // paginar.ts). Em 24/09/2026 eram 48 e 164, longe do corte - mas o corte e
  // silencioso, e paciente sumindo da lista so seria notado por quem sentisse
  // falta dele.
  const [patientsResult, followupsResult, settingsResult] = await Promise.all([
    buscarTodas((de, ate) =>
      supabase
        .from('patients')
        .select('*')
        .eq('clinic_id', clinicId)
        .is('archived_at', null)
        .order('created_at', { ascending: false })
        .order('id')
        .range(de, ate),
    ),
    buscarTodas((de, ate) =>
      supabase
        .from('followups')
        .select('id,patient_id,followup_key,status,opened_at,consultation_id')
        .eq('clinic_id', clinicId)
        .is('archived_at', null)
        .order('id')
        .range(de, ate),
    ),
    supabase
      .from('clinic_settings')
      .select('template_d30,template_m90,template_d15')
      .eq('clinic_id', clinicId)
      .maybeSingle(),
  ])

  if (patientsResult.error) fail(patientsResult.error)
  if (followupsResult.error) fail(followupsResult.error)
  if (settingsResult.error) fail(settingsResult.error)

  const followupRows = (followupsResult.data ?? []) as FollowupRow[]
  await marcarSemConsulta(clinicId, followupRows)
  const byPatient = new Map<string, FollowupRow[]>()
  for (const item of followupRows) {
    const list = byPatient.get(item.patient_id) ?? []
    list.push(item)
    byPatient.set(item.patient_id, list)
  }

  const settings = settingsResult.data as SettingsRow | null
  // Etapas ligadas (19/10/2026, vindo do sistema do Dr. Marcello): coluna nova,
  // lida a parte - sem ela, as tres.
  let etapas: FollowupKey[] = [...FOLLOWUP_KEYS]
  try {
    const { data: ajustes, error: erroDasEtapas } = await semTipo
      .from('clinic_settings')
      .select('followup_etapas')
      .eq('clinic_id', clinicId)
      .maybeSingle()
    if (erroDasEtapas) throw erroDasEtapas
    const lidas = ((ajustes as { followup_etapas?: string[] | null } | null)?.followup_etapas ?? [])
      .filter((k): k is FollowupKey => (FOLLOWUP_KEYS as string[]).includes(k))
    if (lidas.length) etapas = lidas
  } catch (erro) {
    console.warn('Sem clinic_settings.followup_etapas; as tres etapas valem', erro)
  }
  const patients = ((patientsResult.data ?? []) as PatientRow[]).map((patient) =>
    mapPatient(patient, byPatient.get(patient.id) ?? []),
  )
  await marcarAtendidos(clinicId, patients)
  return {
    etapas,
    patients,
    templates: {
      d15: (settings as { template_d15?: string } | null)?.template_d15 ?? defaults.d15,
      d30: settings?.template_d30 ?? defaults.d30,
      m90: settings?.template_m90 ?? defaults.m90,
    },
  }
}

export async function createPatient(clinicId: string, draft: PatientDraft) {
  const { data, error } = await supabase
    .from('patients')
    // O cast some quando os tipos do Supabase forem regerados: hoje eles
    // ainda nao conhecem cpf e email, e o cliente recusa campo desconhecido.
    .insert({ clinic_id: clinicId, ...patientCreatePayload(draft) } as PatientInsert)
    .select('*')
    .single()

  if (error) fail(error)
  // Consulta marcada antes do cadastro ganha a ficha nova (05/10/2026). Ver
  // vincularConsultasSemFicha. Falhar aqui nao desfaz o cadastro.
  try {
    await vincularConsultasSemFicha(clinicId, data.id, data.name, data.phone)
  } catch (erro) {
    console.warn('Cadastro salvo, mas nao consegui ligar as consultas ja marcadas a ficha', erro)
  }
  const followups = await followupsForPatient(clinicId, data.id)
  return mapPatient(data as PatientRow, followups)
}

/**
 * Liga a ficha recem-criada as consultas futuras marcadas so com nome e
 * telefone (05/10/2026).
 *
 * Caso da Ana Vitoria: a recepcao marcou 14/10 15:20 com nome e WhatsApp
 * (13:01), criou o cadastro (13:04) e, para a consulta "pegar" a ficha,
 * cancelou e marcou de novo no mesmo horario (13:05). O cancelamento mandou
 * "foi cancelada, conforme voce pediu" para uma mae que nao tinha pedido nada.
 * Com o vinculo automatico, cadastrar basta.
 *
 * Mesma regra de irmaos de marcarComparecimento: pelo nome casa sempre; pelo
 * telefone, so se for a UNICA consulta sem ficha daquele numero - com dois
 * filhos no mesmo celular, o telefone nao diz qual e qual.
 */
async function vincularConsultasSemFicha(clinicId: string, patientId: string, nome: string, telefone: string | null) {
  const digitos = (telefone ?? '').replace(/\D/g, '')
  const finalDoTelefone = digitos.length >= 8 ? digitos.slice(-8) : ''
  const nomeLimpo = (nome ?? '').trim().toLowerCase()
  if (!finalDoTelefone && !nomeLimpo) return

  const { data, error } = await supabase
    .from('appointments')
    .select('id,contact_name,contact_phone')
    .eq('clinic_id', clinicId)
    .is('patient_id', null)
    .neq('status', 'cancelled')
    .gte('starts_at', new Date(Date.now() - 12 * 3600 * 1000).toISOString())
  if (error) throw error

  const semFicha = data ?? []
  const ids = new Set<string>()
  for (const a of semFicha) {
    if (nomeLimpo && (a.contact_name ?? '').trim().toLowerCase() === nomeLimpo) ids.add(a.id)
  }
  const peloTelefone = semFicha.filter(
    (a) => Boolean(finalDoTelefone) && (a.contact_phone ?? '').replace(/\D/g, '').endsWith(finalDoTelefone),
  )
  if (peloTelefone.length === 1) ids.add(peloTelefone[0].id)
  if (ids.size === 0) return

  const { error: erroDoVinculo } = await supabase
    .from('appointments')
    .update({ patient_id: patientId })
    .in('id', [...ids])
  if (erroDoVinculo) throw erroDoVinculo
}

export async function listConsultations(clinicId: string, patientId: string) {
  const { data, error } = await supabase
    .from('consultations')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .is('archived_at', null)
    .order('consultation_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) fail(error)
  return ((data ?? []) as ConsultationRow[]).map(mapConsultation)
}

/**
 * Campos clinicos de uma consulta. Se todos estiverem vazios, ela nunca foi
 * escrita por ninguem - e so o esqueleto que o cadastro cria.
 */
const CAMPOS_CLINICOS = [
  'chief_complaint',
  'clinical_history',
  'personal_history',
  'family_history',
  'allergies',
  'current_medications',
  'physical_exam',
  'assessment',
  'plan',
  'prescription',
  'return_plan',
  'notes',
  'cid',
] as const

function semConteudoClinico(linha: ConsultationRow) {
  const texto = (v: unknown) => String(v ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
  return (
    CAMPOS_CLINICOS.every((campo) => !texto((linha as unknown as Record<string, unknown>)[campo])) &&
    linha.weight_kg === null &&
    linha.height_cm === null
  )
}

/** Atendimento escrito e ainda sem assinatura digital. */
export interface AtendimentoSemAssinatura {
  id: string
  patientId: string
  paciente: string
  data: string
}

/**
 * Atendimentos escritos e nao assinados, do mais recente para o mais antigo
 * (06/10/2026).
 *
 * Pedido do Dr. Marcello: "consegue colocar obrigatorio a assinatura digital no
 * prontuario? estou esquecendo". Em vez de travar o prontuario, uma lista do
 * que falta e um botao que assina tudo de uma vez - a aprovacao no VIDaaS vale
 * para o turno inteiro (ver assinar-consulta), entao e um toque no celular para
 * o dia todo.
 *
 * Fica de fora o esqueleto que o cadastro cria (consulta sem nada escrito) e o
 * que esta no futuro. 90 dias para tras: assinatura atrasada continua
 * aparecendo ate ser feita, mas a consulta nao fica pesada.
 */
export async function listAtendimentosSemAssinatura(clinicId: string): Promise<AtendimentoSemAssinatura[]> {
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const desde = new Date(Date.now() - 90 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const { data, error } = await supabase
    .from('consultations')
    .select('*, patients(name)')
    .eq('clinic_id', clinicId)
    .is('archived_at', null)
    .is('signed_at', null)
    .gte('consultation_date', desde)
    .lte('consultation_date', hoje)
    .order('consultation_date', { ascending: false })
  if (error) fail(error)
  type Linha = ConsultationRow & { patients?: { name?: string } | { name?: string }[] | null }
  return ((data ?? []) as unknown as Linha[])
    .filter((linha) => !semConteudoClinico(linha))
    .map((linha) => {
      const paciente = Array.isArray(linha.patients) ? linha.patients[0] : linha.patients
      return {
        id: linha.id,
        patientId: linha.patient_id,
        paciente: paciente?.name ?? 'Paciente',
        data: linha.consultation_date,
      }
    })
}

export async function createConsultation(
  clinicId: string,
  patientId: string,
  draft: ConsultationDraft,
) {
  // Cadastrar um paciente cria automaticamente uma consulta inicial vazia - e
  // dela que penduram os acompanhamentos de 15, 30 e 90 dias. Quando o medico
  // finalmente escreve o primeiro atendimento, ele deve PREENCHER esse
  // esqueleto, e nao criar um segundo ao lado.
  //
  // Sem isto o prontuario abria mostrando "2 consultas registradas", uma delas
  // com a data do agendamento futuro e nenhum conteudo. Parecia erro de
  // digitacao do medico, e era o sistema falando duas vezes da mesma coisa.
  const { data: existentes } = await supabase
    .from('consultations')
    .select('*')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .is('archived_at', null)

  const esqueleto = ((existentes ?? []) as ConsultationRow[]).find(semConteudoClinico)

  if (esqueleto) {
    return editConsultation(clinicId, patientId, esqueleto.id, draft)
  }

  const { data, error } = await supabase
    .from('consultations')
    .insert(consultationPayload(clinicId, patientId, draft))
    .select('*')
    .single()

  if (error) fail(error)
  await marcarPresencaPeloProntuario(clinicId, patientId, draft.data)
  return {
    consultation: mapConsultation(data as ConsultationRow),
    patient: await patientById(clinicId, patientId),
  }
}

export async function editConsultation(
  clinicId: string,
  patientId: string,
  consultationId: string,
  draft: ConsultationDraft,
) {
  const payload: ConsultationUpdate = {
    consultation_date: draft.data,
    encounter_type: draft.tipo,
    unit: draft.unidade.trim(),
    weight_kg: decimalOrNull(draft.peso),
    height_cm: decimalOrNull(draft.altura),
    chief_complaint: draft.queixa.trim(),
    clinical_history: draft.historiaEvolucao.trim(),
    personal_history: draft.antecedentesPessoais.trim(),
    family_history: draft.antecedentesFamiliares.trim(),
    allergies: draft.alergias.trim(),
    current_medications: draft.medicamentos.trim(),
    physical_exam: draft.exameFisico.trim(),
    assessment: draft.avaliacao.trim(),
    cid: draft.cid.trim(),
    plan: draft.conduta.trim(),
    prescription: draft.prescricao.trim(),
    return_plan: draft.retorno.trim(),
    notes: draft.observacoes.trim(),
  }
  const { data, error } = await supabase
    .from('consultations')
    .update(payload)
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .eq('id', consultationId)
    .is('archived_at', null)
    .select('*')
    .single()

  if (error) fail(error)
  await marcarPresencaPeloProntuario(clinicId, patientId, draft.data)
  return {
    consultation: mapConsultation(data as ConsultationRow),
    patient: await patientById(clinicId, patientId),
  }
}

export async function editPatient(clinicId: string, id: string, patch: Partial<Patient>) {
  // Salvou o nome pela tela: o aviso de "nome do contato" sai (ver a migration
  // 20261025100400). Em consulta separada, antes do UPDATE principal: coluna
  // nova que o banco ainda nao tem recusaria o UPDATE inteiro, e o cadastro nao
  // salvaria. Perder o aviso e arranhao; perder a edicao, nao.
  if (patch.nome !== undefined) {
    const { error: erroDoAviso } = await supabase
      .from('patients')
      .update({ name_from_contact_at: null } as PatientUpdate)
      .eq('clinic_id', clinicId)
      .eq('id', id)
    if (erroDoAviso) console.warn('Nao consegui tirar o aviso de nome do contato', erroDoAviso)
  }
  const { data, error } = await supabase
    .from('patients')
    .update(patientUpdatePayload(patch) as PatientUpdate)
    .eq('clinic_id', clinicId)
    .eq('id', id)
    .is('archived_at', null)
    .select('*')
    .single()

  if (error) fail(error)
  const followups = await followupsForPatient(clinicId, id)
  return mapPatient(data as PatientRow, followups)
}

export async function archivePatient(clinicId: string, id: string) {
  const { error } = await supabase
    .from('patients')
    .update({ archived_at: new Date().toISOString() })
    .eq('clinic_id', clinicId)
    .eq('id', id)

  if (error) fail(error)
}

/**
 * Pacientes arquivados, do mais recente para o mais antigo.
 *
 * Arquivar nao apaga: prontuario e obrigado a ser guardado por 20 anos (Lei
 * 13.787/2018), entao o cadastro sai das listas e fica de lado. Esta funcao e
 * a porta para ele voltar - ou para conferir que continua la.
 */
export async function listArchivedPatients(clinicId: string): Promise<Patient[]> {
  const { data, error } = await supabase
    .from('patients')
    .select('*')
    .eq('clinic_id', clinicId)
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false })

  if (error) fail(error)
  return ((data ?? []) as PatientRow[]).map((row) => mapPatient(row, []))
}

export async function restorePatient(clinicId: string, id: string) {
  const { error } = await supabase
    .from('patients')
    .update({ archived_at: null })
    .eq('clinic_id', clinicId)
    .eq('id', id)

  if (error) fail(error)
}

export async function changeFollowup(
  clinicId: string,
  patientId: string,
  key: FollowupKey,
  status: FollowupStatus,
) {
  // Sem `single()`, e com o arquivado de fora.
  //
  // Em 08/09/2026 antecipar um acompanhamento derrubou o sistema inteiro com
  // "Cannot coerce the result to a single JSON object": o `single()` exige
  // exatamente uma linha, e o paciente tinha mais de um acompanhamento do mesmo
  // tipo (um arquivado, de um cadastro anterior). A mensagem chegou no celular
  // da familia e a tela mostrou erro - o pior dos dois mundos.
  const { data, error } = await supabase
    .from('followups')
    .update({ status: toDbStatus(status) })
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .eq('followup_key', key)
    .is('archived_at', null)
    .select('id,patient_id,followup_key,status,opened_at')

  if (error) fail(error)
  // Sem ordenacao: o banco em producao nao tem a coluna created_at nesta
  // tabela, e depois de tirar os arquivados sobra um acompanhamento so.
  const linhas = (data ?? []) as FollowupRow[]
  if (linhas.length === 0) {
    throw new Error(
      'Este acompanhamento não foi encontrado. Atualize a página; se continuar, o cadastro pode ter sido arquivado.',
    )
  }
  const row = linhas[0]
  return {
    id: row.id,
    status: toUiStatus(row.status),
    enviadoEm: row.opened_at ?? undefined,
  } satisfies FollowupState
}

export async function saveTemplates(
  clinicId: string,
  templates: Record<FollowupKey, string>,
) {
  const { error } = await supabase
    .from('clinic_settings')
    .update({
      template_d30: templates.d30,
      template_m90: templates.m90,
      // Coluna nova; os tipos gerados ainda nao a conhecem.
      ...({ template_d15: templates.d15 } as Record<string, unknown>),
    })
    .eq('clinic_id', clinicId)
  if (error) fail(error)
}

/**
 * Liga e desliga etapas do acompanhamento (19/10/2026, vindo do sistema do Dr.
 * Marcello). O banco faz o resto: a etapa desligada sai da fila, a ligada volta
 * para as consultas futuras (ver a migration etapas_do_acompanhamento).
 */
export async function saveEtapas(clinicId: string, etapas: FollowupKey[]) {
  const { error } = await semTipo
    .from('clinic_settings')
    .update({ followup_etapas: FOLLOWUP_KEYS.filter((k) => etapas.includes(k)) })
    .eq('clinic_id', clinicId)
  if (error) fail(error)
}

export async function archiveAllPatients(clinicId: string) {
  const { error } = await supabase
    .from('patients')
    .update({ archived_at: new Date().toISOString() })
    .eq('clinic_id', clinicId)
    .is('archived_at', null)
  if (error) fail(error)
}

export async function importPatients(clinicId: string, data: Db) {
  await saveTemplates(clinicId, data.templates)
  for (const patient of data.patients) {
    const draft: PatientDraft = {
      nome: patient.nome,
      responsavel: patient.responsavel,
      nascimento: patient.nascimento,
      sexo: patient.sexo,
      telefone: patient.telefone,
      cpf: patient.cpf ?? '',
      email: patient.email ?? '',
      cidade: patient.cidade,
      bairro: patient.bairro,
      convenio: patient.convenio,
      cid: patient.cid,
      unidade: patient.unidade,
      dataConsulta: patient.dataConsulta,
      observacoes: patient.observacoes,
    }
    const created = await createPatient(clinicId, draft)
    for (const key of FOLLOWUP_KEYS) {
      const state = patient.followups?.[key]
      if (state && state.status !== 'pendente') {
        await changeFollowup(clinicId, created.id, key, state.status)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Modelos de texto do prontuario
// ---------------------------------------------------------------------------

export interface NoteTemplate {
  id: string
  /** Chave do campo do formulario. Vazio serve em qualquer campo. */
  campo: string
  titulo: string
  texto: string
}

/**
 * Todos os modelos ativos da clinica, de uma vez.
 *
 * Vem tudo junto e a tela filtra por campo: sao dezenas de linhas curtas, e uma
 * consulta por campo aberto significaria doze idas ao banco para abrir um
 * prontuario.
 */
export async function listNoteTemplates(clinicId: string): Promise<NoteTemplate[]> {
  const { data, error } = await supabase
    .from('note_templates')
    .select('id,field,title,body')
    .eq('clinic_id', clinicId)
    .is('archived_at', null)
    .order('title')
  if (error) fail(error)
  return (data ?? []).map((row) => ({
    id: row.id,
    campo: row.field ?? '',
    titulo: row.title,
    texto: row.body ?? '',
  }))
}

export async function createNoteTemplate(
  clinicId: string,
  campo: string,
  titulo: string,
  texto: string,
): Promise<NoteTemplate> {
  const { data, error } = await supabase
    .from('note_templates')
    .insert({
      clinic_id: clinicId,
      field: campo.slice(0, 40),
      title: titulo.trim().slice(0, 80),
      body: texto.slice(0, 8000),
    })
    .select('id,field,title,body')
    .single()
  if (error) fail(error)
  return { id: data.id, campo: data.field ?? '', titulo: data.title, texto: data.body ?? '' }
}

/** Aposenta o modelo. Nao apaga: consulta antiga pode ter sido escrita com ele. */
export async function archiveNoteTemplate(templateId: string) {
  const { error } = await supabase
    .from('note_templates')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', templateId)
  if (error) fail(error)
}

/**
 * Retoma uma conversa cuja janela de 24 horas ja fechou.
 *
 * Manda um modelo aprovado, que e a unica coisa que a Meta aceita fora da
 * janela. Nao resolve o assunto: reabre a porta para a equipe escrever.
 */
export async function reopenConversation(conversationId: string) {
  const { error } = await supabase.functions.invoke('whatsapp-reopen', {
    body: { conversationId },
  })
  if (error) {
    throw new Error(await motivoDaFalha(error, 'Não foi possível enviar a mensagem de retomada.'))
  }
}

/**
 * Manda a resposta da equipe mesmo com a janela fechada.
 *
 * O texto viaja dentro de um modelo de utilidade aprovado - a unica forma de
 * dizer algo novo depois das 24 horas. Mesma funcao do convite no servidor: o
 * que decide o caminho e existir ou nao uma mensagem escrita.
 */
export async function sendTemplateReply(conversationId: string, mensagem: string) {
  const { error } = await supabase.functions.invoke('whatsapp-reopen', {
    body: { conversationId, mensagem },
  })
  if (error) {
    throw new Error(await motivoDaFalha(error, 'Não foi possível enviar a mensagem.'))
  }
}

/**
 * Troca a foto de perfil do WhatsApp Business.
 *
 * A imagem nao vai daqui: a funcao no servidor busca o arquivo publicado no
 * site. Assim a foto tem um endereco fixo e versionado, e quem trocar amanha
 * troca o arquivo, nao o codigo.
 */
export interface SituacaoDoNumero {
  numero: string | null
  nomeAtual: string | null
  situacaoDoNomeAtual: string
  situacaoDoPedido: string
  qualidade: string | null
}

/** Le o estado do numero na Meta. So leitura: nao submete nome nenhum. */
export async function situacaoDoWhatsApp() {
  const { data, error } = await supabase.functions.invoke('whatsapp-perfil', {
    body: { acao: 'status' },
  })
  if (error) throw new Error(await motivoDaFalha(error, 'Não foi possível consultar a Meta.'))
  return data as SituacaoDoNumero
}

export async function atualizarFotoDoPerfil() {
  const { error } = await supabase.functions.invoke('whatsapp-perfil', { body: {} })
  if (error) throw new Error(await motivoDaFalha(error, 'Não foi possível trocar a foto.'))
}

/**
 * Grava o cartao de visita da conta: site, endereco, descricao e e-mail.
 *
 * E o que a familia ve ao tocar no nome da conversa, e hoje esta vazio. Nao
 * mexe no nome de exibicao, que e outra coisa e depende da Meta.
 */
/** O cartao de visita do WhatsApp, como a clinica escreve em Preferencias. */
export interface PerfilDoWhatsApp {
  /** Recado curto, no topo do perfil. A Meta corta em 139 caracteres. */
  recado: string
  endereco: string
  descricao: string
  email: string
  site: string
}

const CAMPOS_DO_PERFIL =
  'whatsapp_profile_about,whatsapp_profile_address,whatsapp_profile_description,' +
  'whatsapp_profile_email,whatsapp_profile_website'

export async function getPerfilDoWhatsApp(clinicId: string): Promise<PerfilDoWhatsApp> {
  const { data, error } = await tabelaCrua('clinic_settings')
    .select(CAMPOS_DO_PERFIL)
    .eq('clinic_id', clinicId)
    .order('clinic_id', { ascending: true })
  if (error) fail(error)
  const linha = ((data ?? []) as Record<string, string | null>[])[0] ?? {}
  return {
    recado: linha.whatsapp_profile_about ?? '',
    endereco: linha.whatsapp_profile_address ?? '',
    descricao: linha.whatsapp_profile_description ?? '',
    email: linha.whatsapp_profile_email ?? '',
    site: linha.whatsapp_profile_website ?? '',
  }
}

export async function savePerfilDoWhatsApp(clinicId: string, perfil: PerfilDoWhatsApp) {
  const atualizar = (supabase.from as unknown as (n: string) => {
    update: (valores: Record<string, unknown>) => {
      eq: (coluna: string, valor: string) => PromiseLike<{ error: { message: string } | null }>
    }
  })('clinic_settings')
  const { error } = await atualizar
    .update({
      whatsapp_profile_about: perfil.recado.trim(),
      whatsapp_profile_address: perfil.endereco.trim(),
      whatsapp_profile_description: perfil.descricao.trim(),
      whatsapp_profile_email: perfil.email.trim(),
      whatsapp_profile_website: perfil.site.trim(),
    })
    .eq('clinic_id', clinicId)
  if (error) fail(error)
}

export async function atualizarDadosDoPerfil() {
  const { error } = await supabase.functions.invoke('whatsapp-perfil', {
    body: { acao: 'dados' },
  })
  if (error) throw new Error(await motivoDaFalha(error, 'Não foi possível gravar o perfil.'))
}

// ---------------------------------------------------------------------------
// Receitas emitidas pela Memed
// ---------------------------------------------------------------------------

export interface ItemDaReceita {
  nome: string
  posologia: string
  quantidade: number | null
  unidade: string | null
  /** 'alopático', 'exame', 'custom' (atestado)... Ver categoria-da-receita.ts. */
  tipo?: string | null
  /** 'Simples' ou o talao especial ('Especial-2 vias (C1)' etc.). */
  receituario?: string | null
}

export interface Receita {
  id: string
  consultationId: string | null
  memedId: string
  link: string | null
  emitidaEm: string
  excluidaEm: string | null
  itens: ItemDaReceita[]
}

/**
 * As receitas do paciente, para aparecerem dentro do atendimento.
 *
 * Os itens vem do banco, e nao da Memed, de proposito: o prontuario precisa
 * dizer o que foi prescrito mesmo que a integracao acabe ou o servico saia do
 * ar. O link e conveniencia; o texto e o registro.
 */
/**
 * Escape para tabelas que o banco ja tem e os tipos gerados ainda nao.
 *
 * Some quando os tipos forem regerados depois da migration da prescricao. Ate
 * la o cliente recusaria o nome da tabela na compilacao.
 */
type ConsultaCrua = {
  select: (colunas: string) => ConsultaCrua
  eq: (coluna: string, valor: string) => ConsultaCrua
  /** Coluna vazia: `is('cancellation_notified_at', null)` é "nunca avisado". */
  is: (coluna: string, valor: null) => ConsultaCrua
  /** Maior ou igual, para recortes de data. */
  gte: (coluna: string, valor: string) => ConsultaCrua
  /** `order('x')` sozinho ja ordena crescente, como no supabase-js. */
  order: (
    coluna: string,
    opcoes?: { ascending: boolean },
  ) => PromiseLike<{ data: unknown; error: unknown }>
}

function tabelaCrua(nome: string) {
  return (supabase.from as unknown as (n: string) => ConsultaCrua)(nome)
}

export async function listPrescriptions(clinicId: string, patientId: string) {
  const { data, error } = await tabelaCrua('prescriptions')
    .select('id,consultation_id,memed_id,link,itens,emitida_em,excluida_em')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .order('emitida_em', { ascending: false })

  // Receita e complemento do prontuario: se a listagem falhar - por exemplo
  // antes de a migration rodar -, o atendimento continua inteiro na tela.
  if (error) return []

  type Linha = {
    id: string
    consultation_id: string | null
    memed_id: string
    link: string | null
    itens: ItemDaReceita[] | null
    emitida_em: string
    excluida_em: string | null
  }

  return ((data ?? []) as unknown as Linha[]).map((linha) => ({
    id: linha.id,
    consultationId: linha.consultation_id,
    memedId: linha.memed_id,
    link: linha.link,
    emitidaEm: linha.emitida_em,
    excluidaEm: linha.excluida_em,
    itens: Array.isArray(linha.itens) ? linha.itens : [],
  })) satisfies Receita[]
}

// ---------------------------------------------------------------------------
// Assinatura digital do atendimento
// ---------------------------------------------------------------------------

/**
 * Erro de uma Edge Function, com o texto que o servidor realmente mandou.
 *
 * O invoke do supabase-js devolve "Edge Function returned a non-2xx status
 * code" e guarda a resposta em `context` - como objeto Response, ainda por ler.
 * Sem abrir esse corpo, todo erro do servidor chega na tela como a mesma frase
 * generica, e o medico repete o mesmo gesto sem saber o que houve.
 */
async function motivoDaFalha(error: unknown, padrao: string) {
  const contexto = (error as { context?: unknown }).context

  if (contexto instanceof Response) {
    try {
      // clone porque o corpo so pode ser lido uma vez, e quem chamou pode
      // querer olhar a resposta de novo.
      const corpo = await contexto.clone().json()
      if (corpo?.error) {
        return corpo.details ? `${corpo.error} (${corpo.details})` : String(corpo.error)
      }
    } catch {
      // Resposta sem JSON - fica o texto padrao, que ainda e melhor que nada.
    }
  }

  return padrao
}

/**
 * Primeiro passo: pede a autorizacao e devolve o endereco do VIDaaS.
 *
 * Quem manda o medico para la e a tela, e nao o servidor, porque o navegador
 * precisa lembrar de onde saiu para voltar ao lugar certo.
 */
export async function iniciarAssinatura(consultationId: string, voltarPara: string) {
  const { data, error } = await supabase.functions.invoke('assinar-consulta', {
    body: { acao: 'iniciar', consultationId, voltarPara },
  })
  if (error) throw new Error(await motivoDaFalha(error, 'Não foi possível pedir a autorização.'))
  // "recuperado": havia um documento assinado e arquivado que so faltava
  // registrar. Nao ha celular nem aba nova neste caso - ja esta assinado.
  // "sessaoAtiva": o medico ja aprovou neste turno; o pedido assina direto,
  // sem VIDaaS. "recuperado": havia documento assinado que so faltava
  // registrar. Nos dois casos nao ha celular nem aba nova.
  return data as
    | { pedido: string; autorizarEm: string; expiraEm?: string; recuperado?: false; sessaoAtiva?: false }
    | { pedido: string; sessaoAtiva: true; expiraEm?: string; autorizarEm?: undefined; recuperado?: false }
    | { recuperado: true; assinadoEm: string; pedido?: undefined; autorizarEm?: undefined; expiraEm?: undefined; sessaoAtiva?: false }
}

export type ResultadoDaAssinatura =
  | { situacao: 'assinado'; assinadoEm: string; arquivo: string; digital: string }
  | { situacao: 'aguardando'; detalhe?: string }

/**
 * Segundo passo: tenta assinar com a permissao pedida.
 *
 * Devolve "aguardando" enquanto o medico nao aprovou no celular - a tela
 * pergunta de novo em alguns segundos. Erro de verdade vira excecao.
 *
 * Antes isto so rodava quando o navegador voltava do VIDaaS com o numero do
 * pedido no endereco. Essa volta nunca aconteceu: nove autorizacoes no celular
 * em 06/09/2026 e nenhuma assinatura. Perguntando, o sistema nao depende dela.
 */
export async function concluirAssinatura(pedido: string): Promise<ResultadoDaAssinatura> {
  const { data, error } = await supabase.functions.invoke('assinar-consulta', {
    body: { acao: 'concluir', pedido },
  })

  if (error) {
    // O 202 de "aguardando" tambem chega como erro para o cliente do Supabase,
    // que so considera sucesso o 2xx com corpo de sucesso. Le o codigo antes
    // de tratar como falha.
    const contexto = (error as { context?: unknown }).context
    if (contexto instanceof Response) {
      try {
        const corpo = await contexto.clone().json()
        if (corpo?.code === 'AGUARDANDO') return { situacao: 'aguardando', detalhe: corpo.details }
      } catch {
        // sem JSON - segue para o erro normal
      }
    }
    throw new Error(await motivoDaFalha(error, 'A assinatura não foi concluída.'))
  }

  if (data?.code === 'AGUARDANDO') return { situacao: 'aguardando', detalhe: data.details }
  return { situacao: 'assinado', ...(data as { assinadoEm: string; arquivo: string; digital: string }) }
}

/**
 * Link temporario para abrir o PDF assinado.
 *
 * Temporario de proposito: o arquivo tem o atendimento inteiro dentro, e um
 * endereco permanente acabaria colado em algum lugar onde nao deveria estar.
 */
export async function linkDoAtendimentoAssinado(caminho: string) {
  const { data, error } = await supabase.storage
    .from('prontuarios-assinados')
    .createSignedUrl(caminho, 300)
  if (error) throw new Error('Não foi possível abrir o documento assinado.')
  return data.signedUrl
}

// ---------------------------------------------------------------------------
// Integridade do prontuario
// ---------------------------------------------------------------------------

export interface Integridade {
  /** Registros de auditoria da clinica, inclusive os anteriores a corrente. */
  total: number
  /** Quantos deles entram na conferencia. */
  encadeados: number
  /** Hash da ponta da corrente. Representa o acervo naquele instante. */
  selo: string | null
  /** Id do primeiro elo adulterado. Nulo quando a corrente fecha. */
  quebradoNoId: number | null
  quebradoEm: string | null
}

/**
 * Percorre a corrente de auditoria e diz se ela fecha.
 *
 * Recalcula cada elo a partir do conteudo gravado. Se algum hash nao bater, a
 * funcao devolve o id exato do registro adulterado - a quebra aparece no ponto
 * em que aconteceu, e nao como um "algo esta errado" generico.
 */
export async function conferirIntegridade(clinicId: string): Promise<Integridade> {
  const { data, error } = await supabase.rpc('conferir_integridade_prontuario', {
    p_clinic_id: clinicId,
  })
  if (error) fail(error)
  const linha = (data ?? [])[0]
  return {
    total: Number(linha?.total ?? 0),
    encadeados: Number(linha?.registros_encadeados ?? 0),
    selo: linha?.selo ?? null,
    quebradoNoId: linha?.quebrado_no_id === null || linha?.quebrado_no_id === undefined
      ? null
      : Number(linha.quebrado_no_id),
    quebradoEm: linha?.quebrado_em ?? null,
  }
}

// ---------------------------------------------------------------------------
// Respostas prontas do robô
// ---------------------------------------------------------------------------

/**
 * O que a clínica escreve para o robô responder sozinho.
 *
 * `palavras` são as pistas que identificam o assunto na mensagem da família, e
 * `resposta` é o texto enviado, sem alteração nenhuma. Assunto clínico não é
 * respondido nem que esteja cadastrado: a trava está no atendimento, antes da
 * busca.
 */
export type RespostaPronta = {
  id: string
  assunto: string
  palavras: string[]
  resposta: string
  ativa: boolean
  ordem: number
  /** Antes de responder, pergunta Santos, São Paulo ou Telemedicina e usa o texto do lugar. */
  perguntarUnidade: boolean
  /** Depois de responder, passa a conversa para a equipe: assunto que a equipe confirma (16/10/2026). */
  chamarEquipe: boolean
}

/** Escape para a tabela nova, que os tipos gerados ainda não conhecem. */
type Resposta = { data: unknown; error: { message: string } | null }
interface TabelaLivre extends PromiseLike<Resposta> {
  select: (colunas: string) => TabelaLivre
  insert: (valores: Record<string, unknown>) => TabelaLivre
  update: (valores: Record<string, unknown>) => TabelaLivre
  delete: () => TabelaLivre
  eq: (coluna: string, valor: string) => TabelaLivre
  order: (coluna: string, opcoes: { ascending: boolean }) => TabelaLivre
  single: () => PromiseLike<Resposta>
}

function respostasProntas(): TabelaLivre {
  return (supabase.from as unknown as (n: string) => TabelaLivre)('bot_answers')
}

type LinhaDaResposta = {
  id: string
  subject: string
  keywords: string[] | null
  answer: string
  is_active: boolean
  position: number
  ask_unit?: boolean | null
}

export async function listRespostasProntas(clinicId: string): Promise<RespostaPronta[]> {
  const { data, error } = await respostasProntas()
    .select('id,subject,keywords,answer,is_active,position,ask_unit')
    .eq('clinic_id', clinicId)
    .order('position', { ascending: true })
  if (error) fail(error)
  // hand_off (16/10/2026) vem em consulta propria: sem a coluna no banco, o
  // Postgres recusaria a lista inteira, e a tela perderia todas as respostas.
  const chamaAEquipe = new Set<string>()
  try {
    const extra = await respostasProntas().select('id,hand_off').eq('clinic_id', clinicId)
    if (extra.error) throw extra.error
    for (const linha of (extra.data ?? []) as { id: string; hand_off?: boolean | null }[]) {
      if (linha.hand_off) chamaAEquipe.add(linha.id)
    }
  } catch (erro) {
    console.warn('bot_answers sem hand_off; a tela segue sem o "chamar a equipe"', erro)
  }
  return ((data ?? []) as LinhaDaResposta[]).map((linha) => ({
    id: linha.id,
    assunto: linha.subject,
    palavras: linha.keywords ?? [],
    resposta: linha.answer,
    ativa: linha.is_active,
    ordem: linha.position,
    perguntarUnidade: Boolean(linha.ask_unit),
    chamarEquipe: chamaAEquipe.has(linha.id),
  }))
}

/** Grava uma resposta. Sem id, cria; com id, atualiza. Devolve o id final. */
export async function saveRespostaPronta(
  clinicId: string,
  resposta: RespostaPronta,
): Promise<string> {
  const valores = {
    subject: resposta.assunto.trim(),
    keywords: resposta.palavras.map((p) => p.trim()).filter(Boolean),
    answer: resposta.resposta.trim(),
    is_active: resposta.ativa,
    position: resposta.ordem,
    ask_unit: resposta.perguntarUnidade,
  }

  let id = resposta.id
  if (id) {
    const { error } = await respostasProntas().update(valores).eq('id', id)
    if (error) fail(error)
  } else {
    const { data, error } = await respostasProntas()
      .insert({ ...valores, clinic_id: clinicId })
      .select('id')
      .single()
    if (error) fail(error)
    id = ((data ?? {}) as { id?: string }).id ?? ''
  }

  // O "chamar a equipe" vai separado, pelo mesmo motivo da leitura: sem a
  // coluna, ele se perde e avisa, e o resto da resposta fica salvo.
  if (id) {
    const { error } = await respostasProntas().update({ hand_off: resposta.chamarEquipe }).eq('id', id)
    if (error) console.warn('Nao consegui salvar o "chamar a equipe" desta resposta', error)
  }
  return id
}

export async function deleteRespostaPronta(id: string): Promise<void> {
  const { error } = await respostasProntas().delete().eq('id', id)
  if (error) fail(error)
}

// ---------------------------------------------------------------------------
// Telemedicina: o texto e o valor que o robo da (o texto de cada unidade fica
// no cartao da unidade, ver saveUnit)
// ---------------------------------------------------------------------------

export type Telemedicina = {
  ativa: boolean
  texto: string
  /** Valor da consulta por video, em centavos (14/10/2026). Nulo = vazio. */
  valorCentavos?: number | null
}

export async function getTelemedicina(clinicId: string): Promise<Telemedicina> {
  const { data, error } = await tabelaCrua('clinic_settings')
    .select('telemedicine_enabled,telemedicine_info_text')
    .eq('clinic_id', clinicId)
    .order('clinic_id', { ascending: true })
  if (error) fail(error)
  const linha = ((data ?? []) as { telemedicine_enabled?: boolean; telemedicine_info_text?: string | null }[])[0]
  return {
    ativa: Boolean(linha?.telemedicine_enabled),
    texto: linha?.telemedicine_info_text ?? '',
    valorCentavos: await valorDaTelemedicina(clinicId),
  }
}

/** Coluna nova (14/10/2026), lida a parte: sem ela, o valor so aparece vazio. */
async function valorDaTelemedicina(clinicId: string): Promise<number | null> {
  try {
    const { data, error } = await tabelaCrua('clinic_settings')
      .select('telemedicine_price_cents')
      .eq('clinic_id', clinicId)
      .order('clinic_id', { ascending: true })
    if (error) throw error
    return ((data ?? []) as { telemedicine_price_cents?: number | null }[])[0]?.telemedicine_price_cents || null
  } catch (erro) {
    console.warn('Sem a coluna clinic_settings.telemedicine_price_cents', erro)
    return null
  }
}

export async function saveTelemedicina(clinicId: string, dados: Telemedicina) {
  const atualizar = (supabase.from as unknown as (n: string) => {
    update: (valores: Record<string, unknown>) => {
      eq: (coluna: string, valor: string) => PromiseLike<{ error: { message: string } | null }>
    }
  })('clinic_settings')
  const { error } = await atualizar
    .update({
      telemedicine_enabled: dados.ativa,
      telemedicine_info_text: dados.texto.trim(),
      // So vai junto quando a tela mandou: quem salva sem conhecer o valor
      // nao pode apaga-lo.
      ...(dados.valorCentavos !== undefined ? { telemedicine_price_cents: dados.valorCentavos } : {}),
    })
    .eq('clinic_id', clinicId)
  if (error) fail(error)
}

/**
 * Numeros do atendimento por WhatsApp num periodo.
 *
 * A conta e feita no banco, pela funcao numeros_do_whatsapp. Ver a migration
 * 20260921120000 para o porque: buscar as linhas e contar aqui bateria no teto
 * de 1000 linhas do PostgREST e o painel mostraria menos do que aconteceu, sem
 * erro nenhum na tela.
 */
export type NumerosDoWhatsApp = {
  contatos: number
  contatosForaDoHorario: number
  pediramParaNaoReceber: number
  mensagensRecebidas: number
  enviadasRobo: number
  enviadasEquipe: number
  enviadasLembrete: number
  enviadasAcompanhamento: number
  contidas: number
  atendidasPorGente: number
  consultasPeloWhatsApp: number
  consultasPelaRecepcao: number
  faltasWhatsApp: number
  faltasRecepcao: number
  compareceuWhatsApp: number
  compareceuRecepcao: number
  /** Quantas vezes cada numero do menu (1 a 5) foi escolhido. */
  opcoesEscolhidas: Record<string, number>
  /** Contagem crua por tipo de evento. Serve tambem para ver evento inesperado. */
  eventos: Record<string, number>
  chamouEquipePorMotivo: Record<string, number>
  desistiram: number
}

const NUMEROS_ZERADOS: NumerosDoWhatsApp = {
  contatos: 0, contatosForaDoHorario: 0, pediramParaNaoReceber: 0,
  mensagensRecebidas: 0, enviadasRobo: 0, enviadasEquipe: 0,
  enviadasLembrete: 0, enviadasAcompanhamento: 0,
  contidas: 0, atendidasPorGente: 0,
  consultasPeloWhatsApp: 0, consultasPelaRecepcao: 0,
  faltasWhatsApp: 0, faltasRecepcao: 0,
  compareceuWhatsApp: 0, compareceuRecepcao: 0,
  opcoesEscolhidas: {}, eventos: {}, chamouEquipePorMotivo: {}, desistiram: 0,
}

function inteiro(valor: unknown): number {
  const n = Number(valor)
  return Number.isFinite(n) ? n : 0
}

function contagens(valor: unknown): Record<string, number> {
  if (!valor || typeof valor !== 'object') return {}
  const saida: Record<string, number> = {}
  for (const [chave, quantas] of Object.entries(valor as Record<string, unknown>)) {
    saida[chave] = inteiro(quantas)
  }
  return saida
}

export async function numerosDoWhatsApp(
  clinicId: string,
  de: Date,
  ate: Date,
): Promise<NumerosDoWhatsApp> {
  const { data, error } = await supabase.rpc('numeros_do_whatsapp', {
    p_clinic: clinicId,
    p_de: de.toISOString(),
    p_ate: ate.toISOString(),
  })
  // A funcao nasce com esta migration, e a tela sobe antes dela. Sem este
  // desvio o painel quebraria inteiro no intervalo entre um deploy e outro;
  // com ele, aparece zerado e o aviso da tela explica.
  if (error) {
    console.warn('numeros_do_whatsapp indisponivel', error)
    return NUMEROS_ZERADOS
  }
  const bruto = (data ?? {}) as Record<string, unknown>
  return {
    contatos: inteiro(bruto.contatos),
    contatosForaDoHorario: inteiro(bruto.contatos_fora_do_horario),
    pediramParaNaoReceber: inteiro(bruto.pediram_para_nao_receber),
    mensagensRecebidas: inteiro(bruto.mensagens_recebidas),
    enviadasRobo: inteiro(bruto.enviadas_robo),
    enviadasEquipe: inteiro(bruto.enviadas_equipe),
    enviadasLembrete: inteiro(bruto.enviadas_lembrete),
    enviadasAcompanhamento: inteiro(bruto.enviadas_acompanhamento),
    contidas: inteiro(bruto.contidas),
    atendidasPorGente: inteiro(bruto.atendidas_por_gente),
    consultasPeloWhatsApp: inteiro(bruto.consultas_pelo_whatsapp),
    consultasPelaRecepcao: inteiro(bruto.consultas_pela_recepcao),
    faltasWhatsApp: inteiro(bruto.faltas_whatsapp),
    faltasRecepcao: inteiro(bruto.faltas_recepcao),
    compareceuWhatsApp: inteiro(bruto.compareceu_whatsapp),
    compareceuRecepcao: inteiro(bruto.compareceu_recepcao),
    opcoesEscolhidas: contagens(bruto.opcoes_escolhidas),
    eventos: contagens(bruto.eventos),
    chamouEquipePorMotivo: contagens(bruto.chamou_equipe_por_motivo),
    desistiram: inteiro(bruto.desistiram),
  }
}

/**
 * Horarios que vagaram porque alguem cancelou.
 *
 * Pedido em 22/09/2026, e a ideia e boa: quando o paciente cancela pelo
 * WhatsApp, a consulta some da agenda e o horario volta para a lista de livres
 * igual a qualquer outro. A recepcao ve "16:40 livre" sem saber que as 16:40
 * tinha alguem marcado ate ontem - e que existe uma vaga de ultima hora para
 * oferecer a quem esta esperando.
 *
 * Ate aqui o unico aviso era a conversa acender em Respostas. Quem nao abrisse
 * aquela tela naquele dia nao ficava sabendo.
 *
 * SO CANCELAMENTO DO PACIENTE (cancelled_by nulo). Quando a clinica cancela,
 * ela ja sabe - marcar o proprio horario que ela acabou de liberar seria
 * avisar alguem de algo que essa pessoa fez.
 *
 * Sete dias de janela: depois disso a vaga ja e so um horario livre como
 * outro qualquer, e continuar pintando vira enfeite que ninguem le.
 */
export interface VagaDeCancelamento {
  /** Inicio da consulta que foi cancelada, no mesmo formato dos slots livres. */
  quando: string
  paciente: string
  canceladoEm: string
}

export async function listVagasDeCancelamento(
  clinicId: string,
  unitId: string,
): Promise<VagaDeCancelamento[]> {
  const desde = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  const { data, error } = await tabelaCrua('appointments')
    .select('starts_at,contact_name,patient_id,cancelled_at,cancelled_by')
    .eq('clinic_id', clinicId)
    .eq('unit_id', unitId)
    .eq('status', 'cancelled')
    .is('cancelled_by', null)
    .gte('cancelled_at', desde)
    .gte('starts_at', inicioDeHoje())
    .order('starts_at')

  // Lista de apoio: se falhar, a agenda continua inteira e os horarios livres
  // aparecem sem a marca. Nunca derrubar a agenda por causa de um enfeite.
  if (error) return []

  type Linha = {
    starts_at: string
    contact_name: string | null
    patient_id: string | null
    cancelled_at: string | null
  }
  const linhas = (data ?? []) as Linha[]
  if (linhas.length === 0) return []

  const ids = [...new Set(linhas.map((l) => l.patient_id).filter(Boolean))] as string[]
  const { data: pacientes } = ids.length
    ? await supabase.from('patients').select('id,name').in('id', ids)
    : { data: [] }
  const nomePorId = new Map((pacientes ?? []).map((p) => [p.id, p.name]))

  return linhas.map((linha) => ({
    quando: linha.starts_at,
    paciente:
      (linha.patient_id && nomePorId.get(linha.patient_id)) ||
      linha.contact_name ||
      'Contato sem cadastro',
    canceladoEm: linha.cancelled_at ?? '',
  }))
}

/**
 * Quantas conversas esperam alguem da equipe, e desde quando a mais antiga.
 *
 * Existe desde 22/09/2026. Naquele dia quatro familias esperaram horas - uma
 * delas escreveu "alguem pode me ajudar?" quatro horas e meia depois do
 * primeiro pedido - e nenhuma mensagem da equipe saiu o dia inteiro. O aviso
 * existia, mas so dentro da tela de Respostas: quem estava na Agenda ou num
 * prontuario nao via nada.
 *
 * O "desde" e a ultima mensagem da conversa, e nao a hora exata em que a
 * bandeira subiu (que nao e guardada). Serve para o que importa: saber se a
 * espera e de minutos ou de horas.
 */
export interface EsperaDaEquipe {
  total: number
  maisAntigaDesde: string | null
}

export async function conversasEsperandoEquipe(clinicId: string): Promise<EsperaDaEquipe> {
  const { data, error } = await supabase
    .from('whatsapp_conversations')
    .select('last_message_at')
    .eq('clinic_id', clinicId)
    .eq('needs_attention', true)
    .neq('status', 'opted_out')
    .order('last_message_at', { ascending: true, nullsFirst: false })
  // Aviso de apoio: se a consulta falhar, o sistema segue sem o contador.
  if (error) return { total: 0, maisAntigaDesde: null }
  const linhas = data ?? []
  return {
    total: linhas.length,
    maisAntigaDesde: linhas.find((l) => l.last_message_at)?.last_message_at ?? null,
  }
}
