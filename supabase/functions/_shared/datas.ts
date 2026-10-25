/**
 * Data de nascimento digitada pela familia, convertida para o formato do banco.
 *
 * Existe desde 22/09/2026. Uma mae respondeu a ficha com "25/07/23" e o
 * cadastro saiu SEM data de nascimento: as duas leituras que havia (a ficha e o
 * cadastro criado na vespera) so aceitavam ano com quatro digitos. E sem data
 * de nascimento a Memed recusa a receita - o medico so descobriria com a
 * crianca na frente dele.
 *
 * Uma leitura so, usada pelos dois lugares, para que a regra nao divirja de
 * novo.
 *
 * Devolve null quando nao da para ter certeza. "marco de 2019" continua no
 * agendamento, escrito como veio, para alguem da equipe ler: uma data inventada
 * no prontuario e pior do que um campo vazio.
 */
const MESES: Record<string, number> = {
  janeiro: 1, jan: 1, fevereiro: 2, fev: 2, marco: 3, mar: 3, abril: 4, abr: 4, maio: 5, mai: 5,
  junho: 6, jun: 6, julho: 7, jul: 7, agosto: 8, ago: 8, setembro: 9, set: 9, outubro: 10, out: 10,
  novembro: 11, nov: 11, dezembro: 12, dez: 12,
}

/**
 * A data dentro do que a familia escreveu (14/10/2026).
 *
 * O painel de familias simuladas mostrou dois jeitos comuns que se perdiam: o
 * mes por extenso ("12 de março de 2020") e a data no meio da frase
 * ("nasceu 03/05/2022", "ja falei kkk 03/05/2022"). Os dois eram aceitos na
 * ficha e o cadastro saia sem data, com o robo dizendo "cadastro feito".
 *
 * Mais de uma data na mesma frase: nenhuma. Escolher uma seria chutar.
 */
function partesDaData(texto: string): [string, string, string] | null {
  const t = texto.trim()
  const exata = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
  if (exata) return [exata[1], exata[2], exata[3]]
  // "02022024" e "020224", sem barra (17/10/2026, painel com IA): o cadastro
  // nascia sem data e o robo seguia como se estivesse tudo certo. So a mensagem
  // inteira: numero solto no meio de uma frase pode ser outra coisa.
  const colada = t.match(/^(\d{2})(\d{2})(\d{4}|\d{2})$/)
  if (colada) return [colada[1], colada[2], colada[3]]
  // "12 3 2019", com espaco no lugar da barra (rodada 7 do painel: a data nao
  // era aceita e o robo pedia de novo). So a mensagem inteira e com o ano de
  // quatro digitos: "2 3 18" no meio de uma frase pode ser qualquer conta.
  // Ano de dois digitos tambem, mas so a mensagem inteira (rodada 9: "3 4 24").
  const espacada = t.replace(/[.!]+$/, '').match(/^(\d{1,2})\s+(\d{1,2})\s+(\d{4}|\d{2})$/)
  if (espacada) return [espacada[1], espacada[2], espacada[3]]

  // Ponto final depois do ano vale ("nasceu em 03/02/2020."): so recusa o ponto
  // seguido de numero, que seria outra data colada (rodada 5 do painel).
  const numericas = [...t.matchAll(/(?:^|[^\d/.-])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\d/-]|\.\d)/g)]
  // Com espaco, no meio da frase (rodada 8 do painel): "12 1 2023. mas o nome
  // dela eh maria luisa" e "lara souza lima nasceu 12 03 2019" fechavam o
  // cadastro sem data. So com o ano inteiro de 19xx ou 20xx.
  // O ponto final depois do ano vale (rodada 9: "nascido em 03 09 2019." dava
  // zero datas); so o ponto seguido de numero, que seria outra data, nao.
  const espacadas = [...t.matchAll(/(?:^|[^\d/.-])(\d{1,2})\s+(\d{1,2})\s+((?:19|20)\d{2})(?![\d/-]|\.\d|\s+\d)/g)]
  const normal = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const porExtenso = [
    ...normal.matchAll(
      // "2 d julho de 2020" (rodada 9): o "d" no lugar do "de".
      /\b(\d{1,2})\s*(?:de\s+|d\s+|\/\s*|-\s*)?(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\.?\s*(?:de\s+|d\s+|\/\s*|-\s*)?(\d{4})\b/g,
    ),
  ]
  if (numericas.length + espacadas.length + porExtenso.length !== 1) return null
  if (numericas.length === 1) return [numericas[0][1], numericas[0][2], numericas[0][3]]
  if (espacadas.length === 1) return [espacadas[0][1], espacadas[0][2], espacadas[0][3]]
  return [porExtenso[0][1], String(MESES[porExtenso[0][2]]), porExtenso[0][3]]
}

