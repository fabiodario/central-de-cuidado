import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/**
 * Foto da equipe e "quem esta online" (01/10/2026).
 *
 * A presenca roda num canal PRIVADO do Realtime, "presenca:<clinic_id>". O
 * banco so deixa entrar membro ativo da clinica com a chave ligada (migration
 * 20261001120000) - a tela tambem esconde, mas quem decide e o servidor.
 *
 * Tudo aqui falha para o lado quieto de proposito: sem foto, aparecem as
 * iniciais; sem a chave ou sem as colunas novas no banco, cada um ve so a
 * propria foto. Presenca e enfeite - nao pode derrubar a tela de ninguem.
 */

const semTipo = () => supabase as unknown as SupabaseClient
const BUCKET = 'fotos-da-equipe'
/** Disparado quando o responsavel muda a chave, para a tela reler na hora. */
export const EVENTO_PRESENCA_MUDOU = 'central:presenca-mudou'

export type PessoaOnline = { userId: string; nome: string; foto: string | null }

export function iniciais(nome: string): string {
  const partes = nome
    .replace(/^(dr|dra)\.?\s+/i, '')
    .trim()
    .split(/\s+/)
    // So palavras que comecam com letra: emoji ou "(filho)" no nome viravam
    // meio caractere nas iniciais (visto nas conversas em 02/10/2026).
    .filter((parte) => /^\p{L}/u.test(parte))
  if (!partes.length) return '?'
  const primeira = partes[0][0] ?? ''
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : ''
  return (primeira + ultima).toUpperCase()
}

const CORES = ['#2f7fc1', '#1c6b3a', '#8a4fbf', '#c0632b', '#1f8a8a', '#b8406b', '#5b6b2f']
export function corDoNome(nome: string): string {
  let h = 0
  for (const c of nome) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return CORES[h % CORES.length]
}

// Link temporario por caminho. O bucket e privado; o link dura 1h e e
// reaproveitado por 50 min para nao pedir um novo a cada render.
const linkCache = new Map<string, { url: string; ate: number }>()
export async function linkDaFoto(caminho: string | null): Promise<string | null> {
  if (!caminho) return null
  const guardado = linkCache.get(caminho)
  if (guardado && guardado.ate > Date.now()) return guardado.url
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(caminho, 3600)
  if (error || !data?.signedUrl) return null
  linkCache.set(caminho, { url: data.signedUrl, ate: Date.now() + 50 * 60 * 1000 })
  return data.signedUrl
}

async function minhaFoto(userId: string): Promise<string | null> {
  try {
    const { data, error } = await semTipo().from('profiles').select('avatar_path').eq('id', userId).maybeSingle()
    if (error) throw error
    return (data as { avatar_path?: string | null } | null)?.avatar_path ?? null
  } catch (erro) {
    console.warn('Foto do perfil indisponivel', erro)
    return null
  }
}

/** Recorta no centro e reduz para 256x256 JPEG - foto de celular tem 4 MB. */
async function reduzir(arquivo: File): Promise<Blob> {
  const bitmap = await createImageBitmap(arquivo)
  const lado = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Este navegador não consegue preparar a foto.')
  ctx.drawImage(bitmap, (bitmap.width - lado) / 2, (bitmap.height - lado) / 2, lado, lado, 0, 0, 256, 256)
  bitmap.close()
  return await new Promise<Blob>((ok, falha) =>
    canvas.toBlob((b) => (b ? ok(b) : falha(new Error('Não consegui converter a foto.'))), 'image/jpeg', 0.85),
  )
}

export async function enviarMinhaFoto(userId: string, arquivo: File, anterior: string | null): Promise<string> {
  if (!arquivo.type.startsWith('image/')) throw new Error('Escolha uma imagem.')
  const blob = await reduzir(arquivo)
  const caminho = `${userId}/${Date.now()}.jpg`
  const { error: erroUpload } = await supabase.storage.from(BUCKET).upload(caminho, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  })
  if (erroUpload) throw new Error(`Não consegui enviar a foto: ${erroUpload.message}`)
  const { error } = await semTipo().from('profiles').update({ avatar_path: caminho }).eq('id', userId)
  if (error) throw new Error(`Foto enviada, mas não consegui salvar no perfil: ${error.message}`)
  // A antiga sai depois que a nova esta gravada; se falhar, so sobra um
  // arquivo orfao, nunca um perfil sem foto.
  if (anterior && anterior !== caminho) await supabase.storage.from(BUCKET).remove([anterior]).catch(() => undefined)
  return caminho
}

