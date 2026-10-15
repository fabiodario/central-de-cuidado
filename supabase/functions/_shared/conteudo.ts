import type { Toque } from './atendimento.ts'

/**
 * Monta o conteudo da mensagem: texto simples, botoes ou lista tocavel.
 *
 * A Meta impoe limites duros - 3 botoes, 10 linhas, titulos curtos - e recusa a
 * mensagem inteira quando algum estoura. Aqui, se o pedido nao couber, o envio
 * cai para texto puro em vez de falhar: a mensagem numerada sozinha ja resolve,
 * e uma resposta sem botao e infinitamente melhor do que resposta nenhuma.
 */
export function montarConteudo(
  texto: string,
  toques?: { botoes?: Toque[]; lista?: { rotulo: string; linhas: Toque[] } },
) {
  const simples = { type: 'text', text: { preview_url: false, body: texto } }
  if (!toques) return simples

  const cabe = (valor: string, limite: number) => valor.length > 0 && valor.length <= limite

  const botoes = toques.botoes ?? []
  if (botoes.length > 0) {
    if (botoes.length > 3 || texto.length > 1024) return simples
    if (!botoes.every((b) => cabe(b.titulo, 20) && cabe(b.id, 256))) return simples
    return {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: texto },
        action: {
          buttons: botoes.map((b) => ({
            type: 'reply',
            reply: { id: b.id, title: b.titulo },
          })),
        },
      },
    }
  }

  const lista = toques.lista
  if (lista && lista.linhas.length > 0) {
    if (lista.linhas.length > 10 || texto.length > 1024) return simples
    if (!cabe(lista.rotulo, 20)) return simples
    if (!lista.linhas.every((l) => cabe(l.titulo, 24) && (!l.descricao || l.descricao.length <= 72))) {
      return simples
    }
    return {
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: texto },
        action: {
          button: lista.rotulo,
          sections: [
            {
              title: 'Opções',
              rows: lista.linhas.map((l) => ({
                id: l.id,
                title: l.titulo,
                ...(l.descricao ? { description: l.descricao } : {}),
              })),
            },
          ],
        },
      },
    }
  }

  return simples
}

type Toques = { botoes?: Toque[]; lista?: { rotulo: string; linhas: Toque[] } }

/** Limite da Meta para o texto de mensagem com botao ou lista. */
const LIMITE_INTERATIVO = 1024
/** O fecho que vai junto dos botoes, quando o texto e longo demais. */
const FECHO_MAXIMO = 500

/**
 * Botoes que a propria frase ja promete (01/10/2026).
 *
 * Varias respostas terminam com "Digite *0*..." ou "Digite *9*..." e nenhum
 * botao: "Consulta marcada", "Pedido registrado", os avisos de falha. A
 * auditoria de 01/10 achou 19 assim. Em vez de lembrar de por botao em cada
 * uma, o envio le o fecho e oferece o toque equivalente - digitar continua
 * valendo, tocar passa a valer tambem.
 */
export function toquesDoFecho(texto: string): Toques | undefined {
  const t = texto.toLowerCase()
  const botoes: Toque[] = []
  if (/\*9\* para falar com (a nossa |a )?equipe/.test(t)) botoes.push({ id: '9', titulo: 'Falar com a equipe' })
  if (/\*0\* (a qualquer momento )?para voltar ao in[ií]cio/.test(t)) {
    botoes.push({ id: '0', titulo: 'Voltar ao início' })
  } else if (/\*0\* para ver (todas )?as op[cç][oõ]es/.test(t)) {
    botoes.push({ id: '0', titulo: 'Ver as opções' })
  }
  return botoes.length ? { botoes } : undefined
}

/** Ultimos paragrafos que cabem junto dos botoes. */
function dividir(texto: string): [string, string] | null {
  const paragrafos = texto.split('\n\n')
  let fecho = ''
  let i = paragrafos.length
  while (i > 1) {
    const candidato = paragrafos.slice(i - 1).join('\n\n')
    if (candidato.length > FECHO_MAXIMO) break
    fecho = candidato
    i--
  }
  if (!fecho) return null
  return [paragrafos.slice(0, i).join('\n\n'), fecho]
}

/**
 * As mensagens a enviar, na ordem (01/10/2026).
 *
 * Texto que nao cabe no limite da Meta para botoes (1024) perdia os botoes em
 * silencio - montarConteudo cai para texto puro. Foi o que aconteceu com as
 * informacoes da unidade: a lista "Ver opcoes" existia, mas o texto de Santos
 * passa de 1024 e a familia so podia digitar. Agora o conteudo vai numa
 * mensagem e o fecho ("Digite *1* para ver outra unidade...") vai logo abaixo,
 * com os botoes.
 */
export function montarMensagens(texto: string, toques?: Toques): ReturnType<typeof montarConteudo>[] {
  const pedidos = toques && (toques.botoes?.length || toques.lista?.linhas?.length) ? toques : toquesDoFecho(texto)
  if (!pedidos) return [montarConteudo(texto)]
  if (texto.length <= LIMITE_INTERATIVO) return [montarConteudo(texto, pedidos)]
  const partes = dividir(texto)
  if (!partes) return [montarConteudo(texto)]
  return [montarConteudo(partes[0]), montarConteudo(partes[1], pedidos)]
}
