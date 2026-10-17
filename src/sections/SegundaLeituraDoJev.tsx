import { useEffect, useState } from 'react'
import { Radar, RefreshCw } from 'lucide-react'
import { Ajuda } from '@/components/Ajuda'
import { useDialogos } from '@/components/dialogos-contexto'
import {
  getCurrentMembership,
  getModoDoJev,
  getUltimaLeituraDoJev,
  saveModoDoJev,
  type ModoDoJev,
  type UltimaLeituraDoJev,
} from '@/lib/repository'
import { descreverLeituraDoJev } from '../../supabase/functions/_shared/segunda-leitura.ts'

const OPCOES: { modo: ModoDoJev; rotulo: string; explica: string }[] = [
  { modo: 'desligada', rotulo: 'Desligado', explica: 'O robô não chama o Jev.' },
  {
    modo: 'sombra',
    rotulo: 'Só observar',
    explica: 'O Jev lê e a nota fica registrada, sem mudar nada para o paciente.',
  },
  {
    modo: 'ligada',
    rotulo: 'Ligado',
    explica: 'O Jev lê e age: manda a pergunta Urgência ou Dúvida e, com nota alta, avisa a equipe.',
  },
]

const COR_DO_TOM = { ok: 'text-slate-500', alerta: 'text-[#9a5a1c]', erro: 'text-red-600' } as const

