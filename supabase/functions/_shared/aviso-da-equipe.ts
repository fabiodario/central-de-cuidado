/**
 * Quando uma mensagem da familia vira notificacao no celular da equipe.
 *
 * Pedido de 28/09/2026: "quando tiver msg dos clientes (falar com a equipe)
 * aparecer notificacao no celular, tipo wpp". Escolhidos dois grupos:
 *   - quem pediu gente: 'atendente' e 'urgencia';
 *   - 2a via de receita / pedido de exame: 'documento' e 'farmacia'.
 * Os outros motivos ('anexo', 'ajuda', 'falha', 'cancelou_sozinho') continuam
 * so acendendo a conversa na tela - entram aqui se a clinica pedir.
 *
 * Duas situacoes avisam:
 *   - o PEDIDO: a conversa acabou de entrar na fila por um desses motivos;
 *   - a MENSAGEM: ela ja estava na fila e a familia escreveu de novo. E o
 *     "tipo wpp" - quem espera resposta continua falando, e a equipe precisa
 *     saber. A notificacao usa a conversa como etiqueta, entao o celular troca
 *     a anterior em vez de empilhar dez.
 *
 * Regra pura, sem banco, para o teste cobrir (tests/aviso-da-equipe.test.mjs).
 */

// 'sangramento' (15/10/2026): o alerta pedido pelo Dr. Fabio. O paciente falou
// em sangramento e o celular dele e o da Dayane tocam na hora, marcado como
// urgente - e a cada mensagem nova, enquanto ninguem assumir. Ver
// falouDeSangramento em atendimento.ts.
// 'nao_suportada' (16/10/2026, vindo do sistema do Dr. Marcello): alguem tentou
// falar - talvez ligando pelo WhatsApp - e so a equipe, com um modelo, consegue
// responder.
export const MOTIVOS_QUE_AVISAM = ['atendente', 'urgencia', 'documento', 'farmacia', 'sangramento', 'nao_suportada'] as const

export type Aviso = {
  titulo: string
  corpo: string
  /** Etiqueta da notificacao: uma por conversa. */
  etiqueta: string
  conversa: string
  urgente: boolean
}

export type EntradaDoAviso = {
  conversationId: string
  /** Como a conversa estava ANTES desta mensagem. */
  atencaoAntes: boolean
  motivoAntes: string | null
  /** O motivo com que ela ficou DEPOIS (null = nao espera a equipe). */
  motivoAgora: string | null
  texto: string
  pacientes: { name: string }[]
  nomeDoPerfil: string
  telefone: string
}

const MIDIA: Record<string, string> = {
  '[image]': '📷 Foto',
  '[audio]': '🎤 Áudio',
  '[voice]': '🎤 Áudio',
  '[video]': '🎥 Vídeo',
  '[document]': '📄 Documento',
  '[sticker]': 'Figurinha',
}

function quem(entrada: EntradaDoAviso): string {
  // Um paciente so no telefone: o nome dele e o que a equipe procura na lista.
  // Com irmaos, o nome do perfil (em geral a mae) e mais honesto do que
  // escolher um dos filhos.
  if (entrada.pacientes.length === 1 && entrada.pacientes[0].name.trim()) return entrada.pacientes[0].name.trim()
  if (entrada.nomeDoPerfil.trim()) return entrada.nomeDoPerfil.trim()
  const d = entrada.telefone.replace(/\D/g, '')
  const local = d.startsWith('55') ? d.slice(2) : d
  return local.length >= 10 ? `(${local.slice(0, 2)}) ${local.slice(2, -4)}-${local.slice(-4)}` : entrada.telefone
}

function resumo(texto: string): string {
  const limpo = (MIDIA[texto.trim()] ?? texto).replace(/\s+/g, ' ').trim()
  return limpo.length > 140 ? `${limpo.slice(0, 137)}…` : limpo
}

export function montarAviso(entrada: EntradaDoAviso): Aviso | null {
  const motivo = entrada.motivoAgora
  if (!motivo || !(MOTIVOS_QUE_AVISAM as readonly string[]).includes(motivo)) return null

  const nome = quem(entrada)
  const corpo = resumo(entrada.texto) || 'Nova mensagem'
  const urgente = motivo === 'urgencia' || motivo === 'sangramento'
  const base = { etiqueta: `conversa-${entrada.conversationId}`, conversa: entrada.conversationId, urgente }

  const entrouAgora = !entrada.atencaoAntes || entrada.motivoAntes !== motivo
  if (!entrouAgora) {
    return { ...base, titulo: motivo === 'sangramento' ? `🩸 ${nome}` : urgente ? `🚨 ${nome}` : nome, corpo }
  }

  const titulos: Record<string, string> = {
    urgencia: `🚨 Urgência: ${nome}`,
    sangramento: `🩸 Sangramento: ${nome}`,
    atendente: `${nome} quer falar com a equipe`,
    documento: `${nome} pediu 2ª via ou exame`,
    farmacia: `Farmácia pediu correção de receita (${nome})`,
    nao_suportada: `${nome} tentou falar com a clínica (talvez uma ligação)`,
  }
  return { ...base, titulo: titulos[motivo], corpo }
}
