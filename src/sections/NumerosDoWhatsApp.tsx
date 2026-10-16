import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  CalendarCheck2,
  HelpCircle,
  MessageCircle,
  MoonStar,
  UserRound,
} from 'lucide-react'
import { getCurrentMembership, numerosDoWhatsApp, type NumerosDoWhatsApp as Numeros } from '@/lib/repository'
import { publicoDaClinica } from '@/lib/publico'

const NAVY = '#081b2c'
const AZUL = '#2f7fc1'
const SAGE = '#6f9d91'
const VERMELHO = '#d45b58'

/**
 * A data em que o registro de eventos comecou a existir.
 *
 * Contato, conversao e quem respondeu valem para tras - esses dados sempre
 * foram gravados. Opcao escolhida, desistencia e "nao entendi" so existem a
 * partir da migration 20260921120000.
 *
 * Isto esta aqui, e aparece na tela, por um motivo especifico: sem o aviso,
 * quem olhar agosto le "nenhuma opcao escolhida" e conclui que o robo estava
 * quebrado. Numero ausente parecendo numero zero e a forma mais facil de um
 * painel mentir.
 */
const EVENTOS_DESDE = new Date(2026, 8, 21)

const NOME_DA_OPCAO: Record<string, string> = {
  '1': 'Informações da clínica',
  '2': 'Agendar consulta',
  '3': 'Falar com a equipe',
  '4': 'Minha consulta marcada',
  '5': '2ª via de receita ou exame',
}

const NOME_DO_MOTIVO: Record<string, string> = {
  atendente: 'Pediu para falar com a equipe',
  anexo: 'Mandou foto ou documento',
  ajuda: 'Pediu ajuda no acompanhamento',
  // Desde 22/09/2026 o pedido de nota fiscal tambem entra como 'documento'.
  documento: '2ª via, exame ou nota fiscal',
  farmacia: 'Correção pedida pela farmácia',
  falha: 'O robô não conseguiu concluir',
  cancelou_sozinho: 'Cancelou a consulta',
  'sem motivo': 'Sem motivo registrado',
}

type Periodo = { rotulo: string; dias: number }
const PERIODOS: Periodo[] = [
  { rotulo: '7 dias', dias: 7 },
  { rotulo: '30 dias', dias: 30 },
  { rotulo: '90 dias', dias: 90 },
]

function porcento(parte: number, total: number): string {
  if (total <= 0) return '—'
  return `${Math.round((parte / total) * 100)}%`
}

function Numero({
  rotulo,
  valor,
  detalhe,
  icone: Icone,
  cor,
}: {
  rotulo: string
  valor: string | number
  detalhe: string
  icone: typeof MessageCircle
  cor: string
}) {
  return (
    <div className="surface-card rounded-[20px] p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-400">{rotulo}</p>
        <Icone className="h-4 w-4 shrink-0" style={{ color: cor }} />
      </div>
      <p className="mt-2 text-3xl font-extrabold tracking-[-0.05em]" style={{ color: NAVY }}>
        {valor}
      </p>
      <p className="mt-1 text-[10px] leading-snug text-slate-500">{detalhe}</p>
    </div>
  )
}

