import { useState, type ReactNode } from 'react'
import { CalendarOff, CalendarPlus, Clock, Info, MapPin, Plus, RefreshCw, RotateCcw, Settings2, Trash2, Video } from 'lucide-react'
import { DIAS_DA_SEMANA, diaDeBrasilia, type AgendaDaClinica, type UnidadeDaAgenda } from './agenda'

/**
 * A aba "Agenda" do simulador: os mesmos blocos da Configuracao da Agenda do
 * sistema (horarios de atendimento, datas bloqueadas, preferencias), mais as
 * unidades e os horarios extras por data, que o banco ja aceitava
 * (schedule_exceptions com is_closed falso) e que numa reuniao respondem a
 * pergunta "e se eu atender num sabado so?".
 *
 * Tudo que muda aqui vai direto para o robo da conversa aberta.
 */

const LETRA_DO_DIA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const MAX_DIAS_DO_ROBO = 8

// O valor digitado em reais, guardado em centavos como no banco. Vazio ou
// zero = sem valor, e o robo da demonstracao se comporta como o de verdade
// (a linha com {valor} cai e o evento aparece).
const emCentavos = (digitado: string) => {
  const reais = Number(digitado)
  return Number.isFinite(reais) && reais > 0 ? Math.round(reais * 100) : null
}

const novoId = (prefixo: string) => `${prefixo}-${crypto.randomUUID().slice(0, 8)}`

const campo =
  'rounded-xl border border-[#1d1d1b]/10 bg-white px-2.5 py-1.5 text-[12.5px] text-[#1d1d1b] outline-none focus:border-[#4f7a63]'
const botaoEscuro =
  'inline-flex items-center gap-1 rounded-xl bg-[#1d1d1b] px-3 py-1.5 text-[12px] font-bold text-white transition hover:bg-[#333333] disabled:opacity-40'

