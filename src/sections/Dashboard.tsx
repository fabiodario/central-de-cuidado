import { useEffect, useState } from 'react'
import {
  Activity,
  ArrowUpRight,
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  HeartPulse,
  MapPinned,
  Stethoscope,
  Building2,
  MessageCircle,
  UsersRound,
} from 'lucide-react'
import type { Patient } from '@/types/patient'
import type { PendingRequest } from '@/lib/repository'
import { dueCount, idadeAnos, pendingFollowups } from '@/lib/followup'
import { nomeDoCid } from '@/lib/cid'
import NumerosDoWhatsApp from '@/sections/NumerosDoWhatsApp'

const NAVY = '#081b2c'
// Azul de destaque do sistema (proposta 3, aprovada em 08/09/2026). O nome
// antigo era PEACH: a cor mudou, o papel na tela e o mesmo.
const AZUL = '#2f7fc1'
const SAGE = '#6f9d91'

const cardClass = 'surface-card rounded-[24px]'

/**
 * As duas leituras da Visão geral.
 *
 * "Base clínica" descreve quem já é paciente: perfil, CID, convênio, ritmo de
 * consultas. "WhatsApp" descreve quem está chegando e o que o robô fez com
 * isso. São perguntas diferentes, feitas por gente em momentos diferentes -
 * misturar as duas numa rolagem só foi o erro da primeira versão.
 */
const ABAS = [
  { chave: 'clinica' as const, rotulo: 'Base clínica', icone: Stethoscope },
  { chave: 'whatsapp' as const, rotulo: 'WhatsApp', icone: MessageCircle },
]
type Aba = (typeof ABAS)[number]['chave']

function Kpi({
  label,
  value,
  detail,
  icon: Icon,
  color,
}: {
  label: string
  value: string | number
  detail: string
  icon: typeof UsersRound
  color: string
}) {
  return (
    <article className={`${cardClass} group relative overflow-hidden p-4 sm:p-5`}>
      <div
        className="absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-[0.08] blur-xl transition-transform duration-500 group-hover:scale-125"
        style={{ background: color }}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">{label}</p>
          <p className="mt-2 text-3xl font-extrabold tracking-[-0.05em] text-[#081b2c]">{value}</p>
          <p className="mt-1 text-[11px] font-medium text-slate-400">{detail}</p>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px]" style={{ background: `${color}16`, color }}>
          <Icon className="h-[19px] w-[19px]" strokeWidth={2} />
        </span>
      </div>
    </article>
  )
}

function Panel({
  title,
  subtitle,
  icon: Icon,
  children,
  className = '',
}: {
  title: string
  subtitle?: string
  icon?: typeof UsersRound
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`${cardClass} p-5 sm:p-6 ${className}`}>
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-extrabold tracking-[-0.02em] text-[#081b2c]">{title}</h2>
          {subtitle && <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{subtitle}</p>}
        </div>
        {Icon && (
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e9f1f9] text-[#1f4f78]">
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      {children}
    </section>
  )
}

function DataBar({
  label,
  value,
  max,
  color = AZUL,
}: {
  label: string
  value: number
  max: number
  color?: string
}) {
  const width = max > 0 ? Math.max((value / max) * 100, value > 0 ? 6 : 0) : 0
  // Nome em cima, barra embaixo. Ate 09/09/2026 os tres ficavam na mesma linha,
  // com o rotulo espremido em 112px: "Livance Ibirapuera - Vila Clementino"
  // virava "Livance Ibirapuera - ..." e o nome de um CID nao caberia nunca.
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-semibold leading-snug text-slate-500">{label}</span>
        <span className="shrink-0 text-[11px] font-extrabold text-[#081b2c]">{value}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#eef1f2]">
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: `${width}%`, background: `linear-gradient(90deg, ${color}, ${color}b8)` }}
        />
      </div>
    </div>
  )
}

function topN(pairs: [string, number][], n: number): [string, number][] {
  return pairs.sort((a, b) => b[1] - a[1]).slice(0, n)
}