function Barra({ rotulo, valor, max, cor }: { rotulo: string; valor: number; max: number; cor: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[11px]">
        <span className="font-bold text-[#081b2c]">{rotulo}</span>
        <span className="font-extrabold tabular-nums text-slate-500">{valor}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.max((valor / Math.max(max, 1)) * 100, valor > 0 ? 4 : 0)}%`, background: cor }}
        />
      </div>
    </div>
  )
}

function Bloco({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string
  subtitulo: string
  children: React.ReactNode
}) {
  return (
    <div className="surface-card rounded-[24px] p-5">
      <p className="text-sm font-extrabold tracking-[-0.02em] text-[#081b2c]">{titulo}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{subtitulo}</p>
      <div className="mt-4 space-y-3">{children}</div>
    </div>
  )
}

export default function NumerosDoWhatsApp() {
  // Quem responde ao lembrete: o paciente no otorrino, a familia na pediatria
  // (15/10/2026, ver publico.ts).
  const geral = publicoDaClinica() === 'geral'
  const [dias, setDias] = useState(30)
  const [dados, setDados] = useState<Numeros | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')

  const inicio = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - dias)
    return d
  }, [dias])

  useEffect(() => {
    let vivo = true
    setCarregando(true)
    setErro('')
    void (async () => {
      try {
        const membership = await getCurrentMembership()
        if (!membership) throw new Error('Não identifiquei a clínica do seu usuário.')
        const fim = new Date()
        const numeros = await numerosDoWhatsApp(membership.clinicId, inicio, fim)
        if (vivo) setDados(numeros)
      } catch (causa) {
        if (vivo) setErro(causa instanceof Error ? causa.message : 'Não consegui carregar os números.')
      } finally {
        if (vivo) setCarregando(false)
      }
    })()
    return () => {
      vivo = false
    }
  }, [inicio])

  const opcoes = useMemo(() => {
    if (!dados) return []
    return Object.entries(NOME_DA_OPCAO)
      .map(([numero, nome]) => ({ nome, valor: dados.opcoesEscolhidas[numero] ?? 0 }))
      .sort((a, b) => b.valor - a.valor)
  }, [dados])

  const motivos = useMemo(() => {
    if (!dados) return []
    return Object.entries(dados.chamouEquipePorMotivo)
      .map(([chave, valor]) => ({ nome: NOME_DO_MOTIVO[chave] ?? chave, valor }))
      .sort((a, b) => b.valor - a.valor)
  }, [dados])

  // O periodo escolhido alcanca dias anteriores ao registro de eventos?
  const periodoAntesDoRegistro = inicio < EVENTOS_DESDE

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-extrabold tracking-[-0.02em] text-[#081b2c]">Números do WhatsApp</p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            O que o atendimento automático fez, e o que sobrou para a equipe.
          </p>
        </div>
        <div className="flex items-center gap-1">
          {PERIODOS.map((periodo) => (
            <button
              key={periodo.dias}
              type="button"
              onClick={() => setDias(periodo.dias)}
              className={`rounded-xl px-3 py-1.5 text-[10px] font-extrabold transition ${
                dias === periodo.dias
                  ? 'bg-[#081b2c] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {periodo.rotulo}
            </button>
          ))}
        </div>
      </div>

      {erro && (
        <div className="flex items-start gap-2 rounded-[16px] border border-red-200 bg-red-50 p-3 text-[11px] font-semibold text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}

      {carregando && !dados ? (
        <div className="surface-card rounded-[24px] p-10 text-center text-xs text-slate-500">
          Contando...
        </div>
      ) : dados ? (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Numero
              rotulo="Contatos"
              valor={dados.contatos}
              detalhe="conversas que começaram no período"
              icone={MessageCircle}
              cor={NAVY}
            />
            <Numero
              rotulo="Resolvidas pelo robô"
              valor={porcento(dados.contidas, dados.contatos)}
              detalhe={`${dados.contidas} sem ninguém da equipe digitar`}
              icone={Bot}
              cor={SAGE}
            />
            <Numero
              rotulo="Consultas marcadas"
              valor={dados.consultasPeloWhatsApp}
              detalhe={`${porcento(dados.consultasPeloWhatsApp, dados.contatos)} dos contatos viraram consulta`}
              icone={CalendarCheck2}
              cor={AZUL}
            />
            <Numero
              rotulo="Fora do horário"
              valor={dados.contatosForaDoHorario}
              detalhe="noite e fim de semana, quando não há recepção"
              icone={MoonStar}
              cor="#7a6ea8"
            />
          </div>

          {periodoAntesDoRegistro && (
            <div className="flex items-start gap-2 rounded-[16px] border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                O registro do que acontece dentro da conversa começou em{' '}
                <strong>21/09/2026</strong>. Os blocos abaixo contam só de lá para cá — número
                baixo aqui pode ser período sem registro, e não robô parado. Contatos, consultas
                marcadas e quem respondeu, acima, valem para trás.
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Bloco
              titulo="O que as pessoas mais pedem"
              subtitulo="Opção escolhida no menu automático"
            >
              {opcoes.every((o) => o.valor === 0) ? (
                <p className="text-[11px] text-slate-500">Nenhuma escolha registrada neste período.</p>
              ) : (
                opcoes.map((opcao) => (
                  <Barra
                    key={opcao.nome}
                    rotulo={opcao.nome}
                    valor={opcao.valor}
                    max={opcoes[0]?.valor ?? 1}
                    cor={AZUL}
                  />
                ))
              )}
            </Bloco>

            <Bloco
              titulo="Por que a equipe foi chamada"
              subtitulo="O que o robô não resolve sozinho, por escolha nossa ou por limite dele"
            >
              {motivos.length === 0 ? (
                <p className="text-[11px] text-slate-500">Nenhum chamado registrado neste período.</p>
              ) : (
                motivos.map((motivo) => (
                  <Barra
                    key={motivo.nome}
                    rotulo={motivo.nome}
                    valor={motivo.valor}
                    max={motivos[0]?.valor ?? 1}
                    cor={SAGE}
                  />
                ))
              )}
            </Bloco>
          </div>

          {/* Respostas ao lembrete da vespera (22/09/2026). O lembrete existe
              para produzir estas tres respostas, e ate aqui elas nao eram
              contadas em lugar nenhum. */}
          <Bloco
            titulo="Respostas ao lembrete da véspera"
            subtitulo={`O que ${geral ? 'os pacientes' : 'as famílias'} fizeram com o lembrete, pelo botão ou por escrito`}
          >
            {(() => {
              const respostas = [
                { nome: 'Confirmaram presença', valor: dados.eventos.lembrete_confirmou ?? 0, cor: SAGE },
                { nome: 'Pediram para remarcar', valor: dados.eventos.lembrete_remarcar ?? 0, cor: AZUL },
                { nome: 'Cancelaram', valor: dados.eventos.lembrete_cancelou ?? 0, cor: VERMELHO },
              ]
              const maior = Math.max(...respostas.map((r) => r.valor), 1)
              return respostas.every((r) => r.valor === 0) ? (
                <p className="text-[11px] text-slate-500">Nenhuma resposta a lembrete registrada neste período.</p>
              ) : (
                respostas.map((r) => (
                  <Barra key={r.nome} rotulo={r.nome} valor={r.valor} max={maior} cor={r.cor} />
                ))
              )
            })()}
          </Bloco>

          {/* Campo sem dado (14/10/2026): um texto do robo usa {valor} ou
              {endereco} e o cartao da unidade esta vazio. O robo tira a linha
              em vez de mandar "{valor}" cru - e a familia fica sem o preco. Sem
              este aviso, isso so apareceria quando alguem reclamasse. */}
          {(dados.eventos.campo_sem_valor ?? 0) > 0 && (
            <div className="flex items-start gap-2 rounded-[16px] border border-red-200 bg-red-50 p-3 text-[11px] leading-relaxed text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>
                  O robô deixou de mandar um valor ou endereço {dados.eventos.campo_sem_valor}{' '}
                  {dados.eventos.campo_sem_valor === 1 ? 'vez' : 'vezes'} neste período.
                </strong>{' '}
                Um texto usa {'{valor}'} ou {'{endereco}'} e o cartão da unidade está sem esse dado. Confira em
                Agenda → Configuração → Unidades.
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Numero
              rotulo="Não entendi"
              valor={dados.eventos.nao_entendi ?? 0}
              detalhe="quando sobe, falta uma opção no menu"
              icone={HelpCircle}
              cor={VERMELHO}
            />
            <Numero
              rotulo="Saíram no meio"
              valor={dados.desistiram}
              detalhe="viram o menu e não concluíram nada"
              icone={UserRound}
              cor="#b08968"
            />
            <Numero
              rotulo="Mensagens recebidas"
              valor={dados.mensagensRecebidas}
              detalhe={`${dados.enviadasRobo} do robô · ${dados.enviadasEquipe} da equipe`}
              icone={MessageCircle}
              cor={NAVY}
            />
            <Numero
              rotulo="Faltas de quem marcou pelo robô"
              valor={
                dados.compareceuWhatsApp + dados.faltasWhatsApp > 0
                  ? porcento(dados.faltasWhatsApp, dados.compareceuWhatsApp + dados.faltasWhatsApp)
                  : '—'
              }
              detalhe={
                dados.compareceuRecepcao + dados.faltasRecepcao > 0
                  ? `recepção: ${porcento(dados.faltasRecepcao, dados.compareceuRecepcao + dados.faltasRecepcao)}`
                  : 'sem comparação ainda'
              }
              icone={CalendarCheck2}
              cor={VERMELHO}
            />
          </div>

          <p className="text-[10px] leading-relaxed text-slate-400">
            Lembretes enviados no período: {dados.enviadasLembrete} · acompanhamentos:{' '}
            {dados.enviadasAcompanhamento} · pediram para não receber mais:{' '}
            {dados.pediramParaNaoReceber}. Os três contam como mensagem de modelo na fatura da
            Meta.
          </p>
        </>
      ) : null}
    </section>
  )
}
