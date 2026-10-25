import AbaProtegida from '@/components/AbaProtegida'
import { useAbasNoHistorico } from '@/lib/voltar-do-celular'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import {
  Bell,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronRight,
  CircleUserRound,
  HeartHandshake,
  LogOut,
  MessageCircle,
  MessageCircleHeart,
  MessagesSquare,
  PenLine,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from 'lucide-react'
import { useDb } from '@/lib/store'
import {
  conversasEsperandoEquipe,
  getCurrentMembership,
  listAtendimentosSemAssinatura,
  listPendingRequests,
  type AtendimentoSemAssinatura,
  PENDING_ACCESS_MESSAGE,
  type EsperaDaEquipe,
  type PendingRequest,
} from '@/lib/repository'
import { dueCount } from '@/lib/followup'
import Dashboard from '@/sections/Dashboard'
import Patients from '@/sections/Patients'
import Followups from '@/sections/Followups'
import Conversations from '@/sections/Conversations'
import { prepararPrescricao } from '@/lib/memed'
import Agenda from '@/sections/Agenda'
import Settings from '@/sections/Settings'
import AccessAdmin from '@/sections/AccessAdmin'
import { lembrarClinica, logoNoFundoEscuro, marcaDaClinica, ultimaClinicaVista } from '@/lib/marca'
import arteDoMenu from '@/assets/sidebar-otorrino.jpg'
import { useAuth } from '@/auth/AuthProvider'
import { useDialogos } from '@/components/dialogos-contexto'
import { apagarParametrosDoEndereco, parametrosDoEndereco } from '@/lib/endereco'
import { registrarServiceWorker } from '@/lib/notificacoes'
import ConviteParaAvisos from '@/components/ConviteParaAvisos'
import QuemEstaOnline from '@/components/QuemEstaOnline'
import { AssinaturaEmLote } from '@/components/AssinaturaEmLote'
import { enviarMinhaFoto, useEquipeOnline } from '@/lib/equipe-online'
import { ligarModoWhatsApp } from '@/lib/modo-whatsapp'
import { publicoDaClinica } from '@/lib/publico'

type Tab = 'dashboard' | 'agenda' | 'followups' | 'conversas' | 'pacientes' | 'config' | 'admin'
type Icon = ComponentType<{ className?: string; strokeWidth?: number }>

const TABS: { key: Tab; label: string; shortLabel: string; icon: Icon }[] = [
  { key: 'dashboard', label: 'Visão geral', shortLabel: 'Visão', icon: ChartNoAxesCombined },
  { key: 'agenda', label: 'Agenda', shortLabel: 'Agenda', icon: CalendarDays },
  { key: 'followups', label: 'Acompanhamentos', shortLabel: 'Follow-ups', icon: MessageCircleHeart },
  { key: 'conversas', label: 'Respostas', shortLabel: 'Respostas', icon: MessagesSquare },
  { key: 'pacientes', label: 'Pacientes', shortLabel: 'Pacientes', icon: UsersRound },
  { key: 'config', label: 'Preferências', shortLabel: 'Ajustes', icon: Settings2 },
  { key: 'admin', label: 'Acessos da equipe', shortLabel: 'Acessos', icon: ShieldCheck },
]

const PAGE_META: Record<Tab, { eyebrow: string; title: string; subtitle: string }> = {
  dashboard: {
    eyebrow: 'Inteligência clínica',
    title: 'Visão geral',
    subtitle: 'Os números que ajudam a cuidar melhor, em um só lugar.',
  },
  followups: {
    eyebrow: 'Cuidado contínuo',
    title: 'Acompanhamentos',
    subtitle: 'Cada paciente no momento certo da sua jornada.',
  },
  agenda: {
    eyebrow: 'Tempo do cuidado',
    title: 'Agenda',
    subtitle: 'Horários de atendimento, bloqueios e consultas marcadas.',
  },
  conversas: {
    eyebrow: 'Escuta ativa',
    title: 'Respostas',
    subtitle: 'O que os pacientes responderam pelo WhatsApp, em um só lugar.',
  },
  pacientes: {
    eyebrow: 'Base clínica',
    title: 'Pacientes',
    subtitle: 'Cadastro, contexto e histórico de acompanhamento.',
  },
  config: {
    eyebrow: 'Personalização',
    title: 'Preferências',
    subtitle: 'Mensagens, segurança dos dados e rotina da equipe.',
  },
  admin: {
    eyebrow: 'Administração segura',
    title: 'Acessos da equipe',
    subtitle: 'Aprove novos cadastros antes de liberar os dados da clínica.',
  },
}

function formatToday() {
  const value = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  }).format(new Date())
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * Cabecalho da pagina recolhido na tela de Respostas.
 *
 * Pedido em 21/09/2026: num notebook de 768px de altura, o titulo, a data, o
 * botao "Novo paciente", o cartao do menu automatico e a faixa de filtros
 * comiam quase um terco da janela, e a conversa - que e o trabalho - ficava
 * espremida numa tira. Nada disso e de uso continuo; a conversa e.
 *
 * A regra: abaixo de 900px de altura ja abre recolhido. Se a pessoa abrir ou
 * fechar na mao, a escolha dela passa a valer em qualquer tamanho de tela, e
 * fica guardada neste navegador. Automatico so decide enquanto ninguem
 * decidiu.
 *
 * So no computador. No celular a pagina rola inteira e o cabecalho nao
 * disputa altura com nada.
 */
const CHAVE_TOPO_RESPOSTAS = 'central:respostas:topo'

