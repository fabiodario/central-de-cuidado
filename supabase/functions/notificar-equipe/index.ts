import { adminClient, corsHeaders, json, userClient } from '../_shared/whatsapp.ts'
import { chavesDaClinica, entregar } from '../_shared/push-da-equipe.ts'
import { enviarAlertaDeUrgencia, quemNoAlerta } from '../_shared/alerta-de-urgencia.ts'
import { anexoRecenteDaConversa } from '../_shared/anexo-para-equipe.ts'
import { clinicaDeQuemAtende } from '../_shared/papel.ts'

/**
 * Notificacoes no celular: o lado que o navegador chama (28/09/2026).
 *
 *   { acao: 'chave' }            -> chave publica VAPID, para o celular se inscrever
 *   { acao: 'teste', clinicId }  -> manda "teste" para os aparelhos DA PESSOA
 *   { acao: 'alerta_teste', clinicId } -> o alerta de urgencia, no WhatsApp
 *                                   dos numeros salvos em Preferencias
 *   { acao: 'encaminhar', clinicId, conversaId } -> a conversa, como pedido,
 *                                   nos mesmos numeros (25/10/2026)
 *
 * O aviso de verdade (mensagem da familia) nao passa por aqui: sai do proprio
 * meta-webhook, por _shared/push-da-equipe.ts, sem uma segunda requisicao que
 * pudesse falhar calada no meio.
 *
 * O botao de teste existe porque notificacao tem muitos jeitos de nao chegar
 * sem erro nenhum - permissao negada, iPhone fora da tela de inicio, modo foco.
 * A pessoa aperta, ve (ou nao ve) chegar, e sabe na hora.
 */

type Pedido = { acao?: 'chave' | 'teste' | 'alerta_teste' | 'encaminhar'; clinicId?: string; conversaId?: string }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  const autorizacao = req.headers.get('Authorization') ?? ''
  if (!autorizacao.startsWith('Bearer ')) return json({ error: 'Sessão obrigatória.' }, 401)

  try {
    const corpo = (await req.json().catch(() => ({}))) as Pedido
    const admin = adminClient()

    if (corpo.acao === 'chave') {
      const chaves = await chavesDaClinica(admin)
      return json({ chave: chaves.publica })
    }

    if (corpo.acao === 'teste') {
      if (!corpo.clinicId) return json({ error: 'Clínica não informada.' }, 400)
      // Pela sessao da pessoa: a RLS so devolve as inscricoes DELA, e so de
      // clinica em que ela esta ativa.
      const escopo = userClient(autorizacao)
      const { data: linhas, error } = await escopo
        .from('push_inscricoes')
        .select('id,user_id,endpoint,p256dh,auth')
        .eq('clinic_id', corpo.clinicId)
      if (error) return json({ error: `Não consegui ler os aparelhos: ${error.message}` }, 500)
      if (!linhas?.length) return json({ error: 'Nenhum aparelho seu está ativado nesta clínica.' }, 404)

      const chaves = await chavesDaClinica(admin)
      const r = await entregar(
        admin,
        linhas,
        {
          titulo: 'Teste da Central de Cuidado',
          corpo: 'Se você está lendo isto, as mensagens das famílias vão chegar aqui. ✅',
          etiqueta: 'teste',
          conversa: '',
          urgente: false,
        },
        chaves,
      )
      return json(r)
    }

    // Alerta de urgencia de teste (17/10/2026): a mesma mensagem que o medico
    // recebe, para os numeros salvos em Preferencias. E o jeito de saber, antes
    // da primeira urgencia de verdade, se o modelo foi aprovado e se os numeros
    // estao certos: o alerta que nao chega nao avisa que nao chegou. So quem
    // atende (owner ou clinician): o teste toca o celular do medico.
    if (corpo.acao === 'alerta_teste') {
      if (!corpo.clinicId) return json({ error: 'Clínica não informada.' }, 400)
      if (!(await clinicaDeQuemAtende(userClient(autorizacao), corpo.clinicId))) {
        return json({ error: 'Só o médico ou o responsável pela clínica manda o alerta de teste.' }, 403)
      }
      const r = await enviarAlertaDeUrgencia(admin, {
        clinicId: corpo.clinicId,
        motivo: 'urgencia',
        quem: 'Teste da Central',
        texto: 'Este é um teste do alerta de urgência. Nenhum paciente foi afetado.',
        agora: new Date(),
      })
      if (!r.envios.length) return json({ error: r.nota }, 404)
      return json(r)
    }

    // "Mandar para o celular" na conversa aberta da Central (18/10/2026 no
    // sistema do Dr. Marcello, trazido em 25/10/2026): a conversa vai ao
    // WhatsApp do medico e da Dayane, para quando alguem quer a opiniao do
    // medico. A resposta dele volta ao paciente pelo caminho do alerta
    // (resposta-ao-alerta.ts). Qualquer pessoa com acesso a conversa manda: e a
    // Dayane quem mais vai usar. O resultado vira nota na conversa.
    if (corpo.acao === 'encaminhar') {
      if (!corpo.clinicId || !corpo.conversaId) return json({ error: 'Conversa não informada.' }, 400)
      // Pela sessao da pessoa: a RLS so devolve conversa de clinica em que ela esta ativa.
      const { data: conversa, error: erroDaConversa } = await userClient(autorizacao)
        .from('whatsapp_conversations')
        .select('id,wa_id,profile_name,patient_id')
        .eq('clinic_id', corpo.clinicId)
        .eq('id', corpo.conversaId)
        .maybeSingle()
      if (erroDaConversa || !conversa) return json({ error: 'Sem acesso a esta conversa.' }, 403)
      const { data: paciente } = conversa.patient_id
        ? await admin.from('patients').select('name').eq('id', conversa.patient_id).maybeSingle()
        : { data: null }
      const { data: ultima } = await admin
        .from('whatsapp_messages')
        .select('body')
        .eq('conversation_id', conversa.id)
        .eq('direction', 'inbound')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const r = await enviarAlertaDeUrgencia(admin, {
        clinicId: corpo.clinicId,
        motivo: 'pedido',
        assunto: 'enviado pela Central',
        quem: quemNoAlerta({
          pacientes: paciente?.name ? [{ name: String(paciente.name) }] : [],
          nomeDoPerfil: String(conversa.profile_name ?? ''),
          telefone: String(conversa.wa_id ?? ''),
        }),
        texto: String(ultima?.body ?? '').trim() || 'Sem mensagem do paciente nesta conversa.',
        agora: new Date(),
        conversationId: conversa.id,
        // A foto, o audio ou o documento do paciente vai junto (25/10/2026,
        // pedido do Edu): o ultimo das ultimas 24 horas, logo atras do pedido.
        anexo: await anexoRecenteDaConversa(admin, conversa.id, new Date(Date.now() - 24 * 3600 * 1000)),
      })
      return json(r)
    }

    return json({ error: 'Ação desconhecida.' }, 400)
  } catch (erro) {
    console.warn('notificar-equipe falhou', erro)
    return json({ error: erro instanceof Error ? erro.message : String(erro) }, 500)
  }
})
