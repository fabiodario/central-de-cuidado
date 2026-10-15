import { useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Eye,
  EyeOff,
  HeartHandshake,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
  UserRoundPlus,
} from 'lucide-react'
import { useAuth } from '@/auth/AuthProvider'
import { marcaSemClinicaConhecida } from '@/lib/marca'
import gastroWatermark from '@/assets/sidebar-gastro-full.jpg'

const inputClass =
  'w-full rounded-2xl border border-[#081b2c]/10 bg-[#fafaf8] py-3.5 pl-11 pr-4 text-sm font-semibold text-[#081b2c] outline-none transition placeholder:font-normal placeholder:text-slate-300 focus:border-[#2f7fc1] focus:bg-white focus:ring-4 focus:ring-[#2f7fc1]/10 disabled:cursor-not-allowed disabled:opacity-60'

export default function Login() {
  // Antes do login nao se sabe a clinica: vale a ultima vista neste navegador
  // (ver lib/marca.ts). A clinica de teste mostra a marca do produto.
  const marca = marcaSemClinicaConhecida()
  const { signIn, requestAccess, sendPasswordReset, authError, configurationError, clearAuthError } = useAuth()
  const [mode, setMode] = useState<'login' | 'request' | 'reset'>('login')
  const [resetSent, setResetSent] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [requestSent, setRequestSent] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    clearAuthError()

    if (mode === 'reset') {
      if (!email.trim()) {
        setValidationError('Informe o e-mail da sua conta.')
        return
      }
      setValidationError(null)
      setSubmitting(true)
      try {
        const result = await sendPasswordReset(email)
        if (!result.error) setResetSent(true)
      } finally {
        setSubmitting(false)
      }
      return
    }

    if (!email.trim() || !password || (mode === 'request' && !fullName.trim())) {
      setValidationError('Preencha todos os campos obrigatórios.')
      return
    }

    if (mode === 'request' && password.length < 8) {
      setValidationError('Crie uma senha com pelo menos 8 caracteres.')
      return
    }

    if (mode === 'request' && password !== confirmPassword) {
      setValidationError('As senhas não conferem.')
      return
    }

    setValidationError(null)
    setSubmitting(true)
    try {
      if (mode === 'request') {
        const result = await requestAccess(fullName, email, password)
        if (!result.error) {
          setRequestSent(true)
          setPassword('')
          setConfirmPassword('')
        }
      } else {
        const result = await signIn(email, password)
        if (!result.error) setPassword('')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const visibleError = configurationError ?? validationError ?? authError
  const disabled = submitting || Boolean(configurationError)

  function switchMode(nextMode: 'login' | 'request' | 'reset') {
    setMode(nextMode)
    setValidationError(null)
    clearAuthError()
    setRequestSent(false)
    setResetSent(false)
    setPassword('')
    setConfirmPassword('')
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#f7f5f1] text-[#081b2c]">
      <div className="pointer-events-none absolute -left-32 -top-40 h-[440px] w-[440px] rounded-full bg-[#9fc2b8]/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-52 -right-32 h-[520px] w-[520px] rounded-full bg-[#86bce4]/25 blur-3xl" />

      <div className="relative mx-auto grid min-h-dvh max-w-[1500px] lg:grid-cols-[minmax(0,1.08fr)_minmax(440px,.92fr)]">
        <section className="soft-grid relative hidden overflow-hidden bg-[#081b2c] p-12 text-white lg:flex lg:flex-col lg:justify-between">
          <img
            src={gastroWatermark}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="pointer-events-none absolute inset-y-0 right-0 h-full w-[54%] object-cover object-center opacity-[0.22] mix-blend-screen select-none"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#081b2c] via-[#081b2c]/75 to-[#081b2c]/30" />
          <div className="absolute -right-24 top-20 h-80 w-80 rounded-full bg-[#2f7fc1]/15 blur-3xl" />
          <div className="absolute -bottom-28 -left-20 h-72 w-72 rounded-full bg-[#6f9d91]/15 blur-3xl" />

          <div className="relative">
            <img
              src={marca.src}
              alt={marca.nome}
              className="h-14 w-auto max-w-[220px] brightness-0 invert"
            />
            <div className="mt-6 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.24em] text-white/45">
              <HeartHandshake className="h-4 w-4 text-[#6aa8d9]" />
              Central de cuidado
            </div>
          </div>

          <div className="relative max-w-2xl py-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[9px] font-extrabold uppercase tracking-[0.16em] text-[#8dbde4]">
              <Sparkles className="h-3.5 w-3.5" />
              Cuidado contínuo
            </div>
            <h1 className="mt-6 max-w-xl text-balance text-4xl font-extrabold leading-[1.08] tracking-[-0.05em] xl:text-5xl">
              Cada família acompanhada no momento certo.
            </h1>
            <p className="mt-5 max-w-xl text-sm leading-relaxed text-white/50 xl:text-base">
              Uma visão segura da jornada de cada paciente, das consultas aos contatos de 15, 30 e 90 dias.
            </p>

            <div className="mt-9 grid max-w-xl grid-cols-2 gap-3">
              <div className="rounded-[22px] border border-white/10 bg-white/[0.06] p-4 backdrop-blur">
                <ShieldCheck className="h-5 w-5 text-[#6aa8d9]" />
                <p className="mt-3 text-xs font-extrabold text-white/90">Acesso protegido</p>
                <p className="mt-1 text-[10px] leading-relaxed text-white/40">Somente para a equipe autorizada</p>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-white/[0.06] p-4 backdrop-blur">
                <HeartHandshake className="h-5 w-5 text-[#9fc2b8]" />
                <p className="mt-3 text-xs font-extrabold text-white/90">Cuidado organizado</p>
                <p className="mt-1 text-[10px] leading-relaxed text-white/40">Informações sincronizadas com segurança</p>
              </div>
            </div>
          </div>

          <p className="relative text-[10px] font-semibold text-white/30">
            Gastroenterologia pediátrica · Central de Cuidado
          </p>
        </section>

        <section className="flex min-h-dvh items-center justify-center px-4 py-10 sm:px-8 lg:px-12">
          <div className="w-full max-w-[470px]">
            <div className="mb-8 flex justify-center lg:hidden">
              <div className="rounded-[22px] bg-[#081b2c] px-6 py-4 shadow-[0_18px_40px_rgba(8,27,44,.18)]">
                <img
                  src={marca.src}
                  alt={marca.nome}
                  className="h-10 w-auto max-w-[180px] brightness-0 invert"
                />
              </div>
            </div>

            <div className="surface-card rounded-[30px] p-6 shadow-[0_24px_70px_rgba(8,27,44,.11)] sm:p-8">
              <div className="flex items-start gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-[#dceaf7] text-[#1f4f78]">
                  {mode === 'request' ? <UserRoundPlus className="h-5 w-5" /> : <LockKeyhole className="h-5 w-5" />}
                </span>
                <div>
                  <p className="text-[9px] font-extrabold uppercase tracking-[0.17em] text-[#1f4f78]">
                    {mode === 'login' ? 'Área restrita' : mode === 'reset' ? 'Recuperar acesso' : 'Solicitação de acesso'}
                  </p>
                  <h2 className="mt-1.5 text-2xl font-extrabold tracking-[-0.04em] text-[#081b2c]">
                    {mode === 'login' ? 'Acesse sua conta' : mode === 'reset' ? 'Esqueceu a senha?' : 'Peça seu acesso'}
                  </h2>
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">
                    {mode === 'login'
                      ? 'Entre com suas credenciais para acessar os dados da clínica.'
                      : mode === 'reset'
                        ? 'Informe o e-mail da sua conta. Enviamos um link para criar uma senha nova.'
                        : 'Seu cadastro só terá acesso depois da aprovação do administrador.'}
                  </p>
                </div>
              </div>

              {resetSent ? (
                <div className="mt-7 rounded-2xl border border-[#9fc2b8]/40 bg-[#edf7f3] p-5 text-center">
                  <ShieldCheck className="mx-auto h-7 w-7 text-[#4d8d7c]" />
                  <h3 className="mt-3 text-sm font-extrabold text-[#173b35]">Verifique seu e-mail</h3>
                  <p className="mt-2 text-xs leading-relaxed text-[#4d6e67]">
                    Se existir uma conta com este e-mail, o link para criar a senha nova chega em instantes. Olhe também na caixa de spam.
                  </p>
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className="mt-4 text-xs font-extrabold text-[#1a5f50] underline underline-offset-4"
                  >
                    Voltar para entrar
                  </button>
                </div>
              ) : requestSent ? (
                <div className="mt-7 rounded-2xl border border-[#9fc2b8]/40 bg-[#edf7f3] p-5 text-center">
                  <ShieldCheck className="mx-auto h-7 w-7 text-[#4d8d7c]" />
                  <h3 className="mt-3 text-sm font-extrabold text-[#173b35]">Solicitação enviada</h3>
                  <p className="mt-2 text-xs leading-relaxed text-[#4d6e67]">
                    O administrador da clínica vai revisar o pedido. Confirme seu e-mail, caso receba uma mensagem, e entre somente após a aprovação.
                  </p>
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className="mt-4 text-xs font-extrabold text-[#1a5f50] underline underline-offset-4"
                  >
                    Voltar para entrar
                  </button>
                </div>
              ) : (
              <form className="mt-7 space-y-4" onSubmit={handleSubmit} noValidate>
                {mode === 'request' && (
                  <label className="block">
                    <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-500">Seu nome</span>
                    <div className="relative mt-2">
                      <UserRoundPlus className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        autoComplete="name"
                        className={inputClass}
                        placeholder="Nome completo"
                        value={fullName}
                        disabled={disabled}
                        onChange={(event) => setFullName(event.target.value)}
                      />
                    </div>
                  </label>
                )}
                <label className="block">
                  <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-500">
                    E-mail
                  </span>
                  <div className="relative mt-2">
                    <Mail className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      className={inputClass}
                      placeholder="seuemail@clinica.com.br"
                      value={email}
                      disabled={disabled}
                      onChange={(event) => {
                        setEmail(event.target.value)
                        if (validationError) setValidationError(null)
                        if (authError) clearAuthError()
                      }}
                    />
                  </div>
                </label>

                {mode !== 'reset' && (
                <label className="block">
                  <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-500">
                    Senha
                  </span>
                  <div className="relative mt-2">
                    <LockKeyhole className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      className={`${inputClass} pr-12`}
                      placeholder="Sua senha"
                      value={password}
                      disabled={disabled}
                      onChange={(event) => {
                        setPassword(event.target.value)
                        if (validationError) setValidationError(null)
                        if (authError) clearAuthError()
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      disabled={disabled}
                      className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-slate-400 transition hover:bg-[#f3eee9] hover:text-[#1f4f78] disabled:pointer-events-none"
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </label>
                )}

                {mode === 'login' && (
                  <div className="-mt-1 text-right">
                    <button
                      type="button"
                      onClick={() => switchMode('reset')}
                      className="text-[11px] font-semibold text-[#416f65] underline underline-offset-4"
                    >
                      Esqueci minha senha
                    </button>
                  </div>
                )}

                {mode === 'request' && (
                  <label className="block">
                    <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-500">Confirmar senha</span>
                    <div className="relative mt-2">
                      <LockKeyhole className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        className={inputClass}
                        placeholder="Repita sua senha"
                        value={confirmPassword}
                        disabled={disabled}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                      />
                    </div>
                  </label>
                )}

                {visibleError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2.5 rounded-2xl border border-red-100 bg-red-50 px-3.5 py-3 text-[11px] font-semibold leading-relaxed text-red-600"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{visibleError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={disabled}
                  className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-[#081b2c] px-5 py-3.5 text-xs font-extrabold text-white shadow-[0_12px_26px_rgba(8,27,44,.18)] transition hover:-translate-y-0.5 hover:bg-[#102d47] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  {submitting ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/25 border-t-white" />
                      {mode === 'login' ? 'Entrando...' : mode === 'reset' ? 'Enviando link...' : 'Enviando pedido...'}
                    </>
                  ) : (
                    <>
                      {mode === 'login' ? 'Entrar com segurança' : mode === 'reset' ? 'Enviar link' : 'Solicitar aprovação'}
                      <ArrowRight className="h-4 w-4 text-[#6fadde] transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>
              </form>
              )}

              {!requestSent && !resetSent && <div className="mt-6 flex items-center gap-2 border-t border-[#081b2c]/[0.06] pt-5 text-[10px] leading-relaxed text-slate-400">
                <ShieldCheck className="h-4 w-4 shrink-0 text-[#6f9d91]" />
                {mode === 'login' ? (
                  <button type="button" onClick={() => switchMode('request')} className="text-left font-semibold text-[#416f65] underline underline-offset-4">
                    Não possui acesso? Solicite uma conta para aprovação.
                  </button>
                ) : (
                  <button type="button" onClick={() => switchMode('login')} className="text-left font-semibold text-[#416f65] underline underline-offset-4">
                    Já possui acesso aprovado? Entre por aqui.
                  </button>
                )}
              </div>}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
