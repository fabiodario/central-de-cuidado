import { Fragment, useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  BellRing,
  Bot,
  CalendarCheck2,
  CalendarDays,
  CalendarX2,
  Camera,
  CheckCheck,
  ChevronDown,
  ClipboardList,
  EllipsisVertical,
  Flag,
  Headset,
  List,
  LogOut,
  MessageSquareText,
  Mic,
  Paperclip,
  Phone,
  Play,
  Radar,
  RefreshCw,
  Reply,
  RotateCcw,
  Send,
  Smile,
  Sparkles,
  Square,
  UserPlus,
  Video,
  X,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { isSupabaseConfigured } from '@/lib/supabase'
import logoCentral from '@/assets/logo-central-de-cuidado.webp'
import logoFabio from '@/assets/fabio-logo-fundo-escuro.png'
import iconeFabio from '@/assets/fabio-icone.png'
import { FAMILIAS, IDENTIDADES, type ChaveFamilia, type Identidade } from './dados'
import { agendaValida, copiarAgenda, type AgendaDaClinica } from './agenda'
import { identidadeDoSistema } from './da-clinica'
import { lerClinicaDoLogin, lerModoDoJev } from './ler-clinica'
import { perguntarAoJev } from './jev'
import type { ModoDaSegundaLeitura } from '../../supabase/functions/_shared/segunda-leitura.ts'
import ConfiguracaoDaAgenda from './ConfiguracaoDaAgenda'
import { ROTEIROS, type Roteiro } from './roteiros'
import { ETAPAS, MOTIVOS, Simulacao, type Alerta, type Mensagem, type Registro, type Situacao, type Tom } from './sessao'
import type { Toque } from './motor.js'

/**
 * Espelho do Dr. Fabio Dario (15/10/2026): uma identidade so, a do consultorio
 * dele. Duas fontes para o que o robo sabe:
 *
 * - Com login no sistema (o simulador dentro de Respostas, 16/10/2026): a
 *   configuracao de verdade da clinica, lida do banco (ler-clinica.ts). O robo
 *   da simulacao e o robo que vai atender: mudou uma resposta pronta, "Ler a
 *   clinica de novo" e ele ja responde com ela.
 * - Sem banco (o arquivo da reuniao, aberto com duplo clique): os dados de
 *   exemplo de dados.ts. Roda inteiro no navegador, sem rede: a reuniao nao
 *   pode depender do Wi-Fi da sala.
 *
 * Nos dados de exemplo, a agenda montada na aba Agenda fica guardada neste
 * navegador: os dias, horarios e valores sao de exemplo, e quem ajusta antes
 * da reuniao nao quer refazer a cada recarga. Tudo em try/catch: sem
 * armazenamento, vale a agenda padrao. Com a clinica, a agenda mexida aqui
 * vale so para a simulacao: a de verdade se muda na tela Agenda.
 */
const CHAVE_DA_AGENDA = 'simuladorbot.agenda.fabio'

const IDENTIDADE = IDENTIDADES.fabio

/**
 * Aberto de dentro de Respostas (?no-sistema): a sessao e a do proprio
 * sistema, que esta logo atras. O botao de sair some, porque sair aqui
 * deslogaria o sistema inteiro.
 */
const NO_SISTEMA = new URLSearchParams(window.location.search).has('no-sistema')

type Fonte = 'exemplo' | 'carregando' | 'clinica'
/**
 * jev: o modo do Jev em Preferencias, so quando a clinica vem do sistema
 * (17/10/2026). undefined = arquivo da reuniao, sem Jev; null = nao deu para
 * ler o modo, e o simulador pergunta ao servidor mesmo assim.
 */
type Carga = { identidade: Identidade; agenda: AgendaDaClinica; jev?: ModoDaSegundaLeitura | null }

async function carregarDaClinica(): Promise<Carga> {
  const [linhas, jev] = await Promise.all([lerClinicaDoLogin(), lerModoDoJev()])
  const identidade = identidadeDoSistema(IDENTIDADE, linhas)
  return { identidade, agenda: copiarAgenda(identidade.agendaPadrao), jev }
}

/** O selo do Jev no topo do simulador do sistema (17/10/2026). */
const SELO_DO_JEV: Record<ModoDaSegundaLeitura | 'sem_leitura', { texto: string; cor: string }> = {
  ligada: { texto: 'Jev ligado', cor: 'border-[#9fb0ee]/40 bg-[#4b5a92] text-white' },
  sombra: { texto: 'Jev só observando', cor: 'border-[#9fb0ee]/40 bg-[#4b5a92]/40 text-white' },
  desligada: { texto: 'Jev desligado', cor: 'border-white/15 bg-white/5 text-white/55' },
  sem_leitura: { texto: 'Jev: não li a opção', cor: 'border-amber-300/40 bg-amber-500/15 text-amber-100' },
}

function lerGuardado(chave: string): unknown {
  try {
    return JSON.parse(window.localStorage.getItem(chave) ?? 'null')
  } catch {
    return null
  }
}

function guardar(chave: string, valor: unknown) {
  try {
    if (valor === null) window.localStorage.removeItem(chave)
    else window.localStorage.setItem(chave, JSON.stringify(valor))
  } catch {
    // sem armazenamento, vale ate recarregar a pagina
  }
}

function agendaGuardada(): AgendaDaClinica {
  const salva = lerGuardado(CHAVE_DA_AGENDA)
  return agendaValida(salva) ? salva : copiarAgenda(IDENTIDADE.agendaPadrao)
}

/** O mesmo fundo da conversa na tela de Respostas (Conversations.tsx). */
const FUNDO_WHATSAPP = {
  backgroundColor: '#efeae2',
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Cg fill='none' stroke='%23c4b8a8' stroke-width='1.1' stroke-linecap='round' opacity='.34'%3E%3Cpath d='M10 14h10M12 22c3-3 7-3 10 0'/%3E%3Ccircle cx='58' cy='16' r='5'/%3E%3Cpath d='M50 44l5 5 8-9M20 58h14M22 66h10'/%3E%3Cpath d='M64 62c0 3-3 5-6 5s-6-2-6-5 3-5 6-5 6 2 6 5z'/%3E%3Cpath d='M32 30l6 6 6-6'/%3E%3C/g%3E%3C/svg%3E\")",
} as const

/** As cores das etiquetas da tela de Respostas, por motivo. */
const COR_DO_MOTIVO: Record<string, string> = {
  atendente: 'bg-red-600 text-white',
  urgencia: 'bg-[#b42318] text-white ring-2 ring-[#b42318]/30',
  sangramento: 'bg-[#b42318] text-white ring-2 ring-[#b42318]/30',
  falha: 'bg-red-600 text-white',
  anexo: 'bg-[#e9f1ec] text-[#3d5e4d]',
  cancelou_sozinho: 'bg-[#e9f1ec] text-[#3d5e4d]',
  documento: 'bg-[#fef3c7] text-[#92400e]',
  farmacia: 'bg-[#fef3c7] text-[#92400e]',
  numero_errado: 'bg-[#fef3c7] text-[#92400e]',
}

const COR_DO_TOM: Record<Tom, string> = {
  neutro: 'bg-slate-100 text-slate-500',
  bom: 'bg-emerald-50 text-emerald-600',
  atencao: 'bg-amber-50 text-amber-600',
  alerta: 'bg-red-50 text-red-600',
}

const SUGESTOES = ['Oi, boa tarde!', 'Quanto custa a consulta?', 'Vocês atendem Unimed?', 'Quero marcar uma consulta', 'Meu nariz está sangrando']

/** Quanto tempo a notificacao do alerta fica na tela antes de sair sozinha. */
const NOTIFICACAO_MS = 12_000

const espera = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))

