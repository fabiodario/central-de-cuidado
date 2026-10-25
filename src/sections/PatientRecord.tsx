import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import { Ajuda } from '@/components/Ajuda'
import { invokeWithFormData } from '@/lib/supabase'
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  BookmarkPlus,
  Bold,
  CalendarPlus,
  Undo2,
  Building2,
  CalendarDays,
  Check,
  ClipboardList,
  Edit3,
  FileHeart,
  FileText,
  HeartPulse,
  Italic,
  List,
  ListOrdered,
  Loader2,
  MessageCircle,
  Mic,
  MicOff,
  FlaskConical,
  Pill,
  Plus,
  ShieldAlert,
  Printer,
  RefreshCw,
  Ruler,
  Scale,
  Search,
  ShieldCheck,
  Stethoscope,
  Underline,
  UserRound,
  Video,
  X,
} from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { fmtBR, idade, todayISO } from '@/lib/followup'
import { acrescentarReceitas, dataDaReceita } from '@/lib/receita-no-texto'
// O build inlina a imagem como data: URL, e e isso que faz o logo aparecer na
// janela de impressao (about:blank, sem acesso a arquivos do site).
import { marcaSemClinicaConhecida } from '@/lib/marca'
import {
  categoriaDaReceita,
  ORDEM_DAS_CATEGORIAS,
  type CategoriaDaReceita,
} from '@/lib/categoria-da-receita'

/**
 * Cor e icone de cada categoria de documento da Memed (23/09/2026). Classes
 * completas, e nao montadas por concatenacao: o Tailwind so gera o que le
 * escrito por inteiro no codigo.
 */
const ESTILO_DA_CATEGORIA: Record<
  CategoriaDaReceita,
  { titulo: string; icone: typeof Pill; cartao: string; texto: string }
> = {
  especial: {
    titulo: 'Receita especial',
    icone: ShieldAlert,
    cartao: 'border-[#b42318]/25 bg-[#fef5f4]',
    texto: 'text-[#b42318]',
  },
  medicacao: {
    titulo: 'Medicação',
    icone: Pill,
    cartao: 'border-[#2563eb]/20 bg-[#f7f9fe]',
    texto: 'text-[#1d4ed8]',
  },
  exame: {
    titulo: 'Exames',
    icone: FlaskConical,
    cartao: 'border-[#7c3aed]/20 bg-[#f9f7fe]',
    texto: 'text-[#6d28d9]',
  },
  documento: {
    titulo: 'Atestados e documentos',
    icone: FileText,
    cartao: 'border-[#3fa88a]/30 bg-[#f4faf8]',
    texto: 'text-[#23755f]',
  },
}
import {
  archiveNoteTemplate,
  concluirAssinatura,
  conferirIntegridade,
  listPrescriptions,
  iniciarAssinatura,
  linkDoAtendimentoAssinado,
  createNoteTemplate,
  getCurrentMembership,
  listNoteTemplates,
  type Integridade,
  type NoteTemplate,
  type Receita,
  listUnits,
  getDadosDaClinica,
} from '@/lib/repository'
import { apagarParametrosDoEndereco, parametrosDoEndereco } from '@/lib/endereco'
import { telefoneValidavel } from '@/lib/telefone'
import type {
  Consultation,
  ConsultationDraft,
  ConsultationType,
  Patient,
} from '@/types/patient'
import { opcoesDeUnidade, useUnidades } from '@/lib/unidades'
import { abrirPrescricao, alergiasParaMemed, faltaParaPrescrever, guardarReceita, marcarReceitaExcluida, prepararPrescricao, ultimoCadastro, type LocalDeAtendimento } from '@/lib/memed'
import { avisoDoQueFoiParaMemed, dadosParaMemed, hojeEmSaoPaulo } from '@/lib/dados-para-memed'
import {
  aplicarHeranca,
  desfazerHeranca,
  herancaDasAnteriores,
  ROTULO_DO_CAMPO,
  type Heranca,
} from '@/lib/continuidade-da-consulta'
import {
  alvoDoRascunho,
  apagarRascunho,
  lerRascunho,
  listarAdendos,
  salvarRascunho,
  type Adendo,
  type Rascunho,
} from '@/lib/prontuario-extra'
import { CurvaDeCrescimento } from '@/sections/prontuario/CurvaDeCrescimento'
import { mostraCurvaDeCrescimento } from '@/lib/crescimento/curvas'
import { publicoDaClinica } from '@/lib/publico'
import { ExamesDoPaciente } from '@/sections/prontuario/ExamesDoPaciente'
import { MarcarRetorno } from '@/sections/prontuario/MarcarRetorno'
import { AdendosDaConsulta } from '@/sections/prontuario/AdendosDaConsulta'

interface PatientRecordProps {
  patient: Patient | null
  open: boolean
  startInConsultationForm?: boolean
  onOpenChange: (open: boolean) => void
  listConsultations: (patientId: string) => Promise<Consultation[]>
  addConsultation: (patientId: string, draft: ConsultationDraft) => Promise<void>
  updateConsultation: (patientId: string, consultationId: string, draft: ConsultationDraft) => Promise<void>
  onEditRegistration: (patient: Patient) => void
}

const consultationLabels: Record<ConsultationType, string> = {
  initial: 'Consulta inicial',
  return: 'Retorno',
  telemedicine: 'Telemedicina',
  other: 'Outro atendimento',
}

const inputClass =
  'mt-1.5 w-full rounded-[13px] border border-[#081b2c]/10 bg-[#fafaf8] px-3.5 py-2.5 text-xs font-semibold text-[#081b2c] outline-none transition placeholder:font-normal placeholder:text-slate-300 focus:border-[#2f7fc1] focus:bg-white focus:ring-4 focus:ring-[#2f7fc1]/10 disabled:cursor-not-allowed disabled:opacity-60'

/**
 * Formatos que o navegador pode usar para gravar. O Chrome prefere webm/opus,
 * o Safari so aceita mp4. Testamos em ordem e usamos o primeiro suportado.
 */
const FORMATOS_AUDIO = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']

function extensaoDoFormato(mime: string) {
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm'
}

/* ------------------------------------------------------------------ *
 * Áudio compartilhado por toda a tela
 *
 * O prontuario tem mais de dez campos de texto, e cada um e um componente
 * independente. Se cada um criasse o proprio AudioContext e a propria reserva
 * de microfone, o navegador estouraria o limite (o Chrome permite cerca de
 * seis contextos por pagina) depois de o medico ditar em alguns campos - e a
 * partir dali nenhum audio passaria mais, em campo nenhum, ate fechar o
 * navegador.
 *
 * Por isso o contexto e o microfone vivem aqui fora, um para a tela inteira.
 * ------------------------------------------------------------------ */

let contextoCompartilhado: AudioContext | null = null
let streamCompartilhado: MediaStream | null = null
let timerLiberacao: number | null = null

function obterContexto(): AudioContext {
  if (!contextoCompartilhado || contextoCompartilhado.state === 'closed') {
    contextoCompartilhado = new AudioContext()
  }
  return contextoCompartilhado
}

function faixaViva(stream: MediaStream | null) {
  const faixa = stream?.getAudioTracks()[0]
  return Boolean(faixa && faixa.readyState === 'live' && !faixa.muted)
}

async function obterMicrofone(): Promise<MediaStream> {
  if (timerLiberacao) {
    window.clearTimeout(timerLiberacao)
    timerLiberacao = null
  }
  if (faixaViva(streamCompartilhado)) return streamCompartilhado as MediaStream

  liberarMicrofone()
  streamCompartilhado = await navigator.mediaDevices.getUserMedia({
    // Melhora bastante a transcricao em sala de consultorio.
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })
  return streamCompartilhado
}

function liberarMicrofone() {
  if (timerLiberacao) {
    window.clearTimeout(timerLiberacao)
    timerLiberacao = null
  }
  streamCompartilhado?.getTracks().forEach((faixa) => faixa.stop())
  streamCompartilhado = null
}

/** Mantem o microfone por um tempo curto, para ditados seguidos nao repedirem. */
function agendarLiberacaoMicrofone() {
  if (timerLiberacao) window.clearTimeout(timerLiberacao)
  timerLiberacao = window.setTimeout(liberarMicrofone, 20000)
}

const editorColors = [
  { label: 'Escuro', value: '#081b2c' },
  { label: 'Vermelho', value: '#c02626' },
  { label: 'Azul', value: '#2563eb' },
  { label: 'Verde', value: '#557f75' },
  { label: 'Cinza', value: '#5b6b7a' },
]

const editorTags = new Set(['B', 'BR', 'DIV', 'EM', 'FONT', 'I', 'LI', 'OL', 'P', 'SPAN', 'STRONG', 'U', 'UL'])

/**
 * O campo que esta recebendo a digitacao no momento.
 *
 * Antes cada um dos treze campos carregava a propria barra de negrito, cores,
 * modelos e ditado. Eram treze copias do mesmo controle competindo com aquilo
 * que o medico esta escrevendo, e nenhuma delas ficava a vista quando ele
 * rolava a tela.
 *
 * Agora existe uma barra so, no topo, que age sobre o campo em foco. O preco
 * dessa troca e que a barra precisa saber em qual campo esta atuando - e por
 * isso ela mostra o nome dele. Sem esse aviso, aplicar negrito viraria aposta.
 */
type ControleDeCampo = {
  id: string
  rotulo: string
  campo?: string
  comando: (nome: string, valor?: string) => void
  gravando: boolean
  transcrevendo: boolean
  nivel: number
  alternarDitado: () => void
  modelos: NoteTemplate[]
  inserirModelo: (texto: string) => void
  salvarComoModelo: (titulo: string) => Promise<void>
  apagarModelo?: (id: string) => Promise<void>
  guardaModelos: boolean
}

const CampoAtivo = createContext<{
  ativo: ControleDeCampo | null
  ativar: (controle: ControleDeCampo | null) => void
}>({ ativo: null, ativar: () => {} })

