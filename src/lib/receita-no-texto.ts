/**
 * Monta o texto do campo "Prescricao" com as receitas Memed do atendimento.
 *
 * Funcao pura, separada da tela para poder ser testada sem navegador.
 *
 * Existe por causa de 23/09/2026: o Dr. Marcello emitiu duas receitas na mesma
 * consulta, Peg-Lax as 16:26 e Radiografia de abdome as 16:27, e o prontuario
 * assinado saiu so com a radiografia. Dois defeitos juntos:
 *
 *  1. So a receita MAIS RECENTE era copiada (um find() numa lista em ordem
 *     decrescente). As outras ficavam arquivadas, mas fora do texto.
 *  2. O texto de partida era o do momento em que a Memed abriu. A segunda
 *     emissao partia dele, sem o Peg-Lax que a primeira tinha acabado de
 *     escrever, e gravava por cima.
 *
 * Aqui entram TODAS as receitas do atendimento, da mais antiga para a mais
 * nova, e so as linhas que ainda nao estao no texto. Quem chama e responsavel
 * por passar o texto ATUAL - o do banco ou o do formulario aberto -, nunca uma
 * copia guardada de antes.
 */

import { categoriaDaReceita, type CategoriaDaReceita } from './categoria-da-receita'

export interface ItemDeReceita {
  nome: string
  posologia: string
  tipo?: string | null
  receituario?: string | null
}

/**
 * Titulo de cada bloco no texto do atendimento, pela categoria. Ate 23/09/2026
 * tudo saia como "Receita Memed de ...", inclusive atestado e pedido de exame,
 * e o prontuario impresso lia como se o medico tivesse receitado um hemograma.
 */
const TITULO_NO_TEXTO: Record<CategoriaDaReceita, string> = {
  especial: 'Receita especial',
  medicacao: 'Receita',
  exame: 'Pedido de exames',
  documento: 'Atestado ou documento',
}

export interface ReceitaParaTexto {
  emitidaEm: string
  itens: ItemDeReceita[]
}

function escapar(texto: string) {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Data da receita no fuso da clinica.
 *
 * Era iso.slice(0, 10), que e a data em UTC: uma receita emitida as 21h de
 * 23/09 em Santos saia como "24/09" (23/09/2026, atestado de teste da noite).
 * Ler as partes pelo Intl nao depende do fuso da maquina de quem abre.
 */
export function dataDaReceita(iso: string): string {
  const instante = new Date(iso)
  if (Number.isNaN(instante.getTime())) return iso
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(instante)
  const pega = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? ''
  return `${pega('day')}/${pega('month')}/${pega('year')}`
}

/** Devolve o texto novo, ou null quando nada falta. */
export function acrescentarReceitas(atual: string, receitas: ReceitaParaTexto[]): string | null {
  // O campo guarda HTML quando foi escrito no editor e texto puro quando veio
  // de fora; a comparacao e o acrescimo respeitam o formato que ja esta.
  const emHtml = /[<>]|&[a-z]+;|&#\d+;/i.test(atual)
  let texto = atual
  let mudou = false

  const ordenadas = [...receitas].sort((a, b) => a.emitidaEm.localeCompare(b.emitidaEm))
  for (const receita of ordenadas) {
    const lido = emHtml
      ? texto.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      : texto
    const linhas = receita.itens
      .filter((item) => item.nome.trim())
      .map((item) => (item.posologia ? `${item.nome}: ${item.posologia}` : item.nome))
      .filter((linha) => !lido.includes(linha))
    if (linhas.length === 0) continue

    const titulo = `${TITULO_NO_TEXTO[categoriaDaReceita(receita.itens)]} · Memed · ${dataDaReceita(receita.emitidaEm)}`
    texto = emHtml
      ? `${texto}<p><strong>${escapar(titulo)}</strong><br>${linhas.map(escapar).join('<br>')}</p>`
      : [texto.trim(), `${titulo}\n${linhas.join('\n')}`].filter(Boolean).join('\n\n')
    mudou = true
  }

  return mudou ? texto : null
}
