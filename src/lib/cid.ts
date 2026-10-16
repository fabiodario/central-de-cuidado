/**
 * Nome da doenca a partir do codigo do CID-10.
 *
 * No cadastro o medico digita o codigo ("J34.2"), que e o que vale no
 * documento. Mas num grafico de "mais frequentes" o codigo nao informa nada:
 * quem le o painel precisa saber que aquilo e desvio de septo, nao decorar a
 * tabela. Aqui fica a traducao.
 *
 * O dicionario e parcial de proposito - cobre o que aparece na rotina do
 * otorrino. Codigo que nao estiver na lista continua aparecendo como codigo,
 * nunca some nem vira "desconhecido". Para incluir um novo, basta acrescentar
 * a linha.
 *
 * Espelho do Dr. Fabio Dario (15/10/2026): a lista veio da gastropediatria do
 * Dr. Marcello (refluxo, constipacao, colite...) e o painel do otorrino ia
 * mostrar "J34.2" cru. Cada codigo abaixo foi conferido na CID-10 do DATASUS
 * (versao 2008), descricao e notas de inclusao: o nome curto diz o mesmo que
 * o oficial, em palavras de consultorio. O teste confere que todo codigo
 * daqui existe na tabela oficial (cid-tabela.ts), para nenhum erro de
 * digitacao virar diagnostico.
 *
 * Atras dele, como rede, vem a tabela do DATASUS (cid-tabela.ts). Os nomes
 * daqui ganham dela por serem curtos e na grafia de hoje ("Apneia do sono", e
 * nao "Apneia de sono" com o acento de 2008); a tabela cobre os outros
 * seiscentos codigos dos mesmos capitulos.
 */
import { TABELA } from './cid-tabela'

// Exportado para o teste conferir cada codigo contra a tabela oficial.
export const NOMES: Record<string, string> = {
  // Nariz e seios da face
  J00: 'Resfriado comum',
  J01: 'Sinusite aguda',
  'J01.0': 'Sinusite maxilar aguda',
  'J01.9': 'Sinusite aguda',
  J30: 'Rinite alérgica ou vasomotora',
  'J30.0': 'Rinite vasomotora',
  'J30.3': 'Rinite alérgica',
  'J30.4': 'Rinite alérgica',
  'J31.0': 'Rinite crônica',
  J32: 'Sinusite crônica',
  'J32.0': 'Sinusite maxilar crônica',
  'J32.4': 'Pansinusite crônica',
  'J32.9': 'Sinusite crônica',
  J33: 'Pólipo nasal',
  'J33.9': 'Pólipo nasal',
  'J34.2': 'Desvio do septo nasal',
  'J34.3': 'Hipertrofia dos cornetos nasais',
  'M95.0': 'Deformidade adquirida do nariz',
  'Q30.0': 'Atresia de coanas',
  'R04.0': 'Epistaxe (sangramento nasal)',
  'R43.0': 'Perda do olfato (anosmia)',
  'R43.8': 'Alteração do olfato ou do paladar',
  'S02.2': 'Fratura do nariz',
  'T17.1': 'Corpo estranho no nariz',

  // Garganta, boca e glandulas salivares
  'J02.9': 'Faringite aguda',
  J03: 'Amigdalite aguda',
  'J03.9': 'Amigdalite aguda',
  'J35.0': 'Amigdalite crônica',
  'J35.1': 'Hipertrofia das amígdalas',
  'J35.2': 'Hipertrofia das adenoides',
  'J35.3': 'Hipertrofia das amígdalas e das adenoides',
  J36: 'Abscesso periamigdaliano',
  'K11.2': 'Inflamação de glândula salivar',
  'K11.5': 'Cálculo de glândula salivar',
  'R07.0': 'Dor de garganta',
  R13: 'Dificuldade para engolir (disfagia)',

  // Laringe e voz
  'J04.0': 'Laringite aguda',
  'J37.0': 'Laringite crônica',
  'J38.0': 'Paralisia de prega vocal',
  'J38.1': 'Pólipo de prega vocal',
  'J38.2': 'Nódulo de prega vocal',
  'J38.3': 'Outras doenças de prega vocal',
  'Q31.5': 'Laringomalácia',
  'R49.0': 'Rouquidão (disfonia)',

  // Ouvido
  H60: 'Otite externa',
  'H60.3': 'Otite externa',
  'H60.9': 'Otite externa',
  'H61.2': 'Rolha de cera',
  'H65.0': 'Otite média serosa aguda',
  'H65.2': 'Otite média serosa crônica',
  'H65.3': 'Otite média secretora crônica',
  'H65.9': 'Otite média não supurativa',
  H66: 'Otite média',
  'H66.0': 'Otite média aguda supurada',
  'H66.1': 'Otite média crônica supurada',
  'H66.3': 'Otite média crônica supurada',
  'H66.9': 'Otite média',
  'H68.1': 'Obstrução da tuba auditiva',
  H71: 'Colesteatoma',
  H72: 'Perfuração do tímpano',
  'H72.9': 'Perfuração do tímpano',
  H80: 'Otosclerose',
  'H80.9': 'Otosclerose',
  'H81.0': 'Doença de Ménière',
  'H81.1': 'Vertigem posicional paroxística benigna',
  'H81.2': 'Neurite vestibular',
  'H81.9': 'Distúrbio vestibular',
  'H83.0': 'Labirintite',
  'H83.3': 'Perda auditiva por ruído',
  H90: 'Perda auditiva',
  'H90.0': 'Perda auditiva condutiva bilateral',
  'H90.2': 'Perda auditiva condutiva',
  'H90.3': 'Perda auditiva neurossensorial bilateral',
  'H90.5': 'Perda auditiva neurossensorial',
  'H91.1': 'Presbiacusia',
  'H91.2': 'Surdez súbita',
  'H91.9': 'Perda auditiva',
  'H92.0': 'Dor de ouvido (otalgia)',
  'H92.1': 'Secreção no ouvido (otorreia)',
  'H93.1': 'Zumbido',
  'Q17.5': 'Orelha em abano',
  T16: 'Corpo estranho no ouvido',

  // Sono, tontura e nervo facial
  'G47.3': 'Apneia do sono',
  'R06.5': 'Ronco e respiração pela boca',
  R42: 'Tontura',
  'G51.0': 'Paralisia facial (de Bell)',
  'J06.9': 'Infecção aguda de vias aéreas superiores',
}

