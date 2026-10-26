/**
 * Assinatura digital ICP-Brasil como modulo a parte (26/10/2026).
 *
 * O Edu: a assinatura com validade ICP-Brasil vai ser um modulo que o
 * contratante leva se quiser. Clinica sem o modulo nao tem as chaves da BRy nem
 * o CPF do certificado, e o botao "Assinar digitalmente" mostrava o primeiro
 * segredo que faltasse ("CPF do certificado não configurado."), que soa como
 * defeito do sistema. Agora a resposta e uma so: a licenca nao esta configurada.
 *
 * A licenca e ter os tres segredos de que a assinatura depende. Faltando
 * qualquer um, nao ha como assinar, entao a funcao para antes de ler o banco ou
 * chamar a BRy.
 */
export const SEGREDOS_DA_LICENCA = ['BRY_CLIENT_ID', 'BRY_CLIENT_SECRET', 'BRY_CPF_MEDICO'] as const

export const LICENCA_NAO_CONFIGURADA = 'Licença não configurada.'

export function licencaDaAssinatura(ler: (nome: string) => string | undefined): boolean {
  return SEGREDOS_DA_LICENCA.every((nome) => Boolean(ler(nome)?.trim()))
}
