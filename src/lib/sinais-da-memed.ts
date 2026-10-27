/**
 * Como saber, olhando a pagina, em que estado a Memed esta.
 *
 * Desde 25/10/2026 a Memed tem dois motores e escolhe um por prescritor, do
 * lado dela: o script que a gente carrega e o mesmo, e e ele quem decide (o
 * "gate" dela, que fica em window.__mdSinapseGate).
 *
 * - O antigo cria um iframe por modulo, com id "mdhub-module-<nome>", e
 *   esconde com display:none.
 * - O novo, sinapse v4, cria UM iframe sem id, vindo de
 *   v4-embedded*.memed.com.br, e esconde com visibility:hidden.
 *
 * Foi o que travou a primeira prescricao do Dr. Fabio em 25/10/2026: a Memed
 * entregou o v4, a espera procurava o iframe do motor antigo, que nunca vem, e
 * depois de 40 s a tela dizia "A Memed nao respondeu a tempo". No segundo
 * clique a mesma Memed abria em 2,6 s, porque ja estava pronta havia tempo.
 *
 * Fica fora de memed.ts para poder ser testado sem navegador.
 */

export type QuadroNaPagina = {
  id: string
  src: string
  display?: string
  visibility?: string
}

/** O que a Memed pendura em window.__mdSinapseGate. E dela e pode mudar. */
export type PortaoDaMemed = { v4Ready?: unknown } | null | undefined

const ID_DO_MODULO_ANTIGO = 'mdhub-module-plataforma.prescricao'

/** Producao e homologacao: v4-embedded, v4-embedded-integrations, -qa... */
export function ehQuadroDaV4(quadro: QuadroNaPagina): boolean {
  return /^https:\/\/v4-embedded[a-z0-9-]*\.memed\.com\.br(\/|$)/i.test(quadro.src)
}

function ehQuadroAntigo(quadro: QuadroNaPagina): boolean {
  return quadro.id.startsWith('mdhub-module-')
}

/**
 * Ja da para mandar comando para a prescricao?
 *
 * Motor antigo: o iframe do modulo da prescricao estar na pagina (ver o
 * comentario de 21/09/2026 em memed.ts).
 *
 * Motor novo: o proprio aviso de pronto do v4. Se um dia a Memed tirar ou
 * renomear esse aviso, vale o iframe do v4 estar na pagina - os comandos que
 * chegam antes de ele terminar de subir ficam numa fila dela (no console:
 * "adopted legacy facade queue").
 */
export function prontaParaComando(quadros: QuadroNaPagina[], portao: PortaoDaMemed): boolean {
  if (quadros.some((quadro) => quadro.id === ID_DO_MODULO_ANTIGO)) return true
  if (portao && typeof portao.v4Ready === 'boolean') return portao.v4Ready
  return quadros.some(ehQuadroDaV4)
}

/**
 * Algum modulo da Memed esta aberto na tela neste momento?
 *
 * Os dois jeitos de esconder contam: o antigo usa display:none, o v4 deixa o
 * iframe com display:block e esconde com visibility:hidden.
 */
export function memedNaTela(quadros: QuadroNaPagina[]): boolean {
  return quadros.some(
    (quadro) =>
      (ehQuadroAntigo(quadro) || ehQuadroDaV4(quadro)) &&
      quadro.display !== 'none' &&
      quadro.visibility !== 'hidden',
  )
}

/**
 * O id da receita que o medico excluiu na Memed.
 *
 * A documentacao publica mostra { id }, mas a Memed manda o id nu (numero ou
 * texto) - e o que diz o catalogo de eventos dentro do proprio v4, "verificado
 * ao vivo". Ate 25/10/2026 so o { id } era lido, entao a exclusao feita la
 * nunca chegava ao prontuario. Aceita os dois.
 */
export function idDaReceitaExcluida(dados: unknown): string | null {
  const bruto =
    typeof dados === 'string' || typeof dados === 'number'
      ? dados
      : (dados as { id?: unknown } | null | undefined)?.id
  if (typeof bruto !== 'string' && typeof bruto !== 'number') return null
  const id = String(bruto).trim()
  return id || null
}

/**
 * As certificadoras que a Memed oferece na hora de assinar a receita.
 *
 * O Dr. Fabio assina com o BirdID, o certificado em nuvem da Soluti. Na Memed
 * ele se chama 'soluti': e o nome na lista do setFeatureToggle da
 * documentacao, e no codigo do v4 aparece como "Soluti", "Parceiro Oficial
 * Memed", entrando com o CPF e o codigo do aplicativo (conferido em
 * 27/10/2026). Ate esse dia a lista era so 'vidaas', herdada do sistema do
 * Dr. Marcello, e a tela de assinatura da Memed so mostrava o VIDaaS (o Edu
 * viu na reuniao de 26/10/2026). Uma so, de proposito: sem a lista a Memed
 * oferece sete, e o medico tem de saber qual e a dele.
 */
export const CERTIFICADORAS_DA_MEMED: readonly string[] = ['soluti']
