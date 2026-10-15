import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { AuthError, Session, User } from '@supabase/supabase-js'
import {
  isSupabaseConfigured,
  supabase,
  supabaseConfigurationError,
} from '@/lib/supabase'

export interface AuthActionResult {
  error: string | null
}

export interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  authError: string | null
  configurationError: string | null
  signIn: (email: string, password: string) => Promise<AuthActionResult>
  requestAccess: (fullName: string, email: string, password: string) => Promise<AuthActionResult>
  signOut: () => Promise<AuthActionResult>
  clearAuthError: () => void
  /** Manda o e-mail com o link para criar uma senha nova. */
  sendPasswordReset: (email: string) => Promise<AuthActionResult>
  /** Verdadeiro enquanto a pessoa esta voltando pelo link de redefinicao. */
  recovering: boolean
  /** Grava a senha nova e encerra a recuperacao. */
  updatePassword: (password: string) => Promise<AuthActionResult>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function friendlyAuthError(error: AuthError): string {
  switch (error.code) {
    case 'invalid_credentials':
      return 'E-mail ou senha incorretos.'
    case 'email_not_confirmed':
      return 'Este e-mail ainda não foi confirmado.'
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente novamente.'
    case 'user_banned':
      return 'Este acesso está temporariamente indisponível. Fale com o administrador.'
    default:
      return error.message || 'Não foi possível autenticar. Tente novamente.'
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [authError, setAuthError] = useState<string | null>(null)
  // Volta pelo link de "esqueci a senha". O Supabase abre uma sessao
  // temporaria e avisa com o evento PASSWORD_RECOVERY; enquanto isso for
  // verdadeiro, a unica tela e a de criar a senha nova.
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) return

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
      if (nextSession) setAuthError(null)
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
    })

    return () => subscription.unsubscribe()
  }, [])

  const clearAuthError = useCallback(() => setAuthError(null), [])

  /**
   * Sai sozinho depois de uma hora sem uso (24/09/2026).
   *
   * A sessao era salva e renovada sem limite: o computador da recepcao aberto
   * durante o almoco era acesso livre ao prontuario de todos os pacientes. Uma
   * hora e folga para quem esta atendendo (digitar, clicar e rolar contam como
   * uso) e fecha a porta de quem levantou e esqueceu.
   *
   * A ultima atividade fica no localStorage para valer entre abas: quem usa a
   * Agenda numa aba nao e derrubado por causa da outra, parada. Cinco minutos
   * antes, um aviso na tela; qualquer clique ou tecla continua a sessao.
   */
  const [minutosParaSair, setMinutosParaSair] = useState<number | null>(null)
  useEffect(() => {
    if (!session) return
    const CHAVE = 'central.ultimaAtividade'
    const LIMITE = 60 * 60_000
    const AVISO = 5 * 60_000
    const ler = () => {
      try {
        return Number(window.localStorage.getItem(CHAVE)) || Date.now()
      } catch {
        return Date.now()
      }
    }
    let ultimaGravacao = 0
    const marcar = () => {
      const agora = Date.now()
      if (agora - ultimaGravacao < 15_000) return
      ultimaGravacao = agora
      try {
        window.localStorage.setItem(CHAVE, String(agora))
      } catch {
        // Sem armazenamento, a sessao nunca expira por inatividade: melhor
        // que derrubar quem esta trabalhando.
      }
      setMinutosParaSair(null)
    }
    marcar()
    const eventos = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    for (const e of eventos) window.addEventListener(e, marcar, { passive: true })
    const relogio = window.setInterval(() => {
      const parado = Date.now() - ler()
      if (parado >= LIMITE) {
        void supabase.auth.signOut({ scope: 'local' }).then(() => {
          setSession(null)
          setMinutosParaSair(null)
          setAuthError('Por segurança, o sistema saiu sozinho depois de uma hora sem uso. Entre de novo.')
        })
      } else if (parado >= LIMITE - AVISO) {
        setMinutosParaSair(Math.max(1, Math.ceil((LIMITE - parado) / 60_000)))
      } else {
        setMinutosParaSair(null)
      }
    }, 30_000)
    return () => {
      for (const e of eventos) window.removeEventListener(e, marcar)
      window.clearInterval(relogio)
    }
  }, [session])

  const signIn = useCallback(async (email: string, password: string): Promise<AuthActionResult> => {
    if (!isSupabaseConfigured) {
      const message = supabaseConfigurationError ?? 'O Supabase não está configurado.'
      setAuthError(message)
      return { error: message }
    }

    setAuthError(null)
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    })

    if (error) {
      const message = friendlyAuthError(error)
      setAuthError(message)
      return { error: message }
    }

    if (data.session) setSession(data.session)
    return { error: null }
  }, [])

  const requestAccess = useCallback(
    async (fullName: string, email: string, password: string): Promise<AuthActionResult> => {
      if (!isSupabaseConfigured) {
        const message = supabaseConfigurationError ?? 'O Supabase não está configurado.'
        setAuthError(message)
        return { error: message }
      }

      setAuthError(null)
      const { error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
        },
      })

      if (error) {
        const message = friendlyAuthError(error)
        setAuthError(message)
        return { error: message }
      }

      // A solicitação só será liberada no painel do administrador. Mantemos a
      // tela de login em vez de levar um acesso ainda pendente ao sistema.
      await supabase.auth.signOut({ scope: 'local' })
      setSession(null)
      return { error: null }
    },
    [],
  )

  const signOut = useCallback(async (): Promise<AuthActionResult> => {
    if (!isSupabaseConfigured) {
      const message = supabaseConfigurationError ?? 'O Supabase não está configurado.'
      setAuthError(message)
      return { error: message }
    }

    setAuthError(null)
    const { error } = await supabase.auth.signOut({ scope: 'local' })

    if (error) {
      const message = friendlyAuthError(error)
      setAuthError(message)
      return { error: message }
    }

    setSession(null)
    return { error: null }
  }, [])

  const sendPasswordReset = useCallback(async (email: string): Promise<AuthActionResult> => {
    if (!isSupabaseConfigured) {
      const message = supabaseConfigurationError ?? 'O Supabase não está configurado.'
      setAuthError(message)
      return { error: message }
    }
    setAuthError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}${window.location.pathname}`,
    })
    if (error) {
      const message = friendlyAuthError(error)
      setAuthError(message)
      return { error: message }
    }
    return { error: null }
  }, [])

  const updatePassword = useCallback(async (password: string): Promise<AuthActionResult> => {
    setAuthError(null)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      const message = friendlyAuthError(error)
      setAuthError(message)
      return { error: message }
    }
    setRecovering(false)
    return { error: null }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      authError,
      configurationError: supabaseConfigurationError,
      signIn,
      requestAccess,
      signOut,
      clearAuthError,
      sendPasswordReset,
      recovering,
      updatePassword,
    }),
    [authError, clearAuthError, loading, requestAccess, session, signIn, signOut, sendPasswordReset, recovering, updatePassword],
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
      {session && minutosParaSair !== null && (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 z-[100] w-[calc(100%-32px)] max-w-md -translate-x-1/2 rounded-2xl bg-[#081b2c] px-4 py-3 text-center text-xs font-bold text-white shadow-xl"
        >
          Sem uso há quase uma hora: por segurança, o sistema sai sozinho em {minutosParaSair}{' '}
          {minutosParaSair === 1 ? 'minuto' : 'minutos'}. Clique em qualquer lugar para continuar.
        </div>
      )}
    </AuthContext.Provider>
  )
}

// O provider e seu hook formam uma única API pública de autenticação.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth precisa ser usado dentro de <AuthProvider>.')
  return context
}

