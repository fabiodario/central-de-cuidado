import type { Lugar } from '../../supabase/functions/_shared/campos-do-texto.ts'
import type { Telemedicina, Unit } from '@/lib/repository'

/**
 * Os atendimentos como o robo os oferece, para a tela conferir e mostrar os
 * campos ({valor}, {valores}...) do mesmo jeito que a familia vai ler.
 *
 * ESPELHO de lugaresComValor/opcoesDeAtendimento em
 * supabase/functions/_shared/atendimento.ts: unidades fisicas por nome, a
 * agenda da telemedicina fora (ela nao e lugar) e a telemedicina no fim, com
 * o nome de UNIDADE_TELE, quando a clinica oferece. Mexeu la, mexa aqui - a
 * previa de 20/09 ensinou o menu errado por semanas por ser copia esquecida.
 */
export const NOME_DA_TELEMEDICINA = 'Telemedicina (por vídeo)'
export const ID_DA_TELEMEDICINA = 'telemedicina'

export function lugaresDoRobo(units: Unit[], tele: Telemedicina | null): Lugar[] {
  const fisicas: Lugar[] = units
    .filter((u) => !u.telemedicina)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => ({ id: u.id, nome: u.name, endereco: u.address ?? '', valorCentavos: u.priceCents ?? null }))
  return tele?.ativa && fisicas.length > 0
    ? [
        ...fisicas,
        {
          id: ID_DA_TELEMEDICINA,
          nome: NOME_DA_TELEMEDICINA,
          endereco: '',
          valorCentavos: tele.valorCentavos ?? null,
          telemedicina: true,
        },
      ]
    : fisicas
}
