import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  Clock3,
  CalendarClock,
  MessageSquareText,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  UserPlus,
  X,
  ClipboardList,
  List as ListIcon,
  Lock,
  MoreVertical,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { criarNota, listarNotas, type NotaDaConversa } from '@/lib/notas-da-conversa'
import { linhaDoTempo } from '@/lib/linha-do-tempo'
import { CHAVE_DO_VISUAL, EVENTO_MODO_WHATSAPP } from '@/lib/modo-whatsapp'
import { VisualizadorDeArquivo, type ArquivoAberto } from '@/components/VisualizadorDeArquivo'
import { marcaSemClinicaConhecida } from '@/lib/marca'
import { CLINICA_DE_TESTE } from '@/lib/clinica-de-teste'
import {
  getAutoReply,
  getCurrentMembership,
  listConversationMessages,
  linkDoAnexo,
  buscarNasConversas,
  listRespostasProntas,
  listUnits,
  getTelemedicina,
  sendConversationFile,
  type RespostaPronta,
  listConversations,
  getReplyWindow,
  markConversationSeen,
  reopenConversation,
  sendTemplateReply,
  resetConversationBot,
  resumoDoPaciente,
  resolveConversation,
  unresolveConversation,
  voltarAEnviarMensagens,
  saveAutoReply,
  sendConversationReply,
  sendConversationMenu,
  sendConversationQuestionnaire,
  sendConversationSlots,
  type AutoReplySettings,
  type Conversation,
  type ConversationMessage,
  type ResumoDoPaciente,
} from '@/lib/repository'
import { lugaresDoRobo } from '@/lib/lugares'
import MandarHorarios from '@/sections/MandarHorarios'
import SimuladorNasRespostas from '@/sections/SimuladorNasRespostas'
import { useDialogos } from '@/components/dialogos-contexto'
import { useVoltarDoCelular } from '@/lib/voltar-do-celular'
import {
  preencherCampos,
  problemasDoTexto,
  temCampo,
  type Lugar,
} from '../../supabase/functions/_shared/campos-do-texto.ts'

const STATUS_LABEL: Record<Conversation['status'], string> = {
  open: 'Em aberto',
  resolved: 'Concluída',
  opted_out: 'Pediu para não receber',
}

/**
 * Em que etapa o robo parou nesta conversa.
 *
 * Aparece no cartao para a equipe entender por que a pessoa esta recebendo (ou
 * nao recebendo) resposta, e para o botao de destravar fazer sentido.
 */
const ETAPA_DO_ROBO: Record<string, string> = {
  menu: 'no menu',
  minha_consulta: 'vendo a consulta',
  confirmar_cancelamento: 'confirmando cancelamento',
  ja_tem_consulta: 'avisado de consulta existente',
  aguardando_paciente: 'escolhendo o paciente',
  aguardando_unidade: 'escolhendo a unidade',
  aguardando_dia: 'escolhendo o dia',
  aguardando_horario: 'escolhendo o horário',
  atendente: 'aguardando a equipe',
}

/**
 * Nem todo pedido de atencao e igual. Quem escolheu "falar com a equipe" no
 * menu esta esperando uma pessoa agora; uma falha do sistema e assunto nosso,
 * nao do paciente. Cada motivo tem sua cor para a equipe priorizar de longe.
 */
/**
 * A equipe ja respondeu, e nada ficou pendente.
 *
 * Duas condicoes, e a segunda importa tanto quanto a primeira: alguem da equipe
 * escreveu depois do paciente E nao ha pedido aberto. Uma conversa pode ter
 * resposta e continuar pendente - quem pediu remarcacao recebeu "ja vejo aqui"
 * e segue esperando a data. Marcar essa como pronta seria perde-la.
 *
 * E uma das duas portas de estaConcluida(), logo abaixo, que e quem a lista
 * consulta de fato.
 */
function jaRespondida(conversa: Conversation): boolean {
  if (conversa.needsAttention && conversa.attentionReason) return false
  return conversa.respondidaPelaEquipe
}

/**
 * A conversa esta concluida: nada nela espera a clinica.
 *
 * Junta os dois jeitos de terminar - alguem clicou em Concluir (ou o robo
 * fechou sozinho), ou a equipe respondeu e nao ha pedido aberto. Ate
 * 20/09/2026 esses dois tinham etiquetas diferentes, "Resolvida" cinza e
 * "Respondida" verde, e quem olhava a lista lia duas coisas onde so havia uma:
 * "ja tratei". A partir daqui os dois recebem o mesmo tratamento, e ele nao e
 * uma etiqueta: e o cartao ENCOLHER para uma linha.
 *
 * Robo no meio de uma etapa nao conta como concluida, mesmo com o status
 * dizendo que sim. Uma conversa presa em "escolhendo o horario" precisa do
 * botao de destravar a vista, e ele so cabe no cartao inteiro. "No menu" nao e
 * estar preso: e onde toda conversa descansa depois do robo terminar.
 *
 * Quem nao quer receber mensagem fica de fora de proposito: essa etiqueta
 * vermelha e um aviso para a equipe, e encolher a esconderia.
 */
function estaConcluida(conversa: Conversation): boolean {
  if (conversa.status === 'opted_out') return false
  if (conversa.bookingState && conversa.bookingState !== 'menu' && conversa.bookingState !== 'atendente') {
    return false
  }
  if (conversa.status === 'resolved') return true
  return jaRespondida(conversa)
}

/**
 * O menu como a familia recebe. Copia do OPCOES de atendimento.ts, so para a
 * previa desta tela - quem envia de verdade e a Edge Function.
 */
const MENU_DO_ROBO = [
  '*1* 💬 Dúvidas sobre a consulta',
  '*2* 🗓️ Marcar uma consulta ou retorno',
  '*3* 🗣️ Falar com alguém da equipe',
  '*4* 🔄 Ver, remarcar ou cancelar',
  '*5* 📄 2ª via de receita ou pedido de exame',
]

const MOTIVO_ATENCAO: Record<
  NonNullable<Conversation['attentionReason']>,
  { rotulo: string; classe: string; borda: string }
> = {
  // Vermelho porque do outro lado tem alguem parado esperando resposta. Era
  // azul-escuro e se perdia entre as outras etiquetas: quem bate o olho na
  // lista precisa achar estes cartoes antes de qualquer outro.
  //
  // Nao e o mesmo vermelho da urgencia (#b42318, com anel duplo): quem pediu
  // atendente espera uma pessoa, quem pediu urgencia espera uma pessoa AGORA, e
  // as duas coisas nao podem gritar igual.
  atendente: {
    rotulo: 'Quer falar com a equipe',
    classe: 'bg-red-600 text-white',
    borda: 'border-red-500 ring-1 ring-red-500/30',
  },
  remarcacao: {
    rotulo: 'Pediu para remarcar',
    classe: 'bg-[#eef5fd] text-[#16456b]',
    borda: 'border-[#2f7fc1]',
  },
  cancelamento: {
    rotulo: 'Cancelou a consulta',
    classe: 'bg-red-50 text-red-700',
    borda: 'border-red-300',
  },
  ajuda: {
    rotulo: 'Pediu ajuda',
    classe: 'bg-[#eef5fd] text-[#16456b]',
    borda: 'border-[#2f7fc1]',
  },
  cancelou_sozinho: {
    rotulo: 'Cancelou pelo WhatsApp',
    classe: 'bg-[#eef5fd] text-[#16456b]',
    borda: 'border-[#2f7fc1]',
  },
  falha: {
    rotulo: 'Falha no atendimento automático',
    classe: 'bg-red-600 text-white',
    borda: 'border-red-500 ring-1 ring-red-500/30',
  },
  // Mandou foto, exame, documento ou audio. O robo nao le nada disso e entrega
  // para a equipe: tem um arquivo esperando alguem abrir.
  anexo: {
    rotulo: '📎 Enviou um arquivo',
    classe: 'bg-[#eef5fd] text-[#16456b]',
    borda: 'border-[#2f7fc1]',
  },
  // Pediu 2a via de receita ou de exame pelo menu. Nao e vermelho: ninguem
  // esta parado esperando resposta agora, e o robo ja prometeu 1 dia util. Mas
  // e ambar, e nao azul, porque tem prazo correndo - diferente de um aviso de
  // cancelamento, que so precisa ser lido.
  documento: {
    rotulo: '📄 Pediu 2ª via / exame',
    classe: 'bg-[#fef3c7] text-[#92400e]',
    borda: 'border-[#f59e0b]',
  },
  // Farmacia ou laboratorio pedindo correcao. Bandeira separada da de cima
  // porque quem responde precisa saber ANTES de escrever que do outro lado nao
  // esta a familia: nao se confirma cadastro nem se manda documento por ali.
  farmacia: {
    rotulo: '🏥 Farmácia/laboratório',
    classe: 'bg-[#fef3c7] text-[#92400e]',
    borda: 'border-[#f59e0b]',
  },
  // Pediu urgencia na telemedicina: uma crianca passando mal e alguem
  // esperando ligacao. E a unica bandeira que precisa gritar mais que a falha.
  // Telefone da ficha e de outra pessoa (06/10/2026): quem resolve e o
  // cadastro, nao a conversa. Ambar, como os pedidos com tarefa para fazer.
  numero_errado: {
    rotulo: '☎️ Número errado no cadastro',
    classe: 'bg-[#fef3c7] text-[#92400e]',
    borda: 'border-[#f59e0b]',
  },
  urgencia: {
    rotulo: '🚨 Urgência: ligar agora',
    classe: 'bg-[#b42318] text-white',
    borda: 'border-[#b42318] ring-2 ring-[#b42318]/40',
  },
  // O paciente falou em sangramento (Dr. Fabio, 15/10/2026). O mesmo grito da
  // urgencia - o celular do medico e o da Dayane ja tocaram - e o primeiro da
  // lista: no pos-operatorio de otorrino, e o caso que nao espera.
  sangramento: {
    rotulo: '🩸 Sangramento: ligar agora',
    classe: 'bg-[#b42318] text-white',
    borda: 'border-[#b42318] ring-2 ring-[#b42318]/40',
  },
}

/**
 * Recortes da lista (24/09/2026).
 *
 * Busca e datas respondem "onde esta aquela conversa?". O dia a dia pergunta
 * outra coisa: "quem esta esperando o que?" - todas as urgencias, todos os
 * pedidos de 2a via, quem ainda nao tem cadastro. Um recorte por vez, que
 * soma com a busca e as datas.
 */
type Recorte =
  | 'todas'
  | 'atencao'
  | 'novas'
  | 'sem_cadastro'
  | 'robo_parado'
  | `motivo:${NonNullable<Conversation['attentionReason']>}`

function passaNoRecorte(conversa: Conversation, recorte: Recorte): boolean {
  if (recorte === 'todas') return true
  if (recorte === 'atencao') return Boolean(conversa.needsAttention && conversa.attentionReason)
  if (recorte === 'novas') return conversa.unreadCount > 0
  if (recorte === 'sem_cadastro') return !conversa.patientId
  if (recorte === 'robo_parado') {
    // Mesma regra do estaConcluida: "menu" e "atendente" sao descanso, nao
    // etapa. Parado e quem esta no meio de escolher dia, horario, cadastro.
    return Boolean(
      conversa.bookingState && conversa.bookingState !== 'menu' && conversa.bookingState !== 'atendente',
    )
  }
  const motivo = recorte.slice('motivo:'.length)
  return Boolean(conversa.needsAttention && conversa.attentionReason === motivo)
}

// A ordem e a da urgencia: o que tem gente parada esperando vem primeiro.
const ORDEM_DOS_MOTIVOS: NonNullable<Conversation['attentionReason']>[] = [
  'sangramento',
  'urgencia',
  'atendente',
  'documento',
  'farmacia',
  'numero_errado',
  'remarcacao',
  'cancelamento',
  'cancelou_sozinho',
  'anexo',
  'ajuda',
  'falha',
]

/**
 * O papel do WhatsApp: bege com o rabisco discreto por cima.
 *
 * O padrao vai inline como SVG porque nenhum arquivo externo carrega dentro do
 * sistema, e porque um fundo liso perde a referencia visual - e justamente ela
 * que faz a equipe reconhecer a tela como "a conversa do paciente".
 */
const FUNDO_WHATSAPP = {
  backgroundColor: '#efeae2',
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cg fill='none' stroke='%23c4b8a8' stroke-width='1.1' stroke-linecap='round' opacity='.34'%3E%3Cpath d='M10 14h10M12 22c3-3 7-3 10 0'/%3E%3Ccircle cx='58' cy='16' r='5'/%3E%3Cpath d='M50 44l5 5 8-9M20 58h14M22 66h10'/%3E%3Cpath d='M64 62c0 3-3 5-6 5s-6-2-6-5 3-5 6-5 6 2 6 5z'/%3E%3Cpath d='M32 30l6 6 6-6'/%3E%3C/g%3E%3C/svg%3E\")",
} as const

/**
 * Os tiquinhos de entrega, como no aplicativo.
 *
 * Antes esta informacao aparecia como a palavra crua do sistema ("delivered",
 * "read") colada na hora. Quem le a tela ja conhece o simbolo de sempre; ler
 * ingles tecnico ali era ruido.
 */
/**
 * O arquivo que o paciente mandou, aberto na conversa.
 *
 * Antes disto a tela escrevia "[image]" e parava aí: a clínica sabia que algo
 * tinha chegado e precisava abrir o WhatsApp no celular de alguém para ver o
 * quê. Quem manda foto de exame quer que olhem - e era justamente essa a
 * mensagem que o robô encaminhava para a equipe.
 *
 * O link é temporário, de cinco minutos, gerado a cada abertura da conversa.
 * É foto de exame, de lesão, de criança: um endereço permanente seria
 * prontuário circulando solto.
 */
/**
 * Anexo dentro do balao da conversa.
 *
 * Clicar abre o arquivo POR CIMA da tela (VisualizadorDeArquivo), e nao numa
 * aba nova: a recepcao perdia a conversa de vista para conferir um comprovante
 * (25/09/2026). E o link e pedido na hora do clique - o que veio com a conversa
 * vale so cinco minutos, e quem deixava a tela aberta recebia "expirado".
 */
function Anexo({
  url,
  mime,
  caminho,
  onAbrir,
}: {
  url: string
  mime: string | null
  caminho: string | null
  onAbrir: (arquivo: ArquivoAberto) => void
}) {
  const tipo = mime ?? ''
  const [previa, setPrevia] = useState(url)
  const [erro, setErro] = useState('')

  async function linkNovo() {
    if (!caminho) return url
    return linkDoAnexo(caminho)
  }

  async function abrir() {
    setErro('')
    try {
      onAbrir({ url: await linkNovo(), mime, titulo: tipo.startsWith('image/') ? 'Foto enviada' : 'Documento enviado' })
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Não consegui abrir o anexo.')
    }
  }

  if (tipo.startsWith('image/')) {
    return (
      <button type="button" onClick={() => void abrir()} className="block w-full" title="Ver a foto">
        <img
          src={previa}
          alt="Anexo enviado pelo paciente"
          className="mb-1 max-h-[320px] w-full rounded-[6px] object-cover"
          loading="lazy"
          // Previa com link vencido: pede outro, uma vez.
          onError={() => {
            if (!caminho || previa !== url) return
            void linkNovo().then(setPrevia).catch(() => undefined)
          }}
        />
        {erro && <span className="block text-[11px] font-bold text-[#b42318]">{erro}</span>}
      </button>
    )
  }

  if (tipo.startsWith('audio/')) {
    // Áudio toca na própria tela: quem descreve sintoma falando não deveria
    // obrigar a recepção a baixar arquivo para ouvir.
    return <audio src={url} controls className="mb-1 w-[240px]" />
  }

  if (tipo.startsWith('video/')) {
    return <video src={url} controls className="mb-1 max-h-[320px] w-full rounded-[6px]" />
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void abrir()}
        className="mb-1 flex items-center gap-2 rounded-[6px] bg-black/5 px-2 py-1.5 text-[12px] font-bold text-[#111b21] transition hover:bg-black/10"
      >
        <Paperclip className="h-3.5 w-3.5 shrink-0" />
        Abrir documento
      </button>
      {erro && <span className="block text-[11px] font-bold text-[#b42318]">{erro}</span>}
    </>
  )
}

