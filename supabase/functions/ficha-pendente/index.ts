import { adminClient, corsHeaders, json } from '../_shared/whatsapp.ts'
import { abrirFichaPeloLembrete, COLUNAS_DA_FICHA, encerrarEtapa, faltamNaFicha } from '../_shared/atendimento.ts'
import { montarConteudo } from '../_shared/conteudo.ts'
import { decidir, horarios } from '../_shared/ficha-pendente.ts'
import { avisarEquipe } from '../_shared/push-da-equipe.ts'
import { chaveDoWhatsApp, foraDaListaDeTeste, listaDeTeste } from '../_shared/whatsapp-teste.ts'

/**
 * Reserva sem cadastro: lembrete e cancelamento (01/10/2026).
 *
 * Chamada a cada 15 minutos pelo pg_cron (migration 20261001140000), com
 * x-cron-secret. A REGRA de quando lembrar, cancelar ou chamar a equipe mora
 * em _shared/ficha-pendente.ts, coberta por testes; aqui so se le o banco,
 * pergunta a regra e executa.
 *
 * Cada consulta recebe no maximo UM lembrete e UM desfecho (ficha_lembrete_em
 * e ficha_desfecho). Reexecutar nao repete nada.
 *
 * Tudo que nao deu certo grita: log de aviso, conversa acesa na tela e
 * notificacao no celular da equipe. O pior defeito possivel aqui e uma
 * reserva cancelada sem a familia saber, ou uma familia avisada de um
 * cancelamento que nao aconteceu - por isso o cancelamento so vale depois que
 * o banco confirma, e o aviso so sai depois.
 */

type Admin = ReturnType<typeof adminClient>

const GRAPH = () => Deno.env.get('META_GRAPH_VERSION')?.trim() || 'v25.0'

function dataLegivel(iso: string, fuso: string) {
  const d = new Date(iso)
  const dia = d.toLocaleDateString('pt-BR', { timeZone: fuso, weekday: 'short', day: '2-digit', month: '2-digit' })
  const hora = d.toLocaleTimeString('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit' })
  return `${dia.replace('.', '')} às ${hora}`
}

/** "hoje às 20h45" / "amanhã às 9h" - o prazo como a familia pensa. */
function prazoLegivel(ms: number, agora: number, fuso: string) {
  const diaDe = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone: fuso })
  const [h, m] = new Date(ms)
    .toLocaleTimeString('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit' })
    .split(':')
  const hora = `${Number(h)}h${m === '00' ? '' : m}`
  if (diaDe(ms) === diaDe(agora)) return `hoje às ${hora}`
  if (diaDe(ms) === diaDe(agora + 24 * 3600 * 1000)) return `amanhã às ${hora}`
  return `em ${new Date(ms).toLocaleDateString('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit' })} às ${hora}`
}

