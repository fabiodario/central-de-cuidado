/**
 * Mais uma tentativa quando a Meta falha do lado dela (26/10/2026, vindo do
 * sistema do Dr. Marcello no mesmo dia).
 *
 * La, um menu mandado pela Central voltou "(#131000) Something went wrong". O
 * mesmo menu, com o mesmo texto, tinha chegado a duas familias nos dias
 * anteriores, e foi a unica falha de envio em tres dias: 131000 e erro
 * interno da Meta, e a propria documentacao manda tentar de novo. Uma
 * tentativa a mais, segundo e meio depois, resolve sem a equipe precisar ver
 * o "falhou" e clicar outra vez.
 *
 * So nos erros passageiros. Recusa de verdade (janela de 24 horas fechada,
 * numero invalido, modelo nao aprovado) nao melhora repetindo. E a recusa vem
 * antes de a Meta aceitar a mensagem, entao a segunda tentativa nao duplica
 * nada.
 */

/** 131000 erro interno; 131016 servico fora; 133004 servidor indisponivel por um momento. */
export const ERROS_PASSAGEIROS: readonly number[] = [131000, 131016, 133004]
export const ESPERA_DA_NOVA_TENTATIVA_MS = 1500

export async function postarNaMeta(
  url: string,
  init: RequestInit,
  opcoes: { buscar?: typeof fetch; esperar?: (ms: number) => Promise<void> } = {},
): Promise<Response> {
  const buscar = opcoes.buscar ?? fetch
  const primeira = await buscar(url, init)
  if (primeira.ok) return primeira
  const codigo = await codigoDoErro(primeira)
  if (codigo === null || !ERROS_PASSAGEIROS.includes(codigo)) return primeira
  console.warn(`Meta devolveu o erro passageiro ${codigo}; tentando de novo`)
  await (opcoes.esperar ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))))(ESPERA_DA_NOVA_TENTATIVA_MS)
  const segunda = await buscar(url, init)
  if (!segunda.ok) console.warn(`Meta falhou de novo depois do erro ${codigo}; fica como falha`)
  return segunda
}

/** O codigo do erro, lido de uma copia: quem chamou ainda le o corpo original. */
async function codigoDoErro(r: Response): Promise<number | null> {
  try {
    const corpo = await r.clone().json()
    const codigo = Number(corpo?.error?.code)
    return Number.isFinite(codigo) ? codigo : null
  } catch {
    return null
  }
}
