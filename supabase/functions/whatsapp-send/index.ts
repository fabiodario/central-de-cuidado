import { corsHeaders, json, userClient } from '../_shared/whatsapp.ts'
import { sendFollowup } from '../_shared/sendFollowup.ts'

type SendRequest = {
  followupId?: string
  consentConfirmed?: boolean
}

/**
 * Disparo manual, a partir do botao "Enviar agora" na tela.
 * A responsabilidade desta funcao e apenas autorizar; o envio em si mora em
 * _shared/sendFollowup.ts, compartilhado com o disparo automatico diario.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  try {
    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return json({ error: 'Sessão obrigatória.' }, 401)

    const body = (await req.json()) as SendRequest
    if (!body.followupId) return json({ error: 'Acompanhamento não informado.' }, 400)

    // A consulta com o cliente do usuario e a checagem de autorizacao: a RLS so
    // expoe acompanhamentos de clinicas onde ele e membro ativo.
    const scoped = userClient(authorization)
    const { data: visibleFollowup, error: visibleError } = await scoped
      .from('followups')
      .select('id,clinic_id')
      .eq('id', body.followupId)
      .maybeSingle()

    if (visibleError) {
      console.error('RLS lookup failed', visibleError)
      return json({
        error: 'Falha ao verificar permissão do acompanhamento.',
        code: 'RLS_LOOKUP_FAILED',
        details: visibleError.message,
      }, 500)
    }
    if (!visibleFollowup) {
      return json({
        error: 'Este acompanhamento não pertence à sua clínica ou a sessão expirou.',
        code: 'NOT_VISIBLE',
      }, 403)
    }

    const result = await sendFollowup(body.followupId, { consentConfirmed: body.consentConfirmed })
    if (!result.ok) {
      return json({ error: result.error, code: result.code, details: result.details }, result.status)
    }
    return json(result)
  } catch (error) {
    console.error(error)
    return json({ error: 'Não foi possível enviar a mensagem agora.' }, 500)
  }
})
