import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ConsultationDraft,
  Db,
  FollowupKey,
  FollowupStatus,
  Patient,
} from '@/types/patient'
import {
  archiveAllPatients,
  archivePatient,
  listArchivedPatients,
  restorePatient as restorePatientRow,
  changeFollowup,
  createConsultation,
  createPatient,
  editConsultation,
  editPatient,
  ensureClinic,
  fetchDb,
  getCurrentMembership,
  importPatients,
  listConsultations,
  saveTemplates,
  vincularContatoAoPaciente,
  type ClinicRole,
} from '@/lib/repository'
import { supabase } from '@/lib/supabase'

export const DEFAULT_TEMPLATES: Record<FollowupKey, string> = {
  d15: 'Olá! Aqui é da equipe do Dr. Fábio Dario, otorrinolaringologista. Já se passaram 15 dias da consulta de {nome}. Como {pronome} está se adaptando ao tratamento? Se surgiu qualquer dúvida, é só responder por aqui. 💙',
  d30: 'Olá! Aqui é da equipe do Dr. Fábio Dario, otorrinolaringologista. Já se passaram 30 dias da consulta de {nome}. Como {pronome} está? Está respirando melhor? Se precisar de qualquer auxílio, é só responder por aqui. 💙',
  m90: 'Olá! Aqui é da equipe do Dr. Fábio Dario. Já se passaram 3 meses da consulta de {nome} e gostaríamos de saber como {pronome} está. Está tudo bem? Qualquer necessidade, estamos à disposição. 💙',
}

export type PatientDraft = Omit<
  Patient,
  'id' | 'criadoEm' | 'followups' | 'criadoAutomaticamenteEm'
>

const EMPTY_DB: Db = {
  patients: [],
  templates: { ...DEFAULT_TEMPLATES },
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return 'Não foi possível salvar os dados. Tente novamente.'
}

function validImport(data: unknown): data is Db {
  if (!data || typeof data !== 'object') return false
  const candidate = data as Partial<Db>
  return Array.isArray(candidate.patients)
}

