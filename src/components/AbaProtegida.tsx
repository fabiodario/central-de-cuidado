import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

/**
 * Uma aba que quebra nao derruba o sistema (15/10/2026).
 *
 * Nesse dia uma linha da Agenda leu uma variavel antes de ela existir. O React
 * desmonta tudo quando um componente lanca erro e nao ha quem o pegue: a tela
 * ficou inteira em branco, sem menu, sem aviso - so o console sabia. A
 * recepcao clicava em Agenda e nada acontecia.
 *
 * Agora o erro fica preso na aba: aparece o aviso com o motivo, o menu continua
 * de pe para trocar de aba, e o botao recarrega. A chave da aba (key) faz a
 * protecao recomecar do zero quando a pessoa troca de aba.
 */
export default class AbaProtegida extends Component<
  { nome: string; children: ReactNode },
  { erro: Error | null }
> {
  state: { erro: Error | null } = { erro: null }

  static getDerivedStateFromError(erro: Error) {
    return { erro }
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    // Barulho de proposito: e por aqui que quem for consertar descobre a linha.
    console.error(`[aba ${this.props.nome}] quebrou ao abrir`, erro, info.componentStack)
  }

  render() {
    const { erro } = this.state
    if (!erro) return this.props.children
    return (
      <div className="surface-card mx-auto mt-6 max-w-xl rounded-[22px] p-6 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-red-50 text-red-600">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <p className="mt-3 text-sm font-extrabold text-[#081b2c]">Esta tela não abriu.</p>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          As outras abas continuam funcionando pelo menu. Tente recarregar; se continuar, mande um print desta
          mensagem para quem cuida do sistema.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-[#081b2c] px-4 py-2 text-[11px] font-extrabold text-white transition hover:bg-[#102d47]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Recarregar
        </button>
        <p className="mt-4 break-words rounded-xl bg-[#f6f7f9] px-3 py-2 text-left font-mono text-[10px] text-slate-500">
          {this.props.nome}: {erro.message}
        </p>
      </div>
    )
  }
}
