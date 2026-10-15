import { adminClient, corsHeaders, json, userClient } from '../_shared/whatsapp.ts'
import { chavesDaClinica, entregar } from '../_shared/push-da-equipe.ts'

/**
 * Notificacoes no celular: o lado que o navegador chama (28/09/2026).
 *
 *   { acao: 'chave' }            -> chave publica VAPID, para o celular se inscrever
 *   { acao: 'teste', clinicId }  -> manda "teste" para os aparelhos DA PESSOA
 *
 * O aviso de verdade (mensagem da familia) nao passa por aqui: sai do proprio
 * meta-webhook, por _shared/push-da-equipe.ts, sem uma segunda requisicao que
 * pudesse falhar calada no meio.
 *
 * O botao de teste existe porque notificacao tem muitos jeitos de nao chegar
 * sem erro nenhum - permissao negada, iPhone fora da tela de inicio, modo foco.
 * A pessoa aperta, ve (ou nao ve) chegar, e sabe na hora.
 */

type Pedido = { acao?: 'chave' | 'teste'; clinicId?: string }

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

    return json({ error: 'Ação desconhecida.' }, 400)
  } catch (erro) {
    console.warn('notificar-equipe falhou', erro)
    return json({ error: erro instanceof Error ? erro.message : String(erro) }, 500)
  }
})
