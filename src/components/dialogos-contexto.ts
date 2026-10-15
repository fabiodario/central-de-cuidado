import { createContext, useContext } from 'react'

/**
 * O canal de avisos e perguntas, separado do componente que os desenha.
 *
 * Fica em arquivo proprio porque o Vite so recarrega uma tela sem perder o
 * estado quando o arquivo exporta componentes e mais nada.
 */

type Tom = 'ok' | 'erro' | 'aviso'

export type ApiDeDialogos = {
  /** Aviso curto no canto. Some sozinho depois de alguns segundos. */
  avisar: (texto: string, tom?: Tom) => void
  /** Pergunta no meio da tela. Devolve true quando a pessoa confirma. */
  perguntar: (opcoes: {
    titulo: string
    detalhe?: string
    confirmar?: string
    cancelar?: string
    /** Vermelho no botao principal, para o que nao se desfaz num clique. */
    perigo?: boolean
  }) => Promise<boolean>
}

export const ContextoDeDialogos = createContext<ApiDeDialogos | null>(null)

/**
 * O acesso ao aviso e a pergunta, de qualquer tela.
 *
 * Fora do provedor cai no comportamento antigo do navegador em vez de quebrar:
 * uma tela que ainda nao foi migrada continua avisando, feia mas viva.
 */
export function useDialogos(): ApiDeDialogos {
  const api = useContext(ContextoDeDialogos)
  return (
    api ?? {
      avisar: (texto: string) => window.alert(texto),
      perguntar: async (opcoes) => window.confirm(opcoes.titulo),
    }
  )
}
