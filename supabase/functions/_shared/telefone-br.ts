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

/**
 * Celular sem o nono digito ganha o 9; o resto volta so com os digitos
 * (16/10/2026).
 *
 * Um paciente de Santos foi cadastrado com o celular em 8 digitos, sem o 9
 * (o repositorio e publico: o numero dele nao vai aqui). O sistema mandava
 * para "55 13 + 8 digitos" e a Meta devolvia "Message undeliverable": os
 * acompanhamentos de 01/10 e de 16/10 falharam.
 *
 * Desde 2016 todo celular brasileiro tem 9 digitos, entao 8 digitos comecando
 * por 6 a 9 e celular faltando o 9, nunca outro numero. Com o 9, a Meta acha
 * tambem a conta antiga que ela identifica sem ele; sem o 9, a conta nova nao
 * existe. O 55 fica como veio: o cadastro grava o que a equipe digitou.
 */
export function comNonoDigito(numero: string): string {
  const digitos = String(numero ?? '').replace(/\D/g, '')
  const comPais = digitos.startsWith('55') && digitos.length >= 12
  const semPais = comPais ? digitos.slice(2) : digitos
  if (semPais.length !== 10 || !/^[6-9]/.test(semPais.slice(2))) return digitos
  return `${comPais ? '55' : ''}${semPais.slice(0, 2)}9${semPais.slice(2)}`
}

/**
 * O numero para mandar a Meta: 55 + DDD + celular com o 9.
 *
 * Antes era so "55 na frente se nao tiver", e isso tambem errava o DDD 55
 * (Santa Maria, RS): "55991234567" ja comecava por 55 e saia sem o codigo do
 * pais. Agora o 55 so e codigo do pais quando sobram 12 ou 13 digitos.
 */
export function paraEnvio(numero: string): string {
  const digitos = comNonoDigito(numero)
  return digitos.startsWith('55') && digitos.length >= 12 ? digitos : `55${digitos}`
}

/** Os dois numeros sao o mesmo telefone? */
export function mesmoTelefone(a: string, b: string): boolean {
  const deA = new Set(variantesDoTelefone(a))
  return variantesDoTelefone(b).some((v) => deA.has(v))
}
