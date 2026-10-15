import { useEffect, useRef } from 'react'

/**
 * O botao voltar do celular (15/10/2026).
 *
 * A Central e uma pagina so: abrir uma conversa ou o prontuario nao muda o
 * endereco. Para o Android, entao, nao havia "tela anterior" - o voltar do
 * aparelho nao fazia nada, e o segundo toque fechava o sistema inteiro, no
 * meio de uma conversa com a familia. A seta de voltar la em cima funcionava;
 * a do celular, que e a que a mao procura, nao.
 *
 * Cada camada aberta (conversa no celular, prontuario) deixa um passo no
 * historico do navegador. O voltar do celular consome esse passo e fecha a
 * camada; fechar pela tela (seta, X) consome o passo tambem, para o voltar
 * seguinte nao cair num passo vazio. O endereco nao muda: so o estado da
 * entrada, por cima do que o roteador ja guarda nela.
 */

let contador = 0

export function useVoltarDoCelular(aberta: boolean, fechar: () => void) {
  // A funcao muda a cada render; a camada nao pode reabrir por causa disso.
  const fecharAgora = useRef(fechar)
  useEffect(() => {
    fecharAgora.current = fechar
  })

  useEffect(() => {
    if (!aberta) return
    contador += 1
    const marca = `camada-${contador}`
    window.history.pushState({ ...(window.history.state ?? {}), centralCamada: marca }, '')
    let saiuPeloVoltar = false

    const aoVoltar = () => {
      // Saiu so uma camada de cima desta: esta continua aberta.
      if ((window.history.state as { centralCamada?: string } | null)?.centralCamada === marca) return
      saiuPeloVoltar = true
      fecharAgora.current()
    }
    window.addEventListener('popstate', aoVoltar)

    return () => {
      window.removeEventListener('popstate', aoVoltar)
      if (saiuPeloVoltar) return
      // Fechou pela tela: tira o passo que esta camada pos. Depois do que o
      // React fizer neste mesmo instante, e nao ja: se o fechamento trocou de
      // aba (prontuario aberto pela Agenda volta para a Agenda), a aba nova ja
      // anotou o passo dela por cima, e voltar agora levaria de volta para a
      // aba velha. Nesse caso fica um passo a mais no historico, e so.
      window.setTimeout(() => {
        if ((window.history.state as { centralCamada?: string } | null)?.centralCamada === marca) window.history.back()
      }, 0)
    }
  }, [aberta])
}

/**
 * As abas como historico: o voltar do celular volta para a aba de antes, e so
 * sai do sistema na primeira. O Home continua trocando de aba como sempre;
 * isto observa a aba e anota cada troca no historico.
 */
export function useAbasNoHistorico<T extends string>(aba: T, irPara: (aba: T) => void, valida: (aba: string) => boolean) {
  const atual = useRef(aba)
  const vindoDoVoltar = useRef(false)
  const irParaAgora = useRef(irPara)
  const validaAgora = useRef(valida)
  useEffect(() => {
    irParaAgora.current = irPara
    validaAgora.current = valida
  })

  // A primeira aba marca a entrada em que o sistema abriu.
  useEffect(() => {
    window.history.replaceState({ ...(window.history.state ?? {}), centralAba: atual.current }, '')
    const aoVoltar = (evento: PopStateEvent) => {
      const anterior = (evento.state as { centralAba?: string } | null)?.centralAba
      if (!anterior || anterior === atual.current || !validaAgora.current(anterior)) return
      vindoDoVoltar.current = true
      irParaAgora.current(anterior as T)
    }
    window.addEventListener('popstate', aoVoltar)
    return () => window.removeEventListener('popstate', aoVoltar)
  }, [])

  useEffect(() => {
    if (aba === atual.current) return
    atual.current = aba
    // A troca veio do voltar: o historico ja esta no lugar certo.
    if (vindoDoVoltar.current) {
      vindoDoVoltar.current = false
      return
    }
    window.history.pushState({ ...(window.history.state ?? {}), centralAba: aba, centralCamada: undefined }, '')
  }, [aba])
}