function dataLegivel(dia: string) {
  return new Date(`${dia}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' })
}

function Bloco({ icone, titulo, ajuda, children }: { icone: ReactNode; titulo: string; ajuda?: string; children: ReactNode }) {
  return (
    <section className="rounded-[18px] border border-slate-200/80 bg-white p-4">
      <p className="flex items-center gap-1.5 text-[13px] font-extrabold text-[#1d1d1b]">
        <span className="text-[#4f7a63]">{icone}</span>
        {titulo}
      </p>
      {ajuda && <p className="mt-1 text-[11.5px] leading-snug text-slate-500">{ajuda}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Linha({ children, onRemover }: { children: ReactNode; onRemover: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-[#fafaf8] px-3 py-2">
      <span className="min-w-0 truncate text-[12.5px] font-bold text-[#1d1d1b]">{children}</span>
      <button type="button" onClick={onRemover} aria-label="Remover" className="rounded-lg p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export default function ConfiguracaoDaAgenda({
  agenda,
  onMudar,
  onRestaurar,
  previa,
  alterada,
  explicacao = 'O que muda aqui vale na hora: peça para marcar no celular ao lado e o robô já oferece. Fica salvo neste navegador.',
  rotuloRestaurar = 'Restaurar a agenda padrão',
  onRecarregar,
}: {
  agenda: AgendaDaClinica
  onMudar: (nova: AgendaDaClinica) => void
  onRestaurar: () => void
  /** Os horarios livres que o robo ofereceria agora, para a unidade. */
  previa: (unidadeId: string) => { slot_start: string }[]
  /** A agenda difere da padrao da identidade (ou do que veio do sistema). */
  alterada: boolean
  /** De onde vem esta agenda; na demo, a conta de teste do sistema. */
  explicacao?: string
  rotuloRestaurar?: string
  /** So na demo: ler a conta de teste de novo. */
  onRecarregar?: () => void
}) {
  const [hoje] = useState(() => diaDeBrasilia(new Date()))
  const [selecionada, setSelecionada] = useState<string>(agenda.unidades[0]?.id ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [novoPeriodo, setNovoPeriodo] = useState({ dias: [] as number[], inicio: '08:00', fim: '12:00' })
  const [novaData, setNovaData] = useState({ data: '', inicio: '09:00', fim: '12:00' })
  const [novoBloqueio, setNovoBloqueio] = useState({ data: '', motivo: '', todas: false })
  const [novaUnidade, setNovaUnidade] = useState<null | { nome: string; endereco: string; telemedicina: boolean }>(null)
  const [confirmarRemocao, setConfirmarRemocao] = useState(false)

  const unidade = agenda.unidades.find((u) => u.id === selecionada) ?? agenda.unidades[0]
  const temTele = agenda.unidades.some((u) => u.telemedicina)
  const fisicas = agenda.unidades.filter((u) => !u.telemedicina)

  const mudar = (nova: AgendaDaClinica) => {
    setErro(null)
    onMudar(nova)
  }
  const mudarUnidade = (id: string, mudanca: Partial<UnidadeDaAgenda>) =>
    mudar({ ...agenda, unidades: agenda.unidades.map((u) => (u.id === id ? { ...u, ...mudanca } : u)) })

  function criarUnidade() {
    if (!novaUnidade) return
    const nome = novaUnidade.nome.trim()
    if (!nome) return setErro('Dê um nome para a unidade.')
    if (agenda.unidades.some((u) => u.nome.trim().toLowerCase() === nome.toLowerCase())) {
      return setErro('Já existe uma unidade com esse nome.')
    }
    const nova: UnidadeDaAgenda = {
      id: novoId('unidade'),
      nome,
      endereco: novaUnidade.telemedicina ? '' : novaUnidade.endereco.trim(),
      informacoes: '',
      convenio: '',
      telemedicina: novaUnidade.telemedicina,
      periodos: [],
    }
    mudar({ ...agenda, unidades: [...agenda.unidades, nova] })
    setSelecionada(nova.id)
    setNovaUnidade(null)
  }

  function removerUnidade(id: string) {
    mudar({
      ...agenda,
      unidades: agenda.unidades.filter((u) => u.id !== id),
      datasExtras: agenda.datasExtras.filter((e) => e.unidadeId !== id),
      bloqueios: agenda.bloqueios.filter((b) => b.unidadeId !== id),
    })
    setSelecionada(agenda.unidades.find((u) => u.id !== id)?.id ?? '')
    setConfirmarRemocao(false)
  }

  function adicionarPeriodos() {
    if (!unidade) return
    if (novoPeriodo.dias.length === 0) return setErro('Escolha pelo menos um dia da semana.')
    if (novoPeriodo.fim <= novoPeriodo.inicio) return setErro('O fim do período precisa ser depois do início.')
    const novos = novoPeriodo.dias.map((weekday) => ({ id: novoId('periodo'), weekday, inicio: novoPeriodo.inicio, fim: novoPeriodo.fim }))
    mudarUnidade(unidade.id, { periodos: [...unidade.periodos, ...novos] })
    setNovoPeriodo({ ...novoPeriodo, dias: [] })
  }

  function adicionarData() {
    if (!unidade) return
    if (!novaData.data) return setErro('Escolha a data.')
    if (novaData.fim <= novaData.inicio) return setErro('O fim do horário precisa ser depois do início.')
    mudar({
      ...agenda,
      datasExtras: [...agenda.datasExtras, { id: novoId('extra'), data: novaData.data, inicio: novaData.inicio, fim: novaData.fim, unidadeId: unidade.id }],
    })
    setNovaData({ ...novaData, data: '' })
  }

  function bloquear() {
    if (!unidade) return
    if (!novoBloqueio.data) return setErro('Escolha a data a bloquear.')
    mudar({
      ...agenda,
      bloqueios: [
        ...agenda.bloqueios,
        { id: novoId('bloqueio'), data: novoBloqueio.data, motivo: novoBloqueio.motivo.trim(), unidadeId: novoBloqueio.todas ? null : unidade.id },
      ],
    })
    setNovoBloqueio({ data: '', motivo: '', todas: false })
  }

  function mudarPreferencia(chave: keyof AgendaDaClinica['preferencias'], valor: number, min: number, max: number) {
    if (!Number.isFinite(valor)) return
    mudar({ ...agenda, preferencias: { ...agenda.preferencias, [chave]: Math.min(max, Math.max(min, Math.round(valor))) } })
  }

  // O que o robo listaria na pergunta "qual dia?": ate oito dias, com quantos horarios.
  const livres = unidade ? previa(unidade.id) : []
  const porDia = new Map<string, string[]>()
  for (const h of livres) {
    const dia = diaDeBrasilia(new Date(h.slot_start))
    const hora = new Date(h.slot_start).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
    porDia.set(dia, [...(porDia.get(dia) ?? []), hora])
  }
  const diasOferecidos = [...porDia.entries()].slice(0, MAX_DIAS_DO_ROBO)

  // As desta unidade e as que valem para todas, em ordem de data.
  const daUnidade = <T extends { unidadeId: string | null; data: string }>(lista: T[]) =>
    lista.filter((x) => x.unidadeId === null || x.unidadeId === unidade?.id).sort((a, b) => a.data.localeCompare(b.data))

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[#f7f5f1] p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-[#eef5fd] px-4 py-2.5 text-[12.5px] text-[#3d5e4d]">
        <Info className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1">{explicacao}</span>
        {onRecarregar && (
          <button type="button" onClick={onRecarregar} className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[12px] font-bold text-[#3d5e4d] hover:bg-white/70">
            <RefreshCw className="h-3.5 w-3.5" /> Recarregar do sistema
          </button>
        )}
        {alterada && (
          <button type="button" onClick={onRestaurar} className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-[12px] font-bold text-[#3d5e4d] hover:bg-white/70">
            <RotateCcw className="h-3.5 w-3.5" /> {rotuloRestaurar}
          </button>
        )}
      </div>
      {erro && <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-[12.5px] font-semibold text-red-700">{erro}</p>}

      <div className="grid gap-3 xl:grid-cols-[250px_1fr]">
        {/* Unidades e preferencias */}
        <div className="space-y-3">
          <Bloco icone={<MapPin className="h-4 w-4" />} titulo="Unidades">
            <div className="space-y-1.5">
              {agenda.unidades.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    setSelecionada(u.id)
                    setConfirmarRemocao(false)
                  }}
                  className={`block w-full rounded-xl border px-3 py-2 text-left transition ${
                    u.id === unidade?.id ? 'border-[#4f7a63] bg-[#eef5fd]' : 'border-transparent bg-[#fafaf8] hover:border-slate-200'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-[13px] font-bold text-[#1d1d1b]">
                    {u.telemedicina && <Video className="h-3.5 w-3.5 text-[#4f7a63]" />}
                    {u.nome}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    {u.periodos.length === 0 ? 'sem horários' : `${u.periodos.length} ${u.periodos.length === 1 ? 'período' : 'períodos'} por semana`}
                  </span>
                </button>
              ))}
            </div>
            {novaUnidade ? (
              <div className="mt-3 space-y-2 border-t border-[#1d1d1b]/[0.07] pt-3">
                <input autoFocus value={novaUnidade.nome} onChange={(e) => setNovaUnidade({ ...novaUnidade, nome: e.target.value })} placeholder="Nome (ex.: Vila Mariana)" className={`${campo} w-full`} />
                {!novaUnidade.telemedicina && (
                  <input value={novaUnidade.endereco} onChange={(e) => setNovaUnidade({ ...novaUnidade, endereco: e.target.value })} placeholder="Endereço" className={`${campo} w-full`} />
                )}
                <label className={`flex items-center gap-2 text-[12px] ${temTele ? 'text-slate-300' : 'text-slate-600'}`}>
                  <input type="checkbox" disabled={temTele} checked={novaUnidade.telemedicina} onChange={(e) => setNovaUnidade({ ...novaUnidade, telemedicina: e.target.checked })} />
                  Agenda própria de telemedicina
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={criarUnidade} className={botaoEscuro}>
                    <Plus className="h-3.5 w-3.5" /> Criar
                  </button>
                  <button type="button" onClick={() => setNovaUnidade(null)} className="rounded-xl px-3 py-1.5 text-[12px] font-bold text-slate-500 hover:bg-slate-100">
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setNovaUnidade({ nome: '', endereco: '', telemedicina: false })} className={`${botaoEscuro} mt-3`}>
                <Plus className="h-3.5 w-3.5" /> Nova unidade
              </button>
            )}
          </Bloco>

          <Bloco icone={<Settings2 className="h-4 w-4" />} titulo="Preferências da agenda">
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ['duracao', 'Duração (min)', 5, 240],
                  ['janela', 'Janela (dias)', 1, 180],
                  ['antecedencia', 'Antecedência (h)', 0, 168],
                ] as const
              ).map(([chave, rotulo, min, max]) => (
                <label key={chave} className="block">
                  <span className="block text-[9.5px] font-extrabold uppercase tracking-wide text-slate-400">{rotulo}</span>
                  <input
                    type="number"
                    min={min}
                    max={max}
                    value={agenda.preferencias[chave]}
                    onChange={(e) => mudarPreferencia(chave, Number(e.target.value), min, max)}
                    className={`${campo} mt-1 w-full`}
                  />
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-[12.5px] font-semibold text-[#1d1d1b]">
                <input type="checkbox" checked={agenda.telemedicinaAtiva} onChange={(e) => mudar({ ...agenda, telemedicinaAtiva: e.target.checked })} />
                O robô oferece telemedicina
              </label>
              <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500">
                Valor (R$)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={agenda.telemedicinaValor ? agenda.telemedicinaValor / 100 : ''}
                  onChange={(e) => mudar({ ...agenda, telemedicinaValor: emCentavos(e.target.value) })}
                  className={`${campo} w-24`}
                />
              </label>
            </div>
          </Bloco>
        </div>

        {/* A unidade escolhida */}
        {unidade ? (
          <div className="space-y-3">
            <Bloco icone={unidade.telemedicina ? <Video className="h-4 w-4" /> : <MapPin className="h-4 w-4" />} titulo={unidade.telemedicina ? 'Agenda de telemedicina' : 'Unidade'}>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="block text-[9.5px] font-extrabold uppercase tracking-wide text-slate-400">Nome</span>
                  <input value={unidade.nome} onChange={(e) => mudarUnidade(unidade.id, { nome: e.target.value })} className={`${campo} mt-1 w-full`} />
                </label>
                {!unidade.telemedicina && (
                  <label className="block">
                    <span className="block text-[9.5px] font-extrabold uppercase tracking-wide text-slate-400">Convênios aceitos (separe por vírgula; vazio = só particular)</span>
                    <input value={unidade.convenio} onChange={(e) => mudarUnidade(unidade.id, { convenio: e.target.value })} placeholder="Particular" className={`${campo} mt-1 w-full`} />
                  </label>
                )}
                {!unidade.telemedicina && (
                  <label className="block">
                    <span className="block text-[9.5px] font-extrabold uppercase tracking-wide text-slate-400">Endereço</span>
                    <input value={unidade.endereco} onChange={(e) => mudarUnidade(unidade.id, { endereco: e.target.value })} className={`${campo} mt-1 w-full`} />
                  </label>
                )}
                {!unidade.telemedicina && (
                  <label className="block">
                    <span className="block text-[9.5px] font-extrabold uppercase tracking-wide text-slate-400">Valor da consulta (R$)</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={unidade.valor ? unidade.valor / 100 : ''}
                      onChange={(e) => mudarUnidade(unidade.id, { valor: emCentavos(e.target.value) })}
                      className={`${campo} mt-1 w-full`}
                    />
                  </label>
                )}
                {!unidade.telemedicina && (
                  <label className="block sm:col-span-2">
                    <span className="block text-[9.5px] font-extrabold uppercase tracking-wide text-slate-400">
                      O que o robô responde sobre esta unidade (valor, como chegar, o que levar)
                    </span>
                    <textarea
                      rows={3}
                      value={unidade.informacoes}
                      onChange={(e) => mudarUnidade(unidade.id, { informacoes: e.target.value })}
                      placeholder="Vazio: o robô manda só o texto geral, sem nada desta unidade (como no sistema)."
                      className={`${campo} mt-1 w-full resize-y leading-snug`}
                    />
                    <span className="mt-1 block text-[11px] text-slate-500">
                      {'{valor}'} e {'{endereco}'} viram o valor e o endereço acima na hora de enviar, como no sistema.
                    </span>
                  </label>
                )}
              </div>
              {unidade.telemedicina && (
                <p className="text-[11.5px] text-slate-500">
                  Sem horários aqui, o robô oferece por vídeo os horários livres das unidades físicas. Com horários, só estes valem.
                </p>
              )}
              <div className="mt-3 flex justify-end">
                {fisicas.length <= 1 && !unidade.telemedicina ? (
                  <span className="text-[11px] text-slate-400">É a única unidade física: crie outra antes de remover esta.</span>
                ) : confirmarRemocao ? (
                  <button type="button" onClick={() => removerUnidade(unidade.id)} className="rounded-xl bg-red-600 px-3 py-1.5 text-[12px] font-bold text-white">
                    Confirmar: remover {unidade.nome}
                  </button>
                ) : (
                  <button type="button" onClick={() => setConfirmarRemocao(true)} className="inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-[12px] font-bold text-red-600 hover:bg-red-50">
                    <Trash2 className="h-3.5 w-3.5" /> Remover unidade
                  </button>
                )}
              </div>
            </Bloco>

            <div className="grid gap-3 2xl:grid-cols-2">
              <Bloco icone={<Clock className="h-4 w-4" />} titulo="Horários de atendimento" ajuda="Toda semana. Pode haver mais de um período no mesmo dia, por exemplo manhã e tarde.">
                <div className="space-y-1.5">
                  {unidade.periodos.length === 0 && <p className="text-[12px] text-slate-400">Nenhum período ainda: o robô não oferece esta unidade com horários.</p>}
                  {[...unidade.periodos]
                    .sort((a, b) => a.weekday - b.weekday || a.inicio.localeCompare(b.inicio))
                    .map((p) => (
                      <Linha key={p.id} onRemover={() => mudarUnidade(unidade.id, { periodos: unidade.periodos.filter((x) => x.id !== p.id) })}>
                        {DIAS_DA_SEMANA[p.weekday]} · {p.inicio} às {p.fim}
                      </Linha>
                    ))}
                </div>
                <div className="mt-3 space-y-2 border-t border-[#1d1d1b]/[0.07] pt-3">
                  <div className="flex gap-1">
                    {LETRA_DO_DIA.map((letra, dia) => {
                      const ligado = novoPeriodo.dias.includes(dia)
                      return (
                        <button
                          key={dia}
                          type="button"
                          title={DIAS_DA_SEMANA[dia]}
                          onClick={() => setNovoPeriodo({ ...novoPeriodo, dias: ligado ? novoPeriodo.dias.filter((d) => d !== dia) : [...novoPeriodo.dias, dia] })}
                          className={`h-8 w-8 rounded-full text-[12px] font-extrabold transition ${ligado ? 'bg-[#1d1d1b] text-white' : 'bg-[#fafaf8] text-slate-500 hover:bg-slate-100'}`}
                        >
                          {letra}
                        </button>
                      )
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input type="time" value={novoPeriodo.inicio} onChange={(e) => setNovoPeriodo({ ...novoPeriodo, inicio: e.target.value })} className={campo} />
                    <span className="text-[12px] text-slate-400">às</span>
                    <input type="time" value={novoPeriodo.fim} onChange={(e) => setNovoPeriodo({ ...novoPeriodo, fim: e.target.value })} className={campo} />
                    <button type="button" onClick={adicionarPeriodos} className={botaoEscuro}>
                      <Plus className="h-3.5 w-3.5" /> Adicionar
                    </button>
                  </div>
                </div>
              </Bloco>

              <div className="space-y-3">
                <Bloco icone={<CalendarPlus className="h-4 w-4" />} titulo="Datas extras de atendimento" ajuda="Um dia avulso fora da semana normal, como um sábado de mutirão.">
                  <div className="space-y-1.5">
                    {daUnidade(agenda.datasExtras).map((e) => (
                      <Linha key={e.id} onRemover={() => mudar({ ...agenda, datasExtras: agenda.datasExtras.filter((x) => x.id !== e.id) })}>
                        {dataLegivel(e.data)} · {e.inicio} às {e.fim}
                      </Linha>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="date" min={hoje} value={novaData.data} onChange={(e) => setNovaData({ ...novaData, data: e.target.value })} className={campo} />
                    <input type="time" value={novaData.inicio} onChange={(e) => setNovaData({ ...novaData, inicio: e.target.value })} className={campo} />
                    <input type="time" value={novaData.fim} onChange={(e) => setNovaData({ ...novaData, fim: e.target.value })} className={campo} />
                    <button type="button" onClick={adicionarData} className={botaoEscuro}>
                      <Plus className="h-3.5 w-3.5" /> Adicionar
                    </button>
                  </div>
                </Bloco>

                <Bloco icone={<CalendarOff className="h-4 w-4" />} titulo="Datas bloqueadas" ajuda="Feriado, férias, congresso: o dia some da agenda e deixa de ser oferecido.">
                  <div className="space-y-1.5">
                    {daUnidade(agenda.bloqueios).map((b) => (
                      <Linha key={b.id} onRemover={() => mudar({ ...agenda, bloqueios: agenda.bloqueios.filter((x) => x.id !== b.id) })}>
                        {dataLegivel(b.data)}
                        {b.motivo && <span className="font-normal text-slate-500"> · {b.motivo}</span>}
                        {b.unidadeId === null && <span className="font-normal text-slate-400"> · todas as unidades</span>}
                      </Linha>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="date" min={hoje} value={novoBloqueio.data} onChange={(e) => setNovoBloqueio({ ...novoBloqueio, data: e.target.value })} className={campo} />
                    <input value={novoBloqueio.motivo} onChange={(e) => setNovoBloqueio({ ...novoBloqueio, motivo: e.target.value })} placeholder="Motivo" className={`${campo} min-w-[110px] flex-1`} />
                    <label className="flex items-center gap-1.5 text-[12px] text-slate-600">
                      <input type="checkbox" checked={novoBloqueio.todas} onChange={(e) => setNovoBloqueio({ ...novoBloqueio, todas: e.target.checked })} />
                      todas as unidades
                    </label>
                    <button type="button" onClick={bloquear} className={botaoEscuro}>
                      <Plus className="h-3.5 w-3.5" /> Bloquear
                    </button>
                  </div>
                </Bloco>
              </div>
            </div>

            <Bloco
              icone={<CalendarPlus className="h-4 w-4" />}
              titulo={`O que o robô oferece para ${unidade.nome}`}
              ajuda={`Os dias que aparecem quando o paciente escolhe esta unidade (até ${MAX_DIAS_DO_ROBO} por vez), já sem os horários marcados.`}
            >
              {diasOferecidos.length === 0 ? (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-700">
                  Nenhum horário livre nos próximos {agenda.preferencias.janela} dias. O paciente que escolher esta unidade vai ouvir que não há datas.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {diasOferecidos.map(([dia, horas]) => (
                    <div key={dia} className="rounded-xl bg-[#fafaf8] px-3 py-2" title={horas.join(' · ')}>
                      <p className="text-[12.5px] font-bold capitalize text-[#1d1d1b]">{dataLegivel(dia)}</p>
                      {/* Os inicios dos horarios, e nao o periodo: "09:00 as 10:20" se lia
                          como "atende ate 10:20" num periodo que vai ate 11:00. */}
                      <p className="text-[11px] text-slate-500">
                        {horas.length <= 4
                          ? horas.join(' · ')
                          : `${horas.length} horários, o primeiro ${horas[0]} e o último ${horas[horas.length - 1]}`}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[11px] text-slate-400">
                {livres.length} horários livres na janela de {agenda.preferencias.janela} dias.
              </p>
            </Bloco>
          </div>
        ) : (
          <p className="text-[13px] text-slate-500">Crie uma unidade para começar.</p>
        )}
      </div>
    </div>
  )
}
