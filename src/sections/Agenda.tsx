import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ajuda } from '@/components/Ajuda'
import {
  AlertTriangle,
  Building2,
  Check,
  CalendarOff,
  CalendarPlus,
  Clock,
  FileText,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
  Video,
  Settings2,
  Trash2,
  MessageCircleOff,
  X,
} from 'lucide-react'
import {
  archiveUnit,
  cancelAppointment,
  MOTIVOS_DE_CANCELAMENTO,
  MOTIVO_CORRECAO_INTERNA,
  type ResultadoDoCancelamento,
  createAppointment,
  createAvailabilityRule,
  createScheduleException,
  createUnit,
  getTelemedicina,
  type Telemedicina,
  deleteAvailabilityRule,
  deleteScheduleException,
  getCurrentMembership,
  getSchedulePreferences,
  confirmAppointment,
  notifyAppointmentConfirmed,
  listAppointments,
  listAppointmentHistory,
  listVagasDeCancelamento,
  type VagaDeCancelamento,
  listLigarHoje,
  type PendenciaDeLigar,
  marcarPresenca,
  listAvailabilityRules,
  listAvailableSlots,
  listScheduleExceptions,
  listUnits,
  listInactiveUnits,
  saveSchedulePreferences,
  updateAppointmentDetails,
  WEEKDAY_LABEL,
  type Appointment,
  type AvailabilityRule,
  type ScheduleException,
  type SchedulePreferences,
  type Unit,
} from '@/lib/repository'
import { useDialogos } from '@/components/dialogos-contexto'
import { avisoDoBloqueio, consultasDeUmDia } from '@/lib/bloqueio-de-dia'
import { lugaresDoRobo } from '@/lib/lugares'
import CartaoDaUnidade from '@/sections/agenda/CartaoDaUnidade'
import { valorDaConsulta } from '../../supabase/functions/_shared/campos-do-texto.ts'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { Patient } from '@/types/patient'
import { supabase } from '@/lib/supabase'

type Aba = 'calendario' | 'historico' | 'configuracao'

/**
 * As cores das etiquetas dos cartoes, na ordem em que pedem acao da recepcao.
 * As classes precisam ser as MESMAS dos chips la embaixo: legenda que diverge
 * da tela ensina errado.
 */
const LEGENDA_DA_AGENDA = [
  { rotulo: 'Confirmou presença', cor: 'bg-[#3fa88a]' },
  { rotulo: 'Pediu para remarcar', cor: 'bg-orange-500' },
  { rotulo: 'Lembrete sem resposta', cor: 'bg-red-600' },
  { rotulo: 'Lembrete falhou', cor: 'bg-[#b42318]' },
  { rotulo: 'Vagou por cancelamento', cor: 'border border-[#c98a2b]/60 bg-[#fdf4e3]' },
]

/**
 * Sugestoes de paciente mostradas de uma vez ao vincular uma consulta.
 *
 * Cinco cabe na tela sem rolar e obriga quem procura a escrever mais duas
 * letras em vez de varrer a lista com o olho. Despejar a base inteira aqui nao
 * ajudaria a achar ninguem.
 */
const MAX_SUGESTOES = 5

function diaLegivel(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(iso))
}

function hora(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  )
}

/** "22/09 às 14:30". Usado para dizer quando o paciente desistiu do horario. */
function diaEHora(iso: string) {
  const data = new Date(iso)
  const dia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(data)
  return `${dia} às ${hora(iso)}`
}

/**
 * Reserva de horario sem paciente: a equipe ocupou a vaga para o proprio
 * medico (outro consultorio, compromisso). Nasce pela tela, sem cadastro nem
 * telefone - e isso que a distingue de uma solicitacao pelo WhatsApp.
 */
/**
 * O telefone que vai receber o lembrete da vespera.
 *
 * Vem do cadastro quando a consulta tem paciente, e do contato quando alguem
 * marcou sem cadastro. Vazio nos dois casos significa uma coisa so: essa pessoa
 * nao vai receber lembrete nenhum, e a tela precisa dizer isso antes da
 * vespera, e nao depois da falta.
 */
function telefoneDoLembrete(item: Appointment, patients: Patient[]) {
  if (item.patientId) {
    return patients.find((p) => p.id === item.patientId)?.telefone?.trim() ?? ''
  }
  return item.contactPhone.trim()
}

/** Consulta marcada para alguem de fora da base, sem telefone utilizavel. */
function telefoneCurto(escolha: { patientId: string; telefone: string }) {
  return !escolha.patientId && escolha.telefone.replace(/\D/g, '').length < 10
}

function ehReserva(item: Appointment) {
  return item.source === 'clinic' && !item.patientId && !item.contactName && !item.contactPhone
}

/**
 * Junta horarios livres, consultas marcadas e dias bloqueados num unico
 * calendario por dia. O dia bloqueado entra para ser visto e liberado dali
 * mesmo; sem isso ele so sumia da lista e ninguem sabia por que.
 */
/** "Livance Ibirapuera - São Paulo" vira "São Paulo"; "Livance · Santos", "Santos". */
function nomeCurto(nome: string) {
  const partes = nome.split(/\s+[-·—]\s+/)
  return (partes[partes.length - 1] || nome).trim()
}

