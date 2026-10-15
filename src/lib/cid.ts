/**
 * Nome da doença a partir do código do CID-10.
 *
 * No cadastro o médico digita o código ("K59.0"), que é o que vale no
 * documento. Mas num gráfico de "mais frequentes" o código não informa nada:
 * quem lê o painel precisa saber que aquilo é constipação, não decorar a
 * tabela. Aqui fica a tradução.
 *
 * O dicionário é parcial de propósito - cobre o que aparece na rotina de
 * gastroenterologia pediátrica. Código que não estiver na lista continua
 * aparecendo como código, nunca some nem vira "desconhecido". Para incluir um
 * novo, basta acrescentar a linha.
 *
 * Atrás dele, como rede, vem a tabela oficial do DATASUS (cid-tabela.ts). Os
 * nomes daqui ganham dela por serem escritos em português com acento; a tabela
 * cobre os outros seiscentos códigos dos mesmos capítulos.
 */
import { TABELA } from './cid-tabela'

const NOMES: Record<string, string> = {
  A09: 'Diarreia e gastroenterite de origem infecciosa presumível',
  B82: 'Parasitose intestinal',
  E66: 'Obesidade',
  'E73.0': 'Deficiência congênita de lactase',
  'E73.9': 'Intolerância à lactose',
  K21: 'Refluxo gastroesofágico',
  'K21.0': 'Refluxo gastroesofágico com esofagite',
  'K21.9': 'Refluxo gastroesofágico sem esofagite',
  K25: 'Úlcera gástrica',
  'K29.7': 'Gastrite',
  K30: 'Dispepsia',
  K50: 'Doença de Crohn',
  K51: 'Retocolite ulcerativa',
  'K52.2': 'Gastroenterite e colite alérgica ou ligada à dieta',
  'K52.9': 'Gastroenterite e colite não infecciosa',
  K58: 'Síndrome do intestino irritável',
  'K58.0': 'Síndrome do intestino irritável com diarreia',
  'K58.9': 'Síndrome do intestino irritável sem diarreia',
  K59: 'Transtorno intestinal funcional',
  'K59.0': 'Constipação',
  'K59.1': 'Diarreia funcional',
  'K60.2': 'Fissura anal',
  'K62.5': 'Sangramento anal ou retal',
  'K76.0': 'Esteatose hepática',
  K80: 'Colelitíase',
  'K90.0': 'Doença celíaca',
  'K90.9': 'Má absorção intestinal',
  'K92.2': 'Hemorragia gastrointestinal',
  'P92.1': 'Regurgitação do recém-nascido',
  R10: 'Dor abdominal',
  'R10.1': 'Dor no abdome superior',
  'R10.4': 'Dor abdominal',
  R11: 'Náusea e vômitos',
  R14: 'Flatulência e distensão abdominal',
  'R62.8': 'Atraso no desenvolvimento esperado',
  'R63.3': 'Dificuldade de alimentação',
  'T78.1': 'Reação de intolerância alimentar',
}

/**
 * Deixa o código na forma da tabela: maiúsculo, sem espaço e com ponto.
 * A vírgula aparece bastante ("K59,0") porque o teclado numérico do Brasil
 * tem vírgula, e o código não seria encontrado por causa disso.
 */
function normalizar(codigo: string): string {
  return codigo.trim().toUpperCase().replace(/\s+/g, '').replace(/,/g, '.')
}

/**
 * O nome da doença, ou o próprio código quando ele não está em lugar nenhum.
 *
 * A busca tem quatro degraus, do mais bonito ao mais bruto:
 *
 *  1. NOMES, com o código exato. São os do dia a dia da clínica, escritos com
 *     acento e em português de gente.
 *  2. TABELA, com o código exato. A tabela do DATASUS, capítulos K e R, sem
 *     acento e em caixa alta, como o Ministério publica.
 *  3. e 4. Os mesmos dois, agora pela categoria de três caracteres: quem
 *     escreve "K21.9" recebe "Refluxo gastroesofágico" mesmo que a subdivisão
 *     exata não esteja escrita.
 *
 * Sem nada disso, devolve o próprio código. Melhor "Z99.9" na tela do que uma
 * doença inventada.
 *
 * Até 15/09/2026 só existia o degrau 1, e o painel mostrava "K59" e "R10" crus
 * porque o dicionário tinha "K59.0" e "R10.4", mas não as categorias.
 */
export function nomeDoCid(codigo: string): string {
  const limpo = normalizar(codigo)
  if (!limpo) return ''
  const categoria = limpo.slice(0, 3)
  return NOMES[limpo] ?? TABELA[limpo] ?? NOMES[categoria] ?? TABELA[categoria] ?? limpo
}
