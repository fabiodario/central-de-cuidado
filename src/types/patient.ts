export type Sexo = 'F' | 'M' | 'O'

export type FollowupKey = 'd15' | 'd30' | 'm90'

export type FollowupStatus = 'pendente' | 'enviado' | 'concluido'

export interface FollowupState {
  id?: string
  status: FollowupStatus
  enviadoEm?: string
}

export interface Patient {
  id: string
  nome: string
  responsavel: string
  nascimento: string // YYYY-MM-DD
  sexo: Sexo
  telefone: string
  /** CPF do proprio paciente. Exigido pela RDC 1000/25 para emitir receita. */
  cpf: string
  email: string
  cidade: string
  bairro: string
  convenio: string
  cid: string
  unidade: string
  dataConsulta: string // YYYY-MM-DD
  observacoes: string
  criadoEm: string
  /**
   * Quando o sistema criou este cadastro sozinho, na vespera da consulta, com o
   * que a familia informou ao robo. Vazio depois que alguem da equipe confere e
   * salva - e vazio tambem em todo cadastro feito por gente.
   */
  criadoAutomaticamenteEm: string
  followups: Record<FollowupKey, FollowupState>
}

export type ConsultationType = 'initial' | 'return' | 'telemedicine' | 'other'

export interface ConsultationDraft {
  data: string // YYYY-MM-DD
  tipo: ConsultationType
  unidade: string
  peso: string
  altura: string
  queixa: string
  historiaEvolucao: string
  antecedentesPessoais: string
  antecedentesFamiliares: string
  alergias: string
  medicamentos: string
  exameFisico: string
  avaliacao: string
  cid: string
  conduta: string
  prescricao: string
  retorno: string
  observacoes: string
}

export interface Consultation extends ConsultationDraft {
  id: string
  patientId: string
  criadoEm: string
  /** Momento da assinatura digital. Nulo enquanto o atendimento e rascunho. */
  assinadoEm: string | null
  /** Nome que consta no certificado usado. */
  assinadoPor: string | null
  /** Caminho do PDF assinado no acervo. E ele que vale como documento. */
  arquivoAssinado: string | null
}

export interface Db {
  patients: Patient[]
  templates: Record<FollowupKey, string>
}

/**
 * Unidades escritas exatamente como no site, que e o que o paciente le antes de
 * escrever para a clinica. Mesma grafia na agenda, no cadastro e no prontuario:
 * tres jeitos de escrever o mesmo lugar obrigavam o sistema a adivinhar que
 * eram a mesma coisa.
 */

export const FOLLOWUP_LABEL: Record<FollowupKey, string> = {
  d15: '15 dias',
  d30: '30 dias',
  m90: '3 meses',
}
