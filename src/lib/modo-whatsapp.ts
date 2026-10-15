/**
 * Modo WhatsApp no celular (02/10/2026).
 *
 * O balao azul da barra do celular (Home) liga o modo; a tela de Respostas
 * (Conversations) e quem o desenha. Os dois conversam por este evento e pela
 * mesma chave de armazenamento que o "Visual WhatsApp" ja usava - assim a
 * escolha e uma so, e fica lembrada no aparelho.
 */

export const CHAVE_DO_VISUAL = 'central.conversa-visual'
export const EVENTO_MODO_WHATSAPP = 'central:modo-whatsapp'

export function ligarModoWhatsApp() {
  try {
    window.localStorage.setItem(CHAVE_DO_VISUAL, 'whatsapp')
  } catch {
    // sem armazenamento: vale ate recarregar a pagina
  }
  window.dispatchEvent(new Event(EVENTO_MODO_WHATSAPP))
}
