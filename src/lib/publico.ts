import { quemAtende, type QuemAtende } from '../../supabase/functions/_shared/quem-atende.ts'
import { ultimaClinicaVista } from './marca'

/**
 * Com quem as telas falam, pelo mesmo perfil do robo (15/10/2026).
 *
 * As telas vieram da gastropediatria do Dr. Marcello, onde quem recebe a
 * mensagem, marca a consulta e responde ao acompanhamento e a familia, sobre
 * a crianca. No Dr. Fabio (otorrino, perfil 'geral' em quem-atende.ts) quem
 * faz tudo isso costuma ser o proprio paciente, adulto ou crianca, e a tela
 * que dizia "a familia recebe" ensinava errado a quem configura.
 *
 * O perfil e o do robo de proposito: um lugar so decide se a clinica fala com
 * a familia ou com o paciente, e o WhatsApp e a tela nunca se contradizem.
 */
export type Publico = QuemAtende['publico']

/**
 * O perfil da clinica. Tela que ainda nao sabe a clinica usa a ultima vista
 * neste navegador (ver marca.ts); sem nenhuma, fica o Dr. Fabio, a clinica
 * deste sistema - o mesmo padrao de quemAtende.
 */
export function publicoDaClinica(clinicId?: string | null): Publico {
  return quemAtende(clinicId ?? ultimaClinicaVista()).publico
}
