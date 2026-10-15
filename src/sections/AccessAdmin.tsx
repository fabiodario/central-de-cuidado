import { useCallback, useEffect, useState } from 'react'
import { useDialogos } from '@/components/dialogos-contexto'
import { useAuth } from '@/auth/AuthProvider'
import { Check, Clock3, KeyRound, RefreshCw, ShieldCheck, UserRoundCheck, X } from 'lucide-react'
import PainelAdministracao from '@/sections/PainelAdministracao'
import {
  alterarAcesso,
  approveAccessRequest,
  getCurrentMembership,
  listarAcessos,
  type AcessoDaClinica,
  listPendingAccessRequests,
  rejectAccessRequest,
  type AccessRequest,
  type ClinicRole,
} from '@/lib/repository'

type AssignableRole = Exclude<ClinicRole, 'owner'>

const ROLE_LABEL: Record<AssignableRole, string> = {
  clinician: 'Profissional de saúde',
  staff: 'Equipe da clínica',
  viewer: 'Somente visualização',
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export default function AccessAdmin() {
  const [requests, setRequests] = useState<AccessRequest[]>([])
  const [roles, setRoles] = useState<Record<string, AssignableRole>>({})
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState<string | null>(null)
  const { perguntar } = useDialogos()
  const [error, setError] = useState('')
  // Quem ja tem acesso (24/09/2026). Antes a tela so tratava pedidos novos, e
  // nao havia como tirar o acesso de quem saiu da clinica.
  const [acessos, setAcessos] = useState<AcessoDaClinica[]>([])
  const [clinicId, setClinicId] = useState<string | null>(null)
  const { user } = useAuth()
  // Qualquer administrador promove a administrador; alterar um administrador
  // que ja existe, so o responsavel pelo sistema (migration 20260924160000).
  // O banco confere de novo; a tela so esconde.
  const souResponsavel = acessos.some((a) => a.userId === user?.id && a.protegido)
  // Painel "Administracao" (01/10/2026): so para o responsavel pelo sistema.
  const [administracaoAberta, setAdministracaoAberta] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const membership = await getCurrentMembership()
      if (!membership || membership.role !== 'owner') {
        throw new Error('Somente o administrador da clínica pode ver os pedidos de acesso.')
      }
      setClinicId(membership.clinicId)
      const [pending, vinculos] = await Promise.all([
        listPendingAccessRequests(membership.clinicId),
        // Se a funcao nova ainda nao existe no banco, a lista de pedidos
        // continua funcionando; so a secao de acessos fica vazia.
        listarAcessos(membership.clinicId).catch((erro) => {
          console.warn('Nao consegui listar os acessos', erro)
          return [] as AcessoDaClinica[]
        }),
      ])
      setAcessos(vinculos)
      setRequests(pending)
      setRoles((current) => {
        const next = { ...current }
        for (const request of pending) next[request.id] ??= 'staff'
        return next
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível carregar os pedidos de acesso.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function approve(request: AccessRequest) {
    setWorkingId(request.id)
    setError('')
    try {
      await approveAccessRequest(request.id, roles[request.id] ?? 'staff')
      setRequests((current) => current.filter((item) => item.id !== request.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível aprovar este acesso.')
    } finally {
      setWorkingId(null)
    }
  }

  async function mudarAcesso(
    acesso: AcessoDaClinica,
    papel: ClinicRole,
    situacao: 'active' | 'suspended',
  ) {
    if (!clinicId) return
    if (papel === 'owner' && acesso.papel !== 'owner') {
      const certeza = await perguntar({
        titulo: `Promover ${acesso.nome || acesso.email} a administrador?`,
        detalhe:
          'Poderá ver tudo, aprovar e suspender a equipe e mudar configurações. ' +
          'Não poderá alterar o acesso do responsável pelo sistema.',
        confirmar: 'Promover',
      })
      if (!certeza) return
    }
    if (situacao === 'suspended' && acesso.situacao === 'active') {
      const certeza = await perguntar({
        titulo: `Suspender o acesso de ${acesso.nome || acesso.email}?`,
        detalhe:
          'A pessoa deixa de ver qualquer dado da clínica na hora, mesmo que esteja com o sistema aberto. ' +
          'Você pode reativar depois.',
        confirmar: 'Suspender',
        perigo: true,
      })
      if (!certeza) return
    }
    setWorkingId(acesso.userId)
    setError('')
    try {
      await alterarAcesso(clinicId, acesso.userId, papel, situacao)
      setAcessos((atual) =>
        atual.map((a) => (a.userId === acesso.userId ? { ...a, papel, situacao } : a)),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível alterar este acesso.')
    } finally {
      setWorkingId(null)
    }
  }

  async function reject(request: AccessRequest) {
    const certeza = await perguntar({
      titulo: `Recusar o acesso de ${request.name}?`,
      detalhe: 'Esta pessoa continuará sem acesso aos dados da clínica. Ela pode pedir acesso de novo depois.',
      confirmar: 'Recusar',
      perigo: true,
    })
    if (!certeza) return
    setWorkingId(request.id)
    setError('')
    try {
      await rejectAccessRequest(request.id)
      setRequests((current) => current.filter((item) => item.id !== request.id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível recusar este acesso.')
    } finally {
      setWorkingId(null)
    }
  }

  return (
    <section className="space-y-5">
      <div className="grid gap-4 rounded-[26px] border border-[#081b2c]/[0.07] bg-white/80 p-5 shadow-sm sm:grid-cols-[auto_1fr_auto] sm:items-center sm:p-6">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#dceaf7] text-[#1f4f78]">
          <ShieldCheck className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-base font-extrabold tracking-[-0.02em] text-[#081b2c]">Aprovação obrigatória</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Um cadastro novo não enxerga nenhum paciente até você escolher o perfil e aprovar o pedido.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {souResponsavel && (
            <button
              type="button"
              onClick={() => setAdministracaoAberta((aberta) => !aberta)}
              aria-expanded={administracaoAberta}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#081b2c] px-4 py-3 text-xs font-extrabold text-white transition hover:bg-[#102d47]"
            >
              <KeyRound className="h-4 w-4" />
              Administração
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#081b2c]/10 bg-white px-4 py-3 text-xs font-extrabold text-[#385a70] transition hover:border-[#1f4f78]/40 hover:text-[#1f4f78] disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      {souResponsavel && administracaoAberta && clinicId && (
        <PainelAdministracao clinicId={clinicId} onFechar={() => setAdministracaoAberta(false)} />
      )}

      {error && (
        <div role="alert" className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-semibold text-red-600">
          {error}
        </div>
      )}

      {loading ? (
        <div className="surface-card rounded-[26px] p-8 text-center text-xs font-semibold text-slate-400">Carregando pedidos…</div>
      ) : requests.length === 0 ? (
        <div className="surface-card rounded-[26px] p-9 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#edf7f3] text-[#4d8d7c]">
            <UserRoundCheck className="h-5 w-5" />
          </span>
          <h2 className="mt-4 text-base font-extrabold text-[#081b2c]">Nenhum pedido pendente</h2>
          <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-slate-500">Quando alguém usar “Solicitar uma conta” na tela de entrada, o pedido aparece aqui.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {requests.map((request) => {
            const role = roles[request.id] ?? 'staff'
            const working = workingId === request.id
            return (
              <article key={request.id} className="surface-card rounded-[26px] p-5 sm:p-6">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#edf7f3] text-[#4d8d7c]">
                        <Clock3 className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-extrabold text-[#081b2c]">{request.name}</h3>
                        <p className="truncate text-xs text-slate-500">{request.email}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-[11px] font-semibold text-slate-400">Solicitado em {formatDate(request.requestedAt)}</p>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <select
                      value={role}
                      disabled={working}
                      onChange={(event) => setRoles((current) => ({ ...current, [request.id]: event.target.value as AssignableRole }))}
                      className="min-w-[210px] rounded-2xl border border-[#081b2c]/10 bg-[#fafaf8] px-4 py-3 text-xs font-bold text-[#385a70] outline-none focus:border-[#2f7fc1]"
                    >
                      {(Object.keys(ROLE_LABEL) as AssignableRole[]).map((value) => (
                        <option key={value} value={value}>{ROLE_LABEL[value]}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => void approve(request)}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#0e3d42] px-4 py-3 text-xs font-extrabold text-white transition hover:bg-[#14545a] disabled:opacity-60"
                    >
                      <Check className="h-4 w-4" /> Aprovar
                    </button>
                    <button
                      type="button"
                      disabled={working}
                      onClick={() => void reject(request)}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-extrabold text-red-600 transition hover:bg-red-100 disabled:opacity-60"
                    >
                      <X className="h-4 w-4" /> Recusar
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {acessos.length > 0 && (
        <div className="surface-card rounded-[26px] p-5 sm:p-6">
          <h2 className="text-sm font-extrabold text-[#081b2c]">Quem tem acesso</h2>
          <p className="mt-1 text-xs text-slate-500">
            Troque o perfil ou suspenda quem não trabalha mais na clínica. O acesso do responsável pelo sistema não muda por aqui.
          </p>
          <div className="mt-4 divide-y divide-[#081b2c]/[0.06]">
            {acessos.map((acesso) => {
              const dono = acesso.papel === 'owner'
              // Travado: o proprio acesso, o do responsavel, e o de outro
              // administrador para quem nao e o responsavel.
              const eu = acesso.userId === user?.id
              const travado = eu || acesso.protegido || (dono && !souResponsavel)
              const suspenso = acesso.situacao === 'suspended'
              const working = workingId === acesso.userId
              return (
                <div key={acesso.userId} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className={`truncate text-sm font-extrabold ${suspenso ? 'text-slate-400 line-through' : 'text-[#081b2c]'}`}>
                      {acesso.nome || acesso.email || 'Sem nome'}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {acesso.email}
                      {suspenso ? ' · suspenso' : ''}
                    </p>
                  </div>
                  {travado ? (
                    <span className="text-xs font-bold text-[#1f4f78]">
                      {acesso.protegido ? 'Responsável pelo sistema' : dono ? 'Administrador' : ROLE_LABEL[acesso.papel as AssignableRole]}
                      {eu ? ' (você)' : ''}
                    </span>
                  ) : (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <select
                        value={acesso.papel}
                        disabled={working || suspenso}
                        onChange={(e) => void mudarAcesso(acesso, e.target.value as ClinicRole, acesso.situacao)}
                        className="min-w-[190px] rounded-2xl border border-[#081b2c]/10 bg-[#fafaf8] px-3 py-2 text-xs font-bold text-[#385a70] outline-none focus:border-[#2f7fc1] disabled:opacity-60"
                      >
                        <option value="owner">Administrador</option>
                        {(Object.keys(ROLE_LABEL) as AssignableRole[]).map((value) => (
                          <option key={value} value={value}>{ROLE_LABEL[value]}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={working}
                        onClick={() =>
                          void mudarAcesso(acesso, acesso.papel, suspenso ? 'active' : 'suspended')
                        }
                        className={`inline-flex items-center justify-center rounded-2xl px-4 py-2 text-xs font-extrabold transition disabled:opacity-60 ${
                          suspenso
                            ? 'bg-[#0e3d42] text-white hover:bg-[#14545a]'
                            : 'border border-red-100 bg-red-50 text-red-600 hover:bg-red-100'
                        }`}
                      >
                        {suspenso ? 'Reativar' : 'Suspender'}
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

