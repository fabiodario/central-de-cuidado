import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Loader2, PenLine, Smartphone, X } from 'lucide-react'
import {
  concluirAssinatura,
  iniciarAssinatura,
  type AtendimentoSemAssinatura,
} from '@/lib/repository'

/**
 * Assinar todos os atendimentos pendentes de uma vez (06/10/2026).
 *
 * Pedido do Dr. Marcello ("estou esquecendo de assinar"). A assinatura e a de
 * sempre - um atendimento por vez, cada um com o seu PDF assinado e arquivado
 * pela funcao assinar-consulta. O que muda e que a tela vai passando por todos
 * sozinha:
 *
 *  - o primeiro pede a aprovacao no VIDaaS (se o turno ainda nao foi aprovado);
 *    a tela pergunta a cada 5 segundos ate o celular aprovar;
 *  - aprovado, a sessao vale 4 horas, e os outros assinam direto, sem celular.
 *
 * Um que falha nao para os outros: ele fica marcado com o erro, e a lista do
 * que falta continua no aviso para tentar de novo.
 */

type Situacao = 'fila' | 'assinando' | 'ok' | 'erro'

type Item = AtendimentoSemAssinatura & { situacao: Situacao; erro?: string }

const ESPERA_DO_CELULAR_MS = 15 * 60 * 1000

function dataCurta(iso: string) {
  const [ano, mes, dia] = iso.split('-')
  return ano && mes && dia ? `${dia}/${mes}` : iso
}

function pausa(ms: number) {
  return new Promise((resolver) => window.setTimeout(resolver, ms))
}

