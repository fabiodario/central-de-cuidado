import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/**
 * Notificacoes no celular da equipe (28/09/2026).
 *
 * O servidor avisa pelo meta-webhook (_shared/push-da-equipe.ts); aqui fica o
 * lado do aparelho: registrar o service worker (public/sw.js), pedir
 * permissao, inscrever e gravar a inscricao no banco.
 *
 * iPhone so recebe push de site que foi ADICIONADO A TELA DE INICIO e aberto
 * por la (iOS 16.4 ou mais novo). No Safari comum o PushManager nem existe -
 * por isso situacaoDoAparelho separa "nao suporta" de "precisa instalar", e a
 * tela ensina o caminho em vez de so dizer que nao da.
 */

// Tabela e funcao novas ainda nao estao nos tipos gerados do banco.
const semTipo = () => supabase as unknown as SupabaseClient

export type SituacaoDoAparelho =
  | 'pronto' // pode ativar
  | 'iphone-instalar' // iPhone no Safari: precisa ir para a tela de inicio
  | 'sem-suporte' // navegador sem push
  | 'bloqueado' // a pessoa negou a permissao; so nos ajustes do celular

export function ehIPhone(): boolean {
  const ua = navigator.userAgent
  // iPad com iPadOS se apresenta como Mac; o toque denuncia.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

export function abertoComoApp(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function situacaoDoAparelho(): SituacaoDoAparelho {
  const temPush = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (!temPush) return ehIPhone() && !abertoComoApp() ? 'iphone-instalar' : 'sem-suporte'
  if (Notification.permission === 'denied') return 'bloqueado'
  return 'pronto'
}

export function nomeDoAparelho(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad'
  const android = ua.match(/Android[^;)]*;\s*([^;)]+?)(?:\sBuild|\))/)
  if (android) return android[1].trim() || 'Android'
  if (/Android/.test(ua)) return 'Android'
  if (/Windows/.test(ua)) return 'Computador (Windows)'
  if (/Macintosh/.test(ua)) return 'Computador (Mac)'
  return 'Navegador'
}

/**
 * Registra o service worker em toda abertura. Barato, e garante que um
 * sw.js novo publicado assuma sem a pessoa precisar reativar nada.
 */
export async function registrarServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register('./sw.js', { scope: './' })
  } catch (erro) {
    console.warn('Service worker nao registrou; notificacoes no celular desligadas', erro)
    return null
  }
}

