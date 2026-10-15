/**
 * Escolha do telefone da clínica para sistemas que validam o número.
 *
 * Em Preferências há dois campos (fixo e WhatsApp), e quase todo lugar imprime
 * os dois. A Memed não: o campo dela é um só e passa por validação, então
 * "3273-6828 / 99681-1279" é recusado inteiro, e o fixo de 10 dígitos foi
 * recusado no teste de 16/09/2026 com "Informe seu telefone".
 *
 * Por isso a preferência é pelo celular: 11 dígitos passam em qualquer
 * validação brasileira, e é o número que já está no site e na bio do Instagram
 * - quem lê a receita e liga cai no mesmo lugar de sempre.
 */
export function telefoneValidavel(...numeros: (string | null | undefined)[]): string | undefined {
  const digitos = numeros
    .flatMap((numero) => (numero ?? '').split(/[/;,]|\se\s/))
    .map((parte) => parte.replace(/\D/g, ''))
    .filter((parte) => parte.length >= 10)

  return digitos.find((numero) => numero.length === 11) ?? digitos[0]
}
