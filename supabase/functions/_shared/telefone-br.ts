/**
 * Os jeitos de escrever o mesmo celular brasileiro (25/09/2026).
 *
 * O WhatsApp de numeros antigos ainda identifica muita gente SEM o nono
 * digito: o celular (13) 9 9123-4567 chega da Meta como 551391234567, com 12
 * digitos. O cadastro guarda 13991234567. Comparando os dois como texto, nao
 * batem - a mensagem caia como "Contato sem cadastro", e o lembrete, enviado
 * para o numero do cadastro, abria uma SEGUNDA conversa para a mesma pessoa.
 *
 * Esta funcao devolve todas as grafias do numero: com e sem o 55 do pais, com
 * e sem o nove. Quem procura paciente ou conversa usa a lista inteira.
 *
 * So mexe no nove de CELULAR: numero local de 8 digitos comecando por 6 a 9
 * (a faixa dos celulares antes do nono digito), ou de 9 digitos comecando por
 * 9. Fixo (2 a 5 na frente) nunca ganha nem perde digito.
 */
export function variantesDoTelefone(numero: string): string[] {
  const digitos = String(numero ?? '').replace(/\D/g, '')
  if (!digitos) return []

  const semPais = digitos.startsWith('55') && digitos.length >= 12 ? digitos.slice(2) : digitos
  const variantes = new Set<string>([digitos, semPais, `55${semPais}`])

  // DDD (2) + numero local (8 ou 9).
  if (semPais.length === 10 || semPais.length === 11) {
    const ddd = semPais.slice(0, 2)
    const local = semPais.slice(2)
    let outro: string | null = null
    if (local.length === 8 && /^[6-9]/.test(local)) outro = `${ddd}9${local}`
    if (local.length === 9 && local.startsWith('9') && /^[6-9]/.test(local.slice(1))) outro = `${ddd}${local.slice(1)}`
    if (outro) {
      variantes.add(outro)
      variantes.add(`55${outro}`)
    }
  }
  return [...variantes].filter((v) => v.length >= 8)
}

/** Os dois numeros sao o mesmo telefone? */
export function mesmoTelefone(a: string, b: string): boolean {
  const deA = new Set(variantesDoTelefone(a))
  return variantesDoTelefone(b).some((v) => deA.has(v))
}