function deBase64Url(texto: string): Uint8Array<ArrayBuffer> {
  const b64 = texto.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function mesmaChave(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false
  const x = new Uint8Array(a)
  return x.length === b.length && x.every((v, i) => v === b[i])
}

async function erroDaFuncao(error: unknown): Promise<string> {
  const contexto = (error as { context?: Response }).context
  if (contexto && typeof contexto.json === 'function') {
    const corpo = await contexto.json().catch(() => null)
    if (corpo?.error) return String(corpo.error)
  }
  return error instanceof Error ? error.message : String(error)
}

async function registroPronto(): Promise<ServiceWorkerRegistration> {
  await registrarServiceWorker()
  return navigator.serviceWorker.ready
}

/** Pede permissao, inscreve o aparelho e grava. Tem que vir de um toque. */
export async function ativarNotificacoes(clinicId: string): Promise<void> {
  const permissao = await Notification.requestPermission()
  if (permissao !== 'granted') {
    // 'default' quase nunca e a pessoa dizendo nao: e o Chrome escondendo o
    // pedido (ele "silencia" sites que pedem muito, e a janelinha vira um
    // sino riscado na barra de endereco) ou a pessoa fechando sem ler. Em
    // 28/09/2026 a mensagem era so "Permissao nao concedida" e nao dizia o
    // que fazer - o caminho precisa estar escrito aqui.
    throw new Error(
      ehIPhone()
        ? 'O iPhone não liberou os avisos. Abra Ajustes → Notificações → Central, ative "Permitir Notificações" e toque em Ativar de novo.'
        : permissao === 'denied'
          ? 'Os avisos estão bloqueados para a Central. Toque no ícone à esquerda do endereço (cadeado ou ajustes) → Notificações → Permitir, e depois em Ativar de novo.'
          : 'O navegador não mostrou o pedido. Toque no ícone à esquerda do endereço (sino riscado, cadeado ou ajustes) → Notificações → Permitir, e depois em Ativar de novo.',
    )
  }

  const { data, error } = await supabase.functions.invoke('notificar-equipe', { body: { acao: 'chave' } })
  if (error) throw new Error(await erroDaFuncao(error))
  const chave = deBase64Url(String((data as { chave?: string })?.chave ?? ''))
  if (chave.length !== 65) throw new Error('O servidor não devolveu a chave das notificações.')

  const registro = await registroPronto()
  let inscricao = await registro.pushManager.getSubscription()
  // Inscricao antiga com outra chave (servidor trocou de par) nao recebe
  // nada - o servico de push recusa. Refaz em vez de gravar uma morta.
  if (inscricao && !mesmaChave(inscricao.options.applicationServerKey, chave)) {
    await inscricao.unsubscribe().catch(() => undefined)
    inscricao = null
  }
  inscricao ??= await registro.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave })

  const json = inscricao.toJSON()
  const { error: erroAoGravar } = await semTipo().rpc('salvar_inscricao_push', {
    p_clinic: clinicId,
    p_endpoint: json.endpoint,
    p_p256dh: json.keys?.p256dh ?? '',
    p_auth: json.keys?.auth ?? '',
    p_aparelho: nomeDoAparelho(),
  })
  if (erroAoGravar) throw new Error(`Não consegui salvar este aparelho: ${erroAoGravar.message}`)
}

export type EstadoNoServidor = {
  ativo: boolean
  ultimoEnvio: string | null
  ultimoErro: string | null
}

/** Este aparelho esta inscrito E gravado no banco? */
export async function estadoDesteAparelho(clinicId: string): Promise<EstadoNoServidor> {
  if (situacaoDoAparelho() !== 'pronto' || Notification.permission !== 'granted') {
    return { ativo: false, ultimoEnvio: null, ultimoErro: null }
  }
  const registro = await navigator.serviceWorker.getRegistration('./')
  const inscricao = await registro?.pushManager.getSubscription()
  if (!inscricao) return { ativo: false, ultimoEnvio: null, ultimoErro: null }

  const { data, error } = await semTipo()
    .from('push_inscricoes')
    .select('ultimo_envio_em,ultimo_erro')
    .eq('clinic_id', clinicId)
    .eq('endpoint', inscricao.endpoint)
    .maybeSingle()
  if (error) throw new Error(error.message)
  // Inscrito no celular mas sem linha no banco (apagada por 410, ou outra
  // clinica): para o servidor este aparelho nao existe.
  if (!data) return { ativo: false, ultimoEnvio: null, ultimoErro: null }
  return { ativo: true, ultimoEnvio: data.ultimo_envio_em ?? null, ultimoErro: data.ultimo_erro ?? null }
}

export async function desativarNotificacoes(clinicId: string): Promise<void> {
  const registro = await navigator.serviceWorker.getRegistration('./')
  const inscricao = await registro?.pushManager.getSubscription()
  if (!inscricao) return
  const { error } = await semTipo()
    .from('push_inscricoes')
    .delete()
    .eq('clinic_id', clinicId)
    .eq('endpoint', inscricao.endpoint)
  if (error) throw new Error(error.message)
  // A inscricao do navegador fica: o mesmo celular pode estar ativo em outra
  // clinica, e ela e a mesma para todas.
}

export async function testarNotificacao(clinicId: string): Promise<{ enviados: number; falhas: string[] }> {
  const { data, error } = await supabase.functions.invoke('notificar-equipe', { body: { acao: 'teste', clinicId } })
  if (error) throw new Error(await erroDaFuncao(error))
  const r = data as { enviados?: number; falhas?: string[] }
  return { enviados: r?.enviados ?? 0, falhas: r?.falhas ?? [] }
}