/**
 * Endereco da web vira link clicavel no balao (25/09/2026): a localizacao que
 * a familia compartilha chega como link de mapa, e copiar e colar um endereco
 * comprido era o caminho ate aqui.
 */
function comLinks(texto: string) {
  const partes = texto.split(/(https?:\/\/[^\s]+)/g)
  return partes.map((parte, i) =>
    /^https?:\/\//.test(parte) ? (
      <a key={i} href={parte} target="_blank" rel="noreferrer" className="break-all text-[#027eb5] underline">
        {parte}
      </a>
    ) : (
      parte
    ),
  )
}

function Confirmacao({ status }: { status: string }) {
  if (status === 'failed') {
    return <span className="font-bold text-[#b42318]">falhou</span>
  }
  if (status === 'queued' || status === 'accepted') {
    return <Clock3 className="h-3.5 w-3.5" aria-label="enviando" />
  }
  if (status === 'sent') {
    return <Check className="h-3.5 w-3.5" aria-label="enviada" />
  }
  // Azul so quando o paciente abriu de fato - e a unica confirmacao que diz
  // algo sobre a pessoa, e nao sobre o aparelho dela.
  return (
    <CheckCheck
      className={`h-3.5 w-3.5 ${status === 'read' ? 'text-[#53bdeb]' : ''}`}
      aria-label={status === 'read' ? 'lida' : 'entregue'}
    />
  )
}

function formatWhen(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  const today = new Date()
  const sameDay =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()

  return new Intl.DateTimeFormat('pt-BR',
    sameDay ? { timeStyle: 'short' } : { dateStyle: 'short', timeStyle: 'short' },
  ).format(date)
}

export type PreCadastro = { nome: string; telefone: string }