function quandoFoi(iso: string) {
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return ''
  return data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * Liga e desliga a segunda leitura das mensagens pelo Jev, da TypeSafe AI
 * (17/10/2026, pedido do Edu). Antes so dava pelo painel do Supabase. O modo
 * mora em clinic_settings.jev_segunda_leitura e so o responsavel pela clinica
 * muda; a chave da TypeSafe fica nos segredos das Edge Functions, nunca aqui.
 * A ultima leitura aparece embaixo para quem ligou ver que o Jev esta lendo, e
 * a falha (sem chave, fora do ar) nao ficar escondida no banco.
 */
export default function SegundaLeituraDoJev() {
  const { perguntar } = useDialogos()
  const [clinicId, setClinicId] = useState<string | null>(null)
  const [responsavel, setResponsavel] = useState(false)
  const [modo, setModo] = useState<ModoDoJev | null>(null)
  const [ultima, setUltima] = useState<UltimaLeituraDoJev | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [atualizando, setAtualizando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const membership = await getCurrentMembership()
        if (!membership || !vivo) return
        setClinicId(membership.clinicId)
        setResponsavel(membership.role === 'owner')
        const [atual, leitura] = await Promise.all([
          getModoDoJev(membership.clinicId),
          getUltimaLeituraDoJev(membership.clinicId),
        ])
        if (!vivo) return
        setModo(atual)
        setUltima(leitura)
      } catch (causa) {
        if (vivo) setErro(causa instanceof Error ? causa.message : 'Não foi possível ler a opção do Jev.')
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  async function escolher(novo: ModoDoJev) {
    if (!clinicId || !responsavel || salvando || modo === null || novo === modo) return
    // Sair do desligado manda texto de paciente para fora do pais: a pessoa
    // confirma sabendo disso (politica de privacidade, secao 4).
    if (modo === 'desligada') {
      const certeza = await perguntar({
        titulo: novo === 'ligada' ? 'Ligar o Jev?' : 'Deixar o Jev só observando?',
        detalhe:
          'O texto das mensagens dos pacientes passa a ser lido também pela TypeSafe AI, nos Estados Unidos, sem o número de telefone. Isso está na política de privacidade.',
        confirmar: novo === 'ligada' ? 'Ligar' : 'Só observar',
      })
      if (!certeza) return
    }
    setSalvando(true)
    setErro('')
    try {
      await saveModoDoJev(clinicId, novo)
      setModo(novo)
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function atualizarLeitura() {
    if (!clinicId) return
    setAtualizando(true)
    setErro('')
    try {
      setUltima(await getUltimaLeituraDoJev(clinicId))
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Não foi possível ler a última leitura.')
    } finally {
      setAtualizando(false)
    }
  }

  const descricao = ultima ? descreverLeituraDoJev(ultima.detalhe) : null

  return (
    <section className="surface-card overflow-hidden rounded-[26px]">
      <div className="border-b border-[#081b2c]/[0.06] bg-gradient-to-r from-white to-[#f1f3fa] p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] bg-[#e6e9f6] text-[#4b5a92]">
            <Radar className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#4b5a92]">Robô do WhatsApp</p>
            <h2 className="mt-1 flex items-center gap-1.5 text-base font-extrabold tracking-[-0.03em] text-[#081b2c]">
              Segunda leitura pelo Jev
              <Ajuda texto="O Jev é um serviço da TypeSafe AI que dá uma nota de urgência para cada mensagem escrita. A chave dele fica nos segredos do Supabase (TYPESAFE_API_KEY): sem ela, a leitura falha e o aviso aparece aqui embaixo." />
            </h2>
            <p className="mt-1.5 max-w-2xl text-[11px] leading-relaxed text-slate-400">
              Lê as mensagens escritas pelos pacientes para reconhecer urgência que a regra do robô não entende. Ele só
              acrescenta cuidado: nunca muda a resposta do robô nem marca consulta.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-5 sm:p-6">
        <div role="radiogroup" aria-label="Segunda leitura pelo Jev" className="grid gap-2 sm:grid-cols-3">
          {OPCOES.map((opcao) => {
            const escolhida = modo === opcao.modo
            return (
              <button
                key={opcao.modo}
                type="button"
                role="radio"
                aria-checked={escolhida}
                onClick={() => void escolher(opcao.modo)}
                disabled={!responsavel || salvando || modo === null}
                className={`rounded-[16px] border px-4 py-3 text-left transition disabled:cursor-not-allowed ${
                  escolhida
                    ? 'border-[#081b2c] bg-[#081b2c] text-white shadow-[0_10px_22px_rgba(8,27,44,.15)]'
                    : 'border-[#081b2c]/10 bg-[#fafaf8] text-[#081b2c] hover:border-[#2f7fc1] disabled:hover:border-[#081b2c]/10'
                } ${!responsavel && !escolhida ? 'opacity-60' : ''}`}
              >
                <span className="block text-xs font-extrabold">{opcao.rotulo}</span>
                <span className={`mt-1 block text-[10px] leading-relaxed ${escolhida ? 'text-white/70' : 'text-slate-400'}`}>
                  {opcao.explica}
                </span>
              </button>
            )
          })}
        </div>

        {modo === null && !erro && <p className="text-[10px] font-semibold text-slate-400">Carregando...</p>}
        {!responsavel && modo !== null && (
          <p className="text-[10px] font-semibold text-slate-400">Só o responsável pela clínica muda esta opção.</p>
        )}
        {salvando && <p className="text-[10px] font-semibold text-slate-400">Salvando...</p>}

        {modo !== null && (modo !== 'desligada' || ultima) && (
          <div className="flex items-start justify-between gap-3 rounded-[16px] border border-[#081b2c]/[0.06] bg-[#f8f7f4] px-4 py-3">
            <p className="text-[10px] font-semibold leading-relaxed text-slate-500">
              <span className="font-extrabold text-[#081b2c]">Última leitura: </span>
              {ultima && descricao ? (
                <>
                  {quandoFoi(ultima.quando)}.{' '}
                  <span className={COR_DO_TOM[descricao.tom]}>{descricao.texto}</span>
                </>
              ) : (
                'ainda nenhuma. Ela aparece aqui depois da primeira mensagem escrita por um paciente.'
              )}
            </p>
            <button
              type="button"
              onClick={() => void atualizarLeitura()}
              disabled={atualizando}
              aria-label="Atualizar a última leitura"
              className="shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-white hover:text-[#081b2c] disabled:cursor-wait"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${atualizando ? 'animate-spin' : ''}`} />
            </button>
          </div>
        )}

        {erro && <p className="text-[10px] font-bold leading-relaxed text-red-600">{erro}</p>}
      </div>
    </section>
  )
}
