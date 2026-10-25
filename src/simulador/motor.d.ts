// Tipos de motor.js: o recorte de atendimento.ts e conteudo.ts que o simulador
// usa. Se o robo mudar a assinatura, tests/simulador.test.mjs roda as conversas
// de verdade e acusa - este arquivo sozinho nao teria como saber.

export type Toque = { id: string; titulo: string; descricao?: string }

export type Resultado = {
  resposta: string
  atencao?: string
  concluida?: boolean
  botoes?: Toque[]
  lista?: { rotulo: string; linhas: Toque[] }
} | null

export type EventoDoRobo = { evento: string; detalhe?: string }

export type PacienteDoRobo = {
  id: string
  name: string
  nascimento?: string | null
  responsavel?: string | null
  cpf?: string | null
  email?: string | null
}

export type ConsultaDoRobo = {
  id: string
  inicio: string
  unidade: string
  endereco: string
  paciente: string
  confirmada: boolean
}

export type OpcoesDaConversa = {
  admin: unknown
  clinicId: string
  conversationId: string
  estadoAtual: string | null
  opcoesAtuais: unknown
  unidadeEmAndamento: string | null
  modalidadeEmAndamento?: 'presencial' | 'telemedicina' | null
  podeIniciarMenu: boolean
  posAcompanhamento?: boolean
  anexo?: boolean
  jaViuOMenu?: boolean
  respostasNaEspera?: number
  texto: string
  telefone: string
  pacientes: PacienteDoRobo[]
  pacienteEmAndamento: string | null
  consultas: ConsultaDoRobo[]
  consultaASubstituir: string | null
  consultaEmCadastro: string | null
  convenioEmAndamento?: string | null
  nomeDoPerfil: string
  textos: { saudacao: string; saudacaoConhecida: string; informacoes: string }
  agora?: Date
  consultaHoje?: boolean
  /** Por que a conversa esta acesa para a equipe (16/10/2026): sangramento e urgencia ganham o lembrete do pronto-socorro. */
  motivoDaAtencao?: string | null
}

export function tratarConversa(opcoes: OpcoesDaConversa): Promise<Resultado>
export function colherEventos(conversationId: string): EventoDoRobo[]
export function etiquetaQueFica(
  antes: { needs_attention?: boolean | null; attention_reason?: string | null } | null | undefined,
  nova: string,
): string

export type ConteudoEnviado =
  | { type: 'text'; text: { preview_url: boolean; body: string } }
  | {
      type: 'interactive'
      interactive:
        | {
            type: 'button'
            body: { text: string }
            action: { buttons: { type: 'reply'; reply: { id: string; title: string } }[] }
          }
        | {
            type: 'list'
            body: { text: string }
            action: {
              button: string
              sections: { title: string; rows: { id: string; title: string; description?: string }[] }[]
            }
          }
    }

export function montarMensagens(
  texto: string,
  toques?: { botoes?: Toque[]; lista?: { rotulo: string; linhas: Toque[] } },
): ConteudoEnviado[]