export function useDb() {
  const [db, setDb] = useState<Db>(EMPTY_DB)
  const [clinicId, setClinicId] = useState<string | null>(null)
  const [role, setRole] = useState<ClinicRole | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Erro da carga inicial, separado do erro de uma acao. Ate 08/09/2026 eram o
  // mesmo estado: uma falha ao antecipar um acompanhamento trocava o sistema
  // inteiro pela tela de "nao foi possivel carregar os dados", como se o
  // sistema tivesse caido.
  const [loadError, setLoadError] = useState('')
  const loadSequence = useRef(0)

  /**
   * Recarrega a base da clinica.
   *
   * `silencioso` serve para a atualizacao em tempo real: sem ele, cada
   * cadastro criado pelo robo trocaria a tela inteira pelo "Carregando dados
   * da clinica" enquanto a recepcao estava lendo alguma coisa.
   */
  const load = useCallback(async (silencioso = false) => {
    const sequence = ++loadSequence.current
    if (!silencioso) setLoading(true)
    setError('')
    setLoadError('')
    try {
      const membership = clinicId ? null : await getCurrentMembership()
      const id = clinicId ?? membership?.clinicId ?? (await ensureClinic())
      const next = await fetchDb(id, DEFAULT_TEMPLATES)
      if (loadSequence.current !== sequence) return
      setClinicId(id)
      if (membership) setRole(membership.role)
      setDb(next)
    } catch (cause) {
      if (loadSequence.current === sequence) {
        const texto = errorMessage(cause)
        setError(texto)
        setLoadError(texto)
      }
    } finally {
      if (loadSequence.current === sequence && !silencioso) setLoading(false)
    }
  }, [clinicId])

  useEffect(() => {
    void load()
    return () => {
      loadSequence.current += 1
    }
  }, [load])

  /**
   * A lista se atualiza sozinha.
   *
   * Um cadastro criado pelo robo, uma consulta marcada pelo WhatsApp ou um
   * acompanhamento enviado pelo disparo automatico mudam a base sem ninguem
   * clicar em nada. Ate 09/09/2026 so apareciam depois de um F5 - e quem
   * estava com a tela aberta concluia que o robo nao tinha funcionado.
   *
   * A recarga e adiada por um segundo: uma consulta marcada mexe em varias
   * tabelas de uma vez, e sem isso seriam tres recargas em sequencia.
   */
  useEffect(() => {
    if (!clinicId) return
    let adiado: number | undefined
    const recarregar = () => {
      window.clearTimeout(adiado)
      adiado = window.setTimeout(() => void load(true), 1000)
    }

    const canal = supabase.channel(`base-${clinicId}`)
    for (const tabela of ['patients', 'followups', 'appointments'] as const) {
      canal.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: tabela, filter: `clinic_id=eq.${clinicId}` },
        recarregar,
      )
    }
    canal.subscribe()

    return () => {
      window.clearTimeout(adiado)
      void supabase.removeChannel(canal)
    }
  }, [clinicId, load])

  function requireClinic() {
    if (!clinicId) throw new Error('A clínica ainda não foi carregada.')
    return clinicId
  }

  async function run<T>(operation: () => Promise<T>) {
    setBusy(true)
    setError('')
    try {
      return await operation()
    } catch (cause) {
      const text = errorMessage(cause)
      setError(text)
      throw new Error(text)
    } finally {
      setBusy(false)
    }
  }

  async function addPatient(draft: PatientDraft) {
    const patient = await run(() => createPatient(requireClinic(), draft))
    setDb((current) => ({ ...current, patients: [patient, ...current.patients] }))

    // Costura o passado: conversas, mensagens e consultas que a pessoa ja tinha
    // no WhatsApp com este telefone passam a pertencer ao paciente. Fica aqui, e
    // nao na tela, para valer em qualquer caminho de cadastro.
    //
    // Falhar aqui nao pode desfazer o cadastro - o paciente ja existe, e a
    // proxima mensagem dele refaz o vinculo sozinha.
    try {
      await vincularContatoAoPaciente(patient.id)
    } catch (cause) {
      console.error('Nao consegui ligar o historico do WhatsApp ao paciente novo', cause)
    }

    return patient
  }

  async function updatePatient(id: string, patch: Partial<Patient>) {
    const patient = await run(() => editPatient(requireClinic(), id, patch))
    setDb((current) => ({
      ...current,
      patients: current.patients.map((item) => (item.id === id ? patient : item)),
    }))
  }

  async function removePatient(id: string) {
    await run(() => archivePatient(requireClinic(), id))
    setDb((current) => ({
      ...current,
      patients: current.patients.filter((patient) => patient.id !== id),
    }))
  }

  async function listArchived() {
    return run(() => listArchivedPatients(requireClinic()))
  }

  async function restorePatient(id: string) {
    await run(() => restorePatientRow(requireClinic(), id))
    // Recarrega tudo em vez de remendar a lista: o paciente volta com os
    // acompanhamentos e a ordem certos, como se nunca tivesse saido.
    await load()
  }

  async function getConsultations(patientId: string) {
    return run(() => listConsultations(requireClinic(), patientId))
  }

  async function addConsultation(patientId: string, draft: ConsultationDraft) {
    const result = await run(() => createConsultation(requireClinic(), patientId, draft))
    setDb((current) => ({
      ...current,
      patients: current.patients.map((patient) =>
        patient.id === patientId ? result.patient : patient,
      ),
    }))
  }

  async function updateConsultation(patientId: string, consultationId: string, draft: ConsultationDraft) {
    const result = await run(() => editConsultation(requireClinic(), patientId, consultationId, draft))
    setDb((current) => ({
      ...current,
      patients: current.patients.map((patient) =>
        patient.id === patientId ? result.patient : patient,
      ),
    }))
  }

  async function setFollowup(id: string, key: FollowupKey, status: FollowupStatus) {
    const followup = await run(() => changeFollowup(requireClinic(), id, key, status))
    setDb((current) => ({
      ...current,
      patients: current.patients.map((patient) =>
        patient.id === id
          ? { ...patient, followups: { ...patient.followups, [key]: followup } }
          : patient,
      ),
    }))
  }

  async function setTemplates(templates: Record<FollowupKey, string>) {
    await run(() => saveTemplates(requireClinic(), templates))
    setDb((current) => ({ ...current, templates }))
  }

  async function importDb(data: unknown) {
    if (!validImport(data)) return false
    const normalized: Db = {
      patients: data.patients,
      templates: { ...DEFAULT_TEMPLATES, ...(data.templates ?? {}) },
    }
    await run(() => importPatients(requireClinic(), normalized))
    await load()
    return true
  }

  async function clearAll() {
    await run(() => archiveAllPatients(requireClinic()))
    setDb((current) => ({ ...current, patients: [] }))
  }

  return {
    db,
    role,
    loading,
    busy,
    error,
    loadError,
    retry: load,
    addPatient,
    updatePatient,
    removePatient,
    listArchived,
    restorePatient,
    getConsultations,
    addConsultation,
    updateConsultation,
    setFollowup,
    setTemplates,
    importDb,
    clearAll,
  }
}

