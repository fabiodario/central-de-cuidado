/**
 * O robo pode responder nesta conversa? (23/10/2026)
 *
 * Duas chaves: a da clinica (whatsapp_autoreply_enabled, no painel do menu
 * automatico) e a de cada conversa (robo_desligado_em, botao na conversa).
 * A da conversa veio porque desligar a clinica inteira para cuidar de uma
 * familia calava o robo para todas as outras.
 */
export function roboRespondeNaConversa(p: { ligadoNaClinica: boolean | null | undefined; desligadoNaConversaEm: string | null | undefined }): boolean {
  if (!p.ligadoNaClinica) return false
  return !p.desligadoNaConversaEm
}
