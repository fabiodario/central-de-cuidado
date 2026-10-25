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

/**
 * Mensagem que o WhatsApp nao mostra: chega como "[unsupported]" (16/10/2026).
 *
 * E o que a Meta entrega quando a pessoa manda algo que a API nao le - muito
 * provavelmente uma LIGACAO pelo WhatsApp para o numero da clinica, ou foto de
 * visualizacao unica, enquete. No sistema do Dr. Marcello, um contato fez isso em 22/09 e
 * em 16/10 sem nunca escrever texto: o robo respondeu o menu as duas vezes e
 * as duas voltaram "Message undeliverable". O modelo de retomar, mandado pela
 * equipe em 23/09, chegou. Isso mostrou que esse tipo de mensagem NAO abre a
 * janela de 24 horas para texto livre.
 *
 *   - janela aberta (a pessoa escreveu texto nas ultimas 24h): o robo pede
 *     para ela escrever, em vez de mandar o menu como se nada tivesse chegado;
 *   - janela fechada: o robo nao responde (falharia) e a conversa vai para a
 *     equipe com etiqueta propria, que diz para usar um modelo.
 */
export type DestinoDaNaoSuportada = 'normal' | 'pedir_texto' | 'so_equipe'

export function destinoDaNaoSuportada(tipo: string | undefined | null, janelaAberta: boolean): DestinoDaNaoSuportada {
  if (tipo !== 'unsupported') return 'normal'
  return janelaAberta ? 'pedir_texto' : 'so_equipe'
}

export const TEXTO_NAO_SUPORTADA =
  'Não consegui abrir o que você enviou por aqui. Pode escrever em texto? (Ligações pelo WhatsApp não chegam até nós.)'
