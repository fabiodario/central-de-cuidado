import { useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, KeyRound } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { marcaSemClinicaConhecida } from '@/lib/marca'

const inputClass =
  'w-full rounded-2xl border border-[#081b2c]/10 bg-[#fafaf8] py-3.5 pl-11 pr-12 text-sm font-semibold text-[#081b2c] outline-none transition placeholder:font-normal placeholder:text-slate-300 focus:border-[#2f7fc1] focus:bg-white focus:ring-4 focus:ring-[#2f7fc1]/10 disabled:cursor-not-allowed disabled:opacity-60'

/**
 * Criar a senha nova, depois do link de "esqueci a senha".
 *
 * Tela propria, e nao um campo dentro do login: quem chega aqui ja esta
 * autenticado pelo link, e a unica coisa que falta e a senha. Qualquer outra
 * opcao na tela so confundiria.
 */
export default function NovaSenha() {
  // Antes do login nao se sabe a clinica: vale a ultima vista neste navegador
  // (ver lib/marca.ts). A clinica de teste mostra a marca do produto.
  const marca = marcaSemClinicaConhecida()
  const { updatePassword, authError, signOut } = useAuth()
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [mostrar, setMostrar] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [pronto, setPronto] = useState(false)

  async function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (senha.length < 8) return setErro('Crie uma senha com pelo menos 8 caracteres.')
    if (senha !== confirmacao) return setErro('As senhas não conferem.')
    setErro(null)
    setSalvando(true)
    try {
      const resultado = await updatePassword(senha)
      if (!resultado.error) setPronto(true)
    } finally {
      setSalvando(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f7f5f1] px-4 text-[#081b2c]">
      <div className="w-full max-w-md rounded-[28px] bg-white p-8 shadow-[0_24px_60px_rgba(8,27,44,.08)]">
        <img src={marca.src} alt={marca.nome} className="h-10 w-auto" />
        <div className="mt-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#eaf3fd] text-[#1f4f78]">
            <KeyRound className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-[#1f4f78]">Redefinir senha</p>
            <h1 className="text-xl font-extrabold tracking-[-0.02em]">Crie sua nova senha</h1>
          </div>
        </div>

        {pronto ? (
          <div className="mt-6 rounded-2xl bg-[#eef3f2] p-5 text-sm font-semibold text-[#41695f]">
            Senha alterada. Você já está dentro do sistema.
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#081b2c] px-4 py-3 text-xs font-extrabold text-white"
            >
              Ir para a Central de Cuidado <ArrowRight className="h-4 w-4 text-[#6fadde]" />
            </button>
          </div>
        ) : (
          <form onSubmit={enviar} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-500">Nova senha</span>
              <div className="relative mt-1.5">
                <KeyRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type={mostrar ? 'text' : 'password'}
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Pelo menos 8 caracteres"
                  className={inputClass}
                  disabled={salvando}
                />
                <button
                  type="button"
                  onClick={() => setMostrar((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:text-[#081b2c]"
                  aria-label={mostrar ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {mostrar ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>
            <label className="block">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-500">Confirmar senha</span>
              <div className="relative mt-1.5">
                <KeyRound className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type={mostrar ? 'text' : 'password'}
                  value={confirmacao}
                  onChange={(e) => setConfirmacao(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Repita a senha"
                  className={inputClass}
                  disabled={salvando}
                />
              </div>
            </label>
            {(erro || authError) && (
              <p className="rounded-xl bg-red-50 px-4 py-3 text-xs font-semibold text-red-600">{erro ?? authError}</p>
            )}
            <button
              type="submit"
              disabled={salvando}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#081b2c] px-4 py-3.5 text-sm font-extrabold text-white transition hover:bg-[#102d47] disabled:opacity-60"
            >
              {salvando ? 'Salvando...' : 'Salvar nova senha'} <ArrowRight className="h-4 w-4 text-[#6fadde]" />
            </button>
            <button
              type="button"
              onClick={() => void signOut().then(() => window.location.reload())}
              className="w-full text-center text-[11px] font-semibold text-slate-400 underline underline-offset-4"
            >
              Cancelar e voltar ao login
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
