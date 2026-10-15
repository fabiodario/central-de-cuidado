import {
  AlertCircle,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock3,
  HeartHandshake,
  MessageCircle,
  MessageSquareText,
  Send,
  ShieldCheck,
  Sparkles,
  Stethoscope,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useDialogos } from '@/components/dialogos-contexto'
import type { FollowupKey, FollowupStatus, Patient } from '@/types/patient'
import {
  fmtBR,
  pendingFollowups,
  situacaoDoEnvio,
  type FollowupItem,
  type SituacaoDoEnvio,
} from '@/lib/followup'
import { supabase } from '@/lib/supabase'
import { situacaoDosAcompanhamentos } from '@/lib/repository'
import { SaudeDosEnvios } from '@/components/SaudeDosEnvios'

const NAVY = '#081b2c'
const AZUL = '#2f7fc1'
/** Cor de cada etapa: azul aos 15 dias, verde aos 30, marinho aos 90. */
const COR_DA_ETAPA: Record<FollowupKey, string> = { d15: AZUL, d30: '#6f9d91', m90: NAVY }

interface Props {
  patients: Patient[]
  templates: Record<FollowupKey, string>
  setFollowup: (id: string, key: FollowupKey, status: FollowupStatus) => Promise<void>
  /** Leva direto para a conversa do paciente, sem passar pelo menu Respostas. */
  onAbrirConversa: (patientId: string) => void
}

type Accent = 'danger' | 'today' | 'upcoming' | 'scheduled' | 'sent'

const GROUP_STYLE: Record<Accent, { text: string; bg: string; icon: typeof AlertCircle }> = {
  danger: { text: 'text-[#c64d4a]', bg: 'bg-[#c64d4a]', icon: AlertCircle },
  today: { text: 'text-[#1f4f78]', bg: 'bg-[#2f7fc1]', icon: Sparkles },
  upcoming: { text: 'text-[#557f75]', bg: 'bg-[#6f9d91]', icon: CalendarClock },
  scheduled: { text: 'text-slate-500', bg: 'bg-slate-400', icon: Clock3 },
  sent: { text: 'text-[#47766b]', bg: 'bg-[#6f9d91]', icon: Send },
}

/** Etiqueta do que ja saiu: o que o WhatsApp confirmou, com a data do envio. */
const ETIQUETA_DO_ENVIO: Record<SituacaoDoEnvio, { texto: string; classe: string }> = {
  lida: { texto: 'Lida', classe: 'bg-[#e8f5ec] text-[#1c6b3a]' },
  entregue: { texto: 'Entregue', classe: 'bg-[#e9f4f1] text-[#47766b]' },
  enviada: { texto: 'Enviada', classe: 'bg-[#e9f4f1] text-[#47766b]' },
  falhou: { texto: 'Envio falhou', classe: 'bg-[#fceceb] text-[#b42318]' },
}