async function enviar(
  admin: Admin,
  conversa: { id: string; clinic_id: string; wa_id: string; patient_id: string | null },
  phoneNumberId: string,
  appointmentId: string,
  texto: string,
  toques?: Parameters<typeof montarConteudo>[1],
): Promise<boolean> {
  const token = chaveDoWhatsApp(phoneNumberId)
  if (!token) {
    console.warn('Ficha pendente: sem token do WhatsApp para', phoneNumberId)
    return false
  }
  const agora = new Date().toISOString()
  const resposta = await fetch(`https://graph.facebook.com/${GRAPH()}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: conversa.wa_id,
      ...montarConteudo(texto, toques),
    }),
  })
  const corpo = await resposta.json().catch(() => ({}))
  const { error } = await admin.from('whatsapp_messages').insert({
    clinic_id: conversa.clinic_id,
    conversation_id: conversa.id,
    patient_id: conversa.patient_id,
    appointment_id: appointmentId,
    external_message_id: resposta.ok ? corpo?.messages?.[0]?.id ?? null : null,
    direction: 'outbound',
    message_type: 'text',
    body: texto,
    automatic: true,
    status: resposta.ok ? 'accepted' : 'failed',
    sent_at: resposta.ok ? agora : null,
    failed_at: resposta.ok ? null : agora,
    failure_reason: resposta.ok ? null : corpo?.error?.message ?? 'Meta recusou o envio.',
  })
  if (error) console.warn('Ficha pendente: mensagem enviada mas nao registrada', error)
  if (!resposta.ok) console.warn('Ficha pendente: Meta recusou', corpo?.error ?? corpo)
  return resposta.ok
}

async function chamarEquipe(
  admin: Admin,
  clinicId: string,
  conversa: { id: string },
  consulta: { id: string; starts_at: string; staff_note: string | null },
  motivo: string,
  fuso: string,
) {
  const nota = `Cadastro nao concluido pelo WhatsApp: ${motivo}. Conferir com a familia.`
  await admin
    .from('appointments')
    .update({
      ficha_desfecho: 'equipe',
      staff_note: (consulta.staff_note ? `${consulta.staff_note} | ${nota}` : nota).slice(0, 500),
    })
    .eq('id', consulta.id)
  const { error } = await admin
    .from('whatsapp_conversations')
    .update({ needs_attention: true, attention_reason: 'atendente' })
    .eq('id', conversa.id)
  if (error) console.warn('Ficha pendente: nao consegui acender a conversa', error)
  await avisarEquipe(admin, clinicId, {
    titulo: 'Reserva sem cadastro',
    corpo: `Consulta de ${dataLegivel(consulta.starts_at, fuso)}: ${motivo}. Conferir com a família.`,
    etiqueta: `conversa-${conversa.id}`,
    conversa: conversa.id,
    urgente: false,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  const esperado = Deno.env.get('CRON_SECRET')?.trim()
  if (!esperado) return json({ error: 'CRON_SECRET não configurado no servidor.' }, 503)
  if (req.headers.get('x-cron-secret')?.trim() !== esperado) return json({ error: 'Não autorizado.' }, 401)

  const admin = adminClient()
  const resumo = { lembretes: 0, cancelamentos: 0, equipe: 0, falhas: 0 }

  try {
    const { data: clinicas, error } = await admin
      .from('clinic_settings')
      .select('clinic_id,whatsapp_phone_number_id')
    if (error) throw error

    for (const ajustes of clinicas ?? []) {
      const clinicId = String(ajustes.clinic_id)
      const phoneNumberId = String(ajustes.whatsapp_phone_number_id ?? '').trim()
      if (!phoneNumberId) continue

      const { data: clinica } = await admin.from('clinics').select('timezone').eq('id', clinicId).maybeSingle()
      const fuso = clinica?.timezone || 'America/Sao_Paulo'
      const lista = await listaDeTeste(admin, clinicId)

      // Reservas do robo, sem paciente ligado, ainda por acontecer. Tres dias
      // para tras basta: depois de 23h a regra ja decidiu.
      const { data: reservasBrutas, error: erroReservas } = await admin
        .from('appointments')
        .select(`id,starts_at,staff_note,unit_id,patient_id,${COLUNAS_DA_FICHA.join(',')}`)
        .eq('clinic_id', clinicId)
        .eq('source', 'whatsapp')
        .eq('status', 'scheduled')
        .is('patient_id', null)
        .gt('starts_at', new Date().toISOString())
        .gt('created_at', new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString())
      if (erroReservas) {
        console.warn('Ficha pendente: nao consegui ler as reservas', clinicId, erroReservas)
        resumo.falhas++
        continue
      }
      // A lista de colunas e montada em tempo de execucao; o tipo do cliente
      // nao consegue le-la, entao a linha vira registro simples.
      const reservas = (reservasBrutas ?? []) as unknown as Record<string, unknown>[]
      if (!reservas.length) continue

      // Colunas novas em consulta separada (padrao da casa): sem elas nao da
      // para saber se o lembrete ja saiu, e a funcao para em vez de arriscar
      // mandar duas vezes.
      const { data: marcas, error: erroMarcas } = await admin
        .from('appointments')
        .select('id,ficha_lembrete_em,ficha_desfecho')
        .in('id', reservas.map((r) => String(r.id)))
      if (erroMarcas) {
        console.warn('Ficha pendente: colunas da regra indisponiveis; nada feito', erroMarcas)
        resumo.falhas++
        continue
      }
      const marcaDe = new Map((marcas ?? []).map((m) => [m.id, m]))

      for (const reserva of reservas) {
        const id = String(reserva.id)
        const marca = marcaDe.get(id)
        if (!marca || marca.ficha_desfecho) continue
        const { faltam, faltaObrigatoria } = faltamNaFicha(reserva)
        if (!faltaObrigatoria) continue

        // A conversa onde a reserva foi feita: a confirmacao do robo leva o
        // id da consulta.
        const { data: deOnde } = await admin
          .from('whatsapp_messages')
          .select('conversation_id')
          .eq('appointment_id', id)
          .limit(1)
          .maybeSingle()
        if (!deOnde?.conversation_id) {
          console.warn('Ficha pendente: reserva sem conversa encontrada', id)
          continue
        }
        const { data: conversa } = await admin
          .from('whatsapp_conversations')
          .select('id,clinic_id,wa_id,patient_id,booking_intake_id')
          .eq('id', deOnde.conversation_id)
          .maybeSingle()
        if (!conversa) continue
        if (foraDaListaDeTeste(lista, String(conversa.wa_id))) continue

        const { data: ultimaDaFamilia } = await admin
          .from('whatsapp_messages')
          .select('created_at')
          .eq('conversation_id', conversa.id)
          .eq('direction', 'inbound')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (!ultimaDaFamilia) continue

        const situacao = {
          agora: Date.now(),
          ultimaDaFamilia: String(ultimaDaFamilia.created_at),
          lembreteEm: marca.ficha_lembrete_em ?? null,
          inicioDaConsulta: String(reserva.starts_at),
          fuso,
        }
        const decisao = decidir(situacao)
        if (decisao === 'esperar') continue

        const quando = dataLegivel(String(reserva.starts_at), fuso)
        const consulta = { id, starts_at: String(reserva.starts_at), staff_note: (reserva.staff_note as string | null) ?? null }

        if (decisao === 'lembrar') {
          const { data: unidade } = await admin
            .from('clinic_units')
            .select('name')
            .eq('id', String(reserva.unit_id))
            .maybeSingle()
          const prazo = prazoLegivel(horarios(situacao).cancelar, Date.now(), fuso)
          const aviso =
            `📋 Sua reserva de *${quando}*${unidade?.name ? ` (${unidade.name})` : ''} está quase confirmada: ` +
            `falta o cadastro da criança. Sem ele, a reserva será cancelada *${prazo}*.`
          const pergunta = await abrirFichaPeloLembrete(admin, conversa.id, id, faltam, aviso)
          if (!pergunta) {
            await chamarEquipe(admin, clinicId, conversa, consulta, 'o robo nao conseguiu montar o lembrete', fuso)
            resumo.falhas++
            continue
          }
          const saiu = await enviar(admin, conversa, phoneNumberId, id, pergunta.resposta, {
            botoes: pergunta.botoes,
          })
          if (saiu) {
            await admin.from('appointments').update({ ficha_lembrete_em: new Date().toISOString() }).eq('id', id)
            resumo.lembretes++
          } else {
            // Sem lembrete nao ha cancelamento justo: a equipe assume.
            await chamarEquipe(admin, clinicId, conversa, consulta, 'o lembrete nao saiu', fuso)
            resumo.falhas++
          }
          continue
        }

        if (decisao === 'cancelar') {
          // Cancela so se ainda esta como estava: a equipe pode ter
          // completado ou ligado a um paciente no meio do caminho.
          const nota = 'Cancelada automaticamente: cadastro nao concluido no prazo.'
          const { data: cancelada, error: erroCancelar } = await admin
            .from('appointments')
            .update({
              status: 'cancelled',
              cancelled_at: new Date().toISOString(),
              ficha_desfecho: 'cancelada',
              staff_note: (consulta.staff_note ? `${consulta.staff_note} | ${nota}` : nota).slice(0, 500),
            })
            .eq('id', id)
            .eq('status', 'scheduled')
            .is('patient_id', null)
            .is('ficha_desfecho', null)
            .select('id')
            .maybeSingle()
          if (erroCancelar || !cancelada) {
            if (erroCancelar) console.warn('Ficha pendente: nao consegui cancelar', id, erroCancelar)
            continue
          }
          if (conversa.booking_intake_id === id) await encerrarEtapa(admin, conversa.id)
          const saiu = await enviar(
            admin,
            conversa,
            phoneNumberId,
            id,
            `Sua reserva de *${quando}* foi cancelada porque o cadastro da criança não foi concluído, ` +
              'e o horário foi liberado.\n\nPara marcar de novo, é só responder *quero marcar*.',
          )
          if (!saiu) {
            // Cancelou e a familia nao soube: e exatamente o que nao pode
            // ficar quieto.
            await admin
              .from('whatsapp_conversations')
              .update({ needs_attention: true, attention_reason: 'atendente' })
              .eq('id', conversa.id)
            await avisarEquipe(admin, clinicId, {
              titulo: 'Reserva cancelada sem aviso',
              corpo: `Consulta de ${quando} cancelada por falta de cadastro, mas o aviso não saiu. Avisar a família.`,
              etiqueta: `conversa-${conversa.id}`,
              conversa: conversa.id,
              urgente: false,
            })
            resumo.falhas++
          }
          resumo.cancelamentos++
          continue
        }

        // chamar_equipe
        const motivo =
          new Date(String(reserva.starts_at)).getTime() <= horarios(situacao).cancelar + 2 * 3600 * 1000
            ? 'a consulta é antes do prazo de cancelamento'
            : 'não deu para avisar dentro do prazo'
        await chamarEquipe(admin, clinicId, conversa, consulta, motivo, fuso)
        resumo.equipe++
      }
    }

    return json({ ok: true, ...resumo })
  } catch (erro) {
    console.warn('ficha-pendente falhou', erro)
    return json({ error: erro instanceof Error ? erro.message : String(erro), ...resumo }, 500)
  }
})
