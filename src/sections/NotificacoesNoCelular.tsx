import { useCallback, useEffect, useState } from 'react'
import { BellRing, BellOff, RefreshCw, Send, Share, SquarePlus } from 'lucide-react'
import {
  ativarNotificacoes,
  desativarNotificacoes,
  estadoDesteAparelho,
  ehIPhone,
  situacaoDoAparelho,
  testarNotificacao,
  type EstadoNoServidor,
  type SituacaoDoAparelho,
} from '@/lib/notificacoes'

/**
 * Cartao "Avisos neste celular" em Preferencias (28/09/2026).
 *
 * Cada pessoa ativa no PROPRIO aparelho - a inscricao e do celular, nao da
 * conta. Por isso o cartao fala de "este celular" e mostra o ultimo envio e o
 * ultimo erro dele: notificacao tem muitos jeitos de nao chegar sem erro
 * nenhum, e a etiqueta vermelha aqui e o que faz o defeito aparecer.
 */

function quando(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function NotificacoesNoCelular({ clinicId }: { clinicId: string | null }) {
  const [situacao, setSituacao] = useState<SituacaoDoAparelho>(() => situacaoDoAparelho())
  const [estado, setEstado] = useState<EstadoNoServidor | null>(null)
  const [ocupado, setOcupado] = useState<'' | 'ativar' | 'testar' | 'desativar'>('')
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const recarregar = useCallback(async () => {
    setSituacao(situacaoDoAparelho())
    if (!clinicId) return
    try {
      setEstado(await estadoDesteAparelho(clinicId))
    } catch (causa) {
      setEstado({ ativo: false, ultimoEnvio: null, ultimoErro: null })
      setAviso({ tipo: 'erro', texto: causa instanceof Error ? causa.message : 'Não consegui consultar este aparelho.' })
    }
  }, [clinicId])

  useEffect(() => {
    void recarregar()
  }, [recarregar])

  async function executar(acao: 'ativar' | 'testar' | 'desativar') {
    if (!clinicId) return
    setAviso(null)
    setOcupado(acao)
    try {
      if (acao === 'ativar') {
        await ativarNotificacoes(clinicId)
        setAviso({ tipo: 'ok', texto: 'Ativado. Toque em “Enviar teste” para conferir.' })
      } else if (acao === 'testar') {
        const r = await testarNotificacao(clinicId)
        setAviso(
          r.falhas.length
            ? { tipo: 'erro', texto: `O envio falhou: ${r.falhas[0]}` }
            : r.enviados
              ? { tipo: 'ok', texto: 'Teste enviado. Deve aparecer em alguns segundos.' }
              : { tipo: 'erro', texto: 'Este aparelho deixou de estar inscrito. Ative de novo.' },
        )
      } else {
        await desativarNotificacoes(clinicId)
        setAviso({ tipo: 'ok', texto: 'Desativado neste celular.' })
      }
    } catch (causa) {
      setAviso({ tipo: 'erro', texto: causa instanceof Error ? causa.message : 'Não foi possível concluir.' })
    } finally {
      setOcupado('')
      await recarregar()
    }
  }

  const ativo = Boolean(estado?.ativo)

  return (
    <section className="surface-card overflow-hidden rounded-[26px]">
      <div className="border-b border-[#081b2c]/[0.06] bg-gradient-to-r from-white to-[#f0f6fc] p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] bg-[#dceaf7] text-[#1f4f78]">
            <BellRing className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#1f4f78]">Notificações</p>
            <h2 className="mt-1 text-base font-extrabold text-[#081b2c]">Avisos neste celular</h2>
            <p className="mt-1 text-xs leading-relaxed text-[#50677b]">
              Quando uma família pedir para falar com a equipe, marcar urgência ou pedir 2ª via de receita ou exame,
              este aparelho avisa como uma mensagem de WhatsApp. Tocar no aviso abre a conversa.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3 p-5 sm:p-6">
        {situacao === 'iphone-instalar' && (
          <div className="rounded-2xl border border-[#2f7fc1]/20 bg-[#f3f8fd] p-4 text-xs leading-relaxed text-[#1c3b57]">
            <p className="font-extrabold">No iPhone, os avisos só funcionam com a Central na tela de início:</p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-4">
              <li>
                Abra esta página no <strong>Safari</strong>.
              </li>
              <li>
                Toque em <Share className="inline h-3.5 w-3.5 align-[-2px]" /> <strong>Compartilhar</strong>.
              </li>
              <li>
                Escolha <SquarePlus className="inline h-3.5 w-3.5 align-[-2px]" />{' '}
                <strong>Adicionar à Tela de Início</strong>.
              </li>
              <li>
                Abra a Central pelo <strong>ícone novo</strong>, entre em Preferências e ative aqui.
              </li>
            </ol>
            <p className="mt-2 text-[11px] text-[#50677b]">Precisa do iOS 16.4 ou mais novo.</p>
          </div>
        )}

        {situacao === 'sem-suporte' && (
          <p className="rounded-2xl bg-[#f7f4ee] p-4 text-xs leading-relaxed text-[#6b5a3a]">
            Este navegador não recebe notificações. No Android, abra a Central no <strong>Chrome</strong>; no iPhone,
            pelo ícone na tela de início.
          </p>
        )}

        {situacao === 'bloqueado' && (
          <p className="rounded-2xl bg-red-50 p-4 text-xs leading-relaxed text-red-700">
            As notificações foram <strong>bloqueadas</strong> para a Central neste aparelho.{' '}
            {ehIPhone()
              ? 'Libere em Ajustes → Notificações → Central.'
              : 'No Chrome, toque no cadeado ao lado do endereço → Permissões → Notificações → Permitir.'}{' '}
            Depois volte aqui e ative.
          </p>
        )}

        {situacao === 'pronto' && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-3 py-1 text-[10px] font-extrabold ${
                  ativo ? 'bg-[#e3f4e9] text-[#1c6b3a]' : 'bg-[#eef2f6] text-[#50677b]'
                }`}
              >
                {estado === null ? 'Consultando…' : ativo ? '● Ativo neste celular' : 'Desligado neste celular'}
              </span>
              {ativo && estado?.ultimoEnvio && (
                <span className="text-[10px] font-bold text-[#50677b]">Último aviso: {quando(estado.ultimoEnvio)}</span>
              )}
            </div>

            {ativo && estado?.ultimoErro && (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-[10px] font-bold leading-relaxed text-red-700">
                O último aviso para este celular falhou: {estado.ultimoErro}
              </p>
            )}

            {!ativo ? (
              <button
                type="button"
                onClick={() => void executar('ativar')}
                disabled={!clinicId || ocupado !== ''}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#081b2c] px-4 py-3 text-xs font-extrabold text-white transition hover:bg-[#102d47] disabled:cursor-wait disabled:opacity-70"
              >
                {ocupado === 'ativar' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
                {ocupado === 'ativar' ? 'Ativando…' : 'Ativar neste celular'}
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void executar('testar')}
                  disabled={ocupado !== ''}
                  className="flex items-center justify-center gap-2 rounded-xl bg-[#2f7fc1] px-3 py-2.5 text-[11px] font-extrabold text-white transition hover:bg-[#25649c] disabled:opacity-60"
                >
                  {ocupado === 'testar' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Enviar teste
                </button>
                <button
                  type="button"
                  onClick={() => void executar('desativar')}
                  disabled={ocupado !== ''}
                  className="flex items-center justify-center gap-2 rounded-xl border border-[#081b2c]/12 bg-white px-3 py-2.5 text-[11px] font-extrabold text-[#081b2c] transition hover:bg-[#f3f6f9] disabled:opacity-60"
                >
                  {ocupado === 'desativar' ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <BellOff className="h-3.5 w-3.5" />}
                  Desativar
                </button>
              </div>
            )}
          </>
        )}

        {aviso && (
          <p className={`text-[11px] font-bold leading-relaxed ${aviso.tipo === 'ok' ? 'text-[#1c6b3a]' : 'text-red-600'}`}>
            {aviso.texto}
          </p>
        )}
      </div>
    </section>
  )
}