function initials(name: string) {
  return name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

type FunctionPayload = {
  code?: string
  error?: string
  details?: string
  hint?: string | null
  alreadySent?: boolean
}

/** Junta mensagem, codigo e detalhe tecnico para o erro na tela ser diagnosticavel. */
function describeFailure(payload: FunctionPayload | null, fallback: string): string {
  const base = payload?.error || fallback
  const extras = [payload?.details, payload?.hint].filter(Boolean).join(' - ')
  const code = payload?.code ? ` [${payload.code}]` : ''
  return extras ? `${base}${code}\n\nDetalhe tecnico: ${extras}` : `${base}${code}`
}

async function readFunctionError(error: unknown): Promise<FunctionPayload | null> {
  const context = (error as { context?: Response } | null)?.context
  if (!context || typeof context.clone !== 'function') return null

  try {
    return (await context.clone().json()) as FunctionPayload
  } catch {
    return null
  }
}

function Group({
  title,
  hint,
  items,
  accent,
  children,
}: {
  title: string
  hint: string
  items: FollowupItem[]
  accent: Accent
  children: (item: FollowupItem) => React.ReactNode
}) {
  if (items.length === 0) return null
  const style = GROUP_STYLE[accent]
  const Icon = style.icon

  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${style.bg} text-white shadow-sm`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className={`text-xs font-extrabold uppercase tracking-[0.12em] ${style.text}`}>{title}</h2>
            <span className="rounded-full bg-[#081b2c]/[0.055] px-2 py-0.5 text-[9px] font-extrabold text-slate-500">
              {items.length}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[10px] text-slate-400">{hint}</p>
        </div>
        <div className="h-px flex-1 bg-[#081b2c]/[0.06]" />
      </div>
      <div className="space-y-2.5">{items.map(children)}</div>
    </section>
  )
}

export default function Followups({ patients, setFollowup, onAbrirConversa }: Props) {
  const [sending, setSending] = useState<string | null>(null)
  const { avisar, perguntar } = useDialogos()
  const [situacoes, setSituacoes] = useState<Map<string, SituacaoDoEnvio | null>>(new Map())
  const items = pendingFollowups(patients)

  // Ids dos que ja sairam, numa string so: muda quando um novo e enviado, e
  // nao a cada renderizacao (a lista de pacientes e recriada a cada carga).
  const idsEnviados = items
    .filter((item) => item.urgencia === 'aguardando')
    .map((item) => item.patient.followups[item.key].id)
    .filter((id): id is string => Boolean(id))
    .sort()
    .join(',')

  useEffect(() => {
    if (!idsEnviados) return
    let vivo = true
    situacaoDosAcompanhamentos(idsEnviados.split(','))
      .then((mapa) => {
        if (!vivo) return
        const novo = new Map<string, SituacaoDoEnvio | null>()
        for (const [id, statuses] of mapa) novo.set(id, situacaoDoEnvio(statuses))
        setSituacoes(novo)
      })
      .catch((erro) => {
        // Sem a situacao, a etiqueta fica "Enviada" - nao inventa leitura.
        console.warn('Nao consegui ler a situacao dos envios', erro)
      })
    return () => {
      vivo = false
    }
  }, [idsEnviados])

  const situacaoDe = (item: FollowupItem) => situacoes.get(item.patient.followups[item.key].id ?? '') ?? null

  // Enviado que falhou nao e "aguardando": volta para o grupo da data, que e
  // onde a equipe procura o que precisa de acao.
  const grupoDe = useMemo(
    () => (item: FollowupItem) => {
      if (item.urgencia !== 'aguardando') return item.urgencia
      if (situacoes.get(item.patient.followups[item.key].id ?? '') !== 'falhou') return 'aguardando'
      return item.dias > 0 ? 'atrasado' : item.dias === 0 ? 'hoje' : item.dias >= -7 ? 'proximo' : 'futuro'
    },
    [situacoes],
  )
  const overdue = items.filter((item) => grupoDe(item) === 'atrasado')
  const today = items.filter((item) => grupoDe(item) === 'hoje')
  const upcoming = items.filter((item) => grupoDe(item) === 'proximo')
  const scheduled = items.filter((item) => grupoDe(item) === 'futuro')
  const aguardando = items.filter((item) => grupoDe(item) === 'aguardando')
  const completed = patients
    .flatMap((patient) => [patient.followups.d15, patient.followups.d30, patient.followups.m90])
    .filter((followup) => followup.status === 'concluido').length
  const sent = items.filter((item) => item.patient.followups[item.key].status === 'enviado').length

  async function send(item: FollowupItem, consentConfirmed = false) {
    const followupId = item.patient.followups[item.key].id
    if (!followupId) {
      avisar('Este acompanhamento ainda não terminou de carregar. Atualize a página e tente de novo.', 'erro')
      return
    }

    const sendingKey = `${item.patient.id}-${item.key}`
    setSending(sendingKey)
    try {
      const { data, error } = await supabase.functions.invoke('whatsapp-send', {
        body: { followupId, consentConfirmed },
      })

      const errorPayload = error ? await readFunctionError(error) : null
      const responsePayload = (data ?? errorPayload) as FunctionPayload | null

      if (responsePayload?.code === 'CONSENT_REQUIRED' && !consentConfirmed) {
        const confirmed = await perguntar({
          titulo: `${item.patient.responsavel || item.patient.nome} autorizou receber mensagens no WhatsApp?`,
          detalhe:
            'A autorização fica registrada no cadastro. Ela vale para os acompanhamentos de 15, 30 e 90 dias, e a família pode sair a qualquer momento respondendo SAIR.',
          confirmar: 'Sim, autorizou',
          cancelar: 'Ainda não',
        })
        if (confirmed) await send(item, true)
        return
      }
      if (error) throw new Error(describeFailure(responsePayload, error.message))
      if (responsePayload?.error) throw new Error(describeFailure(responsePayload, 'Falha no envio.'))

      await setFollowup(item.patient.id, item.key, 'enviado')
      avisar(
        responsePayload?.alreadySent
          ? 'Esta mensagem já havia sido enviada.'
          : `Mensagem enviada para ${item.patient.nome} pelo WhatsApp.`,
      )
    } catch (cause) {
      avisar(cause instanceof Error ? cause.message : 'Não foi possível enviar a mensagem.', 'erro')
    } finally {
      setSending((current) => (current === sendingKey ? null : current))
    }
  }

  function dueLabel(item: FollowupItem) {
    if (item.dias > 1) return `${item.dias} dias em atraso`
    if (item.dias === 1) return '1 dia em atraso'
    if (item.dias === 0) return 'Vence hoje'
    if (item.dias === -1) return 'Amanhã'
    return `Em ${Math.abs(item.dias)} dias`
  }

  function card(item: FollowupItem) {
    const patient = item.patient
    const wasSent = patient.followups[item.key].status === 'enviado'
    const sendingKey = `${patient.id}-${item.key}`
    const isSending = sending === sendingKey
    const grupo = grupoDe(item)
    const isOverdue = grupo === 'atrasado'
    const isToday = grupo === 'hoje'
    const situacao = wasSent ? (situacaoDe(item) ?? 'enviada') : null
    const enviadoEm = patient.followups[item.key].enviadoEm
    const accent = isOverdue ? '#c94f4c' : isToday ? AZUL : COR_DA_ETAPA[item.key]

    return (
      <article
        key={`${patient.id}-${item.key}`}
        className="surface-card group relative overflow-hidden rounded-[22px] p-4 transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(8,27,44,.08)] sm:p-5"
      >
        <span className="absolute inset-y-4 left-0 w-1 rounded-r-full" style={{ background: accent }} />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] text-xs font-extrabold"
              style={{ background: `${accent}14`, color: accent }}
            >
              {initials(patient.nome)}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-extrabold tracking-[-0.02em] text-[#081b2c]">{patient.nome}</h3>
                <span
                  className="rounded-full px-2 py-1 text-[8px] font-extrabold uppercase tracking-[0.12em]"
                  style={{ background: `${COR_DA_ETAPA[item.key]}12`, color: COR_DA_ETAPA[item.key] }}
                >
                  {item.label}
                </span>
                {/* Ate 25/09/2026 dizia "mensagem aberta" para todo enviado, e a
                    equipe entendia que a familia tinha aberto. Agora diz o que
                    o WhatsApp confirmou, e quando saiu. */}
                {situacao && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[8px] font-extrabold uppercase tracking-[0.1em] ${ETIQUETA_DO_ENVIO[situacao].classe}`}
                  >
                    <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    {ETIQUETA_DO_ENVIO[situacao].texto}
                    {enviadoEm ? ` · ${fmtBR(enviadoEm.slice(0, 10))}` : ''}
                  </span>
                )}
                {/* Sem isto a equipe olha a fila e acha que precisa clicar em
                    tudo, sem saber que o sistema envia sozinho no dia certo. */}
                {!wasSent && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#f2f5f4] px-2 py-1 text-[8px] font-extrabold uppercase tracking-[0.1em] text-[#6b7c86]">
                    <Clock3 className="h-2.5 w-2.5" strokeWidth={3} />
                    {isOverdue || isToday
                      ? 'sai automático hoje às 9h'
                      : `envio automático em ${fmtBR(item.due)}`}
                  </span>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-semibold text-slate-400">
                <span className="inline-flex items-center gap-1.5" style={{ color: isOverdue || isToday ? accent : undefined }}>
                  <Clock3 className="h-3.5 w-3.5" />
                  {grupo === 'aguardando' ? `Previsto para ${fmtBR(item.due)}` : `${dueLabel(item)} · ${fmtBR(item.due)}`}
                </span>
                <span className="hidden text-slate-300 sm:inline">•</span>
                <span>Consulta em {fmtBR(patient.dataConsulta)}</span>
                {patient.responsavel && (
                  <>
                    <span className="hidden text-slate-300 sm:inline">•</span>
                    <span>Resp. {patient.responsavel}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 gap-2 pl-14 sm:pl-0">
            <button
              type="button"
              onClick={() => void send(item)}
              disabled={isSending || wasSent}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-[10px] font-extrabold transition disabled:cursor-not-allowed disabled:opacity-55 sm:flex-none ${
                wasSent
                  ? 'bg-[#e9f4f1] text-[#47766b]'
                  : 'border border-[#1fbd69]/35 bg-[#f2fbf6] text-[#1a8a4f] hover:border-[#1fbd69] hover:bg-[#e6f7ee]'
              }`}
              title={wasSent ? 'Ja enviado' : 'Antecipa o envio que aconteceria automaticamente'}
              aria-label={`Enviar WhatsApp para ${patient.nome}`}
            >
              <Send className="h-4 w-4" strokeWidth={2} />
              {isSending ? 'Enviando...' : wasSent ? 'Enviado' : 'Antecipar envio'}
            </button>
            <button
              type="button"
              onClick={() => {
                void setFollowup(patient.id, item.key, 'concluido')
                  .then(() => avisar(`Acompanhamento de ${patient.nome} concluído.`))
                  .catch((cause) => {
                    avisar(
                      cause instanceof Error ? cause.message : 'Não foi possível concluir o acompanhamento.',
                      'erro',
                    )
                  })
              }}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-[#6f9d91]/35 bg-[#f4f8f7] px-3 py-2.5 text-[10px] font-extrabold text-[#4f796f] transition hover:border-[#6f9d91] hover:bg-[#eaf3f0]"
              aria-label={`Concluir acompanhamento de ${patient.nome}`}
            >
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
              <span className="hidden min-[420px]:inline">Concluir</span>
            </button>
            <button
              type="button"
              onClick={() => onAbrirConversa(patient.id)}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-[#081b2c]/12 bg-white px-3 py-2.5 text-[10px] font-extrabold text-[#557f75] transition hover:border-[#081b2c]/25 hover:bg-[#fafaf8]"
              aria-label={`Abrir conversa de ${patient.nome}`}
              title="Abrir a conversa deste paciente"
            >
              <MessageSquareText className="h-3.5 w-3.5" strokeWidth={2.5} />
              <span className="hidden min-[420px]:inline">Conversa</span>
            </button>
          </div>
        </div>
      </article>
    )
  }

  // grid-cols-1 no celular, e nao so "grid": sem coluna declarada o grid cria
  // uma coluna do tamanho do conteudo, e a dica truncada de "Enviados,
  // aguardando" (texto de uma linha so) esticava a coluna para 450px numa tela
  // de 397. Os cartoes vazavam pela direita (26/09/2026). A mesma troca foi
  // feita nos outros grids de pagina.
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_310px]">
      <div className="space-y-6">
        {/* Mora aqui, e nao na Visao geral (pedido de 25/09/2026): e nesta tela
            que a equipe acompanha o que o sistema envia sozinho. */}
        <SaudeDosEnvios />
        <section className="soft-grid relative overflow-hidden rounded-[28px] bg-[#081b2c] p-5 text-white shadow-[0_18px_42px_rgba(8,27,44,.15)] sm:p-7">
          <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#2f7fc1]/20 blur-3xl" />
          <div className="relative grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#8dbde4]">
                <HeartHandshake className="h-3.5 w-3.5" />
                Fila inteligente
              </div>
              <h2 className="max-w-lg text-balance text-xl font-extrabold leading-tight tracking-[-0.035em] sm:text-2xl">
                Hoje, o cuidado pede atenção para {overdue.length + today.length} {overdue.length + today.length === 1 ? 'família' : 'famílias'}.
              </h2>
              <p className="mt-3 max-w-xl text-[11px] leading-relaxed text-white/50 sm:text-xs">
                A fila organiza automaticamente os contatos de 15, 30 e 90 dias, priorizando o que não pode esperar.
              </p>
            </div>

            <div className="flex gap-2.5">
              <div className="min-w-[92px] rounded-[18px] border border-white/10 bg-white/[0.065] p-3.5">
                <p className="text-[9px] font-bold uppercase tracking-wider text-white/35">Abertas</p>
                <p className="mt-1 text-2xl font-extrabold tracking-[-0.04em]">{items.length}</p>
              </div>
              <div className="min-w-[92px] rounded-[18px] bg-[#5b9fd5] p-3.5 text-[#081b2c]">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[#081b2c]/50">Concluídas</p>
                <p className="mt-1 text-2xl font-extrabold tracking-[-0.04em]">{completed}</p>
              </div>
            </div>
          </div>
        </section>

        {items.length === 0 ? (
          <section className="surface-card rounded-[26px] px-6 py-14 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-[20px] bg-[#eaf3f0] text-[#5b887d]">
              <CheckCircle2 className="h-7 w-7" />
            </span>
            <h2 className="mt-4 text-base font-extrabold text-[#081b2c]">
              {patients.length === 0 ? 'A fila está pronta para começar' : 'Tudo em dia por aqui'}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-slate-400">
              {patients.length === 0
                ? 'Cadastre o primeiro paciente e as datas de acompanhamento serão calculadas automaticamente.'
                : 'Nenhum acompanhamento está pendente neste momento. Volte depois para conferir as próximas jornadas.'}
            </p>
          </section>
        ) : (
          <div className="space-y-7">
            <Group title="Atrasados" hint="Prioridade máxima para a equipe" items={overdue} accent="danger">{card}</Group>
            <Group title="Para hoje" hint="Contatos que vencem agora" items={today} accent="today">{card}</Group>
            <Group title="Próximos 7 dias" hint="Organize a semana com antecedência" items={upcoming} accent="upcoming">{card}</Group>
            <Group title="Agendados" hint="Jornadas futuras já programadas" items={scheduled} accent="scheduled">{card}</Group>
            <Group
              title="Enviados, aguardando"
              hint="A mensagem já saiu. Conclua quando a família responder ou não precisar de mais nada"
              items={aguardando}
              accent="sent"
            >
              {card}
            </Group>
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <section className="surface-card rounded-[24px] p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#1f4f78]">Jornada do paciente</p>
              <h2 className="mt-1.5 text-sm font-extrabold text-[#081b2c]">Três pontos de cuidado</h2>
            </div>
            <Stethoscope className="h-5 w-5 text-[#2f7fc1]" />
          </div>

          <div className="relative mt-6 space-y-5">
            <div className="absolute bottom-5 left-[17px] top-5 w-px bg-gradient-to-b from-[#2f7fc1] via-[#6f9d91] to-[#081b2c]/20" />
            {[
              { icon: Stethoscope, label: 'Consulta', detail: 'Cadastro clínico inicial', color: '#2f7fc1' },
              { icon: MessageCircle, label: '15 dias', detail: 'Adaptação às orientações', color: '#2f7fc1' },
              { icon: Send, label: '30 dias', detail: 'Primeiro contato de evolução', color: '#6f9d91' },
              { icon: HeartHandshake, label: '90 dias', detail: 'Continuidade e suporte', color: '#081b2c' },
            ].map((step) => {
              const Icon = step.icon
              return (
                <div key={step.label} className="relative flex items-center gap-3">
                  <span
                    className="z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-4 border-white text-white"
                    style={{ background: step.color }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <div>
                    <p className="text-xs font-extrabold text-[#081b2c]">{step.label}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">{step.detail}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section className="rounded-[24px] border border-[#6f9d91]/20 bg-[#eaf3f0] p-5">
          <div className="flex items-center gap-2 text-[#4f796f]">
            <ShieldCheck className="h-4 w-4" />
            <h2 className="text-[10px] font-extrabold uppercase tracking-[0.14em]">Fluxo seguro</h2>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-[#4f6e67]">
              O envio é feito automaticamente pelo número oficial da clínica. As respostas do paciente ficam registradas no sistema.
          </p>
        </section>

        {sent > 0 && (
          <section className="rounded-[24px] border border-[#081b2c]/[0.07] bg-white/60 p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Em andamento</p>
            <div className="mt-3 flex items-end justify-between">
              <div>
                <p className="text-2xl font-extrabold tracking-[-0.05em] text-[#081b2c]">{sent}</p>
                <p className="mt-1 text-[10px] text-slate-400">mensagens abertas</p>
              </div>
              <MessageCircle className="h-6 w-6 text-[#6f9d91]" />
            </div>
          </section>
        )}
      </aside>
    </div>
  )
}
