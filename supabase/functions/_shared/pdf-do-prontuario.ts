import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1'
import {
  Bloco,
  ConsultaParaImpressao,
  identificacaoDoPaciente,
  PacienteParaImpressao,
  blocosDaConsulta,
  quebrarEmLinhas,
  tituloDoAtendimento,
} from './texto-do-prontuario.ts'

/**
 * Monta o PDF do atendimento que sera assinado.
 *
 * Este arquivo e o documento: e ele que recebe a assinatura ICP-Brasil e e ele
 * que vale perante terceiros. Por isso e gerado aqui, no servidor, a partir do
 * que esta no banco - nunca a partir do que o navegador desenhou. Se o
 * navegador pudesse montar o documento, a assinatura provaria apenas que o
 * medico assinou algum PDF, e nao que assinou AQUELE atendimento.
 */

const A4 = { largura: 595.28, altura: 841.89 }
const MARGEM = 56
const LARGURA_UTIL = A4.largura - MARGEM * 2
const TINTA = rgb(0.09, 0.11, 0.13)
const TINTA_CLARA = rgb(0.42, 0.46, 0.5)
const LINHA = rgb(0.83, 0.85, 0.87)

/**
 * As fontes padrao do PDF usam WinAnsi, que cobre o portugues mas nao cobre
 * tudo o que um teclado moderno produz. Um emoji ou um traco tipografico
 * colado de outro lugar faria a geracao explodir - e o medico veria "erro ao
 * assinar" sem entender por que. Melhor trocar o caractere e seguir.
 */
const TROCAS: Record<string, string> = {
  '–': '-',
  '—': '-',
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '…': '...',
  ' ': ' ',
  '•': '•',
  '·': '·',
}

function seguro(texto: string): string {
  let saida = ''
  for (const letra of texto) {
    if (TROCAS[letra] !== undefined) {
      saida += TROCAS[letra]
      continue
    }
    const codigo = letra.codePointAt(0) ?? 0
    saida += codigo <= 255 ? letra : ''
  }
  return saida
}

export type DadosDoDocumento = {
  clinica: string
  medico: string
  crm: string
  paciente: PacienteParaImpressao
  consulta: ConsultaParaImpressao
  /** Impressao digital do registro na corrente de auditoria, quando houver. */
  selo?: string | null
  geradoEm: Date
}

type Pincel = {
  pdf: PDFDocument
  pagina: PDFPage
  y: number
  normal: PDFFont
  negrito: PDFFont
  paginas: PDFPage[]
}

function novaPagina(p: Pincel) {
  p.pagina = p.pdf.addPage([A4.largura, A4.altura])
  p.paginas.push(p.pagina)
  p.y = A4.altura - MARGEM
}

function escrever(p: Pincel, texto: string, opcoes: {
  fonte?: PDFFont
  tamanho?: number
  cor?: typeof TINTA
  espacoAntes?: number
}) {
  const fonte = opcoes.fonte ?? p.normal
  const tamanho = opcoes.tamanho ?? 10.5
  const alturaLinha = tamanho * 1.45

  if (opcoes.espacoAntes) p.y -= opcoes.espacoAntes

  const linhas = quebrarEmLinhas(
    seguro(texto),
    LARGURA_UTIL,
    (s) => fonte.widthOfTextAtSize(s, tamanho),
  )

  for (const linha of linhas) {
    // Margem inferior maior que a superior: e onde entra o rodape com o selo,
    // e texto encostando nele confunde o que e conteudo e o que e carimbo.
    if (p.y < MARGEM + 60) novaPagina(p)
    p.pagina.drawText(linha, {
      x: MARGEM,
      y: p.y - tamanho,
      size: tamanho,
      font: fonte,
      color: opcoes.cor ?? TINTA,
    })
    p.y -= alturaLinha
  }
}

/**
 * Um bloco nunca comeca no pe da pagina.
 *
 * Titulo sozinho no fim de uma folha e conteudo na seguinte e o defeito
 * classico de impressao de prontuario - ja aconteceu neste projeto na versao
 * do navegador. Aqui a conta e feita antes: se nao couberem o titulo e ao
 * menos duas linhas, o bloco inteiro desce.
 */
function escreverBloco(p: Pincel, bloco: Bloco) {
  const precisa = 13 + 10.5 * 1.45 * 2
  if (p.y - precisa < MARGEM + 60) novaPagina(p)

  escrever(p, bloco.titulo.toUpperCase(), {
    fonte: p.negrito,
    tamanho: 8.5,
    cor: TINTA_CLARA,
    espacoAntes: 12,
  })
  escrever(p, bloco.texto, { tamanho: 10.5 })
}

export async function montarPdfDoAtendimento(dados: DadosDoDocumento): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const normal = await pdf.embedFont(StandardFonts.Helvetica)
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold)

  pdf.setTitle(`Atendimento ${dados.paciente.name} ${dados.consulta.consultation_date}`)
  pdf.setAuthor(`${dados.medico} - CRM ${dados.crm}`)
  pdf.setProducer('Central de Cuidado')
  pdf.setCreationDate(dados.geradoEm)

  const p: Pincel = {
    pdf,
    pagina: null as unknown as PDFPage,
    y: 0,
    normal,
    negrito,
    paginas: [],
  }
  novaPagina(p)

  // Cabecalho
  escrever(p, dados.clinica, { fonte: negrito, tamanho: 13 })
  escrever(p, `${dados.medico} · CRM ${dados.crm}`, { tamanho: 9.5, cor: TINTA_CLARA })

  p.y -= 10
  p.pagina.drawLine({
    start: { x: MARGEM, y: p.y },
    end: { x: A4.largura - MARGEM, y: p.y },
    thickness: 0.8,
    color: LINHA,
  })
  p.y -= 8

  escrever(p, tituloDoAtendimento(dados.consulta), {
    fonte: negrito,
    tamanho: 11.5,
    espacoAntes: 8,
  })

  for (const bloco of identificacaoDoPaciente(dados.paciente, dados.consulta)) {
    escreverBloco(p, bloco)
  }
  for (const bloco of blocosDaConsulta(dados.consulta)) {
    escreverBloco(p, bloco)
  }

  // Rodape em todas as paginas, so no fim, quando ja se sabe quantas sao.
  const total = p.paginas.length
  const carimbo = dados.geradoEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })

  p.paginas.forEach((pagina, indice) => {
    pagina.drawLine({
      start: { x: MARGEM, y: MARGEM + 30 },
      end: { x: A4.largura - MARGEM, y: MARGEM + 30 },
      thickness: 0.5,
      color: LINHA,
    })

    const esquerda = dados.selo
      ? `Registro ${dados.selo.slice(0, 16)} · gerado em ${carimbo}`
      : `Gerado em ${carimbo}`

    pagina.drawText(seguro(esquerda), {
      x: MARGEM,
      y: MARGEM + 18,
      size: 7.5,
      font: normal,
      color: TINTA_CLARA,
    })

    const paginacao = `${indice + 1}/${total}`
    pagina.drawText(paginacao, {
      x: A4.largura - MARGEM - normal.widthOfTextAtSize(paginacao, 7.5),
      y: MARGEM + 18,
      size: 7.5,
      font: normal,
      color: TINTA_CLARA,
    })

    pagina.drawText(
      seguro('Documento assinado digitalmente com certificado ICP-Brasil.'),
      { x: MARGEM, y: MARGEM + 6, size: 7.5, font: normal, color: TINTA_CLARA },
    )
  })

  return await pdf.save()
}
