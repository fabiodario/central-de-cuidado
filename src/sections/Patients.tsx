import { useEffect, useMemo, useRef, useState } from 'react'
import { useDialogos } from '@/components/dialogos-contexto'
import {
  CalendarDays,
  Check,
  CircleUserRound,
  FileText,
  Edit3,
  FileHeart,
  LayoutGrid,
  List as ListIcon,
  MapPin,
  MessageCircle,
  Plus,
  Search,
  Stethoscope,
  Archive,
  ArchiveRestore,
  UsersRound,
} from 'lucide-react'
import type { Consultation, ConsultationDraft, Patient } from '@/types/patient'
import type { PatientDraft } from '@/lib/store'
import PatientRecord from '@/sections/PatientRecord'
import { fmtBR, idade } from '@/lib/followup'
import { editarComMascara, mascararCpf, mascararTelefone } from '@/lib/mascaras'
import { FOLLOWUP_LABEL } from '@/types/patient'
import { opcoesDeUnidade, useUnidades } from '@/lib/unidades'
import { apagarParametrosDoEndereco, parametrosDoEndereco } from '@/lib/endereco'
import { useVoltarDoCelular } from '@/lib/voltar-do-celular'
import { publicoDaClinica } from '@/lib/publico'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

/**
 * Sugere o sexo pelo primeiro nome.
 *
 * Regra de terminacao, que da conta da maioria dos nomes brasileiros, mais uma
 * lista curta para o que a regra erraria ou nao alcancaria.
 *
 * Devolve null quando nao ha confianca, e nesse caso o campo fica como estava.
 * Chutar aqui e pior do que deixar a pessoa escolher: sexo entra no calculo de
 * percentil de crescimento, que e metade de uma consulta de gastropediatria.
 */
const NOME_FEMININO = new Set([
  'beatriz', 'iris', 'isis', 'ester', 'esther', 'raquel', 'rachel', 'isabel', 'ingrid',
  'karen', 'karin', 'carmen', 'ruth', 'miriam', 'noemi', 'ellen', 'helen', 'nicole',
  'alice', 'denise', 'thais', 'tais', 'lais', 'ines', 'mercedes', 'jasmim', 'yasmin',
  'esther', 'lorena', 'agnes', 'sol',
])
const NOME_MASCULINO = new Set([
  'luca', 'nicola', 'noa', 'gabriel', 'rafael', 'miguel', 'daniel', 'samuel', 'ismael',
  'israel', 'joel', 'emanuel', 'manuel', 'matheus', 'mateus', 'lucas', 'nicolas', 'davi',
  'david', 'levi', 'vinicius', 'anderson', 'jefferson', 'wesley', 'kaique', 'felipe',
  'alexandre', 'andre', 'vicente', 'henrique', 'jorge', 'enzo', 'ravi', 'yuri', 'igor',
  'heitor', 'arthur', 'artur', 'benjamin', 'bernardo', 'joao', 'luiz', 'luis', 'thomas',
])

function sexoPeloNome(nomeCompleto: string): 'F' | 'M' | null {
  const primeiro = nomeCompleto
    .trim()
    .split(/\s+/)[0]
    ?.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  if (!primeiro || primeiro.length < 3) return null

  if (NOME_FEMININO.has(primeiro)) return 'F'
  if (NOME_MASCULINO.has(primeiro)) return 'M'

  const fim = primeiro.at(-1)
  if (fim === 'a') return 'F'
  if (fim === 'o') return 'M'
  return null
}

/**
 * Casa o nome da unidade da agenda com a opcao do cadastro.
 *
 * Desde 31/08/2026 as duas listas usam a mesma grafia, entao a comparacao
 * exata bastaria. A tolerancia a acento e pontuacao fica como rede: unidade
 * cadastrada a mao na agenda pode sair com hifen ou sem acento, e e melhor
 * casar mesmo assim do que deixar o campo em branco sem explicar por que.
 */
function unidadeEquivalente(nomeDaAgenda: string, opcoes: string[]): string | null {
  const limpar = (v: string) =>
    v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase()
  const alvo = limpar(nomeDaAgenda)
  if (!alvo) return null
  return opcoes.find((opcao) => limpar(opcao) === alvo) ?? null
}

/**
 * "12/03/2019" -> "2019-03-12". Devolve null para qualquer outra coisa.
 *
 * A familia responde no WhatsApp em texto livre, e "marco de 2019" e resposta
 * legitima. O que nao vira data entra em branco no cadastro, e o campo fica
 * visivelmente vazio para alguem perguntar - melhor do que uma data inventada.
 */
function dataDoTexto(texto?: string): string | null {
  const m = (texto ?? '').trim().match(/^(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})$/)
  if (!m) return null
  const [, dia, mes, ano] = m
  const iso = `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`
  const data = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(data.getTime()) || data > new Date()) return null
  return iso
}

/**
 * Etiqueta do cadastro que o sistema criou sozinho na vespera da consulta.
 *
 * Existe para que ninguem confunda dado declarado por mensagem com dado
 * conferido. Some no instante em que alguem abre o cadastro e salva.
 */
function AConferir() {
  // Quem informou os dados: o paciente no otorrino, a familia na pediatria
  // (15/10/2026, ver publico.ts).
  const geral = publicoDaClinica() === 'geral'
  return (
    <span
      title={`Cadastro criado pelo sistema a partir do agendamento no WhatsApp. Abra, confira com ${
        geral ? 'o paciente' : 'a família'
      } e salve.`}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#e1eef8] px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-[#1f4f78]"
    >
      A conferir
    </span>
  )
}

