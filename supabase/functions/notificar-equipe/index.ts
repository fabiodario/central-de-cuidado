import { adminClient, corsHeaders, json, userClient } from '../_shared/whatsapp.ts'
import { chavesDaClinica, entregar } from '../_shared/push-da-equipe.ts'
import { enviarAlertaDeUrgencia } from '../_shared/alerta-de-urgencia.ts'
import { clinicaDeQuemAtende } from '../_shared/papel.ts'

/**
 * Notificacoes no celular: o lado que o navegador chama (28/09/2026).
 *
 *   { acao: 'chave' }            -> chave publica VAPID, para o celular se inscrever
 *   { acao: 'teste', clinicId }  -> manda "teste" para os aparelhos DA PESSOA
 *   { acao: 'alerta_teste', clinicId } -> o alerta de urgencia, no WhatsApp
 *                                   dos numeros salvos em Preferencias
 *
 * O aviso de verdade (mensagem da familia) nao passa por aqui: sai do proprio
 * meta-webhook, por _shared/push-da-equipe.ts, sem uma segunda requisicao que
 * pudesse falhar calada no meio.
 *
 * O botao de teste existe porque notificacao tem muitos jeitos de nao chegar
 * sem erro nenhum - permissao negada, iPhone fora da tela de inicio, modo foco.
 * A pessoa aperta, ve (ou nao ve) chegar, e sabe na hora.
 */

type Pedido = { acao?: 'chave' | 'teste' | 'alerta_teste'; clinicId?: string }

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

    return json({ error: 'Ação desconhecida.' }, 400)
  } catch (erro) {
    console.warn('notificar-equipe falhou', erro)
    return json({ error: erro instanceof Error ? erro.message : String(erro) }, 500)
  }
})