export async function presencaLigada(clinicId: string): Promise<boolean> {
  try {
    const { data, error } = await semTipo().rpc('presenca_ligada', { p_clinic: clinicId })
    if (error) throw error
    return data === true
  } catch (erro) {
    console.warn('Nao consegui ler a chave de presenca', erro)
    return false
  }
}

export async function souResponsavelPeloSistema(): Promise<boolean> {
  try {
    const { data, error } = await semTipo().rpc('sou_responsavel_pelo_sistema')
    if (error) throw error
    return data === true
  } catch {
    return false
  }
}

export async function definirPresencaLigada(clinicId: string, ligada: boolean): Promise<void> {
  const { error } = await semTipo().rpc('definir_presenca_ligada', { p_clinic: clinicId, p_ligada: ligada })
  if (error) throw new Error(error.message)
  window.dispatchEvent(new Event(EVENTO_PRESENCA_MUDOU))
}

/**
 * Quem esta com a Central aberta agora, nesta clinica.
 *
 * Um hook so, no Home: o topo do celular e o do computador mostram os mesmos
 * dados, e dois canais seriam a mesma pessoa aparecendo duas vezes.
 */
export function useEquipeOnline(clinicId: string | null, userId: string | null, nome: string) {
  const [ligada, setLigada] = useState(false)
  const [foto, setFoto] = useState<string | null>(null)
  const [outros, setOutros] = useState<PessoaOnline[]>([])
  const canalRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    if (!userId) return
    let vivo = true
    void minhaFoto(userId).then((f) => vivo && setFoto(f))
    return () => {
      vivo = false
    }
  }, [userId])

  // A chave: na abertura, quando a janela volta ao foco e quando o proprio
  // responsavel muda no painel. Desligar vale para quem ja esta conectado sem
  // precisar recarregar.
  useEffect(() => {
    if (!clinicId) return
    let vivo = true
    const ler = () => void presencaLigada(clinicId).then((v) => vivo && setLigada(v))
    ler()
    window.addEventListener('focus', ler)
    window.addEventListener(EVENTO_PRESENCA_MUDOU, ler)
    const relogio = window.setInterval(ler, 5 * 60 * 1000)
    return () => {
      vivo = false
      window.removeEventListener('focus', ler)
      window.removeEventListener(EVENTO_PRESENCA_MUDOU, ler)
      window.clearInterval(relogio)
    }
  }, [clinicId])

  useEffect(() => {
    if (!clinicId || !userId || !ligada) {
      setOutros([])
      return
    }
    const canal = supabase.channel(`presenca:${clinicId}`, {
      config: { private: true, presence: { key: userId } },
    })
    canalRef.current = canal
    canal.on('presence', { event: 'sync' }, () => {
      const estado = canal.presenceState<{ nome?: string; foto?: string | null }>()
      const lista: PessoaOnline[] = []
      for (const [chave, entradas] of Object.entries(estado)) {
        if (chave === userId || !entradas.length) continue
        const ultima = entradas[entradas.length - 1]
        lista.push({ userId: chave, nome: String(ultima.nome ?? 'Equipe'), foto: ultima.foto ?? null })
      }
      lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      setOutros(lista)
    })
    canal.subscribe((status) => {
      if (status === 'SUBSCRIBED') void canal.track({ nome, foto })
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('Presenca da equipe recusada ou fora do ar', status)
        setOutros([])
      }
    })
    return () => {
      canalRef.current = null
      void supabase.removeChannel(canal)
    }
    // nome e foto entram pelo efeito de baixo, sem refazer o canal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, userId, ligada])

  // Foto ou nome mudou: atualiza o que os colegas veem, no mesmo canal.
  useEffect(() => {
    canalRef.current?.track({ nome, foto }).catch(() => undefined)
  }, [nome, foto])

  return { ligada, foto, setFoto, outros }
}
