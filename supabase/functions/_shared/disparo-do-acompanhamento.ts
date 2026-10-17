/**
 * Quais acompanhamentos vencidos o disparo das 9h envia (whatsapp-dispatch).
 *
 * Trava de 24/09/2026: recusado pela Meta so tenta de novo depois de 3 dias (a
 * janela de 14 dias fica na consulta ao banco). Trava de 17/10/2026, pedido do
 * Edu: a clinica que desligou o acompanhamento automatico em Preferencias nao
 * recebe envio nenhum do disparo; a equipe continua mandando um por um pela
 * tela de Acompanhamentos.
 */
export type Vencido = { id: string; clinic_id: string; whatsapp_failed_at: string | null }

export function escolherParaEnviar<T extends Vencido>(
  vencidos: T[],
  opcoes: { clinicasDesligadas: ReadonlySet<string>; tresDiasAtras: string },
): { enviar: T[]; desligados: number } {
  const enviar: T[] = []
  let desligados = 0
  for (const vencido of vencidos) {
    if (opcoes.clinicasDesligadas.has(vencido.clinic_id)) {
      desligados += 1
      continue
    }
    if (vencido.whatsapp_failed_at && vencido.whatsapp_failed_at >= opcoes.tresDiasAtras) continue
    enviar.push(vencido)
  }
  return { enviar, desligados }
}