export function AssinaturaEmLote({
  pendentes,
  onFechar,
}: {
  pendentes: AtendimentoSemAssinatura[]
  /** `assinou`: quantos foram assinados, para quem chamou recarregar a lista. */
  onFechar: (assinou: number) => void
}) {
  const [itens, setItens] = useState<Item[]>(() => pendentes.map((p) => ({ ...p, situacao: 'fila' })))
  const [rodando, setRodando] = useState(false)
  const [celular, setCelular] = useState<{ link: string } | null>(null)
  const [aviso, setAviso] = useState('')
  const vivo = useRef(true)
  useEffect(() => {
    vivo.current = true
    return () => {
      vivo.current = false
    }
  }, [])

  const assinados = itens.filter((i) => i.situacao === 'ok').length
  const comErro = itens.filter((i) => i.situacao === 'erro').length
  const terminou = !rodando && itens.every((i) => i.situacao === 'ok' || i.situacao === 'erro')

  function marcar(id: string, situacao: Situacao, erro?: string) {
    setItens((lista) => lista.map((i) => (i.id === id ? { ...i, situacao, erro } : i)))
  }

  /** Espera o celular aprovar e conclui. Devolve true quando assinou. */
  async function esperarCelular(pedido: string) {
    const limite = Date.now() + ESPERA_DO_CELULAR_MS
    await pausa(4000)
    while (vivo.current && Date.now() < limite) {
      const resultado = await concluirAssinatura(pedido)
      if (resultado.situacao === 'assinado') return true
      await pausa(5000)
    }
    return false
  }

  async function assinarTodos() {
    setRodando(true)
    setAviso('')
    // A aba do VIDaaS precisa nascer DENTRO do clique, senao o bloqueador de
    // pop-up a mata em silencio (mesma regra de pedirAssinatura no prontuario).
    // Se o turno ja estiver aprovado, ela fecha sem ser usada.
    let aba: Window | null = window.open('', '_blank')
    const fila = itens.filter((i) => i.situacao !== 'ok')

    for (const item of fila) {
      if (!vivo.current) break
      marcar(item.id, 'assinando')
      try {
        const volta = new URL(window.location.href)
        volta.searchParams.set('paciente', item.patientId)
        const inicio = await iniciarAssinatura(item.id, volta.toString())

        if (inicio.recuperado) {
          marcar(item.id, 'ok')
          continue
        }

        if (inicio.sessaoAtiva) {
          const resultado = await concluirAssinatura(inicio.pedido)
          if (resultado.situacao === 'assinado') marcar(item.id, 'ok')
          else if (await esperarCelular(inicio.pedido)) marcar(item.id, 'ok')
          else marcar(item.id, 'erro', 'A sessão de assinatura não respondeu.')
          continue
        }

        // Turno ainda nao aprovado: a primeira assinatura passa pelo celular.
        // Se a aba ja foi usada (sessao venceu no meio da fila), abre o link
        // pelo painel, e a pessoa toca nele.
        if (aba && !aba.closed) aba.location.href = inicio.autorizarEm
        aba = null
        setCelular({ link: inicio.autorizarEm })
        const ok = await esperarCelular(inicio.pedido)
        setCelular(null)
        if (ok) marcar(item.id, 'ok')
        else {
          marcar(item.id, 'erro', 'O celular não aprovou a tempo.')
          setAviso('A aprovação no celular não chegou. Toque em "Tentar de novo" para continuar de onde parou.')
          break
        }
      } catch (causa) {
        marcar(item.id, 'erro', causa instanceof Error ? causa.message : 'Não foi possível assinar.')
      }
    }

    if (aba && !aba.closed) aba.close()
    if (vivo.current) setRodando(false)
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[#081b2c]/40 p-4">
      <div className="flex max-h-[min(640px,90dvh)] w-full max-w-[460px] flex-col overflow-hidden rounded-[22px] bg-white shadow-[0_24px_60px_rgba(8,27,44,.22)]">
        <div className="flex items-start justify-between gap-3 border-b border-[#081b2c]/[0.07] p-5">
          <div>
            <p className="flex items-center gap-2 text-sm font-extrabold text-[#081b2c]">
              <PenLine className="h-4 w-4 text-[#2f7fc1]" />
              Assinar atendimentos
            </p>
            <p className="mt-1 text-[11px] font-semibold leading-relaxed text-slate-500">
              {terminou
                ? `${assinados} assinado${assinados === 1 ? '' : 's'}${comErro ? `, ${comErro} com erro` : ''}.`
                : `${itens.length} atendimento${itens.length === 1 ? '' : 's'} sem assinatura digital. Uma aprovação no celular vale para todos.`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onFechar(assinados)}
            disabled={rodando}
            aria-label="Fechar"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 disabled:opacity-30"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {celular && (
          <div className="flex items-start gap-2.5 border-b border-[#2f7fc1]/15 bg-[#eef5fd] px-5 py-3 text-[11px] font-bold leading-relaxed text-[#16456b]">
            <Smartphone className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Aprove no VIDaaS, no celular. Depois disso os outros assinam sozinhos.{' '}
              <a href={celular.link} target="_blank" rel="noreferrer" className="underline">
                Abrir a autorização
              </a>
            </span>
          </div>
        )}

        <ul className="flex-1 divide-y divide-[#081b2c]/[0.06] overflow-y-auto px-2">
          {itens.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                {item.situacao === 'ok' && <Check className="h-4 w-4 text-[#1c6b3a]" />}
                {item.situacao === 'assinando' && <Loader2 className="h-4 w-4 animate-spin text-[#2f7fc1]" />}
                {item.situacao === 'erro' && <X className="h-4 w-4 text-red-600" />}
                {item.situacao === 'fila' && <span className="h-2 w-2 rounded-full bg-slate-300" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold text-[#081b2c]">{item.paciente}</span>
                {item.erro && <span className="block text-[10px] font-semibold text-red-600">{item.erro}</span>}
              </span>
              <span className="shrink-0 text-[10px] font-bold text-slate-400">{dataCurta(item.data)}</span>
            </li>
          ))}
        </ul>

        {aviso && <p className="border-t border-[#081b2c]/[0.07] px-5 py-3 text-[11px] font-bold text-[#9a3a08]">{aviso}</p>}

        <div className="border-t border-[#081b2c]/[0.07] p-4">
          {terminou && comErro === 0 ? (
            <button
              type="button"
              onClick={() => onFechar(assinados)}
              className="w-full rounded-xl bg-[#081b2c] px-4 py-2.5 text-[11px] font-extrabold text-white transition hover:bg-[#102d47]"
            >
              Pronto
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void assinarTodos()}
              disabled={rodando}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#081b2c] px-4 py-2.5 text-[11px] font-extrabold text-white transition hover:bg-[#102d47] disabled:opacity-60"
            >
              {rodando ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Assinando {Math.min(assinados + 1, itens.length)} de {itens.length}…
                </>
              ) : comErro > 0 ? (
                'Tentar de novo'
              ) : (
                `Assinar ${itens.length === 1 ? 'o atendimento' : `os ${itens.length}`}`
              )}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
