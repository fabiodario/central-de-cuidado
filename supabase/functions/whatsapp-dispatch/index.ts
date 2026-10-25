import { adminClient, corsHeaders, json } from '../_shared/whatsapp.ts'
import { sendFollowup } from '../_shared/sendFollowup.ts'
import { consultasQueNaoAconteceram } from '../_shared/consulta-aconteceu.ts'
import { escolherParaEnviar } from '../_shared/disparo-do-acompanhamento.ts'

/**
 * Disparo automatico diario dos acompanhamentos vencidos.
 *
 * Chamada pelo pg_cron (ver migration de agendamento). Nao ha usuario logado,
 * entao a autorizacao e feita por um segredo compartilhado em CRON_SECRET.
 *
 * Sobre consentimento: a clinica decidiu que todo paciente atendido pelo medico
 * e um contato legitimo para o acompanhamento pos-consulta, e autorizou o envio
 * para toda a base. A base legal e a assistencia (LGPD art. 11, tutela da
 * saude), nao a autorizacao.
 *
 * O que continua valendo sem excecao: quem respondeu SAIR nunca mais recebe
 * nada. Essa checagem vem antes de qualquer envio, em sendFollowup.
 *
 * Para voltar atras, troque consentConfirmed por requireExistingConsent: true.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  const expected = Deno.env.get('CRON_SECRET')?.trim()
  if (!expected) {
    return json({ error: 'CRON_SECRET não configurado no servidor.' }, 503)
  }
  if (req.headers.get('x-cron-secret')?.trim() !== expected) {
    return json({ error: 'Não autorizado.' }, 401)
  }

  try {
    const admin = adminClient()
    const today = new Date().toISOString().slice(0, 10)

    /**
     * A fila nao pode entupir (24/09/2026).
     *
     * Quem nao tem telefone, pediu SAIR ou foi recusado pela Meta continuava
     * "pendente" e voltava para o topo da fila todo dia, na ordem da data mais
     * antiga. Com 200 desses, nenhum acompanhamento novo saia mais - e nada
     * avisava. Tres travas:
     *
     *  - so vencidos ha no maximo 14 dias. Um "15 dias" que sai dois meses
     *    depois ja nao faz sentido; os mais antigos continuam na tela de
     *    Acompanhamentos para a equipe decidir.
     *  - recusado pela Meta so tenta de novo depois de 3 dias, e nao todo dia
     *    (cada tentativa deixava uma mensagem "falhou" na conversa).
     *  - a mais nova primeiro: o que acabou de vencer e o mais util de enviar.
     */
    const limite = new Date()
    limite.setDate(limite.getDate() - 14)
    const tresDiasAtras = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()

    const { data: vencidos, error } = await admin
      .from('followups')
      .select('id,clinic_id,patient_id,consultation_id,followup_key,due_date,whatsapp_failed_at')
      .lte('due_date', today)
      .gte('due_date', limite.toISOString().slice(0, 10))
      .eq('status', 'pending')
      .is('archived_at', null)
      .is('whatsapp_sent_at', null)
      .order('due_date', { ascending: false })
      .limit(500)

    if (error) {
      console.error('Due lookup failed', error)
      return json({ error: 'Erro ao listar acompanhamentos vencidos.', details: error.message }, 500)
    }
    if ((vencidos ?? []).length === 500) {
      console.warn('whatsapp-dispatch: 500 acompanhamentos vencidos na janela; os excedentes ficam para amanha')
    }

    // Quem desligou o acompanhamento automatico em Preferencias (17/10/2026).
    // Consulta separada: a coluna e nova, e o Postgres recusa a query inteira
    // quando uma coluna nao existe. Coluna ainda ausente (publicacao no meio):
    // ninguem conseguiu desligar, segue como antes. Qualquer outro erro para o
    // disparo do dia: mandar para quem pediu para parar e pior que atrasar.
    const clinicasDesligadas = new Set<string>()
    const { data: desligadas, error: erroDaOpcao } = await admin
      .from('clinic_settings')
      .select('clinic_id')
      .eq('acompanhamento_automatico', false)
    if (erroDaOpcao && erroDaOpcao.code !== '42703') {
      console.error('whatsapp-dispatch: nao li quem desligou o acompanhamento; nada foi enviado', erroDaOpcao)
      return json({ error: 'Não consegui ler quem desligou o acompanhamento automático.', details: erroDaOpcao.message }, 500)
    }
    if (erroDaOpcao) console.warn('whatsapp-dispatch: opcao do acompanhamento ainda nao existe no banco; todas ligadas')
    for (const linha of desligadas ?? []) clinicasDesligadas.add(String(linha.clinic_id))

    // Etapas ligadas em Preferencias (19/10/2026, vindo do sistema do Dr.
    // Marcello). Coluna nova, lida a parte: sem ela, as tres etapas, como antes.
    const etapasPorClinica = new Map<string, string[]>()
    try {
      const clinicas = [...new Set((vencidos ?? []).map((f) => String(f.clinic_id)))]
      if (clinicas.length) {
        const { data: ajustes, error: erroDasEtapas } = await admin
          .from('clinic_settings')
          .select('clinic_id,followup_etapas')
          .in('clinic_id', clinicas)
        if (erroDasEtapas) throw erroDasEtapas
        for (const a of (ajustes ?? []) as { clinic_id: string; followup_etapas?: string[] | null }[]) {
          if (a.followup_etapas?.length) etapasPorClinica.set(a.clinic_id, a.followup_etapas)
        }
      }
    } catch (erro) {
      console.warn('whatsapp-dispatch: sem clinic_settings.followup_etapas; todas as etapas valem', erro)
    }

    const { enviar: due, desligados, etapaDesligada } = escolherParaEnviar(vencidos ?? [], {
      clinicasDesligadas,
      tresDiasAtras,
      etapasPorClinica,
    })

    // Consulta que nao aconteceu nao ganha acompanhamento (23/10/2026, vindo do
    // sistema do Dr. Marcello; ver _shared/consulta-aconteceu.ts). Se a
    // conferencia falhar, nada sai hoje: melhor um dia de atraso que "como
    // esta depois da consulta?" para quem nunca veio. Fica pendente e tenta
    // amanha.
    const semConsulta = new Set<string>()
    try {
      const idsDasConsultas = [...new Set(due.map((f) => f.consultation_id).filter(Boolean))] as string[]
      type Consulta = { id: string; clinic_id: string; patient_id: string; consultation_date: string; chief_complaint: string | null; clinical_history: string | null; assessment: string | null; plan: string | null }
      const consultas: Consulta[] = []
      for (let i = 0; i < idsDasConsultas.length; i += 100) {
        const { data, error: erroDaConsulta } = await admin
          .from('consultations')
          .select('id,clinic_id,patient_id,consultation_date,chief_complaint,clinical_history,assessment,plan')
          .in('id', idsDasConsultas.slice(i, i + 100))
        if (erroDaConsulta) throw erroDaConsulta
        consultas.push(...((data ?? []) as Consulta[]))
      }
      const pacientes = [...new Set(consultas.map((c) => c.patient_id))]
      const agenda: { patient_id: string; clinic_id: string; starts_at: string; status: string }[] = []
      for (let i = 0; i < pacientes.length; i += 100) {
        const { data, error: erroDaAgenda } = await admin
          .from('appointments')
          .select('patient_id,clinic_id,starts_at,status')
          .in('patient_id', pacientes.slice(i, i + 100))
        if (erroDaAgenda) throw erroDaAgenda
        agenda.push(...((data ?? []) as typeof agenda))
      }
      for (const id of consultasQueNaoAconteceram(consultas, agenda)) semConsulta.add(id)
      if (semConsulta.size) {
        console.warn(`whatsapp-dispatch: ${semConsulta.size} consulta(s) sem prontuario nem presenca; acompanhamento segurado`)
      }
    } catch (erro) {
      console.error('whatsapp-dispatch: nao consegui conferir se as consultas aconteceram; nenhum acompanhamento sai hoje', erro)
      return json({ error: 'Não consegui conferir as consultas; nenhum acompanhamento enviado.' }, 500)
    }

    const resumo = { vencidos: due.length, enviados: 0, pulados: 0, falhas: 0, desligados, etapaDesligada }
    const detalhes: { followupId: string; resultado: string }[] = []

    for (const followup of due) {
      if (followup.consultation_id && semConsulta.has(followup.consultation_id)) {
        resumo.pulados += 1
        detalhes.push({ followupId: followup.id, resultado: 'SEM_CONSULTA' })
        continue
      }
      const result = await sendFollowup(followup.id, {
        consentConfirmed: true,
        consentSource: 'clinic_care_relationship',
      })
      if (result.ok && !result.alreadySent) {
        resumo.enviados += 1
        detalhes.push({ followupId: followup.id, resultado: 'enviado' })
      } else if (result.ok) {
        resumo.pulados += 1
        detalhes.push({ followupId: followup.id, resultado: 'ja enviado' })
      } else if (result.code === 'CONSENT_MISSING' || result.code === 'OPTED_OUT' || result.code === 'INCOMPLETE' || result.code === 'TEST_LIST') {
        resumo.pulados += 1
        detalhes.push({ followupId: followup.id, resultado: result.code })
      } else {
        resumo.falhas += 1
        detalhes.push({ followupId: followup.id, resultado: `${result.code ?? 'ERRO'}: ${result.error}` })
      }
    }

    console.log('whatsapp-dispatch', JSON.stringify(resumo))
    return json({ ok: true, ...resumo, detalhes })
  } catch (error) {
    console.error(error)
    return json({ error: 'Falha no disparo automático.' }, 500)
  }
})
