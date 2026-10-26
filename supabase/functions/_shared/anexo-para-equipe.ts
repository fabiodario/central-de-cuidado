/**
 * A foto, o audio ou o documento do paciente vao junto para os celulares do
 * alerta (25/10/2026, vindo do sistema do Dr. Marcello, de 23/10/2026).
 *
 * Pedido do Edu: "quando tiver foto, anexo, audio vai junto para eles" (o
 * Dr. Fabio e a Dayane). No Dr. Marcello o pedido nasceu da mae que mandou o
 * raio-x, e o celular so recebeu "Mandou uma foto (veja na Central)".
 *
 * Aqui so vai o que ja toca o celular: o alerta de urgencia ou de sangramento
 * (relatorio da Cintia) e o repasse depois que o medico respondeu. Arquivo de
 * conversa comum continua so na Central.
 *
 * O jeito que a Meta deixa: arquivo e mensagem livre, e mensagem livre so
 * chega a quem escreveu para o numero da clinica nas ultimas 24 horas. O
 * alerta (modelo aprovado) chega sempre; o arquivo vai logo atras e, fora da
 * janela, fica guardado e vai sozinho quando aquele celular escrever (ver
 * anexos-pendentes.ts). Nao ha modelo com audio na Meta, por isso nao vale
 * criar um modelo so para foto: o comportamento ficaria diferente por tipo.
 *
 * O arquivo sai do nosso acervo (whatsapp-anexos) por um link assinado, que o
 * webhook gera: o id da Meta serve para baixar, nao para reenviar.
 *
 * Sem a transcricao do audio do Dr. Marcello: ela manda a voz do paciente
 * para um servico nos Estados Unidos, o que pede a politica de privacidade e
 * o OK do Dr. Fabio. O audio vai do mesmo jeito, com uma linha antes dizendo
 * de quem e.
 */

export type AnexoParaEquipe = {
  /** O tipo da mensagem do paciente: image, audio, voice, document, video. */
  tipo: string
  /** Link assinado do arquivo no acervo, valido por tempo suficiente para a Meta buscar. */
  link: string
  /** Nome para o documento no celular. */
  nome?: string
  /** Onde o arquivo esta no acervo: e por ele que o envio fica registrado (ver anexos-pendentes.ts). */
  caminho?: string
  /** Quando o paciente mandou. */
  recebidoEm?: string
}

export function ehAudio(tipo: string | null | undefined): boolean {
  return tipo === 'audio' || tipo === 'voice'
}

const QUE_VAO = ['image', 'audio', 'voice', 'document', 'video'] as const

/** Este tipo de mensagem vai como arquivo? Figurinha, localizacao e contato nao. */
export function anexoQueVai(tipo: string | null | undefined): boolean {
  return (QUE_VAO as readonly string[]).includes(String(tipo ?? ''))
}

/**
 * O corpo da mensagem de arquivo para a API da Meta (sem o "to"). Nulo quando
 * o tipo nao vai. Audio nao aceita legenda na Meta: quem mandou vai no alerta
 * de antes, ou na linha antes dele (ver cabecalhoDoAnexo).
 */
export function mensagemDoAnexo(a: AnexoParaEquipe, quem: string): Record<string, unknown> | null {
  if (!anexoQueVai(a.tipo) || !a.link) return null
  const legenda = `📎 Enviado ${quem.trim() ? `por ${quem.trim()}` : 'pelo paciente'} pela Central de Cuidado`
  if (a.tipo === 'image') return { type: 'image', image: { link: a.link, caption: legenda } }
  if (a.tipo === 'video') return { type: 'video', video: { link: a.link, caption: legenda } }
  if (a.tipo === 'document') {
    return { type: 'document', document: { link: a.link, caption: legenda, filename: a.nome?.trim() || 'documento' } }
  }
  return { type: 'audio', audio: { link: a.link } }
}