function BotaoDaBarra({
  titulo,
  rotulo,
  onClick,
  ativo,
  desabilitado,
  children,
}: {
  titulo: string
  rotulo: string
  onClick: () => void
  ativo?: boolean
  desabilitado?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      // Sem isto o clique tira o foco do campo, a selecao se perde e o comando
      // nao tem em que se aplicar. Vale para todo botao desta barra.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={desabilitado}
      aria-label={rotulo}
      title={titulo}
      className={`rounded-md p-1.5 transition disabled:cursor-default disabled:opacity-30 ${
        ativo ? 'bg-[#081b2c] text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-[#081b2c]'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * A barra unica de formatacao, fixa no topo do formulario.
 */
/**
 * Tela larga (notebook ou monitor, a partir de 1024 px): a consulta abre em duas
 * colunas. Pelo JavaScript, e nao so pelo CSS, porque a barra de formatacao e os
 * avisos mudam de lugar - e dois exemplares de cada, um escondido, dariam dois
 * botoes "Recuperar rascunho" respondendo pelo mesmo estado.
 */
function useTelaLarga() {
  const consulta = '(min-width: 1024px)'
  const [larga, setLarga] = useState(() => typeof window !== 'undefined' && window.matchMedia(consulta).matches)
  useEffect(() => {
    const mq = window.matchMedia(consulta)
    const mudou = () => setLarga(mq.matches)
    mq.addEventListener('change', mudou)
    mudou()
    return () => mq.removeEventListener('change', mudou)
  }, [])
  return larga
}

/**
 * `lateral`: na coluna da esquerda da consulta em duas colunas. Ali a barra fica
 * parada enquanto o formulario rola, entao nao precisa grudar no topo.
 */
function BarraDeFormatacao({ lateral = false }: { lateral?: boolean }) {
  const { ativo } = useContext(CampoAtivo)
  const [painelModelos, setPainelModelos] = useState(false)
  const [novoModelo, setNovoModelo] = useState('')
  const [salvando, setSalvando] = useState(false)

  // Trocar de campo fecha o painel: os modelos sao por campo, e deixar aberto o
  // painel do campo anterior ofereceria o texto errado.
  useEffect(() => {
    setPainelModelos(false)
    setNovoModelo('')
  }, [ativo?.id])

  const parado = !ativo
  const modelos = ativo?.modelos ?? []

  async function salvar() {
    const titulo = novoModelo.trim()
    if (!titulo || !ativo) return
    setSalvando(true)
    try {
      await ativo.salvarComoModelo(titulo)
      setNovoModelo('')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div
      className={
        lateral
          ? 'rounded-[14px] border border-[#081b2c]/[0.08] bg-white px-3 py-2.5'
          : 'sticky top-0 z-20 -mx-5 mb-4 border-b border-[#081b2c]/[0.08] bg-white/95 px-5 py-2 backdrop-blur sm:-mx-7 sm:px-7'
      }
    >
      <div className="flex flex-wrap items-center gap-1">
        <BotaoDaBarra titulo="Negrito" rotulo="Negrito" desabilitado={parado} onClick={() => ativo?.comando('bold')}>
          <Bold className="h-3.5 w-3.5" />
        </BotaoDaBarra>
        <BotaoDaBarra titulo="Itálico" rotulo="Itálico" desabilitado={parado} onClick={() => ativo?.comando('italic')}>
          <Italic className="h-3.5 w-3.5" />
        </BotaoDaBarra>
        <BotaoDaBarra titulo="Sublinhado" rotulo="Sublinhado" desabilitado={parado} onClick={() => ativo?.comando('underline')}>
          <Underline className="h-3.5 w-3.5" />
        </BotaoDaBarra>
        <span className="mx-1 h-4 w-px bg-[#081b2c]/10" />
        <BotaoDaBarra titulo="Lista" rotulo="Lista" desabilitado={parado} onClick={() => ativo?.comando('insertUnorderedList')}>
          <List className="h-3.5 w-3.5" />
        </BotaoDaBarra>
        <BotaoDaBarra titulo="Lista numerada" rotulo="Lista numerada" desabilitado={parado} onClick={() => ativo?.comando('insertOrderedList')}>
          <ListOrdered className="h-3.5 w-3.5" />
        </BotaoDaBarra>
        <span className="mx-1 h-4 w-px bg-[#081b2c]/10" />
        {editorColors.map((cor) => (
          <button
            key={cor.value}
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => ativo?.comando('foreColor', cor.value)}
            disabled={parado}
            className="h-5 w-5 rounded-full border-2 border-white shadow-sm ring-1 ring-[#081b2c]/10 transition disabled:opacity-30"
            style={{ backgroundColor: cor.value }}
            aria-label={`Cor ${cor.label}`}
            title={`Cor ${cor.label}`}
          />
        ))}
        <span className="flex-1" />

        {ativo?.guardaModelos && (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setPainelModelos((aberto) => !aberto)}
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-extrabold transition ${
              painelModelos ? 'bg-[#081b2c] text-white' : 'bg-[#eef3f2] text-[#557f75] hover:bg-[#e2ece9]'
            }`}
            title="Textos prontos para reusar neste campo"
          >
            <BookmarkPlus className="h-3.5 w-3.5" />
            Modelos{modelos.length ? ` (${modelos.length})` : ''}
          </button>
        )}

        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => ativo?.alternarDitado()}
          disabled={parado || ativo?.transcrevendo}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-extrabold transition disabled:cursor-wait disabled:opacity-40 ${
            ativo?.gravando
              ? 'bg-red-50 text-red-600'
              : ativo?.transcrevendo
                ? 'bg-[#eef5fd] text-[#16456b]'
                : 'bg-[#eef3f2] text-[#557f75] hover:bg-[#e2ece9]'
          }`}
          title={ativo?.gravando ? 'Clique para parar e transcrever' : 'Gravar e transcrever'}
        >
          {ativo?.transcrevendo ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : ativo?.gravando ? (
            <MicOff className="h-3.5 w-3.5" />
          ) : (
            <Mic className="h-3.5 w-3.5" />
          )}
          {ativo?.transcrevendo ? 'Transcrevendo...' : ativo?.gravando ? 'Gravando' : 'Ditar'}
        </button>

        {ativo?.gravando && (
          <span
            className="flex items-center gap-0.5"
            title="Nível do som captado. Se as barras não se mexem quando você fala, o microfone não está captando."
          >
            {[0.15, 0.35, 0.55, 0.75, 0.95].map((limite) => (
              <span
                key={limite}
                className={`h-3 w-1 rounded-full transition-colors ${
                  ativo.nivel >= limite ? 'bg-red-500' : 'bg-slate-200'
                }`}
              />
            ))}
          </span>
        )}
      </div>

      {/* Em qual campo a barra esta agindo. E o que impede o negrito de cair no
          lugar errado quando o cursor esta num campo e o olho noutro. */}
      <p className={`mt-1 text-[10px] font-bold ${parado ? 'text-slate-400' : 'text-[#2a6ea8]'}`}>
        {parado ? 'Clique num campo para escrever e formatar' : `Formatando: ${ativo.rotulo}`}
      </p>

      {painelModelos && ativo?.guardaModelos && (
        <div className="mt-2 rounded-[13px] border border-[#081b2c]/[0.08] bg-[#fbfaf8] px-3 py-2.5">
          {modelos.length === 0 ? (
            <p className="text-[10px] font-semibold text-slate-400">
              Nenhum modelo salvo para {ativo.rotulo.toLowerCase()} ainda. Escreva o texto no campo e
              salve abaixo. Ele fica disponível para as próximas consultas.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {modelos.map((modelo) => (
                <span
                  key={modelo.id}
                  className="inline-flex items-center overflow-hidden rounded-lg border border-[#081b2c]/10 bg-white"
                >
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      ativo.inserirModelo(modelo.texto)
                      setPainelModelos(false)
                    }}
                    className="px-2.5 py-1.5 text-[10px] font-bold text-[#081b2c] transition hover:bg-[#eef3f2]"
                    title="Inserir no fim do texto"
                  >
                    {modelo.titulo}
                  </button>
                  {ativo.apagarModelo && (
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => void ativo.apagarModelo?.(modelo.id)}
                      className="border-l border-[#081b2c]/10 px-1.5 py-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                      aria-label={`Aposentar o modelo ${modelo.titulo}`}
                      title="Aposentar este modelo"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          {/* Criar o modelo a partir do que ja esta escrito, e nao numa tela
              separada de configuracao: o texto bom aparece durante a consulta,
              e e ali que ele precisa poder ser guardado. */}
          <div className="mt-2 flex items-center gap-1.5 border-t border-[#081b2c]/[0.07] pt-2">
            <input
              value={novoModelo}
              onChange={(event) => setNovoModelo(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void salvar()
                }
              }}
              maxLength={80}
              placeholder="Salvar o texto atual como modelo. Dê um nome..."
              className="min-w-0 flex-1 rounded-lg border border-[#081b2c]/10 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-[#081b2c] outline-none placeholder:text-slate-300 focus:border-[#2f7fc1]"
            />
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void salvar()}
              disabled={!novoModelo.trim() || salvando}
              className="shrink-0 rounded-lg bg-[#081b2c] px-3 py-1.5 text-[10px] font-extrabold text-white transition hover:bg-[#102d47] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            >
              {salvando ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function normalizeEditorColor(value: string) {
  const compact = value.replace(/\s/g, '').toLowerCase()
  return editorColors.find((option) => {
    const hex = option.value.toLowerCase()
    const red = Number.parseInt(hex.slice(1, 3), 16)
    const green = Number.parseInt(hex.slice(3, 5), 16)
    const blue = Number.parseInt(hex.slice(5, 7), 16)
    return compact === hex || compact === `rgb(${red},${green},${blue})`
  })?.value
}


function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character] ?? character)
}

function textToEditorHtml(value: string) {
  return escapeHtml(value).replace(/\n/g, '<br>')
}

function sanitizeRichText(value: string) {
  if (typeof window === 'undefined') return value

  const document = new DOMParser().parseFromString(value, 'text/html')
  for (const element of Array.from(document.body.querySelectorAll('*'))) {
    if (!editorTags.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes))
      continue
    }

    const color = (element instanceof HTMLElement ? element.style.color : '') || element.getAttribute('color') || ''
    for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name)

    const selectedColor = normalizeEditorColor(color)
    if (selectedColor && element.tagName === 'SPAN') {
      element.setAttribute('style', `color: ${selectedColor}`)
    }
    if (selectedColor && element.tagName === 'FONT') {
      element.setAttribute('color', selectedColor)
    }
  }

  return document.body.innerHTML
}

/** Converte "24,5" ou "24.5" em numero. Vazio ou invalido vira null. */
function numeroBR(valor: string): number | null {
  const limpo = valor.replace(',', '.').replace(/[^\d.]/g, '')
  if (!limpo) return null
  const numero = Number(limpo)
  return Number.isFinite(numero) && numero > 0 ? numero : null
}

/**
 * IMC a partir de peso em kg e altura em cm.
 *
 * Fica aqui e nao no banco porque e derivado: guardar o resultado criaria a
 * chance de peso e IMC discordarem depois de uma correcao no cadastro.
 */
function calcularIMC(peso: string, altura: string): number | null {
  const kg = numeroBR(peso)
  const cm = numeroBR(altura)
  if (!kg || !cm) return null
  const metros = cm / 100
  return kg / (metros * metros)
}

function formatarVariacao(atual: number | null, anterior: number | null) {
  if (atual === null || anterior === null) return null
  const diferenca = atual - anterior
  if (Math.abs(diferenca) < 0.05) return 'sem mudança'
  return `${diferenca > 0 ? '+' : ''}${diferenca.toFixed(1).replace('.', ',')}`
}

/**
 * Monta e abre a versao para impressao do prontuario.
 *
 * Usa uma janela separada de proposito: o prontuario vive dentro de um painel
 * com rolagem propria, e mandar imprimir a pagina como esta cortaria o
 * conteudo. Aqui o documento nasce ja no formato de papel.
 */
/**
 * Data e hora de um instante, no fuso da clinica.
 *
 * O banco guarda em UTC. Cortar os dez primeiros caracteres dava o dia de
 * Londres: uma assinatura as 22:40 de 06/09 saia impressa como 07/09.
 */
function dataHoraLocal(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso)).replace(',', ' às')
}

/** SHA-256 em hexadecimal, com a criptografia que o proprio navegador oferece. */
async function impressaoDigital(texto: string) {
  const bytes = new TextEncoder().encode(texto)
  const resumo = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(resumo)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function imprimirProntuario(
  patient: Patient,
  consultas: Consultation[],
  integridade: Integridade | null,
  /**
   * Chamar a impressao sozinho ou so mostrar.
   *
   * Ler o prontuario e mais frequente do que imprimir - conferir a consulta
   * anterior antes de atender, por exemplo. Com um botao so, toda leitura
   * passava pela caixa de impressao do navegador, que a pessoa fechava sem
   * imprimir nada. O documento e o mesmo nos dois casos.
   */
  imprimirDireto = true,
  /** Adendos dos atendimentos impressos: saem logo abaixo do atendimento. */
  adendos: Adendo[] = [],
  /** Clinica do prontuario, para o logo do cabecalho (ver lib/marca.ts). */
  clinicId: string | null = null,
) {
  const marcaImpressa = marcaSemClinicaConhecida(clinicId)
  const campos: [string, keyof Consultation][] = [
    ['Queixa principal', 'queixa'],
    ['História / evolução', 'historiaEvolucao'],
    ['Antecedentes pessoais', 'antecedentesPessoais'],
    ['Antecedentes familiares', 'antecedentesFamiliares'],
    ['Alergias', 'alergias'],
    ['Medicamentos em uso', 'medicamentos'],
    ['Exame físico', 'exameFisico'],
    ['Avaliação / hipótese diagnóstica', 'avaliacao'],
    ['Conduta', 'conduta'],
    ['Prescrição', 'prescricao'],
    ['Retorno', 'retorno'],
    ['Observações clínicas', 'observacoes'],
  ]

  const cabecalhoPaciente = [
    ['Paciente', patient.nome],
    ['Nascimento', patient.nascimento ? `${fmtBR(patient.nascimento)} (${idade(patient.nascimento)})` : ''],
    ['Responsável', patient.responsavel],
    ['Convênio', patient.convenio],
    // Onde o paciente MORA (cadastro). "Cidade: Santos · Campo Grande" era lido
    // como local do atendimento, que ja aparece em cada consulta (23/09/2026).
    ['Reside em', [patient.bairro, patient.cidade].filter(Boolean).join(', ')],
    ['Contato', patient.telefone],
  ]
    .filter(([, valor]) => valor)
    .map(([rotulo, valor]) => `<div><span class="r">${rotulo}</span><span class="v">${escapeHtml(String(valor))}</span></div>`)
    .join('')

  // Consulta sem nada escrito nao vai para o papel: imprimiria um titulo e uma
  // linha, ocupando espaco sem dizer nada a quem le.
  const consultasImpressas = consultas.filter((consulta) =>
    campos.some(([, chave]) => temTexto(String(consulta[chave] ?? ''))) ||
    consulta.peso ||
    consulta.altura ||
    consulta.cid,
  )

  // Quais das impressas estao assinadas. Quando TODAS estao, o rodape muda de
  // tom: deixa de avisar que nao substitui ICP-Brasil e passa a afirmar que o
  // documento e assinado - porque ai ele e.
  const assinadas = consultasImpressas.filter((consulta) => consulta.assinadoEm)

  const corpo = consultasImpressas
    .map((consulta) => {
      const imc = calcularIMC(consulta.peso, consulta.altura)
      const medidas = [
        consulta.peso ? `${consulta.peso} kg` : '',
        consulta.altura ? `${consulta.altura} cm` : '',
        imc !== null ? `IMC ${imc.toFixed(1).replace('.', ',')}` : '',
      ]
        .filter(Boolean)
        .join(' · ')

      const blocos = campos
        .filter(([, chave]) => temTexto(String(consulta[chave] ?? '')))
        .map(
          ([rotulo, chave]) =>
            `<div class="bloco${
              textoSimples(String(consulta[chave])).length > 500 ? ' longo' : ''
            }"><h3>${rotulo}</h3><div class="txt">${editorValue(String(consulta[chave]))}</div></div>`,
        )
        .join('')

      // O adendo sai colado no atendimento que corrige, com data e autor, e
      // nunca misturado ao texto original (25/09/2026).
      const adendosDoAtendimento = adendos
        .filter((adendo) => adendo.consultationId === consulta.id)
        .map(
          (adendo) =>
            `<div class="bloco"><h3>Adendo · ${dataHoraLocal(adendo.criadoEm)}${
              adendo.autorNome ? ` · ${escapeHtml(adendo.autorNome)}` : ''
            }</h3><div class="txt">${escapeHtml(adendo.texto).replace(/\n/g, '<br>')}</div></div>`,
        )
        .join('')

      return `<section class="consulta">
        <h2>${consultationLabels[consulta.tipo]} · ${fmtBR(consulta.data)}</h2>
        <p class="meta">${[consulta.unidade, medidas, consulta.cid ? `CID ${consulta.cid.toUpperCase()}` : '']
          .filter(Boolean)
          .join('  ·  ')}</p>
        ${blocos}
        ${adendosDoAtendimento}
      </section>`
    })
    .join('')

  // A impressao digital cobre exatamente o que esta escrito nesta folha. Quem
  // receber o papel amanha pode conferir se ele corresponde ao que o sistema
  // guarda - e nao apenas acreditar.
  const digital = await impressaoDigital(`${cabecalhoPaciente}||${corpo}`)
  const parVisivel = (v: string) => v.replace(/(.{8})/g, '$1 ').trim()

  // Linhas de codigo que provam que o papel corresponde ao registro. Sao as
  // mesmas nos dois desenhos abaixo; muda so o peso que recebem.
  const linhasDeIntegridade = `
      <div class="h">Impressão digital <code>${parVisivel(digital)}</code></div>
      ${
        integridade?.selo
          ? `<div class="h">Acervo <code>${parVisivel(integridade.selo.slice(0, 32))}…</code> · ${
              integridade.quebradoNoId
                ? `<b class="alerta">ADULTERAÇÃO DETECTADA no registro ${integridade.quebradoNoId}</b>`
                : `${integridade.encadeados} registros conferidos, íntegra`
            }</div>`
          : ''
      }`

  const quemAssinou = assinadas[0]?.assinadoPor ?? 'certificado do médico'
  const todasAssinadas = assinadas.length === consultasImpressas.length && consultasImpressas.length > 0

  // Chancela (proposta 2, escolhida em 06/09/2026): a assinatura em primeiro
  // plano - quem, quando, com que certificado - e os codigos em segundo. Quem
  // recebe o papel pergunta primeiro "quem assinou?"; o hash e para quem
  // quiser conferir depois. Sem assinatura, o bloco volta a ser neutro: nao
  // pode parecer carimbo o que nao e.
  const selo = assinadas.length > 0
    ? `
    <div class="carimbo">
      <div class="marca">✓</div>
      <div class="corpo">
        <p class="t">Documento assinado digitalmente${todasAssinadas ? '' : ' (em parte)'}</p>
        <p class="quem">${escapeHtml(quemAssinou)}</p>
        <p class="quando">${assinadas
          .map((c) => `Consulta de ${fmtBR(c.data)} · assinada em ${c.assinadoEm ? dataHoraLocal(c.assinadoEm) : 'sem data'}`)
          .join('<br>')} · certificado ICP-Brasil (VIDaaS)</p>
        ${linhasDeIntegridade}
        ${
          todasAssinadas
            ? ''
            : `<p class="aviso">As consultas não listadas acima ainda não foram assinadas digitalmente.</p>`
        }
      </div>
      <!-- Selo no espirito do que o validador do ITI mostra, mas sem a marca
           do ITI: o instituto valida a assinatura, nao emite este documento,
           e o logo dele aqui sugeriria o contrario. O que esta escrito e
           publico e verdadeiro: o tipo da assinatura e as normas. -->
      <div class="qualificada">
        <div class="q1">Assinatura eletrônica</div>
        <div class="q2">Qualificada</div>
        <div class="q3">ICP-Brasil · MP 2.200-2/01<br>e Lei 14.063/20</div>
        <div class="q4">Confira em validar.iti.gov.br</div>
      </div>
    </div>`
    : `
    <div class="selo">
      ${linhasDeIntegridade}
      <p class="aviso">A impressão digital comprova que este documento não foi alterado depois de emitido. Não substitui assinatura digital ICP-Brasil.</p>
    </div>`

  const documento = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Prontuário - ${escapeHtml(patient.nome)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: Georgia, 'Times New Roman', serif; color: #14202c; margin: 0; padding: 28px 32px; font-size: 12pt; line-height: 1.55; }
      /* Papel timbrado (23/09/2026): logo a esquerda, como em receituario, e
         o nome do documento a direita. O logo ja traz o nome do medico, entao
         o titulo em texto que repetia "Clinica Dr. Marcello Ruiz" saiu. */
      header { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; border-bottom: 2px solid #0b2a5b; padding-bottom: 10px; margin-bottom: 18px; }
      header img { height: 52px; width: auto; display: block; }
      header .doc { text-align: right; }
      header .doc .t { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 9pt; font-weight: bold; letter-spacing: .16em; text-transform: uppercase; color: #0b2a5b; }
      header .doc .s { margin: 2px 0 0; font-size: 9pt; color: #55606b; }
      /* Campo longo (prescricao com varias receitas, historia extensa) pode
         quebrar entre paginas. Com "nao quebra" ele pulava inteiro para a folha
         seguinte e a primeira saia com uma linha so (23/09/2026). */
      .bloco.longo { break-inside: auto; page-break-inside: auto; }
      .txt { orphans: 3; widows: 3; }
      .paciente { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-bottom: 22px; font-size: 11pt; }
      .paciente .r { display: inline-block; min-width: 105px; color: #55606b; }
      .paciente .v { font-weight: bold; }
      /* A consulta PODE quebrar entre paginas. Ate 05/09/2026 ela nao podia, e
         o resultado era pior do que o problema que a regra evitava: uma
         consulta com doze campos nunca cabia no espaco restante, entao o bloco
         inteiro pulava para a folha seguinte e a primeira saia quase em branco.
         Quem nao pode quebrar e o pedaco pequeno - cada campo - e o titulo, que
         nao pode ficar sozinho no rodape. */
      .consulta { border-top: 1px solid #d4d9de; padding-top: 14px; margin-top: 18px; }
      .consulta h2 { font-size: 13pt; margin: 0 0 2px; break-after: avoid; page-break-after: avoid; }
      .meta { margin: 0 0 12px; font-size: 10pt; color: #55606b; break-after: avoid; page-break-after: avoid; }
      .bloco { margin-bottom: 11px; page-break-inside: avoid; break-inside: avoid; }
      .bloco h3 { break-after: avoid; page-break-after: avoid; }
      .bloco h3 { font-size: 10pt; text-transform: uppercase; letter-spacing: .04em; color: #55606b; margin: 0 0 3px; font-weight: bold; }
      .txt ul, .txt ol { margin: 4px 0; padding-left: 20px; }
      footer { margin-top: 32px; border-top: 1px solid #d4d9de; padding-top: 10px; font-size: 9pt; color: #7b858e; }
      footer p { margin: 0 0 8px; }
      .selo { border: 1px solid #d4d9de; border-radius: 4px; padding: 8px 10px; font-size: 8pt; break-inside: avoid; page-break-inside: avoid; }
      .selo .aviso { margin: 6px 0 0; font-size: 7.5pt; font-style: italic; }
      .h { font-size: 7pt; color: #7b858e; margin: 0 0 2px; }
      .h code { font-family: 'Courier New', monospace; color: #55606b; letter-spacing: .02em; word-break: break-all; }
      .h .alerta { color: #b42318; }
      .carimbo { display: grid; grid-template-columns: auto 1fr auto; gap: 14px; align-items: center; border: 1.5px solid #1c6b3a; border-radius: 8px; padding: 12px 14px; font-size: 8pt; break-inside: avoid; page-break-inside: avoid; color: #14202c; }
      .carimbo .marca { width: 46px; height: 46px; border-radius: 50%; border: 1.5px solid #1c6b3a; display: flex; align-items: center; justify-content: center; color: #1c6b3a; font-size: 22px; }
      .carimbo .t { font-family: Arial, Helvetica, sans-serif; font-size: 8pt; letter-spacing: .14em; text-transform: uppercase; color: #1c6b3a; font-weight: bold; margin: 0 0 2px; }
      .carimbo .quem { font-size: 12pt; margin: 0; }
      .carimbo .quando { font-size: 9pt; color: #55606b; margin: 2px 0 6px; }
      .carimbo .aviso { margin: 6px 0 0; font-size: 7.5pt; font-style: italic; color: #7b858e; }
      .qualificada { width: 128px; border-radius: 8px; overflow: hidden; background: #0b1f3a; color: #fff; text-align: center; font-family: Arial, Helvetica, sans-serif; padding: 8px 6px 0; align-self: center; }
      .qualificada .q1 { font-size: 6.5pt; letter-spacing: .06em; text-transform: uppercase; }
      .qualificada .q2 { font-size: 8pt; font-weight: bold; letter-spacing: .08em; text-transform: uppercase; color: #5cc8ff; margin: 1px 0 5px; }
      .qualificada .q3 { font-size: 5.5pt; line-height: 1.35; color: rgba(255,255,255,.85); padding-bottom: 6px; }
      .qualificada .q4 { background: #1a9be0; font-size: 5.6pt; font-weight: bold; letter-spacing: .04em; padding: 4px 2px; }
      @media print { .carimbo, .carimbo .marca, .carimbo .t, .qualificada, .qualificada .q4 { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
      @page { margin: 16mm; }
    </style></head><body>
    <header>
      <img src="${marcaImpressa.src}" alt="${marcaImpressa.nome}">
      <div class="doc">
        <p class="t">Prontuário clínico</p>
        <p class="s">Documento sigiloso</p>
      </div>
    </header>
    <div class="paciente">${cabecalhoPaciente}</div>
    ${corpo || '<p>Nenhuma consulta registrada.</p>'}
    <footer>
      <p>Documento gerado pelo sistema em ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())}. Documento sigiloso, de uso restrito conforme a legislação de proteção de dados.</p>
      ${selo}
    </footer>
    </body></html>`

  const janela = window.open('', '_blank', 'width=900,height=1000')
  if (!janela) {
    window.alert('O navegador bloqueou a janela de impressão. Permita pop-ups para este site e tente de novo.')
    return
  }
  janela.document.write(documento)
  janela.document.close()
  janela.focus()
  // Espera o conteudo assentar antes de chamar a impressao.
  if (imprimirDireto) window.setTimeout(() => janela.print(), 350)
}

/** Texto puro de um campo do editor, para comparar e para buscar. */
function textoSimples(html: string) {
  if (typeof window === 'undefined') return html
  const documento = new DOMParser().parseFromString(html, 'text/html')
  return (documento.body.textContent || '').replace(/\s+/g, ' ').trim()
}

/** Diz se o HTML tem conteudo de verdade, ignorando <br> e espacos. */
function temTexto(html: string) {
  if (typeof window === 'undefined') return html.trim().length > 0
  const documento = new DOMParser().parseFromString(html, 'text/html')
  return (documento.body.textContent || '').replace(/\u00a0/g, ' ').trim().length > 0
}

function editorValue(value: string) {
  const sanitized = sanitizeRichText(value)
  // Texto puro e o que nao tem tag NEM entidade. O editor grava o espaco
  // final como "&nbsp;" mesmo sem nenhuma tag em volta; tratar isso como
  // texto puro escapava o "&" e o prontuario mostrava "&nbsp;" por extenso.
  const pareceHtml = /[<>]|&[a-z]+;|&#\d+;/i.test(value)
  return sanitized === value && !pareceHtml ? textToEditorHtml(value) : sanitized
}

function emptyConsultation(patient: Patient | null, unidadePadrao = ''): ConsultationDraft {
  return {
    data: todayISO(),
    tipo: 'return',
    unidade: patient?.unidade || unidadePadrao,
    peso: '',
    altura: '',
    queixa: '',
    historiaEvolucao: '',
    antecedentesPessoais: '',
    antecedentesFamiliares: '',
    alergias: '',
    medicamentos: '',
    exameFisico: '',
    avaliacao: '',
    cid: patient?.cid || '',
    conduta: '',
    prescricao: '',
    retorno: '',
    observacoes: '',
  }
}

function consultationToDraft(consultation: Consultation): ConsultationDraft {
  return {
    data: consultation.data,
    tipo: consultation.tipo,
    unidade: consultation.unidade,
    peso: consultation.peso,
    altura: consultation.altura,
    queixa: consultation.queixa,
    historiaEvolucao: consultation.historiaEvolucao,
    antecedentesPessoais: consultation.antecedentesPessoais,
    antecedentesFamiliares: consultation.antecedentesFamiliares,
    alergias: consultation.alergias,
    medicamentos: consultation.medicamentos,
    exameFisico: consultation.exameFisico,
    avaliacao: consultation.avaliacao,
    cid: consultation.cid,
    conduta: consultation.conduta,
    prescricao: consultation.prescricao,
    retorno: consultation.retorno,
    observacoes: consultation.observacoes,
  }
}

/**
 * O formulario com o que veio do rascunho por cima. So entram as chaves que o
 * formulario conhece, e so texto: rascunho gravado por uma versao antiga da
 * tela nao pode injetar campo estranho.
 */
function camposDoRascunho(conteudo: Record<string, unknown>, modelo: ConsultationDraft): ConsultationDraft {
  const novo = { ...modelo } as Record<string, unknown>
  for (const chave of Object.keys(modelo)) {
    const valor = conteudo[chave]
    if (typeof valor === 'string') novo[chave] = valor
  }
  return novo as unknown as ConsultationDraft
}

/** "14:32", no fuso da clinica. */
function horaCurta(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso))
}

/**
 * Tamanho do texto do formulario, escolhido por quem esta usando.
 *
 * Os rotulos dos campos sao pequenos de proposito - ocupam pouco e deixam a
 * escrita do medico em primeiro plano. So que "pequeno" depende da vista de
 * quem le e do monitor da mesa, e a mesma tela que fica elegante num 24
 * polegadas fica ilegivel num notebook.
 *
 * O botao aumenta tudo junto: rotulo, texto digitado, caixas e botoes crescem
 * na mesma proporcao, entao o formulario nao se desmonta. A escolha fica no
 * navegador de cada um - o dr. pode usar grande sem mudar a tela da recepcao.
 */
const ESCALA_MINIMA = 1
const ESCALA_MAXIMA = 1.6
const ESCALA_PASSO = 0.15
const CHAVE_DA_ESCALA = 'prontuario:tamanho-do-texto'

function lerEscalaSalva(): number {
  const salvo = Number(window.localStorage.getItem(CHAVE_DA_ESCALA))
  if (!Number.isFinite(salvo) || salvo <= 0) return ESCALA_MINIMA
  return Math.min(ESCALA_MAXIMA, Math.max(ESCALA_MINIMA, salvo))
}

function TamanhoDoTexto({
  escala,
  onMudar,
}: {
  escala: number
  onMudar: (valor: number) => void
}) {
  const mudar = (delta: number) => {
    const proxima = Math.min(ESCALA_MAXIMA, Math.max(ESCALA_MINIMA, Number((escala + delta).toFixed(2))))
    onMudar(proxima)
  }
  const botao =
    'flex h-9 w-9 items-center justify-center rounded-xl border border-[#081b2c]/10 bg-white font-extrabold text-slate-500 transition hover:text-[#1f4f78] disabled:opacity-40'

  return (
    <div className="ml-auto flex shrink-0 items-center gap-1.5">
      <span className="hidden text-[9px] font-extrabold uppercase tracking-[0.13em] text-slate-400 sm:block">
        Texto
      </span>
      <button
        type="button"
        onClick={() => mudar(-ESCALA_PASSO)}
        disabled={escala <= ESCALA_MINIMA}
        className={`${botao} text-[12px]`}
        aria-label="Diminuir o texto do formulário"
        title="Diminuir o texto"
      >
        A
      </button>
      <button
        type="button"
        onClick={() => mudar(ESCALA_PASSO)}
        disabled={escala >= ESCALA_MAXIMA}
        className={`${botao} text-[17px] leading-none`}
        aria-label="Aumentar o texto do formulário"
        title="Aumentar o texto"
      >
        A
      </button>
      {escala > ESCALA_MINIMA && (
        <button
          type="button"
          onClick={() => onMudar(ESCALA_MINIMA)}
          className="rounded-lg px-1.5 py-1 text-[9px] font-extrabold uppercase tracking-wide text-slate-400 transition hover:text-[#1f4f78]"
          title="Voltar ao tamanho padrão"
        >
          {Math.round(escala * 100)}%
        </button>
      )}
    </div>
  )
}

function Field({
  label,
  children,
  required,
  className = '',
}: {
  label: string
  children: React.ReactNode
  required?: boolean
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-500">
        {label}
        {required && <span className="ml-1 text-[#2f7fc1]">*</span>}
      </span>
      {children}
    </label>
  )
}

function RichTextField({
  label,
  value,
  onChange,
  placeholder,
  required,
  className = '',
  campo,
  modelos,
  onSalvarModelo,
  onApagarModelo,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
  className?: string
  /** Chave do campo. Sem ela o botao de modelos nem aparece. */
  campo?: string
  modelos?: NoteTemplate[]
  onSalvarModelo?: (campo: string, titulo: string, texto: string) => Promise<void>
  onApagarModelo?: (id: string) => Promise<void>
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const dispositivoRef = useRef('')
  const chunksCountRef = useRef(0)
  const fonteRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const picoRef = useRef(0)
  const [nivel, setNivel] = useState(0)
  const [diagnostico, setDiagnostico] = useState('')
  const [listening, setListening] = useState(false)
  const [transcrevendo, setTranscrevendo] = useState(false)
  const [speechError, setSpeechError] = useState('')
  const id = useId()
  const { ativo, ativar } = useContext(CampoAtivo)
  const ehAtivo = ativo?.id === id

  const doCampo = campo ? (modelos ?? []).filter((m) => m.campo === campo) : []

  /**
   * Insere o modelo no fim do que ja existe, em vez de substituir.
   *
   * Mesmo caminho do ditado, e pelo mesmo motivo: campo "vazio" no
   * contenteditable costuma conter <br>, e sem a checagem o texto entraria
   * depois desse resto, nascendo com linha em branco na frente.
   */
  function inserirModelo(texto: string) {
    const atual = sanitizeRichText(editorRef.current?.innerHTML || '')
    const proximo = temTexto(atual) ? `${atual}<br>${texto}` : texto
    if (editorRef.current) editorRef.current.innerHTML = proximo
    onChange(sanitizeRichText(proximo))
  }

  async function salvarComoModelo(titulo: string) {
    const texto = sanitizeRichText(editorRef.current?.innerHTML || '')
    if (!titulo || !campo || !onSalvarModelo || !temTexto(texto)) return
    await onSalvarModelo(campo, titulo, texto)
  }

  /** O que a barra do topo precisa saber para agir sobre este campo. */
  function controle(): ControleDeCampo {
    return {
      id,
      rotulo: label,
      campo,
      comando: command,
      gravando: listening,
      transcrevendo,
      nivel,
      alternarDitado: () => void toggleDictation(),
      modelos: doCampo,
      inserirModelo,
      salvarComoModelo,
      apagarModelo: onApagarModelo,
      guardaModelos: Boolean(campo && onSalvarModelo),
    }
  }

  // Reanuncia o campo enquanto ele for o ativo. Gravacao, transcricao e nivel
  // do som mudam aqui embaixo e precisam aparecer la em cima - sem isto a barra
  // continuaria dizendo "Ditar" com o microfone ligado.
  useEffect(() => {
    if (!ehAtivo) return
    ativar(controle())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ehAtivo, listening, transcrevendo, nivel, doCampo.length])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    // Nao reescreve o conteudo enquanto o medico esta digitando dentro dele.
    //
    // O editor guarda o texto no estado do React e devolve para o campo a cada
    // mudanca. Como a limpeza do HTML normaliza o que o navegador gera, os dois
    // quase nunca ficam identicos - e o campo era reescrito a cada tecla. Isso
    // movia o cursor, desligava o negrito recem-ativado e impedia as listas de
    // se formarem. Fora de foco a sincronia continua, para refletir edicoes
    // vindas de outro lugar, como o ditado.
    if (document.activeElement === editor) return
    const nextValue = editorValue(value)
    if (editor.innerHTML !== nextValue) editor.innerHTML = nextValue
  }, [value])

  // Se a tela for fechada no meio de uma gravacao, o microfone precisa ser
  // liberado. Sem isto o indicador de gravacao fica aceso no navegador.
  useEffect(
    () => () => {
      try {
        recorderRef.current?.stop()
      } catch {
        // gravacao ja encerrada
      }
      liberarMicrofone()
    },
    [],
  )

  /**
   * Solta o microfone ao sair da aba.
   *
   * Sem isto, a reserva do dispositivo continua enquanto o usuario abre o
   * WhatsApp Web ou uma chamada, os dois disputam o mesmo microfone, e o
   * servico de audio do Chrome trava - estado em que nem recarregar a pagina
   * resolve, so fechar o navegador.
   */
  useEffect(() => {
    function aoTrocarDeAba() {
      if (document.visibilityState !== 'hidden') return
      if (recorderRef.current?.state === 'recording') {
        // Gravacao em andamento: encerra normalmente para nao perder o audio.
        try {
          recorderRef.current.requestData()
          recorderRef.current.stop()
        } catch {
          // ja parado
        }
        return
      }
      liberarMicrofone()
    }

    document.addEventListener('visibilitychange', aoTrocarDeAba)
    return () => document.removeEventListener('visibilitychange', aoTrocarDeAba)
  }, [])

  function syncEditor() {
    onChange(sanitizeRichText(editorRef.current?.innerHTML || ''))
  }

  function command(commandName: string, commandValue?: string) {
    editorRef.current?.focus()
    // Só a cor precisa sair como estilo. Negrito, itálico e sublinhado devem
    // virar as tags <b>, <i> e <u>: com styleWithCSS ligado o navegador gera
    // <span style="font-weight:bold">, e a limpeza do HTML remove estilos que
    // não sejam cor - o negrito era aplicado e desaparecia em seguida.
    document.execCommand('styleWithCSS', false, commandName === 'foreColor' ? 'true' : 'false')
    document.execCommand(commandName, false, commandValue)
    window.setTimeout(syncEditor, 0)
  }

  function pasteAsText(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault()
    const text = event.clipboardData.getData('text/plain')
    document.execCommand('insertText', false, text)
    window.setTimeout(syncEditor, 0)
  }

  /**
   * Gravacao de audio no estilo WhatsApp: aperta e grava, aperta de novo e o
   * texto cai no editor.
   *
   * Substituiu o SpeechRecognition do Chrome, que mandava o audio do prontuario
   * para servidor do Google sem contrato de tratamento de dados, so funcionava
   * no Chrome e parava a cada pausa da fala. Aqui o audio vai para uma Edge
   * Function nossa, que fala com a Groq com a chave guardada no servidor.
   */
  async function toggleDictation() {
    if (listening) {
      const gravador = recorderRef.current
      // Se o gravador sumiu ou ja parou mas o estado ficou preso em "gravando",
      // o botao ficaria morto ate recarregar a pagina. Aqui ele se destrava.
      if (!gravador || gravador.state === 'inactive') {
        encerrarMicrofone()
        setListening(false)
        return
      }
      try {
        // Pede o pedaco pendente antes de parar. Sem isto, uma gravacao curta
        // pode terminar antes do primeiro corte automatico e voltar vazia.
        if (gravador.state === 'recording') gravador.requestData()
        gravador.stop()
      } catch {
        encerrarMicrofone()
        setListening(false)
      }
      return
    }
    if (transcrevendo) return

    setSpeechError('')

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setSpeechError('Este navegador não permite gravar áudio. Use o Google Chrome atualizado.')
      return
    }

    let stream: MediaStream
    try {
      stream = await obterMicrofone()
    } catch (error) {
      const nome = error instanceof DOMException ? error.name : ''
      if (nome === 'NotFoundError' || nome === 'DevicesNotFoundError') {
        setSpeechError('Nenhum microfone foi encontrado neste computador. Conecte um e tente de novo.')
      } else if (nome === 'NotAllowedError' || nome === 'SecurityError') {
        setSpeechError('O microfone está bloqueado. Clique no cadeado ao lado do endereço do site, permita Microfone e recarregue a página.')
      } else {
        setSpeechError('Não foi possível acessar o microfone.')
      }
      return
    }

    chunksRef.current = []
    const faixa = stream.getAudioTracks()[0]
    dispositivoRef.current = faixa?.label || 'microfone sem nome'
    // Uma faixa "muted" entrega frames vazios: o navegador achou o dispositivo,
    // mas o sistema operacional nao esta deixando o som passar.
    if (faixa && faixa.muted) {
      setSpeechError(
        `O microfone "${dispositivoRef.current}" está mudo no Windows. Abra Configurações do Windows, Sistema, Som, e verifique o volume e a privacidade do microfone.`,
      )
      stream.getTracks().forEach((t) => t.stop())
      return
    }

    const formato = FORMATOS_AUDIO.find((tipo) => MediaRecorder.isTypeSupported(tipo)) || ''
    const recorder = new MediaRecorder(stream, formato ? { mimeType: formato } : undefined)
    recorderRef.current = recorder

    chunksCountRef.current = 0
    recorder.ondataavailable = (evento) => {
      chunksCountRef.current += 1
      if (evento.data && evento.data.size > 0) chunksRef.current.push(evento.data)
    }

    recorder.onerror = () => {
      setSpeechError('A gravação falhou. Tente novamente.')
      encerrarMicrofone()
      setListening(false)
    }

    recorder.onstop = () => {
      const mime = recorder.mimeType || 'audio/webm'
      const blob = new Blob(chunksRef.current, { type: mime })
      chunksRef.current = []
      pararMonitor()
      recorderRef.current = null
      agendarLiberacaoMicrofone()
      setListening(false)
      void enviarParaTranscricao(blob, mime)
    }

    // Uma faixa que nao esta "live" nao entrega audio nenhum. Acontece quando o
    // Chrome segurou o dispositivo de uma gravacao anterior e nao soltou.
    if (faixa && faixa.readyState !== 'live') {
      setSpeechError(
        'O microfone não respondeu. Feche e abra o Chrome novamente: ele costuma ficar segurando o dispositivo.',
      )
      stream.getTracks().forEach((t) => t.stop())
      return
    }

    void monitorarNivel(stream)

    // Cortes curtos: garantem que mesmo uma gravacao de 1 segundo tenha dados.
    recorder.start(250)
    setListening(true)

  }

  /**
   * Autoteste do microfone: grava 3 segundos e mostra os numeros crus.
   *
   * Existe porque o ambiente de desenvolvimento nao tem microfone, entao esta e
   * a unica forma de saber o que realmente acontece na maquina da clinica em
   * vez de deduzir pelo sintoma.
   */
  async function testarMicrofone() {
    setSpeechError('')
    setDiagnostico('Testando por 3 segundos, fale alguma coisa...')
    const linhas: string[] = []

    // Duas configuracoes: com o processamento do navegador e sem nada. Se a
    // segunda gravar e a primeira nao, o culpado e o processamento - conflito
    // conhecido entre o cancelamento de eco do Chrome e drivers de headset USB.
    const cenarios: { nome: string; restricao: MediaTrackConstraints | boolean }[] = [
      {
        nome: 'COM processamento',
        restricao: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      },
      {
        nome: 'SEM processamento',
        restricao: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      },
    ]

    for (const cenario of cenarios) {
      linhas.push(`--- ${cenario.nome} ---`)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: cenario.restricao })
        const faixa = stream.getAudioTracks()[0]
        linhas.push(`Dispositivo: ${faixa?.label || 'sem nome'}`)
        linhas.push(`Faixa: ${faixa?.readyState} | mudo: ${faixa?.muted}`)

        // Usa o contexto compartilhado: criar um por teste ajudaria a
        // estourar justamente o limite que estamos investigando.
        const contexto = obterContexto()
        if (contexto.state === 'suspended') await contexto.resume()
        const analisador = contexto.createAnalyser()
        analisador.fftSize = 512
        const fonteTeste = contexto.createMediaStreamSource(stream)
        fonteTeste.connect(analisador)
        const amostras = new Uint8Array(analisador.frequencyBinCount)
        let pico = 0

        const formato = FORMATOS_AUDIO.find((tipo) => MediaRecorder.isTypeSupported(tipo)) || ''
        const pedacos: Blob[] = []
        const gravador = new MediaRecorder(stream, formato ? { mimeType: formato } : undefined)
        gravador.ondataavailable = (evento) => {
          if (evento.data) pedacos.push(evento.data)
        }

        await new Promise<void>((resolve) => {
          const relogio = window.setInterval(() => {
            analisador.getByteTimeDomainData(amostras)
            let soma = 0
            for (const amostra of amostras) {
              const desvio = (amostra - 128) / 128
              soma += desvio * desvio
            }
            pico = Math.max(pico, Math.sqrt(soma / amostras.length))
          }, 100)
          gravador.onstop = () => {
            window.clearInterval(relogio)
            resolve()
          }
          gravador.start(250)
          window.setTimeout(() => gravador.stop(), 3000)
        })

        const total = pedacos.reduce((soma, pedaco) => soma + pedaco.size, 0)
        linhas.push(`Bytes: ${total} | pico: ${pico.toFixed(4)}`)
        linhas.push(total > 0 && pico > 0.005 ? '>>> GRAVOU <<<' : 'nao gravou')

        fonteTeste.disconnect()
        stream.getTracks().forEach((t) => t.stop())
      } catch (erro) {
        linhas.push(`Falhou: ${erro instanceof Error ? `${erro.name} - ${erro.message}` : String(erro)}`)
      }
      // Deixa o dispositivo respirar entre um teste e outro.
      await new Promise((resolve) => window.setTimeout(resolve, 600))
    }

    setDiagnostico(linhas.join('\n'))
  }

  /**
   * Mede o som que esta realmente entrando pelo microfone.
   *
   * Serve para duas coisas: mostrar ao medico que a gravacao esta captando, e
   * distinguir "o navegador nao gravou" de "o microfone nao mandou som" - que
   * sao problemas diferentes e levam a solucoes diferentes.
   */
  async function monitorarNivel(stream: MediaStream) {
    try {
      // Um unico AudioContext para toda a vida do componente. Criar um novo a
      // cada gravacao estourava o limite do Chrome (cerca de seis) e, a partir
      // dali, o medidor parava de funcionar sem aviso - era o motivo de o
      // ditado morrer depois de algumas gravacoes.
      const contexto = obterContexto()

      // Contextos entram em suspensao sozinhos apos um tempo ocioso.
      if (contexto.state === 'suspended') await contexto.resume()

      const fonte = contexto.createMediaStreamSource(stream)
      fonteRef.current = fonte
      const analisador = contexto.createAnalyser()
      analisador.fftSize = 512
      fonte.connect(analisador)

      const amostras = new Uint8Array(analisador.frequencyBinCount)
      picoRef.current = 0

      const medir = () => {
        if (!fonteRef.current) return
        analisador.getByteTimeDomainData(amostras)
        let soma = 0
        for (const amostra of amostras) {
          const desvio = (amostra - 128) / 128
          soma += desvio * desvio
        }
        const rms = Math.sqrt(soma / amostras.length)
        picoRef.current = Math.max(picoRef.current, rms)
        setNivel(Math.min(1, rms * 4))
        requestAnimationFrame(medir)
      }
      medir()
    } catch {
      // Medicao e um extra: se o navegador nao permitir, a gravacao segue.
    }
  }

  function pararMonitor() {
    // Desliga so a ligacao com este microfone. O AudioContext continua vivo e
    // e reaproveitado na proxima gravacao.
    try {
      fonteRef.current?.disconnect()
    } catch {
      // ja desconectado
    }
    fonteRef.current = null
    setNivel(0)
  }

  function encerrarMicrofone() {
    pararMonitor()
    liberarMicrofone()
    recorderRef.current = null
  }

  /**
   * Solta o microfone depois de um tempo sem uso, em vez de solta-lo a cada
   * gravacao.
   *
   * Motivo: com headset USB, soltar e pedir o dispositivo de novo a cada
   * ditado faz o Chrome devolver um stream mudo a partir da segunda vez. Era
   * por isso que o ditado funcionava logo apos abrir o navegador e parava
   * depois. Mantendo a reserva entre ditados seguidos, o problema nao ocorre.
   *
   * O indicador de gravacao do navegador fica aceso durante esse intervalo.
   */

  async function enviarParaTranscricao(blob: Blob, mime: string) {
    if (blob.size === 0) {
      // O pico de som separa dois problemas diferentes: microfone que nao manda
      // som algum, e navegador que nao consegue gravar o que recebe.
      if (picoRef.current < 0.01) {
        setSpeechError(
          `Nenhum som chegou do "${dispositivoRef.current}". A causa mais comum é outro programa ` +
            `ou outra aba ter pegado o microfone. WhatsApp Web, Zoom, Teams ou Meet reservam o ` +
            `dispositivo mesmo em segundo plano. Feche essas abas e programas e, se não resolver, ` +
            `feche o Chrome por completo e abra de novo: recarregar a página não basta, porque o ` +
            `travamento é do navegador inteiro.`,
        )
      } else {
        setSpeechError(
          `O microfone captou som, mas a gravação voltou vazia ` +
            `(${chunksCountRef.current} pedaços, formato ${mime}). Tente fechar e reabrir o Chrome.`,
        )
      }
      return
    }

    setTranscrevendo(true)
    try {
      const arquivo = new File([blob], `audio.${extensaoDoFormato(mime)}`, { type: mime })
      const corpo = new FormData()
      corpo.append('audio', arquivo)

      const payload = await invokeWithFormData<{ texto?: string }>('transcrever-audio', corpo)
      const texto = (payload?.texto || '').trim()
      if (!texto) {
        setSpeechError('Nenhuma fala foi reconhecida no áudio.')
        return
      }

      const atual = sanitizeRichText(editorRef.current?.innerHTML || '')
      // Campo "vazio" no contenteditable costuma conter <br> ou <div><br></div>.
      // Sem esta checagem o texto ditado entrava depois desses restos e nascia
      // com linhas em branco na frente.
      const proximo = temTexto(atual) ? `${atual}<br>${textToEditorHtml(texto)}` : textToEditorHtml(texto)
      if (editorRef.current) editorRef.current.innerHTML = proximo
      onChange(sanitizeRichText(proximo))
    } catch (causa) {
      setSpeechError(causa instanceof Error ? causa.message : 'Não foi possível transcrever o áudio.')
    } finally {
      setTranscrevendo(false)
    }
  }

  return (
    <Field label={label} required={required} className={className}>
      <div className="mt-1.5 overflow-hidden rounded-[13px] border border-[#081b2c]/10 bg-[#fafaf8] transition focus-within:border-[#2f7fc1] focus-within:bg-white focus-within:ring-4 focus-within:ring-[#2f7fc1]/10">
        <div ref={editorRef} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" data-placeholder={placeholder} onFocus={() => ativar(controle())} onInput={syncEditor} onPaste={pasteAsText} className="min-h-[92px] px-3.5 py-2.5 text-[14px] font-medium leading-[1.6] text-[#081b2c] outline-none empty:before:pointer-events-none empty:before:text-slate-300 empty:before:content-[attr(data-placeholder)] [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5" />
      </div>
      {speechError && (
        <div className="mt-1.5">
          <p className="text-[9px] font-semibold leading-relaxed text-red-500">{speechError}</p>
          <button
            type="button"
            onClick={() => void testarMicrofone()}
            className="mt-1 rounded-lg bg-[#eef3f2] px-2 py-1 text-[9px] font-extrabold text-[#557f75] transition hover:bg-[#e2ece9]"
          >
            Testar microfone
          </button>
        </div>
      )}
      {diagnostico && (
        <pre className="mt-1.5 whitespace-pre-wrap rounded-lg bg-[#fafaf8] p-2 text-[9px] leading-relaxed text-[#081b2c]">
          {diagnostico}
        </pre>
      )}
    </Field>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 sm:col-span-2">
      <span className="h-px flex-1 bg-[#081b2c]/[0.07]" />
      <span className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-slate-400">
        {children}
      </span>
      <span className="h-px flex-1 bg-[#081b2c]/[0.07]" />
    </div>
  )
}

function Detail({ label, value, alerta = false }: { label: string; value: string; alerta?: boolean }) {
  // value.trim() nao bastava: o editor salva "<div><br></div>" quando o campo
  // fica vazio, e o rotulo aparecia sozinho (era o caso de "Observacoes").
  if (!temTexto(value)) return null
  return (
    <div>
      {/* "Documento sereno": rotulo pequeno e apagado, texto clinico em serifa
          grande. Nada de caixas ou fundos: a leitura corrida e o que importa.
          Cor so aparece no campo de alergias, o unico que precisa saltar. */}
      <p className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-slate-400">{label}</p>
      <div
        className={`mt-1 whitespace-pre-wrap font-serif text-[16.5px] leading-[1.72] [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 ${
          alerta ? 'font-semibold text-[#b42318]' : 'text-[#2b4257]'
        }`}
        dangerouslySetInnerHTML={{ __html: editorValue(value) }}
      />
    </div>
  )
}

function ConsultationTypeIcon({ type }: { type: ConsultationType }) {
  if (type === 'telemedicine') return <Video className="h-4 w-4" />
  if (type === 'return') return <RefreshCw className="h-4 w-4" />
  if (type === 'initial') return <FileHeart className="h-4 w-4" />
  return <Stethoscope className="h-4 w-4" />
}

/**
 * Em que pe esta a consulta.
 *
 * Cadastrar um paciente com data de consulta, ou marcar um horario pelo
 * WhatsApp, cria um registro em branco esperando aquele dia. Ele existe para o
 * medico escrever na hora e para pendurar os acompanhamentos - mas na tela
 * aparecia com a mesma cara de um atendimento ja realizado, e o prontuario
 * parecia ter duas consultas onde houve uma.
 *
 * O terceiro estado e o que ninguem tinha percebido: data passada e nada
 * escrito. Nao e agendamento nem atendimento, e um registro que faltou - a
 * unica das situacoes que pede providencia.
 */
type EstadoDaConsulta = 'agendada' | 'sem-registro' | 'realizada' | 'assinada'

function estadoDaConsulta(consultation: Consultation): EstadoDaConsulta {
  if (consultation.assinadoEm) return 'assinada'

  const escrita = [
    consultation.queixa,
    consultation.historiaEvolucao,
    consultation.antecedentesPessoais,
    consultation.antecedentesFamiliares,
    consultation.alergias,
    consultation.medicamentos,
    consultation.exameFisico,
    consultation.avaliacao,
    consultation.cid,
    consultation.conduta,
    consultation.prescricao,
    consultation.retorno,
    consultation.observacoes,
  ].some(temTexto) || Boolean(consultation.peso) || Boolean(consultation.altura)

  if (escrita) return 'realizada'

  // Comparacao por data, sem hora: uma consulta marcada para hoje as 15h ainda
  // e "agendada" as 9h da manha, e virar "sem registro" no meio do expediente
  // seria acusar o medico de esquecer algo que ainda nem aconteceu.
  const hoje = new Date().toISOString().slice(0, 10)
  return consultation.data >= hoje ? 'agendada' : 'sem-registro'
}

const SELO_DO_ESTADO: Record<EstadoDaConsulta, { texto: string; classe: string } | null> = {
  agendada: {
    texto: 'Agendada',
    classe: 'bg-[#eef2f7] text-[#5b6b7d]',
  },
  'sem-registro': {
    texto: 'Sem registro',
    classe: 'bg-[#ebf4fd] text-[#1a5079]',
  },
  // Realizada nao ganha selo: e o caso normal, e etiquetar o normal so gera
  // ruido. O que precisa de destaque e o que foge dele.
  realizada: null,
  assinada: {
    texto: 'Assinada',
    classe: 'bg-[#e8f5ec] text-[#1c6b3a]',
  },
}

function ConsultationCard({
  consultation,
  anterior,
  onEdit,
  onAssinar,
  onAbrirAssinado,
  onPrescrever,
  onImprimir,
  prescrevendo,
  receitas,
  assinando,
  clinicId,
  adendos,
  erroDosAdendos,
  onAdendoRegistrado,
  retornoAberto,
  onAbrirRetorno,
  onFecharRetorno,
  onRetornoMarcado,
}: {
  consultation: Consultation
  /** Consulta imediatamente anterior, para mostrar o que mudou. */
  anterior?: Consultation
  onEdit: (consultation: Consultation) => void
  onAssinar: (consultation: Consultation) => void
  onAbrirAssinado: (consultation: Consultation) => void
  onPrescrever: (consultation: Consultation) => void
  /** Imprime so este atendimento, sem o resto do historico. */
  onImprimir: (consultation: Consultation) => void
  prescrevendo: boolean
  /** Receitas emitidas neste atendimento. */
  receitas: Receita[]
  /** Id da consulta cuja assinatura esta em andamento, se houver. */
  assinando: string | null
  clinicId: string | null
  /** Adendos deste atendimento (so existem depois de assinado). */
  adendos: Adendo[]
  /** Por que os adendos nao carregaram, se nao carregaram. */
  erroDosAdendos: string
  onAdendoRegistrado: () => void
  /** O painel de marcar retorno esta aberto neste cartao. */
  retornoAberto: boolean
  onAbrirRetorno: (consultation: Consultation) => void
  onFecharRetorno: () => void
  onRetornoMarcado: (mensagem: string) => void
}) {
  // Os campos guardam HTML (negrito, cor). Para a linha de resumo so interessa
  // o texto: sem esta limpeza o cartao exibia a marcacao crua, tipo
  // <span style="color:...">, no lugar da frase.
  const summary = textoSimples(
    consultation.avaliacao || consultation.queixa || consultation.historiaEvolucao || consultation.conduta,
  )

  const estado = estadoDaConsulta(consultation)

  const imc = calcularIMC(consultation.peso, consultation.altura)
  const imcAnterior = anterior ? calcularIMC(anterior.peso, anterior.altura) : null
  const variacaoPeso = anterior ? formatarVariacao(numeroBR(consultation.peso), numeroBR(anterior.peso)) : null
  const variacaoImc = formatarVariacao(imc, imcAnterior)

  // Campos em que a mudanca importa clinicamente. Antecedentes e alergias
  // mudam pouco e poluiriam o aviso.
  const mudancas = anterior
    ? (
        [
          ['Avaliação', consultation.avaliacao, anterior.avaliacao],
          ['Conduta', consultation.conduta, anterior.conduta],
          ['Prescrição', consultation.prescricao, anterior.prescricao],
          ['Medicamentos', consultation.medicamentos, anterior.medicamentos],
        ] as const
      )
        .filter(([, atual, antigo]) => textoSimples(atual) !== textoSimples(antigo))
        .map(([rotulo]) => rotulo)
    : []

  return (
    <AccordionItem
      value={consultation.id}
      id={`consulta-${consultation.id}`}
      className="overflow-hidden rounded-[18px] border border-[#081b2c]/[0.09] bg-white shadow-[0_6px_20px_rgba(8,27,44,.04)] scroll-mt-24"
    >
      <AccordionTrigger className="group gap-3 px-4 py-4 hover:no-underline sm:px-5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-[#dceaf7] text-[#1f4f78]">
            <ConsultationTypeIcon type={consultation.tipo} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`text-[14px] font-extrabold ${
                  estado === 'agendada' ? 'text-slate-500' : 'text-[#081b2c]'
                }`}
              >
                {consultationLabels[consultation.tipo]}
              </span>
              {SELO_DO_ESTADO[estado] && (
                <span
                  className={`rounded-full px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.06em] ${
                    SELO_DO_ESTADO[estado]!.classe
                  }`}
                >
                  {SELO_DO_ESTADO[estado]!.texto}
                </span>
              )}
              {consultation.cid && (
                <span className="rounded-full bg-[#eef3f2] px-2 py-1 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[#557f75]">
                  CID {consultation.cid.toUpperCase()}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] font-bold text-slate-500">
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3 w-3" /> {fmtBR(consultation.data)}
              </span>
              {consultation.unidade && (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3 w-3" /> {consultation.unidade}
                </span>
              )}
              {consultation.peso && (
                <span className="inline-flex items-center gap-1">
                  <Scale className="h-3 w-3" /> {consultation.peso} kg
                  {variacaoPeso && variacaoPeso !== 'sem mudança' && (
                    <span className="text-slate-400">({variacaoPeso} kg)</span>
                  )}
                </span>
              )}
              {consultation.altura && (
                <span className="inline-flex items-center gap-1">
                  <Ruler className="h-3 w-3" /> {consultation.altura} cm
                </span>
              )}
              {imc !== null && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-[#eef3f2] px-2 py-0.5 text-[#41695f]"
                  title="Índice de massa corporal, calculado a partir do peso e da altura desta consulta"
                >
                  IMC {imc.toFixed(1).replace('.', ',')}
                  {variacaoImc && variacaoImc !== 'sem mudança' && (
                    <span className="font-medium">({variacaoImc})</span>
                  )}
                </span>
              )}
            </div>
            {/* Some quando o cartao abre: la embaixo o mesmo texto ja aparece
                inteiro em "Avaliacao", e repetido virava ruido. */}
            {summary && (
              <p className="mt-2 line-clamp-1 text-[12px] font-medium text-slate-500 group-data-[state=open]:hidden">
                {summary}
              </p>
            )}
          </div>
        </div>
      </AccordionTrigger>

      <AccordionContent className="px-4 pb-6 sm:px-7 sm:pb-7">
        {/* Regua escura separando cabecalho e documento, como no modelo. A
            alergia sobe para ca como etiqueta: e a informacao que nao pode
            passar batida, e no meio da lista de campos ela se perdia. */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-[#081b2c] pt-3">
          {temTexto(consultation.alergias) ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fceceb] px-3 py-1 text-[12px] font-extrabold text-[#b42318]">
              <AlertTriangle className="h-3.5 w-3.5" /> {textoSimples(consultation.alergias)}
            </span>
          ) : (
            <span />
          )}
          {/* Assinada, a consulta deixa de ser rascunho: some o botao de editar
              e entra o documento. Correcao a partir daqui e adendo, nunca
              alteracao do que ja foi assinado - e a regra da nao-rasura do
              prontuario, e tambem o que mantem a assinatura valida. */}
          {consultation.assinadoEm ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e8f5ec] px-3 py-1 text-[11px] font-extrabold text-[#1c6b3a]">
                <ShieldCheck className="h-3.5 w-3.5" />
                Assinado em {dataHoraLocal(consultation.assinadoEm)}
                {consultation.assinadoPor ? ` por ${consultation.assinadoPor}` : ''}
              </span>
              {consultation.arquivoAssinado && (
                <button
                  type="button"
                  onClick={() => onAbrirAssinado(consultation)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#081b2c]/10 bg-white px-3 py-2 text-[10px] font-extrabold text-slate-600 transition hover:bg-slate-50"
                >
                  <FileText className="h-3.5 w-3.5" /> Ver documento assinado
                </button>
              )}
              <button
                type="button"
                onClick={() => onAbrirRetorno(consultation)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#1f4f78]/20 bg-white px-3 py-2 text-[10px] font-extrabold text-[#1f4f78] transition hover:bg-[#f1f7fd]"
                title="Procura horário livre perto do prazo de retorno e marca na Agenda"
              >
                <CalendarPlus className="h-3.5 w-3.5" /> Marcar retorno
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {/* Consulta em branco nao tem o que assinar: assinar o vazio
                  produziria um documento com valor legal afirmando nada. O
                  botao so aparece quando ha atendimento escrito. */}
              <button
                type="button"
                onClick={() => onAssinar(consultation)}
                hidden={estado !== 'realizada'}
                disabled={assinando === consultation.id}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#1c6b3a]/20 bg-[#eef7f1] px-3 py-2 text-[10px] font-extrabold text-[#1c6b3a] transition hover:bg-[#e2f0e8] disabled:cursor-wait disabled:opacity-70"
              >
                {assinando === consultation.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                {assinando === consultation.id ? 'Aguardando o celular...' : 'Assinar digitalmente'}
              </button>
              <button
                type="button"
                onClick={() => onEdit(consultation)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#1f4f78]/20 bg-[#eff6fd] px-3 py-2 text-[10px] font-extrabold text-[#2a6ea8] transition hover:bg-[#dceaf8]"
              >
                <Edit3 className="h-3.5 w-3.5" />
                {estado === 'realizada' ? 'Editar consulta' : 'Escrever atendimento'}
              </button>
              <button
                type="button"
                onClick={() => onPrescrever(consultation)}
                disabled={prescrevendo}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#2563eb]/20 bg-[#eef3fd] px-3 py-2 text-[10px] font-extrabold text-[#1d4ed8] transition hover:bg-[#e2eafb] disabled:cursor-wait disabled:opacity-70"
              >
                {prescrevendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pill className="h-3.5 w-3.5" />}
                Prescrever
              </button>
              {/* Um atendimento so, para entregar ao paciente ou anexar ao
                  convenio. O botao de cima imprime o historico inteiro. */}
              <button
                type="button"
                onClick={() => onImprimir(consultation)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#081b2c]/10 bg-white px-3 py-2 text-[10px] font-extrabold text-slate-600 transition hover:border-[#081b2c]/25 hover:text-[#081b2c]"
                title="Imprime apenas esta consulta"
              >
                <Printer className="h-3.5 w-3.5" />
                Imprimir esta
              </button>
              <button
                type="button"
                onClick={() => onAbrirRetorno(consultation)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#1f4f78]/20 bg-white px-3 py-2 text-[10px] font-extrabold text-[#1f4f78] transition hover:bg-[#f1f7fd]"
                title="Procura horário livre perto do prazo de retorno e marca na Agenda"
              >
                <CalendarPlus className="h-3.5 w-3.5" /> Marcar retorno
              </button>
            </div>
          )}
        </div>
        {retornoAberto && (
          <MarcarRetorno
            clinicId={clinicId}
            patientId={consultation.patientId}
            unidadeDaConsulta={consultation.unidade}
            textoDoRetorno={textoSimples(consultation.retorno)}
            onFechar={onFecharRetorno}
            onMarcado={onRetornoMarcado}
          />
        )}
        {mudancas.length > 0 && (
          <div className="mt-3 rounded-[14px] border border-[#2f7fc1]/30 bg-[#f0f6fd] px-4 py-3">
            <p className="text-[11px] font-extrabold text-[#16456b]">
              Mudou desde a consulta de {fmtBR(anterior!.data)}
            </p>
            <p className="mt-1 text-[13px] font-semibold text-[#16456b]/80">{mudancas.join(' · ')}</p>
          </div>
        )}
        {/* Uma coluna so, com largura de leitura limitada (~66 caracteres). Em
            tres colunas o texto quebrava em pedacos curtos e desalinhados; em
            coluna unica cada campo respira e a ordem de leitura fica obvia. */}
        <div className="mt-3 max-w-[78ch] space-y-5 border-t border-[#081b2c]/[0.06] pt-5">
          <Detail label="Queixa principal" value={consultation.queixa} />
          <Detail label="História e evolução" value={consultation.historiaEvolucao} />
          <Detail label="Antecedentes pessoais" value={consultation.antecedentesPessoais} />
          <Detail label="Antecedentes familiares" value={consultation.antecedentesFamiliares} />
          <Detail label="Medicamentos em uso" value={consultation.medicamentos} />
          <Detail label="Exame físico" value={consultation.exameFisico} />
          <Detail label="Avaliação e hipótese diagnóstica" value={consultation.avaliacao} />
          <Detail label="Conduta" value={consultation.conduta} />
          <Detail label="Prescrição" value={consultation.prescricao} />
          {/* As receitas da Memed entram no prontuario com os itens escritos,
              e nao so com o link: se a integracao acabar amanha, o atendimento
              continua dizendo o que foi prescrito. O link e conveniencia. */}
          {receitas.length > 0 && (
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-500">
                Receitas emitidas
              </p>
              {/* Separadas por categoria, cada uma com sua cor (23/09/2026).
                  Dentro de cada grupo, a ordem de sempre: a mais nova em cima. */}
              {ORDEM_DAS_CATEGORIAS.map((categoria) => {
                const doGrupo = receitas.filter((r) => categoriaDaReceita(r.itens) === categoria)
                if (doGrupo.length === 0) return null
                const estilo = ESTILO_DA_CATEGORIA[categoria]
                const Icone = estilo.icone
                return (
              <div key={categoria} className="mt-2">
                <p className={`mb-1.5 inline-flex items-center gap-1.5 text-[10px] font-extrabold ${estilo.texto}`}>
                  <Icone className="h-3.5 w-3.5" />
                  {estilo.titulo}
                </p>
              <div className="space-y-2">
                {doGrupo.map((receita) => (
                  <div
                    key={receita.id}
                    className={`rounded-[14px] border px-4 py-3 ${
                      receita.excluidaEm ? 'border-[#081b2c]/10 bg-[#fafaf8]' : estilo.cartao
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={`inline-flex items-center gap-1.5 text-[11px] font-extrabold ${estilo.texto}`}>
                        <Icone className="h-3.5 w-3.5" />
                        {dataDaReceita(receita.emitidaEm)}
                        {categoria === 'especial' && receita.itens[0]?.receituario && (
                          <span className="font-bold opacity-80">· {receita.itens[0].receituario}</span>
                        )}
                      </span>
                      {receita.excluidaEm ? (
                        <span className="text-[10px] font-bold text-slate-400">
                          Receita cancelada pelo médico
                        </span>
                      ) : (
                        receita.link && (
                          <a
                            href={receita.link}
                            target="_blank"
                            rel="noreferrer"
                            className={`text-[10px] font-extrabold underline underline-offset-2 ${estilo.texto}`}
                          >
                            Abrir receita
                          </a>
                        )
                      )}
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {receita.itens.map((item, indice) => (
                        <li key={`${receita.id}-${indice}`} className="text-[13px] leading-snug">
                          <span className="font-bold text-[#081b2c]">{item.nome}</span>
                          {item.posologia && (
                            <span className="block text-[12px] font-medium text-slate-500">
                              {item.posologia}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              </div>
                )
              })}
            </div>
          )}
          <Detail label="Retorno" value={consultation.retorno} />
          <Detail label="Observações clínicas" value={consultation.observacoes} />
          {/* Adendo so em atendimento assinado: antes disso corrige-se o texto. */}
          {consultation.assinadoEm &&
            (erroDosAdendos ? (
              <p className="rounded-xl bg-[#fef6e7] px-3 py-2 text-[11px] font-semibold text-[#93370d]">
                Adendos indisponíveis agora: {erroDosAdendos}
              </p>
            ) : (
              <AdendosDaConsulta
                clinicId={clinicId}
                patientId={consultation.patientId}
                consultationId={consultation.id}
                adendos={adendos}
                onRegistrado={onAdendoRegistrado}
              />
            ))}
        </div>
      </AccordionContent>
    </AccordionItem>
  )
}

/**
 * O recado que o prontuario da depois de uma acao demorada.
 *
 * Assinatura e prescricao terminam longe de onde comecaram - a primeira depois
 * de o navegador ir ao VIDaaS e voltar, a segunda dentro da tela da Memed. Sem
 * um lugar fixo para o resultado, o medico voltaria para uma tela igual a que
 * deixou, sem saber se deu certo.
 */
type EsperaDaAssinaturaProps = {
  espera: { autorizarEm: string; tentativas: number; minutosRestantes: number; ultimaResposta?: string }
  onDesistir: () => void
}

/**
 * Painel que fica na tela enquanto o medico aprova no celular.
 *
 * Diz o que fazer, mostra que o sistema esta acompanhando, e da o link caso a
 * aba do VIDaaS nao tenha aberto. Rola ate si mesmo ao aparecer pelo mesmo
 * motivo do aviso: nasce acima da area visivel e ninguem o veria.
 */
function EsperaDaAssinatura({ espera, onDesistir }: EsperaDaAssinaturaProps) {
  const referencia = useRef<HTMLDivElement>(null)
  useEffect(() => {
    referencia.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [])
  const minutos = espera.minutosRestantes
  return (
    <div
      ref={referencia}
      role="status"
      className="flex items-start gap-3 rounded-2xl border border-[#1c6b3a]/20 bg-[#eef7f1] px-4 py-3 text-[12px] font-semibold text-[#1c6b3a]"
    >
      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
      <div className="flex-1 space-y-1">
        <p className="font-extrabold">Aguardando a autorização no celular</p>
        <p className="font-medium text-[#1c6b3a]/80">
          Abra o aplicativo VIDaaS no celular e aprove. Esta aprovação vale pelas próximas 4 horas: as
          outras consultas do turno assinam direto, sem celular. Esta tela confere sozinha a cada
          poucos segundos{espera.tentativas > 0 ? ` (${espera.tentativas} vez${espera.tentativas > 1 ? 'es' : ''} até agora)` : ''}.
          O pedido vale por {minutos} min.
        </p>
        {espera.ultimaResposta && (
          <p className="break-all font-mono text-[10px] text-[#1c6b3a]/60">
            BRy: {espera.ultimaResposta}
          </p>
        )}
        {espera.autorizarEm && (
          <p className="font-medium text-[#1c6b3a]/80">
            A página do VIDaaS não abriu?{' '}
            <a href={espera.autorizarEm} target="_blank" rel="noreferrer" className="underline">
              Abrir aqui
            </a>
            .
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDesistir}
        className="rounded-lg px-2 py-1 text-[11px] font-bold text-[#1c6b3a]/70 hover:bg-[#1c6b3a]/10"
      >
        Cancelar
      </button>
    </div>
  )
}

type AvisoDoProntuarioProps = {
  aviso: { tipo: 'ok' | 'erro' | 'info'; texto: string }
  onFechar: () => void
}

function AvisoDoProntuario({ aviso, onFechar }: AvisoDoProntuarioProps) {
  const caixa = useRef<HTMLDivElement>(null)

  // O texto entra nas dependencias para que um aviso NOVO tambem role a tela:
  // dois erros seguidos no mesmo lugar sao dois avisos, e o segundo precisa
  // ser visto igual ao primeiro.
  useEffect(() => {
    caixa.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [aviso.texto])

  return (
    <div
      ref={caixa}
      className={`mb-3 flex items-start gap-2 rounded-[14px] border px-4 py-3 text-[12px] font-bold ${
        aviso.tipo === 'ok'
          ? 'border-[#1c6b3a]/25 bg-[#eef7f1] text-[#1c6b3a]'
          : aviso.tipo === 'info'
            ? // Amarelo: nao e erro, mas pede um olhar do medico (alergia fora
              // da lista da Memed, peso de outra consulta).
              'border-[#b54708]/25 bg-[#fef6e7] text-[#93370d]'
            : 'border-[#b42318]/25 bg-[#fceceb] text-[#b42318]'
      }`}
    >
      {aviso.tipo === 'ok' ? (
        <ShieldCheck className="mt-px h-4 w-4 shrink-0" />
      ) : (
        <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
      )}
      <span className="flex-1">{aviso.texto}</span>
      <button
        type="button"
        onClick={onFechar}
        className="shrink-0 opacity-60 transition hover:opacity-100"
        aria-label="Fechar aviso"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export default function PatientRecord({
  patient,
  open,
  startInConsultationForm = false,
  onOpenChange,
  listConsultations,
  addConsultation,
  updateConsultation,
  onEditRegistration,
}: PatientRecordProps) {
  const [mode, setMode] = useState<'history' | 'form'>('history')
  const [consultations, setConsultations] = useState<Consultation[]>([])
  // Os modelos sao da clinica, entao sao carregados uma vez por abertura do
  // prontuario e compartilhados por todos os campos - e nao um pedido por campo.
  const [clinicId, setClinicId] = useState<string | null>(null)
  // Prontuario e do medico (24/09/2026). A recepcao chega aqui pela lista de
  // pacientes, e o banco ja nao lhe entrega nenhuma consulta - sem este aviso
  // a tela abria vazia, como se o paciente nunca tivesse sido atendido.
  // Comeca verdadeiro para quem atende nao ver o aviso piscar ao abrir.
  const [podeVerProntuario, setPodeVerProntuario] = useState(true)
  const [modelos, setModelos] = useState<NoteTemplate[]>([])
  const [integridade, setIntegridade] = useState<Integridade | null>(null)
  const [conferindo, setConferindo] = useState(false)
  const [buscaConsulta, setBuscaConsulta] = useState('')
  const [assinando, setAssinando] = useState<string | null>(null)
  const [assinaturaConcluida, setAssinaturaConcluida] = useState(0)
  // Qual cartao esta aberto. Controlado aqui (e nao dentro do Accordion) para
  // que as setas "anterior / proxima" consigam abrir o vizinho.
  const [consultaAberta, setConsultaAberta] = useState<string>('')
  // Pedido de assinatura em aberto: o medico foi aprovar no celular e a tela
  // fica perguntando a BRy se ja pode assinar. Morre ao concluir, ao expirar
  // ou quando a pessoa desiste.
  const [espera, setEspera] = useState<{
    pedido: string
    consultaId: string
    expiraEm: number
    autorizarEm: string
    tentativas: number
    // Contado aqui, a cada pergunta, e nao no render do painel: relogio
    // dentro do render e impuro e o React recusa com razao.
    minutosRestantes: number
    // Ultima resposta da BRy, crua. Aparece no painel para que um print baste
    // para diagnosticar - sem acesso aos logs, era a unica janela.
    ultimaResposta?: string
  } | null>(null)
  const [prescrevendo, setPrescrevendo] = useState(false)
  const [receitas, setReceitas] = useState<Receita[]>([])
  // Qual campo a barra de formatacao esta comandando. Mora aqui, e nao dentro
  // do formulario, porque a barra e os campos sao irmaos na arvore.
  const [campoAtivo, setCampoAtivo] = useState<ControleDeCampo | null>(null)
  const [aviso, setAviso] = useState<
    { tipo: 'ok' | 'erro' | 'info'; texto: string } | null
  >(null)
  const unidadesDaClinica = useUnidades()
  // Adendos do paciente inteiro, carregados de uma vez e repartidos por cartao.
  const [adendos, setAdendos] = useState<Adendo[]>([])
  const [erroDosAdendos, setErroDosAdendos] = useState('')
  // O que a coluna da direita mostra no historico (25/09/2026).
  const [painel, setPainel] = useState<'consultas' | 'crescimento' | 'exames'>('consultas')
  // Crescimento so para menor de idade no otorrino (15/10/2026). Se a aba
  // some com ela aberta (a data de nascimento mudou no cadastro), a tela
  // volta para as consultas em vez de ficar sem nenhuma vista marcada.
  const mostraCrescimento = patient
    ? mostraCurvaDeCrescimento(publicoDaClinica(clinicId), patient.nascimento, todayISO())
    : false
  const painelVisivel = painel === 'crescimento' && !mostraCrescimento ? 'consultas' : painel
  // Cartao com o painel de marcar retorno aberto, se algum.
  const [retornoAberto, setRetornoAberto] = useState<string | null>(null)

  async function carregarAdendos(clinica: string, pacienteId: string) {
    try {
      setAdendos(await listarAdendos(clinica, pacienteId))
      setErroDosAdendos('')
    } catch (causa) {
      // Sem os adendos, o cartao assinado diz que nao carregaram - e nao
      // finge que nao ha nenhum.
      setAdendos([])
      setErroDosAdendos(causa instanceof Error ? causa.message : 'falha ao carregar')
    }
  }

  useEffect(() => {
    if (!open || !clinicId || !patient) return
    void carregarAdendos(clinicId, patient.id)
    // Depende do id, e nao do objeto (ver os efeitos abaixo).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clinicId, patient?.id])

  // Aquece a Memed assim que o prontuário abre.
  //
  // Buscar o token e carregar o script deles leva alguns segundos, e antes isso
  // tudo acontecia depois do clique em Prescrever, com o médico esperando.
  // Nada disso depende do paciente, então acontece agora, enquanto ele lê a
  // ficha. Roda uma vez por sessão e não trava nada se falhar: o erro, se
  // houver, aparece no clique, como antes.
  useEffect(() => {
    if (!open) return
    void prepararPrescricao().catch(() => {})
  }, [open])

  useEffect(() => {
    if (!open) return
    let vivo = true
    void (async () => {
      try {
        const membership = await getCurrentMembership()
        if (!membership || !vivo) return
        setClinicId(membership.clinicId)
        setPodeVerProntuario(membership.role === 'owner' || membership.role === 'clinician')
        const lista = await listNoteTemplates(membership.clinicId)
        if (vivo) setModelos(lista)
        // A integridade e carregada junto porque o documento impresso leva o
        // selo dela: sem isso, imprimir logo depois de abrir sairia sem selo.
        const estado = await conferirIntegridade(membership.clinicId)
        if (vivo) setIntegridade(estado)
        if (patient) {
          const emitidas = await listPrescriptions(membership.clinicId, patient.id)
          if (vivo) setReceitas(emitidas)
        }
      } catch {
        // Modelo e conveniencia: se a lista falhar, o prontuario continua
        // inteiro e o medico escreve como sempre escreveu.
      }
    })()
    return () => {
      vivo = false
    }
    // Depende do id, e nao do objeto: o paciente e recriado a cada carga da
    // lista, e observar o objeto recarregaria tudo em looping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patient?.id])

  /**
   * Volta da autorizacao no VIDaaS.
   *
   * A certificadora devolve o navegador para ca com o numero do pedido no
   * endereco. Este efeito o reconhece, conclui a assinatura e limpa o endereco -
   * senao um F5 tentaria assinar de novo um pedido ja gasto e mostraria um erro
   * que nao e erro.
   */
  useEffect(() => {
    const pedido = parametrosDoEndereco().get('state')
    if (!pedido) return

    // O "paciente" NAO sai aqui: quem o le e a lista de pacientes, e no React
    // o efeito do filho roda antes do efeito do pai. Apagando neste ponto, o
    // prontuario concluia a assinatura e nao abria, porque a lista ja nao
    // achava o paciente no endereco.
    apagarParametrosDoEndereco(['state', 'code'])

    void (async () => {
      setAssinando(pedido)
      try {
        const resultado = await concluirAssinatura(pedido)
        if (resultado.situacao === 'aguardando') {
          // A outra aba pode estar assinando neste instante. Esta entra na
          // mesma espera e descobre o resultado nas proximas perguntas.
          setEspera({
            pedido,
            consultaId: '',
            autorizarEm: '',
            expiraEm: Date.now() + 15 * 60 * 1000,
            tentativas: 0,
            minutosRestantes: 15,
          })
          return
        }
        // Nao recarrega a lista aqui: este efeito roda na montagem, quando o
        // paciente ainda nao foi escolhido, e a variavel ficaria presa no valor
        // nulo daquele instante. Quem recarrega e o efeito logo abaixo, que
        // enxerga o paciente ja aberto.
        setAssinaturaConcluida((n) => n + 1)
        setAviso({ tipo: 'ok', texto: 'Atendimento assinado e arquivado.' })
      } catch (causa) {
        setAviso({
          tipo: 'erro',
          texto: causa instanceof Error ? causa.message : 'A assinatura não foi concluída.',
        })
      } finally {
        setAssinando(null)
      }
    })()
    // De proposito so na montagem: a volta do VIDaaS acontece uma vez, num
    // carregamento novo da pagina.
  }, [])

  /**
   * Pergunta a BRy, a cada poucos segundos, se o medico ja autorizou.
   *
   * E o caminho principal da assinatura. O retorno por endereco (efeito acima)
   * continua existindo como atalho, mas nunca chegou a acontecer na pratica:
   * o medico aprovava no celular e o navegador do consultorio ficava onde
   * estava. Perguntando, o sistema nao depende de ninguem voltar.
   */
  useEffect(() => {
    if (!espera) return
    let vivo = true

    const perguntar = async () => {
      if (!vivo) return
      if (Date.now() > espera.expiraEm) {
        setEspera(null)
        setAssinando(null)
        setAviso({ tipo: 'erro', texto: 'A autorização expirou sem resposta do celular. Peça a assinatura de novo.' })
        return
      }
      try {
        const resultado = await concluirAssinatura(espera.pedido)
        if (!vivo) return
        if (resultado.situacao === 'aguardando') {
          const minutosRestantes = Math.max(0, Math.ceil((espera.expiraEm - Date.now()) / 60000))
          const ultimaResposta = resultado.detalhe
          setEspera((atual) => (atual ? { ...atual, tentativas: atual.tentativas + 1, minutosRestantes, ultimaResposta } : atual))
          return
        }
        setEspera(null)
        setAssinando(null)
        setAssinaturaConcluida((n) => n + 1)
        setAviso({ tipo: 'ok', texto: 'Atendimento assinado e arquivado.' })
      } catch (causa) {
        if (!vivo) return
        setEspera(null)
        setAssinando(null)
        setAviso({
          tipo: 'erro',
          texto: causa instanceof Error ? causa.message : 'A assinatura não foi concluída.',
        })
      }
    }

    // A primeira pergunta espera um pouco: o medico ainda esta pegando o
    // celular. Depois, a cada 5 segundos.
    const primeiro = window.setTimeout(perguntar, 4000)
    const ritmo = window.setInterval(perguntar, 5000)
    return () => {
      vivo = false
      window.clearTimeout(primeiro)
      window.clearInterval(ritmo)
    }
    // So reinicia quando o pedido muda; as tentativas sao contadas por fora.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [espera?.pedido])

  /**
   * Recarrega a consulta depois que a assinatura foi concluida.
   *
   * Separado do efeito acima porque as duas coisas acontecem em ordens
   * diferentes: a assinatura conclui em segundos, e o prontuario pode abrir
   * antes ou depois disso. Reagindo aos dois - assinatura pronta e paciente
   * aberto - a lista atualiza em qualquer das ordens.
   */
  useEffect(() => {
    if (!assinaturaConcluida || !patient) return
    void load(patient.id)
    // Depende do id, e nao do objeto: o paciente e recriado a cada carga da
    // lista, e observar o objeto recarregaria a consulta em looping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinaturaConcluida, patient?.id])

  /**
   * Abre a prescricao da Memed sobre o prontuario.
   *
   * A checagem de CPF acontece ANTES de abrir. A Memed so recusa na hora de
   * imprimir, quando o medico ja escreveu a receita inteira - e aí o trabalho
   * se perde e a mensagem de erro vem em linguagem de API.
   */
  async function prescrever(consultation: Consultation | null) {
    if (!patient) return
    setAviso(null)

    const falta = faltaParaPrescrever(patient)
    if (falta.length) {
      setAviso({
        tipo: 'erro',
        texto: `Para emitir receita falta ${falta.join(' e ')} no cadastro de ${patient.nome.split(' ')[0]}. É exigência da RDC 1000/25: sem isso a Memed recusa a emissão.`,
      })
      return
    }

    setPrescrevendo(true)
    try {
      // Endereco da unidade, para o rodape da receita e para a identificacao
      // que a Memed exige. Vem da Agenda; se faltar, a Memed pede na tela.
      // A receita sai com o local de atendimento no cabecalho: endereco da
      // unidade da consulta e telefone da clinica, os dois vindos das
      // preferencias. Faltando, para aqui com a instrucao de onde preencher,
      // em vez de deixar a Memed imprimir um cabecalho em branco.
      if (!clinicId) throw new Error('Clínica não identificada.')
      // Alergia, peso e altura podem vir de consulta anterior (ver
      // dados-para-memed.ts). A traducao das alergias vai junto com as outras
      // buscas, para nao somar espera ao clique.
      const dados = dadosParaMemed(consultation, consultations, hojeEmSaoPaulo())
      const [unidades, dadosDaClinica, alergias] = await Promise.all([
        listUnits(clinicId),
        getDadosDaClinica(clinicId),
        alergiasParaMemed(dados.alergias?.valor ?? ''),
      ])
      const nome = (consultation?.unidade ?? patient.unidade ?? '').trim().toLowerCase()
      const unidade =
        unidades.find((u) => u.name.trim().toLowerCase() === nome) ??
        (unidades.length === 1 ? unidades[0] : undefined)
      if (!unidade || !unidade.address.trim()) {
        throw new Error(
          unidade
            ? `A unidade "${unidade.name}" está sem endereço. Preencha em Agenda → Unidades antes de prescrever.`
            : `A unidade "${consultation?.unidade || patient.unidade || '(vazia)'}" não está cadastrada. Cadastre em Agenda → Unidades, com endereço, e escolha essa unidade na consulta.`,
        )
      }
      if (!dadosDaClinica.telefone.trim()) {
        throw new Error('Preencha o telefone da clínica em Preferências → Médico e clínica antes de prescrever.')
      }
      const local: LocalDeAtendimento = {
        nome: unidade.name,
        endereco: unidade.address,
        cnes: unidade.cnes || undefined,
        // Um numero so, e o celular quando existe: o campo da Memed e validado
        // e recusava tanto os dois juntos quanto o fixo de 10 digitos.
        telefone: telefoneValidavel(dadosDaClinica.telefone, dadosDaClinica.telefone2),
      }
      const { alergiasEnviadas } = await abrirPrescricao(patient, consultation, {
        onReceita: (dados) => {
          void (async () => {
            try {
              await guardarReceita(patient.id, consultation?.id ?? null, dados)
              let lista: Receita[] = []
              if (clinicId) {
                lista = await listPrescriptions(clinicId, patient.id)
                setReceitas(lista)
              }
              await copiarReceitaParaPrescricao(consultation, lista)
              setAviso({ tipo: 'ok', texto: 'Receita emitida e guardada no prontuário.' })
            } catch (causa) {
              setAviso({
                tipo: 'erro',
                texto: causa instanceof Error ? causa.message : 'A receita não pôde ser arquivada.',
              })
            }
          })()
        },
        onExcluida: (id) => void marcarReceitaExcluida(id),
      }, local, {
        peso: dados.peso?.valor ?? '',
        altura: dados.altura?.valor ?? '',
        alergiaIds: [...new Set(alergias.reconhecidas.map((a) => a.id))],
      })
      // Diagnostico do cadastro do medico na Memed, enquanto a liberacao de
      // producao esta em andamento. Some sozinho quando estiver completo.
      if (ultimoCadastro && !ultimoCadastro.feito) {
        setAviso({ tipo: 'erro', texto: `Cadastro do médico na Memed não foi completado: ${ultimoCadastro.detalhe ?? 'sem detalhe'}` })
      } else {
        // O medico ve o que foi para a Memed e o que ficou de fora. Sem este
        // aviso, uma alergia nao reconhecida sumiria calada - e ele acharia
        // que o alerta esta cobrindo.
        const avisoDosDados = avisoDoQueFoiParaMemed(dados, alergias, alergiasEnviadas)
        if (avisoDosDados) setAviso(avisoDosDados)
      }
    } catch (causa) {
      setAviso({
        tipo: 'erro',
        texto: causa instanceof Error ? causa.message : 'Não foi possível abrir a prescrição.',
      })
    } finally {
      setPrescrevendo(false)
    }
  }

  /**
   * Leva os itens da receita da Memed para o campo "Prescrição" da consulta.
   *
   * A receita ja fica arquivada a parte, com link; mas o medico espera ler o
   * que prescreveu no proprio texto do atendimento, e e esse texto que sai na
   * impressao e vai para a assinatura. Copia so o que ainda nao esta la, e
   * nunca mexe em consulta assinada: o PDF assinado e o que vale.
   *
   * Esta funcao roda dentro do evento da Memed, que guarda a tela do momento
   * em que a prescricao abriu. Por isso nada aqui confia no que veio junto:
   * a consulta e relida do banco e o formulario e lido pelos refs. Ate
   * 23/09/2026 a segunda receita da mesma consulta partia do texto antigo e
   * apagava a primeira (ver receita-no-texto.ts).
   */
  function copiarReceitaParaPrescricao(consultation: Consultation | null, lista: Receita[]) {
    // Em fila: duas receitas emitidas em sequencia nao podem ler o mesmo texto
    // de partida e gravar uma por cima da outra.
    filaDaReceita.current = filaDaReceita.current
      .catch(() => undefined)
      .then(() => copiarReceitaAgora(consultation, lista))
    return filaDaReceita.current
  }

  async function copiarReceitaAgora(consultation: Consultation | null, lista: Receita[]) {
    if (!patient || !consultation) return
    const daConsulta = lista.filter((r) => r.consultationId === consultation.id && !r.excluidaEm)
    if (daConsulta.length === 0) return

    const fresca = (await listConsultations(patient.id)).find((c) => c.id === consultation.id)
    if (!fresca || fresca.assinadoEm) return

    const editando = editandoRef.current === consultation.id
    const atual = editando ? formRef.current.prescricao : fresca.prescricao
    const texto = acrescentarReceitas(atual, daConsulta)
    if (texto === null) return

    if (editando) set('prescricao', texto)
    await updateConsultation(patient.id, consultation.id, {
      ...consultationToDraft(fresca),
      prescricao: texto,
    })
    await load(patient.id)
  }

  /**
   * Prescrever de dentro do formulario, com a consulta aberta.
   *
   * A receita precisa se pendurar num atendimento que ja existe no banco. Numa
   * consulta ainda nao salva ela ficaria solta, ligada so ao paciente - e daqui
   * a um ano ninguem saberia dizer de qual atendimento ela saiu. Melhor pedir
   * para salvar antes, numa frase, do que guardar uma receita orfa.
   */
  async function prescreverDoFormulario() {
    if (!editingConsultationId) {
      setAviso({
        tipo: 'erro',
        texto: 'Salve a consulta antes de prescrever. Assim a receita fica ligada a este atendimento.',
      })
      return
    }
    const consulta = consultations.find((item) => item.id === editingConsultationId) ?? null
    await prescrever(consulta)
  }

  /**
   * Manda o medico autorizar no VIDaaS.
   *
   * A ida e por troca de endereco, e nao por janela nova: bloqueador de pop-up
   * mataria a assinatura em silencio, e no celular a aba extra se perde.
   */
  async function pedirAssinatura(consultation: Consultation) {
    setAviso(null)
    setAssinando(consultation.id)
    // A aba e aberta AGORA, dentro do clique, e recebe o endereco depois: o
    // bloqueador de pop-up so deixa abrir janela em resposta direta a um clique,
    // e a resposta da BRy chega tarde demais para isso. Se mesmo assim a aba
    // nao abrir, o link fica no painel de espera para o medico clicar.
    const aba = window.open('', '_blank')
    try {
      // O endereco de volta leva o paciente para que, se o VIDaaS devolver o
      // navegador para ca, o sistema reabra este mesmo prontuario.
      const volta = new URL(window.location.href)
      volta.searchParams.set('paciente', consultation.patientId)
      const inicio = await iniciarAssinatura(consultation.id, volta.toString())
      if (inicio.recuperado) {
        aba?.close()
        setAssinando(null)
        setAssinaturaConcluida((n) => n + 1)
        setAviso({ tipo: 'ok', texto: 'Atendimento assinado e arquivado.' })
        return
      }
      if (inicio.sessaoAtiva) {
        // Turno ja aprovado: assina agora, sem aba e sem celular.
        aba?.close()
        const resultado = await concluirAssinatura(inicio.pedido)
        if (resultado.situacao === 'assinado') {
          setAssinando(null)
          setAssinaturaConcluida((n) => n + 1)
          setAviso({ tipo: 'ok', texto: 'Atendimento assinado e arquivado.' })
          return
        }
        // Raro: a BRy diz que a sessao ja nao esta pronta. Entra na espera
        // normal, que vai avisar se nao resolver.
        setEspera({
          pedido: inicio.pedido,
          consultaId: consultation.id,
          autorizarEm: '',
          expiraEm: Date.now() + 2 * 60 * 1000,
          tentativas: 0,
          minutosRestantes: 2,
        })
        return
      }

      const { pedido, autorizarEm, expiraEm } = inicio
      if (aba) aba.location.href = autorizarEm
      setEspera({
        pedido,
        consultaId: consultation.id,
        autorizarEm,
        expiraEm: expiraEm ? new Date(expiraEm).getTime() : Date.now() + 15 * 60 * 1000,
        tentativas: 0,
        minutosRestantes: 15,
      })
    } catch (causa) {
      aba?.close()
      setAssinando(null)
      setAviso({
        tipo: 'erro',
        texto: causa instanceof Error ? causa.message : 'Não foi possível pedir a autorização.',
      })
    }
  }

  function desistirDaAssinatura() {
    setEspera(null)
    setAssinando(null)
  }

  async function abrirAssinado(consultation: Consultation) {
    if (!consultation.arquivoAssinado) return
    try {
      window.open(await linkDoAtendimentoAssinado(consultation.arquivoAssinado), '_blank')
    } catch (causa) {
      setAviso({
        tipo: 'erro',
        texto: causa instanceof Error ? causa.message : 'Não foi possível abrir o documento.',
      })
    }
  }

  // Sair do formulario apaga o campo ativo. Sem isto a barra continuaria
  // anunciando "Formatando: Exame físico" de um campo que nem esta mais na tela.
  useEffect(() => {
    if (mode !== 'form') setCampoAtivo(null)
  }, [mode])

  async function salvarModelo(campo: string, titulo: string, texto: string) {
    if (!clinicId) return
    const criado = await createNoteTemplate(clinicId, campo, titulo, texto)
    setModelos((atuais) => [...atuais, criado].sort((a, b) => a.titulo.localeCompare(b.titulo)))
  }

  async function reconferirIntegridade() {
    if (!clinicId) return
    setConferindo(true)
    try {
      setIntegridade(await conferirIntegridade(clinicId))
    } finally {
      setConferindo(false)
    }
  }

  async function apagarModelo(id: string) {
    await archiveNoteTemplate(id)
    setModelos((atuais) => atuais.filter((m) => m.id !== id))
  }

  // Busca em todos os campos de texto da consulta, sem acento e sem marcacao,
  // para "sinusite" achar tanto "Sinusite" quanto "<b>sinusite</b>".
  const consultasFiltradas = (() => {
    const termo = buscaConsulta
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
    if (!termo) return consultations
    return consultations.filter((consulta) =>
      [
        consulta.queixa,
        consulta.historiaEvolucao,
        consulta.antecedentesPessoais,
        consulta.antecedentesFamiliares,
        consulta.alergias,
        consulta.medicamentos,
        consulta.exameFisico,
        consulta.avaliacao,
        consulta.conduta,
        consulta.prescricao,
        consulta.retorno,
        consulta.observacoes,
        consulta.cid,
        consulta.unidade,
      ]
        .map(textoSimples)
        .join(' ')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .includes(termo),
    )
  })()
  const [form, setForm] = useState<ConsultationDraft>(() => emptyConsultation(patient, unidadesDaClinica[0]))
  const [editingConsultationId, setEditingConsultationId] = useState<string | null>(null)
  // O que veio das consultas anteriores ao abrir o formulario (ver
  // continuidade-da-consulta.ts), para a tela mostrar e poder desfazer.
  const [heranca, setHeranca] = useState<Heranca[]>([])
  // Rascunho guardado de uma sessao anterior, esperando o medico decidir.
  const [rascunhoPendente, setRascunhoPendente] = useState<Rascunho | null>(null)
  const [estadoDoRascunho, setEstadoDoRascunho] = useState<{ tipo: 'salvo' | 'erro'; texto: string } | null>(null)
  const telaLarga = useTelaLarga()
  // O formulario como abriu: so vale gravar rascunho do que mudou depois disso.
  const baseDoFormulario = useRef('')
  // Cada abertura do formulario ganha um numero; resposta atrasada de uma
  // abertura antiga nao pode mexer na atual.
  const sessaoDoFormulario = useRef(0)
  // O ultimo salvamento de rascunho em andamento: salvar a consulta espera
  // por ele antes de apagar o rascunho, senao ele renasceria logo depois.
  const rascunhoEmVoo = useRef<Promise<unknown> | null>(null)
  // Prontuario aberto direto no formulario: a heranca precisa da lista, que
  // ainda nao chegou. O load aplica quando chegar.
  const formNovoPendente = useRef(false)
  // Copias sempre atuais do formulario, para o evento da Memed (que guarda a
  // tela do momento em que abriu) ler o que esta na tela AGORA.
  const formRef = useRef(form)
  const editandoRef = useRef(editingConsultationId)
  const filaDaReceita = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    formRef.current = form
    editandoRef.current = editingConsultationId
  }, [form, editingConsultationId])
  const consultaEmEdicaoAssinada = Boolean(
    editingConsultationId &&
      consultations.find((item) => item.id === editingConsultationId)?.assinadoEm,
  )
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  // Guardado no navegador de quem usa: o tamanho e preferencia de pessoa, nao
  // configuracao da clinica. Lido uma vez, na primeira renderizacao.
  const [escalaDoTexto, setEscalaDoTexto] = useState<number>(lerEscalaSalva)
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')
  const loadSequence = useRef(0)

  async function load(patientId: string) {
    const sequence = ++loadSequence.current
    setLoading(true)
    setLoadError('')
    try {
      const result = await listConsultations(patientId)
      if (sequence !== loadSequence.current) return
      const ordenadas = [...result].sort((a, b) => {
        const byDate = b.data.localeCompare(a.data)
        return byDate || b.criadoEm.localeCompare(a.criadoEm)
      })
      setConsultations(ordenadas)
      if (formNovoPendente.current) {
        formNovoPendente.current = false
        prepararFormulario(emptyConsultation(patient, unidadesDaClinica[0]), null, true, ordenadas, true)
      }
    } catch (cause) {
      if (sequence !== loadSequence.current) return
      setLoadError(cause instanceof Error ? cause.message : 'Não foi possível carregar o prontuário.')
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (!open || !patient) return
    setMode(startInConsultationForm ? 'form' : 'history')
    setForm(emptyConsultation(patient, unidadesDaClinica[0]))
    setEditingConsultationId(null)
    setFormError('')
    setHeranca([])
    setRascunhoPendente(null)
    setEstadoDoRascunho(null)
    setPainel('consultas')
    setRetornoAberto(null)
    formNovoPendente.current = startInConsultationForm
    void load(patient.id)

    return () => {
      loadSequence.current += 1
    }
    // A troca do paciente deve reiniciar integralmente o painel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patient?.id, startInConsultationForm])

  function set<K extends keyof ConsultationDraft>(key: K, value: ConsultationDraft[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  /**
   * Abre o formulario: aplica a heranca das consultas anteriores (quando e
   * atendimento novo ou ainda em branco) e procura rascunho nao salvo.
   */
  function prepararFormulario(
    inicial: ConsultationDraft,
    consultaId: string | null,
    podeHerdar: boolean,
    lista: Consultation[],
    comRascunho: boolean,
  ) {
    const sessao = ++sessaoDoFormulario.current
    let formulario = inicial
    let aplicada: Heranca[] = []
    if (podeHerdar) {
      const resultado = aplicarHeranca(inicial, herancaDasAnteriores(lista, consultaId, hojeEmSaoPaulo()))
      formulario = resultado.formulario
      aplicada = resultado.aplicada
    }
    setForm(formulario)
    setHeranca(aplicada)
    setRascunhoPendente(null)
    setEstadoDoRascunho(null)
    baseDoFormulario.current = JSON.stringify(formulario)

    if (!patient || !comRascunho) return
    void lerRascunho(patient.id, alvoDoRascunho(consultaId))
      .then((rascunho) => {
        if (sessao !== sessaoDoFormulario.current || !rascunho) return
        // Rascunho igual ao que ja esta na tela nao e decisao a tomar.
        if (JSON.stringify(camposDoRascunho(rascunho.conteudo, formulario)) === JSON.stringify(formulario)) return
        setRascunhoPendente(rascunho)
      })
      .catch((causa) => {
        if (sessao !== sessaoDoFormulario.current) return
        setEstadoDoRascunho({
          tipo: 'erro',
          texto: `Rascunho automático indisponível: ${causa instanceof Error ? causa.message : 'falha'}`,
        })
      })
  }

  function startNewConsultation() {
    prepararFormulario(emptyConsultation(patient, unidadesDaClinica[0]), null, true, consultations, true)
    setEditingConsultationId(null)
    setFormError('')
    setMode('form')
  }

  function startEditingConsultation(consultation: Consultation) {
    const estado = estadoDaConsulta(consultation)
    // Heranca so no atendimento ainda em branco (marcado pela Agenda): num
    // atendimento ja escrito, campo vazio e escolha do medico. Assinado nao tem
    // rascunho - nao ha o que editar.
    prepararFormulario(
      consultationToDraft(consultation),
      consultation.id,
      estado === 'agendada' || estado === 'sem-registro',
      consultations,
      !consultation.assinadoEm,
    )
    setEditingConsultationId(consultation.id)
    setFormError('')
    setMode('form')
  }

  function backToHistory() {
    if (saving) return
    // O rascunho fica guardado: Cancelar sem querer nao pode custar o texto.
    // Ele e oferecido de novo na proxima vez que esta consulta abrir.
    sessaoDoFormulario.current += 1
    setEditingConsultationId(null)
    setFormError('')
    setHeranca([])
    setRascunhoPendente(null)
    setEstadoDoRascunho(null)
    setMode('history')
  }

  function recuperarRascunho() {
    if (!rascunhoPendente) return
    setForm((atual) => camposDoRascunho(rascunhoPendente.conteudo, atual))
    setHeranca([])
    setRascunhoPendente(null)
  }

  function descartarRascunho() {
    if (!patient) return
    const alvo = alvoDoRascunho(editingConsultationId)
    setRascunhoPendente(null)
    void apagarRascunho(patient.id, alvo).catch((causa) => {
      setEstadoDoRascunho({
        tipo: 'erro',
        texto: `Não consegui descartar o rascunho: ${causa instanceof Error ? causa.message : 'falha'}`,
      })
    })
  }

  /**
   * Rascunho automatico: 2,5 s depois da ultima tecla, grava no banco. So
   * quando algo mudou desde que o formulario abriu, e nunca enquanto ha um
   * rascunho antigo esperando decisao - gravar agora apagaria o antigo.
   */
  const pacienteDoFormulario = patient?.id ?? null
  useEffect(() => {
    if (mode !== 'form' || !pacienteDoFormulario || !clinicId) return
    if (consultaEmEdicaoAssinada || rascunhoPendente) return
    if (JSON.stringify(form) === baseDoFormulario.current) return
    const alvo = alvoDoRascunho(editingConsultationId)
    const clinica = clinicId
    const sessao = sessaoDoFormulario.current
    const temporizador = window.setTimeout(() => {
      const envio = salvarRascunho(clinica, pacienteDoFormulario, alvo, { ...form })
      rascunhoEmVoo.current = envio
      envio
        .then((hora) => {
          if (sessao !== sessaoDoFormulario.current) return
          setEstadoDoRascunho({ tipo: 'salvo', texto: `Rascunho salvo às ${horaCurta(hora)}` })
        })
        .catch((causa) => {
          if (sessao !== sessaoDoFormulario.current) return
          setEstadoDoRascunho({
            tipo: 'erro',
            texto: `Rascunho NÃO salvo: ${causa instanceof Error ? causa.message : 'falha'}. Salve a consulta assim que puder.`,
          })
        })
    }, 2500)
    return () => window.clearTimeout(temporizador)
  }, [form, mode, pacienteDoFormulario, clinicId, editingConsultationId, consultaEmEdicaoAssinada, rascunhoPendente])

  async function save() {
    if (!patient) return
    if (!form.data || Number.isNaN(new Date(`${form.data}T12:00:00`).getTime())) {
      setFormError('Informe uma data válida para a consulta.')
      return
    }

    const clinicalSummary = [form.queixa, form.historiaEvolucao, form.avaliacao, form.conduta]
    if (!clinicalSummary.some((value) => value.trim())) {
      setFormError('Preencha ao menos a queixa, evolução, avaliação ou conduta.')
      return
    }

    setSaving(true)
    setFormError('')
    try {
      const draft = Object.fromEntries(
        Object.entries(form).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]),
      ) as unknown as ConsultationDraft
      if (editingConsultationId) {
        await updateConsultation(patient.id, editingConsultationId, draft)
      } else {
        await addConsultation(patient.id, draft)
      }
      // Consulta salva: o rascunho perdeu a razao de existir. Espera o
      // salvamento que estiver no ar, senao ele recriaria o rascunho depois.
      const alvo = alvoDoRascunho(editingConsultationId)
      sessaoDoFormulario.current += 1
      await rascunhoEmVoo.current?.catch(() => undefined)
      void apagarRascunho(patient.id, alvo).catch((causa) => {
        console.warn('Consulta salva, mas o rascunho ficou para tras', causa)
      })
      setMode('history')
      setEditingConsultationId(null)
      setHeranca([])
      setRascunhoPendente(null)
      setEstadoDoRascunho(null)
      setForm(emptyConsultation(patient, unidadesDaClinica[0]))
      await load(patient.id)
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Não foi possível salvar esta consulta.')
    } finally {
      setSaving(false)
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      loadSequence.current += 1
      setMode('history')
      setEditingConsultationId(null)
      setFormError('')
      setLoadError('')
    }
    onOpenChange(nextOpen)
  }

  // Consulta em duas colunas (14/10/2026). No notebook, o paciente, a barra de
  // "Nova consulta", a de formatacao e o recado da recepcao comiam metade da
  // altura antes do primeiro campo, e a metade direita da tela ficava cinza
  // atras do painel. Em tela larga, o que e fixo vai para uma coluna a
  // esquerda e o formulario ganha a tela toda a direita. No celular e no
  // tablet continua uma coluna so, como antes.
  const duasColunas = telaLarga && !!patient && podeVerProntuario && mode !== 'history'
  const recadoDaRecepcao = (classe: string) =>
    patient?.observacoes.trim() ? (
      <div className={`${classe} rounded-[14px] border border-[#2f7fc1]/25 bg-[#f1f7fd] px-4 py-3`}>
        <p className="text-[9px] font-extrabold uppercase tracking-[0.13em] text-[#1f4f78]">
          Recado da recepção
        </p>
        <p className="mt-1 whitespace-pre-wrap text-[11px] font-semibold leading-relaxed text-[#16456b]">
          {patient.observacoes}
        </p>
      </div>
    ) : null

  // Avisos da consulta (assinada, erro, espera da assinatura, rascunho,
  // heranca). Ficam no topo do formulario numa coluna so; em duas colunas,
  // na coluna fixa da esquerda, onde nao somem quando o medico rola.
  const avisosDaConsulta = () => (
    <>
      {/* Assinada, a consulta e um documento fechado. O banco recusa a
          alteracao de qualquer jeito - o aviso existe para a pessoa
          descobrir isso ANTES de reescrever meia consulta e perder o
          trabalho na hora de salvar. */}
      {consultaEmEdicaoAssinada && (
        <div className="mb-4 flex items-start gap-2 rounded-[14px] border border-[#1c6b3a]/25 bg-[#eef7f1] px-4 py-3">
          <ShieldCheck className="mt-px h-4 w-4 shrink-0 text-[#1c6b3a]" />
          <div className="text-[12px] leading-relaxed text-[#1c6b3a]">
            <p className="font-extrabold">Este atendimento já foi assinado digitalmente.</p>
            <p className="mt-0.5 font-semibold">
              O conteúdo não pode mais ser alterado. Para corrigir ou acrescentar algo,
              volte ao histórico e use "Adicionar adendo" no cartão deste atendimento.
            </p>
          </div>
        </div>
      )}
      {aviso && <AvisoDoProntuario aviso={aviso} onFechar={() => setAviso(null)} />}
      {espera && <EsperaDaAssinatura espera={espera} onDesistir={desistirDaAssinatura} />}
      {rascunhoPendente && (
        <div className="mb-4 rounded-[14px] border border-[#b54708]/25 bg-[#fffaf2] px-4 py-3">
          <p className="text-[12px] font-extrabold text-[#93370d]">
            Há um rascunho não salvo desta consulta, de {dataHoraLocal(rascunhoPendente.atualizadoEm)}.
          </p>
          <p className="mt-0.5 text-[11px] font-semibold text-[#93370d]/80">
            Ele foi guardado sozinho enquanto você escrevia. Recuperar coloca o texto dele no formulário.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={recuperarRascunho}
              className="rounded-xl bg-[#93370d] px-3.5 py-2 text-[11px] font-extrabold text-white"
            >
              Recuperar rascunho
            </button>
            <button
              type="button"
              onClick={descartarRascunho}
              className="rounded-xl border border-[#081b2c]/10 bg-white px-3.5 py-2 text-[11px] font-bold text-slate-500"
            >
              Descartar
            </button>
          </div>
        </div>
      )}
      {heranca.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-[14px] border border-[#2f7fc1]/25 bg-[#f1f7fd] px-4 py-3">
          <div className="flex-1 text-[11px] leading-relaxed text-[#16456b]">
            <p className="font-extrabold">Trazido das consultas anteriores. Confira antes de salvar:</p>
            <p className="mt-0.5 font-semibold">
              {heranca.map((h) => `${ROTULO_DO_CAMPO[h.campo]} (${fmtBR(h.data)})`).join(' · ')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setForm((atual) => desfazerHeranca(atual, heranca))
              setHeranca([])
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-[#1f4f78]/20 bg-white px-3 py-1.5 text-[10px] font-extrabold text-[#1f4f78]"
            title="Apaga o que foi trazido, nos campos que você ainda não mexeu"
          >
            <Undo2 className="h-3.5 w-3.5" /> Desfazer
          </button>
        </div>
      )}
    </>
  )

  return (
    <CampoAtivo.Provider value={{ ativo: campoAtivo, ativar: setCampoAtivo }}>
    <Sheet open={open} onOpenChange={handleOpenChange}>
      {/* Metade da tela como piso: em monitores largos o prontuario vai ate o
          meio do monitor, e nunca fica menor do que os 900px de antes. Na
          consulta em duas colunas, a tela quase toda. */}
      <SheetContent
        side="left"
        className={
          duasColunas
            ? 'grid w-full grid-cols-[minmax(340px,380px)_minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] gap-0 border-r border-[#081b2c]/10 bg-[#fbfaf8] p-0 sm:max-w-[min(1560px,calc(100vw-24px))]'
            : 'w-full gap-0 border-r border-[#081b2c]/10 bg-[#fbfaf8] p-0 sm:max-w-[760px] lg:max-w-[max(900px,50vw)]'
        }
      >
        <SheetHeader
          className={`border-b border-[#081b2c]/[0.07] bg-white px-5 pb-5 pt-6 sm:px-7 ${
            duasColunas ? 'col-start-1 row-start-1 border-r' : ''
          }`}
        >
          <div className="flex items-start gap-3 pr-8">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] bg-[#e7f0ed] text-[#557f75]">
              <FileHeart className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#1f4f78]">
                Prontuário do paciente
              </p>
              <SheetTitle className="mt-1 truncate text-left text-lg font-extrabold tracking-[-0.03em] text-[#081b2c]">
                {patient?.nome || 'Paciente não selecionado'}
              </SheetTitle>
              <SheetDescription className="sr-only">
                Histórico clínico e registro de novas consultas do paciente.
              </SheetDescription>
              {patient && (patient.nascimento || patient.responsavel || patient.telefone || patient.convenio) && (
                <div
                  className={`mt-2 flex-wrap gap-x-3 gap-y-1 text-[9px] font-bold text-slate-400 ${
                    mode === 'history' ? 'hidden' : 'flex'
                  }`}
                >
                  {patient.nascimento && <span>{idade(patient.nascimento)}</span>}
                  {patient.responsavel && (
                    <span className="inline-flex items-center gap-1.5">
                      <UserRound className="h-3 w-3" /> Resp. {patient.responsavel}
                    </span>
                  )}
                  {patient.telefone && (
                    <span className="inline-flex items-center gap-1.5">
                      <MessageCircle className="h-3 w-3" /> {patient.telefone}
                    </span>
                  )}
                  {patient.convenio && (
                    <span className="inline-flex items-center gap-1.5">
                      <Building2 className="h-3 w-3" /> {patient.convenio}
                    </span>
                  )}
                </div>
              )}
              {/* No historico esses dados vivem no painel da esquerda; repetir
                  aqui so ocupava espaco util da tela. */}
              {patient && mode !== 'history' && (
                <button
                  type="button"
                  onClick={() => onEditRegistration(patient)}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-[#081b2c]/10 bg-[#fbfaf8] px-3 py-2 text-[10px] font-extrabold text-slate-500 transition hover:border-[#1f4f78]/30 hover:text-[#1f4f78]"
                >
                  <Edit3 className="h-3.5 w-3.5" /> Editar dados cadastrais
                </button>
              )}
            </div>
          </div>
        </SheetHeader>

        {!patient ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div>
              <UserRound className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-extrabold text-[#081b2c]">Nenhum paciente selecionado</p>
              <p className="mt-1 text-xs text-slate-400">Feche este painel e escolha um paciente.</p>
            </div>
          </div>
        ) : !podeVerProntuario ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div className="max-w-sm">
              <ShieldCheck className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-extrabold text-[#081b2c]">O prontuário é visível só para o médico</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">
                Consultas, receitas e documentos assinados ficam restritos a quem atende. Os dados de
                cadastro você edita pelo botão abaixo.
              </p>
              <button
                type="button"
                onClick={() => onEditRegistration(patient)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-[#081b2c]/10 bg-white px-3 py-2 text-[10px] font-extrabold text-slate-600 transition hover:border-[#1f4f78]/30 hover:text-[#1f4f78]"
              >
                <Edit3 className="h-3.5 w-3.5" /> Editar dados cadastrais
              </button>
            </div>
          </div>
        ) : mode === 'history' ? (
          <>
            <div className="flex flex-col gap-3 border-b border-[#081b2c]/[0.06] bg-[#fbfaf8] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <div>
                <h2 className="text-sm font-extrabold tracking-[-0.02em] text-[#081b2c]">Histórico clínico</h2>
                <p className="mt-1 text-[10px] font-medium text-slate-400">
                  {consultations.length > 0
                    ? `${consultations.length} ${consultations.length === 1 ? 'consulta registrada' : 'consultas registradas'} · mais recentes primeiro`
                    : 'Consultas e evoluções ficam organizadas aqui.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {consultations.length > 0 && (
                  <>
                    {/* Visualizar vem antes de Imprimir porque ler e o que se
                        faz com mais frequencia. E o mesmo documento; a
                        diferenca e a caixa de impressao aparecer ou nao. */}
                    <button
                      type="button"
                      onClick={() => void imprimirProntuario(patient, consultasFiltradas, integridade, false, adendos, clinicId)}
                      className="flex items-center justify-center gap-2 rounded-[14px] border border-[#081b2c]/10 bg-white px-3.5 py-2.5 text-[11px] font-extrabold text-slate-600 transition hover:border-[#081b2c]/25 hover:text-[#081b2c]"
                      title="Abre o prontuário completo em outra aba, sem pedir impressão"
                    >
                      <FileText className="h-3.5 w-3.5" /> Visualizar
                    </button>
                    <button
                      type="button"
                      onClick={() => void imprimirProntuario(patient, consultasFiltradas, integridade, true, adendos, clinicId)}
                      className="flex items-center justify-center gap-2 rounded-[14px] border border-[#081b2c]/10 bg-white px-3.5 py-2.5 text-[11px] font-extrabold text-slate-600 transition hover:border-[#081b2c]/25 hover:text-[#081b2c]"
                      title="Abre a versão para impressão ou para salvar em PDF"
                    >
                      <Printer className="h-3.5 w-3.5" /> Imprimir
                    </button>
                  </>
                )}
                {/* A corrente de auditoria so vale se alguem puder conferi-la.
                    Um selo que ninguem checa e enfeite. */}
                {integridade && (
                  <button
                    type="button"
                    onClick={() => void reconferirIntegridade()}
                    disabled={conferindo}
                    className={`flex items-center justify-center gap-2 rounded-[14px] border px-3.5 py-2.5 text-[11px] font-extrabold transition disabled:cursor-wait ${
                      integridade.quebradoNoId
                        ? 'border-[#b42318]/30 bg-[#fef3f2] text-[#b42318] hover:border-[#b42318]/60'
                        : 'border-[#557f75]/25 bg-[#eef3f2] text-[#557f75] hover:border-[#557f75]/50'
                    }`}
                    title={
                      integridade.quebradoNoId
                        ? `A cadeia de auditoria quebra no registro ${integridade.quebradoNoId}. Algum registro foi alterado fora do sistema.`
                        : `${integridade.encadeados} registros de auditoria conferidos, nenhum alterado. Clique para conferir de novo.`
                    }
                  >
                    {integridade.quebradoNoId ? (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    )}
                    {conferindo
                      ? 'Conferindo...'
                      : integridade.quebradoNoId
                        ? 'Integridade violada'
                        : 'Íntegro'}
                  </button>
                )}
                {integridade && (
                  <Ajuda
                    className="-ml-1 self-center"
                    texto="Cada registro do prontuário recebe uma impressão digital encadeada ao anterior. 'Íntegro' quer dizer que a corrente foi conferida agora e nada foi alterado fora do sistema. Clique no selo para conferir de novo."
                  />
                )}
                <button
                  type="button"
                  onClick={startNewConsultation}
                  className="flex items-center justify-center gap-2 rounded-[14px] bg-[#1f4f78] px-4 py-2.5 text-[11px] font-extrabold text-white shadow-[0_8px_18px_rgba(31,79,120,.22)] transition hover:-translate-y-0.5 hover:bg-[#183f61]"
                >
                  <Plus className="h-3.5 w-3.5" /> Nova consulta
                </button>
              </div>
            </div>

            <div className="scrollbar-subtle flex-1 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
              {/* Duas colunas: o cadastro do paciente fica sempre visivel a
                  esquerda enquanto o medico percorre as consultas a direita.
                  Antes era preciso rolar ate o topo para conferir convenio,
                  idade ou responsavel no meio de uma leitura. */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,270px)_minmax(0,1fr)] lg:items-start">
                <aside className="surface-card rounded-[20px] p-4 lg:sticky lg:top-0">
                  <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#1f4f78]">
                    Dados do paciente
                  </p>
                  <p className="mt-2 text-sm font-extrabold leading-tight text-[#081b2c]">{patient.nome}</p>
                  {/* Nome que veio do contato do WhatsApp, e nao da ficha
                      (18/10/2026, vindo do sistema do Dr. Marcello em
                      25/10/2026). Vermelho, como a alergia, porque receita e
                      atestado saem com este nome. */}
                  {patient.nomeDoContatoEm && (
                    <div
                      role="alert"
                      className="mt-2 flex items-start gap-1.5 rounded-xl border border-[#b42318]/25 bg-[#fceceb] px-2.5 py-2 text-[11px] font-bold leading-snug text-[#b42318]"
                    >
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        {publicoDaClinica(clinicId) === 'geral'
                          ? 'Nome não confirmado: o paciente não informou o nome, e o cadastro usa o nome do contato do WhatsApp (pode ser o de um parente). Confirme e corrija em Editar cadastro.'
                          : 'Nome não confirmado: a família não informou o nome da criança, e o cadastro usa o nome do contato do WhatsApp (pode ser o da mãe ou do pai). Confirme e corrija em Editar cadastro.'}
                      </span>
                    </div>
                  )}

                  <dl className="mt-3 space-y-2">
                    {[
                      { rotulo: 'Idade', valor: patient.nascimento ? idade(patient.nascimento) : '' },
                      { rotulo: 'Nascimento', valor: patient.nascimento ? fmtBR(patient.nascimento) : '' },
                      { rotulo: 'Responsável', valor: patient.responsavel },
                      { rotulo: 'WhatsApp', valor: patient.telefone },
                      { rotulo: 'Convênio', valor: patient.convenio },
                      { rotulo: 'Unidade', valor: patient.unidade },
                      {
                        rotulo: 'Reside em',
                        valor: [patient.bairro, patient.cidade].filter(Boolean).join(', '),
                      },
                      { rotulo: 'CID-10', valor: patient.cid },
                    ]
                      .filter((linha) => linha.valor)
                      .map((linha) => (
                        <div key={linha.rotulo}>
                          <dt className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">
                            {linha.rotulo}
                          </dt>
                          <dd className="text-[11px] font-semibold text-[#081b2c]">{linha.valor}</dd>
                        </div>
                      ))}
                  </dl>

                  <button
                    type="button"
                    onClick={() => onEditRegistration(patient)}
                    className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-[#081b2c]/10 bg-[#fbfaf8] px-3 py-2 text-[10px] font-extrabold text-slate-500 transition hover:border-[#1f4f78]/30 hover:text-[#1f4f78]"
                  >
                    <Edit3 className="h-3.5 w-3.5" /> Editar cadastro
                  </button>
                </aside>

                <div className="min-w-0">
              {/* Tres vistas do mesmo paciente (25/09/2026). As consultas
                  continuam sendo a primeira; curva e exames ficam a um clique,
                  sem sair do prontuario. A curva so para menor de idade no
                  otorrino (15/10/2026, ver mostraCurvaDeCrescimento). */}
              <div className="mb-3 flex gap-1 rounded-2xl border border-[#081b2c]/[0.08] bg-white p-1">
                {(
                  [
                    ['consultas', 'Consultas'],
                    ['crescimento', 'Crescimento'],
                    ['exames', 'Exames'],
                  ] as const
                )
                  .filter(([valor]) => valor !== 'crescimento' || mostraCrescimento)
                  .map(([valor, rotulo]) => (
                  <button
                    key={valor}
                    type="button"
                    onClick={() => setPainel(valor)}
                    className={`flex-1 rounded-xl px-3 py-2 text-[11px] font-extrabold transition ${
                      painelVisivel === valor ? 'bg-[#081b2c] text-white' : 'text-slate-500 hover:bg-[#f4f4f1] hover:text-[#081b2c]'
                    }`}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>
              {painelVisivel === 'crescimento' ? (
                <CurvaDeCrescimento
                  nascimento={patient.nascimento}
                  sexo={patient.sexo}
                  consultas={consultations}
                />
              ) : painelVisivel === 'exames' ? (
                <ExamesDoPaciente clinicId={clinicId} patientId={patient.id} />
              ) : loading ? (
                <div className="flex min-h-[280px] items-center justify-center text-center">
                  <div>
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-[#1f4f78]" />
                    <p className="mt-3 text-xs font-bold text-slate-400">Carregando prontuário...</p>
                  </div>
                </div>
              ) : loadError ? (
                <div className="mx-auto max-w-md rounded-[20px] border border-red-100 bg-red-50 px-5 py-6 text-center">
                  <HeartPulse className="mx-auto h-7 w-7 text-red-400" />
                  <p className="mt-3 text-xs font-extrabold text-red-700">Não foi possível abrir o prontuário</p>
                  <p className="mt-1.5 text-[10px] leading-relaxed text-red-500">{loadError}</p>
                  <button
                    type="button"
                    onClick={() => void load(patient.id)}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-[10px] font-extrabold text-red-600 shadow-sm"
                  >
                    <RefreshCw className="h-3 w-3" /> Tentar novamente
                  </button>
                </div>
              ) : consultations.length === 0 ? (
                <div className="flex min-h-[320px] items-center justify-center text-center">
                  <div className="max-w-sm">
                    <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-[20px] bg-[#dceaf7] text-[#1f4f78]">
                      <ClipboardList className="h-7 w-7" />
                    </span>
                    <h2 className="mt-4 text-sm font-extrabold text-[#081b2c]">Prontuário pronto para começar</h2>
                    <p className="mt-2 text-xs leading-relaxed text-slate-400">
                      Registre a primeira consulta para criar a linha do tempo clínica deste paciente.
                    </p>
                    <button
                      type="button"
                      onClick={startNewConsultation}
                      className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#081b2c] px-4 py-2.5 text-[10px] font-extrabold text-white"
                    >
                      <Plus className="h-3.5 w-3.5 text-[#6aa8d9]" /> Registrar primeira consulta
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="relative mb-3">
                    <Search className="absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      value={buscaConsulta}
                      onChange={(evento) => setBuscaConsulta(evento.target.value)}
                      placeholder="Buscar no prontuário: sintoma, medicamento, CID..."
                      className="w-full rounded-2xl border border-[#081b2c]/[0.08] bg-white py-2.5 pl-10 pr-4 text-[13px] font-medium text-[#081b2c] outline-none transition placeholder:text-slate-400 focus:border-[#2f7fc1]/60 focus:ring-4 focus:ring-[#2f7fc1]/10"
                    />
                  </div>

                  {/* O resultado da assinatura chega depois de o navegador ir
                      ao VIDaaS e voltar - sem este aviso, o medico voltaria
                      para uma tela igual a que deixou e nao saberia se deu
                      certo. */}
                  {aviso && <AvisoDoProntuario aviso={aviso} onFechar={() => setAviso(null)} />}
                  {espera && <EsperaDaAssinatura espera={espera} onDesistir={desistirDaAssinatura} />}

                  {consultasFiltradas.length === 0 ? (
                    <p className="py-10 text-center text-[13px] font-semibold text-slate-400">
                      Nenhuma consulta menciona "{buscaConsulta}".
                    </p>
                  ) : (
                    <>
                    {/* Setas para andar pelas consultas uma a uma. Abre a
                        vizinha e rola ate ela; o cartao aberto e a posicao no
                        historico ficam sempre visiveis. So aparece quando ha
                        mais de uma consulta - com uma, nao ha para onde ir. */}
                    {consultasFiltradas.length > 1 && (() => {
                      const indice = consultasFiltradas.findIndex((c) => c.id === consultaAberta)
                      const irPara = (destino: number) => {
                        const alvo = consultasFiltradas[destino]
                        if (!alvo) return
                        setConsultaAberta(alvo.id)
                        window.setTimeout(() => {
                          document.getElementById(`consulta-${alvo.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                        }, 60)
                      }
                      const temAnterior = indice === -1 || indice > 0
                      const temProxima = indice < consultasFiltradas.length - 1
                      return (
                        <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-[#081b2c]/[0.08] bg-white px-3 py-2">
                          <button
                            type="button"
                            onClick={() => irPara(indice === -1 ? 0 : indice - 1)}
                            disabled={!temAnterior}
                            className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-extrabold text-slate-600 transition hover:bg-[#f4f4f1] hover:text-[#081b2c] disabled:opacity-30"
                            title="Consulta mais recente"
                          >
                            <ChevronLeft className="h-4 w-4" /> Mais recente
                          </button>
                          <span className="text-[11px] font-bold text-slate-500">
                            {indice === -1
                              ? `${consultasFiltradas.length} consultas`
                              : `Consulta ${indice + 1} de ${consultasFiltradas.length} · ${fmtBR(consultasFiltradas[indice].data)}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => irPara(indice === -1 ? 0 : indice + 1)}
                            disabled={indice !== -1 && !temProxima}
                            className="inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-extrabold text-slate-600 transition hover:bg-[#f4f4f1] hover:text-[#081b2c] disabled:opacity-30"
                            title="Consulta mais antiga"
                          >
                            Mais antiga <ChevronRight className="h-4 w-4" />
                          </button>
                        </div>
                      )
                    })()}
                    <Accordion
                      type="single"
                      collapsible
                      className="space-y-3"
                      value={consultaAberta}
                      onValueChange={setConsultaAberta}
                    >
                      {consultasFiltradas.map((consultation) => (
                        <ConsultationCard
                          key={consultation.id}
                          consultation={consultation}
                          // A lista vem da mais recente para a mais antiga,
                          // entao a anterior no tempo e a proxima na lista.
                          anterior={
                            consultations[
                              consultations.findIndex((item) => item.id === consultation.id) + 1
                            ]
                          }
                          onEdit={startEditingConsultation}
                          onAssinar={(item) => void pedirAssinatura(item)}
                          onAbrirAssinado={(item) => void abrirAssinado(item)}
                          onPrescrever={(item) => void prescrever(item)}
                          onImprimir={(item) => void imprimirProntuario(patient, [item], integridade, true, adendos, clinicId)}
                          prescrevendo={prescrevendo}
                          receitas={receitas.filter((r) => r.consultationId === consultation.id)}
                          assinando={assinando}
                          clinicId={clinicId}
                          adendos={adendos.filter((a) => a.consultationId === consultation.id)}
                          erroDosAdendos={erroDosAdendos}
                          onAdendoRegistrado={() => {
                            if (clinicId) void carregarAdendos(clinicId, patient.id)
                            setAviso({ tipo: 'ok', texto: 'Adendo registrado no prontuário.' })
                          }}
                          retornoAberto={retornoAberto === consultation.id}
                          onAbrirRetorno={(item) => setRetornoAberto(item.id)}
                          onFecharRetorno={() => setRetornoAberto(null)}
                          onRetornoMarcado={(mensagem) => {
                            setRetornoAberto(null)
                            setAviso({ tipo: 'ok', texto: mensagem })
                          }}
                        />
                      ))}
                    </Accordion>
                    </>
                  )}
                </>
              )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Coluna da esquerda, em tela larga: o que fica parado enquanto o
                formulario rola. Em tela estreita, `contents` desfaz a caixa e
                tudo volta ao fluxo de uma coluna, como era antes. */}
            <div
              className={
                duasColunas
                  ? 'scrollbar-subtle col-start-1 row-start-2 flex min-h-0 flex-col overflow-y-auto border-r border-[#081b2c]/[0.07] bg-[#f6f4ef]'
                  : 'contents'
              }
            >
            <div className="flex items-center gap-3 border-b border-[#081b2c]/[0.06] bg-[#fbfaf8] px-5 py-4 sm:px-7">
              <button
                type="button"
                onClick={backToHistory}
                disabled={saving}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#081b2c]/10 bg-white text-slate-500 transition hover:text-[#1f4f78] disabled:opacity-50"
                aria-label="Voltar ao histórico"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div>
                <h2 className="text-sm font-extrabold tracking-[-0.02em] text-[#081b2c]">
                  {editingConsultationId ? 'Editar consulta' : 'Nova consulta'}
                </h2>
                <p className="mt-1 text-[10px] font-medium text-slate-400">
                  {editingConsultationId
                    ? 'Atualize o registro clínico e salve as alterações.'
                    : 'Registre a evolução clínica com segurança e clareza.'}
                </p>
                {/* Rascunho salvo em cinza discreto; falha em vermelho, porque
                    o medico precisa saber que o texto so existe na tela. */}
                {estadoDoRascunho && (
                  <p
                    className={`mt-1 text-[10px] font-bold ${
                      estadoDoRascunho.tipo === 'erro' ? 'text-[#b42318]' : 'text-[#557f75]'
                    }`}
                  >
                    {estadoDoRascunho.texto}
                  </p>
                )}
              </div>
              <TamanhoDoTexto
                escala={escalaDoTexto}
                onMudar={(valor) => {
                  setEscalaDoTexto(valor)
                  window.localStorage.setItem(CHAVE_DA_ESCALA, String(valor))
                }}
              />
            </div>
            {duasColunas && (
              <div className="space-y-3 px-5 py-4">
                <BarraDeFormatacao lateral />
                {avisosDaConsulta()}
                {recadoDaRecepcao('')}
              </div>
            )}
            </div>

            {/* Coluna da direita, em tela larga: so o formulario, rolando, e o
                botao de salvar embaixo. */}
            <div className={duasColunas ? 'col-start-2 row-span-2 row-start-1 flex min-h-0 flex-col' : 'contents'}>
            {/* `zoom` em vez de mexer no tamanho de cada texto: cresce rotulo,
                letra digitada, caixa e botao na mesma proporcao, e o formulario
                continua alinhado. */}
            <div
              className={`scrollbar-subtle flex-1 overflow-y-auto px-5 pb-6 sm:px-7 ${duasColunas ? 'pt-6' : 'pt-2'}`}
              style={{ zoom: escalaDoTexto }}
            >
              {!duasColunas && <BarraDeFormatacao />}
              {!duasColunas && avisosDaConsulta()}
              <div className="grid gap-4 sm:grid-cols-2">
                <SectionTitle>Atendimento</SectionTitle>
                {/* O recado da recepcao aparece aqui de proposito, e so para
                    ler. Enquanto os dois textos eram a mesma coluna, escrever a
                    observacao clinica apagava este aviso. Mostrar em vez de
                    esconder tambem tira o motivo de alguem usar o campo errado. */}
                {!duasColunas && recadoDaRecepcao('sm:col-span-2')}
                <Field label="Data da consulta" required>
                  <input
                    type="date"
                    className={inputClass}
                    value={form.data}
                    onChange={(event) => set('data', event.target.value)}
                  />
                </Field>
                <Field label="Tipo de atendimento">
                  <select
                    className={inputClass}
                    value={form.tipo}
                    onChange={(event) => set('tipo', event.target.value as ConsultationType)}
                  >
                    {Object.entries(consultationLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Unidade" className="sm:col-span-2">
                  <select className={inputClass} value={form.unidade} onChange={(event) => set('unidade', event.target.value)}>
                    {opcoesDeUnidade(unidadesDaClinica, form.unidade).map((unidade) => (
                      <option key={unidade} value={unidade}>
                        {unidade}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Peso (kg)">
                  <input
                    className={inputClass}
                    value={form.peso}
                    onChange={(event) => set('peso', event.target.value)}
                    inputMode="decimal"
                    placeholder="Ex.: 24,5"
                  />
                </Field>
                <Field label="Altura (cm)">
                  <input
                    className={inputClass}
                    value={form.altura}
                    onChange={(event) => set('altura', event.target.value)}
                    inputMode="decimal"
                    placeholder="Ex.: 128"
                  />
                </Field>

                <SectionTitle>Motivo e evolução</SectionTitle>
                <RichTextField
                  label="Queixa principal"
                  value={form.queixa}
                  onChange={(value) => set('queixa', value)}
                  campo="queixa"
                  modelos={modelos}
                  onSalvarModelo={salvarModelo}
                  onApagarModelo={apagarModelo}
                  placeholder="Motivo principal desta consulta..."
                />
                <RichTextField
                  label="História / evolução"
                  value={form.historiaEvolucao}
                  onChange={(value) => set('historiaEvolucao', value)}
                  campo="historiaEvolucao"
                  modelos={modelos}
                  onSalvarModelo={salvarModelo}
                  onApagarModelo={apagarModelo}
                  placeholder="Início, duração, sintomas e evolução..."
                />

                <SectionTitle>Antecedentes</SectionTitle>
                <RichTextField
                  label="Antecedentes pessoais"
                  value={form.antecedentesPessoais}
                  onChange={(value) => set('antecedentesPessoais', value)}
                  campo="antecedentesPessoais"
                  modelos={modelos}
                  onSalvarModelo={salvarModelo}
                  onApagarModelo={apagarModelo}
                  placeholder="Condições, cirurgias e internações..."
                />
                <RichTextField
                  label="Antecedentes familiares"
                  value={form.antecedentesFamiliares}
                  onChange={(value) => set('antecedentesFamiliares', value)}
                  campo="antecedentesFamiliares"
                  modelos={modelos}
                  onSalvarModelo={salvarModelo}
                  onApagarModelo={apagarModelo}
                  placeholder="Histórico familiar relevante..."
                />
                <RichTextField
                  label="Alergias"
                  value={form.alergias}
                  onChange={(value) => set('alergias', value)}
                  campo="alergias"
                  modelos={modelos}
                  onSalvarModelo={salvarModelo}
                  onApagarModelo={apagarModelo}
                  placeholder="Medicamentos, alimentos ou outras alergias..."
                />
                <RichTextField
                  label="Medicamentos em uso"
                  value={form.medicamentos}
                  onChange={(value) => set('medicamentos', value)}
                  campo="medicamentos"
                  modelos={modelos}
                  onSalvarModelo={salvarModelo}
                  onApagarModelo={apagarModelo}
                  placeholder="Nome, dose e frequência..."
                />

                <SectionTitle>Exame e avaliação</SectionTitle>
                <RichTextField
                  label="Exame físico"
                  value={form.exameFisico}
                  onChange={(value) => set('exameFisico', value)}
                  campo="exameFisico"
                  modelos={modelos}
                  onSalvarModelo={salvarModelo}
                  onApagarModelo={apagarModelo}
                  placeholder="Achados do exame físico..."
                />
                <RichTextField
                  label="Avaliação / hipótese diagnóstica"
                  value={form.avaliacao}
                  onChange={(value) => set('avaliacao', value)}
                  campo="avaliacao"
                  modelos={modelos}
                  onSalvarModelo={salvarModelo}
                  onApagarModelo={apagarModelo}
                  placeholder="Impressão clínica e hipóteses..."
                />
                <Field label="CID-10" className="sm:col-span-2">
                  <input
                    className={inputClass}
                    value={form.cid}
                    onChange={(event) => set('cid', event.target.value)}
                    placeholder="Ex.: J34.2"
                  />
                </Field>

                <SectionTitle>Plano de cuidado</SectionTitle>
                <RichTextField
                  label="Conduta"
                  value={form.conduta}
                  onChange={(value) => set('conduta', value)}
                  campo="conduta"
                  modelos={modelos}
                  onSalvarModelo={salvarModelo}
                  onApagarModelo={apagarModelo}
                  placeholder="Orientações, exames e encaminhamentos..."
                />
                <RichTextField
                  label="Prescrição"
                  value={form.prescricao}
                  onChange={(value) => set('prescricao', value)}
                  campo="prescricao"
                  modelos={modelos}
                  onSalvarModelo={salvarModelo}
                  onApagarModelo={apagarModelo}
                  placeholder="Orientações e o que não sai em receita. A receita formal é emitida pela Memed."
                />
                {/* O botao vive ao lado do campo porque e onde o medico esta
                    pensando em medicamento. O campo de texto continua para o
                    que nao e receita - orientacao, dieta, "manter o que usa";
                    a receita formal nasce na Memed e volta para ca com link e
                    itens, para o prontuario nao ter duas versoes do mesmo. */}
                <div className="-mt-1 sm:col-start-2">
                  <button
                    type="button"
                    onClick={() => void prescreverDoFormulario()}
                    disabled={prescrevendo}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#2563eb]/20 bg-[#eef3fd] px-3.5 py-2.5 text-[11px] font-extrabold text-[#1d4ed8] transition hover:bg-[#e2eafb] disabled:cursor-wait disabled:opacity-70"
                  >
                    {prescrevendo ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Pill className="h-4 w-4" />
                    )}
                    Prescrever pela Memed
                  </button>
                </div>
                <RichTextField
                  label="Retorno"
                  value={form.retorno}
                  onChange={(value) => set('retorno', value)}
                  campo="retorno"
                  modelos={modelos}
                  onSalvarModelo={salvarModelo}
                  onApagarModelo={apagarModelo}
                  placeholder="Prazo e condições para retorno..."
                />
                <RichTextField
                  label="Observações clínicas"
                  value={form.observacoes}
                  onChange={(value) => set('observacoes', value)}
                  campo="observacoes"
                  modelos={modelos}
                  onSalvarModelo={salvarModelo}
                  onApagarModelo={apagarModelo}
                  placeholder="Informações complementares deste atendimento..."
                />
              </div>

              <p className="mt-5 rounded-[14px] bg-[#eef3f2] px-4 py-3 text-[10px] font-semibold leading-relaxed text-[#557f75]">
                Preencha pelo menos um destes campos: queixa principal, história/evolução, avaliação ou conduta.
              </p>

              {formError && (
                <p className="mt-3 rounded-[14px] border border-red-100 bg-red-50 px-4 py-3 text-[11px] font-bold text-red-600">
                  {formError}
                </p>
              )}
            </div>

            <div className="flex gap-2 border-t border-[#081b2c]/[0.07] bg-white px-5 py-4 sm:px-7">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="flex flex-1 items-center justify-center gap-2 rounded-[14px] bg-[#081b2c] px-5 py-3 text-xs font-extrabold text-white shadow-[0_10px_22px_rgba(8,27,44,.16)] transition hover:bg-[#102d47] disabled:cursor-wait disabled:opacity-70"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 text-[#6aa8d9]" strokeWidth={3} />}
                {saving
                  ? 'Salvando consulta...'
                  : editingConsultationId
                    ? 'Salvar alterações'
                    : 'Salvar consulta'}
              </button>
              <button
                type="button"
                onClick={backToHistory}
                disabled={saving}
                className="rounded-[14px] border border-[#081b2c]/10 bg-white px-4 py-3 text-xs font-bold text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
    </CampoAtivo.Provider>
  )
}