/* Ajudantes do visual WhatsApp (27/09/2026). */
function iniciais(nome: string) {
  // So palavras que comecam com letra (02/10/2026): "Leticia Freire 🍃" virava
  // "L" + meio emoji (o losango com interrogacao) e "Marcelo Ruiz (filho)"
  // virava "M(". Emoji, parenteses e numeros ficam fora das iniciais.
  const partes = nome.trim().split(/\s+/).filter((parte) => /^\p{L}/u.test(parte))
  const letras = (partes[0]?.[0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')
  return letras.toUpperCase() || '?'
}
const CORES_DE_AVATAR = ['#128c7e', '#2f7fc1', '#8e5cc4', '#d9764f', '#3b9c5a', '#c2527c', '#5b6b7a']
function corDoAvatar(nome: string) {
  let soma = 0
  for (const letra of nome) soma = (soma * 31 + letra.charCodeAt(0)) >>> 0
  return CORES_DE_AVATAR[soma % CORES_DE_AVATAR.length]
}
function diaLocal(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}
function rotuloDoDia(iso: string) {
  const dia = diaLocal(iso)
  const hoje = new Date()
  const ontem = new Date(hoje.getTime() - 86_400_000)
  if (dia === diaLocal(hoje.toISOString())) return 'Hoje'
  if (dia === diaLocal(ontem.toISOString())) return 'Ontem'
  return dia
}
function horaLocal(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function Conversations({
  focoPatientId,
  focoConversa,
  onCadastrarContato,
  compacto = false,
  onAlternarCompacto,
}: {
  focoPatientId?: string | null
  /** Conversa tocada na notificacao do celular. */
  focoConversa?: { id: string; vez: number } | null
  /** Abre a tela de pacientes com nome e telefone do contato ja preenchidos. */
  onCadastrarContato?: (dados: PreCadastro) => void
  /**
   * Cabecalho da pagina recolhido, para sobrar altura para a conversa.
   *
   * Quem manda e o Home, porque metade do que recolhe (titulo, data, "Novo
   * paciente") mora la. Aqui dentro recolhem o cartao do menu automatico e a
   * faixa de filtros - e a busca desce para a barra de contagem, que sempre
   * fica visivel.
   */
  compacto?: boolean
  onAlternarCompacto?: () => void
}) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [busca, setBusca] = useState('')
  // Conversas cujo TEXTO contem a busca, vindas do banco (25/09/2026). null
  // enquanto nao ha busca, ou quando o banco nao respondeu (ai vale o texto
  // que a lista antiga trazia).
  const [idsPelaBusca, setIdsPelaBusca] = useState<Set<string> | null>(null)
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  // Comeca desligado: quem abre a tela espera ver a conversa inteira da
  // clinica. Esconder por conta propria seria decidir pela equipe que o dia
  // anterior nao interessa mais.
  const [esconderConcluidas, setEsconderConcluidas] = useState(false)
  const [recorte, setRecorte] = useState<Recorte>('todas')
  // Cartoes com a previa aberta por inteiro. A previa e uma linha cortada com
  // reticencias, e mensagens como "Voce ja tem uma consulta marcada: Simone
  // Lapetina, sexta 25/09 as 10:40 em Liferty Santos" perdiam justamente a
  // parte que interessava - a data. Abrir a conversa so para ler o fim de uma
  // frase era caminho longo demais para uma informacao tao curta.
  const [previasAbertas, setPreviasAbertas] = useState<Set<string>>(() => new Set())
  const alternarPrevia = (id: string) =>
    setPreviasAbertas((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(id)) proximo.delete(id)
      else proximo.add(id)
      return proximo
    })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  // Notas internas da conversa aberta (25/09/2026): so a equipe ve.
  const [notas, setNotas] = useState<NotaDaConversa[]>([])
  const [erroDasNotas, setErroDasNotas] = useState('')
  const [escrevendoNota, setEscrevendoNota] = useState(false)
  const [textoDaNota, setTextoDaNota] = useState('')
  const [salvandoNota, setSalvandoNota] = useState(false)
  // Foto ou documento aberto por cima da conversa.
  const [arquivoAberto, setArquivoAberto] = useState<ArquivoAberto | null>(null)
  const fecharArquivo = useCallback(() => setArquivoAberto(null), [])
  const [loading, setLoading] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [error, setError] = useState('')
  const { perguntar } = useDialogos()
  const [clinicId, setClinicId] = useState<string | null>(null)
  const [prontas, setProntas] = useState<RespostaPronta[]>([])
  // Valor e endereco de cada atendimento: a resposta pronta com {valores}
  // entra no campo ja preenchida, como o robo a mandaria (14/10/2026).
  const [lugares, setLugares] = useState<Lugar[] | null>(null)
  // Arquivo escolhido para ir junto da proxima resposta (24/09/2026).
  const [arquivo, setArquivo] = useState<File | null>(null)
  const seletorDeArquivo = useRef<HTMLInputElement>(null)

  // As respostas prontas mudam pouco: uma leitura quando a clinica e conhecida.
  // Falhar aqui so tira o atalho; a caixa de resposta continua igual.
  useEffect(() => {
    if (!clinicId) return
    let vivo = true
    listRespostasProntas(clinicId)
      .then((lista) => vivo && setProntas(lista.filter((p) => p.ativa && p.resposta.trim())))
      .catch((erro) => console.warn('Nao consegui carregar as respostas prontas', erro))
    Promise.all([listUnits(clinicId), getTelemedicina(clinicId)])
      .then(([units, tele]) => vivo && setLugares(lugaresDoRobo(units, tele)))
      .catch((erro) => console.warn('Nao consegui ler valores e enderecos das unidades', erro))
    return () => {
      vivo = false
    }
  }, [clinicId])
  const [aoVivo, setAoVivo] = useState(false)
  const [resposta, setResposta] = useState('')
  const [enviando, setEnviando] = useState(false)
  // Instante em que a janela de 24h da Meta fecha para a conversa aberta.
  const [janelaAte, setJanelaAte] = useState<string | null>(null)
  const [reabrindo, setReabrindo] = useState(false)
  const [enviandoModelo, setEnviandoModelo] = useState(false)
  const [avisoRetomada, setAvisoRetomada] = useState('')
  // Recalculado a cada minuto: sem isso a caixa continuaria habilitada depois
  // de a janela vencer com a tela aberta.
  const [agora, setAgora] = useState(() => Date.now())
  const [autoReply, setAutoReply] = useState<AutoReplySettings>({
    enabled: false,
    text: '',
    knownText: '',
    infoText: '',
  })
  const [autoReplyAberto, setAutoReplyAberto] = useState(false)
  const [salvandoAuto, setSalvandoAuto] = useState(false)
  const [avisoAuto, setAvisoAuto] = useState('')
  const [destravando, setDestravando] = useState<string | null>(null)
  // Destravar e do dono da conta (14/10/2026). Ver o comentario no botao.
  const [souDono, setSouDono] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => setAgora(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  /**
   * Toda conversa abre onde ela está: no fim.
   *
   * Antes abria no topo, na primeira mensagem - que numa conversa de semanas
   * atrás é o "olá" do robô. O que acabou de acontecer (a resposta do paciente,
   * o aviso de cancelamento que a equipe mandou) ficava fora da tela, e dava a
   * impressão de que a mensagem não tinha sido enviada. O botão "Ir para o fim"
   * existia justamente porque isto faltava.
   *
   * Depois disso a tela é de quem está lendo. A lista se atualiza sozinha (a
   * cada mensagem nova, a cada confirmação de entrega que muda o tiquinho), e
   * antes cada uma dessas atualizações puxava a página para baixo - quem tinha
   * subido para reler uma conversa antiga perdia o lugar no meio da leitura.
   *
   * Agora só há dois motivos para a tela se mover sozinha: abrir a conversa, e
   * a própria equipe ter acabado de enviar algo (aí a mensagem que ela mandou
   * precisa aparecer, senão parece que não saiu). Para o resto existe o botão
   * "Ir para o fim".
   */
  useEffect(() => {
    if (!selectedId || loadingMessages || messages.length === 0) return
    const primeiraVez = conversaRolada.current !== selectedId
    conversaRolada.current = selectedId
    if (!primeiraVez && !acabamosDeEnviar.current) return
    acabamosDeEnviar.current = false
    fimDasMensagens.current?.scrollIntoView({
      behavior: primeiraVez ? 'auto' : 'smooth',
      block: 'end',
    })
  }, [selectedId, messages, loadingMessages])

  const janelaAberta = janelaAte !== null && new Date(janelaAte).getTime() > agora

  // A assinatura de tempo real e criada uma vez so. Sem estas refs ela ficaria
  // presa ao valor de selectedId do primeiro render e nunca saberia qual
  // conversa esta aberta agora.
  const selectedIdRef = useRef<string | null>(null)
  // Fim da lista de mensagens. O botao de descer rola ate ele.
  const fimDasMensagens = useRef<HTMLDivElement>(null)
  // Topo da lista. O botao de subir rola ate ele.
  const inicioDasMensagens = useRef<HTMLDivElement>(null)
  // O painel da conversa. Ao abrir uma, a tela sobe ate ele, para o cabecalho
  // (nome, telefone, resumo, janela) encostar no topo e ficar travado ali
  // enquanto as mensagens rolam por baixo.
  const painel = useRef<HTMLDivElement>(null)
  const cabecalho = useRef<HTMLDivElement>(null)
  // Altura viva do cabecalho travado. Os botoes "Ir para o inicio/fim" tambem
  // sao grudados, e precisam parar logo ABAIXO dele - nao por tras. Como o
  // cabecalho muda de altura (aviso de janela fechada aparece e some, o
  // resumo quebra linha no celular), a medida vem de um ResizeObserver.
  const [alturaCabecalho, setAlturaCabecalho] = useState(0)

  /**
   * As duas colunas rolam por dentro, como no WhatsApp Web.
   *
   * Antes quem rolava era a pagina inteira: com 29 conversas a lista empurrava
   * o rodape para longe, e ler uma conversa comprida significava perder a
   * lista de vista. Rolar de volta ao topo para trocar de conversa era o
   * caminho de sempre.
   *
   * Agora o bloco das duas colunas tem a altura do que sobra da janela, e cada
   * coluna tem a propria barra. A pagina nao rola mais nesta tela - e por isso
   * a altura e medida, e nao chutada num calc(100vh - 300px): o cabecalho da
   * secao cresce quando os filtros abrem, e um numero fixo deixaria a lista
   * passando do rodape ou sobrando espaco em branco.
   *
   * So no computador. No celular e uma coluna de cada vez e a pagina rolando
   * inteira, que ali e o certo: prender a lista numa janela curta dentro de
   * uma tela ja curta so faz a pessoa rolar duas vezes.
   */
  const colunas = useRef<HTMLDivElement>(null)
  // Altura do bloco e quanto ele avanca sobre o respiro do rodape da pagina.
  // Os dois andam juntos: sem o segundo, o bloco parava 84px antes do fim da
  // janela, no padding que a moldura da pagina reserva para todas as telas.
  const [medidas, setMedidas] = useState<{ altura: number; avancoNoRodape: number } | null>(null)
  // O grid das colunas so existe depois que as conversas carregam: antes disso
  // a tela mostra o aviso de lista vazia. A medicao precisa rodar de novo
  // quando ele aparece - foi por nao fazer isso que a primeira versao subiu ao
  // ar medindo um elemento que ainda nao existia e nunca mais voltou a medir.
  const temColunas = conversations.length > 0

  useEffect(() => {
    if (!temColunas) {
      setMedidas(null)
      return
    }
    const desktop = window.matchMedia('(min-width: 1024px)')
    // O que fica entre o bloco e a borda de baixo da janela. Pequeno de
    // proposito: a tela de conversa ganha em usar a altura inteira, e o
    // cartao arredondado ja separa visualmente do fim.
    const FOLGA = 12

    const medir = () => {
      const alvo = colunas.current
      if (!alvo || !desktop.matches) {
        setMedidas(null)
        return
      }
      const caixa = alvo.getBoundingClientRect()
      const topo = caixa.top + window.scrollY
      // O respiro NATURAL do rodape: o que a moldura da pagina reserva abaixo
      // do bloco (padding do main e do miolo, 84px hoje). Medido descontando
      // o avanco que ja estiver aplicado, senao a segunda medicao leria o
      // rodape ja encolhido, devolveria outro numero, e a tela oscilaria.
      const avancoAtual = Number.parseFloat(getComputedStyle(alvo).marginBottom) || 0
      const respiro = document.documentElement.scrollHeight - (topo + caixa.height) - avancoAtual
      // O bloco vai ate FOLGA px da borda da janela, e avanca sobre o resto
      // do respiro com margem negativa - assim a pagina termina exatamente no
      // fim da janela e nao rola, em vez de sobrar uma faixa vazia embaixo.
      const avanco = Math.max(0, respiro - FOLGA)
      setMedidas({
        altura: Math.max(360, window.innerHeight - topo - FOLGA),
        avancoNoRodape: avanco,
      })
    }

    // Duas vezes: agora, e um quadro depois. A primeira ja acerta quase
    // sempre; a segunda apanha o caso em que fonte ou cabecalho da secao
    // terminam de assentar so no quadro seguinte.
    medir()
    const quadro = requestAnimationFrame(medir)
    window.addEventListener('resize', medir)
    desktop.addEventListener('change', medir)
    // O cabecalho da secao muda de altura quando os filtros abrem ou o aviso
    // de conversas na espera aparece. Sem observar, a lista ficava com a
    // altura de antes e passava do rodape.
    const observador = new ResizeObserver(medir)
    if (colunas.current?.parentElement) observador.observe(colunas.current.parentElement)

    return () => {
      cancelAnimationFrame(quadro)
      window.removeEventListener('resize', medir)
      desktop.removeEventListener('change', medir)
      observador.disconnect()
    }
    // `compacto` entra aqui porque recolher o cabecalho muda onde este bloco
    // comeca na tela. O ResizeObserver acima nao pega isso sozinho: ele olha o
    // tamanho do vizinho, e o que mudou foi o topo, la no Home.
  }, [temColunas, compacto])

  useEffect(() => {
    const alvo = cabecalho.current
    if (!alvo) return
    const medir = () => setAlturaCabecalho(alvo.getBoundingClientRect().height)
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(alvo)
    return () => observador.disconnect()
  }, [selectedId, loadingMessages])
  // Qual conversa ja foi posicionada no fim. Sem isto, cada mensagem nova
  // rolaria a tela de novo enquanto alguem le algo mais acima.
  const conversaRolada = useRef<string | null>(null)
  // Levantada pelos botoes de envio da equipe, e so por eles. E a unica coisa
  // que autoriza a tela a descer com a conversa ja aberta.
  const acabamosDeEnviar = useRef(false)
  const [resumo, setResumo] = useState<ResumoDoPaciente | null>(null)
  selectedIdRef.current = selectedId

  const load = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true)
    setError('')
    try {
      const membership = await getCurrentMembership()
      if (!membership) throw new Error('Não foi possível identificar a clínica do seu usuário.')
      setClinicId(membership.clinicId)
      setSouDono(membership.role === 'owner')
      const [lista, automatica] = await Promise.all([
        listConversations(membership.clinicId),
        getAutoReply(membership.clinicId),
      ])
      setConversations(lista)
      setAutoReply(automatica)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as conversas.')
    } finally {
      if (!silencioso) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // As notas vem a parte das mensagens: falhar aqui nao pode esconder a
  // conversa, so avisar que as notas nao carregaram.
  const carregarNotas = useCallback(async (conversationId: string) => {
    try {
      const lista = await listarNotas(conversationId)
      if (selectedIdRef.current === conversationId) {
        setNotas(lista)
        setErroDasNotas('')
      }
    } catch (causa) {
      if (selectedIdRef.current === conversationId) {
        setNotas([])
        setErroDasNotas(causa instanceof Error ? causa.message : 'Notas internas indisponíveis.')
      }
    }
  }, [])

  async function salvarNota() {
    if (!selectedId || !clinicId || !textoDaNota.trim() || salvandoNota) return
    setSalvandoNota(true)
    setErroDasNotas('')
    try {
      await criarNota(clinicId, selectedId, textoDaNota)
      setTextoDaNota('')
      setEscrevendoNota(false)
      acabamosDeEnviar.current = true
      await carregarNotas(selectedId)
    } catch (causa) {
      setErroDasNotas(causa instanceof Error ? causa.message : 'A nota não foi salva.')
    } finally {
      setSalvandoNota(false)
    }
  }

  /**
   * Quando a tela e aberta pelo botao "Conversa" do acompanhamento, ja abre a
   * conversa daquele paciente. Sem isso a equipe cairia na lista e teria de
   * procurar de novo - que e justamente o atalho que queremos evitar.
   */
  useEffect(() => {
    if (!focoPatientId || conversations.length === 0) return
    const alvo = conversations.find((item) => item.patientId === focoPatientId)
    if (alvo && alvo.id !== selectedId) void openConversation(alvo)
    // openConversation e estavel o bastante para este uso pontual
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focoPatientId, conversations])

  /**
   * Toque na notificacao do celular: abre a conversa pelo id. Cada toque
   * (vez) abre uma so vez - sem isso a lista, ao se atualizar em tempo real,
   * puxaria a pessoa de volta para esta conversa a cada mensagem nova.
   */
  const avisoAtendido = useRef(0)
  useEffect(() => {
    if (!focoConversa || focoConversa.vez === avisoAtendido.current || conversations.length === 0) return
    const alvo = conversations.find((item) => item.id === focoConversa.id)
    if (!alvo) return
    avisoAtendido.current = focoConversa.vez
    if (alvo.id !== selectedId) void openConversation(alvo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focoConversa, conversations])

  /**
   * Tempo real: a tela se atualiza sozinha quando um paciente responde, sem
   * ninguem precisar clicar em Atualizar. Numa clinica, depender de alguem
   * lembrar de atualizar a pagina significa resposta de paciente parada na tela.
   */
  useEffect(() => {
    if (!clinicId) return

    // Recargas agrupadas (25/09/2026). Cada "entregue" e "lida" da Meta e um
    // evento, e cada evento recarregava a lista inteira e a conversa aberta:
    // um lote de dez confirmacoes virava vinte downloads. Agora varios eventos
    // em sequencia viram uma recarga so, e confirmacao de entrega nao mexe na
    // lista - so no tiquinho da conversa que esta aberta.
    let esperaDaLista: number | null = null
    let esperaDaConversa: number | null = null
    const recarregarLista = () => {
      if (esperaDaLista) window.clearTimeout(esperaDaLista)
      esperaDaLista = window.setTimeout(() => void load(true), 1200)
    }
    const recarregarConversa = (conversa: string) => {
      if (esperaDaConversa) window.clearTimeout(esperaDaConversa)
      esperaDaConversa = window.setTimeout(() => {
        if (selectedIdRef.current !== conversa) return
        void listConversationMessages(conversa).then(setMessages).catch(() => {})
        // Se quem escreveu foi o paciente, a janela de 24h reabriu: sem isto
        // a caixa continuaria bloqueada ate alguem trocar de conversa.
        void getReplyWindow(conversa).then(setJanelaAte).catch(() => {})
      }, 500)
    }

    const canal = supabase
      .channel(`conversas-${clinicId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'whatsapp_messages', filter: `clinic_id=eq.${clinicId}` },
        (evento) => {
          const linha = (evento.new ?? evento.old ?? {}) as { conversation_id?: string }
          const aberta = selectedIdRef.current
          // Em exclusao o Supabase manda so o registro antigo, as vezes sem a
          // conversa: na duvida, recarrega a aberta.
          if (aberta && (!linha.conversation_id || linha.conversation_id === aberta)) recarregarConversa(aberta)
          // Mudanca de status (entregue, lida) nao muda a lista.
          if (evento.eventType !== 'UPDATE') recarregarLista()
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'whatsapp_conversations', filter: `clinic_id=eq.${clinicId}` },
        () => recarregarLista(),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversation_notes', filter: `clinic_id=eq.${clinicId}` },
        (evento) => {
          const conversa = (evento.new as { conversation_id?: string } | null)?.conversation_id
          if (conversa && conversa === selectedIdRef.current) void carregarNotas(conversa)
        },
      )
      .subscribe((status) => setAoVivo(status === 'SUBSCRIBED'))

    return () => {
      if (esperaDaLista) window.clearTimeout(esperaDaLista)
      if (esperaDaConversa) window.clearTimeout(esperaDaConversa)
      void supabase.removeChannel(canal)
    }
  }, [clinicId, load, carregarNotas])


  async function openConversation(conversation: Conversation) {
    setSelectedId(conversation.id)
    selectedIdRef.current = conversation.id
    // Arquivo escolhido numa conversa nao pode ir parar em outra - nem a nota.
    setArquivo(null)
    setNotas([])
    setErroDasNotas('')
    setEscrevendoNota(false)
    setTextoDaNota('')
    void carregarNotas(conversation.id)
    setLoadingMessages(true)
    setResposta('')
    setJanelaAte(null)
    // Quem posiciona a tela é o efeito que rola até a última mensagem, logo
    // que ela carrega. Aqui só zeramos a marca, para que a conversa que abre
    // seja tratada como primeira vez e dê o salto seco em vez do suave.
    conversaRolada.current = null
    // O painel sobe para o topo da tela no clique. Sem isto, em conversa
    // curta nada rolava e o cabecalho ficava onde estivesse; com isto, ele
    // encosta no topo e fica travado enquanto as mensagens passam por baixo.
    painel.current?.scrollIntoView({ behavior: 'auto', block: 'start' })
    try {
      const [historico, janela] = await Promise.all([
        listConversationMessages(conversation.id),
        getReplyWindow(conversation.id),
      ])
      setMessages(historico)
      setJanelaAte(janela)
      if (conversation.unreadCount > 0) {
        await markConversationSeen(conversation.id)
        // Abrir so zera as novas. A etiqueta de atencao ("Quer falar com a
        // equipe" e as outras) fica ate alguem responder, concluir ou
        // destravar: ler para acompanhar nao e atender (ver markConversationSeen).
        setConversations((current) =>
          current.map((item) => (item.id === conversation.id ? { ...item, unreadCount: 0 } : item)),
        )
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível abrir a conversa.')
    } finally {
      setLoadingMessages(false)
    }
  }

  async function enviarResposta() {
    const texto = resposta.trim()
    if (!selectedId || (!texto && !arquivo) || enviando) return
    setEnviando(true)
    setError('')
    try {
      // Com arquivo, o texto vira a legenda dele.
      if (arquivo) await sendConversationFile(selectedId, arquivo, texto)
      else await sendConversationReply(selectedId, texto)
      setResposta('')
      setArquivo(null)
      acabamosDeEnviar.current = true
      // O tempo real ja traz a mensagem nova, mas recarregar aqui evita a
      // sensacao de "sumiu" caso a assinatura esteja fora do ar.
      setMessages(await listConversationMessages(selectedId))
      void load(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível enviar a mensagem.')
      // Se a recusa foi por janela fechada, a tela precisa refletir isso.
      setJanelaAte(await getReplyWindow(selectedId).catch(() => null))
    } finally {
      setEnviando(false)
    }
  }

  async function enviarMenu() {
    if (!selectedId || enviando) return
    setEnviando(true)
    setError('')
    try {
      await sendConversationMenu(selectedId)
      acabamosDeEnviar.current = true
      setMessages(await listConversationMessages(selectedId))
      void load(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível enviar o menu.')
    } finally {
      setEnviando(false)
    }
  }

  // Mandar horarios (14/10/2026). O painel fica aberto ate dar certo: a
  // recusa ("nao ha horario livre...") e a escolha do paciente aparecem nele.
  const [painelHorarios, setPainelHorarios] = useState(false)
  const [erroHorarios, setErroHorarios] = useState('')
  const [irmaos, setIrmaos] = useState<{ id: string; nome: string }[] | null>(null)
  useEffect(() => {
    setPainelHorarios(false)
    setErroHorarios('')
    setIrmaos(null)
  }, [selectedId])

  async function enviarHorarios(pedido: Parameters<typeof sendConversationSlots>[1]) {
    if (!selectedId || enviando) return
    setEnviando(true)
    setErroHorarios('')
    try {
      const r = await sendConversationSlots(selectedId, pedido)
      if (r.escolherPaciente) {
        setIrmaos(r.escolherPaciente)
        return
      }
      setPainelHorarios(false)
      setIrmaos(null)
      acabamosDeEnviar.current = true
      setMessages(await listConversationMessages(selectedId))
      void load(true)
    } catch (cause) {
      setErroHorarios(cause instanceof Error ? cause.message : 'Não foi possível mandar os horários.')
    } finally {
      setEnviando(false)
    }
  }

  async function enviarQuestionario() {
    if (!selectedId || enviando) return
    setEnviando(true)
    setError('')
    try {
      await sendConversationQuestionnaire(selectedId)
      acabamosDeEnviar.current = true
      setMessages(await listConversationMessages(selectedId))
      void load(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível enviar o questionário.')
    } finally {
      setEnviando(false)
    }
  }

  async function reabrirConversa() {
    if (!selectedId) return
    setReabrindo(true)
    setAvisoRetomada('')
    try {
      await reopenConversation(selectedId)
      // A janela so reabre quando o PACIENTE responder, entao a caixa continua
      // desligada de proposito. Recarregar as mensagens mostra o que saiu.
      setMessages(await listConversationMessages(selectedId))
    } catch (causa) {
      setAvisoRetomada(causa instanceof Error ? causa.message : 'Não foi possível enviar.')
    } finally {
      setReabrindo(false)
    }
  }

  /**
   * A resposta da equipe com a janela ja fechada.
   *
   * Mesmo campo de escrever de sempre; o que muda e o caminho no servidor, que
   * embrulha o texto num modelo aprovado. Por isso a caixa e esvaziada so no
   * sucesso: se a Meta recusar, o que foi escrito continua ali para tentar de
   * novo ou encurtar.
   */
  async function responderPorModelo() {
    if (!selectedId || !resposta.trim()) return
    setEnviandoModelo(true)
    setAvisoRetomada('')
    try {
      await sendTemplateReply(selectedId, resposta)
      setResposta('')
      acabamosDeEnviar.current = true
      setMessages(await listConversationMessages(selectedId))
      void load(true)
    } catch (causa) {
      setAvisoRetomada(causa instanceof Error ? causa.message : 'Não foi possível enviar.')
    } finally {
      setEnviandoModelo(false)
    }
  }

  async function salvarAutoReply() {
    if (!clinicId || salvandoAuto) return
    // O fecho vai colado no texto de qualquer unidade: so {valores} e
    // {enderecos}. Campo que o robo nao preencheria nao e salvo (14/10/2026).
    const problemas = problemasDoTexto(autoReply.infoText, 'geral', null, lugares ?? []).filter(
      (p) => lugares !== null || !p.startsWith('Falta'),
    )
    if (problemas.length) {
      setAvisoAuto(`Não salvei: ${problemas[0]} O menu no ar continua o mesmo.`)
      return
    }
    setSalvandoAuto(true)
    setAvisoAuto('')
    try {
      await saveAutoReply(clinicId, autoReply)
      setAvisoAuto('Resposta automática salva.')
    } catch (cause) {
      setAvisoAuto(cause instanceof Error ? cause.message : 'Não foi possível salvar.')
    } finally {
      setSalvandoAuto(false)
    }
  }

  // Quem pediu para sair so volta a receber por decisao da equipe. Ver
  // voltarAEnviarMensagens.
  async function voltarAEnviar(conversa: Conversation) {
    const sim = await perguntar({
      titulo: 'Voltar a enviar mensagens?',
      detalhe:
        `${conversa.patientName} pediu para não receber mensagens. Voltando, o sistema torna a mandar ` +
        'lembretes e avisos, e a equipe pode responder por aqui. Faça isso só se a pessoa pediu ou concordou.',
      confirmar: 'Voltar a enviar',
      cancelar: 'Manter fora',
    })
    if (!sim) return
    try {
      await voltarAEnviarMensagens(conversa.id, conversa.patientId ?? null)
      setConversations((current) =>
        current.map((item) => (item.id === conversa.id ? { ...item, status: 'open' } : item)),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível voltar a enviar mensagens.')
    }
  }

  async function reabrir(conversationId: string) {
    try {
      await unresolveConversation(conversationId)
      setConversations((current) =>
        current.map((item) => (item.id === conversationId ? { ...item, status: 'open' } : item)),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível reabrir a conversa.')
    }
  }

  async function resolve(conversationId: string) {
    try {
      await resolveConversation(conversationId)
      setConversations((current) =>
        current.map((item) =>
          item.id === conversationId
            ? {
                ...item,
                status: 'resolved',
                needsAttention: false,
                attentionReason: null,
                unreadCount: 0,
                // Concluir solta o robo (ver resolveConversation).
                bookingState: null,
              }
            : item,
        ),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível concluir a conversa.')
    }
  }

  // Busca e filtro rodam sobre o que ja esta na tela: a listagem carrega as
  // mensagens da clinica para descobrir a ultima de cada conversa, entao
  // procurar dentro do texto nao custa consulta nova.
  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const digitosBusca = termo.replace(/\D/g, '')
    const inicio = de ? new Date(`${de}T00:00:00`).getTime() : null
    // Ate o fim do dia escolhido, e nao a meia-noite: quem digita 15/08 quer o
    // dia 15 inteiro.
    const fim = ate ? new Date(`${ate}T23:59:59.999`).getTime() : null

    const filtradas = conversations.filter((item) => {
      // A conversa aberta continua na lista mesmo escondida: some-la debaixo do
      // proprio leitor, no instante em que a resposta sai, seria tirar a
      // conversa da tela de quem ainda esta nela.
      if (esconderConcluidas && estaConcluida(item) && item.id !== selectedId) return false
      if (!passaNoRecorte(item, recorte) && item.id !== selectedId) return false
      if (inicio !== null || fim !== null) {
        const quando = item.lastMessageAt ? new Date(item.lastMessageAt).getTime() : null
        if (quando === null) return false
        if (inicio !== null && quando < inicio) return false
        if (fim !== null && quando > fim) return false
      }
      if (!termo) return true
      if (item.patientName.toLowerCase().includes(termo)) return true
      if (item.profileName.toLowerCase().includes(termo)) return true
      if (digitosBusca && item.phoneDigits.includes(digitosBusca)) return true
      if (idsPelaBusca) return idsPelaBusca.has(item.id)
      return item.textoBusca.includes(termo)
    })

    // Pendentes primeiro, concluidas depois; dentro de cada grupo, a ordem de
    // sempre (a mais recente em cima). Pedido em 23/09/2026: uma familia
    // esperando a nota fiscal desde a vespera ficava abaixo de oito conversas
    // concluidas so porque elas tinham mensagem mais nova. A lista existe para
    // mostrar o que falta fazer. O sort do JS e estavel, entao a ordem por
    // horario dentro de cada grupo se mantem.
    return [...filtradas].sort((a, b) => Number(estaConcluida(a)) - Number(estaConcluida(b)))
  }, [conversations, busca, de, ate, esconderConcluidas, recorte, selectedId, idsPelaBusca])

  // A busca no texto vai ao banco com um respiro de 400 ms: digitar "refluxo"
  // nao pode virar sete consultas.
  useEffect(() => {
    const termo = busca.trim()
    if (!clinicId || termo.length < 2) {
      setIdsPelaBusca(null)
      return
    }
    let vivo = true
    const espera = window.setTimeout(() => {
      void buscarNasConversas(clinicId, termo).then((ids) => {
        if (vivo) setIdsPelaBusca(ids)
      })
    }, 400)
    return () => {
      vivo = false
      window.clearTimeout(espera)
    }
  }, [busca, clinicId])

  const concluidas = useMemo(() => conversations.filter(estaConcluida).length, [conversations])

  const filtrando = Boolean(busca.trim() || de || ate || recorte !== 'todas')
  /**
   * Solta o robo numa conversa travada, sem depender de ninguem mexer no banco.
   *
   * Nao apaga mensagem, consulta nem cadastro: so o rascunho do atendimento
   * automatico. A proxima mensagem do paciente recomeca do menu.
   */
  async function destravar(conversationId: string) {
    setDestravando(conversationId)
    setError('')
    try {
      await resetConversationBot(conversationId)
      setConversations((atual) =>
        atual.map((item) =>
          item.id === conversationId
            ? { ...item, bookingState: null, needsAttention: false, attentionReason: null }
            : item,
        ),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível destravar o robô.')
    } finally {
      setDestravando(null)
    }
  }

  const attention = conversations.filter((item) => item.needsAttention)
  const querAtendente = attention.filter(
    (item) => item.attentionReason === 'atendente' || item.attentionReason === 'falha',
  )
  const outrasAtencoes = attention.filter(
    (item) => item.attentionReason !== 'atendente' && item.attentionReason !== 'falha',
  )
  const selected = conversations.find((item) => item.id === selectedId) ?? null

  // Resumo do paciente da conversa aberta. Some quando o contato nao tem
  // cadastro: sem paciente nao ha historico para contar.
  useEffect(() => {
    const paciente = selected?.patientId
    if (!clinicId || !paciente) {
      setResumo(null)
      return
    }
    let vivo = true
    void (async () => {
      try {
        const dados = await resumoDoPaciente(clinicId, paciente)
        if (vivo) setResumo(dados)
      } catch {
        if (vivo) setResumo(null)
      }
    })()
    return () => {
      vivo = false
    }
  }, [clinicId, selected?.patientId])


  /**
   * Visual "igual ao WhatsApp" no celular (27/09/2026).
   *
   * Pedido da equipe: no celular, quem responde familia o dia inteiro vive no
   * WhatsApp, e a conversa aqui tinha outra cara - botoes, blocos, resumo em
   * cima. Este modo abre a conversa em tela cheia, com a barra de cima, o papel
   * de parede, os baloes e a barra de digitar do app. O visual padrao continua
   * sendo o padrao; a escolha fica guardada neste aparelho.
   *
   * Tudo o que a equipe faz aqui passa pelas MESMAS funcoes do visual padrao
   * (enviarResposta, responderPorModelo, reabrirConversa...). So muda a casca:
   * uma regra nova de envio nao pode existir num visual e faltar no outro.
   */
  const [visualWhatsApp, setVisualWhatsApp] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(CHAVE_DO_VISUAL) === 'whatsapp'
    } catch {
      return false
    }
  })
  const trocarVisual = (whatsapp: boolean) => {
    setVisualWhatsApp(whatsapp)
    setMenuWhats(false)
    try {
      window.localStorage.setItem(CHAVE_DO_VISUAL, whatsapp ? 'whatsapp' : 'padrao')
    } catch {
      // sem armazenamento: vale ate recarregar a pagina
    }
  }
  const [telaDeCelular, setTelaDeCelular] = useState(() => window.matchMedia('(max-width: 1023px)').matches)
  useEffect(() => {
    const consulta = window.matchMedia('(max-width: 1023px)')
    const mudar = () => setTelaDeCelular(consulta.matches)
    consulta.addEventListener('change', mudar)
    return () => consulta.removeEventListener('change', mudar)
  }, [])
  const [menuWhats, setMenuWhats] = useState(false)
  const rolagemWhats = useRef<HTMLDivElement>(null)
  const modoWhatsApp = visualWhatsApp && telaDeCelular && selected !== null
  // Modo WhatsApp completo no celular (02/10/2026): sem conversa aberta, a
  // LISTA tambem vira tela cheia, sem o menu da clinica, comecando la em
  // cima - como o app. "Chat normal" volta ao visual da clinica.
  const modoListaWhats = visualWhatsApp && telaDeCelular && selected === null
  // O balao azul da barra do celular (Home) liga o modo de fora.
  useEffect(() => {
    const ligar = () => {
      setVisualWhatsApp(true)
      setMenuWhats(false)
    }
    window.addEventListener(EVENTO_MODO_WHATSAPP, ligar)
    return () => window.removeEventListener(EVENTO_MODO_WHATSAPP, ligar)
  }, [])

  // Tela cheia de verdade: a pagina de tras nao rola junto com a conversa.
  useEffect(() => {
    if (!modoWhatsApp && !modoListaWhats) return
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = antes
    }
  }, [modoWhatsApp, modoListaWhats])

  // Depois de enviar, o campo volta a ter uma linha so.
  useEffect(() => {
    if (resposta) return
    const campo = document.getElementById('resposta-whatsapp')
    if (campo) campo.style.height = ''
  }, [resposta])

  // Abre JA no fim, como o WhatsApp (28/09/2026). Antes a conversa aparecia
  // no topo e descia na frente da pessoa: o scroll rodava depois da pintura
  // (useEffect) e as fotos, carregando depois, empurravam o fim para baixo.
  // Agora posiciona antes de pintar e fica "grudada" no fim enquanto o
  // conteudo cresce - ate a pessoa subir para ler, ai para de puxar.
  const grudadoNoFim = useRef(true)
  const conteudoWhats = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (!modoWhatsApp) return
    grudadoNoFim.current = true
    const caixa = rolagemWhats.current
    if (caixa) caixa.scrollTop = caixa.scrollHeight
  }, [modoWhatsApp, selectedId, loadingMessages])
  useLayoutEffect(() => {
    if (!modoWhatsApp || !grudadoNoFim.current) return
    const caixa = rolagemWhats.current
    if (caixa) caixa.scrollTop = caixa.scrollHeight
  }, [modoWhatsApp, messages.length, notas.length])
  useEffect(() => {
    if (!modoWhatsApp) return
    const caixa = rolagemWhats.current
    const conteudo = conteudoWhats.current
    if (!caixa || !conteudo) return
    const observador = new ResizeObserver(() => {
      if (grudadoNoFim.current) caixa.scrollTop = caixa.scrollHeight
    })
    observador.observe(conteudo)
    return () => observador.disconnect()
  }, [modoWhatsApp, selectedId, loadingMessages])

  // Voltar para a lista leva ao TOPO dela (28/09/2026). No celular a pagina
  // inteira rola, e a pessoa voltava parada no meio da lista, na altura em
  // que a conversa estava.
  function voltarParaALista() {
    setSelectedId(null)
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'auto' }))
  }
  // No celular a conversa aberta cobre a lista: o voltar do aparelho volta
  // para ela, como a seta de cima (ver useVoltarDoCelular).
  useVoltarDoCelular(telaDeCelular && selected !== null, voltarParaALista)

  if (loading) {
    return (
      <div className="surface-card rounded-[22px] p-8 text-center text-xs font-semibold text-slate-500">
        Carregando conversas...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Gruda no topo da tela em vez de ficar parado no começo da página.
          O aviso nascia aqui em cima, e quem aperta um botão da conversa está
          lá embaixo, depois de dezenas de mensagens: o servidor recusava o
          envio com o motivo explicado, e para quem estava olhando o botão não
          acontecia nada. Foi o que houve com o Questionário. */}
      {error && (
        <div className="sticky top-2 z-30 flex items-start gap-2 rounded-[16px] border border-red-200 bg-red-50 p-3 text-[11px] font-semibold text-red-700 shadow-[0_4px_14px_rgba(11,20,26,.12)]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Quem escolheu "falar com a equipe" ganha um aviso proprio e mais forte:
          o robo parou de responder essa pessoa, entao ela so sai do lugar se
          alguem daqui abrir a conversa. */}
      {querAtendente.length > 0 && (
        <button
          type="button"
          onClick={() => void openConversation(querAtendente[0])}
          className="flex w-full items-center gap-2 rounded-[16px] border-2 border-[#16456b] bg-[#16456b] p-3 text-left text-[11px] font-bold text-white transition hover:bg-[#123852]"
        >
          <MessageSquareText className="h-4 w-4 shrink-0" />
          {querAtendente.length === 1
            ? '1 pessoa pediu para falar com a equipe e está esperando resposta.'
            : `${querAtendente.length} pessoas pediram para falar com a equipe e estão esperando resposta.`}
        </button>
      )}

      {outrasAtencoes.length > 0 && (
        <div className="flex items-center gap-2 rounded-[16px] border border-[#2f7fc1]/40 bg-[#eef5fd] p-3 text-[11px] font-bold text-[#16456b]">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {outrasAtencoes.length === 1
            ? '1 paciente respondeu e está aguardando retorno da equipe.'
            : `${outrasAtencoes.length} pacientes responderam e estão aguardando retorno da equipe.`}
        </div>
      )}

      {/* Simulador do robo (16/10/2026): testar o robo desta clinica sem
          paciente de verdade. Ver SimuladorNasRespostas.tsx. */}
      <SimuladorNasRespostas compacto={compacto} />

      {/* Resposta automatica de primeiro contato. Fica aqui, e nao numa tela de
          configuracao escondida, porque quem cuida das conversas e quem sabe se
          o texto esta certo.

          Some quando o cabecalho esta recolhido: e ajuste que se faz uma vez
          por mes, e estava custando ~90px de altura todo dia. */}
      <div className={`surface-card rounded-[18px] p-3 ${compacto ? 'hidden' : ''}`}>
        <button
          type="button"
          onClick={() => setAutoReplyAberto((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="flex items-center gap-2 text-[11px] font-extrabold text-[#081b2c]">
            <Sparkles className="h-3.5 w-3.5 text-[#2f7fc1]" />
            Menu automático do WhatsApp
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold ${
              autoReply.enabled
                ? 'bg-[#eef3f2] text-[#557f75]'
                : 'bg-slate-100 text-slate-500'
            }`}
          >
            {autoReply.enabled ? 'Ligada' : 'Desligada'}
          </span>
        </button>

        {autoReplyAberto && (
          <div className="mt-3 border-t border-[#081b2c]/[0.07] pt-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoReply.enabled}
                onChange={(e) => setAutoReply({ ...autoReply, enabled: e.target.checked })}
                className="h-3.5 w-3.5 accent-[#2f7fc1]"
              />
              <span className="text-[11px] font-bold text-[#081b2c]">
                Responder automaticamente quem escreve para a clínica
              </span>
            </label>

            {/* As opcoes nao sao editaveis: elas correspondem ao que o sistema
                sabe fazer. Mostrar o menu montado evita a duvida de "onde eu
                escrevo as opcoes?".

                ESTA LISTA E COPIA. A original vive em OPCOES, no arquivo
                supabase/functions/_shared/atendimento.ts, que e o que a familia
                de fato recebe. Mexeu la, mexa aqui: em 20/09/2026 esta previa
                ainda mostrava tres opcoes enquanto o robo ja mandava cinco, e a
                tela de configuracao passou semanas ensinando o menu errado a
                quem ia conferir justamente isso. */}
            <p className="mt-3 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">
              Como a mensagem chega
            </p>
            <div className="mt-1 whitespace-pre-line rounded-[14px] border border-[#081b2c]/10 bg-[#fbfaf8] p-3 text-[11px] leading-relaxed text-[#081b2c]">
              <span className="text-slate-500">{autoReply.text || 'Saudação'}</span>
              {'\n\nEstamos aqui para cuidar do seu filho. Como podemos ajudar hoje?\n\n' +
                MENU_DO_ROBO.map((linha) => linha).join('\n') +
                '\n\nResponda com o número ou toque em "Ver opções".'}
            </div>

            <p className="mt-3 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">
              Saudação para quem não é paciente cadastrado
            </p>
            <textarea
              value={autoReply.text}
              onChange={(e) => setAutoReply({ ...autoReply, text: e.target.value })}
              rows={2}
              className="mt-1 w-full resize-y rounded-[14px] border border-[#081b2c]/10 bg-white p-3 text-[11px] leading-relaxed outline-none focus:border-[#2f7fc1]"
            />

            <p className="mt-3 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">
              Saudação para quem já é paciente
            </p>
            <textarea
              value={autoReply.knownText}
              onChange={(e) => setAutoReply({ ...autoReply, knownText: e.target.value })}
              rows={2}
              className="mt-1 w-full resize-y rounded-[14px] border border-[#081b2c]/10 bg-white p-3 text-[11px] leading-relaxed outline-none focus:border-[#2f7fc1]"
            />
            <p className="mt-2 text-[10px] text-slate-500">
              O sistema identifica o paciente pelo telefone. <strong>{'{nome}'}</strong> é o primeiro nome
              da criança. Quem escreve costuma ser a mãe, então &quot;Olá, {'{nome}'}!&quot; sai como
              &quot;Olá!&quot;, e o nome da criança aparece logo abaixo, no menu.
            </p>

            <p className="mt-3 text-[10px] font-extrabold uppercase tracking-wide text-slate-400">
              Opção 1 - Fecho comum das informações
            </p>
            <textarea
              value={autoReply.infoText}
              onChange={(e) => setAutoReply({ ...autoReply, infoText: e.target.value })}
              rows={12}
              className="mt-1 w-full resize-y rounded-[14px] border border-[#081b2c]/10 bg-white p-3 text-[11px] leading-relaxed outline-none focus:border-[#2f7fc1]"
            />
            <p className="mt-2 text-[10px] text-slate-500">
              Vai no fim do texto de qualquer unidade e da telemedicina: como agendar, como falar com a
              equipe, telefones e horário. O valor, o endereço e o que levar de cada lugar ficam no
              cartão de cada unidade, em Agenda → Configuração → Unidades. Aqui dá para usar{' '}
              <strong>{'{valores}'}</strong> e <strong>{'{enderecos}'}</strong>, que listam cada uma.
            </p>
            <p className="mt-1 text-[10px] text-slate-500">
              A opção 2 usa a agenda das unidades e a 4 mexe na consulta já marcada. A opção 3
              marca a conversa aqui em destaque e o robô para de responder, para não falar por
              cima da equipe. A 5 registra o pedido de 2ª via ou de exame e também chama a
              equipe. Quem está respondendo acompanhamento ou lembrete de consulta não recebe o
              menu.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void salvarAutoReply()}
                disabled={salvandoAuto}
                className="rounded-xl bg-[#081b2c] px-4 py-2 text-[10px] font-extrabold text-white transition hover:bg-[#102d47] disabled:opacity-40"
              >
                {salvandoAuto ? 'Salvando...' : 'Salvar menu automático'}
              </button>
              {/* Verde so o sucesso: recusa e erro do banco em verde pareciam
                  "salvo" para quem olhava de relance. */}
              {avisoAuto && (
                <span
                  className={`text-[10px] font-bold ${
                    avisoAuto === 'Resposta automática salva.' ? 'text-[#557f75]' : 'text-red-600'
                  }`}
                >
                  {avisoAuto}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {conversations.length > 0 && !compacto && (
        <div className="surface-card flex flex-wrap items-center gap-2 rounded-[18px] p-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, telefone ou algo que foi dito"
              className="w-full rounded-[12px] border border-[#081b2c]/10 bg-white py-2 pl-9 pr-3 text-[11px] outline-none focus:border-[#2f7fc1]"
            />
          </div>
          <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
            De
            <input
              type="date"
              value={de}
              onChange={(e) => setDe(e.target.value)}
              className="rounded-[12px] border border-[#081b2c]/10 bg-white px-2 py-2 text-[11px] outline-none focus:border-[#2f7fc1]"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
            até
            <input
              type="date"
              value={ate}
              onChange={(e) => setAte(e.target.value)}
              className="rounded-[12px] border border-[#081b2c]/10 bg-white px-2 py-2 text-[11px] outline-none focus:border-[#2f7fc1]"
            />
          </label>
          {filtrando && (
            <button
              type="button"
              onClick={() => {
                setBusca('')
                setDe('')
                setAte('')
                setRecorte('todas')
              }}
              className="inline-flex items-center gap-1 rounded-[12px] bg-slate-100 px-3 py-2 text-[10px] font-extrabold text-slate-600 transition hover:bg-slate-200"
            >
              <X className="h-3 w-3" />
              Limpar
            </button>
          )}
        </div>
      )}

      {/* Esta barra e a unica que nunca recolhe, e por isso ela carrega a
          busca quando o cabecalho esta fechado. Buscar e tarefa de todo dia:
          se sumisse junto, a equipe passaria o dia abrindo e fechando o
          cabecalho, e o espaco ganho voltaria pela porta dos fundos. */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
          {conversations.length === 0
            ? 'Nenhuma conversa ainda'
            : filtrando
              ? `${visiveis.length} de ${conversations.length} ${conversations.length === 1 ? 'conversa' : 'conversas'}`
              : `${conversations.length} ${conversations.length === 1 ? 'conversa' : 'conversas'}`}
          {aoVivo && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#eef3f2] px-2 py-0.5 text-[9px] font-extrabold text-[#557f75]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#3fa88a]" />
              Ao vivo
            </span>
          )}
        </p>

        {compacto && conversations.length > 0 && (
          <div className="relative min-w-[160px] max-w-[420px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, telefone ou algo que foi dito"
              className="w-full rounded-[12px] border border-[#081b2c]/10 bg-white py-1.5 pl-9 pr-8 text-[11px] outline-none focus:border-[#2f7fc1]"
            />
            {/* Limpa tambem as datas. Elas ficam no cabecalho recolhido: sem
                isto um filtro de data ligado antes de recolher continuaria
                cortando a lista sem nada na tela dizendo por que. */}
            {filtrando && (
              <button
                type="button"
                onClick={() => {
                  setBusca('')
                  setDe('')
                  setAte('')
                  setRecorte('todas')
                }}
                title="Limpar busca e datas"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {/* Fica nesta barra, e nao no cabecalho, para funcionar tambem com o
              topo recolhido - que e como a recepcao trabalha em tela pequena. */}
          {conversations.length > 0 && (
            <select
              value={recorte}
              onChange={(e) => setRecorte(e.target.value as Recorte)}
              title="Mostrar só um tipo de conversa"
              className={`rounded-xl border px-2.5 py-1.5 text-[10px] font-extrabold outline-none transition ${
                recorte === 'todas'
                  ? 'border-[#081b2c]/10 bg-white text-slate-600'
                  : 'border-[#2f7fc1] bg-[#eef5fd] text-[#16456b]'
              }`}
            >
              <option value="todas">Todas as conversas</option>
              <option value="atencao">Pedindo atenção (qualquer motivo)</option>
              {ORDEM_DOS_MOTIVOS.map((chave) => {
                const quantas = conversations.filter(
                  (c) => c.needsAttention && c.attentionReason === chave,
                ).length
                return (
                  <option key={chave} value={`motivo:${chave}`}>
                    {MOTIVO_ATENCAO[chave].rotulo} ({quantas})
                  </option>
                )
              })}
              <option value="novas">Com mensagens novas</option>
              <option value="sem_cadastro">Sem cadastro</option>
              <option value="robo_parado">Robô parado numa etapa</option>
            </select>
          )}
          {onAlternarCompacto && (
            <button
              type="button"
              onClick={onAlternarCompacto}
              title={
                compacto
                  ? 'Mostrar o título, os filtros e o menu automático'
                  : 'Recolher o topo e dar mais altura para a conversa'
              }
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5 text-[10px] font-extrabold text-slate-600 transition hover:bg-slate-200"
            >
              {compacto ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
              {compacto ? 'Mostrar topo' : 'Mais espaço'}
            </button>
          )}
          {/* Encolher ja separa as concluidas, mas em dia cheio elas continuam
              ocupando a lista. Este botao tira as resolvidas da frente e deixa
              so o que falta - sem apagar nada: e um filtro de tela, e volta no
              mesmo clique. */}
          {concluidas > 0 && (
            <button
              type="button"
              onClick={() => setEsconderConcluidas((atual) => !atual)}
              className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[10px] font-extrabold transition ${
                esconderConcluidas
                  ? 'bg-[#557f75] text-white hover:bg-[#4a6f66]'
                  : 'bg-[#eef3f2] text-[#557f75] hover:bg-[#e2ece9]'
              }`}
            >
              <Check className="h-3.5 w-3.5" />
              {esconderConcluidas ? `Mostrar concluídas (${concluidas})` : 'Esconder concluídas'}
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[#eef3f2] px-3 py-1.5 text-[10px] font-extrabold text-[#557f75] transition hover:bg-[#e2ece9]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </button>
        </div>
      </div>

      {conversations.length === 0 ? (
        <div className="surface-card rounded-[22px] p-10 text-center">
          <MessageSquareText className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-bold text-[#081b2c]">Nenhuma resposta recebida ainda</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
            Quando um paciente responder a mensagem de acompanhamento, a conversa aparece aqui.
          </p>
        </div>
      ) : (
        /* minmax(0,1fr) tambem na coluna unica do celular. Sem isso a coluna
           implicita e "auto", e o texto sem quebra das previas (truncate) faz
           a coluna crescer ate a largura do texto inteiro: a lista saia pela
           direita da tela e o botao de cada conversa ficava fora do alcance. */
        <div
          ref={colunas}
          style={
            medidas
              ? { height: medidas.altura, marginBottom: -medidas.avancoNoRodape }
              : undefined
          }
          className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:overflow-hidden"
        >
          {/* No computador, lista e conversa convivem lado a lado. No celular
              nao cabem: a conversa ficava embaixo da lista inteira, e tocar num
              nome parecia nao fazer nada - a tela continuava igual e o
              historico estava a muitas rolagens de distancia. Aqui vale uma
              coisa de cada vez, com o botao de voltar no topo da conversa. */}
          <div
            className={`rolagem-fina min-w-0 space-y-2 lg:h-full lg:overflow-y-auto lg:pr-1 ${
              selected ? 'hidden lg:block' : ''
            }`}
          >
            {visiveis.length === 0 && (
              <div className="surface-card rounded-[18px] p-6 text-center text-[11px] font-semibold text-slate-500">
                {/* Sem esta frase, esconder as concluidas num dia em que tudo
                    foi respondido devolvia "nenhuma conversa com esses filtros"
                    - e parece que a lista quebrou, quando na verdade e a melhor
                    noticia possivel. */}
                {esconderConcluidas && !filtrando
                  ? 'Tudo concluído. Nada esperando a equipe.'
                  : 'Nenhuma conversa encontrada com esses filtros.'}
              </div>
            )}
            {visiveis.map((conversation) => {
              const active = conversation.id === selectedId
              const motivo = conversation.needsAttention && conversation.attentionReason
                ? MOTIVO_ATENCAO[conversation.attentionReason]
                : null
              // O contorno do motivo vence o de "selecionada": quem pediu
              // atendente precisa saltar da lista mesmo sem estar aberta.
              const contorno = motivo
                ? `${motivo.borda} bg-white`
                : active
                  ? 'border-[#2f7fc1] bg-white shadow-[0_10px_28px_rgba(8,27,44,.10)]'
                  : 'border-[#081b2c]/10 bg-white/70 hover:border-[#081b2c]/20 hover:bg-white'
              const semCadastro = !conversation.patientId
              // Sem cadastro, o nome do WhatsApp e melhor do que "Contato sem
              // cadastro" - mas vem com etiqueta, porque e o apelido que a
              // pessoa escolheu, nao um nome conferido pela clinica.
              const titulo = semCadastro
                ? conversation.profileName || 'Contato sem cadastro'
                : conversation.patientName

              // Concluida encolhe. A altura do cartao passa a carregar o
              // significado: pendente e cartao inteiro, concluida e uma linha
              // fina com um check. A lista respira sozinha, sem etiqueta.
              //
              // Nao e definitivo: a proxima mensagem do paciente reabre a
              // conversa no webhook, o status volta a 'open', e o cartao volta
              // a crescer - e a subir, porque a ordem e pela ultima mensagem.
              // Do lado da clinica, responder e concluir encolhe de novo.
              //
              // A que esta aberta ao lado volta a ser cartao inteiro: quem
              // esta lendo a conversa quer ver de quem e, o telefone e a
              // ultima mensagem sem precisar procurar. Ao trocar para outra,
              // ela encolhe de novo.
              if (estaConcluida(conversation) && !active) {
                return (
                  <div
                    key={conversation.id}
                    className={`flex w-full items-center gap-2 rounded-[12px] border px-3 py-2 transition ${
                      active
                        ? 'border-[#2f7fc1] bg-white shadow-[0_6px_18px_rgba(8,27,44,.08)]'
                        : 'border-[#237128]/20 bg-[#f4f9f5] hover:border-[#237128]/40 hover:bg-[#eaf3ec]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => void openConversation(conversation)}
                      title="Concluída. Toque para abrir a conversa."
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#237128] text-white">
                        <Check className="h-2.5 w-2.5" />
                      </span>
                      <span className="truncate text-[11px] font-bold text-[#5b6b78]">{titulo}</span>
                    </button>
                    {/* Sem cadastro, a acao continua a mao - compacta. Sumir com
                        ela so porque a conversa terminou deixaria o contato sem
                        ficha para sempre, que e justamente quando ele mais
                        precisa de uma. */}
                    {semCadastro && onCadastrarContato && (
                      <button
                        type="button"
                        onClick={() =>
                          onCadastrarContato({
                            nome: conversation.profileName,
                            telefone: conversation.phone,
                          })
                        }
                        title="Cadastrar como paciente"
                        aria-label="Cadastrar como paciente"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#081b2c]/10 bg-white text-[#2f7fc1] transition hover:border-[#2f7fc1]"
                      >
                        <UserPlus className="h-3 w-3" />
                      </button>
                    )}
                    <span className="shrink-0 text-[9px] font-bold text-slate-400">
                      {formatWhen(conversation.lastMessageAt)}
                    </span>
                  </div>
                )
              }

              return (
                <div
                  key={conversation.id}
                  className={`w-full rounded-[18px] border p-3 transition ${contorno}`}
                >
                  <button
                    type="button"
                    onClick={() => void openConversation(conversation)}
                    className="w-full text-left"
                  >
                  <div className="flex items-start justify-between gap-2">
                    <span className="truncate text-xs font-extrabold text-[#081b2c]">
                      {titulo}
                    </span>
                    <span className="shrink-0 text-[9px] font-bold text-slate-400">
                      {formatWhen(conversation.lastMessageAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] font-bold tracking-wide text-slate-400">
                    {conversation.phone}
                  </p>
                  {(() => {
                    const texto = conversation.lastMessage || 'Sem mensagens'
                    const aberta = previasAbertas.has(conversation.id)
                    // So oferece a seta quando ha o que esconder. Uma linha
                    // curta com botao de expandir e ruido: a pessoa toca e nada
                    // muda.
                    const longa = texto.length > 56 || texto.includes('\n')
                    return (
                      <div className="mt-1 flex items-start gap-1">
                        <p
                          className={`min-w-0 flex-1 text-[11px] text-slate-500 ${
                            aberta ? 'whitespace-pre-line break-words' : 'truncate'
                          }`}
                        >
                          {texto}
                        </p>
                        {longa && (
                          /* span com role de botao, e nao <button>: este trecho
                             ja esta dentro do botao que abre a conversa, e
                             botao dentro de botao e HTML invalido - o clique
                             subiria e abriria a conversa junto. O stopPropagation
                             segura o clique aqui. */
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label={aberta ? 'Encolher a mensagem' : 'Ver a mensagem inteira'}
                            title={aberta ? 'Encolher' : 'Ver tudo'}
                            onClick={(e) => {
                              e.stopPropagation()
                              alternarPrevia(conversation.id)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                e.stopPropagation()
                                alternarPrevia(conversation.id)
                              }
                            }}
                            className="mt-0.5 inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-[#081b2c]"
                          >
                            {aberta ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </span>
                        )}
                      </div>
                    )
                  })()}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {semCadastro && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-extrabold text-slate-500">
                        {conversation.profileName ? 'Nome do WhatsApp' : 'Sem cadastro'}
                      </span>
                    )}
                    {motivo ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold ${motivo.classe}`}
                      >
                        {motivo.rotulo}
                      </span>
                    ) : conversation.needsAttention ? (
                      <span className="rounded-full bg-[#eef5fd] px-2 py-0.5 text-[9px] font-extrabold text-[#16456b]">
                        Aguardando retorno
                      </span>
                    ) : null}
                    {conversation.unreadCount > 0 && (
                      <span className="rounded-full bg-[#081b2c] px-2 py-0.5 text-[9px] font-extrabold text-white">
                        {conversation.unreadCount} nova{conversation.unreadCount > 1 ? 's' : ''}
                      </span>
                    )}
                    {conversation.status === 'opted_out' && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-extrabold text-red-600">
                        <CircleSlash className="h-2.5 w-2.5" />
                        Não quer receber
                      </span>
                    )}
                    {/* Saiu so do acompanhamento: lembrete e resposta seguem
                        normais, mas a equipe precisa saber antes de mandar um. */}
                    {conversation.status !== 'opted_out' && conversation.semAcompanhamento && (
                      <span
                        title="Pediu para não receber acompanhamento. Lembrete de consulta e respostas continuam normais."
                        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-extrabold text-slate-500"
                      >
                        <CircleSlash className="h-2.5 w-2.5" />
                        Sem acompanhamento
                      </span>
                    )}
                    {/* Concluida normalmente encolhe. Chega aqui em cartao
                        inteiro em dois casos: quando esta aberta ao lado, e
                        quando o robo ficou preso numa etapa e o botao de
                        destravar precisa do espaco. Nos dois, a etiqueta e o
                        mesmo check verde do encolhido - a mesma coisa em dois
                        tamanhos, e nao dois estados. */}
                    {(estaConcluida(conversation) || conversation.status === 'resolved') && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#237128] px-2 py-0.5 text-[9px] font-extrabold text-white">
                        <Check className="h-2.5 w-2.5" />
                        Concluída
                      </span>
                    )}
                  </div>
                  </button>

                  {/* Etapa do robo + botao de soltar. Aparece so quando ha
                      algo preso: sem etapa aberta, nao ha o que destravar.

                      Na conta de teste aparece sempre (14/10/2026). Quem testa
                      o robo escreve como equipe e responde do proprio celular;
                      com a equipe tendo escrito, o robo fica calado por 12h e,
                      sem etapa aberta, nao havia botao nenhum para solta-lo.

                      Na clinica real (14/10/2026): nada em "aguardando a
                      equipe" nem "no menu" (o mesmo criterio de etapa presa
                      do cartao, mais acima), e o botao so para o dono da
                      conta. A recepcao
                      usava Destravar para "limpar" a conversa depois de
                      responder - em 13/10, oito em doze minutos -, e
                      destravar devolve a conversa ao robo: a Isabelle e a
                      Susan responderam a pergunta da secretaria e receberam o
                      menu e um texto pronto por cima. "Aguardando a equipe"
                      nao e robo preso, e a conversa esperando quem a esta
                      atendendo; etapa de agendamento parada vence sozinha em
                      24h. Para encerrar, o caminho e Concluir. */}
                  {(clinicId === CLINICA_DE_TESTE ||
                    (conversation.bookingState &&
                      conversation.bookingState !== 'atendente' &&
                      conversation.bookingState !== 'menu')) && (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-[12px] bg-[#f6f4f1] px-2.5 py-1.5">
                      <span className="truncate text-[9px] font-bold text-slate-500">
                        Robô:{' '}
                        {conversation.bookingState
                          ? (ETAPA_DO_ROBO[conversation.bookingState] ?? conversation.bookingState)
                          : 'conta de teste'}
                      </span>
                      {(souDono || clinicId === CLINICA_DE_TESTE) && (
                        <button
                          type="button"
                          onClick={() => void destravar(conversation.id)}
                          disabled={destravando === conversation.id}
                          title={
                            conversation.bookingState
                              ? 'Zera a etapa do robô. Não apaga mensagens nem consultas.'
                              : 'Conta de teste: devolve a conversa ao robô agora, mesmo com a equipe tendo escrito. Não apaga mensagens nem consultas.'
                          }
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-white px-2 py-1 text-[9px] font-extrabold text-[#081b2c] transition hover:bg-[#081b2c] hover:text-white disabled:opacity-40"
                        >
                          <RotateCcw className="h-3 w-3" />
                          {destravando === conversation.id ? 'Soltando...' : 'Destravar'}
                        </button>
                      )}
                    </div>
                  )}

                  {semCadastro && onCadastrarContato && (
                    <button
                      type="button"
                      onClick={() =>
                        onCadastrarContato({
                          // O apelido do WhatsApp entra so como ponto de
                          // partida: quem cadastra confere e corrige.
                          nome: conversation.profileName,
                          telefone: conversation.phone,
                        })
                      }
                      className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-[12px] border border-[#081b2c]/15 bg-white px-3 py-2 text-[10px] font-extrabold text-[#081b2c] transition hover:border-[#2f7fc1] hover:text-[#16456b]"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Cadastrar como paciente
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {/* SEM padding no proprio painel, de proposito. Ele e a area
              rolavel, e o navegador ancora um elemento sticky na caixa de
              conteudo do rolavel - ou seja, DENTRO do padding. Com p-4 aqui, o
              cabecalho grudava 16px abaixo do topo e as mensagens passavam por
              essa faixa descoberta, aparecendo em cima dele. O respiro vai para
              as partes internas, onde nao atrapalha o sticky. */}
          <div
            ref={painel}
            className={`surface-card rolagem-fina min-h-[320px] min-w-0 scroll-mt-[var(--altura-topo-celular,0px)] rounded-[22px] lg:h-full lg:overflow-y-auto ${
              selected ? '' : 'hidden lg:block'
            }`}
          >
            {!selected ? (
              <p className="p-4 pt-20 text-center text-xs font-semibold text-slate-400">
                Escolha uma conversa para ver o histórico.
              </p>
            ) : (
              <>
                {/* Cabecalho travado no topo enquanto a conversa rola.
                    Numa conversa longa, o nome de quem esta falando e o aviso
                    de janela fechada sumiam na primeira rolada - e a pessoa
                    respondia sem saber a quem, ou escrevia um texto que nao ia
                    poder enviar. As margens negativas estendem o fundo branco
                    ate a borda do cartao, para nada aparecer por tras. */}
                <div
                  ref={cabecalho}
                  // top: no celular gruda logo abaixo da barra do app (ver
                  // --altura-topo-celular no Home); antes ficava por tras dela e
                  // o "Todas as conversas" sumia ao rolar (27/09/2026).
                  className="sticky top-[var(--altura-topo-celular,0px)] z-20 rounded-t-[22px] bg-white/95 px-4 pt-4 backdrop-blur lg:top-0"
                >
                {/* Só no celular: no computador a lista está do lado, e um
                    botão de voltar ali seria um passo inventado. */}
                <div className="mb-3 flex items-center justify-between gap-2 lg:hidden">
                  <button
                    type="button"
                    onClick={voltarParaALista}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#081b2c]/10 px-3 py-2 text-[10px] font-extrabold text-slate-500 transition hover:text-[#1f4f78]"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Todas as conversas
                  </button>
                  <button
                    type="button"
                    onClick={() => trocarVisual(true)}
                    title="Abre a conversa com a cara do WhatsApp, em tela cheia"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#e7f8ee] px-3 py-2 text-[10px] font-extrabold text-[#128c4a] transition hover:bg-[#d6f3e2]"
                  >
                    <MessageSquareText className="h-3.5 w-3.5" />
                    Visual WhatsApp
                  </button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#081b2c]/[0.07] pb-3">
                  <div>
                    <p className="text-sm font-extrabold text-[#081b2c]">{selected.patientName}</p>
                    <p className="text-[10px] font-bold text-slate-400">
                      {selected.phone} · {STATUS_LABEL[selected.status]}
                    </p>
                    {/* Com quem a equipe esta falando, em quatro numeros. Quem
                        ja veio cinco vezes e quem cancelou tres seguidas
                        merecem respostas diferentes, e isso so aparecia
                        garimpando outras telas. */}
                    {resumo && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold">
                        <span className="text-slate-500">
                          {resumo.contatos} {resumo.contatos === 1 ? 'contato' : 'contatos'}
                        </span>
                        <span className="text-[#1c6b3a]">
                          {resumo.realizadas}{' '}
                          {resumo.realizadas === 1 ? 'consulta feita' : 'consultas feitas'}
                        </span>
                        {resumo.agendadas > 0 && (
                          <span className="text-[#1d4ed8]">
                            {resumo.agendadas}{' '}
                            {resumo.agendadas === 1 ? 'agendada' : 'agendadas'}
                          </span>
                        )}
                        {resumo.cancelamentos > 0 && (
                          <span className="text-[#b42318]">
                            {resumo.cancelamentos}{' '}
                            {resumo.cancelamentos === 1 ? 'cancelamento' : 'cancelamentos'}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {selected.status === 'opted_out' ? (
                    <button
                      type="button"
                      onClick={() => void voltarAEnviar(selected)}
                      title="A pessoa pediu para não receber mensagens. Só a equipe pode desfazer."
                      className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-[10px] font-extrabold text-red-700 transition hover:bg-red-100"
                    >
                      <CircleSlash className="h-3.5 w-3.5" />
                      Voltar a enviar mensagens
                    </button>
                  ) : selected.status === 'resolved' ? (
                    <button
                      type="button"
                      onClick={() => void reabrir(selected.id)}
                      title="Volta a conversa para a lista de abertas"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#081b2c]/10 px-3 py-1.5 text-[10px] font-extrabold text-[#1f4f78] transition hover:bg-[#eff6fd]"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reabrir conversa
                    </button>
                  ) : (
                    // "Concluir", e nao "marcar como resolvida": e a mesma
                    // palavra da lista, onde a conversa vira uma linha com
                    // check verde. Duas palavras para o mesmo ato faziam a
                    // pessoa procurar dois estados onde so ha um. E a
                    // explicacao no title porque o efeito e visivel mas nao
                    // obvio: encolhe agora, volta sozinha se escreverem.
                    <button
                      type="button"
                      onClick={() => void resolve(selected.id)}
                      title="A conversa vira uma linha na lista. Se o paciente escrever de novo, ela volta sozinha."
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#eaf3ec] px-3 py-1.5 text-[10px] font-extrabold text-[#237128] transition hover:bg-[#dcebe0]"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Concluir conversa
                    </button>
                  )}
                </div>

                {/* O bloco inteiro continua no rodape, junto da caixa de
                    resposta que ele explica. Aqui em cima fica so o atalho:
                    quem abre a conversa para escrever descobre na hora que nao
                    vai poder, em vez de rolar a conversa inteira ate esbarrar
                    no aviso. */}
                {!janelaAberta && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-[#2f7fc1]/30 bg-[#f0f6fd] px-3.5 py-2.5">
                    <p className="text-[10px] font-extrabold text-[#16456b]">
                      Janela de resposta fechada. Só dá para enviar um convite.
                    </p>
                    <button
                      type="button"
                      disabled={reabrindo}
                      onClick={() => void reabrirConversa()}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-[#16456b] px-3 py-1.5 text-[10px] font-extrabold text-white transition hover:bg-[#10344f] disabled:cursor-wait disabled:opacity-50"
                    >
                      <MessageSquareText className="h-3.5 w-3.5" />
                      {reabrindo ? 'Enviando...' : 'Enviar convite'}
                    </button>
                  </div>
                )}
                {/* Respiro na base do bloco travado, para a primeira mensagem
                    nao encostar nele quando a conversa rola por baixo. */}
                <div className="h-3" />
                </div>

                <div className="px-4 pb-4">
                {loadingMessages ? (
                  <p className="pt-12 text-center text-xs font-semibold text-slate-400">
                    Carregando mensagens...
                  </p>
                ) : (
                  /* A conversa imita o WhatsApp de proposito: mesmo papel
                     bege, verde nosso a direita, branco do paciente a
                     esquerda, hora e confirmacao dentro do balao. Quem le esta
                     tela precisa saber na hora o que o paciente esta vendo do
                     outro lado, e o painel escuro do resto do sistema obrigava
                     a traduzir mentalmente a cada mensagem. */
                  <div className="relative rounded-[14px] bg-[#efeae2] px-3 py-4" style={FUNDO_WHATSAPP}>
                    {/* Conversas antigas tem dezenas de mensagens, e o que
                        interessa esta sempre no fim. Sem isto a equipe rolava a
                        roda ate cansar toda vez que abria uma conversa.

                        Os dois sentidos, e nao so um: a conversa abre no fim,
                        entao subir ate o comeco - para reler como tudo comecou,
                        ou achar o que o paciente pediu na primeira mensagem -
                        era o caminho que dava mais trabalho e nao tinha atalho. */}
                    {/* Grudados logo abaixo do cabecalho travado, e nao no
                        topo da tela: ali ficariam por tras dele. A medida vem
                        do ResizeObserver, entao acompanha o aviso de janela
                        aparecendo e sumindo. */}
                    {messages.length > 6 && (
                      <div
                        className="sticky z-10 mb-1 flex justify-end gap-1.5"
                        style={{ top: `calc(var(--altura-topo-celular, 0px) + ${alturaCabecalho + 4}px)` }}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            inicioDasMensagens.current?.scrollIntoView({
                              behavior: 'smooth',
                              block: 'start',
                            })
                          }
                          className="flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-[10px] font-extrabold text-[#557f75] shadow-[0_2px_6px_rgba(11,20,26,.18)] backdrop-blur transition hover:bg-white"
                        >
                          <ArrowUp className="h-3 w-3" />
                          Ir para o início
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            fimDasMensagens.current?.scrollIntoView({
                              behavior: 'smooth',
                              block: 'end',
                            })
                          }
                          className="flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-[10px] font-extrabold text-[#557f75] shadow-[0_2px_6px_rgba(11,20,26,.18)] backdrop-blur transition hover:bg-white"
                        >
                          <ArrowDown className="h-3 w-3" />
                          Ir para o fim
                        </button>
                      </div>
                    )}
                    <div className="space-y-2">
                      <div ref={inicioDasMensagens} />
                      {linhaDoTempo(messages, notas).map((entrada) => {
                        // Nota interna: amarela, centralizada e com cadeado,
                        // para nunca ser confundida com algo que a familia leu.
                        if (entrada.tipo === 'nota') {
                          const nota = entrada.item
                          return (
                            <div key={`nota-${nota.id}`} className="flex justify-center">
                              <div className="max-w-[85%] rounded-[8px] border border-[#e8c96a] bg-[#fff6d6] px-3 py-2 shadow-[0_1px_0.5px_rgba(11,20,26,.1)]">
                                <p className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wide text-[#8a6a10]">
                                  <Lock className="h-3 w-3" /> Nota interna
                                  {nota.autorNome ? ` · ${nota.autorNome}` : ''}
                                </p>
                                <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-[18px] text-[#3d3208]">
                                  {nota.texto}
                                </p>
                                <span className="mt-0.5 block text-right text-[10px] text-[#8a6a10]/80">
                                  {formatWhen(nota.criadoEm)} · a família não vê
                                </span>
                              </div>
                            </div>
                          )
                        }
                        const message = entrada.item
                        const outbound = message.direction === 'outbound'
                        return (
                          <div
                            key={message.id}
                            className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`relative max-w-[78%] rounded-[8px] px-2.5 py-1.5 shadow-[0_1px_0.5px_rgba(11,20,26,.13)] ${
                                outbound ? 'bg-[#d9fdd3]' : 'bg-white'
                              }`}
                            >
                              {message.anexoUrl && (
                                <Anexo
                                  url={message.anexoUrl}
                                  mime={message.anexoMime}
                                  caminho={message.anexoPath}
                                  onAbrir={setArquivoAberto}
                                />
                              )}
                              {/* Sem texto e com arquivo, a linha de "[image]"
                                  vira ruído embaixo da própria foto. */}
                              {(!message.anexoUrl || !/^\[/.test(message.body)) && (
                                <p className="whitespace-pre-wrap break-words text-[13.5px] leading-[19px] text-[#111b21]">
                                  {(message.body && comLinks(message.body)) ||
                                    (message.templateName
                                      ? `[modelo: ${message.templateName}]`
                                      : '[sem conteúdo]')}
                                </p>
                              )}
                              <span className="mt-0.5 flex items-center justify-end gap-1 text-[11px] leading-none text-[#667781]">
                                {formatWhen(message.createdAt)}
                                {outbound && <Confirmacao status={message.status} />}
                              </span>
                              {message.failureReason && (
                                <p className="mt-1 text-[11px] font-semibold text-[#b42318]">
                                  {message.failureReason}
                                </p>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    <div ref={fimDasMensagens} />
                  </div>
                )}

                {/* Caixa de resposta. A Meta so aceita texto livre por 24h
                    depois da ultima mensagem do paciente, entao o prazo fica a
                    vista e a caixa se desliga sozinha quando fecha - senao a
                    equipe digita, envia e a mensagem falha sem explicacao. */}
                <div className="mt-4 border-t border-[#081b2c]/[0.07] pt-3">
                  {/* Nota interna: funciona com a janela aberta ou fechada,
                      porque nao passa pela Meta. */}
                  <div className="mb-3">
                    {escrevendoNota ? (
                      <div className="rounded-[14px] border border-[#e8c96a] bg-[#fffaf0] p-3">
                        <p className="flex items-center gap-1.5 text-[10px] font-extrabold text-[#8a6a10]">
                          <Lock className="h-3.5 w-3.5" /> Nota interna · só a equipe vê, a família não recebe
                        </p>
                        <textarea
                          value={textoDaNota}
                          onChange={(e) => setTextoDaNota(e.target.value)}
                          rows={2}
                          maxLength={4000}
                          autoFocus
                          placeholder="Ex.: Liguei às 15h, não atendeu. / Dr. autorizou atender particular."
                          className="mt-2 w-full resize-y rounded-xl border border-[#e8c96a] bg-white p-2.5 text-[12px] outline-none focus:border-[#b8932a]"
                        />
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            disabled={salvandoNota || !textoDaNota.trim()}
                            onClick={() => void salvarNota()}
                            className="rounded-xl bg-[#8a6a10] px-3.5 py-2 text-[10px] font-extrabold text-white disabled:opacity-40"
                          >
                            {salvandoNota ? 'Salvando...' : 'Salvar nota'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEscrevendoNota(false)
                              setTextoDaNota('')
                            }}
                            className="rounded-xl border border-[#081b2c]/10 bg-white px-3.5 py-2 text-[10px] font-bold text-slate-500"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEscrevendoNota(true)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-[#e8c96a] bg-[#fffaf0] px-3 py-1.5 text-[10px] font-extrabold text-[#8a6a10] transition hover:bg-[#fff3d6]"
                        title="Recado para a equipe, dentro desta conversa. A família não recebe."
                      >
                        <Lock className="h-3.5 w-3.5" /> Nota interna
                      </button>
                    )}
                    {erroDasNotas && (
                      <p className="mt-1.5 text-[10px] font-bold text-[#b42318]">{erroDasNotas}</p>
                    )}
                  </div>
                  {janelaAberta ? (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[10px] font-bold text-[#557f75]">
                          Pode responder livremente até {formatWhen(janelaAte)}
                        </p>
                        <div className="flex items-center gap-2">
                          {/* Respostas prontas para a equipe (24/09/2026). As
                              mesmas que o robo usa, cadastradas em Configuracoes:
                              a recepcao escrevia de novo, a mao, os valores e
                              enderecos que o sistema ja sabia. Entra no campo
                              para revisar antes de enviar - nunca sai sozinha. */}
                          {prontas.length > 0 && (
                            <select
                              value=""
                              onChange={(e) => {
                                const escolhida = prontas.find((p) => p.id === e.target.value)
                                if (!escolhida) return
                                // A mesma troca do robo: {valores} vira a lista
                                // com o valor do cartao de cada unidade. O que
                                // nao der para preencher fica visivel, para a
                                // recepcao nao mandar "{valores}" para a mae.
                                let texto = escolhida.resposta
                                if (temCampo(texto)) {
                                  if (lugares) {
                                    const pronta = preencherCampos(texto, null, lugares)
                                    texto = pronta.texto
                                    if (pronta.faltando.length) {
                                      setError(`"${escolhida.assunto}" ficou sem: ${pronta.faltando.join(', ')}. Confira antes de enviar.`)
                                    }
                                  } else {
                                    setError('Não consegui ler os valores das unidades: a resposta entrou com os campos {…}. Troque-os antes de enviar.')
                                  }
                                }
                                setResposta((atual) => (atual.trim() ? `${atual.trimEnd()}\n\n${texto}` : texto))
                              }}
                              title="Coloca o texto de uma resposta pronta no campo, para revisar e enviar"
                              className="max-w-[200px] rounded-lg border border-[#081b2c]/10 bg-white px-2 py-1 text-[10px] font-bold text-slate-600 outline-none"
                            >
                              <option value="">Resposta pronta…</option>
                              {prontas.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.assunto}
                                </option>
                              ))}
                            </select>
                          )}
                          <p className="text-[10px] font-semibold text-slate-400">
                            {resposta.length}/4096
                          </p>
                        </div>
                      </div>
                      <textarea
                        value={resposta}
                        onChange={(e) => setResposta(e.target.value)}
                        onKeyDown={(e) => {
                          // Enter envia, Shift+Enter quebra linha.
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            void enviarResposta()
                          }
                        }}
                        rows={3}
                        maxLength={4096}
                        placeholder="Escreva sua resposta..."
                        className="mt-2 w-full resize-y rounded-[14px] border border-[#081b2c]/10 bg-white p-3 text-[12px] leading-relaxed outline-none focus:border-[#2f7fc1]"
                      />
                      {/* Arquivo escolhido: vai junto no Enviar, com o texto
                          acima como legenda. */}
                      {arquivo && (
                        <div className="mt-2 inline-flex max-w-full items-center gap-2 rounded-xl bg-[#eef5fd] px-3 py-1.5 text-[10px] font-bold text-[#16456b]">
                          <Paperclip className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{arquivo.name}</span>
                          <span className="shrink-0 text-[#16456b]/60">
                            {(arquivo.size / 1048576).toFixed(1).replace('.', ',')} MB
                          </span>
                          <button
                            type="button"
                            onClick={() => setArquivo(null)}
                            title="Tirar o arquivo"
                            className="shrink-0 rounded-full p-0.5 hover:bg-white"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                      <input
                        ref={seletorDeArquivo}
                        type="file"
                        accept="application/pdf,image/jpeg,image/png,.doc,.docx,.xls,.xlsx,.txt"
                        className="hidden"
                        onChange={(e) => {
                          setArquivo(e.target.files?.[0] ?? null)
                          e.target.value = ''
                        }}
                      />
                      {painelHorarios && lugares && lugares.length > 0 && (
                        <MandarHorarios
                          lugares={lugares}
                          enviando={enviando}
                          erro={erroHorarios}
                          pacientes={irmaos}
                          onEnviar={(pedido) => void enviarHorarios(pedido)}
                          onFechar={() => {
                            setPainelHorarios(false)
                            setErroHorarios('')
                            setIrmaos(null)
                          }}
                        />
                      )}
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[9px] font-semibold text-slate-400">
                          Enter envia · Shift+Enter quebra linha
                        </p>
                        {/* Devolve a pessoa ao robo: manda o menu de opcoes e a
                            conversa volta ao inicio. Util depois de um convite
                            de retomada, quando a janela reabriu e a equipe nao
                            quer conduzir a conversa a mao. */}
                        <button
                          type="button"
                          disabled={enviando}
                          onClick={() => void enviarMenu()}
                          className="mr-auto inline-flex items-center gap-1.5 rounded-xl border border-[#081b2c]/10 bg-white px-3 py-2 text-[10px] font-extrabold text-slate-600 transition hover:border-[#081b2c]/25 hover:text-[#081b2c] disabled:opacity-40"
                          title="Envia o menu de opções do robô e volta a conversa ao atendimento automático"
                        >
                          <ListIcon className="h-3.5 w-3.5" />
                          Enviar menu de opções
                        </button>
                        {/* Mandar horarios (14/10/2026): no lugar de digitar a
                            lista de horarios e marcar depois na Agenda. */}
                        {lugares && lugares.length > 0 && (
                          <button
                            type="button"
                            disabled={enviando}
                            onClick={() => setPainelHorarios((aberto) => !aberto)}
                            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[10px] font-extrabold transition disabled:opacity-40 ${
                              painelHorarios
                                ? 'border-[#2f7fc1]/40 bg-[#f1f7fd] text-[#1f4f78]'
                                : 'border-[#081b2c]/10 bg-white text-slate-600 hover:border-[#081b2c]/25 hover:text-[#081b2c]'
                            }`}
                            title="Manda a lista de dias e horários livres; a família toca e o robô marca a consulta"
                          >
                            <CalendarClock className="h-3.5 w-3.5" />
                            Mandar horários
                          </button>
                        )}
                        {/* O cadastro que ficou pela metade.
                            Quem marca e toca em "Voltar ao menu" no meio das
                            perguntas fica com consulta e ficha vazia, e a
                            clínica só descobre na véspera. Este botão manda as
                            perguntas de novo, na conversa que já existe, em vez
                            de alguém ligar atrás do CPF. */}
                        <button
                          type="button"
                          disabled={enviando}
                          onClick={() => void enviarQuestionario()}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-[#081b2c]/10 bg-white px-3 py-2 text-[10px] font-extrabold text-slate-600 transition hover:border-[#081b2c]/25 hover:text-[#081b2c] disabled:opacity-40"
                          title="Refaz as perguntas do cadastro (nome, nascimento, responsável, CPF e e-mail) para a próxima consulta desta pessoa"
                        >
                          <ClipboardList className="h-3.5 w-3.5" />
                          Questionário
                        </button>
                        <button
                          type="button"
                          disabled={enviando}
                          onClick={() => seletorDeArquivo.current?.click()}
                          title="Anexar receita, pedido de exame, recibo ou foto (PDF, JPG, PNG, Word, Excel)"
                          className="inline-flex items-center gap-1.5 rounded-xl border border-[#081b2c]/10 bg-white px-3 py-2 text-[10px] font-extrabold text-slate-600 transition hover:border-[#081b2c]/25 hover:text-[#081b2c] disabled:opacity-40"
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                          Arquivo
                        </button>
                        <button
                          type="button"
                          disabled={enviando || (!resposta.trim() && !arquivo)}
                          onClick={() => void enviarResposta()}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-[#081b2c] px-4 py-2 text-[10px] font-extrabold text-white transition hover:bg-[#102d47] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Send className="h-3.5 w-3.5" />
                          {enviando ? 'Enviando...' : 'Enviar'}
                        </button>
                      </div>
                    </>
                  ) : (
                    /* Antes daqui saia so o aviso, e a equipe ficava sem saida
                       dentro do proprio sistema: lia "e preciso um modelo
                       aprovado" e nao tinha por onde enviar um. O botao manda o
                       modelo de utilidade que reabre a conversa - ele nao
                       resolve o assunto, abre a porta para resolver. */
                    <div className="rounded-[14px] border border-[#2f7fc1]/30 bg-[#f0f6fd] px-4 py-3">
                      <p className="text-[11px] font-extrabold text-[#16456b]">
                        {janelaAte
                          ? `A janela de resposta fechou em ${formatWhen(janelaAte)}`
                          : 'Este contato ainda não escreveu para a clínica'}
                      </p>
                      <p className="mt-1 text-[10px] font-semibold text-[#16456b]/80">
                        A Meta só permite texto livre nas 24 horas seguintes à mensagem do paciente.
                        Fora delas você tem dois caminhos: responder agora dentro de um modelo
                        aprovado, ou convidar a família a escrever para a conversa reabrir.
                      </p>
                      {/* Perguntado em 23/09/2026: "por que o menu do robo nao
                          fica disponivel?". O menu tem botoes, e mensagem com
                          botao a Meta so aceita com a janela aberta. Dizer aqui
                          evita a equipe achar que o botao sumiu por defeito. */}
                      <p className="mt-1 text-[10px] font-semibold text-[#16456b]/80">
                        O menu do robô só pode ser enviado com a janela aberta. Quando a família
                        responder o convite, a janela reabre e o botão "Enviar menu de opções" volta.
                      </p>

                      {/* Caminho 1: a resposta sai agora, dentro do modelo. */}
                      <textarea
                        value={resposta}
                        onChange={(evento) => setResposta(evento.target.value)}
                        rows={3}
                        maxLength={700}
                        placeholder={`Escreva a resposta. Ela chega precedida de 'Olá, [nome]. Aqui é ${marcaSemClinicaConhecida(clinicId).consultorioNaResposta}.'`}
                        className="mt-3 w-full resize-y rounded-xl border border-[#2f7fc1]/25 bg-white px-3 py-2.5 text-[11px] font-semibold leading-relaxed text-[#081b2c] outline-none transition placeholder:font-medium placeholder:text-slate-300 focus:border-[#2f7fc1] focus:ring-4 focus:ring-[#2f7fc1]/10"
                      />
                      <p className="mt-1 text-[9px] font-bold text-[#16456b]/60">
                        Sem quebras de linha: a Meta recusa modelo com parágrafos. {resposta.length}/700
                      </p>

                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={enviandoModelo || reabrindo || !resposta.trim()}
                          onClick={() => void responderPorModelo()}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-[#081b2c] px-4 py-2 text-[10px] font-extrabold text-white transition hover:bg-[#102d47] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Send className="h-3.5 w-3.5" />
                          {enviandoModelo ? 'Enviando...' : 'Enviar mensagem agora'}
                        </button>
                        {/* Caminho 2: o convite de sempre, para quando o assunto
                            for longo demais para caber num modelo. */}
                        <button
                          type="button"
                          disabled={reabrindo || enviandoModelo}
                          onClick={() => void reabrirConversa()}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-[#16456b]/30 bg-white px-4 py-2 text-[10px] font-extrabold text-[#16456b] transition hover:bg-[#e7f0fa] disabled:cursor-wait disabled:opacity-50"
                        >
                          <MessageSquareText className="h-3.5 w-3.5" />
                          {reabrindo ? 'Enviando...' : 'Só convidar a responder'}
                        </button>
                      </div>
                      {avisoRetomada && (
                        <p className="mt-2 text-[10px] font-bold text-[#b42318]">{avisoRetomada}</p>
                      )}
                    </div>
                  )}
                </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {/* Portal no body, como o VisualizadorDeArquivo: a tela de Respostas
          fica dentro do .animate-enter, e o transform da animacao vira o
          "chao" de todo position:fixed la dentro. Sem o portal, a tela cheia
          nascia do tamanho da secao, com a pagina travada por baixo - foi o
          "entra bugado e fica travado" de 27/09/2026. */}
      {modoListaWhats && createPortal(
        // z-[35]: cobre a barra escura de cima (z-30) mas fica ABAIXO do menu
        // de baixo do sistema (z-40, Home). Pedido do Edu (02/10/2026): no modo
        // WhatsApp o menu da clinica continua embaixo, como as abas do proprio
        // WhatsApp - sem ele a lista virava um beco sem saida, so com o "Chat
        // normal" para sair. Ja a conversa aberta (z-[60]) cobre tudo.
        <div className="fixed inset-0 z-[35] flex flex-col bg-white lg:hidden" role="dialog" aria-label="Conversas">
          {/* Topo: titulo e a volta para o chat da clinica. */}
          <div
            className="flex items-center justify-between gap-2 border-b border-[#e9edef] bg-white px-4 pb-2"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
          >
            <h2 className="text-[22px] font-bold text-[#111b21]">Conversas</h2>
            <button
              type="button"
              onClick={() => trocarVisual(false)}
              className="flex items-center gap-1.5 rounded-full bg-[#081b2c] px-3 py-2 text-[11px] font-extrabold text-white active:bg-[#102d47]"
            >
              <ListIcon className="h-3.5 w-3.5" />
              Chat normal
            </button>
          </div>

          <div className="px-3 pt-2">
            <label className="flex items-center gap-2 rounded-full bg-[#f0f2f5] px-3 py-2">
              <Search className="h-4 w-4 text-[#8696a0]" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Pesquisar paciente ou telefone"
                className="w-full bg-transparent text-[14px] text-[#111b21] outline-none placeholder:text-[#8696a0]"
              />
            </label>
            <div className="flex gap-2 py-2">
              {(
                [
                  ['todas', 'Todas'],
                  ['atencao', `Esperando${attention.length ? ` ${attention.length}` : ''}`],
                  ['novas', 'Não lidas'],
                ] as [Recorte, string][]
              ).map(([valor, rotulo]) => (
                <button
                  key={valor}
                  type="button"
                  onClick={() => setRecorte(valor)}
                  className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${
                    recorte === valor ? 'bg-[#d9fdd3] text-[#008069]' : 'bg-[#f0f2f5] text-[#54656f]'
                  }`}
                >
                  {rotulo}
                </button>
              ))}
            </div>
          </div>

          {/* Folga embaixo do tamanho do menu flutuante, para a ultima
              conversa nao ficar escondida atras dele. */}
          <div
            className="flex-1 overflow-y-auto overscroll-contain"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}
          >
            {visiveis.length === 0 && (
              <p className="px-6 py-10 text-center text-[13px] text-[#667781]">Nenhuma conversa aqui.</p>
            )}
            {visiveis.map((conversa) => {
              const nome = conversa.patientId
                ? conversa.patientName
                : conversa.profileName || conversa.phone || 'Contato sem cadastro'
              const motivo = conversa.needsAttention && conversa.attentionReason ? MOTIVO_ATENCAO[conversa.attentionReason] : null
              const quando = conversa.lastMessageAt ? new Date(conversa.lastMessageAt) : null
              const hoje = diaLocal(new Date().toISOString())
              const ontem = diaLocal(new Date(Date.now() - 86400000).toISOString())
              const rotuloQuando = !quando
                ? ''
                : diaLocal(quando.toISOString()) === hoje
                  ? horaLocal(quando.toISOString())
                  : diaLocal(quando.toISOString()) === ontem
                    ? 'ontem'
                    : quando.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
              return (
                <button
                  key={conversa.id}
                  type="button"
                  onClick={() => void openConversation(conversa)}
                  className="flex w-full items-center gap-3 bg-white px-3 text-left active:bg-[#f5f6f6]"
                >
                  <span
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white"
                    style={{ background: corDoAvatar(nome) }}
                  >
                    {iniciais(nome)}
                  </span>
                  <span className="min-w-0 flex-1 border-b border-[#f0f2f5] py-3">
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[15px] font-semibold text-[#111b21]">{nome}</span>
                        {motivo && (
                          <span className="shrink-0 rounded-md bg-[#fdecea] px-1.5 py-0.5 text-[9px] font-extrabold text-[#c0392b]">
                            {motivo.rotulo}
                          </span>
                        )}
                      </span>
                      <span
                        className={`shrink-0 text-[11px] ${conversa.unreadCount > 0 ? 'font-bold text-[#1daa61]' : 'text-[#667781]'}`}
                      >
                        {rotuloQuando}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] text-[#667781]">
                        {(conversa.lastMessage || 'Sem mensagens').replace(/\s+/g, ' ')}
                      </span>
                      {conversa.unreadCount > 0 && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#1daa61] px-1.5 text-[11px] font-bold text-white">
                          {conversa.unreadCount}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>,
        document.body,
      )}

      {modoWhatsApp && selected && createPortal(
        <div className="fixed inset-0 z-[60] flex flex-col bg-[#efeae2] lg:hidden" role="dialog" aria-label={`Conversa com ${selected.patientName}`}>
          {/* Barra de cima: voltar, foto, nome e acoes - a do WhatsApp. */}
          <div
            className="flex items-center gap-2 bg-white px-2 pb-2 text-[#111b21] shadow-[0_1px_2px_rgba(11,20,26,.12)]"
            style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
          >
            <button
              type="button"
              onClick={voltarParaALista}
              aria-label="Voltar para as conversas"
              className="rounded-full p-2 text-[#54656f] active:bg-black/5"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white"
              style={{ background: corDoAvatar(selected.patientName) }}
              aria-hidden="true"
            >
              {iniciais(selected.patientName)}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[16px] font-semibold">{selected.patientName}</p>
              <p className="truncate text-[12.5px] text-[#667781]">
                {selected.phone} · {STATUS_LABEL[selected.status]}
              </p>
            </div>
            {selected.status === 'resolved' ? (
              <button
                type="button"
                onClick={() => void reabrir(selected.id)}
                aria-label="Reabrir conversa"
                title="Reabrir conversa"
                className="rounded-full p-2 text-[#54656f] active:bg-black/5"
              >
                <RotateCcw className="h-5 w-5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void resolve(selected.id)}
                aria-label="Concluir conversa"
                title="Concluir conversa"
                className="rounded-full p-2 text-[#54656f] active:bg-black/5"
              >
                <Check className="h-5 w-5" />
              </button>
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuWhats((aberto) => !aberto)}
                aria-label="Mais opções"
                aria-expanded={menuWhats}
                className="rounded-full p-2 text-[#54656f] active:bg-black/5"
              >
                <MoreVertical className="h-5 w-5" />
              </button>
              {menuWhats && (
                <div className="absolute right-0 top-11 z-10 w-60 overflow-hidden rounded-[10px] bg-white py-1.5 text-[14.5px] text-[#111b21] shadow-[0_6px_24px_rgba(11,20,26,.25)]">
                  {janelaAberta && (
                    <>
                      <button type="button" disabled={enviando} onClick={() => { setMenuWhats(false); void enviarMenu() }} className="block w-full px-4 py-2.5 text-left active:bg-black/5 disabled:opacity-40">
                        Enviar menu de opções
                      </button>
                      <button type="button" disabled={enviando} onClick={() => { setMenuWhats(false); void enviarQuestionario() }} className="block w-full px-4 py-2.5 text-left active:bg-black/5 disabled:opacity-40">
                        Enviar questionário
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      // A nota interna tem campo proprio e aviso de que a
                      // familia nao recebe: fica no visual padrao, que ja
                      // mostra tudo isso, em vez de virar um balao parecido
                      // com mensagem de verdade.
                      trocarVisual(false)
                      setEscrevendoNota(true)
                    }}
                    className="block w-full px-4 py-2.5 text-left active:bg-black/5"
                  >
                    Escrever nota interna
                  </button>
                  <button type="button" onClick={() => trocarVisual(false)} className="block w-full px-4 py-2.5 text-left active:bg-black/5">
                    Voltar ao visual padrão
                  </button>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2 bg-[#fdecea] px-4 py-2 text-[12.5px] font-semibold text-[#b42318]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{error}</span>
              <button type="button" onClick={() => setError('')} aria-label="Fechar aviso" className="shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Conversa: papel de parede, separador de dia e baloes com
              "rabinho" na primeira mensagem de cada sequencia. */}
          <div
            ref={rolagemWhats}
            onScroll={(e) => {
              const caixa = e.currentTarget
              grudadoNoFim.current = caixa.scrollHeight - caixa.scrollTop - caixa.clientHeight < 80
            }}
            className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
            style={FUNDO_WHATSAPP}
            onClick={() => menuWhats && setMenuWhats(false)}
          >
            {loadingMessages ? (
              <p className="mx-auto mt-10 w-fit rounded-[8px] bg-white/90 px-3 py-1.5 text-[12.5px] text-[#54656f]">
                Carregando mensagens...
              </p>
            ) : (
              <div ref={conteudoWhats} className="flex flex-col gap-[3px] pb-2">
                {linhaDoTempo(messages, notas).map((entrada, indice, todas) => {
                  const quando = entrada.tipo === 'nota' ? entrada.item.criadoEm : entrada.item.createdAt
                  const anterior = indice > 0 ? todas[indice - 1] : null
                  const quandoAnterior = anterior
                    ? anterior.tipo === 'nota'
                      ? anterior.item.criadoEm
                      : anterior.item.createdAt
                    : null
                  const novoDia = !quandoAnterior || diaLocal(quandoAnterior) !== diaLocal(quando)
                  const separador = novoDia ? (
                    <div key={`dia-${indice}`} className="my-2 flex justify-center">
                      <span className="rounded-[8px] bg-white px-3 py-1 text-[12.5px] font-medium text-[#54656f] shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">
                        {rotuloDoDia(quando)}
                      </span>
                    </div>
                  ) : null

                  if (entrada.tipo === 'nota') {
                    const nota = entrada.item
                    return [
                      separador,
                      <div key={`nota-${nota.id}`} className="my-1 flex justify-center">
                        <div className="max-w-[85%] rounded-[8px] border border-[#e8c96a] bg-[#fff6d6] px-3 py-1.5 text-center shadow-[0_1px_0.5px_rgba(11,20,26,.1)]">
                          <p className="flex items-center justify-center gap-1 text-[11px] font-bold uppercase tracking-wide text-[#8a6a10]">
                            <Lock className="h-3 w-3" /> Nota interna{nota.autorNome ? ` · ${nota.autorNome}` : ''}
                          </p>
                          <p className="mt-0.5 whitespace-pre-wrap break-words text-[13.5px] text-[#3d3208]">{nota.texto}</p>
                        </div>
                      </div>,
                    ]
                  }

                  const message = entrada.item
                  const outbound = message.direction === 'outbound'
                  const mesmoLadoAntes =
                    !novoDia &&
                    anterior?.tipo === 'mensagem' &&
                    (anterior.item.direction === 'outbound') === outbound
                  const comRabinho = !mesmoLadoAntes
                  return [
                    separador,
                    <div
                      key={message.id}
                      className={`flex ${outbound ? 'justify-end' : 'justify-start'} ${comRabinho ? 'mt-1.5' : ''}`}
                    >
                      <div
                        className={`relative max-w-[82%] rounded-[7.5px] px-[9px] pb-[6px] pt-[6px] shadow-[0_1px_0.5px_rgba(11,20,26,.13)] ${
                          outbound ? 'bg-[#d9fdd3]' : 'bg-white'
                        } ${comRabinho ? (outbound ? 'rounded-tr-none' : 'rounded-tl-none') : ''}`}
                      >
                        {comRabinho && (
                          <svg
                            viewBox="0 0 8 13"
                            width="8"
                            height="13"
                            aria-hidden="true"
                            className={`absolute top-0 ${outbound ? '-right-2' : '-left-2'}`}
                          >
                            <path
                              fill={outbound ? '#d9fdd3' : '#ffffff'}
                              d={outbound ? 'M5.188 0H0v11.193l6.467-8.625C7.526 1.156 6.958 0 5.188 0z' : 'M2.812 0H8v11.193L1.533 2.568C.474 1.156 1.042 0 2.812 0z'}
                            />
                          </svg>
                        )}
                        {message.anexoUrl && (
                          <Anexo url={message.anexoUrl} mime={message.anexoMime} caminho={message.anexoPath} onAbrir={setArquivoAberto} />
                        )}
                        {(!message.anexoUrl || !/^\[/.test(message.body)) && (
                          <p className="whitespace-pre-wrap break-words pr-[58px] text-[14.2px] leading-[19px] text-[#111b21]">
                            {(message.body && comLinks(message.body)) ||
                              (message.templateName ? `[modelo: ${message.templateName}]` : '[sem conteúdo]')}
                          </p>
                        )}
                        <span className="absolute bottom-[5px] right-[8px] flex items-center gap-[3px] text-[11px] leading-none text-[#667781]">
                          {horaLocal(message.createdAt)}
                          {outbound && <Confirmacao status={message.status} />}
                        </span>
                        {message.failureReason && (
                          <p className="mt-1 pb-3 text-[11.5px] font-semibold text-[#b42318]">{message.failureReason}</p>
                        )}
                      </div>
                    </div>,
                  ]
                })}
              </div>
            )}
          </div>

          {/* Barra de digitar. Com a janela de 24h fechada, o texto vai
              dentro do modelo aprovado - a Meta nao aceita texto livre -, e o
              aviso de cima diz isso antes de a pessoa escrever. */}
          <div className="bg-transparent px-1.5 pt-1" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 6px)' }}>
            {!janelaAberta && (
              <div className="mx-1 mb-1.5 rounded-[10px] bg-white px-3 py-2 text-[12.5px] text-[#54656f] shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">
                <p>
                  Janela de 24h fechada: a mensagem sai dentro do modelo aprovado
                  (&quot;Olá, [nome]. Aqui é {marcaSemClinicaConhecida(clinicId).consultorioNaResposta}.&quot;), sem quebra de linha.
                </p>
                <button
                  type="button"
                  disabled={reabrindo || enviandoModelo}
                  onClick={() => void reabrirConversa()}
                  className="mt-1 font-semibold text-[#008069] disabled:opacity-50"
                >
                  {reabrindo ? 'Enviando convite...' : 'Só convidar a responder'}
                </button>
                {avisoRetomada && <p className="mt-1 font-semibold text-[#b42318]">{avisoRetomada}</p>}
              </div>
            )}
            {arquivo && janelaAberta && (
              <div className="mx-1 mb-1.5 flex items-center gap-2 rounded-[10px] bg-white px-3 py-2 text-[12.5px] text-[#111b21] shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">
                <Paperclip className="h-4 w-4 shrink-0 text-[#54656f]" />
                <span className="min-w-0 flex-1 truncate">{arquivo.name}</span>
                <button type="button" onClick={() => setArquivo(null)} aria-label="Tirar o arquivo" className="shrink-0 text-[#54656f]">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            <div className="flex items-end gap-1.5">
              <div className="flex min-h-[48px] min-w-0 flex-1 items-end rounded-[24px] bg-white px-2 shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">
                <textarea
                  id="resposta-whatsapp"
                  value={resposta}
                  onChange={(e) => {
                    const texto = e.target.value
                    setResposta(janelaAberta ? texto : texto.replace(/\s*\n+\s*/g, ' '))
                    // Cresce com o texto ate umas 5 linhas, como no app.
                    e.target.style.height = 'auto'
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
                  }}
                  rows={1}
                  maxLength={janelaAberta ? 4096 : 700}
                  placeholder="Mensagem"
                  className="max-h-[120px] min-w-0 flex-1 resize-none bg-transparent px-2 py-[13px] text-[16px] leading-[21px] text-[#111b21] outline-none placeholder:text-[#8696a0]"
                />
                {janelaAberta && (
                  <button
                    type="button"
                    disabled={enviando}
                    onClick={() => seletorDeArquivo.current?.click()}
                    aria-label="Anexar arquivo"
                    className="mb-[6px] rounded-full p-2 text-[#54656f] active:bg-black/5 disabled:opacity-40"
                  >
                    <Paperclip className="h-5 w-5 -rotate-45" />
                  </button>
                )}
              </div>
              <button
                type="button"
                disabled={
                  janelaAberta
                    ? enviando || (!resposta.trim() && !arquivo)
                    : enviandoModelo || reabrindo || !resposta.trim()
                }
                onClick={() => void (janelaAberta ? enviarResposta() : responderPorModelo())}
                aria-label="Enviar"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#1daa61] text-white shadow-[0_1px_2px_rgba(11,20,26,.2)] transition active:bg-[#178a4f] disabled:bg-[#1daa61]/60"
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      <VisualizadorDeArquivo arquivo={arquivoAberto} onFechar={fecharArquivo} />
    </div>
  )
}
