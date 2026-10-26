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
export const CODIGO_SEM_LICENCA = 'SEM_LICENCA'

export function licencaDaAssinatura(ler: (nome: string) => string | undefined): boolean {
  return SEGREDOS_DA_LICENCA.every((nome) => Boolean(ler(nome)?.trim()))
}

/**
 * A tela pergunta { acao: 'licenca' } a assinar-consulta para saber se mostra o
 * lembrete de "atendimentos sem assinatura" (26/10/2026: sem o modulo, o
 * lembrete so cobraria o que nao da para fazer). Esta funcao le o erro que o
 * supabase-js devolveu para essa pergunta:
 *
 *   sem erro            -> ha licenca;
 *   SEM_LICENCA         -> nao ha;
 *   qualquer outra coisa (rede, servidor fora) -> lanca: dai nao da para
 *   afirmar nem uma coisa nem outra.
 */
export async function licencaPelaResposta(erro: unknown): Promise<boolean> {
  if (!erro) return true
  const contexto = (erro as { context?: unknown }).context
  if (contexto instanceof Response) {
    const corpo = await contexto.clone().json().catch(() => null)
    if (corpo?.code === CODIGO_SEM_LICENCA) return false
  }
  throw erro
}