/**
 * Dia e mes sem o ano ("31 de agosto", "31/08"), como "DD/MM" (17/10/2026).
 *
 * No painel com IA a mae de um bebe de 7 semanas respondeu "31 de agosto" e o
 * cadastro saiu sem data. O ano nao se adivinha: o robo pergunta so o ano e
 * junta com o que ja veio. Vindo do sistema do Dr. Marcello (25/10/2026).
 */
export function diaEMesSemAno(texto: string): string | null {
  const t = texto.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.!]+$/, '')
  const numerica = t.match(/^(\d{1,2})\s*[/.-]\s*(\d{1,2})$/)
  // "Ele nasceu dia 15 de julho" (rodada 8): no meio da frase, so com "de" e o
  // mes inteiro, e sem ano nenhum na mensagem.
  const porExtenso =
    t.match(/^(?:dia\s+)?(\d{1,2})\s*(?:de\s+|\/\s*|-\s*)?([a-z]+)$/) ??
    (/\b(19|20)\d{2}\b/.test(t)
      ? null
      : t.match(/\b(\d{1,2})\s+de?\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/))
  const dia = Number(numerica?.[1] ?? porExtenso?.[1])
  const mes = numerica ? Number(numerica[2]) : porExtenso ? MESES[porExtenso[2]] : undefined
  if (!dia || !mes || dia > 31 || mes > 12) return null
  return `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}`
}

export function dataDeNascimentoIso(
  texto: string,
  hoje = new Date(),
  /**
   * Paciente que pode ser adulto (15/10/2026, perfil 'geral' do Dr. Fabio,
   * otorrino). Ai "15/03/85" e 1985: quem escreve o ano com dois digitos e
   * quase sempre o proprio paciente, adulto. Sem a opcao, a regra pediatrica.
   */
  opcoes: { adulto?: boolean } = {},
): string | null {
  const m = partesDaData(texto)
  if (!m) return null

  const dia = Number(m[0])
  const mes = Number(m[1])
  let ano = Number(m[2])

  // Ano com dois digitos. Isto e uma clinica de pediatria e a data e da
  // CRIANCA: "23" so pode ser 2023. Um ano de dois digitos maior que o atual
  // ("30" em 2026) seria 1930 - impossivel para um paciente daqui, e por isso
  // fica sem data em vez de virar um idoso no prontuario.
  if (m[2].length === 2) {
    const anoAtual = hoje.getFullYear() % 100
    if (ano > anoAtual) {
      if (!opcoes.adulto) return null
      ano += 1900
    } else {
      ano += 2000
    }
  }

  if (mes < 1 || mes > 12 || dia < 1) return null
  // Dia que existe naquele mes: 31/02 nao vira 03/03 por arredondamento.
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate()
  if (dia > ultimoDia) return null

  const iso = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
  // Nascimento no futuro e erro de digitacao, nunca dado.
  const hojeIso = hoje.toISOString().slice(0, 10)
  if (iso > hojeIso) return null

  return iso
}
