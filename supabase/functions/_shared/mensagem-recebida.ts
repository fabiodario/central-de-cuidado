/**
 * Localizacao e contato compartilhados no WhatsApp, em texto (25/09/2026).
 *
 * Chegavam como "[location]" e "[contacts]" no historico - a equipe via que
 * algo tinha chegado e nao via o que. Agora o endereco vira link de mapa e o
 * contato vira nome e telefone.
 */

export type Localizacao = { latitude?: number; longitude?: number; name?: string; address?: string; url?: string }
export type Contato = {
  name?: { formatted_name?: string; first_name?: string }
  phones?: { phone?: string; wa_id?: string }[]
}

export function textoDaLocalizacao(local: Localizacao | undefined): string {
  if (!local) return '📍 Localização'
  const partes = [local.name, local.address].map((p) => String(p ?? '').trim()).filter(Boolean)
  const temPonto = Number.isFinite(Number(local.latitude)) && Number.isFinite(Number(local.longitude))
  const mapa = temPonto ? `https://maps.google.com/?q=${Number(local.latitude)},${Number(local.longitude)}` : ''
  return ['📍 Localização', partes.join(' - '), mapa].filter(Boolean).join('\n')
}

export function textoDosContatos(contatos: Contato[] | undefined): string {
  const linhas = (contatos ?? []).map((c) => {
    const nome = String(c?.name?.formatted_name ?? c?.name?.first_name ?? '').trim()
    const telefones = (c?.phones ?? []).map((p) => String(p?.phone ?? p?.wa_id ?? '').trim()).filter(Boolean)
    return [nome || 'Sem nome', telefones.join(', ')].filter(Boolean).join(': ')
  })
  return linhas.length ? `👤 Contato compartilhado\n${linhas.join('\n')}` : '👤 Contato compartilhado'
}

/**
 * Figurinha nao recebe resposta do robo (14/10/2026).
 *
 * Depois do lembrete da secretaria, uma mae mandou uma figurinha e depois
 * "Boa tarde, obrigada". A figurinha entrava como anexo: "Recebi o que voce
 * enviou e ja avisei a nossa equipe: alguem vai olhar" - e a conversa
 * acendia para a equipe abrir um emoji. Ela continua gravada (a equipe ve no
 * historico); so nao puxa resposta nem pedido de atencao. A reacao (curtir
 * uma mensagem) ja e ignorada antes, no webhook.
 */
export function semRespostaDoRobo(tipo: string | undefined | null): boolean {
  return tipo === 'sticker'
}
