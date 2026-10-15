/**
 * Transforma o atendimento guardado no banco no texto que vai para o PDF
 * assinado.
 *
 * Vive separado do gerador de PDF de proposito: aqui e tudo funcao pura, sem
 * biblioteca nenhuma, entao da para testar de verdade. O documento que o medico
 * assina nao pode sair errado por causa de uma tag HTML mal fechada, e a unica
 * maneira honesta de garantir isso e conferindo cada caso.
 *
 * O texto e montado a partir do que esta NO BANCO, nunca do que o navegador
 * desenhou. Se a tela e o documento assinado pudessem divergir, a assinatura
 * nao valeria nada: ela provaria a autoria de um papel que ninguem leu.
 */

export type ConsultaParaImpressao = {
  consultation_date: string
  encounter_type: string
  unit: string | null
  weight_kg: number | null
  height_cm: number | null
  chief_complaint: string | null
  clinical_history: string | null
  personal_history: string | null
  family_history: string | null
  allergies: string | null
  current_medications: string | null
  physical_exam: string | null
  assessment: string | null
  cid: string | null
  plan: string | null
  prescription: string | null
  return_plan: string | null
}

export type PacienteParaImpressao = {
  name: string
  birth_date: string | null
  sex: 'F' | 'M' | 'O' | null
  guardian_name: string | null
  insurance: string | null
}

export type Bloco = { titulo: string; texto: string }

const TIPOS: Record<string, string> = {
  initial: 'Consulta inicial',
  return: 'Retorno',
  telemedicine: 'Teleconsulta',
  other: 'Atendimento',
}

const SEXOS: Record<string, string> = {
  F: 'Feminino',
  M: 'Masculino',
  O: 'Outro',
}

/**
 * HTML do editor -> texto corrido.
 *
 * A ordem importa: as quebras de linha viram marcadores ANTES de as tags serem
 * removidas, senao paragrafos separados grudariam numa linha so e mudariam o
 * sentido do que o medico escreveu ("Dipirona 500mg" e "Amoxicilina 250mg"
 * viram uma prescricao inventada se colarem).
 */