function preferenciaDeTopo(): boolean | null {
  try {
    const guardado = localStorage.getItem(CHAVE_TOPO_RESPOSTAS)
    if (guardado === 'recolhido') return true
    if (guardado === 'aberto') return false
  } catch {
    // Navegador com armazenamento bloqueado (aba anonima, politica da rede).
    // Sem preferencia guardada o automatico decide, que e o suficiente.
  }
  return null
}


/** Meia hora: a partir disso a espera deixa de ser "chegou agora". */
const ESPERA_LONGA_MS = 30 * 60 * 1000

function haQuantoTempo(iso: string | null): string {
  if (!iso) return ''
  const minutos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutos < 60) return `há ${minutos} min`
  const horas = Math.floor(minutos / 60)
  return horas < 24 ? `há ${horas}h` : `há ${Math.floor(horas / 24)} dia(s)`
}

export default function Home() {
  const { user, signOut } = useAuth()
  const {
    db,
    role,
    loading,
    loadError,
    retry,
    addPatient,
    updatePatient,
    removePatient,
    listArchived,
    restorePatient,
    getConsultations,
    addConsultation,
    updateConsultation,
    setFollowup,
    setTemplates,
    setEtapas,
    importDb,
    clearAll,
  } = useDb()
  /**
   * Aba inicial.
   *
   * Volta da assinatura digital abre direto em Pacientes. O VIDaaS devolve o
   * navegador com o numero do pedido no endereco, e quem le esse numero e o
   * prontuario - que so existe na tela quando a aba de Pacientes esta aberta.
   * Sem isto o medico autorizava no celular, voltava para a tela inicial, e a
   * assinatura ficava pela metade em silencio: autorizada e nunca concluida.
   */
  const [tab, setTab] = useState<Tab>(() => {
    const endereco = parametrosDoEndereco()
    if (endereco.get('conversa')) return 'conversas'
    // Sem atalho no endereco, a Visao geral (15/10/2026, pedido do Edu): e a
    // primeira do menu, e o resumo do dia vem antes da lista de acompanhamentos.
    return endereco.get('state') || endereco.get('paciente') ? 'pacientes' : 'dashboard'
  })
  // Paciente cuja conversa deve abrir ao entrar em Respostas pelo atalho.
  const [conversaFoco, setConversaFoco] = useState<string | null>(null)
  // Prontuario pedido pela Agenda (15/10/2026, a pedido do Dr. Marcello): abre
  // na aba de Pacientes, onde o prontuario mora, e fechar volta para a Agenda.
  const [prontuarioDaAgenda, setProntuarioDaAgenda] = useState<string | null>(null)
  /**
   * Conversa pedida pelo toque na notificacao do celular (28/09/2026). Vem
   * pelo endereco (?conversa=, app fechado) ou por mensagem do service worker
   * (app ja aberto). O `vez` faz o mesmo aviso tocado duas vezes abrir de novo.
   */
  const [conversaDoAviso, setConversaDoAviso] = useState<{ id: string; vez: number } | null>(() => {
    const id = parametrosDoEndereco().get('conversa')
    return id ? { id, vez: Date.now() } : null
  })
  useEffect(() => {
    if (parametrosDoEndereco().get('conversa')) apagarParametrosDoEndereco(['conversa'])
    void registrarServiceWorker()
    if (!('serviceWorker' in navigator)) return
    const aoReceber = (evento: MessageEvent) => {
      const dados = evento.data as { tipo?: string; conversa?: string } | null
      if (dados?.tipo !== 'abrir-conversa') return
      setTab('conversas')
      if (dados.conversa) setConversaDoAviso({ id: dados.conversa, vez: Date.now() })
    }
    navigator.serviceWorker.addEventListener('message', aoReceber)
    return () => navigator.serviceWorker.removeEventListener('message', aoReceber)
  }, [])
  const [newPatientSignal, setNewPatientSignal] = useState(0)
  const [preCadastro, setPreCadastro] = useState<
    {
      nome: string
      telefone: string
      dataConsulta?: string
      unidade?: string
      nascimento?: string
      responsavel?: string
      cpf?: string
      email?: string
      voltarPara?: Tab
    } | null
  >(null)
  // Painel e acompanhamento so com quem ja foi atendido (25/10/2026, vindo do
  // sistema do Dr. Marcello; ver lib/paciente-atendido.ts). Sem a marca, todo
  // mundo, como antes. A Agenda e a lista de Pacientes continuam com todos.
  const atendidos = useMemo(() => db.patients.filter((p) => p.atendido !== false), [db.patients])
  const pendentes = dueCount(atendidos, db.etapas)
  const [solicitacoes, setSolicitacoes] = useState<PendingRequest[]>([])
  // Clinica atual, para o logo do menu (ver lib/marca.ts). Comeca pela ultima
  // vista neste navegador para o menu nao piscar a cada recarga.
  const [clinicaId, setClinicaId] = useState<string | null>(ultimaClinicaVista)
  // Quem espera resposta: o paciente no otorrino, a familia na pediatria
  // (15/10/2026, ver publico.ts).
  const geral = publicoDaClinica(clinicaId) === 'geral'
  const marca = clinicaId ? marcaDaClinica(clinicaId) : null
  const logo = marca ? logoNoFundoEscuro(marca) : null
  // Altura do cabecalho do celular, publicada como --altura-topo-celular (27/09/2026).
  // O cabecalho da conversa tambem e grudado no topo, e ficava POR TRAS deste:
  // no celular sumiam o "Todas as conversas" e o nome de quem fala. Medido, e
  // nao chutado, porque o sino abre um painel e a barra muda de altura; no
  // computador ele some (lg:hidden) e a medida vira 0 sozinha.
  // Callback ref, e nao useRef + useEffect([]): na primeira montagem o Home
  // ainda mostra "carregando" e o cabecalho nao existe - o efeito rodava uma
  // vez, nao achava nada e nunca mais media. Assim mede quando ele nasce.
  const observadorDoTopo = useRef<ResizeObserver | null>(null)
  const topoDoCelular = useCallback((alvo: HTMLElement | null) => {
    observadorDoTopo.current?.disconnect()
    observadorDoTopo.current = null
    if (!alvo) return
    const publicar = () =>
      document.documentElement.style.setProperty('--altura-topo-celular', `${alvo.offsetHeight}px`)
    publicar()
    const observador = new ResizeObserver(publicar)
    observador.observe(alvo)
    observadorDoTopo.current = observador
  }, [])
  // O nome de QUEM entrou vem primeiro (01/10/2026). Antes a marca da clinica
  // vencia, e com o Edu entrando com conta propria o rodape dizia "Dr.
  // Marcello Ruiz" para ele tambem - e a foto no topo mostraria o nome errado
  // para os colegas. A marca so cobre conta sem nome.
  const meuNome = String((user?.user_metadata as { full_name?: unknown } | undefined)?.full_name ?? '').trim()
  const nomeNoRodape = meuNome || marca?.nomeNoRodape || 'Equipe clínica'
  const equipeOnline = useEquipeOnline(clinicaId, user?.id ?? null, nomeNoRodape)
  const escolherMinhaFoto = async (arquivo: File) => {
    if (!user?.id) return
    const caminho = await enviarMinhaFoto(user.id, arquivo, equipeOnline.foto)
    equipeOnline.setFoto(caminho)
  }
  // Conversas esperando alguem da equipe (22/09/2026). Ver o bloco do
  // contador, mais abaixo, para o porque.
  const [espera, setEspera] = useState<EsperaDaEquipe & { longa: boolean; ha: string }>({
    total: 0,
    maisAntigaDesde: null,
    longa: false,
    ha: '',
  })

  // Solicitacoes do WhatsApp esperando a equipe. Ficam aqui, e nao dentro da
  // Agenda, porque o aviso precisa aparecer para quem abre o sistema em
  // qualquer tela - a vaga so fica reservada por 24h.
  const carregarSolicitacoes = useCallback(async () => {
    try {
      const membership = await getCurrentMembership()
      if (!membership) return
      setClinicaId(membership.clinicId)
      lembrarClinica(membership.clinicId)
      // Junto das solicitacoes, e no mesmo relogio de 60s: um aviso a mais
      // nao justifica outra rodada de consultas.
      // "Ha quanto tempo" e calculado aqui, na chegada do dado, e nao durante
      // o desenho da tela: o relogio no meio do render faria a tela mudar de
      // opiniao a cada redesenho.
      void conversasEsperandoEquipe(membership.clinicId).then((dados) => {
        const desde = dados.maisAntigaDesde ? new Date(dados.maisAntigaDesde).getTime() : null
        setEspera({
          ...dados,
          longa: desde !== null && Date.now() - desde > ESPERA_LONGA_MS,
          ha: haQuantoTempo(dados.maisAntigaDesde),
        })
      })
      setSolicitacoes(await listPendingRequests(membership.clinicId))
    } catch (cause) {
      console.error('Nao consegui carregar as solicitacoes pendentes', cause)
    }
  }, [])

  useEffect(() => {
    // A carga fica dentro de uma funcao assincrona de proposito: o estado so e
    // tocado depois do await, e nao durante o corpo do efeito.
    void (async () => {
      await carregarSolicitacoes()
    })()
  }, [carregarSolicitacoes])

  // Uma vaga confirmada em outra aba, ou uma solicitacao que venceu, some
  // sozinha na proxima passada.
  useEffect(() => {
    const timer = window.setInterval(() => void carregarSolicitacoes(), 60_000)
    return () => window.clearInterval(timer)
  }, [carregarSolicitacoes])
  /**
   * O contador no titulo da aba do navegador.
   *
   * Em 22/09/2026 quatro familias esperaram a tarde inteira sem resposta, e a
   * unica pista estava dentro da tela de Respostas. Com o numero no titulo -
   * "(3) Central de Cuidado" - quem esta na Agenda, num prontuario, ou ate em
   * outra aba do navegador ve que tem gente esperando. E o mesmo recurso que o
   * WhatsApp Web usa, e por isso a recepcao ja sabe ler.
   */
  // O titulo base vem da marca da clinica (lib/marca.ts): a conta de teste
  // nao leva o nome do Dr. Marcello na aba.
  const tituloDaAba = marca?.titulo ?? 'Central de Cuidado'
  useEffect(() => {
    document.title = espera.total > 0 ? `(${espera.total}) ${tituloDaAba}` : tituloDaAba
  }, [espera.total, tituloDaAba])
  const esperaLonga = espera.longa

  // Atendimentos escritos e sem assinatura digital (06/10/2026). Ver
  // listAtendimentosSemAssinatura. So para quem assina: dono e medico.
  const podeAssinar = role === 'owner' || role === 'clinician'
  const [semAssinatura, setSemAssinatura] = useState<AtendimentoSemAssinatura[]>([])
  const [assinandoEmLote, setAssinandoEmLote] = useState(false)
  const carregarSemAssinatura = useCallback(async () => {
    if (!podeAssinar || !clinicaId) return
    try {
      setSemAssinatura(await listAtendimentosSemAssinatura(clinicaId))
    } catch (erro) {
      // Lembrete, nao trava: sem a lista, o resto do sistema segue inteiro.
      console.warn('Nao consegui listar os atendimentos sem assinatura', erro)
    }
  }, [podeAssinar, clinicaId])
  useEffect(() => {
    // Dentro de uma funcao assincrona, como carregarSolicitacoes: o estado so
    // muda depois do await.
    void (async () => {
      await carregarSemAssinatura()
    })()
    const timer = window.setInterval(() => void carregarSemAssinatura(), 5 * 60_000)
    return () => window.clearInterval(timer)
    // A troca de aba tambem recarrega: quem assinou um prontuario e voltou
    // para a Agenda nao deve ver o aviso velho.
  }, [carregarSemAssinatura, tab])
  const hojeLocal = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
  const semAssinaturaHoje = semAssinatura.filter((a) => a.data === hojeLocal).length

  // O sino do celular (ver o cabecalho mais abaixo).
  const [avisosAbertos, setAvisosAbertos] = useState(false)
  const totalDeAvisos = espera.total + solicitacoes.length + pendentes + semAssinatura.length
  const { perguntar } = useDialogos()
  // Pergunta antes: no celular o botao fica ao lado do sino, e um toque
  // errado derrubava a sessao no meio do atendimento.
  const sairDoSistema = async () => {
    const sair = await perguntar({ titulo: 'Sair do sistema?', confirmar: 'Sair', cancelar: 'Continuar' })
    if (sair) await signOut()
  }

  const meta = PAGE_META[tab]
  // Acessos e Preferencias so para administrador (24/09/2026). Preferencias
  // tem os textos do robo, os dados da clinica e o "apagar tudo": a recepcao
  // nao precisa disso para trabalhar, e um clique errado ali muda o que o
  // robo diz para todas as familias.
  const tabs = role === 'owner'
    ? TABS
    : TABS.filter((item) => item.key !== 'admin' && item.key !== 'config')
  // O voltar do celular volta para a aba de antes (ver useAbasNoHistorico).
  useAbasNoHistorico(tab, setTab, (aba) => tabs.some((item) => item.key === aba))

  /**
   * Aquece a Memed no login, e nao no prontuario.
   *
   * Medido em 21/09/2026: o primeiro Prescrever do dia levou 18,9 segundos, e
   * 7,7 deles foram o download do script da Memed - que ja era "aquecido" ao
   * abrir o prontuario, so que o medico clicou logo em seguida e o aquecimento
   * nao tinha terminado. Do segundo clique em diante, 1,7 s.
   *
   * Entre entrar no sistema e prescrever a primeira receita passam minutos, nao
   * segundos. Esse e o intervalo que o download precisa. Comeca aqui, assim que
   * os dados da clinica carregam, e roda uma vez por sessao.
   *
   * So para quem prescreve: a recepcao nunca abre a Memed, e o script dela nao
   * e leve. Falha nao incomoda ninguem - a proxima tentativa e no clique, com o
   * erro aparecendo ai, como sempre foi.
   */
  useEffect(() => {
    if (loading || loadError) return
    if (role !== 'owner' && role !== 'clinician') return
    void prepararPrescricao().catch(() => {})
  }, [loading, loadError, role])

  // Ver o bloco CHAVE_TOPO_RESPOSTAS, mais acima, para o porque.
  const [topoEscolhido, setTopoEscolhido] = useState<boolean | null>(preferenciaDeTopo)
  const [tela, setTela] = useState(() => ({
    computador: window.matchMedia('(min-width: 1024px)').matches,
    baixa: window.matchMedia('(max-height: 900px)').matches,
  }))
  useEffect(() => {
    const largura = window.matchMedia('(min-width: 1024px)')
    const altura = window.matchMedia('(max-height: 900px)')
    const ver = () => setTela({ computador: largura.matches, baixa: altura.matches })
    ver()
    largura.addEventListener('change', ver)
    altura.addEventListener('change', ver)
    return () => {
      largura.removeEventListener('change', ver)
      altura.removeEventListener('change', ver)
    }
  }, [])

  const topoRecolhido =
    tab === 'conversas' && tela.computador && (topoEscolhido ?? tela.baixa)

  const alternarTopo = () => {
    const proximo = !(topoEscolhido ?? tela.baixa)
    setTopoEscolhido(proximo)
    try {
      localStorage.setItem(CHAVE_TOPO_RESPOSTAS, proximo ? 'recolhido' : 'aberto')
    } catch {
      // Sem guardar: vale para esta sessao e pronto. Nao e motivo para quebrar.
    }
  }

  function createPatient() {
    setPreCadastro(null)
    setTab('pacientes')
    setNewPatientSignal((value) => value + 1)
  }

  /**
   * Cadastro que comeca de uma conversa ou de uma consulta. Leva nome e
   * telefone prontos para a tela de pacientes - a equipe so confere e completa.
   *
   * `voltarPara` diz de onde a pessoa veio: quem cadastra a partir da agenda
   * quer seguir organizando a agenda, e nao cair no prontuario.
   */
  function cadastrarContato(
    dados: {
      nome: string
      telefone: string
      dataConsulta?: string
      unidade?: string
      nascimento?: string
      responsavel?: string
      cpf?: string
      email?: string
    },
    voltarPara?: Tab,
  ) {
    setPreCadastro({ ...dados, voltarPara })
    setTab('pacientes')
    setNewPatientSignal((value) => value + 1)
  }

  if (loading) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#f7f5f1] text-[#081b2c]">
        <div className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-[20px] bg-[#081b2c] text-[#6fadde] shadow-[0_18px_45px_rgba(8,27,44,.18)]">
            <HeartHandshake className="h-6 w-6 animate-pulse" />
          </span>
          <p className="mt-4 text-xs font-extrabold uppercase tracking-[0.16em] text-slate-400">
            Carregando dados da clínica
          </p>
        </div>
      </main>
    )
  }

  // So a falha da carga inicial troca o sistema inteiro por esta tela. Erro de
  // uma acao (um envio que nao saiu, por exemplo) vira aviso, sem derrubar o
  // que a pessoa estava fazendo.
  if (loadError) {
    const pendingApproval = loadError === PENDING_ACCESS_MESSAGE
    return (
      <main className="flex min-h-dvh items-center justify-center bg-[#f7f5f1] px-4 text-[#081b2c]">
        <section className="surface-card w-full max-w-md rounded-[28px] p-7 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-500">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <h1 className="mt-4 text-lg font-extrabold">
            {pendingApproval ? 'Aguardando aprovação' : 'Não foi possível carregar os dados'}
          </h1>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            {pendingApproval
              ? 'Seu pedido foi registrado. Assim que o administrador aprovar, entre novamente para acessar a Central de Cuidado.'
              : loadError}
          </p>
          <button
            type="button"
            onClick={() => (pendingApproval ? void signOut() : void retry())}
            className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-[#081b2c] px-5 py-3 text-xs font-extrabold text-white"
          >
            {pendingApproval ? <LogOut className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
            {pendingApproval ? 'Voltar para entrar' : 'Tentar novamente'}
          </button>
        </section>
      </main>
    )
  }

  return (
    <div className="min-h-dvh bg-[#f7f5f1] text-[#081b2c]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[286px] flex-col overflow-hidden bg-[#081b2c] text-white lg:flex">
        {/* Arte de otorrino (15/10/2026), no lugar do aparelho digestivo do
            Dr. Marcello. O foco em 40% da largura mantem o nariz e o ouvido
            dentro da coluna, do notebook ao monitor alto (ver
            src/assets/README.md). */}
        <img
          src={arteDoMenu}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-[40%_center] opacity-[0.17] mix-blend-screen select-none"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#081b2c]/80 via-[#081b2c]/25 to-[#081b2c]/80" />
        <div className="soft-grid absolute inset-0 opacity-40" />
        <div className="absolute -right-24 top-24 h-64 w-64 rounded-full bg-[#2f7fc1]/10 blur-3xl" />
        <div className="relative flex h-full flex-col">
          <div className="px-7 pb-7 pt-8 [@media(max-height:820px)]:pb-4 [@media(max-height:820px)]:pt-5">
            {marca && logo ? (
              <img src={logo.src} alt={marca.nome} className={`h-12 w-auto max-w-[230px] ${logo.classe} [@media(max-height:820px)]:h-9`} />
            ) : (
              <div className="h-12 [@media(max-height:820px)]:h-9" aria-hidden="true" />
            )}
            {marca?.mostraEtiquetaDoProduto && (
              <div className="mt-5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-white/45 [@media(max-height:820px)]:mt-3">
                <HeartHandshake className="h-3.5 w-3.5 text-[#6aa8d9]" />
                Central de cuidado
              </div>
            )}
            {/* Versao publicada, logo abaixo do nome: e o que responde, sem
                adivinhacao, se a tela aberta ja e a de depois da ultima
                publicacao. Ficava no rodape, mas em tela menor o rodape nao
                aparece, e a pergunta "qual versao?" e feita justamente quando
                algo esta estranho. O "typeof" evita que a etiqueta derrube a
                pagina se um dia o build sair sem as variaveis - ja aconteceu. */}
            <p className="mt-2 text-[10px] font-semibold tracking-[0.08em] text-white/35">
              Versão {typeof __COMMIT__ === 'string' ? __COMMIT__ : '?'} ·{' '}
              {typeof __VERSAO__ === 'string' ? __VERSAO__ : '?'}
            </p>
          </div>

          <div className="mx-7 h-px bg-white/10" />

          <nav
            /* Em tela baixa o menu passava por baixo do cartao "Dados
               protegidos" e os ultimos itens ficavam inalcancaveis: nao havia
               rolagem, porque o aside inteiro era overflow-hidden. Agora a
               lista rola sozinha e os itens encolhem antes disso. */
            className="scrollbar-subtle mt-6 min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 [@media(max-height:820px)]:mt-3 [@media(max-height:820px)]:space-y-0.5"
            aria-label="Navegação principal"
          >
            <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.2em] text-white/30">Menu</p>
            {tabs.map((item) => {
              const active = tab === item.key
              const Icon = item.icon
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setTab(item.key)}
                  aria-current={active ? 'page' : undefined}
                  className={`group flex w-full items-center gap-3 rounded-2xl px-3.5 py-3.5 text-sm font-semibold transition-all [@media(max-height:820px)]:py-2.5 ${
                    active
                      ? 'bg-white text-[#081b2c] shadow-[0_12px_28px_rgba(0,0,0,.18)]'
                      : 'text-white/55 hover:bg-white/[0.06] hover:text-white'
                  }`}
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors [@media(max-height:820px)]:h-8 [@media(max-height:820px)]:w-8 ${
                      active ? 'bg-[#d9e8f7] text-[#1f4f78]' : 'bg-white/[0.055] text-white/60 group-hover:text-white'
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                  </span>
                  <span className="flex-1 text-left">{item.label}</span>
                  {/* A Agenda usa vermelho porque a solicitacao tem prazo: a
                      vaga fica reservada 24h e depois volta para a fila. */}
                  {item.key === 'agenda' && solicitacoes.length > 0 ? (
                    <span className={`min-w-6 rounded-full px-1.5 py-1 text-center text-[10px] font-extrabold ${
                      active ? 'bg-[#081b2c] text-white' : 'bg-red-500 text-white'
                    }`}>
                      {solicitacoes.length}
                    </span>
                  ) : item.key === 'conversas' && espera.total > 0 ? (
                    /* Ambar enquanto a espera e curta; vermelho depois de meia
                       hora, que e quando "chegou agora" virou "esquecido". */
                    <span
                      title={`${espera.total} ${espera.total === 1 ? 'conversa esperando' : 'conversas esperando'} a equipe. A mais antiga: ${espera.ha}.`}
                      className={`min-w-6 rounded-full px-1.5 py-1 text-center text-[10px] font-extrabold ${
                        active
                          ? 'bg-[#081b2c] text-white'
                          : esperaLonga
                            ? 'bg-red-500 text-white'
                            : 'bg-[#e0a33a] text-[#081b2c]'
                      }`}
                    >
                      {espera.total}
                    </span>
                  ) : item.key === 'followups' && pendentes > 0 ? (
                    <span className={`min-w-6 rounded-full px-1.5 py-1 text-center text-[10px] font-extrabold ${
                      active ? 'bg-[#081b2c] text-white' : 'bg-[#3585c6] text-white'
                    }`}>
                      {pendentes}
                    </span>
                  ) : active ? (
                    <ChevronRight className="h-4 w-4 text-[#2f7fc1]" />
                  ) : null}
                </button>
              )
            })}
          </nav>

          <div className="relative mx-4 mb-4 overflow-hidden rounded-[22px] border border-white/10 bg-white/[0.055] p-4 [@media(max-height:900px)]:hidden">
            <div className="absolute -right-5 -top-5 h-20 w-20 rounded-full bg-[#2f7fc1]/15 blur-2xl" />
            <div className="relative flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#2f7fc1] text-white">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-bold text-white/90">Dados protegidos</p>
                <p className="mt-0.5 text-[10px] leading-relaxed text-white/40">Sincronizados com acesso protegido</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 border-t border-white/10 px-6 py-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.07]">
              <CircleUserRound className="h-5 w-5 text-white/60" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-white/90">{nomeNoRodape}</p>
              <p className="mt-0.5 truncate text-[10px] text-white/40">{user?.email ?? 'Equipe clínica'}</p>
            </div>
            <button
              type="button"
              onClick={() => void signOut()}
              aria-label="Sair do sistema"
              title="Sair do sistema"
              className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-white/45 transition hover:bg-white/[0.1] hover:text-white"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Cabecalho do celular.
          Ate 27/09/2026 o sino so levava para Acompanhamentos - e quem ja
          estava la tocava e nada acontecia, parecia quebrado. E o numero dele
          contava so acompanhamento, deixando de fora justamente o que tem
          pressa: familia esperando resposta e pedido de horario. Agora ele abre
          a lista do que pede atencao, cada linha levando para a tela certa.
          O botao de sair nao existia no celular: o do rodape do menu lateral
          so aparece no computador. */}
      <header
        ref={topoDoCelular}
        className="sticky top-0 z-30 border-b border-white/10 bg-[#081b2c]/95 px-4 py-3 text-white backdrop-blur-xl lg:hidden"
      >
        <div className="relative mx-auto flex max-w-2xl items-center justify-between">
          {marca && logo ? (
            <img src={logo.src} alt={marca.nome} className={`h-7 w-auto max-w-[120px] ${logo.classe} min-[400px]:h-8 min-[400px]:max-w-[150px]`} />
          ) : (
            <div className="h-8" aria-hidden="true" />
          )}
          <div className="flex items-center gap-2">
            {/* Modo WhatsApp (02/10/2026): leva a Respostas ja em tela cheia,
                lista e conversa como no app. "Chat normal", la dentro, volta. */}
            <button
              type="button"
              onClick={() => {
                ligarModoWhatsApp()
                setTab('conversas')
              }}
              aria-label="Abrir conversas no modo WhatsApp"
              title="Modo WhatsApp"
              className="pulso-whatsapp flex h-10 w-10 items-center justify-center rounded-xl bg-[#2f7fc1] text-white"
            >
              <MessageCircle className="h-[19px] w-[19px]" />
            </button>
            <QuemEstaOnline
              nome={nomeNoRodape}
              foto={equipeOnline.foto}
              outros={equipeOnline.outros}
              tema="escuro"
              onEscolherFoto={escolherMinhaFoto}
            />
            <button
              type="button"
              onClick={() => setAvisosAbertos((aberto) => !aberto)}
              aria-expanded={avisosAbertos}
              aria-label={totalDeAvisos > 0 ? `${totalDeAvisos} ${totalDeAvisos === 1 ? 'item pede' : 'itens pedem'} atenção` : 'Nada pedindo atenção'}
              className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.07]"
            >
              <Bell className="h-[18px] w-[18px] text-white/75" />
              {totalDeAvisos > 0 && (
                <span
                  className={`absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[9px] font-extrabold ring-2 ring-[#081b2c] ${
                    esperaLonga || solicitacoes.length > 0 ? 'bg-red-500 text-white' : 'bg-[#4a94cf] text-white'
                  }`}
                >
                  {totalDeAvisos}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => void sairDoSistema()}
              aria-label="Sair do sistema"
              title="Sair do sistema"
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.07] text-white/60"
            >
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </div>

          {avisosAbertos && (
            <>
              {/* Toque fora fecha. */}
              <button
                type="button"
                aria-label="Fechar avisos"
                onClick={() => setAvisosAbertos(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div className="absolute right-0 top-12 z-50 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[#081b2c]/10 bg-white text-[#081b2c] shadow-[0_18px_42px_rgba(8,27,44,.25)]">
                <p className="border-b border-[#081b2c]/[0.07] px-4 py-3 text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#1f4f78]">
                  Pede atenção
                </p>
                {totalDeAvisos === 0 ? (
                  <p className="px-4 py-5 text-xs text-slate-500">Nada esperando agora. Tudo em dia.</p>
                ) : (
                  <ul className="divide-y divide-[#081b2c]/[0.06]">
                    {[
                      {
                        chave: 'conversas' as Tab,
                        n: espera.total,
                        titulo: geral
                          ? espera.total === 1 ? 'paciente esperando resposta' : 'pacientes esperando resposta'
                          : espera.total === 1 ? 'família esperando resposta' : 'famílias esperando resposta',
                        detalhe: espera.total > 0 ? `A mais antiga: ${espera.ha}` : '',
                        cor: esperaLonga ? 'bg-red-500' : 'bg-[#e0a33a]',
                      },
                      {
                        chave: 'agenda' as Tab,
                        n: solicitacoes.length,
                        titulo: solicitacoes.length === 1 ? 'pedido de horário para confirmar' : 'pedidos de horário para confirmar',
                        detalhe: 'A vaga fica reservada por 24h',
                        cor: 'bg-red-500',
                      },
                      {
                        chave: 'followups' as Tab,
                        n: pendentes,
                        titulo: pendentes === 1 ? 'acompanhamento para hoje ou atrasado' : 'acompanhamentos para hoje ou atrasados',
                        detalhe: 'Saem sozinhos às 9h; aqui dá para antecipar',
                        cor: 'bg-[#4a94cf]',
                      },
                    ]
                      .filter((aviso) => aviso.n > 0)
                      .map((aviso) => (
                        <li key={aviso.chave}>
                          <button
                            type="button"
                            onClick={() => {
                              setAvisosAbertos(false)
                              setTab(aviso.chave)
                            }}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[#f4f8f7]"
                          >
                            <span className={`flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-[11px] font-extrabold text-white ${aviso.cor}`}>
                              {aviso.n}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-xs font-bold">{aviso.titulo}</span>
                              {aviso.detalhe && <span className="mt-0.5 block text-[10px] text-slate-400">{aviso.detalhe}</span>}
                            </span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                          </button>
                        </li>
                      ))}
                    {semAssinatura.length > 0 && (
                      <li>
                        <button
                          type="button"
                          onClick={() => {
                            setAvisosAbertos(false)
                            setAssinandoEmLote(true)
                          }}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[#f4f8f7]"
                        >
                          <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-[#1f4f78] px-1.5 text-[11px] font-extrabold text-white">
                            {semAssinatura.length}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-bold">
                              {semAssinatura.length === 1 ? 'atendimento sem assinatura' : 'atendimentos sem assinatura'}
                            </span>
                            <span className="mt-0.5 block text-[10px] text-slate-400">Toque para assinar todos de uma vez</span>
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      <main className="relative min-h-dvh pb-28 lg:ml-[286px] lg:pb-12">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-80 overflow-hidden">
          <div className="absolute -right-20 -top-32 h-96 w-96 rounded-full bg-[#86bce4]/10 blur-3xl" />
          <div className="absolute left-1/3 -top-48 h-80 w-80 rounded-full bg-[#9fc2b8]/10 blur-3xl" />
        </div>

        <div
          className={`relative mx-auto max-w-[1460px] px-4 sm:px-7 lg:px-10 xl:px-12 ${
            topoRecolhido ? 'py-4 lg:py-4' : 'py-6 lg:py-9'
          }`}
        >
          <div
            className={`mb-7 flex-col gap-5 xl:mb-8 xl:flex-row xl:items-end xl:justify-between ${
              topoRecolhido ? 'hidden' : 'flex'
            }`}
          >
            <div>
              <div className="mb-2 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#1f4f78]">
                <Sparkles className="h-3.5 w-3.5" />
                {meta.eyebrow}
              </div>
              <h1 className="text-2xl font-extrabold tracking-[-0.035em] text-[#081b2c] sm:text-3xl lg:text-[34px]">
                {meta.title}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">{meta.subtitle}</p>
            </div>

            <div className="flex items-center gap-3">
              <div className="hidden lg:block">
                <QuemEstaOnline
                  nome={nomeNoRodape}
                  foto={equipeOnline.foto}
                  outros={equipeOnline.outros}
                  tema="claro"
                  onEscolherFoto={escolherMinhaFoto}
                />
              </div>
              <div className="hidden items-center gap-2.5 rounded-2xl border border-[#081b2c]/[0.07] bg-white/70 px-4 py-3 text-xs font-semibold text-slate-500 shadow-sm backdrop-blur sm:flex">
                <CalendarDays className="h-4 w-4 text-[#2f7fc1]" />
                {formatToday()}
              </div>
              <button
                type="button"
                onClick={createPatient}
                className="group flex flex-1 items-center justify-center gap-2 rounded-2xl bg-[#081b2c] px-5 py-3 text-xs font-bold text-white shadow-[0_12px_26px_rgba(8,27,44,.18)] transition hover:-translate-y-0.5 hover:bg-[#102d47] sm:flex-none"
              >
                <Plus className="h-4 w-4 text-[#6fadde] transition-transform group-hover:rotate-90" />
                Novo paciente
              </button>
            </div>
          </div>

          {/* Lembrete de assinatura (06/10/2026): pedido do Dr. Marcello, que
              esquecia de assinar. Fica no topo de qualquer aba ate zerar. */}
          {podeAssinar && semAssinatura.length > 0 && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-[#2f7fc1]/20 bg-[#eef5fd] px-4 py-3">
              <p className="flex items-center gap-2.5 text-xs font-bold text-[#16456b]">
                <PenLine className="h-4 w-4 shrink-0 text-[#2f7fc1]" />
                <span>
                  {semAssinatura.length === 1
                    ? '1 atendimento sem assinatura digital'
                    : `${semAssinatura.length} atendimentos sem assinatura digital`}
                  {semAssinaturaHoje > 0 && semAssinaturaHoje < semAssinatura.length && (
                    <span className="font-semibold text-[#3c6b91]"> · {semAssinaturaHoje} de hoje</span>
                  )}
                </span>
              </p>
              <button
                type="button"
                onClick={() => setAssinandoEmLote(true)}
                className="rounded-xl bg-[#081b2c] px-4 py-2 text-[11px] font-extrabold text-white transition hover:bg-[#102d47]"
              >
                Assinar todos
              </button>
            </div>
          )}
          {assinandoEmLote && (
            <AssinaturaEmLote
              pendentes={semAssinatura}
              onFechar={() => {
                setAssinandoEmLote(false)
                void carregarSemAssinatura()
              }}
            />
          )}

          <div key={tab} className="animate-enter">
            {/* Erro numa aba fica nela: ver AbaProtegida. */}
            <AbaProtegida key={tab} nome={tab}>
            {tab === 'dashboard' && (
              <Dashboard
                patients={atendidos}
                etapas={db.etapas}
                solicitacoes={solicitacoes}
                onAbrirAgenda={() => setTab('agenda')}
              />
            )}
            {tab === 'followups' && (
              <Followups
                patients={atendidos}
                etapas={db.etapas}
                templates={db.templates}
                setFollowup={setFollowup}
                onAbrirConversa={(patientId) => {
                  setConversaFoco(patientId)
                  setTab('conversas')
                }}
              />
            )}
            {tab === 'agenda' && (
              <Agenda
                patients={db.patients}
                onSolicitacoesMudaram={carregarSolicitacoes}
                onCadastrarContato={(dados) => cadastrarContato(dados, 'agenda')}
                // So para quem atende: a recepcao nao ve o prontuario (o banco
                // nem entrega as consultas), entao o botao nem aparece.
                onAbrirProntuario={
                  role === 'owner' || role === 'clinician'
                    ? (patientId) => {
                        setProntuarioDaAgenda(patientId)
                        setTab('pacientes')
                      }
                    : undefined
                }
              />
            )}
            {tab === 'conversas' && (
              <Conversations
                focoPatientId={conversaFoco}
                focoConversa={conversaDoAviso}
                onCadastrarContato={cadastrarContato}
                compacto={topoRecolhido}
                onAlternarCompacto={tela.computador ? alternarTopo : undefined}
              />
            )}
            {tab === 'pacientes' && (
              <Patients
                patients={db.patients}
                etapas={db.etapas}
                addPatient={addPatient}
                updatePatient={updatePatient}
                removePatient={removePatient}
            listArchived={listArchived}
            restorePatient={restorePatient}
                listConsultations={getConsultations}
                addConsultation={addConsultation}
                updateConsultation={updateConsultation}
                openCreateSignal={newPatientSignal}
                abrirProntuarioDe={prontuarioDaAgenda}
                onProntuarioDaAgendaAberto={() => setProntuarioDaAgenda(null)}
                onVoltarParaAgenda={() => setTab('agenda')}
                preCadastro={preCadastro}
                onPacienteCriado={() => {
                  const destino = preCadastro?.voltarPara
                  setPreCadastro(null)
                  if (destino) {
                    setTab(destino)
                    void carregarSolicitacoes()
                  }
                }}
              />
            )}
            {tab === 'config' && role === 'owner' && (
              <Settings db={db} setTemplates={setTemplates} setEtapas={setEtapas} importDb={importDb} clearAll={clearAll} />
            )}
            {tab === 'admin' && role === 'owner' && <AccessAdmin />}
            </AbaProtegida>
          </div>
        </div>
      </main>

      <ConviteParaAvisos clinicId={clinicaId} />

      <nav
        className="fixed inset-x-3 bottom-3 z-40 flex rounded-[22px] border border-[#081b2c]/10 bg-white/95 px-1.5 py-1.5 shadow-[0_18px_55px_rgba(8,27,44,.2)] backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: 'max(.375rem, env(safe-area-inset-bottom))' }}
        aria-label="Navegação móvel"
      >
        {tabs.map((item) => {
          const active = tab === item.key
          const Icon = item.icon
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              aria-current={active ? 'page' : undefined}
              className={`relative flex flex-1 flex-col items-center gap-1 rounded-[17px] px-1 py-2.5 text-[9px] font-bold transition-colors ${
                active ? 'bg-[#081b2c] text-white' : 'text-slate-400'
              }`}
            >
              <Icon className={`h-[18px] w-[18px] ${active ? 'text-[#6fadde]' : ''}`} strokeWidth={2} />
              <span>{item.shortLabel}</span>
              {item.key === 'followups' && pendentes > 0 && !active && (
                <span className="absolute right-[25%] top-1.5 h-2 w-2 rounded-full bg-[#2f7fc1] ring-2 ring-white" />
              )}
              {item.key === 'conversas' && espera.total > 0 && !active && (
                <span
                  className={`absolute right-[25%] top-1.5 h-2 w-2 rounded-full ring-2 ring-white ${
                    esperaLonga ? 'bg-red-500' : 'bg-[#e0a33a]'
                  }`}
                />
              )}
            </button>
          )
        })}
      </nav>
    </div>
  )
}