function agruparPorDia(slots: string[], appointments: Appointment[], bloqueios: ScheduleException[]) {
  const dias = new Map<string, { livres: string[]; marcados: Appointment[]; bloqueio: ScheduleException | null }>()
  const garantir = (chave: string) => {
    if (!dias.has(chave)) dias.set(chave, { livres: [], marcados: [], bloqueio: null })
    return dias.get(chave)!
  }
  for (const slot of slots) garantir(slot.slice(0, 10)).livres.push(slot)
  for (const item of appointments) garantir(item.startsAt.slice(0, 10)).marcados.push(item)
  for (const bloqueio of bloqueios) garantir(bloqueio.date).bloqueio = bloqueio
  return [...dias.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

/**
 * O que já aconteceu, dia a dia, do mais recente para trás.
 *
 * Existe por um pedido simples que não tinha resposta: "quero ver em formato de
 * agenda os atendimentos realizados". A agenda só carregava daqui para a
 * frente, então o dia anterior desaparecia sem deixar rastro na tela.
 *
 * Mostra também os cancelados, de propósito. Histórico que esconde cancelamento
 * conta uma versão otimista do mês e some justamente com o número que a clínica
 * precisa olhar.
 */
/**
 * Prontuario direto da agenda (15/10/2026, pedido do Dr. Marcello). So aparece
 * para quem atende (o Home so passa onAbrirProntuario para dono e medico) e so
 * em consulta com cadastro: sem paciente vinculado nao ha prontuario para abrir.
 *
 * Botao, e nao pergunta no clique: clicar na consulta continua abrindo o ajuste,
 * como a recepcao ja faz todo dia, e o medico chega ao prontuario com um clique
 * em vez de dois.
 */
function BotaoDaConsulta({
  rotulo,
  icone: Icone,
  onClick,
  destaque = false,
}: {
  rotulo: string
  icone: typeof FileText
  onClick: () => void
  destaque?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={rotulo === 'Prontuário' ? 'Abrir o prontuário do paciente' : 'Abrir para editar a consulta'}
      className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-[9px] font-extrabold transition ${
        destaque ? 'bg-[#2f7fc1] text-white hover:bg-[#3b8fd6]' : 'bg-white/15 text-white hover:bg-white/25'
      }`}
    >
      <Icone className="h-3 w-3" strokeWidth={2.5} />
      {rotulo}
    </button>
  )
}

function HistoricoDaAgenda({
  itens,
  marcando,
  onMarcar,
  onProntuario,
}: {
  itens: Appointment[]
  marcando: string | null
  onMarcar: (id: string, presenca: 'attended' | 'no_show' | 'scheduled') => void
  /** Nulo para quem nao ve prontuario, ou quando a consulta nao tem cadastro. */
  onProntuario: (item: Appointment) => (() => void) | null
}) {
  const dias = new Map<string, Appointment[]>()
  for (const item of itens) {
    const chave = item.startsAt.slice(0, 10)
    if (!dias.has(chave)) dias.set(chave, [])
    dias.get(chave)!.push(item)
  }

  const compareceu = itens.filter((i) => i.status === 'attended').length
  const faltou = itens.filter((i) => i.status === 'no_show').length
  const cancelou = itens.filter((i) => i.status === 'cancelled').length
  // Só conta onde alguém registrou o que houve. Misturar as consultas ainda não
  // marcadas no denominador inventaria uma taxa de falta menor do que a real.
  const registradas = compareceu + faltou
  const taxa = registradas > 0 ? Math.round((faltou / registradas) * 100) : null

  if (itens.length === 0) {
    return (
      <div className="surface-card rounded-[22px] p-8 text-center text-xs font-semibold text-slate-500">
        Nenhuma consulta nos últimos 90 dias nesta unidade.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="surface-card flex flex-wrap items-center gap-4 rounded-[20px] px-4 py-3">
        <Resumo rotulo="Compareceram" valor={compareceu} cor="#3fa88a" />
        <Resumo rotulo="Faltaram" valor={faltou} cor="#b42318" />
        <Resumo rotulo="Canceladas" valor={cancelou} cor="#94a3b8" />
        {taxa !== null && (
          <div className="ml-auto text-right">
            <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
              Taxa de falta
            </p>
            <p className="text-lg font-extrabold leading-none text-[#081b2c]">{taxa}%</p>
          </div>
        )}
      </div>

      {[...dias.entries()].map(([dia, consultas]) => (
        <div key={dia} className="surface-card rounded-[20px] p-4">
          <p className="text-xs font-extrabold capitalize text-[#081b2c]">
            {diaLegivel(dia + 'T12:00:00')}
          </p>
          <div className="mt-3 space-y-1.5">
            {consultas.map((item) => (
              <div
                key={item.id}
                className={`flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 ${
                  item.status === 'cancelled' ? 'bg-[#fafaf8]' : 'bg-[#081b2c]'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-[11px] font-extrabold ${
                      item.status === 'cancelled' ? 'text-slate-400 line-through' : 'text-white'
                    }`}
                  >
                    {hora(item.startsAt)} · {item.patientName}
                  </p>
                  <p
                    className={`truncate text-[10px] font-semibold ${
                      item.status === 'cancelled' ? 'text-slate-400' : 'text-white/60'
                    }`}
                  >
                    {item.source === 'whatsapp' ? 'marcado pelo paciente no WhatsApp' : 'marcado pela equipe'}
                    {item.contactPhone ? ` · ${item.contactPhone}` : ''}
                    {/* Falta que o sistema marcou sozinho: a equipe precisa
                        saber que ninguem conferiu, e pode corrigir no clique. */}
                    {item.status === 'no_show' && item.faltaAutomatica ? ' · falta automática (sem prontuário no dia)' : ''}
                  </p>
                </div>

                {item.status === 'cancelled' ? (
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[9px] font-extrabold text-slate-500">
                    Cancelada
                  </span>
                ) : (
                  <div className="flex items-center gap-1">
                    {/* Depois da consulta e quando o medico mais escreve. */}
                    {onProntuario(item) && (
                      <BotaoDaConsulta rotulo="Prontuário" icone={FileText} destaque onClick={onProntuario(item)!} />
                    )}
                    <BotaoPresenca
                      ativo={item.status === 'attended'}
                      corAtiva="#3fa88a"
                      rotulo="Compareceu"
                      ocupado={marcando === item.id}
                      onClick={() =>
                        onMarcar(item.id, item.status === 'attended' ? 'scheduled' : 'attended')
                      }
                    />
                    <BotaoPresenca
                      ativo={item.status === 'no_show'}
                      corAtiva="#b42318"
                      rotulo="Faltou"
                      ocupado={marcando === item.id}
                      onClick={() =>
                        onMarcar(item.id, item.status === 'no_show' ? 'scheduled' : 'no_show')
                      }
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function Resumo({ rotulo, valor, cor }: { rotulo: string; valor: number; cor: string }) {
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{rotulo}</p>
      <p className="text-lg font-extrabold leading-none" style={{ color: cor }}>
        {valor}
      </p>
    </div>
  )
}

/** Mesmas cores da legenda e das etiquetas dos cartoes. */
const ESTILO_DE_LIGAR: Record<PendenciaDeLigar['motivo'], { rotulo: string; classe: string }> = {
  remarcar: { rotulo: 'Pediu para remarcar', classe: 'bg-orange-500 text-white' },
  lembrete_falhou: { rotulo: 'Lembrete falhou', classe: 'bg-[#b42318] text-white' },
  sem_resposta: { rotulo: 'Sem resposta ao lembrete', classe: 'bg-red-600 text-white' },
  sem_telefone: { rotulo: 'Sem telefone', classe: 'bg-slate-200 text-slate-600' },
}

/** "Hoje 14:40" ou "Amanhã 09:20". */
function quandoCurto(iso: string) {
  const d = new Date(iso)
  const dia = ehHoje(iso) ? 'Hoje' : 'Amanhã'
  return `${dia} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * A consulta e de hoje, no relogio de quem esta na recepcao.
 *
 * Presenca so se marca no dia: amanha ninguem chegou ainda. Fora do componente
 * de proposito, porque ler a hora durante a renderizacao e o que a regra de
 * pureza do React proibe.
 */
function ehHoje(iso: string) {
  return new Date(iso).toDateString() === new Date().toDateString()
}

/** Clicar de novo desfaz: registro de presença errado é pior do que nenhum. */
function BotaoPresenca({
  ativo,
  corAtiva,
  rotulo,
  ocupado,
  onClick,
}: {
  ativo: boolean
  corAtiva: string
  rotulo: string
  ocupado: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={ocupado}
      onClick={onClick}
      title={ativo ? `Clique para desfazer "${rotulo}"` : rotulo}
      className="rounded-lg px-2 py-1 text-[9px] font-extrabold transition disabled:opacity-40"
      style={
        ativo
          ? { backgroundColor: corAtiva, color: '#fff' }
          : { backgroundColor: 'rgba(255,255,255,.12)', color: 'rgba(255,255,255,.7)' }
      }
    >
      {rotulo}
    </button>
  )
}

/**
 * Pergunta o motivo antes de cancelar, e diz se o paciente foi avisado.
 *
 * O motivo nao e burocracia: ele vai inteiro para o WhatsApp da familia. Por
 * isso as cinco opcoes estao escritas do ponto de vista de quem le a mensagem,
 * e nao de quem cancela.
 *
 * O aviso pode nao chegar - fora da janela de 24 horas a Meta so aceita modelo
 * aprovado. Quando isso acontece a tela diz com todas as letras, porque a
 * alternativa e a recepcao supor que avisou e o paciente aparecer na unidade.
 */
function CaixaDeCancelamento({
  consulta,
  onFechar,
  onCancelar,
}: {
  consulta: { id: string; paciente: string; quando: string }
  onFechar: () => void
  onCancelar: (
    motivo: string,
    avisar: boolean,
    sugerir: boolean,
  ) => Promise<ResultadoDoCancelamento>
}) {
  const [motivo, setMotivo] = useState<string>(MOTIVOS_DE_CANCELAMENTO[0])
  const [outro, setOutro] = useState('')
  const [avisar, setAvisar] = useState(true)
  // Desmarcado por padrão. Sugerir outra data junto do cancelamento é útil
  // quando a clínica quer remarcar na hora, mas não é o caso normal: muitas
  // vezes o horário some por um imprevisto e quem decide o que vem depois é a
  // família, não a agenda. Fica como escolha de quem cancela, e não como
  // comportamento silencioso.
  const [sugerir, setSugerir] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState('')
  const [resultado, setResultado] = useState<ResultadoDoCancelamento | null>(null)

  const personalizado = motivo === 'Outro motivo'
  const texto = personalizado ? outro.trim() : motivo
  // Correcao interna nunca avisa: a consulta "de verdade" continua marcada.
  const interno = motivo === MOTIVO_CORRECAO_INTERNA

  async function confirmar() {
    if (!texto) {
      setErro('Escreva o motivo antes de cancelar.')
      return
    }
    setErro('')
    setEnviando(true)
    try {
      setResultado(await onCancelar(texto, avisar && !interno, sugerir && !interno))
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Não foi possível cancelar.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#081b2c]/40 p-4">
      <div className="w-full max-w-[440px] rounded-[22px] bg-white p-5 shadow-[0_24px_60px_rgba(8,27,44,.22)]">
        {resultado ? (
          <>
            <p className="text-sm font-extrabold text-[#081b2c]">Consulta cancelada</p>
            <p className="mt-1.5 text-[11px] font-semibold leading-relaxed text-slate-500">
              O horário voltou a ficar livre.
            </p>
            {resultado.avisado ? (
              <p className="mt-3 rounded-xl bg-[#eef7f1] px-3.5 py-3 text-[11px] font-bold leading-relaxed text-[#1c6b3a]">
                O paciente foi avisado pelo WhatsApp.
              </p>
            ) : (
              <p className="mt-3 flex items-start gap-2 rounded-xl bg-[#ebf4fd] px-3.5 py-3 text-[11px] font-bold leading-relaxed text-[#1a5079]">
                <MessageCircleOff className="mt-px h-4 w-4 shrink-0" />
                <span>
                  O paciente NÃO foi avisado. {resultado.motivoDoSilencio}
                </span>
              </p>
            )}
            <button
              type="button"
              onClick={onFechar}
              className="mt-4 w-full rounded-xl bg-[#081b2c] px-4 py-2.5 text-[11px] font-extrabold text-white transition hover:bg-[#102d47]"
            >
              Entendi
            </button>
          </>
        ) : (
          <>
            <p className="text-sm font-extrabold text-[#081b2c]">Cancelar a consulta</p>
            <p className="mt-1 text-[11px] font-semibold text-slate-500">
              {consulta.paciente} · {consulta.quando}
            </p>

            <p className="mt-4 text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-500">
              Motivo
            </p>
            <div className="mt-2 space-y-1.5">
              {[...MOTIVOS_DE_CANCELAMENTO, MOTIVO_CORRECAO_INTERNA, 'Outro motivo'].map((opcao) => (
                <label
                  key={opcao}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-[11px] font-bold transition ${
                    motivo === opcao
                      ? 'border-[#2f7fc1] bg-[#eff6fd] text-[#081b2c]'
                      : 'border-[#081b2c]/10 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="motivo"
                    checked={motivo === opcao}
                    onChange={() => setMotivo(opcao)}
                    className="h-3.5 w-3.5 accent-[#1f4f78]"
                  />
                  {opcao}
                </label>
              ))}
            </div>

            {personalizado && (
              <input
                autoFocus
                value={outro}
                onChange={(evento) => setOutro(evento.target.value)}
                maxLength={140}
                placeholder="O que o paciente vai ler como motivo"
                className="mt-2 w-full rounded-xl border border-[#081b2c]/10 bg-[#fafaf8] px-3.5 py-2.5 text-[11px] font-semibold text-[#081b2c] outline-none focus:border-[#2f7fc1] focus:bg-white"
              />
            )}

            {interno && (
              <p className="mt-3 flex items-start gap-2 rounded-xl bg-[#ebf4fd] px-3.5 py-3 text-[11px] font-bold leading-relaxed text-[#1a5079]">
                <MessageCircleOff className="mt-px h-4 w-4 shrink-0" />
                <span>
                  O paciente não recebe aviso: é só uma correção na agenda. Confira se a consulta
                  certa continua marcada.
                </span>
              </p>
            )}

            {!interno && (
            <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-xl bg-[#f8f7f4] px-3.5 py-3 text-[11px] font-bold text-slate-600">
              <input
                type="checkbox"
                checked={avisar}
                onChange={(evento) => setAvisar(evento.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-[#1f4f78]"
              />
              <span>
                Avisar o paciente pelo WhatsApp
                <span className="mt-0.5 block font-semibold text-slate-400">
                  Desmarque se preferir telefonar.
                </span>
              </span>
            </label>
            )}

            {/* So faz sentido dentro do aviso: sugerir horario a quem nao vai
                receber mensagem nenhuma seria conversa com a parede. */}
            {avisar && !interno && (
              <label className="mt-1.5 flex cursor-pointer items-start gap-2.5 rounded-xl bg-[#f8f7f4] px-3.5 py-3 text-[11px] font-bold text-slate-600">
                <input
                  type="checkbox"
                  checked={sugerir}
                  onChange={(evento) => setSugerir(evento.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-[#1f4f78]"
                />
                <span>
                  Sugerir 3 horários da mesma unidade
                  <span className="mt-0.5 block font-semibold text-slate-400">
                    O paciente remarca com um toque, sem refazer o caminho.
                  </span>
                </span>
              </label>
            )}

            {erro && <p className="mt-2 text-[10px] font-bold text-red-500">{erro}</p>}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => void confirmar()}
                disabled={enviando}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-[11px] font-extrabold text-white transition hover:bg-red-700 disabled:cursor-wait disabled:opacity-70"
              >
                {enviando ? 'Cancelando...' : 'Cancelar consulta'}
              </button>
              <button
                type="button"
                onClick={onFechar}
                disabled={enviando}
                className="rounded-xl border border-[#081b2c]/10 px-4 py-2.5 text-[11px] font-bold text-slate-500 transition hover:bg-slate-50"
              >
                Voltar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default function Agenda({
  patients,
  /** Avisa o Home para o contador do menu e o aviso da Visao geral acompanharem. */
  onSolicitacoesMudaram,
  onCadastrarContato,
  onAbrirProntuario,
}: {
  patients: Patient[]
  /** So para dono e medico (ver BotaoDaConsulta). */
  onAbrirProntuario?: (patientId: string) => void
  onSolicitacoesMudaram?: () => void
  /** Abre a tela de pacientes com nome e telefone da consulta ja preenchidos. */
  onCadastrarContato?: (dados: {
    nome: string
    telefone: string
    dataConsulta?: string
    unidade?: string
    nascimento?: string
    responsavel?: string
    cpf?: string
    email?: string
  }) => void
}) {
  const [aba, setAba] = useState<Aba>('calendario')
  // Os dias que já passaram. Carregados junto com a agenda, e não só quando a
  // aba abre: são poucas linhas, e assim trocar de aba é instantâneo.
  const [historico, setHistorico] = useState<Appointment[]>([])
  const [vagas, setVagas] = useState<VagaDeCancelamento[]>([])
  const [marcando, setMarcando] = useState<string | null>(null)
  const [ligarHoje, setLigarHoje] = useState<PendenciaDeLigar[]>([])
  const [clinicId, setClinicId] = useState<string | null>(null)
  const [units, setUnits] = useState<Unit[]>([])
  // Desativadas (Liferty, Trasmontano): so aparecem no Historico. Ver
  // listInactiveUnits.
  const [inativas, setInativas] = useState<Unit[]>([])
  // Texto, valor e liga/desliga da telemedicina, para o cartao dela em
  // Configuracao. Falhar aqui nao derruba a agenda: o cartao so fica sem dados.
  const [tele, setTele] = useState<Telemedicina | null>(null)
  const lugares = useMemo(() => lugaresDoRobo(units, tele), [units, tele])
  const [unitId, setUnitId] = useState<string | null>(null)
  // Depois de unitId, e nao junto de inativas (15/10/2026): lida antes da
  // declaracao, a linha derrubava a Agenda inteira em producao ("Cannot access
  // before initialization"). O tsc nao acusa porque o uso fica dentro da seta.
  const unidadeInativa = inativas.some((u) => u.id === unitId)
  const [rules, setRules] = useState<AvailabilityRule[]>([])
  const [exceptions, setExceptions] = useState<ScheduleException[]>([])
  const [prefs, setPrefs] = useState<SchedulePreferences>({
    slotMinutes: 40,
    horizonDays: 15,
    minNoticeHours: 2,
    reminderEnabled: true,
    reminderDays: 1,
  })
  const [slots, setSlots] = useState<string[]>([])
  // Telemedicina sem horario proprio (03/10/2026): de qual unidade fisica veio
  // cada horario livre. Vazio nas outras agendas.
  const [origemDoHorario, setOrigemDoHorario] = useState<Map<string, string>>(new Map())
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  // Consulta que o usuario mandou cancelar e ainda espera o motivo. Guardar o
  // objeto inteiro, e nao so o id, permite escrever "de Ana, segunda 14/09" na
  // pergunta - cancelar a consulta errada e um erro caro e silencioso.
  const [cancelando, setCancelando] = useState<
    { id: string; paciente: string; quando: string } | null
  >(null)
  const [slotEscolhido, setSlotEscolhido] = useState<string | null>(null)
  const [motivoReserva, setMotivoReserva] = useState('')
  // Paciente escolhido no modal e, quando nao ha cadastro, nome e WhatsApp
  // digitados na hora. Estado, e nao leitura do DOM: o botao precisa saber se
  // ja da para marcar antes do clique.
  const [novaConsulta, setNovaConsulta] = useState({ patientId: '', nome: '', telefone: '' })
  // Dia que o usuario mandou bloquear e ainda espera o motivo.
  const [bloqueandoDia, setBloqueandoDia] = useState<{ dia: string; motivo: string } | null>(null)
  const { perguntar } = useDialogos()

  // O clique do botao Prontuario, ou nulo quando ele nao deve aparecer: sem
  // acesso, sem paciente vinculado, ou paciente fora da lista (arquivado), que
  // abriria um prontuario vazio.
  function prontuarioDe(item: Appointment): (() => void) | null {
    if (!onAbrirProntuario || !item.patientId) return null
    const id = item.patientId
    if (!patients.some((p) => p.id === id)) return null
    return () => onAbrirProntuario(id)
  }

  // Dia com consulta marcada pede confirmacao antes de bloquear (ver
  // bloqueio-de-dia.ts): bloquear nao cancela nem avisa ninguem.
  async function podeBloquear(dia: string) {
    const doDia = consultasDeUmDia(appointments, dia)
    if (doDia.length === 0) return true
    return perguntar({ ...avisoDoBloqueio(doDia), confirmar: 'Bloquear mesmo assim', cancelar: 'Voltar', perigo: true })
  }

  // Formularios
  const [novaUnidade, setNovaUnidade] = useState({ nome: '', endereco: '', valor: '' })
  // Unidade nova so entra com nome, endereco e valor (14/10/2026): sem valor, o
  // {valor} dos textos do robo nao teria o que mostrar.
  const valorDaNova = valorDaConsulta(novaUnidade.valor)
  const faltaNaNova = !novaUnidade.nome.trim()
    ? 'Preencha o nome.'
    : !novaUnidade.endereco.trim()
      ? 'Preencha o endereço.'
      : 'erro' in valorDaNova
        ? valorDaNova.erro
        : ''
  const [novaRegra, setNovaRegra] = useState({ weekday: 1, inicio: '08:00', fim: '12:00' })
  const [novoBloqueio, setNovoBloqueio] = useState({ data: '', motivo: '' })

  const carregarBase = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const membership = await getCurrentMembership()
      if (!membership) throw new Error('Não foi possível identificar a clínica do seu usuário.')
      setClinicId(membership.clinicId)
      const [lista, preferencias, excecoes, telemedicina, desativadas] = await Promise.all([
        listUnits(membership.clinicId),
        getSchedulePreferences(membership.clinicId),
        listScheduleExceptions(membership.clinicId),
        getTelemedicina(membership.clinicId).catch((erro) => {
          console.warn('Nao consegui ler a telemedicina para o cartao dela', erro)
          return null
        }),
        // Falhar aqui so tira as antigas do Historico; a agenda segue inteira.
        listInactiveUnits(membership.clinicId).catch((erro) => {
          console.warn('Nao consegui listar as unidades desativadas para o historico', erro)
          return [] as Unit[]
        }),
      ])
      setUnits(lista)
      setInativas(desativadas)
      setTele(telemedicina)
      setPrefs(preferencias)
      setExceptions(excecoes)
      setUnitId((atual) => atual ?? lista[0]?.id ?? null)
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'Não foi possível carregar a agenda.')
    } finally {
      setLoading(false)
    }
  }, [])

  const carregarUnidade = useCallback(async () => {
    if (!clinicId || !unitId) {
      setRules([])
      setSlots([])
      setAppointments([])
      setHistorico([])
      setVagas([])
      return
    }
    // Unidade desativada: so o historico. Horario livre, regra e vaga nao
    // existem mais ali, e perguntar ao banco por eles so traria erro.
    if (unidadeInativa) {
      try {
        setRules([])
        setSlots([])
        setAppointments([])
        setVagas([])
        setHistorico(await listAppointmentHistory(clinicId, unitId))
      } catch (causa) {
        setError(causa instanceof Error ? causa.message : 'Não foi possível carregar o histórico.')
      }
      return
    }
    try {
      const [regras, livres, marcados, passadas, vagasCanceladas, pendencias] = await Promise.all([
        listAvailabilityRules(unitId),
        listAvailableSlots(unitId),
        listAppointments(clinicId, unitId),
        listAppointmentHistory(clinicId, unitId),
        listVagasDeCancelamento(clinicId, unitId),
        // Da clinica inteira, e nao da unidade: ver listLigarHoje. Se falhar,
        // a agenda carrega do mesmo jeito - e um atalho, nao a agenda.
        listLigarHoje(clinicId).catch((erro) => {
          console.warn('Nao consegui montar a lista "ligar hoje"', erro)
          return [] as PendenciaDeLigar[]
        }),
      ])
      setLigarHoje(pendencias)
      setRules(regras)

      // Agenda da telemedicina sem horario proprio (03/10/2026). O robo
      // oferece os horarios livres das unidades fisicas - e a agenda precisa
      // mostrar os mesmos, senao a recepcao ve "sem horarios" enquanto o
      // robo marca. O banco ja tira dali o que esta ocupado por video.
      const tele = units.find((u) => u.id === unitId)?.telemedicina
      if (tele && regras.length === 0) {
        const fisicas = units.filter((u) => !u.telemedicina)
        const partes = await Promise.all(
          fisicas.map((u) =>
            listAvailableSlots(u.id).catch((erro) => {
              console.warn(`Horarios livres de ${u.name} indisponiveis`, erro)
              return [] as string[]
            }),
          ),
        )
        const origem = new Map<string, string>()
        partes.forEach((lista, i) => {
          for (const inicio of lista) {
            const chave = new Date(inicio).toISOString()
            const ja = origem.get(chave)
            const nome = nomeCurto(fisicas[i].name)
            origem.set(chave, ja && ja !== nome ? `${ja} / ${nome}` : nome)
          }
        })
        setOrigemDoHorario(origem)
        setSlots([...origem.keys()].sort())
      } else {
        setOrigemDoHorario(new Map())
        setSlots(livres)
      }
      setAppointments(marcados)
      setHistorico(passadas)
      setVagas(vagasCanceladas)
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'Não foi possível carregar os horários.')
    }
  }, [clinicId, unitId, units, unidadeInativa])

  useEffect(() => {
    void carregarBase()
  }, [carregarBase])
  useEffect(() => {
    void carregarUnidade()
  }, [carregarUnidade])

  /**
   * A Agenda se atualiza sozinha (24/09/2026).
   *
   * Ate aqui so o botao Atualizar trazia o que mudou: confirmacao pelo
   * lembrete, "pediu para remarcar", consulta marcada pelo robo. A recepcao
   * olhava a tela aberta desde cedo e decidia em cima de uma agenda velha.
   *
   * Duas vias, porque a primeira pode cair sem avisar:
   *  - tempo real na tabela de consultas (ja publicada desde 09/09), com uma
   *    espera de 1,5s para juntar a rajada de eventos de uma marcacao;
   *  - uma passada a cada 2 minutos e sempre que a janela volta ao foco.
   *
   * Recarregar so troca as listas: o que esta sendo editado num formulario
   * mora em outro estado e nao e apagado.
   */
  useEffect(() => {
    if (!clinicId) return
    let espera: number | undefined
    const recarregar = () => {
      window.clearTimeout(espera)
      espera = window.setTimeout(() => void carregarUnidade(), 1500)
    }
    const canal = supabase
      .channel(`agenda-${clinicId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'appointments', filter: `clinic_id=eq.${clinicId}` },
        recarregar,
      )
      .subscribe()
    const relogio = window.setInterval(() => void carregarUnidade(), 120_000)
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') recarregar()
    }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      window.clearTimeout(espera)
      window.clearInterval(relogio)
      document.removeEventListener('visibilitychange', aoVoltar)
      void supabase.removeChannel(canal)
    }
  }, [clinicId, carregarUnidade])

  const dias = useMemo(() => {
    const limite = new Date()
    limite.setDate(limite.getDate() + prefs.horizonDays)
    const bloqueios = exceptions.filter(
      (e) => e.isClosed && (e.unitId === null || e.unitId === unitId) && e.date <= limite.toISOString().slice(0, 10),
    )
    return agruparPorDia(slots, appointments, bloqueios)
  }, [slots, appointments, exceptions, unitId, prefs.horizonDays])

  /**
   * De quais horarios livres alguem desistiu.
   *
   * Chaveado pelo INSTANTE, e nao pelo texto da data: o horario livre vem da
   * funcao available_slots e a consulta cancelada vem da tabela, e os dois
   * podem escrever o mesmo momento de formas diferentes ("+00:00" e "Z", com
   * e sem milissegundos). Comparar texto perderia a marca sem ninguem notar.
   */
  const vagaPorInstante = useMemo(() => {
    const mapa = new Map<number, VagaDeCancelamento>()
    for (const vaga of vagas) {
      const instante = new Date(vaga.quando).getTime()
      if (!Number.isNaN(instante)) mapa.set(instante, vaga)
    }
    return mapa
  }, [vagas])
  const unidadeAtual = units.find((u) => u.id === unitId) ?? null

  // ---- Painel de edicao de uma consulta ----
  //
  // Existe sobretudo por causa do que chega pelo WhatsApp: a consulta nasce sem
  // paciente vinculado, e enquanto ficar assim nao entra no prontuario nem nos
  // acompanhamentos de 15, 30 e 90 dias.
  const [emEdicao, setEmEdicao] = useState<Appointment | null>(null)
  const [formConsulta, setFormConsulta] = useState({
    contactName: '',
    contactPhone: '',
    staffNote: '',
    patientId: '',
  })
  const [salvandoConsulta, setSalvandoConsulta] = useState(false)
  const [buscaPaciente, setBuscaPaciente] = useState('')

  function abrirConsulta(item: Appointment) {
    setEmEdicao(item)
    setBuscaPaciente('')
    setFormConsulta({
      contactName: item.contactName,
      contactPhone: item.contactPhone,
      staffNote: item.staffNote,
      patientId: item.patientId ?? '',
    })
  }

  /**
   * Paciente que ja usa o telefone da consulta.
   *
   * O WhatsApp entrega o numero com o 55 na frente e o cadastro costuma ter so
   * o DDD, entao os dois lados sao normalizados antes de comparar. A comparacao
   * inclui o DDD de proposito: olhar so o final confundiria (11) 98765-4321 com
   * (13) 98765-4321, que sao pessoas diferentes.
   */
  const sugeridos = useMemo(() => {
    const nacional = (bruto: string) => {
      const d = bruto.replace(/\D/g, '')
      return (d.length === 12 || d.length === 13) && d.startsWith('55') ? d.slice(2) : d
    }
    const alvo = nacional(formConsulta.contactPhone)
    if (alvo.length < 10) return []
    return patients.filter((p) => nacional(p.telefone) === alvo)
  }, [patients, formConsulta.contactPhone])

  /**
   * Resultado da busca. Sem termo nao devolve nada de proposito: despejar os
   * primeiros da base nao ajuda a achar ninguem, e ainda passa a impressao de
   * que so existem aqueles.
   */
  const encontrados = useMemo(() => {
    const termo = buscaPaciente.trim().toLowerCase()
    const digitos = termo.replace(/\D/g, '')
    if (termo.length < 2 && digitos.length < 4) return []
    return patients.filter(
      (p) =>
        p.nome.toLowerCase().includes(termo) ||
        (digitos.length >= 4 && p.telefone.replace(/\D/g, '').includes(digitos)),
    )
  }, [patients, buscaPaciente])

  /**
   * Confirma a solicitacao e conta ao paciente.
   *
   * O aviso e melhor-esforco: se a janela de 24h da Meta ja fechou, a consulta
   * segue confirmada do mesmo jeito e a tela diz que o aviso nao saiu. Deixar
   * a confirmacao presa a um envio seria pior.
   */
  /** "20/08" - a data da consulta anterior cabe na etiqueta assim. */
  function fmtDiaMes(data: string) {
    // Meio-dia para a data nao andar um dia por causa de fuso: "2026-08-20"
    // lido como meia-noite UTC vira 19/08 no horario de Brasilia.
    const d = new Date(`${data}T12:00:00`)
    return Number.isNaN(d.getTime())
      ? data
      : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  }

  async function confirmarEAvisar(appointmentId: string) {
    if (!clinicId) return
    const confirmou = await acao(
      () => confirmAppointment(appointmentId),
      'Consulta confirmada. A vaga deixou de ser provisória.',
    )
    onSolicitacoesMudaram?.()
    // Sem confirmacao, nada de aviso. Ate 24/09/2026 o erro aparecia na tela e
    // a familia recebia "Consulta confirmada!" do mesmo jeito.
    if (!confirmou) return
    const aviso = await notifyAppointmentConfirmed(clinicId, appointmentId)
    setAviso(
      aviso.avisou
        ? 'Consulta confirmada e paciente avisado pelo WhatsApp.'
        : 'Consulta confirmada. Não consegui avisar pelo WhatsApp. Responda pela tela de Respostas.',
    )
  }

  /**
   * Chegou / faltou. Usado no Historico e, desde 24/09/2026, no cartao da
   * consulta de hoje: antes so dava para marcar a partir do dia seguinte, e
   * ninguem voltava la - as faltas ficavam sem registro e a taxa de falta
   * saia menor do que a real.
   */
  async function registrarPresenca(id: string, presenca: 'attended' | 'no_show' | 'scheduled') {
    setMarcando(id)
    setError('')
    try {
      await marcarPresenca(id, presenca)
      await carregarUnidade()
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'Não foi possível registrar a presença.')
    } finally {
      setMarcando(null)
    }
  }

  async function salvarConsulta() {
    if (!emEdicao) return
    setSalvandoConsulta(true)
    await acao(
      () =>
        updateAppointmentDetails(emEdicao.id, {
          contactName: formConsulta.contactName,
          contactPhone: formConsulta.contactPhone,
          staffNote: formConsulta.staffNote,
          patientId: formConsulta.patientId || null,
        }),
      'Consulta atualizada.',
    )
    setSalvandoConsulta(false)
    setEmEdicao(null)
  }

  /** Devolve se deu certo: quem encadeia outro passo precisa saber. */
  async function acao(fn: () => Promise<unknown>, mensagem?: string): Promise<boolean> {
    setError('')
    setAviso('')
    try {
      await fn()
      if (mensagem) setAviso(mensagem)
      await carregarBase()
      await carregarUnidade()
      return true
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'A operação não foi concluída.')
      return false
    }
  }

  if (loading) {
    return (
      <div className="surface-card rounded-[22px] p-8 text-center text-xs font-semibold text-slate-500">
        Carregando agenda...
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {cancelando && (
        <CaixaDeCancelamento
          consulta={cancelando}
          onFechar={() => {
            setCancelando(null)
            void carregarBase()
            void carregarUnidade()
            onSolicitacoesMudaram?.()
          }}
          onCancelar={(motivo, avisar, sugerir) =>
            cancelAppointment(cancelando.id, motivo, avisar, sugerir)
          }
        />
      )}
      {error && (
        <div className="flex items-start gap-2 rounded-[16px] border border-red-200 bg-red-50 p-3 text-[11px] font-semibold text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {aviso && (
        <div className="rounded-[16px] border border-[#3fa88a]/30 bg-[#eef7f4] p-3 text-[11px] font-bold text-[#2f6f5e]">
          {aviso}
        </div>
      )}

      {/* Aqui ficava o bloco "Canceladas sem aviso", tirado em 11/09/2026 a
          pedido da clínica. Ele nasceu de um erro que já não existe: o aviso de
          cancelamento não encontrava a conversa de quem marcou pelo WhatsApp e
          ficava pendente sem motivo. Hoje o aviso sai na hora do cancelamento, e
          quando não sai a própria caixa de cancelamento diz na tela que o
          paciente NÃO foi avisado, com o motivo. O reenvio continua existindo no
          servidor (appointment-cancel com apenasAvisar). */}

      {units.length === 0 ? (
        <div className="surface-card rounded-[22px] p-8">
          <Building2 className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-center text-sm font-bold text-[#081b2c]">
            Cadastre a primeira unidade
          </p>
          <p className="mx-auto mt-1 max-w-md text-center text-xs text-slate-500">
            A agenda é organizada por unidade de atendimento. Cada uma tem horários próprios, e é
            entre elas que o paciente escolhe ao marcar pelo WhatsApp.
          </p>
          <div className="mx-auto mt-4 flex max-w-md flex-col gap-2">
            <input
              value={novaUnidade.nome}
              onChange={(e) => setNovaUnidade({ ...novaUnidade, nome: e.target.value })}
              placeholder="Nome da unidade"
              className="rounded-xl border border-[#081b2c]/10 bg-[#fafaf8] px-3 py-2 text-xs outline-none focus:border-[#2f7fc1]"
            />
            <input
              value={novaUnidade.endereco}
              onChange={(e) => setNovaUnidade({ ...novaUnidade, endereco: e.target.value })}
              placeholder="Endereço"
              className="rounded-xl border border-[#081b2c]/10 bg-[#fafaf8] px-3 py-2 text-xs outline-none focus:border-[#2f7fc1]"
            />
            <input
              value={novaUnidade.valor}
              onChange={(e) => setNovaUnidade({ ...novaUnidade, valor: e.target.value })}
              placeholder="Valor da consulta (R$)"
              inputMode="decimal"
              className="rounded-xl border border-[#081b2c]/10 bg-[#fafaf8] px-3 py-2 text-xs outline-none focus:border-[#2f7fc1]"
            />
            {faltaNaNova && (novaUnidade.nome || novaUnidade.endereco || novaUnidade.valor) && (
              <p className="text-[10px] font-semibold text-[#b54708]">{faltaNaNova}</p>
            )}
            <button
              type="button"
              disabled={Boolean(faltaNaNova)}
              onClick={() =>
                void acao(async () => {
                  if (!clinicId || !('centavos' in valorDaNova)) return
                  await createUnit(clinicId, novaUnidade.nome, novaUnidade.endereco, valorDaNova.centavos)
                  setNovaUnidade({ nome: '', endereco: '', valor: '' })
                }, 'Unidade cadastrada.')
              }
              className="rounded-xl bg-[#081b2c] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#102d47] disabled:opacity-40"
            >
              Cadastrar unidade
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Agenda propria da telemedicina (03/10/2026). Sem horario
              cadastrado, o robo continua oferecendo os horarios das unidades
              fisicas - so que agora grava aqui. Quem abre esta agenda vazia
              precisa saber disso, senao acha que a telemedicina parou. */}
          {unidadeAtual?.telemedicina && (
            <div className="flex items-start gap-2 rounded-[16px] border border-[#2f7fc1]/15 bg-[#eef5fd] px-4 py-3 text-[11px] leading-relaxed text-[#16456b]">
              <Video className="mt-0.5 h-4 w-4 shrink-0 text-[#2f7fc1]" />
              <p>
                <strong>Agenda da telemedicina.</strong> Toda consulta por vídeo fica aqui.{' '}
                {rules.length === 0
                  ? 'Ainda não há horários próprios: o robô oferece os horários livres das unidades físicas. Cadastre os horários de vídeo em Configuração para que só eles valham.'
                  : 'O robô oferece só os horários desta agenda.'}{' '}
                Um horário ocupado aqui fica ocupado nas outras unidades, e vice-versa: é o mesmo médico.
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={unitId ?? ''}
                onChange={(e) => setUnitId(e.target.value)}
                className="rounded-xl border border-[#081b2c]/10 bg-white px-3 py-1.5 text-[11px] font-bold text-[#081b2c] outline-none"
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.telemedicina ? `💻 ${u.name} (por vídeo)` : u.name}
                  </option>
                ))}
                {/* As desativadas so no Historico: ali o medico consulta quem
                    ja foi atendido nelas; no calendario e na configuracao nao
                    ha mais nada a fazer com elas. */}
                {aba === 'historico' && inativas.length > 0 && (
                  <optgroup label="Desativadas (só histórico)">
                    {inativas.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} · desativada
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <div className="flex rounded-xl bg-[#eef3f2] p-0.5">
                {(['calendario', 'historico', 'configuracao'] as Aba[]).map((chave) => (
                  <button
                    key={chave}
                    type="button"
                    onClick={() => {
                      setAba(chave)
                      // Saindo do Historico com uma desativada escolhida: volta
                      // para a primeira ativa, que e a unica coisa que o
                      // calendario e a configuracao sabem mostrar.
                      if (chave !== 'historico' && unidadeInativa) setUnitId(units[0]?.id ?? null)
                    }}
                    className={`rounded-lg px-3 py-1.5 text-[10px] font-extrabold transition ${
                      aba === chave ? 'bg-white text-[#081b2c] shadow-sm' : 'text-[#557f75]'
                    }`}
                  >
                    {chave === 'calendario'
                      ? 'Calendário'
                      : chave === 'historico'
                        ? 'Histórico'
                        : 'Configuração'}
                  </button>
                ))}
              </div>
            </div>
            {/* Legenda das cores dos cartoes. Pedida em 23/09/2026: com
                verde, laranja e dois vermelhos, a recepcao precisava saber o
                que cada cor pede dela sem ter de perguntar. So no calendario,
                que e onde as etiquetas aparecem. */}
            {aba === 'calendario' && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-semibold text-[#557f75]">
                {LEGENDA_DA_AGENDA.map((item) => (
                  <span key={item.rotulo} className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${item.cor}`} />
                    {item.rotulo}
                  </span>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => void carregarUnidade()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#eef3f2] px-3 py-1.5 text-[10px] font-extrabold text-[#557f75] transition hover:bg-[#e2ece9]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Atualizar
            </button>
          </div>

          {aba === 'historico' ? (
            <HistoricoDaAgenda
              itens={historico}
              marcando={marcando}
              onMarcar={registrarPresenca}
              onProntuario={prontuarioDe}
            />
          ) : aba === 'calendario' ? (
            <div className="space-y-3">
              {/* Ligar hoje (24/09/2026): o que pede telefonema, de hoje ate
                  amanha, em todas as unidades. As etiquetas dos cartoes so
                  mostravam a unidade aberta. Clicar leva para a unidade. */}
              {ligarHoje.length > 0 && (
                <div className="surface-card rounded-[20px] p-4">
                  <p className="flex items-center gap-2 text-xs font-extrabold text-[#081b2c]">
                    <Phone className="h-3.5 w-3.5 text-[#b42318]" />
                    Ligar hoje ({ligarHoje.length})
                    <span className="text-[10px] font-semibold text-slate-400">
                      consultas até amanhã, todas as unidades
                    </span>
                  </p>
                  <div className="mt-2.5 space-y-1.5">
                    {ligarHoje.map((p) => {
                      const estilo = ESTILO_DE_LIGAR[p.motivo]
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setUnitId(p.unitId)}
                          title={p.detalhe ?? 'Abrir a agenda desta unidade'}
                          className="flex w-full flex-wrap items-center gap-2 rounded-xl bg-[#fafaf8] px-3 py-2 text-left transition hover:bg-[#f0f6fc]"
                        >
                          <span className={`rounded-full px-2 py-0.5 text-[9px] font-extrabold ${estilo.classe}`}>
                            {estilo.rotulo}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-[#081b2c]">
                            {quandoCurto(p.startsAt)} · {p.nome}
                          </span>
                          <span className="text-[10px] font-semibold text-slate-500">
                            {p.telefone || 'sem telefone'} · {p.unitName}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
              {rules.length === 0 && !unidadeAtual?.telemedicina && (
                <div className="flex items-start gap-2 rounded-[16px] border border-[#2f7fc1]/40 bg-[#eef5fd] p-3 text-[11px] font-bold text-[#16456b]">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Esta unidade ainda não tem horário de atendimento definido, então não há
                    horários para oferecer. Vá em Configuração e informe os dias e períodos.
                  </span>
                </div>
              )}

              {dias.length === 0 && (rules.length > 0 || unidadeAtual?.telemedicina) && (
                <div className="surface-card rounded-[22px] p-8 text-center text-xs font-semibold text-slate-500">
                  Nenhum horário disponível nos próximos {prefs.horizonDays} dias.
                </div>
              )}

              {dias.map(([dia, { livres, marcados, bloqueio }]) => (
                <div key={dia} className={`surface-card rounded-[20px] p-4 ${bloqueio ? 'opacity-80' : ''}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-extrabold capitalize text-[#081b2c]">
                      {diaLegivel(dia + 'T12:00:00')}
                    </p>
                    {bloqueio ? (
                      <button
                        type="button"
                        onClick={() =>
                          void acao(() => deleteScheduleException(bloqueio.id), 'Dia liberado.')
                        }
                        className="rounded-lg border border-[#081b2c]/10 px-2.5 py-1 text-[10px] font-bold text-[#557f75] transition hover:bg-[#eef3f2]"
                      >
                        Liberar dia
                      </button>
                    ) : bloqueandoDia?.dia === dia ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input
                          autoFocus
                          value={bloqueandoDia.motivo}
                          onChange={(e) => setBloqueandoDia({ dia, motivo: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') setBloqueandoDia(null)
                          }}
                          placeholder="Motivo (ex.: outro consultório)"
                          className="w-52 rounded-lg border border-[#081b2c]/10 bg-white px-2.5 py-1 text-[10px] outline-none focus:border-[#1f4f78]"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const motivo = bloqueandoDia.motivo
                            void (async () => {
                              if (!(await podeBloquear(dia))) return
                              setBloqueandoDia(null)
                              void acao(
                                () => createScheduleException(clinicId!, dia, motivo, unitId),
                                'Dia bloqueado. Ele não é mais oferecido no WhatsApp.',
                              )
                            })()
                          }}
                          className="rounded-lg bg-[#1f4f78] px-2.5 py-1 text-[10px] font-bold text-white transition hover:bg-[#183f61]"
                        >
                          Bloquear
                        </button>
                        <button
                          type="button"
                          onClick={() => setBloqueandoDia(null)}
                          className="rounded-lg px-2 py-1 text-[10px] font-bold text-slate-400 hover:text-slate-600"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        title="Ninguém consegue marcar neste dia; as consultas já marcadas continuam"
                        onClick={() => setBloqueandoDia({ dia, motivo: '' })}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold text-slate-400 transition hover:bg-[#f3f4f6] hover:text-[#081b2c]"
                      >
                        <CalendarOff className="h-3 w-3" /> Bloquear dia
                      </button>
                    )}
                  </div>
                  {bloqueio && (
                    <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#e9edf1] px-3 py-1.5 text-[10px] font-bold text-[#081b2c]">
                      <CalendarOff className="h-3 w-3" /> Dia bloqueado{bloqueio.reason ? ` · ${bloqueio.reason}` : ''}
                      {bloqueio.unitId === null ? ' · todas as unidades' : ''}
                    </p>
                  )}

                  {marcados.length > 0 && (
                    <div className="mt-2.5 space-y-1.5">
                      {marcados.map((item) => ehReserva(item) ? (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-[#081b2c]/20 bg-[#e9edf1] px-3 py-2"
                        >
                          <p className="min-w-0 flex-1 truncate text-[11px] font-bold text-[#081b2c]">
                            {hora(item.startsAt)} · Reservado{item.staffNote ? ` · ${item.staffNote}` : ''}
                            <span className="ml-1 font-semibold text-slate-500">(não aparece no WhatsApp)</span>
                          </p>
                          <button
                            type="button"
                            title="Liberar horário"
                            onClick={() =>
                              void acao(
                                () => cancelAppointment(item.id, 'Reserva liberada', false, false),
                                'Horário liberado.',
                              )
                            }
                            className="shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:bg-white hover:text-[#081b2c]"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div
                          key={item.id}
                          // No celular os botoes descem para uma linha propria
                          // (15/10/2026): espremidos ao lado, o nome virava
                          // "Enrico..." e a etiqueta quebrava em tres linhas.
                          className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 sm:flex-nowrap ${
                            item.confirmedByClinic
                              ? 'bg-[#081b2c]'
                              : 'border border-[#2f7fc1] bg-[#16456b]'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => abrirConsulta(item)}
                            title="Abrir para editar"
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className="truncate text-[11px] font-bold text-white">
                              {hora(item.startsAt)} · {item.patientName}
                              {!item.confirmedByClinic && ' · AGUARDANDO CONFIRMAÇÃO'}
                            </p>
                            {/* O paciente respondeu ao lembrete. Ate 31/08/2026
                                isso ficava so no banco: a recepcao nao tinha
                                como saber quem tinha confirmado presenca. */}
                            {item.confirmedAt && (
                              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#3fa88a] px-2 py-0.5 text-[9px] font-extrabold text-white">
                                <Check className="h-2.5 w-2.5" strokeWidth={3} />
                                Paciente confirmou presença
                              </span>
                            )}
                            {/* Laranja desde 23/09/2026. Era o mesmo azul do
                                chip de convenio e se confundia com ele: e um
                                pedido que espera a recepcao, nao um dado. */}
                            {item.rescheduleRequestedAt && !item.confirmedAt && (
                              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-orange-500 px-2 py-0.5 text-[9px] font-extrabold text-white">
                                Pediu para remarcar
                              </span>
                            )}
                            {/* Vermelho desde 23/09/2026, a pedido da clinica.
                                Era cinza-claro e passava por "tudo certo":
                                quem nao confirmou e justamente quem a recepcao
                                precisa ligar antes da consulta. */}
                            {!item.confirmedAt && !item.rescheduleRequestedAt && item.reminderSentAt && (
                              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-[9px] font-extrabold text-white">
                                Lembrete enviado, sem resposta
                              </span>
                            )}
                            {/* A tela dizia quando o lembrete saiu e calava
                                quando a Meta recusou - e recusa é exatamente a
                                hora em que alguém precisa saber, porque dá
                                tempo de ligar. O motivo vai no title: é técnico
                                demais para a etiqueta e necessário demais para
                                ficar só no banco. */}
                            {!item.reminderSentAt && item.reminderFailedAt && (
                              <span
                                title={item.reminderFailureReason ?? 'A Meta recusou o envio.'}
                                className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#b42318] px-2 py-0.5 text-[9px] font-extrabold text-white"
                              >
                                Lembrete falhou
                              </span>
                            )}
                            {/* Marcada pela equipe sem telefone nenhum: o
                                lembrete da vespera nao tem para onde ir. Dito
                                agora, da tempo de completar o cadastro. */}
                            {!item.reminderSentAt && !telefoneDoLembrete(item, patients) && (
                              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[9px] font-extrabold text-white/70">
                                Sem telefone: não recebe lembrete
                              </span>
                            )}
                            {/* Uma remarcacao e rotina; tres viram padrao, e
                                padrao merece ser visto antes da consulta e nao
                                depois da falta. Por isso a partir da segunda a
                                etiqueta acende, em vez de sempre sussurrar. */}
                            {/* Convênio à vista, e não escondido no detalhe.
                                A recepção precisa saber ANTES da pessoa chegar
                                se fatura pelo plano ou cobra particular - do
                                contrário descobre com a família na frente,
                                sem tempo de conferir elegibilidade.
                                Particular não ganha etiqueta: é a maioria, e
                                etiquetar o normal só faz barulho. */}
                            {item.insurance && (
                              <span className="mt-1 ml-1 inline-flex items-center gap-1 rounded-full bg-[#2f7fc1] px-2 py-0.5 text-[9px] font-extrabold text-white">
                                💳 {item.insurance}
                              </span>
                            )}
                            {item.rescheduleCount > 0 && (
                              <span
                                className={`mt-1 ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-extrabold ${
                                  item.rescheduleCount >= 2
                                    ? 'bg-[#2f7fc1] text-white'
                                    : 'bg-white/15 text-white/70'
                                }`}
                              >
                                <RotateCcw className="h-2.5 w-2.5" strokeWidth={3} />
                                Remarcada {item.rescheduleCount}x
                              </span>
                            )}
                            {/* Por video: o horario e desta unidade, mas a
                                pessoa nao vem. Sem a etiqueta a recepcao
                                esperaria alguem na porta. */}
                            {item.ficha.telemedicina && (
                              <span className="mt-1 ml-1 inline-flex items-center gap-1 rounded-full bg-[#7ab8ea] px-2 py-0.5 text-[9px] font-extrabold text-[#081b2c]">
                                <Video className="h-2.5 w-2.5" strokeWidth={3} />
                                Telemedicina
                              </span>
                            )}
                            {/* Retorno dentro dos 30 dias: esta incluido no valor
                                da consulta anterior, e quem olha a agenda nao
                                tinha como saber - "retorno" so existia dentro do
                                prontuario. Leva a data junto porque e ela que
                                decide, e evita abrir a ficha para conferir.

                                Avisa, nao manda: o valor nao muda, nada e
                                bloqueado, e a regra dos 30 dias e do consultorio,
                                que abre excecao quando quer. */}
                            {item.retornoDe && (
                              <span
                                className="mt-1 ml-1 inline-flex items-center gap-1 rounded-full bg-[#3fa88a] px-2 py-0.5 text-[9px] font-extrabold text-white"
                                title="O paciente se consultou há menos de 30 dias. O retorno costuma estar incluído no valor da consulta anterior."
                              >
                                <RotateCcw className="h-2.5 w-2.5" strokeWidth={3} />
                                Retorno · consulta em {fmtDiaMes(item.retornoDe)}
                              </span>
                            )}
                            <p className="text-[9px] font-bold text-white/60">
                              {item.confirmedByClinic
                                ? [
                                    item.source === 'whatsapp'
                                      ? 'marcado pelo paciente no WhatsApp'
                                      : 'marcado pela equipe',
                                    // Sem vinculo, o telefone e a unica pista de
                                    // quem vem - e o aviso lembra que falta
                                    // cadastrar para virar prontuario.
                                    ...(item.patientId
                                      ? []
                                      : [
                                          item.contactPhone || 'telefone não informado',
                                          'sem cadastro',
                                        ]),
                                  ].join(' · ')
                                : `sem cadastro · ${item.contactPhone || 'telefone não informado'} · ` +
                                  `vaga reservada até ${
                                    item.holdExpiresAt
                                      ? new Date(item.holdExpiresAt).toLocaleString('pt-BR', {
                                          day: '2-digit',
                                          month: '2-digit',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })
                                      : '-'
                                  }`}
                            </p>
                          </button>
                          {/* Solicitacao de quem nao tem cadastro: a recepcao
                              precisa aceitar, senao a vaga se libera sozinha. */}
                          {!item.confirmedByClinic && (
                            <button
                              type="button"
                              title="Confirmar solicitação"
                              onClick={() =>
                                void confirmarEAvisar(item.id)
                              }
                              className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1 text-[9px] font-extrabold text-white transition hover:bg-white/25"
                            >
                              Confirmar
                            </button>
                          )}
                          {/* Prontuario e Editar (15/10/2026): so para quem
                              atende, e so com cadastro. Ver BotaoDaConsulta. */}
                          {item.confirmedByClinic && (prontuarioDe(item) || ehHoje(item.startsAt)) && (
                          <div className="order-last flex w-full flex-wrap items-center gap-1 sm:order-none sm:w-auto sm:shrink-0 sm:flex-nowrap">
                          {prontuarioDe(item) && (
                            <div className="flex shrink-0 items-center gap-1">
                              <BotaoDaConsulta rotulo="Prontuário" icone={FileText} destaque onClick={prontuarioDe(item)!} />
                              <BotaoDaConsulta rotulo="Editar" icone={Pencil} onClick={() => abrirConsulta(item)} />
                            </div>
                          )}
                          {/* Presenca no proprio dia (24/09/2026). So para
                              consulta confirmada e de hoje: reserva provisoria
                              ainda nao e consulta, e amanha ninguem chegou. */}
                          {ehHoje(item.startsAt) && (
                            <div className="flex shrink-0 items-center gap-1">
                              <BotaoPresenca
                                ativo={item.status === 'attended'}
                                corAtiva="#3fa88a"
                                rotulo="Chegou"
                                ocupado={marcando === item.id}
                                onClick={() =>
                                  void registrarPresenca(item.id, item.status === 'attended' ? 'scheduled' : 'attended')
                                }
                              />
                              <BotaoPresenca
                                ativo={item.status === 'no_show'}
                                corAtiva="#b42318"
                                rotulo="Faltou"
                                ocupado={marcando === item.id}
                                onClick={() =>
                                  void registrarPresenca(item.id, item.status === 'no_show' ? 'scheduled' : 'no_show')
                                }
                              />
                            </div>
                          )}
                          </div>
                          )}
                          <button
                            type="button"
                            title="Cancelar"
                            onClick={() =>
                              setCancelando({
                                id: item.id,
                                paciente: item.patientName,
                                quando: `${diaLegivel(item.startsAt)}, ${hora(item.startsAt)}`,
                              })
                            }
                            className="shrink-0 rounded-lg p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {livres.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {livres.map((slot) => {
                        /* Horario que vagou porque o paciente cancelou sozinho.
                           Ambar, e nao verde nem vermelho: nao e problema nem
                           conquista, e uma vaga de ultima hora que alguem pode
                           querer. Quem esta na fila de espera cabe aqui. */
                        const vaga = vagaPorInstante.get(new Date(slot).getTime())
                        const origem = origemDoHorario.get(new Date(slot).toISOString())
                        return (
                          <button
                            key={slot}
                            type="button"
                            onClick={() => setSlotEscolhido(slot)}
                            title={
                              origem
                                ? `Livre em ${origem}. Marcando aqui, vira consulta por vídeo e o horário fecha lá.`
                                : vaga
                                ? `${vaga.paciente} cancelou${
                                    vaga.canceladoEm ? ` em ${diaEHora(vaga.canceladoEm)}` : ''
                                  }. O horário está livre.`
                                : undefined
                            }
                            className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold transition ${
                              vaga
                                ? 'border-[#c98a2b]/45 bg-[#fdf4e3] text-[#8a5a12] hover:border-[#c98a2b] hover:bg-[#fbecd2]'
                                : 'border-[#081b2c]/10 bg-[#fafaf8] text-[#081b2c] hover:border-[#2f7fc1] hover:bg-white'
                            }`}
                          >
                            {vaga && <span aria-hidden="true">↩ </span>}
                            {hora(slot)}
                            {origem && <span className="ml-1 font-semibold text-slate-400">· {origem}</span>}
                          </button>
                        )
                      })}
                      {livres.some((slot) => vagaPorInstante.has(new Date(slot).getTime())) && (
                        <span className="ml-1 text-[10px] font-semibold text-[#8a5a12]">
                          ↩ vagou por cancelamento
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Horarios de atendimento */}
              <div className="surface-card rounded-[20px] p-4">
                <p className="flex items-center gap-1.5 text-xs font-extrabold text-[#081b2c]">
                  <Clock className="h-3.5 w-3.5 text-[#2f7fc1]" />
                  Horários de atendimento
                </p>
                <p className="mt-1 text-[10px] text-slate-500">
                  Em {unidadeAtual?.name}. Pode haver mais de um período no mesmo dia, por exemplo
                  manhã e tarde.
                </p>

                <div className="mt-3 space-y-1.5">
                  {rules.length === 0 && (
                    <p className="text-[11px] text-slate-400">Nenhum período definido ainda.</p>
                  )}
                  {rules.map((regra) => (
                    <div
                      key={regra.id}
                      className="flex items-center justify-between gap-2 rounded-xl bg-[#fafaf8] px-3 py-2"
                    >
                      <span className="text-[11px] font-bold text-[#081b2c]">
                        {WEEKDAY_LABEL[regra.weekday]} · {regra.startsAt} às {regra.endsAt}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void acao(() => deleteAvailabilityRule(regra.id), 'Período removido.')
                        }
                        className="rounded-lg p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-[#081b2c]/[0.07] pt-3">
                  <select
                    value={novaRegra.weekday}
                    onChange={(e) => setNovaRegra({ ...novaRegra, weekday: Number(e.target.value) })}
                    className="rounded-xl border border-[#081b2c]/10 bg-white px-2 py-1.5 text-[11px] outline-none"
                  >
                    {WEEKDAY_LABEL.map((nome, indice) => (
                      <option key={nome} value={indice}>
                        {nome}
                      </option>
                    ))}
                  </select>
                  <input
                    type="time"
                    value={novaRegra.inicio}
                    onChange={(e) => setNovaRegra({ ...novaRegra, inicio: e.target.value })}
                    className="rounded-xl border border-[#081b2c]/10 bg-white px-2 py-1.5 text-[11px] outline-none"
                  />
                  <input
                    type="time"
                    value={novaRegra.fim}
                    onChange={(e) => setNovaRegra({ ...novaRegra, fim: e.target.value })}
                    className="rounded-xl border border-[#081b2c]/10 bg-white px-2 py-1.5 text-[11px] outline-none"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void acao(async () => {
                        if (!clinicId || !unitId) return
                        if (novaRegra.fim <= novaRegra.inicio) {
                          throw new Error('O fim do período precisa ser depois do início.')
                        }
                        await createAvailabilityRule(
                          clinicId,
                          unitId,
                          novaRegra.weekday,
                          novaRegra.inicio,
                          novaRegra.fim,
                        )
                      }, 'Período adicionado.')
                    }
                    className="inline-flex items-center gap-1 rounded-xl bg-[#081b2c] px-3 py-1.5 text-[10px] font-bold text-white transition hover:bg-[#102d47]"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Adicionar
                  </button>
                </div>
              </div>

              {/* Datas bloqueadas */}
              <div className="surface-card rounded-[20px] p-4">
                <p className="flex items-center gap-1.5 text-xs font-extrabold text-[#081b2c]">
                  <CalendarOff className="h-3.5 w-3.5 text-[#2f7fc1]" />
                  Datas bloqueadas
                </p>
                <p className="mt-1 text-[10px] text-slate-500">
                  Feriado, férias, congresso. O dia some da agenda e deixa de ser oferecido ao
                  paciente.
                </p>

                <div className="mt-3 space-y-1.5">
                  {exceptions.length === 0 && (
                    <p className="text-[11px] text-slate-400">Nenhuma data bloqueada.</p>
                  )}
                  {exceptions.map((excecao) => (
                    <div
                      key={excecao.id}
                      className="flex items-center justify-between gap-2 rounded-xl bg-[#fafaf8] px-3 py-2"
                    >
                      <span className="min-w-0 truncate text-[11px] font-bold text-[#081b2c]">
                        {new Intl.DateTimeFormat('pt-BR').format(
                          new Date(excecao.date + 'T12:00:00'),
                        )}
                        {excecao.reason && (
                          <span className="font-normal text-slate-500"> · {excecao.reason}</span>
                        )}
                        {!excecao.unitId && (
                          <span className="font-normal text-slate-400"> · todas as unidades</span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void acao(() => deleteScheduleException(excecao.id), 'Bloqueio removido.')
                        }
                        className="rounded-lg p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-[#081b2c]/[0.07] pt-3">
                  <input
                    type="date"
                    value={novoBloqueio.data}
                    onChange={(e) => setNovoBloqueio({ ...novoBloqueio, data: e.target.value })}
                    className="rounded-xl border border-[#081b2c]/10 bg-white px-2 py-1.5 text-[11px] outline-none"
                  />
                  <input
                    value={novoBloqueio.motivo}
                    onChange={(e) => setNovoBloqueio({ ...novoBloqueio, motivo: e.target.value })}
                    placeholder="Motivo"
                    className="min-w-[120px] flex-1 rounded-xl border border-[#081b2c]/10 bg-white px-2 py-1.5 text-[11px] outline-none"
                  />
                  <button
                    type="button"
                    disabled={!novoBloqueio.data}
                    onClick={() =>
                      void acao(async () => {
                        if (!clinicId) return
                        if (!(await podeBloquear(novoBloqueio.data))) return
                        await createScheduleException(
                          clinicId,
                          novoBloqueio.data,
                          novoBloqueio.motivo,
                          unitId,
                        )
                        setNovoBloqueio({ data: '', motivo: '' })
                      }, 'Data bloqueada.')
                    }
                    className="inline-flex items-center gap-1 rounded-xl bg-[#081b2c] px-3 py-1.5 text-[10px] font-bold text-white transition hover:bg-[#102d47] disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Bloquear
                  </button>
                </div>
              </div>

              {/* Preferencias */}
              <div className="surface-card rounded-[20px] p-4">
                <p className="flex items-center gap-1.5 text-xs font-extrabold text-[#081b2c]">
                  <Settings2 className="h-3.5 w-3.5 text-[#2f7fc1]" />
                  Preferências da agenda
                </p>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {[
                    {
                      chave: 'slotMinutes' as const,
                      rotulo: 'Duração (min)',
                      min: 5,
                      max: 240,
                      ajuda: 'Quanto dura cada consulta. É o tamanho de cada horário que o bot oferece pelo WhatsApp e que a agenda desenha.',
                    },
                    {
                      chave: 'horizonDays' as const,
                      rotulo: 'Janela (dias)',
                      min: 1,
                      max: 180,
                      ajuda: 'Até quantos dias à frente a família pode marcar pelo WhatsApp. Com 45, o bot só oferece datas dentro dos próximos 45 dias.',
                    },
                    {
                      chave: 'minNoticeHours' as const,
                      rotulo: 'Antecedência (h)',
                      min: 0,
                      max: 168,
                      ajuda: 'Antecedência mínima para marcar pelo WhatsApp. Com 2, o bot só oferece horários que comecem pelo menos 2 horas depois do momento em que a família está marcando.',
                    },
                  ].map((campo) => (
                    <label key={campo.chave} className="block">
                      <span className="flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-wide text-slate-400">
                        {campo.rotulo}
                        <Ajuda texto={campo.ajuda} />
                      </span>
                      <input
                        type="number"
                        min={campo.min}
                        max={campo.max}
                        value={prefs[campo.chave]}
                        onChange={(e) =>
                          setPrefs({ ...prefs, [campo.chave]: Number(e.target.value) })
                        }
                        className="mt-1 w-full rounded-xl border border-[#081b2c]/10 bg-white px-2 py-1.5 text-[11px] outline-none focus:border-[#2f7fc1]"
                      />
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-[10px] text-slate-500">
                  Valem para o agendamento pelo WhatsApp; a recepção continua marcando qualquer horário.
                </p>

                {/* Lembrete de consulta. Fica junto das preferencias porque e
                    salvo no mesmo botao - dois "salvar" no mesmo cartao
                    confundiriam sobre o que cada um grava. */}
                <div className="mt-4 border-t border-[#081b2c]/[0.07] pt-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={prefs.reminderEnabled}
                      onChange={(e) => setPrefs({ ...prefs, reminderEnabled: e.target.checked })}
                      className="h-3.5 w-3.5 accent-[#2f7fc1]"
                    />
                    <span className="text-[11px] font-bold text-[#081b2c]">
                      Enviar lembrete de consulta pelo WhatsApp
                    </span>
                  </label>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={30}
                      disabled={!prefs.reminderEnabled}
                      value={prefs.reminderDays}
                      onChange={(e) => setPrefs({ ...prefs, reminderDays: Number(e.target.value) })}
                      className="w-16 rounded-xl border border-[#081b2c]/10 bg-white px-2 py-1.5 text-[11px] outline-none focus:border-[#2f7fc1] disabled:bg-slate-50 disabled:text-slate-400"
                    />
                    <span className="text-[11px] text-slate-600">
                      {prefs.reminderDays === 0
                        ? 'dias antes. Envia na manhã do próprio dia'
                        : prefs.reminderDays === 1
                          ? 'dia antes. Envia na véspera'
                          : 'dias antes da consulta'}
                    </span>
                  </div>
                  {/* Dizia "sai todo dia às 10h", que deixou de ser verdade em
                      31/08/2026, quando a passada única virou uma varredura de
                      hora em hora. Quem marcava às 11h e lia isto concluía que
                      o paciente ficaria sem lembrete - e não fica. */}
                  <p className="mt-2 text-[10px] text-slate-500">
                    O sistema confere de hora em hora e envia entre 8h e 20h, uma vez por consulta.
                    O paciente responde CONFIRMAR ou REAGENDAR; quem pede para remarcar aparece
                    marcado em Respostas.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    void acao(async () => {
                      if (!clinicId) return
                      await saveSchedulePreferences(clinicId, prefs)
                    }, 'Preferências salvas.')
                  }
                  className="mt-3 rounded-xl bg-[#081b2c] px-4 py-2 text-[10px] font-bold text-white transition hover:bg-[#102d47]"
                >
                  Salvar preferências
                </button>
              </div>

              {/* Unidades. Desde 14/10/2026 cada uma abre num cartao com
                  endereco, valor e o texto que o robo responde sobre ela:
                  antes o texto ficava em Configuracoes, longe do valor que ele
                  citava, e mudar o preco era lembrar de tres lugares. */}
              <div className="surface-card rounded-[20px] p-4">
                <p className="flex items-center gap-1.5 text-xs font-extrabold text-[#081b2c]">
                  <Building2 className="h-3.5 w-3.5 text-[#2f7fc1]" />
                  Unidades
                  <Ajuda texto="Clique numa unidade para mudar endereço, valor da consulta e o que o robô responde sobre ela. Nos textos, {valor} e {endereco} são trocados pelo que está no cartão na hora de enviar: mudou aqui, muda em toda mensagem." />
                </p>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  Endereço, valor e o que o robô responde sobre cada uma.
                </p>
                <div className="mt-3 space-y-1.5">
                  {/* Sem a agenda propria da telemedicina (clinica criada
                      depois de 03/10/2026), o cartao dela aparece mesmo assim:
                      o texto, o valor e o liga/desliga precisam de um lugar. */}
                  {(units.some((u) => u.telemedicina) || !tele
                    ? units
                    : [...units, { id: '', name: 'Telemedicina', address: '', cnes: '', telemedicina: true }]
                  ).map((u) => (
                    <CartaoDaUnidade
                      key={u.id || 'telemedicina'}
                      unidade={u}
                      tele={u.telemedicina ? tele : null}
                      lugares={lugares}
                      clinicId={clinicId ?? ''}
                      podeArquivar={Boolean(u.id) && units.length > 1}
                      onSalvo={(mensagem) => void acao(async () => {}, mensagem)}
                      onArquivar={() =>
                        void acao(async () => {
                          await archiveUnit(u.id)
                          if (unitId === u.id) setUnitId(null)
                        }, 'Unidade arquivada. O histórico foi preservado.')
                      }
                    />
                  ))}
                </div>
                <div className="mt-3 border-t border-[#081b2c]/[0.07] pt-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <input
                      value={novaUnidade.nome}
                      onChange={(e) => setNovaUnidade({ ...novaUnidade, nome: e.target.value })}
                      placeholder="Nome"
                      className="min-w-[100px] flex-1 rounded-xl border border-[#081b2c]/10 bg-white px-2 py-1.5 text-[11px] outline-none"
                    />
                    <input
                      value={novaUnidade.endereco}
                      onChange={(e) => setNovaUnidade({ ...novaUnidade, endereco: e.target.value })}
                      placeholder="Endereço"
                      className="min-w-[100px] flex-[2] rounded-xl border border-[#081b2c]/10 bg-white px-2 py-1.5 text-[11px] outline-none"
                    />
                    <input
                      value={novaUnidade.valor}
                      onChange={(e) => setNovaUnidade({ ...novaUnidade, valor: e.target.value })}
                      placeholder="Valor (R$)"
                      inputMode="decimal"
                      className="w-[92px] rounded-xl border border-[#081b2c]/10 bg-white px-2 py-1.5 text-[11px] outline-none"
                    />
                    <button
                      type="button"
                      disabled={Boolean(faltaNaNova)}
                      onClick={() =>
                        void acao(async () => {
                          if (!clinicId || !('centavos' in valorDaNova)) return
                          await createUnit(clinicId, novaUnidade.nome, novaUnidade.endereco, valorDaNova.centavos)
                          setNovaUnidade({ nome: '', endereco: '', valor: '' })
                        }, 'Unidade cadastrada. Abra o cartão dela para escrever o que o robô responde.')
                      }
                      className="inline-flex items-center gap-1 rounded-xl bg-[#081b2c] px-3 py-1.5 text-[10px] font-bold text-white transition hover:bg-[#102d47] disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Adicionar
                    </button>
                  </div>
                  {faltaNaNova && (novaUnidade.nome || novaUnidade.endereco || novaUnidade.valor) && (
                    <p className="mt-1.5 text-[10px] font-semibold text-[#b54708]">{faltaNaNova}</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Marcar consulta num horario livre */}
      {slotEscolhido && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#081b2c]/40 p-4">
          <div className="w-full max-w-sm rounded-[22px] bg-white p-5 shadow-xl">
            <p className="flex items-center gap-1.5 text-sm font-extrabold text-[#081b2c]">
              <CalendarPlus className="h-4 w-4 text-[#1f4f78]" />
              Marcar consulta
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              {diaLegivel(slotEscolhido)} às {hora(slotEscolhido)} · {unidadeAtual?.name}
            </p>

            {/* Reservar sem paciente: o medico tem outro compromisso e a vaga
                nao pode ser oferecida no WhatsApp. Fica aqui em cima, curto,
                porque e o caso mais comum de clique num horario vazio depois
                de marcar consulta. */}
            <div className="mt-4 rounded-[14px] border border-dashed border-[#081b2c]/15 bg-[#f6f7f9] p-3">
              <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
                Reservar sem paciente
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  value={motivoReserva}
                  onChange={(e) => setMotivoReserva(e.target.value)}
                  placeholder="Motivo (ex.: outro consultório)"
                  className="min-w-0 flex-1 rounded-xl border border-[#081b2c]/10 bg-white px-3 py-2 text-xs outline-none focus:border-[#1f4f78]"
                />
                <button
                  type="button"
                  onClick={() => {
                    const inicio = slotEscolhido
                    const motivo = motivoReserva.trim()
                    setSlotEscolhido(null)
                    setMotivoReserva('')
                    void acao(async () => {
                      if (!clinicId || !unitId) return
                      await createAppointment(clinicId, unitId, null, inicio, prefs.slotMinutes, motivo)
                    }, 'Horário reservado. Ele não é mais oferecido no WhatsApp.')
                  }}
                  className="shrink-0 rounded-xl bg-[#1f4f78] px-3 py-2 text-[11px] font-bold text-white transition hover:bg-[#183f61]"
                >
                  Reservar
                </button>
              </div>
            </div>

            <p className="mt-4 text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
              Ou marcar consulta
            </p>

            <select
              value={novaConsulta.patientId}
              onChange={(e) => setNovaConsulta({ patientId: e.target.value, nome: '', telefone: '' })}
              className="mt-2 w-full rounded-xl border border-[#081b2c]/10 bg-[#fafaf8] px-3 py-2 text-xs outline-none focus:border-[#1f4f78]"
            >
              <option value="">Selecione o paciente</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>

            {/* Quem ainda nao esta na base entra por aqui, com nome e WhatsApp.
                Sem o telefone a consulta nasce muda: nao recebe o lembrete da
                vespera e o sistema tambem nao consegue criar o cadastro
                sozinho. Dois campos evitam as duas coisas. */}
            {!novaConsulta.patientId && (
              <div className="mt-3 rounded-[14px] border border-[#081b2c]/10 bg-[#fafaf8] p-3">
                <p className="text-[10px] font-bold text-slate-500">
                  Ainda não é cadastrado? Informe nome e WhatsApp.
                </p>
                <input
                  value={novaConsulta.nome}
                  onChange={(e) => setNovaConsulta({ ...novaConsulta, nome: e.target.value })}
                  placeholder="Nome do paciente"
                  className="mt-2 w-full rounded-xl border border-[#081b2c]/10 bg-white px-3 py-2 text-xs outline-none focus:border-[#1f4f78]"
                />
                <input
                  value={novaConsulta.telefone}
                  onChange={(e) => setNovaConsulta({ ...novaConsulta, telefone: e.target.value })}
                  placeholder="WhatsApp com DDD"
                  inputMode="tel"
                  className="mt-2 w-full rounded-xl border border-[#081b2c]/10 bg-white px-3 py-2 text-xs outline-none focus:border-[#1f4f78]"
                />
                <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                  Na véspera ele recebe o lembrete para confirmar, e o cadastro é criado
                  automaticamente com esses dados.
                </p>
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setSlotEscolhido(null)
                  setMotivoReserva('')
                  setNovaConsulta({ patientId: '', nome: '', telefone: '' })
                }}
                className="rounded-xl bg-[#eef3f2] px-3 py-2 text-[11px] font-bold text-[#557f75]"
              >
                Cancelar
              </button>
              <button
                type="button"
                // Ou um paciente da base, ou um nome digitado. Marcar sem
                // nenhum dos dois criaria uma consulta de ninguem - para isso
                // existe "Reservar sem paciente", logo acima.
                disabled={!novaConsulta.patientId && novaConsulta.nome.trim().length < 2}
                onClick={() => {
                  const inicio = slotEscolhido
                  const escolha = novaConsulta
                  setSlotEscolhido(null)
                  setNovaConsulta({ patientId: '', nome: '', telefone: '' })
                  void acao(async () => {
                    if (!clinicId || !unitId) return
                    await createAppointment(
                      clinicId,
                      unitId,
                      escolha.patientId || null,
                      inicio,
                      prefs.slotMinutes,
                      '',
                      { nome: escolha.nome, telefone: escolha.telefone },
                    )
                  }, telefoneCurto(escolha)
                    ? 'Consulta marcada. Sem WhatsApp completo, essa pessoa não recebe o lembrete da véspera.'
                    : 'Consulta marcada.')
                }}
                className="rounded-xl bg-[#081b2c] px-4 py-2 text-[11px] font-bold text-white transition hover:bg-[#102d47] disabled:opacity-40"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      <Sheet open={emEdicao !== null} onOpenChange={(aberto) => !aberto && setEmEdicao(null)}>
        <SheetContent
          side="right"
          className="w-full gap-0 border-l border-[#081b2c]/10 bg-[#fbfaf8] p-0 sm:max-w-[520px]"
        >
          {emEdicao && (
            <>
              <SheetHeader className="border-b border-[#081b2c]/[0.07] bg-white px-5 pb-5 pt-6">
                <SheetTitle className="text-left text-lg font-extrabold tracking-[-0.03em] text-[#081b2c]">
                  {diaLegivel(emEdicao.startsAt)}, {hora(emEdicao.startsAt)}
                </SheetTitle>
                <SheetDescription className="mt-1 text-left text-[11px]">
                  {emEdicao.source === 'whatsapp'
                    ? 'Marcada pelo próprio paciente no WhatsApp.'
                    : 'Marcada pela equipe.'}
                  {!emEdicao.confirmedByClinic && ' Ainda aguardando confirmação.'}
                  {emEdicao.rescheduleCount > 0 &&
                    ` Já foi remarcada ${emEdicao.rescheduleCount}x.`}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-5 overflow-y-auto px-5 py-5">
                {/* Vincular vem primeiro: e o que falta para a consulta virar
                    prontuario e disparar os acompanhamentos. */}
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">
                    Paciente
                  </p>
                  {formConsulta.patientId ? (
                    <div className="mt-2 flex items-center justify-between gap-2 rounded-[14px] border border-[#557f75]/30 bg-[#eef3f2] px-3 py-2.5">
                      <span className="truncate text-[11px] font-bold text-[#2f5a50]">
                        {patients.find((p) => p.id === formConsulta.patientId)?.nome ??
                          'Paciente vinculado'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setFormConsulta({ ...formConsulta, patientId: '' })}
                        className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-extrabold text-[#557f75] transition hover:bg-white"
                      >
                        Trocar
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="mt-1 text-[10px] text-slate-500">
                        Sem paciente vinculado, esta consulta não entra no prontuário nem gera
                        acompanhamento de 15, 30 e 90 dias.
                      </p>
                      {/* Mesmo telefone: e quase sempre a pessoa certa, entao
                          vem antes da busca e ja destacado. */}
                      {sugeridos.length > 0 && (
                        <div className="mt-2">
                          <p className="text-[9px] font-extrabold uppercase tracking-wide text-[#557f75]">
                            Mesmo telefone desta consulta
                          </p>
                          <div className="mt-1 space-y-1">
                            {sugeridos.slice(0, MAX_SUGESTOES).map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => setFormConsulta({ ...formConsulta, patientId: p.id })}
                                className="flex w-full items-center justify-between gap-2 rounded-[12px] border border-[#557f75]/40 bg-[#eef3f2] px-3 py-2 text-left transition hover:border-[#557f75]"
                              >
                                <span className="truncate text-[11px] font-bold text-[#2f5a50]">
                                  {p.nome}
                                </span>
                                <span className="shrink-0 text-[10px] text-[#557f75]">
                                  {p.telefone}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <input
                        value={buscaPaciente}
                        onChange={(e) => setBuscaPaciente(e.target.value)}
                        placeholder="Buscar entre os pacientes cadastrados"
                        className="mt-2 w-full rounded-[12px] border border-[#081b2c]/10 bg-white px-3 py-2 text-[11px] outline-none focus:border-[#2f7fc1]"
                      />
                      <div className="mt-2 space-y-1">
                        {encontrados.slice(0, MAX_SUGESTOES).map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setFormConsulta({ ...formConsulta, patientId: p.id })}
                            className="flex w-full items-center justify-between gap-2 rounded-[12px] border border-[#081b2c]/10 bg-white px-3 py-2 text-left transition hover:border-[#2f7fc1]"
                          >
                            <span className="truncate text-[11px] font-bold text-[#081b2c]">
                              {p.nome}
                            </span>
                            <span className="shrink-0 text-[10px] text-slate-400">{p.telefone}</span>
                          </button>
                        ))}

                        {encontrados.length > MAX_SUGESTOES && (
                          <p className="px-1 text-[10px] text-slate-400">
                            e mais {encontrados.length - MAX_SUGESTOES}. Escreva um pouco mais para afinar
                            a busca.
                          </p>
                        )}

                        {buscaPaciente.trim().length === 0 && (
                          <p className="rounded-[12px] bg-white px-3 py-3 text-center text-[10px] text-slate-400">
                            Digite o nome ou o telefone para procurar entre os{' '}
                            {patients.length} pacientes cadastrados.
                          </p>
                        )}

                        {buscaPaciente.trim().length > 0 && encontrados.length === 0 && (
                          <p className="rounded-[12px] bg-white px-3 py-3 text-center text-[10px] text-slate-400">
                            {buscaPaciente.trim().length < 2
                              ? 'Escreva ao menos duas letras.'
                              : 'Nenhum paciente encontrado com esse nome ou telefone.'}
                          </p>
                        )}
                      </div>
                      {onCadastrarContato && (
                        <button
                          type="button"
                          onClick={() =>
                            onCadastrarContato({
                              // O nome da crianca informado no agendamento vale
                              // mais do que o nome do perfil do WhatsApp, que
                              // costuma ser o da mae.
                              nome: emEdicao.ficha.nome || formConsulta.contactName,
                              telefone: formConsulta.contactPhone,
                              nascimento: emEdicao.ficha.nascimento,
                              responsavel: emEdicao.ficha.responsavel,
                              cpf: emEdicao.ficha.cpf,
                              email: emEdicao.ficha.email,
                              // A consulta ja sabe quando e onde: repetir isso a
                              // mao e onde nasce divergencia entre agenda e
                              // cadastro.
                              dataConsulta: emEdicao.startsAt.slice(0, 10),
                              unidade: unidadeAtual?.name,
                            })
                          }
                          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-[12px] border border-[#081b2c]/15 bg-white px-3 py-2.5 text-[10px] font-extrabold text-[#081b2c] transition hover:border-[#2f7fc1] hover:text-[#16456b]"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Cadastrar como paciente novo
                        </button>
                      )}
                    </>
                  )}
                </div>

                {(emEdicao.ficha.nome ||
                  emEdicao.ficha.nascimento ||
                  emEdicao.ficha.responsavel ||
                  emEdicao.ficha.cpf ||
                  emEdicao.ficha.email) && (
                  <div className="rounded-[16px] border border-[#2f7fc1]/25 bg-[#f1f7fd] p-3.5">
                    <p className="text-[10px] font-extrabold uppercase tracking-wide text-[#1f4f78]">
                      Informado pela família no WhatsApp
                    </p>
                    <dl className="mt-2 space-y-1.5">
                      {[
                        ['Paciente', emEdicao.ficha.nome],
                        ['Nascimento', emEdicao.ficha.nascimento],
                        ['Responsável', emEdicao.ficha.responsavel],
                        ['CPF', emEdicao.ficha.cpf],
                        ['E-mail', emEdicao.ficha.email],
                      ].map(([rotulo, valor]) => (
                        <div key={rotulo} className="grid grid-cols-[92px_1fr] gap-2 text-[11px]">
                          <dt className="font-bold text-slate-400">{rotulo}</dt>
                          <dd className={valor ? 'font-semibold text-[#081b2c]' : 'text-slate-300'}>
                            {valor || 'não informado'}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {/* A familia respondeu por mensagem, sem ninguem conferir.
                        Com paciente vinculado o dado ja foi para a ficha dele -
                        e a tela precisa dizer isso, senao a equipe digita de
                        novo achando que nada foi salvo. */}
                    <p className="mt-2 text-[10px] leading-relaxed text-slate-400">
                      {emEdicao.patientId
                        ? 'Declarado pela família. Os campos que estavam vazios já foram para o cadastro do paciente; confira em Pacientes.'
                        : 'Dados declarados pela família; confira ao cadastrar.'}
                    </p>
                  </div>
                )}

                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">
                    Quem marcou
                  </p>
                  <input
                    value={formConsulta.contactName}
                    onChange={(e) =>
                      setFormConsulta({ ...formConsulta, contactName: e.target.value })
                    }
                    placeholder="Nome informado no contato"
                    className="mt-1 w-full rounded-[12px] border border-[#081b2c]/10 bg-white px-3 py-2 text-[11px] outline-none focus:border-[#2f7fc1]"
                  />
                  <input
                    value={formConsulta.contactPhone}
                    onChange={(e) =>
                      setFormConsulta({ ...formConsulta, contactPhone: e.target.value })
                    }
                    placeholder="Telefone"
                    className="mt-2 w-full rounded-[12px] border border-[#081b2c]/10 bg-white px-3 py-2 text-[11px] outline-none focus:border-[#2f7fc1]"
                  />
                </div>

                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400">
                    Observação da equipe
                  </p>
                  <textarea
                    value={formConsulta.staffNote}
                    onChange={(e) =>
                      setFormConsulta({ ...formConsulta, staffNote: e.target.value })
                    }
                    rows={4}
                    placeholder="Recado interno sobre esta consulta"
                    className="mt-1 w-full resize-y rounded-[12px] border border-[#081b2c]/10 bg-white p-3 text-[11px] leading-relaxed outline-none focus:border-[#2f7fc1]"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-[#081b2c]/[0.07] bg-white px-5 py-4">
                <button
                  type="button"
                  onClick={() => void salvarConsulta()}
                  disabled={salvandoConsulta}
                  className="rounded-xl bg-[#081b2c] px-4 py-2.5 text-[11px] font-extrabold text-white transition hover:bg-[#102d47] disabled:opacity-40"
                >
                  {salvandoConsulta ? 'Salvando...' : 'Salvar'}
                </button>
                {!emEdicao.confirmedByClinic && (
                  <button
                    type="button"
                    onClick={() => {
                      const id = emEdicao.id
                      setEmEdicao(null)
                      void confirmarEAvisar(id)
                    }}
                    className="rounded-xl bg-[#557f75] px-4 py-2.5 text-[11px] font-extrabold text-white transition hover:bg-[#456a61]"
                  >
                    Confirmar consulta
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setCancelando({
                      id: emEdicao.id,
                      paciente: emEdicao.patientName,
                      quando: `${diaLegivel(emEdicao.startsAt)}, ${hora(emEdicao.startsAt)}`,
                    })
                    setEmEdicao(null)
                  }}
                  className="ml-auto rounded-xl px-3 py-2.5 text-[11px] font-extrabold text-red-600 transition hover:bg-red-50"
                >
                  Cancelar consulta
                </button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