export function htmlParaTexto(html: string | null | undefined): string {
  if (!html) return ''

  return String(html)
    // Um item de lista precisa se anunciar como item, senao vira frase solta.
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>/gi, '\n')
    // </li> fica de fora: a abertura do item ja abriu a linha, e fechar de
    // novo deixaria uma linha em branco entre cada item da lista.
    .replace(/<\/(p|div|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    // Entidades que o editor produz. &amp; por ultimo: se viesse antes,
    // "&amp;lt;" viraria "<" e engoliria o texto seguinte.
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/\r/g, '')
    // No maximo uma linha em branco entre paragrafos: o editor gera <p></p>
    // vazios aos montes e o PDF ficaria cheio de buracos.
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((linha) => linha.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .trim()
}

export function dataPorExtenso(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split('-')
  return `${dia}/${mes}/${ano}`
}

export function idadeEm(nascimento: string | null, referencia: string): string {
  if (!nascimento) return ''
  const n = new Date(`${nascimento.slice(0, 10)}T00:00:00Z`)
  const r = new Date(`${referencia.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(n.getTime()) || Number.isNaN(r.getTime()) || r < n) return ''

  let meses = (r.getUTCFullYear() - n.getUTCFullYear()) * 12 + (r.getUTCMonth() - n.getUTCMonth())
  if (r.getUTCDate() < n.getUTCDate()) meses -= 1

  const anos = Math.floor(meses / 12)
  const resto = meses % 12

  // Em pediatria a idade em meses e informacao clinica, nao detalhe: dose,
  // marco de desenvolvimento e percentil dependem dela. Abaixo de dois anos o
  // arredondamento para "1 ano" apagaria justamente o que importa.
  if (anos < 2) return `${meses} ${meses === 1 ? 'mês' : 'meses'}`
  if (resto === 0) return `${anos} anos`
  return `${anos} anos e ${resto} ${resto === 1 ? 'mês' : 'meses'}`
}

function imc(peso: number | null, altura: number | null): string {
  if (!peso || !altura) return ''
  const metros = altura / 100
  const valor = peso / (metros * metros)
  if (!Number.isFinite(valor)) return ''
  return valor.toFixed(1).replace('.', ',')
}

/** Linha de medidas, so com o que foi realmente medido. */
export function medidasDaConsulta(consulta: ConsultaParaImpressao): string {
  const partes: string[] = []
  if (consulta.weight_kg) partes.push(`Peso ${String(consulta.weight_kg).replace('.', ',')} kg`)
  if (consulta.height_cm) partes.push(`Altura ${String(consulta.height_cm).replace('.', ',')} cm`)
  const indice = imc(consulta.weight_kg, consulta.height_cm)
  if (indice) partes.push(`IMC ${indice}`)
  return partes.join(' · ')
}

export function identificacaoDoPaciente(
  paciente: PacienteParaImpressao,
  consulta: ConsultaParaImpressao,
): Bloco[] {
  const idade = idadeEm(paciente.birth_date, consulta.consultation_date)
  const linhas: string[] = [paciente.name]

  const nascimento = paciente.birth_date
    ? `Nascimento ${dataPorExtenso(paciente.birth_date)}${idade ? ` (${idade})` : ''}`
    : ''
  const sexo = paciente.sex ? SEXOS[paciente.sex] ?? '' : ''
  const segunda = [nascimento, sexo].filter(Boolean).join(' · ')
  if (segunda) linhas.push(segunda)

  if (paciente.guardian_name) linhas.push(`Responsável: ${paciente.guardian_name}`)
  if (paciente.insurance) linhas.push(`Convênio: ${paciente.insurance}`)

  return [{ titulo: 'Paciente', texto: linhas.join('\n') }]
}

/**
 * Os blocos clinicos, na ordem em que o medico escreve.
 *
 * Campo vazio nao entra. Um documento assinado com "Alergias: —" afirma que a
 * pergunta foi feita e a resposta foi nenhuma; a ausencia do bloco diz apenas
 * que nao foi registrado. Sao coisas diferentes, e num prontuario a diferenca
 * pode ser a defesa do medico.
 */
export function blocosDaConsulta(consulta: ConsultaParaImpressao): Bloco[] {
  const campos: Array<[string, string | null]> = [
    ['Queixa principal', consulta.chief_complaint],
    ['História da doença atual', consulta.clinical_history],
    ['Antecedentes pessoais', consulta.personal_history],
    ['Antecedentes familiares', consulta.family_history],
    ['Alergias', consulta.allergies],
    ['Medicações em uso', consulta.current_medications],
    ['Exame físico', consulta.physical_exam],
    ['Hipótese diagnóstica', consulta.assessment],
    ['CID', consulta.cid],
    ['Conduta', consulta.plan],
    ['Prescrição', consulta.prescription],
    ['Retorno', consulta.return_plan],
  ]

  const blocos: Bloco[] = []

  const medidas = medidasDaConsulta(consulta)
  if (medidas) blocos.push({ titulo: 'Medidas', texto: medidas })

  for (const [titulo, valor] of campos) {
    const texto = htmlParaTexto(valor)
    if (texto) blocos.push({ titulo, texto })
  }

  return blocos
}

export function tituloDoAtendimento(consulta: ConsultaParaImpressao): string {
  const tipo = TIPOS[consulta.encounter_type] ?? TIPOS.other
  const data = dataPorExtenso(consulta.consultation_date)
  return consulta.unit ? `${tipo} · ${data} · ${consulta.unit}` : `${tipo} · ${data}`
}

/**
 * Quebra o texto em linhas que cabem na largura dada.
 *
 * Recebe a funcao de medir como parametro para nao depender do PDF: no teste a
 * medida e o numero de caracteres, no documento e a largura real da fonte.
 * Palavra que nao cabe sozinha e partida - preferivel a deixa-la sangrar para
 * fora da margem e sumir do papel.
 */
export function quebrarEmLinhas(
  texto: string,
  largura: number,
  medir: (s: string) => number,
): string[] {
  const linhas: string[] = []

  for (const paragrafo of texto.split('\n')) {
    if (!paragrafo) {
      linhas.push('')
      continue
    }

    let atual = ''
    for (const palavra of paragrafo.split(' ')) {
      const tentativa = atual ? `${atual} ${palavra}` : palavra
      if (medir(tentativa) <= largura) {
        atual = tentativa
        continue
      }

      if (atual) linhas.push(atual)

      if (medir(palavra) <= largura) {
        atual = palavra
        continue
      }

      let pedaco = ''
      for (const letra of palavra) {
        if (medir(pedaco + letra) > largura && pedaco) {
          linhas.push(pedaco)
          pedaco = letra
        } else {
          pedaco += letra
        }
      }
      atual = pedaco
    }

    linhas.push(atual)
  }

  return linhas
}
