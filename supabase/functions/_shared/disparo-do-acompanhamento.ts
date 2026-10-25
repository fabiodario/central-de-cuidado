/**
 * Quais acompanhamentos vencidos o disparo das 9h envia (whatsapp-dispatch).
 *
 * Trava de 24/09/2026: recusado pela Meta so tenta de novo depois de 3 dias (a
 * janela de 14 dias fica na consulta ao banco). Trava de 17/10/2026, pedido do
 * Edu: a clinica que desligou o acompanhamento automatico em Preferencias nao
 * recebe envio nenhum do disparo; a equipe continua mandando um por um pela
 * tela de Acompanhamentos.
 *
 * Trava de 25/10/2026, vinda do sistema do Dr. Marcello (19/10/2026): etapa
 * desligada em Preferencias (15, 30 ou 90 dias) nao sai. A migration ja tira o
 * pendente da fila; isto segura o que escapar (paciente arquivado e restaurado
 * devolve a linha). Clinica sem a escolha lida: as tres etapas, como antes.
 */
export type Vencido = { id: string; clinic_id: string; whatsapp_failed_at: string | null; followup_key?: string }

export function escolherParaEnviar<T extends Vencido>(
  vencidos: T[],
  opcoes: {
    clinicasDesligadas: ReadonlySet<string>
    tresDiasAtras: string
    etapasPorClinica?: ReadonlyMap<string, readonly string[]>
  },
): { enviar: T[]; desligados: number; etapaDesligada: number } {
  const enviar: T[] = []
  let desligados = 0
  let etapaDesligada = 0
  for (const vencido of vencidos) {
    if (opcoes.clinicasDesligadas.has(vencido.clinic_id)) {
      desligados += 1
      continue
    }
    const etapas = opcoes.etapasPorClinica?.get(vencido.clinic_id)
    if (etapas?.length && vencido.followup_key && !etapas.includes(vencido.followup_key)) {
      etapaDesligada += 1
      continue
    }
    if (vencido.whatsapp_failed_at && vencido.whatsapp_failed_at >= opcoes.tresDiasAtras) continue
    enviar.push(vencido)
  }
  return { enviar, desligados, etapaDesligada }
}
