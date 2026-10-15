import { useEffect, useState } from 'react'
import { getCurrentMembership, listUnits } from '@/lib/repository'

/**
 * As unidades da clinica, vindas do banco.
 *
 * Ate 03/09/2026 a lista das telas de cadastro e de prontuario era uma
 * constante no codigo. Quando a clinica fechou duas unidades e abriu a
 * Ibirapuera pela tela de Agenda, a agenda e o robo do WhatsApp passaram a
 * oferecer o certo e o cadastro continuou oferecendo o antigo - porque so um
 * dos dois lados sabia da mudanca.
 *
 * Agora ha uma fonte so: a tabela de unidades, editada em Agenda.
 */
export function useUnidades() {
  const [nomes, setNomes] = useState<string[]>([])

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const membership = await getCurrentMembership()
        if (!membership || !vivo) return
        const unidades = await listUnits(membership.clinicId)
        if (vivo) setNomes(unidades.map((u) => u.name))
      } catch {
        // Fica com a lista de reserva. Um cadastro com a unidade errada se
        // corrige em dois cliques; um formulario que nao abre, nao.
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  return nomes
}

/**
 * O que mostrar no seletor de unidade.
 *
 * Inclui o valor atual mesmo que ele nao esteja mais na lista: paciente
 * atendido na Vila Mariana continua tendo sido atendido na Vila Mariana depois
 * que a unidade fecha, e um seletor que apaga esse dado ao ser aberto
 * reescreveria a historia sem ninguem pedir.
 */
export function opcoesDeUnidade(daClinica: string[], valorAtual?: string) {
  const lista = [...daClinica, 'Outra']
  const atual = (valorAtual ?? '').trim()
  return atual && !lista.includes(atual) ? [atual, ...lista] : lista
}