const NOME_DO_TIPO: Record<string, string> = {
  image: 'A foto',
  video: 'O vídeo',
  document: 'O documento',
  audio: 'O áudio',
  voice: 'O áudio',
}

/** "A foto", "O áudio": o nome do arquivo nas notas e no cabecalho. */
export function nomeDoAnexo(tipo: string): string {
  return NOME_DO_TIPO[tipo] ?? 'O arquivo'
}

/**
 * A linha antes do arquivo que vai sozinho, sem alerta na frente (o paciente
 * mandou depois): sem ela, um audio chega ao celular sem dizer de quem e.
 */
export function cabecalhoDoAnexo(tipo: string, quem: string, recebidoEm: string): string {
  const quando = new Date(recebidoEm)
  const hora = quando.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  const dia = quando.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
  const nome = nomeDoAnexo(tipo).replace(/^(O|A) /, '')
  return `📎 ${nome.charAt(0).toUpperCase()}${nome.slice(1)} que ${quem.trim() || 'o paciente'} mandou às ${hora} de ${dia}:`
}

/** O arquivo de pouco antes que ainda vai com o alerta (ver anexoRecenteDaConversa). */
export const ANEXO_RECENTE_MS = 10 * 60 * 1000

type Acervo = {
  from: (tabela: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
  storage?: { from: (balde: string) => { createSignedUrl: (caminho: string, segundos: number) => Promise<{ data: { signedUrl?: string } | null; error: unknown }> } }
}

/**
 * O ultimo arquivo que o paciente mandou nesta conversa desde `desde`, pronto
 * para ir aos celulares (25/10/2026). E a ordem ao contrario: "olha o meu
 * nariz" com a foto, e so depois "ta sangrando muito", que dispara o alerta.
 * Sem ele, o alerta saia sem a foto que explica o caso. Nunca lanca: sem o
 * arquivo, o alerta sai do mesmo jeito.
 */
export async function anexoRecenteDaConversa(admin: Acervo, conversationId: string, desde: Date): Promise<AnexoParaEquipe | undefined> {
  try {
    const { data, error } = await admin
      .from('whatsapp_messages')
      .select('message_type,media_path,created_at')
      .eq('conversation_id', conversationId)
      .eq('direction', 'inbound')
      .not('media_path', 'is', null)
      .gte('created_at', desde.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) throw error
    const linha = (data as { message_type?: string; media_path?: string; created_at?: string }[] | null)?.[0]
    if (!linha?.media_path || !anexoQueVai(linha.message_type) || !admin.storage) return undefined
    const { data: assinado, error: erroDoLink } = await admin.storage.from('whatsapp-anexos').createSignedUrl(linha.media_path, 24 * 3600)
    if (erroDoLink || !assinado?.signedUrl) throw erroDoLink ?? new Error('link vazio')
    return { tipo: String(linha.message_type), link: assinado.signedUrl, caminho: linha.media_path, recebidoEm: linha.created_at }
  } catch (erro) {
    console.warn('Anexo para a equipe: nao achei o arquivo de pouco antes; o alerta vai sem ele', erro)
    return undefined
  }
}

/**
 * A linha da nota da conversa sobre o arquivo: so quando NAO foi para algum
 * celular. Falha grita: a equipe precisa saber que o arquivo so esta na
 * Central (e que vai sozinho quando aquele celular escrever).
 */
export function notaDoAnexo(tipo: string, envios: { numero: string; ok: boolean; erro?: string }[]): string {
  if (!envios.length) return ''
  const final = (n: string) => `final ${n.slice(-4)}`
  const naoForam = envios.filter((e) => !e.ok).map((e) => final(e.numero))
  if (!naoForam.length) return ''
  return `⚠️ ${nomeDoAnexo(tipo)} não foi para ${naoForam.join(' e ')}: a Meta só deixa mandar arquivo para quem escreveu ao número da clínica nas últimas 24 horas. Vai sozinho quando esse celular escrever para a clínica ou tocar num botão do alerta. Está aqui na Central.`
}