/**
 * Deixa o codigo na forma da tabela: maiusculo, sem espaco e com ponto.
 * A virgula aparece bastante ("J34,2") porque o teclado numerico do Brasil
 * tem virgula, e o codigo nao seria encontrado por causa disso.
 */
function normalizar(codigo: string): string {
  return codigo.trim().toUpperCase().replace(/\s+/g, '').replace(/,/g, '.')
}

/**
 * O nome da doenca, ou o proprio codigo quando ele nao esta em lugar nenhum.
 *
 * A busca tem quatro degraus, do mais bonito ao mais bruto:
 *
 *  1. NOMES, com o codigo exato. Sao os do dia a dia da clinica, curtos e em
 *     portugues de gente.
 *  2. TABELA, com o codigo exato. A tabela do DATASUS, com a descricao
 *     oficial, como o site do Ministerio publica.
 *  3. e 4. Os mesmos dois, agora pela categoria de tres caracteres: quem
 *     escreve "J32.01", com um digito a mais, recebe "Sinusite cronica"
 *     mesmo que o codigo exato nao exista.
 *
 * Sem nada disso, devolve o proprio codigo. Melhor "Z99.9" na tela do que uma
 * doenca inventada.
 *
 * Ate 15/09/2026 so existia o degrau 1, e o painel mostrava "K59" e "R10" crus
 * porque o dicionario tinha "K59.0" e "R10.4", mas nao as categorias.
 */
export function nomeDoCid(codigo: string): string {
  const limpo = normalizar(codigo)
  if (!limpo) return ''
  const categoria = limpo.slice(0, 3)
  return NOMES[limpo] ?? TABELA[limpo] ?? NOMES[categoria] ?? TABELA[categoria] ?? limpo
}