function countBy(patients: Patient[], pick: (patient: Patient) => string): [string, number][] {
  const map = new Map<string, number>()
  for (const patient of patients) {
    const key = pick(patient).trim()
    if (!key) continue
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return [...map.entries()]
}

function Donut({ female, male, other }: { female: number; male: number; other: number }) {
  const total = female + male + other
  const femaleEnd = total ? (female / total) * 100 : 0
  const maleEnd = total ? femaleEnd + (male / total) * 100 : 0
  const background = total
    ? `conic-gradient(${AZUL} 0 ${femaleEnd}%, ${NAVY} ${femaleEnd}% ${maleEnd}%, #a5b1bb ${maleEnd}% 100%)`
    : '#edf0f2'

  const items = [
    { label: 'Feminino', value: female, color: AZUL },
    { label: 'Masculino', value: male, color: NAVY },
    { label: 'Outro / NI', value: other, color: '#a5b1bb' },
  ]

  return (
    <div className="flex flex-col items-center gap-6 py-1 sm:flex-row sm:justify-center lg:justify-start">
      <div className="relative h-36 w-36 shrink-0 rounded-full p-[13px]" style={{ background }}>
        <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-white shadow-[inset_0_0_0_1px_rgba(8,27,44,.04)]">
          <span className="text-3xl font-extrabold tracking-[-0.05em] text-[#081b2c]">{total}</span>
          <span className="mt-0.5 text-[9px] font-extrabold uppercase tracking-[0.16em] text-slate-400">pacientes</span>
        </div>
      </div>
      <div className="w-full max-w-[200px] space-y-3">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
            <span className="flex-1 text-[11px] font-semibold text-slate-500">{item.label}</span>
            <span className="text-xs font-extrabold text-[#081b2c]">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Ranking({
  title,
  items,
  color,
  maiusculo = false,
}: {
  title: string
  items: [string, number][]
  color: string
  /**
   * Nome do CID, cidade, bairro e convênio vêm digitados de mil jeitos
   * ("santos", "Santos", "SANTOS"). Em caixa alta as três viram a mesma coisa
   * aos olhos de quem lê o painel, e a coluna para de parecer bagunçada.
   * Só a aparência muda: o que está gravado continua como foi escrito.
   */
  maiusculo?: boolean
}) {
  const max = Math.max(...items.map((item) => item[1]), 1)
  return (
    <div>
      <p className="mb-3 text-[10px] font-extrabold uppercase tracking-[0.15em] text-slate-400">{title}</p>
      {items.length ? (
        <div className={`space-y-3 ${maiusculo ? 'uppercase' : ''}`}>
          {items.map(([label, value]) => (
            <DataBar key={label} label={label} value={value} max={max} color={color} />
          ))}
        </div>
      ) : (
        <p className="rounded-xl bg-[#f8f7f4] px-3 py-4 text-center text-[11px] text-slate-400">Sem dados suficientes</p>
      )}
    </div>
  )
}

/**
 * Aviso de solicitacoes do WhatsApp esperando confirmacao.
 *
 * Fica no topo da Visao geral e nao entre os indicadores: nao e um numero para
 * acompanhar, e uma tarefa com prazo. A vaga fica reservada por 24h e depois
 * volta para a fila - se ninguem confirmar, o paciente perde o horario.
 */
function AvisoSolicitacoes({
  solicitacoes,
  onAbrirAgenda,
}: {
  solicitacoes: PendingRequest[]
  onAbrirAgenda?: () => void
}) {
  // Reavaliado a cada minuto: "vence em menos de 6 horas" nao pode envelhecer
  // com a tela aberta.
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setAgora(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  if (solicitacoes.length === 0) return null

  const vencendo = solicitacoes.filter((item) => {
    if (!item.holdExpiresAt) return false
    const restante = new Date(item.holdExpiresAt).getTime() - agora
    return restante > 0 && restante < 6 * 3600 * 1000
  }).length

  const proxima = solicitacoes[0]
  const quando = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(proxima.startsAt))

  return (
    <section className="rounded-[24px] border-2 border-[#16456b] bg-[#16456b] p-5 text-white sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-white/15">
            <Clock3 className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-white/60">
              Aguardando a equipe
            </p>
            <h2 className="mt-1 text-lg font-extrabold tracking-[-0.02em]">
              {solicitacoes.length === 1
                ? '1 pessoa pediu horário pelo WhatsApp'
                : `${solicitacoes.length} pessoas pediram horário pelo WhatsApp`}
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-white/70">
              {solicitacoes.length === 1
                ? `${proxima.contactName || proxima.contactPhone} - ${quando}, ${proxima.unitName}.`
                : `A mais próxima é ${quando}, em ${proxima.unitName}.`}{' '}
              A vaga fica reservada por 24 horas.
              {vencendo > 0 &&
                ` ${vencendo === 1 ? 'Uma reserva vence' : `${vencendo} reservas vencem`} em menos de 6 horas.`}
            </p>
          </div>
        </div>
        {onAbrirAgenda && (
          <button
            type="button"
            onClick={onAbrirAgenda}
            className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-[11px] font-extrabold text-[#16456b] transition hover:bg-white/90"
          >
            Ver na agenda
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </section>
  )
}

export default function Dashboard({
  patients,
  solicitacoes = [],
  onAbrirAgenda,
}: {
  patients: Patient[]
  solicitacoes?: PendingRequest[]
  onAbrirAgenda?: () => void
}) {
  // Abre na base clínica: é o que a Visão geral sempre foi, e quem entra aqui
  // de manhã está olhando os pacientes do dia, não a fatura da Meta.
  const [aba, setAba] = useState<Aba>('clinica')

  const currentMonth = new Date().toISOString().slice(0, 7)
  const appointmentsThisMonth = patients.filter((patient) => patient.dataConsulta.startsWith(currentMonth)).length
  const due = dueCount(patients)
  const completed = patients
    .flatMap((patient) => [patient.followups.d15, patient.followups.d30, patient.followups.m90])
    .filter((followup) => followup.status === 'concluido').length
  const totalJourneys = patients.length * 2
  const completion = totalJourneys ? Math.round((completed / totalJourneys) * 100) : 0

  const female = patients.filter((patient) => patient.sexo === 'F').length
  const male = patients.filter((patient) => patient.sexo === 'M').length
  const other = patients.filter((patient) => patient.sexo === 'O').length

  const ageRanges = [
    { label: '0 a 2 anos', test: (age: number) => age <= 2 },
    { label: '3 a 5 anos', test: (age: number) => age >= 3 && age <= 5 },
    { label: '6 a 9 anos', test: (age: number) => age >= 6 && age <= 9 },
    { label: '10 a 13 anos', test: (age: number) => age >= 10 && age <= 13 },
    { label: '14+ anos', test: (age: number) => age >= 14 },
  ].map((range) => ({
    label: range.label,
    value: patients.filter((patient) => range.test(idadeAnos(patient.nascimento))).length,
  }))
  const maxAge = Math.max(...ageRanges.map((range) => range.value), 1)

  // Agrupado pelo nome, e nao pelo codigo: assim "K59.0" e "K59,0" - a virgula
  // do teclado numerico - contam como a mesma coisa, que e o que sao.
  const cids = topN(countBy(patients, (patient) => nomeDoCid(patient.cid)), 5)
  const cities = topN(countBy(patients, (patient) => patient.cidade), 5)
  // Bairro e unidade ja chegavam aqui dentro de cada paciente; so nunca tinham
  // sido lidos. Nao precisou de nada no banco.
  const neighborhoods = topN(countBy(patients, (patient) => patient.bairro), 5)
  const units = topN(countBy(patients, (patient) => patient.unidade), 5)
  // Normaliza antes de contar, senão o mesmo plano vira duas barras por causa
  // de quem digitou com outra caixa.
  const healthPlans = topN(
    countBy(patients, (patient) => patient.convenio.trim().toUpperCase()),
    5,
  )

  const months: { label: string; value: number }[] = []
  const now = new Date()
  for (let offset = 5; offset >= 0; offset--) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const label = date.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
    months.push({ label, value: patients.filter((patient) => patient.dataConsulta.startsWith(key)).length })
  }
  const maxMonth = Math.max(...months.map((month) => month.value), 1)
  const pending = pendingFollowups(patients)
  // Ja enviados nao contam: nao ha o que fazer por eles nesta semana.
  const nextWeek = pending.filter((item) => item.dias >= -7 && item.urgencia !== 'aguardando').length

  return (
    <div className="space-y-5">
      <AvisoSolicitacoes solicitacoes={solicitacoes} onAbrirAgenda={onAbrirAgenda} />

      {/* Duas leituras que não se misturam (21/09/2026).
          Na primeira versão os números do WhatsApp entraram empilhados no meio
          dos gráficos da base clínica, e virou uma rolagem só: "23 pacientes"
          logo acima de "24 contatos", dois 'vinte e poucos' que não têm relação
          nenhuma - um é quem já é paciente, o outro é quem está chegando.
          Separar em abas resolve sem esconder nada: cada aba responde uma
          pergunta, e quem está olhando sabe qual. */}
      <div className="flex items-center gap-1 rounded-2xl bg-slate-100 p-1">
        {ABAS.map((item) => (
          <button
            key={item.chave}
            type="button"
            onClick={() => setAba(item.chave)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[11px] font-extrabold transition ${
              aba === item.chave
                ? 'bg-white text-[#081b2c] shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <item.icone className="h-4 w-4" />
            {item.rotulo}
          </button>
        ))}
      </div>

      {aba === 'whatsapp' ? (
        <NumerosDoWhatsApp />
      ) : (
        <>
      <section className="soft-grid relative overflow-hidden rounded-[28px] bg-[#081b2c] p-5 text-white shadow-[0_20px_45px_rgba(8,27,44,.16)] sm:p-7">
        <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-[#2f7fc1]/20 blur-3xl" />
        <div className="absolute bottom-0 right-[28%] h-28 w-28 rounded-full bg-[#6f9d91]/15 blur-2xl" />
        <div className="relative grid gap-7 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-[#8dbde4]">
              <HeartPulse className="h-3.5 w-3.5" />
              Radar de acompanhamento
            </div>
            <h2 className="max-w-xl text-balance text-2xl font-extrabold leading-tight tracking-[-0.04em] sm:text-[30px]">
              Cuidado que continua depois da consulta.
            </h2>
            <p className="mt-3 max-w-xl text-xs leading-relaxed text-white/55 sm:text-sm">
              Sua base clínica transforma datas em contatos oportunos e mantém cada família próxima da equipe.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[20px] border border-white/10 bg-white/[0.07] p-4 backdrop-blur">
              <p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-white/40">Esta semana</p>
              <p className="mt-2 text-3xl font-extrabold tracking-[-0.05em]">{nextWeek}</p>
              <p className="mt-1 text-[10px] text-white/45">contatos no radar</p>
            </div>
            <div className="rounded-[20px] bg-[#2f7fc1] p-4 text-white">
              <p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-white/60">Jornadas concluídas</p>
              <p className="mt-2 text-3xl font-extrabold tracking-[-0.05em]">{completion}%</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/25">
                <div className="h-full rounded-full bg-white" style={{ width: `${completion}%` }} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Pacientes" value={patients.length} detail="na base clínica" icon={UsersRound} color={NAVY} />
        <Kpi label="Consultas no mês" value={appointmentsThisMonth} detail="atendimentos registrados" icon={CalendarCheck2} color={AZUL} />
        <Kpi label="Pendentes" value={due} detail="hoje e atrasados" icon={Clock3} color="#d45b58" />
        <Kpi label="Concluídos" value={completed} detail="15, 30 e 90 dias" icon={CheckCircle2} color={SAGE} />
      </div>

      {patients.length === 0 ? (
        <Panel title="Sua visão clínica começa aqui" subtitle="Cadastre o primeiro atendimento para alimentar os indicadores." icon={Stethoscope}>
          <div className="rounded-[20px] border border-dashed border-[#081b2c]/15 bg-[#faf9f6] p-8 text-center">
            <Activity className="mx-auto h-8 w-8 text-[#2f7fc1]" />
            <p className="mx-auto mt-3 max-w-md text-xs leading-relaxed text-slate-500">
              Os gráficos de perfil, localização, CID e volume de consultas serão atualizados automaticamente.
            </p>
          </div>
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Panel title="Perfil dos pacientes" subtitle="Distribuição por sexo informado" icon={UsersRound}>
              <Donut female={female} male={male} other={other} />
            </Panel>

            <Panel title="Faixa etária" subtitle="Idade atual dos pacientes cadastrados" icon={Activity}>
              <div className="space-y-4 pt-1">
                {ageRanges.map((range) => (
                  <DataBar key={range.label} label={range.label} value={range.value} max={maxAge} color={SAGE} />
                ))}
              </div>
            </Panel>
          </div>

          <Panel title="Ritmo de atendimentos" subtitle="Consultas registradas nos últimos seis meses" icon={CalendarCheck2}>
            <div className="flex h-52 items-end gap-2 pt-5 sm:gap-5">
              {months.map((month) => {
                const height = Math.max((month.value / maxMonth) * 100, 4)
                return (
                  <div key={month.label} className="group flex h-full flex-1 flex-col items-center justify-end gap-2.5">
                    <span className="text-[10px] font-extrabold text-[#081b2c]">{month.value || '-'}</span>
                    <div className="relative flex h-[calc(100%-42px)] w-full max-w-16 items-end overflow-hidden rounded-[12px] bg-[#f1f2f1]">
                      <div
                        className="w-full rounded-[12px] bg-gradient-to-t from-[#22557f] to-[#86bce4] transition-all duration-700 group-hover:brightness-105"
                        style={{ height: `${height}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-bold uppercase text-slate-400">{month.label}</span>
                  </div>
                )
              })}
            </div>
          </Panel>

          {/* Dois paineis em vez de um: cinco recortes espremidos em tres
              colunas viram sopa. Geografia de um lado, clinica do outro - e a
              divisao ajuda a ler, nao so a caber. */}
          <Panel
            title="De onde vem quem atendemos"
            subtitle="Para decidir horário, unidade e alcance da divulgação"
            icon={MapPinned}
          >
            <div className="grid grid-cols-1 gap-7 lg:grid-cols-3 lg:divide-x lg:divide-[#081b2c]/[0.07]">
              {/* "do paciente" no rotulo de proposito: sem isso, cidade e
                  bairro se confundem com o endereco da unidade. */}
              <Ranking title="Cidade do paciente" items={cities} color={SAGE} maiusculo />
              <div className="lg:pl-7">
                <Ranking title="Bairro / região do paciente" items={neighborhoods} color={AZUL} maiusculo />
              </div>
              <div className="lg:pl-7">
                <Ranking title="Unidade de atendimento" items={units} color={NAVY} maiusculo />
              </div>
            </div>
            <div className="mt-6 flex items-center gap-2 border-t border-[#081b2c]/[0.06] pt-4 text-[10px] font-semibold text-slate-400">
              <Building2 className="h-3.5 w-3.5 text-[#6f9d91]" />
              A unidade é a do último atendimento de cada paciente.
            </div>
          </Panel>

          <Panel title="Leitura da base clínica" subtitle="Principais recortes para apoiar decisões da rotina" icon={Stethoscope}>
            <div className="grid grid-cols-1 gap-7 lg:grid-cols-2 lg:divide-x lg:divide-[#081b2c]/[0.07]">
              <Ranking title="CID-10 mais frequentes" items={cids} color={AZUL} maiusculo />
              <div className="lg:pl-7">
                {/* Maiúsculo como o CID: o convênio é digitado à mão em cada
                    cadastro, e vinha "TRASMONTANO" de um e "Trasmontano" de
                    outro - duas linhas no gráfico para o mesmo plano. */}
                <Ranking title="Convênios" items={healthPlans} color={NAVY} maiusculo />
              </div>
            </div>
            <div className="mt-6 flex items-center gap-2 border-t border-[#081b2c]/[0.06] pt-4 text-[10px] font-semibold text-slate-400">
              <ArrowUpRight className="h-3.5 w-3.5 text-[#2f7fc1]" />
              Os indicadores refletem os campos preenchidos no cadastro de cada atendimento.
            </div>
          </Panel>
        </>
      )}
        </>
      )}
    </div>
  )
}
