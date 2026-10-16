import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Loader2, Lock, LogOut } from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'
import logoCentral from '@/assets/logo-central-de-cuidado.webp'

/**
 * Quem pode abrir o simulador: o login do sistema, de quem tem acesso ativo a
 * uma clinica, ou das contas listadas abaixo.
 *
 * O acesso pela clinica e de 16/10/2026: o simulador passou a morar dentro de
 * Respostas e a ler a configuracao da clinica do login. Quem enxerga Respostas
 * (o Dr. Fabio, a Dayane) tem de conseguir testar o robo ali, e a lista de
 * e-mails, herdada das demonstracoes de venda do Dr. Marcello, barrava os dois.
 *
 * A lista guarda o SHA-256 do e-mail, e nao o e-mail: a pagina e publica no
 * GitHub Pages e qualquer um le o codigo dela. Para liberar outra pessoa, gere
 * o hash do e-mail em minusculas e acrescente aqui:
 *   node -e "console.log(require('crypto').createHash('sha256').update('email@exemplo.com').digest('hex'))"
 *
 * O simulador so LE a configuracao da clinica (unidades, horarios, respostas
 * prontas), com a mesma permissao do sistema, e nunca grava: as conversas e as
 * consultas da simulacao ficam num banco falso, no navegador. A sessao e a do
 * proprio sistema (mesmo endereco), entao quem ja entrou na Central entra
 * direto.
 */
const CONTAS_LIBERADAS = ['86c69d3de7e3c3f8b51abe860f78d35d2a1c23682c638c579439ae5f8b0746cf']

async function impressaoDoEmail(email: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Tem acesso ativo a alguma clinica? Erro de rede sobe, e a tela diz qual foi. */
async function temClinicaAtiva(usuario: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('clinic_memberships')
    .select('clinic_id')
    .eq('user_id', usuario)
    .eq('status', 'active')
    .limit(1)
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

function Carregando() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#081b2c]">
      <Loader2 className="h-6 w-6 animate-spin text-[#6fadde]" />
    </main>
  )
}

function Moldura({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#081b2c] px-4 py-10">
      <div className="w-full max-w-[400px] rounded-[28px] bg-white p-8 shadow-[0_30px_80px_rgba(0,0,0,.35)]">
        <img src={logoCentral} alt="Central de Cuidado" className="h-9 w-auto brightness-0" />
        <p className="mt-6 text-[11px] font-extrabold uppercase tracking-[0.18em] text-[#2f7fc1]">Simulador do atendimento</p>
        {children}
      </div>
    </main>
  )
}

export function Acesso({ children }: { children: ReactNode }) {
  const { session, user, loading, signIn, signOut, authError, configurationError } = useAuth()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [entrando, setEntrando] = useState(false)
  const [liberado, setLiberado] = useState<{ email: string; ok: boolean; erro?: string } | null>(null)

  const emailDaSessao = user?.email ?? ''
  const idDaSessao = user?.id ?? ''
  useEffect(() => {
    if (!emailDaSessao || !idDaSessao) return
    let vivo = true
    // Falha aqui tem de aparecer. Em 14/10/2026 a pagina aberta em http (onde
    // crypto.subtle nao existe) rejeitava esta promessa em silencio, e a tela
    // ficava girando para sempre sem dizer nada.
    Promise.all([impressaoDoEmail(emailDaSessao), temClinicaAtiva(idDaSessao)])
      .then(([h, temClinica]) => {
        if (vivo) setLiberado({ email: emailDaSessao, ok: temClinica || CONTAS_LIBERADAS.includes(h) })
      })
      .catch((erro: unknown) => {
        if (vivo) setLiberado({ email: emailDaSessao, ok: false, erro: erro instanceof Error ? erro.message : String(erro) })
      })
    return () => {
      vivo = false
    }
  }, [emailDaSessao, idDaSessao])

  // So no servidor de desenvolvimento (npm run dev), para conferir a tela sem
  // senha: o build de producao troca import.meta.env.DEV por false e este
  // atalho nao chega ao site publicado.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('semlogin')) return <>{children}</>

  // Sem banco configurado (o arquivo da reuniao, gerado sem .env.local), nao
  // ha conta para conferir, e o simulador roda com os dados de exemplo. Assim
  // ele abre direto com duplo clique, sem internet.
  if (!isSupabaseConfigured) return <>{children}</>

  if (loading) return <Carregando />

  if (!session) {
    const entrar = async (e: FormEvent) => {
      e.preventDefault()
      setEntrando(true)
      await signIn(email, senha)
      setEntrando(false)
    }
    return (
      <Moldura>
        <h1 className="mt-2 text-[24px] font-extrabold leading-tight text-[#081b2c]">Entre com o seu acesso da Central</h1>
        <p className="mt-2 text-sm text-slate-500">O mesmo e-mail e senha do sistema.</p>
        <form onSubmit={entrar} className="mt-6 space-y-3">
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="E-mail"
            className="w-full rounded-2xl border border-slate-200 bg-[#f7f5f1] px-4 py-3 text-[15px] text-[#081b2c] outline-none focus:border-[#2f7fc1] focus:bg-white"
          />
          <input
            type="password"
            autoComplete="current-password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="Senha"
            className="w-full rounded-2xl border border-slate-200 bg-[#f7f5f1] px-4 py-3 text-[15px] text-[#081b2c] outline-none focus:border-[#2f7fc1] focus:bg-white"
          />
          {(authError || configurationError) && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{authError || configurationError}</p>
          )}
          <button
            type="submit"
            disabled={entrando}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#081b2c] px-4 py-3 text-[15px] font-bold text-white transition hover:bg-[#10304d] disabled:opacity-60"
          >
            {entrando && <Loader2 className="h-4 w-4 animate-spin" />}
            Entrar
          </button>
        </form>
      </Moldura>
    )
  }

  if (!liberado || liberado.email !== emailDaSessao) return <Carregando />

  if (liberado.erro) {
    return (
      <Moldura>
        <h1 className="mt-2 text-[22px] font-extrabold text-[#081b2c]">Não consegui conferir o acesso</h1>
        <p className="mt-2 text-sm text-slate-500">
          {window.isSecureContext
            ? `O navegador recusou a conferência: ${liberado.erro}.`
            : 'A página está aberta sem segurança (http). Abra pelo endereço com https.'}
        </p>
        {!window.isSecureContext && (
          <a
            href={`https:${window.location.href.slice(window.location.protocol.length)}`}
            className="mt-6 flex w-full items-center justify-center rounded-2xl bg-[#081b2c] px-4 py-3 text-[15px] font-bold text-white hover:bg-[#10304d]"
          >
            Abrir com https
          </a>
        )}
      </Moldura>
    )
  }

  if (!liberado.ok) {
    return (
      <Moldura>
        <h1 className="mt-2 flex items-center gap-2 text-[22px] font-extrabold text-[#081b2c]">
          <Lock className="h-5 w-5 text-[#2f7fc1]" /> Acesso restrito
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          O simulador abre para quem tem acesso a uma clínica neste sistema. Você entrou como <strong>{emailDaSessao}</strong>, que
          ainda não tem: peça a liberação na tela Acessos da equipe.
        </p>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 py-3 text-[15px] font-bold text-[#081b2c] hover:bg-slate-50"
        >
          <LogOut className="h-4 w-4" /> Sair e entrar com outra conta
        </button>
      </Moldura>
    )
  }

  return <>{children}</>
}
