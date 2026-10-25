import { useEffect, useState } from 'react'
import { RefreshCw, Siren } from 'lucide-react'
import { Ajuda } from '@/components/Ajuda'
import {
  getCurrentMembership,
  getTelefonesDoAlerta,
  getUltimoAlerta,
  saveTelefonesDoAlerta,
  testarAlertaDeUrgencia,
  type UltimoAlerta,
} from '@/lib/repository'
import { numerosDoAlerta } from '../../supabase/functions/_shared/alerta-de-urgencia.ts'
import { ROTULO_DO_VEREDITO } from '../../supabase/functions/_shared/resposta-ao-alerta.ts'

function legivel(numero: string) {
  const local = numero.startsWith('55') ? numero.slice(2) : numero
  return `(${local.slice(0, 2)}) ${local.slice(2, -4)}-${local.slice(-4)}`
}

function quandoFoi(iso: string) {
  const data = new Date(iso)
  if (Number.isNaN(data.getTime())) return ''
  return data.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** As linhas que nao viraram numero, para a tela dizer qual ficou de fora. */
function linhasRecusadas(texto: string): string[] {
  return texto
    .split(/[\n,;]+/)
    .map((l) => l.trim())
    .filter((l) => l && numerosDoAlerta(l).length === 0)
}

/**
 * Os celulares que recebem o alerta de urgencia no WhatsApp (17/10/2026,
 * pedido do Edu). Quando uma conversa entra em urgencia ou sangramento, o robo
 * manda um modelo aprovado da Meta para cada numero, a qualquer hora, com os
 * botoes "E urgente", "Pode aguardar" e "Eu respondo". O primeiro numero e o do
 * medico, o unico que classifica. Ver supabase/functions/_shared/alerta-de-urgencia.ts.
 *
 * So o responsavel pela clinica muda a lista. O teste toca o celular do
 * medico, entao fica com quem atende (owner ou clinician). O ultimo alerta
 * aparece embaixo para a falha nao ficar escondida no banco.
 */
export default function AlertaDeUrgencia() {
  const [clinicId, setClinicId] = useState<string | null>(null)
  const [responsavel, setResponsavel] = useState(false)
  const [atende, setAtende] = useState(false)
  const [salvos, setSalvos] = useState<string[] | null>(null)
  const [texto, setTexto] = useState('')
  const [ultimo, setUltimo] = useState<UltimoAlerta | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [testando, setTestando] = useState(false)
  const [atualizando, setAtualizando] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const membership = await getCurrentMembership()
        if (!membership || !vivo) return
        setClinicId(membership.clinicId)
        setResponsavel(membership.role === 'owner')
        setAtende(membership.role === 'owner' || membership.role === 'clinician')
        const lista = await getTelefonesDoAlerta(membership.clinicId)
        if (!vivo) return
        setSalvos(lista)
        setTexto(lista.map(legivel).join('\n'))
        // O ultimo alerta e extra: sem a tabela, a lista continua editavel.
        setUltimo(await getUltimoAlerta(membership.clinicId).catch(() => null))
      } catch (causa) {
        if (vivo) setErro(causa instanceof Error ? causa.message : 'Não foi possível ler os números do alerta.')
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  const numeros = numerosDoAlerta(texto)
  const recusadas = linhasRecusadas(texto)
  const mudou = salvos !== null && numeros.join(',') !== salvos.join(',')

  async function salvar() {
    if (!clinicId || !responsavel || salvando) return
    setSalvando(true)
    setErro('')
    setAviso(null)
    try {
      await saveTelefonesDoAlerta(clinicId, numeros)
      setSalvos(numeros)
      setTexto(numeros.map(legivel).join('\n'))
      setAviso({ tipo: 'ok', texto: numeros.length ? 'Números salvos.' : 'Lista vazia salva: o alerta no WhatsApp deixa de sair.' })
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Não foi possível salvar.')
    } finally {
      setSalvando(false)
    }
  }

  async function testar() {
    if (!clinicId || !atende || testando) return
    setTestando(true)
    setErro('')
    setAviso(null)
    try {
      const r = await testarAlertaDeUrgencia(clinicId)
      setAviso({ tipo: r.falhou ? 'erro' : 'ok', texto: r.nota })
      setUltimo(await getUltimoAlerta(clinicId).catch(() => null))
    } catch (causa) {
      setAviso({ tipo: 'erro', texto: causa instanceof Error ? causa.message : 'Não foi possível mandar o alerta de teste.' })
    } finally {
      setTestando(false)
    }
  }

  async function atualizarUltimo() {
    if (!clinicId) return
    setAtualizando(true)
    try {
      setUltimo(await getUltimoAlerta(clinicId))
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Não foi possível ler o último alerta.')
    } finally {
      setAtualizando(false)
    }
  }

  return (
    <section className="surface-card overflow-hidden rounded-[26px]">
      <div className="border-b border-[#081b2c]/[0.06] bg-gradient-to-r from-white to-[#fbf1f0] p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] bg-[#fbe3e0] text-[#b42318]">
            <Siren className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#b42318]">Robô do WhatsApp</p>
            <h2 className="mt-1 flex items-center gap-1.5 text-base font-extrabold tracking-[-0.03em] text-[#081b2c]">
              Alerta de urgência no WhatsApp do médico
              <Ajuda texto="O alerta sai pelos modelos alerta_urgencia_botoes (com botões) e alerta_urgencia (sem botões), que precisam estar aprovados na Meta. Enquanto o com botões não for aprovado, sai o sem botões." />
            </h2>
            <p className="mt-1.5 max-w-2xl text-[11px] leading-relaxed text-slate-400">
              Quando uma conversa entra em urgência ou sangramento, estes números recebem um alerta no WhatsApp, a qualquer
              hora, com os botões É urgente, Pode aguardar e Eu respondo. A resposta volta ao paciente. A notificação no
              celular continua. Os mesmos números recebem a conversa quando alguém toca em Mandar para o celular, na
              tela de Conversas.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-400">Celulares, um por linha</span>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              readOnly={!responsavel}
              rows={4}
              placeholder={'(13) 99999-0000\n(13) 98888-0000'}
              aria-label="Celulares que recebem o alerta de urgência"
              className="mt-1.5 w-full rounded-[14px] border border-[#081b2c]/10 bg-[#fafaf8] px-3.5 py-2.5 text-[13px] text-[#081b2c] outline-none transition focus:border-[#2f7fc1] read-only:opacity-70"
            />
          </label>
          <div>
            <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-400">Quem recebe</span>
            {numeros.length === 0 ? (
              <p className="mt-1.5 text-[11px] font-semibold leading-relaxed text-[#9a5a1c]">
                Nenhum número: o alerta no WhatsApp não sai, e cada urgência fica com um aviso na conversa.
              </p>
            ) : (
              <ol className="mt-1.5 space-y-1">
                {numeros.map((n, i) => (
                  <li key={n} className="text-[12px] font-semibold text-[#081b2c]">
                    {legivel(n)}{' '}
                    <span className={`text-[10px] font-extrabold ${i === 0 ? 'text-[#b42318]' : 'text-slate-400'}`}>
                      {i === 0 ? 'médico: só ele classifica a urgência' : 'equipe: pode responder ao paciente'}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {recusadas.length > 0 && (
              <p className="mt-1.5 text-[10px] font-bold text-red-600">
                Fica de fora (não parece um celular com DDD): {recusadas.join(', ')}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {responsavel && (
            <button
              type="button"
              onClick={() => void salvar()}
              disabled={salvando || !mudou}
              className="rounded-xl bg-[#081b2c] px-3.5 py-2 text-[11px] font-extrabold text-white transition hover:bg-[#12324f] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {salvando ? 'Salvando...' : 'Salvar números'}
            </button>
          )}
          {atende && (
            <button
              type="button"
              onClick={() => void testar()}
              disabled={testando || mudou || !salvos?.length}
              title={mudou ? 'Salve os números antes de testar' : undefined}
              className="rounded-xl border border-[#b42318]/30 bg-white px-3.5 py-2 text-[11px] font-extrabold text-[#b42318] transition hover:bg-[#fff5f4] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {testando ? 'Mandando...' : 'Mandar alerta de teste'}
            </button>
          )}
          {!responsavel && salvos !== null && (
            <p className="text-[10px] font-semibold text-slate-400">Só o responsável pela clínica muda os números.</p>
          )}
        </div>

        {aviso && (
          <p className={`text-[11px] font-bold leading-relaxed ${aviso.tipo === 'ok' ? 'text-emerald-700' : 'text-red-600'}`}>{aviso.texto}</p>
        )}

        {salvos !== null && (
          <div className="flex items-start justify-between gap-3 rounded-[16px] border border-[#081b2c]/[0.06] bg-[#f8f7f4] px-4 py-3">
            <p className="text-[10px] font-semibold leading-relaxed text-slate-500">
              <span className="font-extrabold text-[#081b2c]">Último alerta: </span>
              {ultimo ? (
                <>
                  {quandoFoi(ultimo.quando)}, {ultimo.teste ? 'teste' : ultimo.quem || 'paciente'}.{' '}
                  {ultimo.enviado ? (
                    <span className="text-emerald-700">Enviado pelo WhatsApp.</span>
                  ) : (
                    <span className="text-red-600">Não saiu: veja a nota na conversa.</span>
                  )}
                  {ultimo.veredito && <> Resposta: {ROTULO_DO_VEREDITO[ultimo.veredito] ?? ultimo.veredito}.</>}
                </>
              ) : (
                'ainda nenhum. Ele aparece aqui depois da primeira urgência ou do alerta de teste.'
              )}
            </p>
            <button
              type="button"
              onClick={() => void atualizarUltimo()}
              disabled={atualizando}
              aria-label="Atualizar o último alerta"
              className="shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-white hover:text-[#081b2c] disabled:cursor-wait"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${atualizando ? 'animate-spin' : ''}`} />
            </button>
          </div>
        )}

        {salvos === null && !erro && <p className="text-[10px] font-semibold text-slate-400">Carregando...</p>}
        {erro && <p className="text-[10px] font-bold leading-relaxed text-red-600">{erro}</p>}
      </div>
    </section>
  )
}