/** Tempo de "digitando...": curto para texto curto, sem passar de 2 segundos. */
const tempoDeDigitar = (texto: string) => Math.min(1900, Math.max(650, 350 + texto.length * 5))

const hora = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

/** O negrito, italico e tachado do WhatsApp, e links clicaveis. */
function formatar(texto: string): ReactNode[] {
  return texto.split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|https?:\/\/\S+)/g).map((parte, i) => {
    if (!parte) return null
    if (/^\*[^*\n]+\*$/.test(parte)) return <strong key={i} className="font-semibold">{parte.slice(1, -1)}</strong>
    if (/^_[^_\n]+_$/.test(parte)) return <em key={i}>{parte.slice(1, -1)}</em>
    if (/^~[^~\n]+~$/.test(parte)) return <s key={i}>{parte.slice(1, -1)}</s>
    if (/^https?:\/\//.test(parte)) {
      return (
        <a key={i} href={parte} target="_blank" rel="noreferrer" className="break-all text-[#027eb5] underline">
          {parte}
        </a>
      )
    }
    return <Fragment key={i}>{parte}</Fragment>
  })
}

function telefoneLegivel(t: string) {
  const d = t.replace(/\D/g, '')
  return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`
}

function quandoCurto(iso: unknown) {
  return new Date(String(iso)).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** O rabinho do balao, como no aplicativo. */
function Rabinho({ lado, cor }: { lado: 'esquerda' | 'direita'; cor: string }) {
  return (
    <svg viewBox="0 0 8 13" width="8" height="13" aria-hidden="true" className={`absolute top-0 ${lado === 'direita' ? '-right-2' : '-left-2'}`}>
      <path
        fill={cor}
        d={lado === 'direita' ? 'M5.188 0H0v11.193l6.467-8.625C7.526 1.156 6.958 0 5.188 0z' : 'M2.812 0H8v11.193L1.533 2.568C.474 1.156 1.042 0 2.812 0z'}
      />
    </svg>
  )
}

function Digitando() {
  return (
    <div className="mt-1.5 flex justify-start">
      <div className="relative flex items-center gap-1 rounded-[7.5px] rounded-tl-none bg-white px-3.5 py-3 shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">
        <Rabinho lado="esquerda" cor="#ffffff" />
        {[0, 150, 300].map((atraso) => (
          <span key={atraso} className="h-2 w-2 animate-bounce rounded-full bg-[#8696a0]" style={{ animationDelay: `${atraso}ms` }} />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------
// O celular do paciente
// ---------------------------------------------------------------

function BalaoNoCelular({
  m,
  comRabinho,
  ativo,
  destaque,
  onTocar,
  onAbrirLista,
}: {
  m: Mensagem
  comRabinho: boolean
  ativo: boolean
  destaque: string | null
  onTocar: (opcao: Toque) => void
  onAbrirLista: () => void
}) {
  const doPaciente = m.autor === 'familia'
  const cor = doPaciente ? '#d9fdd3' : '#ffffff'
  return (
    <div className={`flex ${doPaciente ? 'justify-end' : 'justify-start'} ${comRabinho ? 'mt-1.5' : 'mt-0.5'}`}>
      <div className="max-w-[86%]">
        <div
          className={`relative rounded-[7.5px] px-[9px] pb-[6px] pt-[6px] shadow-[0_1px_0.5px_rgba(11,20,26,.13)] ${
            comRabinho ? (doPaciente ? 'rounded-tr-none' : 'rounded-tl-none') : ''
          }`}
          style={{ backgroundColor: cor }}
        >
          {comRabinho && <Rabinho lado={doPaciente ? 'direita' : 'esquerda'} cor={cor} />}
          {m.anexo && (
            <div className="mb-1 flex h-36 w-52 items-center justify-center rounded-md bg-gradient-to-br from-slate-200 to-slate-300 text-slate-500">
              <Camera className="h-8 w-8" />
            </div>
          )}
          <p className="whitespace-pre-wrap break-words pr-[52px] text-[14.2px] leading-[19px] text-[#111b21]">{formatar(m.texto)}</p>
          <span className="absolute bottom-[5px] right-[8px] flex items-center gap-[3px] text-[11px] leading-none text-[#667781]">
            {hora(m.em)}
            {doPaciente && <CheckCheck className="h-[15px] w-[15px] text-[#53bdeb]" />}
          </span>
          {m.toques?.tipo === 'lista' && (
            <button
              type="button"
              disabled={!ativo}
              onClick={onAbrirLista}
              className="-mx-[9px] mt-2 flex w-[calc(100%+18px)] items-center justify-center gap-2 border-t border-black/[.06] pb-1 pt-2.5 text-[14.5px] font-medium text-[#027eb5] disabled:text-[#027eb5]/45"
            >
              <List className="h-4 w-4" /> {m.toques.rotulo}
            </button>
          )}
        </div>
        {m.toques?.tipo === 'botoes' && (
          <div className="mt-[3px] space-y-[3px]">
            {m.toques.opcoes.map((o) => (
              <button
                key={o.id}
                type="button"
                disabled={!ativo}
                onClick={() => onTocar(o)}
                className={`flex w-full items-center justify-center gap-1.5 rounded-[7.5px] bg-white py-2.5 text-[14.5px] font-medium text-[#027eb5] shadow-[0_1px_0.5px_rgba(11,20,26,.13)] transition disabled:text-[#027eb5]/45 ${
                  destaque === o.id ? 'scale-[0.98] bg-[#e7f3f8]' : ''
                }`}
              >
                <Reply className="h-4 w-4" /> {o.titulo}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ListaAberta({
  m,
  destaque,
  onEscolher,
  onFechar,
}: {
  m: Mensagem
  destaque: string | null
  onEscolher: (o: Toque) => void
  onFechar: () => void
}) {
  if (m.toques?.tipo !== 'lista') return null
  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end bg-black/40">
      <button type="button" aria-label="Fechar" className="flex-1 cursor-default" onClick={onFechar} />
      <div className="max-h-[78%] overflow-y-auto rounded-t-[22px] bg-white pb-4">
        <div className="sticky top-0 flex items-center gap-3 bg-white px-4 pb-2 pt-4">
          <button type="button" onClick={onFechar} aria-label="Fechar" className="text-[#54656f]">
            <X className="h-5 w-5" />
          </button>
          <p className="flex-1 text-center text-[16px] font-semibold text-[#111b21]">{m.toques.rotulo}</p>
          <span className="w-5" />
        </div>
        {m.toques.opcoes.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onEscolher(o)}
            className={`flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-[#f5f6f6] ${destaque === o.id ? 'bg-[#e7f3f8]' : ''}`}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] text-[#111b21]">{o.titulo}</span>
              {o.descricao && <span className="block text-[13px] text-[#667781]">{o.descricao}</span>}
            </span>
            <span className={`h-5 w-5 shrink-0 rounded-full border-2 ${destaque === o.id ? 'border-[#00a884] bg-[#00a884]' : 'border-[#8696a0]'}`} />
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------
// A tela da clinica
// ---------------------------------------------------------------

function BalaoNaClinica({ m, comRabinho }: { m: Mensagem; comRabinho: boolean }) {
  const doPaciente = m.autor === 'familia'
  const cor = doPaciente ? '#ffffff' : '#d9fdd3'
  return (
    <div className={`flex ${doPaciente ? 'justify-start' : 'justify-end'} ${comRabinho ? 'mt-1.5' : 'mt-0.5'}`}>
      <div
        className={`relative max-w-[80%] rounded-[7.5px] px-[9px] pb-[6px] pt-[6px] shadow-[0_1px_0.5px_rgba(11,20,26,.13)] ${
          comRabinho ? (doPaciente ? 'rounded-tl-none' : 'rounded-tr-none') : ''
        }`}
        style={{ backgroundColor: cor }}
      >
        {comRabinho && <Rabinho lado={doPaciente ? 'esquerda' : 'direita'} cor={cor} />}
        {comRabinho && !doPaciente && (
          <p className={`mb-0.5 flex items-center gap-1 text-[11px] font-bold ${m.autor === 'robo' ? 'text-[#4f7a63]' : 'text-[#9a6a52]'}`}>
            {m.autor === 'robo' ? <Bot className="h-3 w-3" /> : <Headset className="h-3 w-3" />}
            {m.autor === 'robo' ? 'Robô' : IDENTIDADE.equipe}
          </p>
        )}
        {m.anexo && <p className="mb-1 flex items-center gap-1 text-[12px] font-semibold text-[#3d5e4d]"><Paperclip className="h-3.5 w-3.5" /> Arquivo recebido</p>}
        <p className="whitespace-pre-wrap break-words pr-[44px] text-[13.5px] leading-[18px] text-[#111b21]">{formatar(m.texto)}</p>
        {m.toques && (
          <p className="mt-1 text-[11.5px] text-[#667781]">
            {m.toques.tipo === 'lista' ? `Lista "${m.toques.rotulo}": ` : 'Botões: '}
            {m.toques.opcoes.map((o) => o.titulo).join(' · ')}
          </p>
        )}
        <span className="absolute bottom-[5px] right-[8px] text-[11px] leading-none text-[#667781]">{hora(m.em)}</span>
      </div>
    </div>
  )
}

function EtiquetaDaSituacao({ situacao, motivo }: { situacao: Situacao; motivo: string | null }) {
  if (situacao === 'aguardando_equipe' && motivo) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold ${COR_DO_MOTIVO[motivo] ?? 'bg-red-600 text-white'}`}>
        {MOTIVOS[motivo]?.rotulo ?? motivo}
      </span>
    )
  }
  const estilos: Record<Situacao, [string, string]> = {
    robo: ['bg-[#e9f1ec] text-[#3d5e4d]', '🤖 Robô atendendo'],
    aguardando_equipe: ['bg-red-600 text-white', 'Aguardando a equipe'],
    equipe: ['bg-[#f6ece6] text-[#8a5a43]', `🎧 ${IDENTIDADE.equipe} conversando`],
    resolvida: ['bg-emerald-50 text-emerald-700', '✓ Resolvida pelo robô'],
  }
  const [classe, rotulo] = estilos[situacao]
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-bold ${classe}`}>{rotulo}</span>
}

function IconeDoRegistro({ r }: { r: Registro }) {
  const classe = 'h-3.5 w-3.5'
  if (r.tipo === 'consulta') return r.tom === 'bom' ? <CalendarCheck2 className={classe} /> : <CalendarX2 className={classe} />
  if (r.tipo === 'cadastro') return <UserPlus className={classe} />
  if (r.tipo === 'ficha') return <ClipboardList className={classe} />
  if (r.tipo === 'bandeira') return <Flag className={classe} />
  if (r.tipo === 'alerta') return <BellRing className={classe} />
  return <Sparkles className={classe} />
}

function Cartao({ titulo, children, className = '' }: { titulo: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-[18px] border border-slate-200/80 bg-white p-4 ${className}`}>
      <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-slate-400">{titulo}</p>
      <div className="mt-2">{children}</div>
    </section>
  )
}

/**
 * A notificacao do alerta de sangramento, como chega no celular do Dr. Fabio
 * e da Dayane (pedido do Dr. Fabio, 15/10/2026). Em producao e o aviso da
 * Central de Cuidado no celular da equipe; aqui ela aparece no canto da tela
 * para a reuniao ver o que eles receberiam.
 */
function NotificacaoNoCelular({ alerta, onFechar }: { alerta: Alerta; onFechar: () => void }) {
  return (
    <div className="pointer-events-auto w-[min(360px,calc(100vw-32px))] rounded-[22px] bg-white/95 p-3.5 shadow-[0_22px_60px_rgba(0,0,0,.32)] ring-1 ring-black/5 backdrop-blur animate-in fade-in slide-in-from-right-8 duration-300">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        <img src={logoCentral} alt="" className="h-4 w-auto brightness-0 opacity-70" />
        <span>Central de Cuidado · agora</span>
        <button type="button" onClick={onFechar} aria-label="Fechar notificação" className="ml-auto rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1.5 text-[15px] font-extrabold text-[#1d1d1b]">{alerta.titulo}</p>
      <p className="mt-0.5 line-clamp-3 text-[13.5px] leading-snug text-slate-600">"{alerta.texto}"</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-[11.5px] font-bold text-[#b42318]">
          <BellRing className="h-3.5 w-3.5 animate-pulse" /> Tocou agora no celular de:
        </span>
        {alerta.para.map((quem) => (
          <span key={quem} className="rounded-full bg-[#fdecea] px-2 py-0.5 text-[11.5px] font-bold text-[#b42318]">
            📱 {quem}
          </span>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------
// A pagina
// ---------------------------------------------------------------

export default function SimuladorBot() {
  const { signOut, user, session } = useAuth()
  const usuarioId = session?.user.id ?? null
  const [chaveFamilia, setChaveFamilia] = useState<ChaveFamilia>('nova')
  const [identidade, setIdentidade] = useState<Identidade>(IDENTIDADE)
  // Com banco, comeca lendo a clinica; o arquivo da reuniao ja nasce no exemplo.
  const [fonte, setFonte] = useState<Fonte>(() => (isSupabaseConfigured ? 'carregando' : 'exemplo'))
  const [erroDaClinica, setErroDaClinica] = useState<string | null>(null)
  const [leitura, setLeitura] = useState(0)
  const [agenda, setAgenda] = useState<AgendaDaClinica>(agendaGuardada)
  const [modoDoJev, setModoDoJev] = useState<ModoDaSegundaLeitura | null | undefined>(undefined)
  const [aba, setAba] = useState<'respostas' | 'agenda'>('respostas')
  const [avisoDoRoteiro, setAvisoDoRoteiro] = useState<string | null>(null)
  const [sim, setSim] = useState(() => new Simulacao(IDENTIDADE, FAMILIAS.nova, { agenda }))
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [registros, setRegistros] = useState<Registro[]>([])
  const [notificacoes, setNotificacoes] = useState<Alerta[]>([])
  const [digitando, setDigitando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [rascunho, setRascunho] = useState('')
  const [rascunhoEquipe, setRascunhoEquipe] = useState('')
  const [listaAberta, setListaAberta] = useState<Mensagem | null>(null)
  const [destaque, setDestaque] = useState<string | null>(null)
  const [roteiroAtivo, setRoteiroAtivo] = useState<Roteiro | null>(null)
  const [menuRoteiros, setMenuRoteiros] = useState(false)
  const [, setVersao] = useState(0)
  const [relogio, setRelogio] = useState(() => hora(new Date()))

  // As funcoes assincronas (roteiro, digitacao) atravessam varias renderizacoes:
  // leem a conversa e a "geracao" daqui, e nao do estado capturado no comeco.
  // Recomecar troca a geracao, e tudo que estava em andamento para sozinho.
  const simAtual = useRef(sim)
  const geracao = useRef(0)
  const celular = useRef<HTMLDivElement>(null)
  const clinica = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  const familia = FAMILIAS[chaveFamilia]

  useEffect(() => {
    const t = window.setInterval(() => setRelogio(hora(new Date())), 20_000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    for (const el of [celular.current, clinica.current]) el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [mensagens.length, digitando])

  useEffect(() => {
    if (!menuRoteiros) return
    const fora = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) setMenuRoteiros(false)
    }
    document.addEventListener('pointerdown', fora)
    return () => document.removeEventListener('pointerdown', fora)
  }, [menuRoteiros])

  function fecharNotificacao(id: string) {
    setNotificacoes((n) => n.filter((a) => a.id !== id))
  }

  function mostrarNotificacoes(novas: Alerta[]) {
    if (novas.length === 0) return
    setNotificacoes((n) => [...n, ...novas].slice(-3))
    for (const a of novas) window.setTimeout(() => fecharNotificacao(a.id), NOTIFICACAO_MS)
  }

  function recomecar(cf: ChaveFamilia = chaveFamilia, base: Carga = { identidade, agenda, jev: modoDoJev }): Simulacao {
    geracao.current += 1
    const nova = new Simulacao(base.identidade, FAMILIAS[cf], { agenda: base.agenda })
    // Com a clinica do sistema, o Jev pergunta pelo servidor (jev-ler); o
    // arquivo da reuniao segue sem ele.
    if (base.jev !== undefined) nova.leitorDoJev = perguntarAoJev
    simAtual.current = nova
    setSim(nova)
    setChaveFamilia(cf)
    setMensagens([])
    setRegistros([])
    setNotificacoes([])
    setDigitando(false)
    setOcupado(false)
    setRascunho('')
    setRascunhoEquipe('')
    setListaAberta(null)
    setDestaque(null)
    setRoteiroAtivo(null)
    setAvisoDoRoteiro(null)
    return nova
  }

  /**
   * Agenda nova vale na hora, na conversa aberta. Nos dados de exemplo fica
   * salva neste navegador; com a clinica, vale so ate recarregar.
   */
  function mudarAgenda(nova: AgendaDaClinica, ehPadrao = false) {
    setAgenda(nova)
    simAtual.current.aplicarAgenda(nova)
    if (fonte === 'exemplo') guardar(CHAVE_DA_AGENDA, ehPadrao ? null : nova)
    setVersao((v) => v + 1)
  }

  // A configuracao da clinica do login. Chegou, a conversa recomeca com ela;
  // falhou, fica no exemplo e diz por que, em vez de fingir que leu.
  const usarClinica = useEffectEvent((carga: Carga) => {
    setIdentidade(carga.identidade)
    setAgenda(carga.agenda)
    setModoDoJev(carga.jev ?? null)
    setErroDaClinica(null)
    setFonte('clinica')
    recomecar(chaveFamilia, { ...carga, jev: carga.jev ?? null })
  })
  const ficarNoExemplo = useEffectEvent((erro: unknown) => {
    setErroDaClinica(erro instanceof Error ? erro.message : String(erro))
    setModoDoJev(undefined)
    setFonte('exemplo')
  })
  useEffect(() => {
    if (!isSupabaseConfigured || !usuarioId) return
    let vivo = true
    carregarDaClinica().then(
      (carga) => {
        if (vivo) usarClinica(carga)
      },
      (erro: unknown) => {
        if (vivo) ficarNoExemplo(erro)
      },
    )
    return () => {
      vivo = false
    }
  }, [usuarioId, leitura])

  /** Le a clinica de novo: depois de mudar uma resposta pronta no sistema, por exemplo. */
  function lerDeNovo() {
    setFonte('carregando')
    setLeitura((n) => n + 1)
  }

  /**
   * Uma mensagem do paciente e a resposta do robo, com o "digitando..." no
   * meio. Devolve o que o robo respondeu (vazio = ficou calado), ou null se a
   * conversa foi recomecada no meio.
   */
  async function enviar(entrada: { texto: string; idDoToque?: string; anexo?: boolean }): Promise<Mensagem[] | null> {
    const minha = geracao.current
    setOcupado(true)
    setListaAberta(null)
    setDestaque(null)
    const r = await simAtual.current.enviarDaFamilia(entrada)
    if (geracao.current !== minha) return null
    // O modo que o servidor devolveu: mudou em Preferencias, o selo acompanha.
    const modoLido = simAtual.current.ultimoModoDoJev
    if (modoLido && simAtual.current.leitorDoJev) setModoDoJev(modoLido)
    setMensagens((m) => [...m, r.familia])
    await espera(450)
    // O alerta sai antes da resposta do robo, como em producao: o celular do
    // medico toca enquanto o paciente ainda le o "digitando...".
    if (geracao.current !== minha) return null
    mostrarNotificacoes(r.alertas)
    for (const resposta of r.respostas) {
      if (geracao.current !== minha) return null
      setDigitando(true)
      await espera(tempoDeDigitar(resposta.texto))
      if (geracao.current !== minha) return null
      setDigitando(false)
      setMensagens((m) => [...m, resposta])
      await espera(250)
    }
    if (geracao.current !== minha) return null
    setRegistros((g) => [...g, ...r.registros])
    setVersao((v) => v + 1)
    setOcupado(false)
    return r.respostas
  }

  /** Toque manual: so na opcao da ultima mensagem, e nunca no meio de outra resposta. */
  function tocar(o: Toque) {
    if (ocupado || roteiroAtivo || fonte === 'carregando') return
    void enviar({ texto: o.titulo, idDoToque: o.id })
  }

  function responderComoEquipe(texto: string) {
    const r = simAtual.current.responderComoEquipe(texto)
    setMensagens((m) => [...m, r.mensagem])
    setRegistros((g) => [...g, ...r.registros])
    setRascunhoEquipe('')
    setVersao((v) => v + 1)
  }

  /** O veredito do medico sobre a urgencia (17/10/2026), como na tela de Respostas. */
  function darVeredito(veredito: 'urgente' | 'nao_urgente') {
    const r = simAtual.current.darVeredito(veredito)
    if (r.mensagem) setMensagens((m) => [...m, r.mensagem as Mensagem])
    setRegistros((g) => [...g, ...r.registros])
    setVersao((v) => v + 1)
  }

  function concluir() {
    const novos = simAtual.current.concluir()
    setRegistros((g) => [...g, ...novos])
    setVersao((v) => v + 1)
  }

  // A opcao tocavel e a da ultima mensagem do robo, desde que o paciente nao
  // tenha escrito depois dela.
  let ativa: Mensagem | null = null
  for (let i = mensagens.length - 1; i >= 0; i--) {
    const m = mensagens[i]
    if (m.autor === 'familia') break
    if (m.autor === 'robo' && m.toques) {
      ativa = m
      break
    }
  }

  async function digitar(texto: string, campo: 'celular' | 'equipe', minha: number) {
    const passo = Math.max(1, Math.ceil(texto.length / 45))
    for (let i = passo; i < texto.length + passo; i += passo) {
      if (geracao.current !== minha) return false
      const parcial = texto.slice(0, i)
      if (campo === 'celular') setRascunho(parcial)
      else setRascunhoEquipe(parcial)
      await espera(32)
    }
    await espera(300)
    return geracao.current === minha
  }

  /**
   * O roteiro se digita sozinho. O toque procura a opcao na ultima resposta
   * que o robo deu NESTA rodada, e nao numa conversa gravada: se o robo mudar
   * e a opcao sumir, o roteiro para ali, a vista, em vez de inventar o passo.
   */
  async function rodarRoteiro(roteiro: Roteiro) {
    setMenuRoteiros(false)
    recomecar(roteiro.familia)
    const minha = geracao.current
    setRoteiroAtivo(roteiro)
    await espera(500)
    let ultimaComToques: Mensagem | null = null
    for (const passo of roteiro.passos) {
      if (geracao.current !== minha) return
      let respostas: Mensagem[] | null = []
      if ('equipe' in passo) {
        if (!(await digitar(passo.equipe, 'equipe', minha))) return
        responderComoEquipe(passo.equipe)
      } else if ('anexo' in passo) {
        setDestaque('anexo')
        await espera(700)
        if (geracao.current !== minha) return
        respostas = await enviar({ texto: '', anexo: true })
      } else if ('toque' in passo) {
        const opcao = ultimaComToques?.toques?.opcoes.find((o) => o.id === passo.toque)
        if (!opcao || !ultimaComToques) {
          // Com a agenda mexida, o dia ou o horario que o roteiro tocaria pode
          // nao existir. Para aqui e diz o motivo, em vez de sumir calado.
          setRoteiroAtivo(null)
          setAvisoDoRoteiro(
            `O roteiro "${roteiro.titulo}" parou: a opção que ele tocaria não apareceu. ` +
              'Se a agenda foi alterada, pode faltar dia ou horário; restaure a agenda padrão ou continue a conversa à mão.',
          )
          return
        }
        if (ultimaComToques.toques?.tipo === 'lista') {
          setListaAberta(ultimaComToques)
          await espera(650)
        }
        setDestaque(opcao.id)
        await espera(550)
        if (geracao.current !== minha) return
        respostas = await enviar({ texto: opcao.titulo, idDoToque: opcao.id })
      } else {
        if (!(await digitar(passo.texto, 'celular', minha))) return
        setRascunho('')
        respostas = await enviar({ texto: passo.texto })
      }
      if (respostas === null || geracao.current !== minha) return
      if (respostas.length) ultimaComToques = [...respostas].reverse().find((m) => m.toques) ?? null
      await espera(900)
    }
    if (geracao.current === minha) setRoteiroAtivo(null)
  }

  const enviarRascunho = () => {
    const texto = rascunho.trim()
    if (!texto || ocupado || roteiroAtivo || fonte === 'carregando') return
    setRascunho('')
    void enviar({ texto })
  }

  const consultas = sim.consultas()
  const pacientes = sim.pacientes()
  const etapa = sim.etapa
  const situacao = sim.situacao
  // Enquanto le a clinica, a conversa espera: ela recomeca quando a leitura chega.
  const lendo = fonte === 'carregando' && Boolean(usuarioId)
  const travado = ocupado || Boolean(roteiroAtivo) || lendo
  const agendaAlterada = JSON.stringify(agenda) !== JSON.stringify(identidade.agendaPadrao)

  return (
    <div className="flex min-h-dvh flex-col bg-[#f6f4ef] text-[#1d1d1b] lg:h-dvh">
      {/* Barra de cima: o preto do site do Dr. Fabio, onde o logo foi desenhado */}
      <header className="relative z-30 flex flex-wrap items-center gap-x-4 gap-y-2 bg-black px-4 py-3 text-white lg:px-6">
        <img src={logoFabio} alt="Dr. Fábio Dario, otorrinolaringologista" className="h-9 w-auto" />
        <div className="hidden h-7 w-px bg-white/15 sm:block" />
        <div className="mr-auto">
          <p className="text-[15px] font-extrabold leading-tight">Simulador do atendimento no WhatsApp</p>
          <p className="text-[11.5px] text-white/55">
            {lendo
              ? 'Lendo a configuração da clínica...'
              : fonte === 'clinica'
                ? 'Robô de verdade, com a configuração da clínica. Nada é enviado nem gravado.'
                : 'Robô de verdade, com dados de exemplo. Nada é enviado nem gravado.'}
          </p>
        </div>

        {fonte === 'clinica' && modoDoJev !== undefined && (
          <span
            title="A segunda leitura pelo Jev muda em Preferências. Aqui ele lê o que você digita, pelo servidor, como faria com o WhatsApp."
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-2 text-[13px] font-bold ${SELO_DO_JEV[modoDoJev ?? 'sem_leitura'].cor}`}
          >
            <Radar className="h-4 w-4" /> {SELO_DO_JEV[modoDoJev ?? 'sem_leitura'].texto}
          </span>
        )}

        {isSupabaseConfigured && usuarioId && (
          <button
            type="button"
            onClick={lerDeNovo}
            disabled={lendo || ocupado || Boolean(roteiroAtivo)}
            title="Lê de novo unidades, horários, saudação e respostas prontas cadastradas no sistema, e recomeça a conversa"
            className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-white/15 px-3 py-2 text-[13px] font-bold text-white/85 transition hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${lendo ? 'animate-spin' : ''}`} /> Ler a clínica de novo
          </button>
        )}

        <div ref={menu} className="relative">
          <button
            type="button"
            onClick={() => setMenuRoteiros((v) => !v)}
            className="flex items-center gap-2 rounded-xl bg-[#a9c3b3] px-3.5 py-2 text-[13px] font-extrabold text-[#1d1d1b] transition hover:bg-[#bcd2c4]"
          >
            <Play className="h-4 w-4" /> Roteiros prontos <ChevronDown className="h-4 w-4" />
          </button>
          {menuRoteiros && (
            <div className="absolute right-0 top-full mt-2 max-h-[70dvh] w-[min(380px,calc(100vw-32px))] overflow-y-auto rounded-2xl bg-white p-2 text-[#1d1d1b] shadow-[0_24px_60px_rgba(0,0,0,.3)]">
              {ROTEIROS.map((r) => (
                <button
                  key={r.chave}
                  type="button"
                  onClick={() => void rodarRoteiro(r)}
                  className="block w-full rounded-xl px-3 py-2.5 text-left transition hover:bg-[#f1f5f2]"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[14px] font-bold">{r.titulo}</span>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-bold text-slate-500">{FAMILIAS[r.familia].rotulo}</span>
                  </span>
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-slate-500">{r.resumo}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => recomecar()}
          className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-white/15 px-3 py-2 text-[13px] font-bold text-white/85 transition hover:bg-white/10"
        >
          <RotateCcw className="h-4 w-4" /> Recomeçar
        </button>
        {user && !NO_SISTEMA && (
          <button type="button" onClick={() => void signOut()} title={`Sair (${user.email})`} className="rounded-xl p-2 text-white/50 hover:bg-white/10 hover:text-white">
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </header>

      {erroDaClinica && (
        <div className="flex items-center gap-3 bg-amber-100 px-4 py-2 text-[13px] font-semibold text-amber-900 lg:px-6">
          <span className="min-w-0 flex-1">
            Não consegui ler a configuração da clínica ({erroDaClinica}). A simulação está com os dados de exemplo, e não com o que está
            cadastrado no sistema.
          </span>
          <button type="button" onClick={lerDeNovo} className="rounded-lg bg-amber-900 px-2.5 py-1 text-[12px] font-bold text-white">
            Tentar de novo
          </button>
        </div>
      )}

      {roteiroAtivo && (
        <div className="flex items-center gap-3 bg-[#a9c3b3] px-4 py-2 text-[13px] font-bold text-[#1d1d1b] lg:px-6">
          <span className="h-2 w-2 animate-pulse rounded-full bg-[#1d1d1b]" />
          Roteiro em andamento: {roteiroAtivo.titulo}
          <button type="button" onClick={() => recomecar()} className="ml-auto flex items-center gap-1 rounded-lg bg-black px-2.5 py-1 text-[12px] text-white">
            <Square className="h-3 w-3" /> Parar
          </button>
        </div>
      )}

      {avisoDoRoteiro && (
        <div className="flex items-center gap-3 bg-amber-100 px-4 py-2 text-[13px] font-semibold text-amber-900 lg:px-6">
          <span className="min-w-0 flex-1">{avisoDoRoteiro}</span>
          <button type="button" onClick={() => setAvisoDoRoteiro(null)} aria-label="Fechar aviso" className="rounded-lg p-1 hover:bg-amber-200">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Notificacoes do alerta de sangramento: o celular do Dr. Fabio e da Dayane */}
      <div className="pointer-events-none fixed right-4 top-20 z-50 flex flex-col items-end gap-2">
        {notificacoes.map((a) => (
          <NotificacaoNoCelular key={a.id} alerta={a} onFechar={() => fecharNotificacao(a.id)} />
        ))}
      </div>

      <main className="grid min-h-0 flex-1 gap-5 p-4 lg:grid-cols-[minmax(400px,460px)_1fr] lg:p-5">
        {/* ---------------- Celular do paciente ---------------- */}
        <section className="flex min-h-0 flex-col items-center">
          <div className="mb-3 flex w-full max-w-[400px] flex-wrap items-end justify-between gap-x-3 gap-y-2">
            <div>
              <p className="text-[10.5px] font-extrabold uppercase tracking-[0.16em] text-slate-400">O que o paciente vê</p>
              <p className="text-[12.5px] text-slate-500">{familia.descricao}</p>
            </div>
            <select
              value={chaveFamilia}
              onChange={(e) => recomecar(e.target.value as ChaveFamilia)}
              className="shrink-0 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[12.5px] font-bold text-[#1d1d1b] outline-none"
            >
              {Object.values(FAMILIAS).map((f) => (
                <option key={f.chave} value={f.chave}>
                  {f.rotulo}
                </option>
              ))}
            </select>
          </div>

          <div className="relative flex h-[680px] w-full max-w-[400px] flex-col overflow-hidden rounded-[46px] border-[11px] border-[#111] bg-[#111] shadow-[0_30px_70px_rgba(0,0,0,.28)] lg:h-[min(860px,calc(100dvh-170px))]">
            {/* Barra de status */}
            <div className="flex items-center justify-between bg-[#f0f2f5] px-6 pb-1 pt-2 text-[12.5px] font-semibold text-[#111b21]">
              <span>{relogio}</span>
              <span className="h-[22px] w-[90px] rounded-full bg-[#111]" />
              <span className="tracking-tight">5G ▮▮▮</span>
            </div>
            {/* Cabecalho do WhatsApp */}
            <div className="flex items-center gap-2.5 bg-[#f0f2f5] px-2.5 pb-2.5 pt-1.5">
              <ArrowLeft className="h-5 w-5 text-[#54656f]" />
              <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-black">
                <img src={iconeFabio} alt="" className="h-full w-full object-cover" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15.5px] font-semibold text-[#111b21]">{identidade.nomeNoWhatsApp}</span>
                <span className="block truncate text-[12px] text-[#667781]">{digitando ? 'digitando...' : 'Conta comercial'}</span>
              </span>
              <Video className="h-5 w-5 text-[#54656f]" />
              <Phone className="ml-3 h-[18px] w-[18px] text-[#54656f]" />
              <EllipsisVertical className="ml-1 h-5 w-5 text-[#54656f]" />
            </div>

            {/* Conversa */}
            <div ref={celular} className="min-h-0 flex-1 overflow-y-auto px-3 pb-2 pt-3" style={FUNDO_WHATSAPP}>
              <div className="mb-2 flex justify-center">
                <span className="rounded-lg bg-white px-3 py-1 text-[12px] font-medium text-[#54656f] shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">Hoje</span>
              </div>
              <div className="mx-auto mb-3 max-w-[88%] rounded-lg bg-[#ffeecd] px-3 py-1.5 text-center text-[11.5px] leading-snug text-[#54656f]">
                🔒 Simulação. As respostas são do robô de verdade, mas nada é enviado nem gravado no sistema.
              </div>
              {mensagens.map((m, i) => (
                <BalaoNoCelular
                  key={m.id}
                  m={m}
                  comRabinho={i === 0 || (mensagens[i - 1].autor === 'familia') !== (m.autor === 'familia')}
                  ativo={m === ativa}
                  destaque={m === ativa ? destaque : null}
                  onTocar={tocar}
                  onAbrirLista={() => setListaAberta(m)}
                />
              ))}
              {digitando && <Digitando />}
            </div>

            {/* Sugestoes para comecar */}
            {mensagens.length === 0 && !roteiroAtivo && (
              <div className="flex flex-wrap justify-center gap-1.5 bg-[#efeae2] px-2 pb-1.5 pt-1">
                {SUGESTOES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void enviar({ texto: s })}
                    className="shrink-0 rounded-full border border-[#d1d7db] bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#111b21]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* Barra de digitar */}
            <div className="flex items-end gap-1.5 bg-[#efeae2] px-1.5 pb-2.5 pt-1">
              <div className="flex min-h-[46px] min-w-0 flex-1 items-center rounded-[24px] bg-white px-2 shadow-[0_1px_0.5px_rgba(11,20,26,.13)]">
                <Smile className="mx-1 h-[22px] w-[22px] shrink-0 text-[#54656f]" />
                <input
                  value={rascunho}
                  onChange={(e) => setRascunho(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') enviarRascunho()
                  }}
                  readOnly={Boolean(roteiroAtivo)}
                  placeholder="Mensagem"
                  className="min-w-0 flex-1 bg-transparent px-1.5 py-2.5 text-[15.5px] text-[#111b21] outline-none placeholder:text-[#8696a0]"
                />
                <button
                  type="button"
                  disabled={travado}
                  onClick={() => void enviar({ texto: '', anexo: true })}
                  title="Mandar a foto de um exame"
                  className={`rounded-full p-1.5 text-[#54656f] transition disabled:opacity-60 ${destaque === 'anexo' ? 'bg-[#e7f3f8] text-[#027eb5]' : ''}`}
                >
                  <Paperclip className="h-5 w-5 -rotate-45" />
                </button>
                <Camera className="mx-1.5 h-5 w-5 shrink-0 text-[#54656f]" />
              </div>
              <button
                type="button"
                onClick={enviarRascunho}
                disabled={travado || !rascunho.trim()}
                aria-label="Enviar"
                className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-full bg-[#1daa61] text-white shadow-[0_1px_2px_rgba(11,20,26,.2)] disabled:bg-[#1daa61]"
              >
                {rascunho.trim() ? <Send className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>
            </div>

            {listaAberta && (
              <ListaAberta
                m={listaAberta}
                destaque={destaque}
                onFechar={() => setListaAberta(null)}
                onEscolher={tocar}
              />
            )}
          </div>
        </section>

        {/* ---------------- Tela da clinica ---------------- */}
        <section className="flex min-h-[640px] flex-col overflow-hidden rounded-[24px] border border-slate-200/80 bg-white shadow-[0_18px_45px_rgba(0,0,0,.07)] lg:min-h-0">
          <div className="flex items-center gap-1 border-b border-slate-100 bg-[#1d1d1b] px-4 py-2 text-white">
            <img src={logoCentral} alt="Central de Cuidado" className="mr-3 h-5 w-auto brightness-0 invert" />
            {(
              [
                ['respostas', 'Respostas', <MessageSquareText key="r" className="h-4 w-4" />],
                ['agenda', 'Agenda', <CalendarDays key="a" className="h-4 w-4" />],
              ] as const
            ).map(([chave, rotulo, icone]) => (
              <button
                key={chave}
                type="button"
                onClick={() => setAba(chave)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-bold transition ${
                  aba === chave ? 'bg-white/15 text-white' : 'text-white/55 hover:bg-white/10 hover:text-white'
                }`}
              >
                {icone} {rotulo}
              </button>
            ))}
            <span className="ml-auto hidden text-[11.5px] text-white/50 sm:block">
              {aba === 'agenda'
                ? fonte === 'clinica'
                  ? 'A agenda do sistema; mudanças aqui são só de teste'
                  : 'Configure aqui; o robô usa na hora'
                : `O que a ${IDENTIDADE.equipe} e a equipe veem, ao mesmo tempo`}
            </span>
          </div>

          {aba === 'agenda' ? (
            <ConfiguracaoDaAgenda
              agenda={agenda}
              onMudar={(nova) => mudarAgenda(nova)}
              onRestaurar={() => mudarAgenda(copiarAgenda(identidade.agendaPadrao), true)}
              previa={(id) => sim.horariosLivres(id)}
              alterada={agendaAlterada}
              explicacao={
                fonte === 'clinica'
                  ? 'Estes são os dias e horários cadastrados na Agenda do sistema. Mudar aqui serve para testar: vale só nesta ' +
                    'simulação, na conversa ao lado. Para mudar de verdade, use a tela Agenda e depois "Ler a clínica de novo".'
                  : 'Dias, horários e valores aqui ainda são de exemplo: ajuste com o que o consultório confirmar. ' +
                    'O que muda vale na hora, na conversa ao lado, e fica salvo neste navegador.'
              }
              rotuloRestaurar={fonte === 'clinica' ? 'Voltar à agenda do sistema' : 'Voltar ao exemplo'}
            />
          ) : (
          <div className="grid min-h-0 flex-1 xl:grid-cols-[1fr_340px]">
            {/* Conversa, como na tela de Respostas */}
            <div className="flex min-h-[420px] flex-col xl:min-h-0">
              <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e9f1ec] text-[14px] font-extrabold text-[#3d5e4d]">
                  {familia.nomeDoPerfil.slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-extrabold">
                    {familia.nomeDoPerfil}
                    {pacientes.length > 0 && (
                      <span className="font-semibold text-slate-400"> · {pacientes.map((p) => String(p.name).split(' ')[0]).join(' e ')}</span>
                    )}
                  </p>
                  <p className="text-[12px] text-slate-400">{telefoneLegivel(familia.telefone)}</p>
                </div>
                <EtiquetaDaSituacao situacao={situacao} motivo={sim.motivo} />
              </div>

              <div ref={clinica} className="min-h-0 flex-1 overflow-y-auto px-4 py-3" style={FUNDO_WHATSAPP}>
                {mensagens.length === 0 && (
                  <p className="mx-auto mt-10 max-w-[320px] text-center text-[13px] text-[#54656f]">
                    A conversa aparece aqui do jeito que a recepção vê, com o que foi o robô e o que foi gente.
                  </p>
                )}
                {mensagens.map((m, i) => (
                  <BalaoNaClinica key={m.id} m={m} comRabinho={i === 0 || mensagens[i - 1].autor !== m.autor} />
                ))}
                {digitando && <p className="mt-2 text-right text-[11.5px] font-semibold text-[#4f7a63]">🤖 robô respondendo...</p>}
              </div>

              <div className="border-t border-slate-100 bg-[#f6f4ef] px-4 py-3">
                {sim.pedeVeredito && (
                  <div className="mb-2 rounded-xl border border-[#b42318]/25 bg-[#fff5f4] px-3 py-2">
                    <p className="text-[12px] font-bold text-[#7a1a12]">
                      Urgência: o que o médico acha? O paciente já recebeu a orientação de procurar atendimento.
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={travado}
                        onClick={() => darVeredito('urgente')}
                        className="rounded-xl bg-[#b42318] px-3 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-40"
                      >
                        É urgente
                      </button>
                      <button
                        type="button"
                        disabled={travado}
                        onClick={() => darVeredito('nao_urgente')}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-bold text-[#1d1d1b] disabled:opacity-40"
                      >
                        Não é urgente
                      </button>
                    </div>
                  </div>
                )}
                {situacao === 'equipe' && (
                  <p className="mb-2 text-[12px] font-semibold text-[#8a5a43]">
                    O robô está em silêncio enquanto a {IDENTIDADE.equipe} conversa. Concluir devolve a conversa para ele.
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <input
                    value={rascunhoEquipe}
                    onChange={(e) => setRascunhoEquipe(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && rascunhoEquipe.trim() && !travado) responderComoEquipe(rascunhoEquipe.trim())
                    }}
                    readOnly={Boolean(roteiroAtivo)}
                    placeholder={`Responder como ${IDENTIDADE.equipe} (equipe)...`}
                    className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-[#76967f]"
                  />
                  <button
                    type="button"
                    disabled={travado || !rascunhoEquipe.trim()}
                    onClick={() => responderComoEquipe(rascunhoEquipe.trim())}
                    className="rounded-xl bg-[#1d1d1b] px-3.5 py-2.5 text-[13px] font-bold text-white disabled:opacity-40"
                  >
                    Enviar
                  </button>
                  <button
                    type="button"
                    disabled={travado || mensagens.length === 0 || situacao === 'resolvida'}
                    onClick={concluir}
                    className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-[13px] font-bold text-[#1d1d1b] disabled:opacity-40"
                  >
                    Concluir
                  </button>
                </div>
              </div>
            </div>

            {/* Bastidores */}
            <aside className="min-h-0 space-y-3 overflow-y-auto border-t border-slate-100 bg-[#f6f4ef] p-4 xl:border-l xl:border-t-0">
              <Cartao titulo="Etapa do robô">
                <p className="text-[16px] font-extrabold leading-snug">{etapa ? (ETAPAS[etapa] ?? etapa) : 'Esperando a primeira mensagem'}</p>
                {etapa && <p className="mt-0.5 font-mono text-[11px] text-slate-400">{etapa}</p>}
              </Cartao>

              <Cartao titulo="Agenda deste telefone">
                {consultas.length === 0 ? (
                  <p className="text-[13px] text-slate-400">Nenhuma consulta.</p>
                ) : (
                  <ul className="space-y-2">
                    {consultas.map((c) => (
                      <li key={String(c.id)} className="flex items-start gap-2">
                        {c.status === 'cancelled' ? (
                          <CalendarX2 className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                        ) : (
                          <CalendarCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        )}
                        <span className={`text-[13px] leading-snug ${c.status === 'cancelled' ? 'text-slate-400 line-through' : ''}`}>
                          <strong className="font-bold">{quandoCurto(c.starts_at)}</strong>
                          <span className="block text-slate-500">
                            {String(c.unidade)} · {String(pacientes.find((p) => p.id === c.patient_id)?.name ?? c.contact_name ?? '')}
                            {c.source === 'whatsapp' && <span className="ml-1 rounded bg-[#e9f1ec] px-1 text-[10.5px] font-bold text-[#3d5e4d]">pelo robô</span>}
                          </span>
                          <span className="block text-[12px] text-slate-400">{c.insurance ? `Convênio: ${String(c.insurance)}` : 'Particular'}</span>
                          {Boolean(c.intake_complaint) && (
                            <span className="block text-[12px] text-slate-500">Queixa: {String(c.intake_complaint)}</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Cartao>

              <Cartao titulo="Pacientes deste telefone">
                {pacientes.length === 0 ? (
                  <p className="text-[13px] text-slate-400">Ninguém cadastrado ainda.</p>
                ) : (
                  <ul className="space-y-1">
                    {pacientes.map((p) => (
                      <li key={String(p.id)} className="text-[13px] font-semibold">
                        {String(p.name)}
                        {String(p.id).startsWith('patients-') && (
                          <span className="ml-1.5 rounded bg-emerald-50 px-1 text-[10.5px] font-bold text-emerald-700">novo</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Cartao>

              <Cartao titulo="O que aconteceu">
                {registros.length === 0 ? (
                  <p className="text-[13px] text-slate-400">Cada passo do robô aparece aqui: o que entendeu, o que gravou e quando chamou a equipe.</p>
                ) : (
                  <ol className="space-y-2.5">
                    {[...registros].reverse().map((r) => (
                      <li key={r.id} className="flex gap-2.5">
                        <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${COR_DO_TOM[r.tom]}`}>
                          <IconeDoRegistro r={r} />
                        </span>
                        <span className="min-w-0 text-[13px] leading-snug">
                          <span className="font-semibold">{r.titulo}</span>
                          {r.detalhe && <span className="block break-words text-slate-500">{r.detalhe}</span>}
                          <span className="block text-[11px] text-slate-400">{hora(r.em)}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </Cartao>
            </aside>
          </div>
          )}
        </section>
      </main>
    </div>
  )
}
