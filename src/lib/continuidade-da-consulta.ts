/**
 * O que uma consulta nova herda das anteriores (25/09/2026).
 *
 * Alergia, antecedentes e medicamentos em uso sao do PACIENTE, nao do dia. O
 * medico escrevia tudo na primeira consulta e, no retorno, o formulario abria
 * em branco: ou ele reescrevia, ou o campo ficava vazio e o prontuario daquele
 * dia dizia "sem alergias" por omissao. Foi o mesmo furo que deixava a Memed
 * sem a alergia no retorno (ver dados-para-memed.ts).
 *
 * Cada campo vem da consulta mais recente que o tem preenchido - antecedentes
 * podem estar so na primeira, medicamentos na ultima. So preenche campo VAZIO:
 * o que o medico ja escreveu hoje nunca e sobrescrito. E a tela mostra de onde
 * veio cada um, com um botao para desfazer, porque texto que aparece sozinho
 * precisa ser conferido antes de virar documento assinado.
 *
 * Peso e altura NAO vem: sao medidas do dia. Herdar o peso de dois meses atras
 * num retorno faria a curva de crescimento mentir.
 */

export const CAMPOS_QUE_CONTINUAM = [
  'alergias',
  'antecedentesPessoais',
  'antecedentesFamiliares',
  'medicamentos',
] as const

export type CampoQueContinua = (typeof CAMPOS_QUE_CONTINUAM)[number]

export const ROTULO_DO_CAMPO: Record<CampoQueContinua, string> = {
  alergias: 'Alergias',
  antecedentesPessoais: 'Antecedentes pessoais',
  antecedentesFamiliares: 'Antecedentes familiares',
  medicamentos: 'Medicamentos em uso',
}

export type ConsultaAnterior = {
  id: string
  data: string // YYYY-MM-DD
  criadoEm?: string
} & Record<CampoQueContinua, string>

export type Heranca = {
  campo: CampoQueContinua
  valor: string
  data: string
}

/** HTML do editor sem texto de verdade ("<p><br></p>") conta como vazio. */
export function temConteudo(texto: string | null | undefined): boolean {
  return (
    String(texto ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|\u00a0/gi, ' ')
      .trim().length > 0
  )
}

/**
 * O que herdar para a consulta `atualId` (null = consulta nova), considerando
 * so consultas ate `hoje` - consulta futura, marcada pela Agenda e ainda em
 * branco, nao e historico.
 */
export function herancaDasAnteriores(
  consultas: ConsultaAnterior[],
  atualId: string | null,
  hoje: string,
): Heranca[] {
  const anteriores = consultas
    .filter((c) => c.id !== atualId && c.data && c.data.slice(0, 10) <= hoje.slice(0, 10))
    .sort((a, b) => b.data.localeCompare(a.data) || String(b.criadoEm ?? '').localeCompare(String(a.criadoEm ?? '')))

  const heranca: Heranca[] = []
  for (const campo of CAMPOS_QUE_CONTINUAM) {
    const fonte = anteriores.find((c) => temConteudo(c[campo]))
    if (fonte) heranca.push({ campo, valor: fonte[campo], data: fonte.data })
  }
  return heranca
}

/**
 * Aplica a heranca num formulario, so nos campos vazios. Devolve o formulario
 * novo e o que de fato entrou (para a tela mostrar e poder desfazer).
 */
export function aplicarHeranca<F extends Record<CampoQueContinua, string>>(
  formulario: F,
  heranca: Heranca[],
): { formulario: F; aplicada: Heranca[] } {
  const aplicada = heranca.filter((h) => !temConteudo(formulario[h.campo]))
  if (!aplicada.length) return { formulario, aplicada }
  const novo = { ...formulario }
  for (const h of aplicada) novo[h.campo] = h.valor as F[CampoQueContinua]
  return { formulario: novo, aplicada }
}

/**
 * Desfaz a heranca campo a campo, mas so onde o texto continua exatamente o
 * herdado: se o medico ja editou o campo, o que ele escreveu fica.
 */
export function desfazerHeranca<F extends Record<CampoQueContinua, string>>(
  formulario: F,
  aplicada: Heranca[],
): F {
  const novo = { ...formulario }
  for (const h of aplicada) {
    if (novo[h.campo] === h.valor) novo[h.campo] = '' as F[CampoQueContinua]
  }
  return novo
}