function emptyDraft(unidadePadrao = ''): PatientDraft {
  return {
    nome: '',
    responsavel: '',
    nascimento: '',
    sexo: 'F',
    cpf: '',
    email: '',
    telefone: '',
    cidade: '',
    bairro: '',
    convenio: '',
    cid: '',
    unidade: unidadePadrao,
    dataConsulta: new Date().toISOString().slice(0, 10),
    observacoes: '',
  }
}

const inputClass =
  'mt-1.5 w-full rounded-[13px] border border-[#081b2c]/10 bg-[#fafaf8] px-3.5 py-2.5 text-xs font-semibold text-[#081b2c] outline-none transition placeholder:font-normal placeholder:text-slate-300 focus:border-[#2f7fc1] focus:bg-white focus:ring-4 focus:ring-[#2f7fc1]/10'

function Field({
  label,
  children,
  required,
  className = '',
}: {
  label: string
  children: React.ReactNode
  required?: boolean
  className?: string
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-slate-500">
        {label}
        {required && <span className="ml-1 text-[#2f7fc1]">*</span>}
      </span>
      {children}
    </label>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, { text: string; className: string }> = {
    pendente: { text: 'Pendente', className: 'bg-[#e4f0fb] text-[#1f5c88]' },
    enviado: { text: 'Aberto', className: 'bg-[#e8f0f8] text-[#4d6f91]' },
    concluido: { text: 'Concluído', className: 'bg-[#e7f3ef] text-[#4d7c70]' },
  }
  const style = styles[status] ?? styles.pendente
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[8px] font-extrabold uppercase tracking-[0.08em] ${style.className}`}>
      {status === 'concluido' && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
      {style.text}
    </span>
  )
}

function initials(name: string) {
  return name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

interface Props {
  patients: Patient[]
  addPatient: (draft: PatientDraft) => Promise<Patient>
  updatePatient: (id: string, patch: Partial<Patient>) => Promise<void>
  removePatient: (id: string) => Promise<void>
  /** Pacientes arquivados, para a gaveta de arquivados. */
  listArchived: () => Promise<Patient[]>
  restorePatient: (id: string) => Promise<void>
  listConsultations: (patientId: string) => Promise<Consultation[]>
  addConsultation: (patientId: string, draft: ConsultationDraft) => Promise<void>
  updateConsultation: (patientId: string, consultationId: string, draft: ConsultationDraft) => Promise<void>
  openCreateSignal?: number
  /** Nome e telefone trazidos de uma conversa ou consulta, para adiantar o cadastro. */
  preCadastro?: {
    nome: string
    telefone: string
    /** Data da consulta que originou o cadastro, quando veio da agenda. */
    dataConsulta?: string
    /** Nome da unidade da consulta, como aparece na agenda. */
    unidade?: string
    /** O que a familia respondeu ao robo do WhatsApp. Texto livre, nao conferido. */
    nascimento?: string
    responsavel?: string
    cpf?: string
    email?: string
  } | null
  /**
   * Chamado depois de salvar um cadastro que veio de outra tela. Quando existe,
   * o prontuario NAO abre sozinho: quem veio da agenda quer voltar para a
   * agenda, nao cair no registro clinico.
   */
  onPacienteCriado?: () => void
  /**
   * Prontuario pedido pela Agenda (15/10/2026). Abre ao chegar, e fechar
   * devolve o medico para a Agenda, de onde ele veio.
   */
  abrirProntuarioDe?: string | null
  /** O pedido foi atendido: o Home esquece, para nao reabrir na proxima visita. */
  onProntuarioDaAgendaAberto?: () => void
  onVoltarParaAgenda?: () => void
}

export default function Patients({
  patients,
  addPatient,
  updatePatient,
  removePatient,
  listArchived,
  restorePatient,
  listConsultations,
  addConsultation,
  updateConsultation,
  openCreateSignal = 0,
  preCadastro = null,
  onPacienteCriado,
  abrirProntuarioDe = null,
  onProntuarioDaAgendaAberto,
  onVoltarParaAgenda,
}: Props) {
  const unidadesDaClinica = useUnidades()
  const { avisar, perguntar } = useDialogos()
  // Otorrino atende adulto e crianca; a pediatria, so crianca (15/10/2026,
  // ver publico.ts). O responsavel, no otorrino, e de menor de idade, como na
  // ficha do robo.
  const geral = publicoDaClinica() === 'geral'
  const [query, setQuery] = useState('')
  // Lista simples e o padrao: cabe mais paciente na tela e a busca visual e
  // mais rapida. O modo de cartoes continua a um clique.
  const [visao, setVisao] = useState<'lista' | 'cartoes'>('lista')
  // Gaveta de arquivados. Arquivar nao apaga (prontuario se guarda por 20
  // anos), entao precisa existir um lugar para ver quem esta la e trazer de
  // volta - sem isso "arquivar" parece "apagar" e ninguem clica.
  const [mostrandoArquivados, setMostrandoArquivados] = useState(false)
  const [arquivados, setArquivados] = useState<Patient[] | null>(null)
  const [restaurando, setRestaurando] = useState<string | null>(null)

  async function abrirArquivados() {
    setMostrandoArquivados(true)
    try {
      setArquivados(await listArchived())
    } catch (cause) {
      avisar(cause instanceof Error ? cause.message : 'Não foi possível listar os arquivados.', 'erro')
      setMostrandoArquivados(false)
    }
  }

  async function arquivar(patient: Patient) {
    const certeza = await perguntar({
      titulo: `Arquivar o cadastro de ${patient.nome}?`,
      detalhe:
        'Ele sai das listas e dos acompanhamentos, mas nada é apagado: o prontuário continua guardado e dá para restaurar em "Arquivados".',
      confirmar: 'Arquivar',
    })
    if (!certeza) return
    try {
      await removePatient(patient.id)
    } catch (cause) {
      avisar(cause instanceof Error ? cause.message : 'Não foi possível arquivar o paciente.', 'erro')
    }
  }

  async function restaurar(patient: Patient) {
    setRestaurando(patient.id)
    try {
      await restorePatient(patient.id)
      setArquivados((atual) => (atual ?? []).filter((item) => item.id !== patient.id))
    } catch (cause) {
      avisar(cause instanceof Error ? cause.message : 'Não foi possível restaurar o paciente.', 'erro')
    } finally {
      setRestaurando(null)
    }
  }
  const [ordem, setOrdem] = useState<'nome' | 'consulta'>('nome')
  const [mesFiltro, setMesFiltro] = useState('')
  const [anoFiltro, setAnoFiltro] = useState('')
  const [filtroAberto, setFiltroAberto] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<PatientDraft>(emptyDraft)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [recordPatientId, setRecordPatientId] = useState<string | null>(null)
  const [startConsultationPatientId, setStartConsultationPatientId] = useState<string | null>(null)
  // Verdadeiro quando o sexo veio de palpite pelo nome, e nao de escolha da
  // equipe. So serve para avisar na tela que aquilo precisa de conferencia.
  const [sexoSugerido, setSexoSugerido] = useState(false)

  useEffect(() => {
    if (openCreateSignal <= 0) return
    setEditingId(null)
    // O que vem da conversa ou da consulta e preenchido; o resto do formulario
    // continua em branco de proposito, para ninguem salvar dado presumido.
    const sugerido = preCadastro
      ? {
          nome: preCadastro.nome,
          telefone: mascararTelefone(preCadastro.telefone),
          ...(preCadastro.dataConsulta ? { dataConsulta: preCadastro.dataConsulta } : {}),
          ...(preCadastro.unidade &&
          unidadeEquivalente(preCadastro.unidade, opcoesDeUnidade(unidadesDaClinica))
            ? { unidade: unidadeEquivalente(preCadastro.unidade, opcoesDeUnidade(unidadesDaClinica))! }
            : {}),
          ...((sexoPeloNome(preCadastro.nome) && { sexo: sexoPeloNome(preCadastro.nome)! }) || {}),
          // A ficha do WhatsApp entra preenchida, para a equipe conferir em vez
          // de digitar. A data so entra quando e uma data de verdade: "março de
          // 2019" fica de fora e a recepcao pergunta.
          ...(dataDoTexto(preCadastro.nascimento) ? { nascimento: dataDoTexto(preCadastro.nascimento)! } : {}),
          ...(preCadastro.responsavel ? { responsavel: preCadastro.responsavel } : {}),
          ...(preCadastro.cpf ? { cpf: mascararCpf(preCadastro.cpf) } : {}),
          ...(preCadastro.email ? { email: preCadastro.email } : {}),
        }
      : {}
    setForm({ ...emptyDraft(unidadesDaClinica[0]), ...sugerido })
    setSexoSugerido(Boolean(preCadastro?.nome && sexoPeloNome(preCadastro.nome)))
    setError('')
    setFormOpen(true)
    // preCadastro fica fora das dependencias: quem manda abrir o formulario e o
    // sinal. Reagir ao objeto reabriria a tela a cada render do pai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCreateSignal])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    let lista = patients

    if (normalized) {
      lista = lista.filter((patient) =>
        [patient.nome, patient.responsavel, patient.cidade, patient.bairro, patient.cid, patient.convenio]
          .join(' ')
          .toLowerCase()
          .includes(normalized),
      )
    }

    // Filtro por periodo da consulta. Mes vazio significa o ano inteiro.
    if (anoFiltro) {
      lista = lista.filter((patient) => {
        if (!patient.dataConsulta) return false
        const [ano, mes] = patient.dataConsulta.split('-')
        if (ano !== anoFiltro) return false
        return mesFiltro ? mes === mesFiltro : true
      })
    }

    // Ordenacao alfabetica respeitando acentos do portugues.
    const ordenada = [...lista]
    if (ordem === 'nome') {
      ordenada.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }))
    } else {
      ordenada.sort((a, b) => (b.dataConsulta || '').localeCompare(a.dataConsulta || ''))
    }
    return ordenada
  }, [patients, query, ordem, mesFiltro, anoFiltro])

  /** Anos que realmente existem na base, para o filtro nao oferecer vazio. */
  const anosDisponiveis = useMemo(() => {
    const anos = new Set<string>()
    for (const patient of patients) {
      if (patient.dataConsulta) anos.add(patient.dataConsulta.slice(0, 4))
    }
    return [...anos].sort((a, b) => b.localeCompare(a))
  }, [patients])

  const recordPatient = useMemo(
    () => patients.find((patient) => patient.id === recordPatientId) ?? null,
    [patients, recordPatientId],
  )

  // Veio da Agenda? Entao fechar o prontuario volta para la. Ref, e nao estado:
  // so decide para onde ir no fechamento, nao muda nada na tela.
  const veioDaAgenda = useRef(false)
  function fecharProntuario() {
    setRecordPatientId(null)
    setStartConsultationPatientId(null)
    if (veioDaAgenda.current) {
      veioDaAgenda.current = false
      onVoltarParaAgenda?.()
    }
  }
  // O voltar do celular fecha o prontuario, como o X (ver useVoltarDoCelular).
  // O rascunho do atendimento ja se salva sozinho enquanto o medico escreve.
  useVoltarDoCelular(recordPatient !== null, fecharProntuario)

  useEffect(() => {
    if (!abrirProntuarioDe) return
    veioDaAgenda.current = true
    setRecordPatientId(abrirProntuarioDe)
    onProntuarioDaAgendaAberto?.()
    // O aviso ao Home fica fora das dependencias: e uma funcao nova a cada
    // render do pai, e reagir a ela reabriria o prontuario sem parar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirProntuarioDe])

  /**
   * Reabre o prontuario quando o medico volta da assinatura.
   *
   * Assinar leva o navegador para o VIDaaS e o traz de volta com o sistema
   * recarregado do zero - sem isto ele voltaria para a lista de pacientes, e o
   * aviso de "assinado" apareceria numa tela fechada. O paciente vai no
   * endereco de retorno justamente para o sistema saber onde ele estava.
   *
   * O parametro nao e apagado aqui: quem apaga e o proprio prontuario, junto
   * com o numero do pedido, depois de concluir a assinatura.
   */
  useEffect(() => {
    const paciente = parametrosDoEndereco().get('paciente')
    if (!paciente) return

    setRecordPatientId(paciente)
    // Limpa depois de usar: sem isto, um F5 reabriria o prontuario sozinho
    // toda vez, e a pessoa nao entenderia por que.
    apagarParametrosDoEndereco(['paciente'])
  }, [])

  function set<K extends keyof PatientDraft>(key: K, value: PatientDraft[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function createNew() {
    setEditingId(null)
    setSexoSugerido(false)
    setForm(emptyDraft(unidadesDaClinica[0]))
    setError('')
    setFormOpen(true)
  }

  function editRegistration(patient: Patient) {
    setEditingId(patient.id)
    setSexoSugerido(false)
    setForm({
      nome: patient.nome,
      responsavel: patient.responsavel,
      nascimento: patient.nascimento,
      sexo: patient.sexo,
      // Com mascara ao abrir; o repositorio tira de novo antes de gravar.
      telefone: mascararTelefone(patient.telefone),
      cpf: mascararCpf(patient.cpf ?? ''),
      email: patient.email ?? '',
      cidade: patient.cidade,
      bairro: patient.bairro,
      convenio: patient.convenio,
      cid: patient.cid,
      unidade: patient.unidade,
      dataConsulta: patient.dataConsulta,
      observacoes: patient.observacoes,
    })
    setError('')
    setFormOpen(true)
  }

  /**
   * `abrirProntuario` decide o que acontece depois de gravar.
   *
   * Quem cadastra nem sempre e quem atende: a secretaria organiza a fila e nao
   * precisa do registro clinico. Antes esse destino era adivinhado pela tela de
   * onde a pessoa veio; agora e escolha explicita, no botao.
   */
  async function save(abrirProntuario = false) {
    if (!form.nome.trim()) {
      setError('Informe o nome do paciente.')
      return
    }
    if (form.telefone.replace(/\D/g, '').length < 10) {
      setError('Informe um telefone válido com DDD.')
      return
    }
    if (!form.dataConsulta) {
      setError('Informe a data da consulta.')
      return
    }

    setSaving(true)
    try {
      if (editingId) {
        await updatePatient(editingId, form)
      } else {
        const patient = await addPatient(form)
        if (abrirProntuario) {
          setRecordPatientId(patient.id)
          setStartConsultationPatientId(patient.id)
        } else if (preCadastro && onPacienteCriado) {
          // Veio da agenda ou das conversas e nao pediu prontuario: devolve a
          // pessoa para onde ela estava trabalhando.
          onPacienteCriado()
        }
      }
      setFormOpen(false)
      setEditingId(null)
      setForm(emptyDraft())
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível salvar o paciente.')
    } finally {
      setSaving(false)
    }
  }

  function handleOpenChange(open: boolean) {
    setFormOpen(open)
    if (!open) setError('')
  }

  return (
    <div className="space-y-5">
      <section className="surface-card overflow-hidden rounded-[26px]">
        <div className="grid md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] bg-[#dceaf7] text-[#1f4f78]">
                <UsersRound className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#1f4f78]">Base ativa</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-3xl font-extrabold tracking-[-0.05em] text-[#081b2c]">{patients.length}</span>
                  <span className="text-xs font-semibold text-slate-400">{patients.length === 1 ? 'paciente cadastrado' : 'pacientes cadastrados'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-[#081b2c]/[0.06] p-4 md:border-l md:border-t-0 md:p-5">
            <button
              type="button"
              onClick={createNew}
              className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1f4f78] px-5 py-3 text-xs font-extrabold text-white shadow-[0_10px_24px_rgba(31,79,120,.24)] transition hover:-translate-y-0.5 hover:bg-[#183f61]"
            >
              <Plus className="h-4 w-4 transition-transform group-hover:rotate-90" />
              Cadastrar paciente
            </button>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="w-full rounded-2xl border border-[#081b2c]/[0.08] bg-white/80 py-3 pl-11 pr-4 text-xs font-semibold text-[#081b2c] shadow-sm outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-[#2f7fc1]/60 focus:bg-white focus:ring-4 focus:ring-[#2f7fc1]/10"
            placeholder="Buscar por nome, responsável, cidade, CID ou convênio"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Buscar pacientes"
          />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <div className="flex rounded-xl bg-[#eef3f2] p-0.5">
            <button
              type="button"
              onClick={() => setOrdem('nome')}
              className={`rounded-lg px-2.5 py-1.5 text-[10px] font-extrabold transition ${ordem === 'nome' ? 'bg-white text-[#081b2c] shadow-sm' : 'text-[#557f75]'}`}
              title="Ordenar por nome"
            >
              A-Z
            </button>
            <button
              type="button"
              onClick={() => setOrdem('consulta')}
              className={`rounded-lg px-2.5 py-1.5 text-[10px] font-extrabold transition ${ordem === 'consulta' ? 'bg-white text-[#081b2c] shadow-sm' : 'text-[#557f75]'}`}
              title="Ordenar pela consulta mais recente"
            >
              Consulta
            </button>
          </div>

          <button
            type="button"
            onClick={() => setFiltroAberto((aberto) => !aberto)}
            className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[10px] font-extrabold transition ${
              anoFiltro ? 'bg-[#081b2c] text-white' : 'bg-[#eef3f2] text-[#557f75] hover:bg-[#e2ece9]'
            }`}
            title="Filtrar por período da consulta"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            {anoFiltro ? `${mesFiltro ? mesFiltro + '/' : ''}${anoFiltro}` : 'Período'}
          </button>

          <button
            type="button"
            onClick={() => setVisao((atual) => (atual === 'lista' ? 'cartoes' : 'lista'))}
            className="inline-flex items-center gap-1 rounded-xl bg-[#eef3f2] px-2.5 py-1.5 text-[10px] font-extrabold text-[#557f75] transition hover:bg-[#e2ece9]"
            title={visao === 'lista' ? 'Ver em blocos' : 'Ver em lista'}
          >
            {visao === 'lista' ? <LayoutGrid className="h-3.5 w-3.5" /> : <ListIcon className="h-3.5 w-3.5" />}
            {visao === 'lista' ? 'Blocos' : 'Lista'}
          </button>

          <button
            type="button"
            onClick={() => (mostrandoArquivados ? setMostrandoArquivados(false) : void abrirArquivados())}
            className={`inline-flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[10px] font-extrabold transition ${
              mostrandoArquivados
                ? 'bg-[#081b2c] text-white'
                : 'bg-[#f3f1ec] text-slate-500 hover:bg-[#ebe8e1] hover:text-[#081b2c]'
            }`}
            title="Pacientes arquivados"
          >
            <Archive className="h-3.5 w-3.5" />
            {mostrandoArquivados ? 'Voltar aos ativos' : 'Arquivados'}
          </button>

          <p className="px-1 text-[10px] font-bold text-slate-400">
            {filtered.length} {filtered.length === 1 ? 'resultado' : 'resultados'}
          </p>
        </div>
      </div>

      {filtroAberto && (
        <div className="flex flex-wrap items-end gap-2 rounded-[18px] border border-[#081b2c]/[0.08] bg-white/80 p-3">
          <label className="block">
            <span className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">Mês</span>
            <select
              value={mesFiltro}
              onChange={(event) => setMesFiltro(event.target.value)}
              className="mt-1 block rounded-xl border border-[#081b2c]/10 bg-white px-2 py-1.5 text-[11px] outline-none"
            >
              <option value="">Todos</option>
              {[
                'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
              ].map((nome, indice) => (
                <option key={nome} value={String(indice + 1).padStart(2, '0')}>
                  {nome}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">Ano</span>
            <select
              value={anoFiltro}
              onChange={(event) => setAnoFiltro(event.target.value)}
              className="mt-1 block rounded-xl border border-[#081b2c]/10 bg-white px-2 py-1.5 text-[11px] outline-none"
            >
              <option value="">Todos</option>
              {anosDisponiveis.map((ano) => (
                <option key={ano} value={ano}>
                  {ano}
                </option>
              ))}
            </select>
          </label>
          {(anoFiltro || mesFiltro) && (
            <button
              type="button"
              onClick={() => {
                setMesFiltro('')
                setAnoFiltro('')
              }}
              className="rounded-xl bg-[#eef3f2] px-3 py-1.5 text-[10px] font-extrabold text-[#557f75]"
            >
              Limpar
            </button>
          )}
          <p className="text-[10px] text-slate-400">
            O mês sozinho não filtra; escolha o ano para o período valer.
          </p>
        </div>
      )}

      {filtered.length === 0 && !mostrandoArquivados ? (
        <section className="surface-card rounded-[26px] px-6 py-14 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-[20px] bg-[#dceaf7] text-[#1f4f78]">
            <CircleUserRound className="h-7 w-7" />
          </span>
          <h2 className="mt-4 text-base font-extrabold text-[#081b2c]">
            {patients.length === 0 ? 'Cadastre seu primeiro paciente' : 'Nenhum paciente encontrado'}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-slate-400">
            {patients.length === 0
              ? 'O cadastro alimenta os indicadores e programa automaticamente os acompanhamentos de 15, 30 e 90 dias.'
              : 'Tente buscar por outro nome, cidade, responsável ou diagnóstico.'}
          </p>
          {patients.length === 0 && (
            <button type="button" onClick={createNew} className="mt-5 rounded-xl bg-[#081b2c] px-4 py-2.5 text-[10px] font-extrabold text-white">
              Começar cadastro
            </button>
          )}
        </section>
      ) : mostrandoArquivados ? (
        <div className="surface-card overflow-hidden rounded-[22px]">
          {arquivados === null ? (
            <p className="px-4 py-8 text-center text-[11px] font-semibold text-slate-400">Carregando arquivados...</p>
          ) : arquivados.length === 0 ? (
            <p className="px-4 py-8 text-center text-[11px] font-semibold text-slate-400">Nenhum paciente arquivado.</p>
          ) : (
            arquivados.map((patient, indice) => (
              <div
                key={patient.id}
                className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${indice > 0 ? 'border-t border-[#081b2c]/[0.06]' : ''}`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] bg-[#f3f1ec] text-[10px] font-extrabold text-slate-400">
                  {initials(patient.nome)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-extrabold uppercase text-slate-500">{patient.nome}</p>
                  <p className="truncate text-[10px] text-slate-400">
                    {[
                      patient.dataConsulta ? `Consulta ${fmtBR(patient.dataConsulta)}` : null,
                      [patient.cidade, patient.bairro].filter(Boolean).join(' · ') || null,
                    ]
                      .filter(Boolean)
                      .join('  ·  ')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void restaurar(patient)}
                  disabled={restaurando === patient.id}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#eef3f2] px-2.5 py-1.5 text-[10px] font-extrabold text-[#557f75] transition hover:bg-[#e2ece9] disabled:opacity-50"
                >
                  <ArchiveRestore className="h-3.5 w-3.5" />
                  {restaurando === patient.id ? 'Restaurando...' : 'Restaurar'}
                </button>
              </div>
            ))
          )}
        </div>
      ) : visao === 'lista' ? (
        <div className="surface-card overflow-hidden rounded-[22px]">
          {filtered.map((patient, indice) => (
            <div
              key={patient.id}
              className={`flex flex-wrap items-center gap-3 px-4 py-2.5 transition hover:bg-[#fafaf8] ${
                indice > 0 ? 'border-t border-[#081b2c]/[0.06]' : ''
              }`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px] bg-[#eef3f2] text-[10px] font-extrabold text-[#557f75]">
                {patient.nome
                  .split(' ')
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((parte) => parte[0])
                  .join('')
                  .toUpperCase()}
              </span>

              <div className="min-w-0 flex-1">
                {/* No celular o nome quebra em ate duas linhas e a etiqueta
                    desce para baixo dele (02/10/2026): cortado em "AGATHA
                    BE..." ninguem achava o paciente pela lista. */}
                <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 sm:flex-nowrap">
                  {/* Maiuscula so na exibicao: o cadastro guarda o nome como
                      foi escrito, e e assim que ele sai na receita e no
                      prontuario. Aqui a lista fica uniforme, sem depender de
                      quem digitou ter caprichado. */}
                  <p className="line-clamp-2 min-w-0 break-words text-xs font-extrabold uppercase leading-snug text-[#081b2c] sm:truncate">
                    {patient.nome}
                  </p>
                  {patient.criadoAutomaticamenteEm && <AConferir />}
                </div>
                <p className="truncate text-[10px] text-slate-400">
                  {[
                    patient.dataConsulta ? `Consulta ${fmtBR(patient.dataConsulta)}` : null,
                    [patient.cidade, patient.bairro].filter(Boolean).join(' · ') || null,
                    patient.convenio || null,
                  ]
                    .filter(Boolean)
                    .join('  ·  ')}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {/* No celular, so o icone: a palavra "Prontuario" comia a
                    metade do espaco do nome. */}
                <button
                  type="button"
                  onClick={() => setRecordPatientId(patient.id)}
                  aria-label={`Prontuário de ${patient.nome}`}
                  title="Prontuário"
                  className="flex items-center gap-1 rounded-lg bg-[#eef3f2] p-2 text-[10px] font-extrabold text-[#557f75] transition hover:bg-[#e2ece9] sm:px-2.5 sm:py-1.5"
                >
                  <FileText className="h-4 w-4 sm:hidden" />
                  <span className="hidden sm:inline">Prontuário</span>
                </button>
                <button
                  type="button"
                  onClick={() => editRegistration(patient)}
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-[#081b2c]"
                  aria-label={`Editar ${patient.nome}`}
                >
                  <Edit3 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void arquivar(patient)}
                  className="rounded-lg p-1.5 text-slate-300 transition hover:bg-[#f3f1ec] hover:text-[#081b2c]"
                  aria-label={`Arquivar ${patient.nome}`}
                  title="Arquivar (não apaga; fica em Arquivados)"
                >
                  <Archive className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {filtered.map((patient) => (
            <article
              key={patient.id}
              className="surface-card group rounded-[24px] p-4 transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(8,27,44,.075)] sm:p-5"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] bg-[#eef3f2] text-xs font-extrabold text-[#557f75]">
                  {initials(patient.nome)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <h2 className="truncate text-sm font-extrabold uppercase tracking-[-0.01em] text-[#081b2c]">{patient.nome}</h2>
                        {patient.criadoAutomaticamenteEm && <AConferir />}
                      </div>
                      <p className="mt-1 text-[10px] font-semibold text-slate-400">
                        {idade(patient.nascimento)} · {patient.sexo === 'F' ? 'Feminino' : patient.sexo === 'M' ? 'Masculino' : 'Outro / NI'}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => setRecordPatientId(patient.id)}
                        title="Abrir prontuário completo"
                        className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 transition hover:bg-[#f3eee9] hover:text-[#1f4f78]"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void arquivar(patient)}
                        title="Arquivar (não apaga; fica em Arquivados)"
                        className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 transition hover:bg-[#f3f1ec] hover:text-[#081b2c]"
                      >
                        <Archive className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#f7f6f3] px-2.5 py-1.5 text-[9px] font-bold text-slate-500">
                      <CalendarDays className="h-3 w-3 text-[#2f7fc1]" />
                      Consulta {fmtBR(patient.dataConsulta)}
                    </span>
                    {(patient.cidade || patient.bairro) && (
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#f7f6f3] px-2.5 py-1.5 text-[9px] font-bold text-slate-500">
                        <MapPin className="h-3 w-3 text-[#6f9d91]" />
                        {[patient.cidade, patient.bairro].filter(Boolean).join(' · ')}
                      </span>
                    )}
                    {patient.cid && (
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#f7f6f3] px-2.5 py-1.5 text-[9px] font-bold text-slate-500">
                        <Stethoscope className="h-3 w-3 text-[#081b2c]" />
                        CID {patient.cid.toUpperCase()}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-[#081b2c]/[0.06] pt-3">
                {(['d15', 'd30', 'm90'] as const).map((key) => (
                  <div key={key} className="flex items-center justify-between gap-2 rounded-xl bg-[#faf9f7] px-2.5 py-2">
                    <span className="text-[9px] font-extrabold text-slate-400">{FOLLOWUP_LABEL[key]}</span>
                    <StatusBadge status={patient.followups[key].status} />
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setRecordPatientId(patient.id)}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-[13px] border border-[#557f75]/15 bg-[#eef3f2] px-4 py-2.5 text-[10px] font-extrabold text-[#557f75] transition hover:-translate-y-0.5 hover:border-[#557f75]/25 hover:bg-[#e5efec]"
              >
                <FileHeart className="h-3.5 w-3.5" />
                Abrir prontuário
              </button>

              {(patient.responsavel || patient.convenio || patient.observacoes) && (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-semibold text-slate-400">
                  {patient.responsavel && (
                    <span className="inline-flex items-center gap-1"><CircleUserRound className="h-3 w-3" /> Resp. {patient.responsavel}</span>
                  )}
                  {patient.convenio && <span>Convênio: {patient.convenio}</span>}
                  {patient.telefone && (
                    <span className="inline-flex items-center gap-1"><MessageCircle className="h-3 w-3" /> {patient.telefone}</span>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <Sheet open={formOpen} onOpenChange={handleOpenChange}>
        <SheetContent
          side="left"
          className="w-full gap-0 border-r border-[#081b2c]/10 bg-[#fbfaf8] p-0 sm:max-w-[660px]"
        >
          <SheetHeader className="border-b border-[#081b2c]/[0.07] bg-white px-5 pb-5 pt-6 sm:px-7">
            <div className="flex items-center gap-3 pr-8">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] bg-[#dceaf7] text-[#1f4f78]">
                {editingId ? <Edit3 className="h-5 w-5" /> : <FileHeart className="h-5 w-5" />}
              </span>
              <div>
                <SheetTitle className="text-left text-lg font-extrabold tracking-[-0.03em] text-[#081b2c]">
                  {editingId ? 'Editar paciente' : 'Novo paciente'}
                </SheetTitle>
                <SheetDescription className="mt-1 text-left text-[11px]">
                  {editingId
                    ? 'Atualize os dados de identificação e contato do paciente.'
                    : 'Dados básicos de identificação e contato. O prontuário só abre se você escolher, no botão do rodapé.'}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="scrollbar-subtle flex-1 overflow-y-auto px-5 py-6 sm:px-7">
            <div className="mb-5 flex items-center gap-2">
              <span className="h-px flex-1 bg-[#081b2c]/[0.07]" />
              <span className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-slate-400">Identificação, contato e endereço</span>
              <span className="h-px flex-1 bg-[#081b2c]/[0.07]" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome do paciente" required className="sm:col-span-2">
                <input className={inputClass} value={form.nome} onChange={(event) => set('nome', event.target.value)} placeholder={geral ? 'Nome completo do paciente' : 'Nome completo da criança'} />
              </Field>
              <Field label="Responsável">
                <input className={inputClass} value={form.responsavel} onChange={(event) => set('responsavel', event.target.value)} placeholder={geral ? 'Pai, mãe ou tutor, se for menor de idade' : 'Nome do pai, mãe ou tutor'} />
              </Field>
              <Field label="WhatsApp com DDD" required>
                <input
                  className={inputClass}
                  value={form.telefone}
                  onChange={(event) => set('telefone', editarComMascara(form.telefone, event.target.value, mascararTelefone))}
                  placeholder="(13) 9 9999-9999"
                  inputMode="tel"
                  maxLength={21}
                />
              </Field>
              <Field label="Data de nascimento">
                <input type="date" className={inputClass} value={form.nascimento} onChange={(event) => set('nascimento', event.target.value)} />
              </Field>
              {/* CPF e do PACIENTE, nao do responsavel - inclusive de bebe, que
                  tem CPF desde o registro de nascimento. A RDC 1000/25 passou a
                  exigi-lo em toda receita; sem ele a Memed recusa a emissao.
                  Fica opcional aqui de proposito: travar o cadastro de um
                  paciente novo por falta de CPF seria pior do que o problema. */}
              <Field label="CPF do paciente">
                <input
                  className={inputClass}
                  value={form.cpf}
                  onChange={(event) => set('cpf', editarComMascara(form.cpf, event.target.value, mascararCpf))}
                  placeholder="Necessário para emitir receita"
                  inputMode="numeric"
                  maxLength={14}
                />
              </Field>
              <Field label="E-mail">
                <input
                  className={inputClass}
                  value={form.email}
                  onChange={(event) => set('email', event.target.value)}
                  placeholder="Para onde a receita pode ser enviada"
                  inputMode="email"
                />
              </Field>
              <Field label="Sexo">
                <select
                  className={inputClass}
                  value={form.sexo}
                  onChange={(event) => {
                    // Escolha da equipe manda: some o aviso de sugestao.
                    setSexoSugerido(false)
                    set('sexo', event.target.value as PatientDraft['sexo'])
                  }}
                >
                  <option value="F">Feminino</option>
                  <option value="M">Masculino</option>
                  <option value="O">Outro / não informado</option>
                </select>
                {sexoSugerido && (
                  <span className="mt-1 block text-[10px] font-semibold text-[#16456b]">
                    Sugerido pelo nome. Confira antes de salvar.
                  </span>
                )}
              </Field>
              {/* Onde o paciente MORA. Ate 23/09/2026 estes dois ficavam em
                  "Agenda e localizacao", ao lado da unidade, e liam como o local
                  do atendimento - a pergunta foi "cade onde ele mora?". */}
              <Field label="Cidade onde mora">
                <input className={inputClass} value={form.cidade} onChange={(event) => set('cidade', event.target.value)} placeholder="Santos" />
              </Field>
              <Field label="Bairro onde mora">
                <input className={inputClass} value={form.bairro} onChange={(event) => set('bairro', event.target.value)} placeholder="Gonzaga" />
              </Field>
            </div>

            <div className="my-6 flex items-center gap-2">
              <span className="h-px flex-1 bg-[#081b2c]/[0.07]" />
              <span className="text-[9px] font-extrabold uppercase tracking-[0.16em] text-slate-400">Consulta</span>
              <span className="h-px flex-1 bg-[#081b2c]/[0.07]" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Data da consulta" required>
                <input type="date" className={inputClass} value={form.dataConsulta} onChange={(event) => set('dataConsulta', event.target.value)} />
              </Field>
              <Field label="Unidade">
                <select className={inputClass} value={form.unidade} onChange={(event) => set('unidade', event.target.value)}>
                  {opcoesDeUnidade(unidadesDaClinica, form.unidade).map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Convênio">
                <input className={inputClass} value={form.convenio} onChange={(event) => set('convenio', event.target.value)} placeholder="Particular, Unimed..." />
              </Field>
              {/* Ate 31/08/2026 este texto e a "Observacoes" do prontuario eram
                  a MESMA coluna, espelhada por gatilho: o medico escrevia a
                  observacao clinica e apagava o recado da recepcao sem que
                  ninguem visse. Agora sao dois campos de verdade, e o rotulo
                  precisa deixar claro qual e qual. */}
              <Field label="Recado da recepção" className="sm:col-span-2">
                <textarea
                  className={`${inputClass} min-h-[84px] resize-y`}
                  value={form.observacoes}
                  onChange={(event) => set('observacoes', event.target.value)}
                  placeholder="Ex.: prefere contato à tarde, vem sempre com a avó, reembolso pelo convênio."
                />
                <p className="mt-1.5 text-[9px] font-semibold text-slate-400">
                  Fica na ficha da pessoa e acompanha todas as consultas. Observação clínica vai no
                  prontuário, na próxima etapa.
                </p>
              </Field>
            </div>

            {error && (
              <p className="mt-4 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-[11px] font-bold text-red-600">{error}</p>
            )}
          </div>

          <div className="flex gap-2 border-t border-[#081b2c]/[0.07] bg-white px-5 py-4 sm:px-7">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-[14px] bg-[#081b2c] px-5 py-3 text-xs font-extrabold text-white shadow-[0_10px_22px_rgba(8,27,44,.16)] transition hover:bg-[#102d47]"
            >
              <Check className="h-4 w-4 text-[#6aa8d9]" strokeWidth={3} />
              {saving ? 'Salvando...' : editingId ? 'Salvar alterações' : 'Cadastrar'}
            </button>
            {/* Segundo caminho, para quem vai atender agora. Fica ao lado e nao
                no lugar: cadastrar sem abrir prontuario e o caso mais comum. */}
            {!editingId && (
              <button
                type="button"
                onClick={() => void save(true)}
                disabled={saving}
                className="flex items-center justify-center gap-2 rounded-[14px] border border-[#081b2c]/15 bg-white px-4 py-3 text-xs font-bold text-[#081b2c] transition hover:border-[#2f7fc1] hover:text-[#16456b] disabled:opacity-40"
              >
                <Stethoscope className="h-4 w-4" />
                Cadastrar e abrir prontuário
              </button>
            )}
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="rounded-[14px] border border-[#081b2c]/10 bg-white px-4 py-3 text-xs font-bold text-slate-500 transition hover:bg-slate-50"
            >
              Cancelar
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <PatientRecord
        patient={recordPatient}
        open={recordPatient !== null}
        startInConsultationForm={recordPatient?.id === startConsultationPatientId}
        onOpenChange={(open) => {
          if (!open) fecharProntuario()
        }}
        listConsultations={listConsultations}
        addConsultation={addConsultation}
        updateConsultation={updateConsultation}
        onEditRegistration={(patient) => {
          // Editar o cadastro acontece aqui, em Pacientes: nao volta para a Agenda.
          veioDaAgenda.current = false
          setRecordPatientId(null)
          editRegistration(patient)
        }}
      />
    </div>
  )
}

