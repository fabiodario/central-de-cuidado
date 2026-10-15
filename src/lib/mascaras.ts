/**
 * Mascaras de digitacao do cadastro (pedido em 23/09/2026).
 *
 * O repositorio e PUBLICO: exemplo aqui e sempre numero inventado. Ate
 * 24/09/2026 este comentario trazia CPF e celular de verdade.
 *
 * So mudam o que aparece no campo. O repositorio tira tudo que nao e digito
 * antes de gravar (createPatient/updatePatient), entao o banco continua com
 * "11987654321" e "12345678901" - que e o que o robo, a Memed e a busca por
 * telefone esperam.
 *
 * Telefone com 55 na frente (veio do WhatsApp) mantem o 55, como "+55 ...":
 * cortar o codigo do pais aqui mudaria o numero gravado na proxima vez que
 * alguem salvasse a ficha, sem ninguem ter pedido.
 */

function digitos(valor: string) {
  return String(valor ?? '').replace(/\D/g, '')
}

/** (11) 9 8765-4321 para celular, (11) 3456-7890 para fixo. */
export function mascararTelefone(valor: string): string {
  const todos = digitos(valor).slice(0, 13)
  const comPais = todos.length > 11 && todos.startsWith('55')
  const d = comPais ? todos.slice(2) : todos.slice(0, 11)
  const prefixo = comPais ? '+55 ' : ''

  let corpo: string
  if (d.length === 0) corpo = ''
  else if (d.length <= 2) corpo = `(${d}`
  else if (d.length <= 6) corpo = `(${d.slice(0, 2)}) ${d.slice(2)}`
  else if (d.length <= 10) corpo = `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  else corpo = `(${d.slice(0, 2)}) ${d.slice(2, 3)} ${d.slice(3, 7)}-${d.slice(7)}`
  return prefixo + corpo
}

/** 123.456.789-01 */
export function mascararCpf(valor: string): string {
  const d = digitos(valor).slice(0, 11)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

/**
 * Aplica a mascara a uma edicao, sem prender o backspace.
 *
 * Sem isto, apagar um separador ("-", ")", ".") nao fazia nada: o separador
 * sumia, a mascara o recolocava, e o cursor ficava parado ali. Se o texto
 * encolheu mas os digitos sao os mesmos, a pessoa apagou um separador - entao
 * o digito antes dele vai junto.
 */
export function editarComMascara(anterior: string, novo: string, mascara: (v: string) => string): string {
  const dNovo = digitos(novo)
  if (novo.length < anterior.length && dNovo === digitos(anterior)) {
    return mascara(dNovo.slice(0, -1))
  }
  return mascara(dNovo)
}
