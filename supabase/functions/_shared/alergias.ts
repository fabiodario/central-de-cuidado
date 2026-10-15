/**
 * Alergias do prontuario para o "Alerta de Alergias" da Memed (24/09/2026).
 *
 * Ate aqui o comentario de abrirPrescricao dizia que as alergias iam junto com
 * o paciente, e nao iam: o setPaciente da Memed nem tem esse campo. O alerta so
 * dispara com o comando setAllergy, que recebe NUMEROS - o id de cada principio
 * ativo na tabela deles (dipirona = 622, amoxicilina = 174...). O medico escreve
 * texto livre ("Alergia a amoxicilina e dipirona"), entao alguem precisa fazer o
 * de/para. E este arquivo.
 *
 * A regra de ouro e nao inventar: um principio ativo errado no alerta e pior do
 * que nenhum, porque da ao medico uma seguranca que nao existe. Por isso so vale
 * nome IGUAL ao que foi escrito (ou o mesmo nome com complemento, como "dipirona
 * sodica"), e tudo o que nao casou volta para a tela como "nao reconhecido", para
 * o medico ver - nunca some calado.
 *
 * Alergia alimentar (APLV, ovo, amendoim), que e comum na gastro pediatrica, nao
 * existe na tabela de remedios da Memed. Ela aparece como nao reconhecida, e e o
 * certo: nao ha o que alertar numa receita.
 */

/** Sem acento, minusculo, espacos simples. "Alérgico à Dipirona" -> "alergico a dipirona". */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// Um pedaco que so diz "nao tem". Ancorado no comeco: "nega" no meio de uma
// frase ("paciente nega febre") nao e o assunto aqui, mas no comeco do campo de
// alergias e sempre "nega alergias".
const SEM_ALERGIA =
  /^(nega|negam|negado|negada|nenhuma|nenhum|nao|sem alergia|sem alergias|nada consta|desconhece|desconhecida|desconhecidas|ausente|ausentes|nkda|nda|n\.d\.a)\b/

// "alergia a", "alergico ao", "intolerancia a"... o que vem antes do nome.
const PREFIXO =
  /^(alergias?|alergicos?|alergicas?|intolerancias?|reacao|reacoes|hipersensibilidade)( (medicamentosas?|alimentar(es)?))?( (a|ao|aos|as|com|por))? /

const SO_TITULO =
  /^(alergias?|alergicos?|alergicas?|medicamentosas?|alimentar(es)?|alergias? medicamentosas?|alergias? alimentar(es)?)$/

/** Maximo de termos consultados: cada um e uma chamada a Memed. */
export const MAXIMO_DE_TERMOS = 10

/**
 * Os nomes que o medico escreveu no campo de alergias.
 *
 * semAlergia so e verdadeiro quando o campo DIZ que nao ha alergia ("Nega",
 * "Nenhuma conhecida"). Campo vazio e outra coisa - nao foi perguntado - e volta
 * com semAlergia falso e lista vazia.
 */
export function termosDeAlergia(bruto: string): { termos: string[]; semAlergia: boolean } {
  const texto = normalizar(
    String(bruto ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\n/g, ';'),
  )
    // "N.D.A." e "nada digno de alergia": junta antes de o ponto virar separador.
    .replace(/\bn\.? ?d\.? ?a\b\.?/g, 'nda')
  if (!texto) return { termos: [], semAlergia: false }

  const partes = texto
    .replace(/\([^)]*\)/g, ' ')
    .split(/[,;/+.:]| e | ou | - /)
    .map((parte) => parte.trim())
    .filter(Boolean)

  const termos: string[] = []
  let negacoes = 0
  for (const parte of partes) {
    if (SEM_ALERGIA.test(parte)) {
      negacoes++
      continue
    }
    let termo = parte
    // Duas voltas: "alergia medicamentosa a" e depois um "a" solto que sobrou.
    for (let i = 0; i < 2; i++) termo = termo.replace(PREFIXO, '').replace(/^(a|ao|aos|as) /, '').trim()
    // "Alergias:" sozinho, como titulo antes da lista, nao e alergia a nada.
    if (SO_TITULO.test(termo)) continue
    if (termo.length >= 3 && !termos.includes(termo)) termos.push(termo)
  }

  return {
    termos: termos.slice(0, MAXIMO_DE_TERMOS),
    semAlergia: termos.length === 0 && negacoes > 0,
  }
}

export type Ingrediente = { id: number; nome: string }

/**
 * Quais principios ativos da busca da Memed correspondem ao termo escrito.
 *
 * Nome igual ganha sozinho. Sem igual, valem os que COMECAM pelo termo seguido
 * de espaco ("dipirona" -> "dipirona sodica", "dipirona monoidratada"), ate
 * tres. Nada de "contem": "penicilina" dentro de "benzilpenicilina" parece
 * certo, mas e o tipo de palpite que a regra de ouro proibe.
 */
export function escolherIngredientes(termo: string, candidatos: Ingrediente[]): Ingrediente[] {
  const alvo = normalizar(termo)
  if (!alvo) return []
  const validos = candidatos.filter((c) => Number.isFinite(c.id) && c.nome)
  const igual = validos.filter((c) => normalizar(c.nome) === alvo)
  if (igual.length) return igual.slice(0, 1)
  return validos.filter((c) => normalizar(c.nome).startsWith(`${alvo} `)).slice(0, 3)
}

/**
 * Segunda tentativa para termo composto: "amoxicilina com clavulanato" nao e
 * nome de principio ativo, mas "amoxicilina" e. So a primeira palavra, e so se
 * ela for longa o bastante para nao ser generica ("acido", "sulfato" ficariam
 * de fora por ter menos de 6 letras ou por serem so o comeco de muitos nomes -
 * o casamento exato de escolherIngredientes cuida do resto).
 */
export function primeiraPalavra(termo: string): string | null {
  const palavras = normalizar(termo).split(' ')
  if (palavras.length < 2) return null
  return palavras[0].length >= 6 ? palavras[0] : null
}

/**
 * A resposta da busca de principios ativos da Memed, lida sem confiar no
 * formato: o id vem como texto no JSON:API, e o nome ja apareceu como "name" e
 * como "nome" em rotas diferentes deles.
 */
export function lerIngredientes(corpo: unknown): Ingrediente[] {
  const lista = (corpo as { data?: unknown })?.data
  if (!Array.isArray(lista)) return []
  return lista
    .map((item) => {
      const registro = item as { id?: unknown; attributes?: { name?: unknown; nome?: unknown } }
      return {
        id: Number(registro?.id),
        nome: String(registro?.attributes?.name ?? registro?.attributes?.nome ?? ''),
      }
    })
    .filter((c) => Number.isFinite(c.id) && c.id > 0 && c.nome)
}
