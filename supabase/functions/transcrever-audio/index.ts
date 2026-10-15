import { corsHeaders, json, userClient } from '../_shared/whatsapp.ts'
import { clinicaDeQuemAtende } from '../_shared/papel.ts'

/**
 * Transcricao de audio do prontuario.
 *
 * O navegador grava e manda o audio para ca; esta funcao fala com a Groq e
 * devolve o texto. A chave NUNCA vai para o navegador - se fosse guardada na
 * tela, qualquer pessoa com acesso ao computador da clinica poderia extrai-la.
 *
 * Modelo: whisper-large-v3 na Groq. Mesma qualidade do Whisper da OpenAI, com
 * API compativel e um nivel gratuito que cobre com folga o volume de um
 * consultorio.
 */

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions'
const GROQ_MODEL = 'whisper-large-v3'

// A Groq aceita ate 25 MB. Um audio de consulta raramente passa de 2 MB, entao
// o limite aqui e principalmente uma protecao contra envio acidental.
const TAMANHO_MAXIMO = 20 * 1024 * 1024

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  try {
    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return json({ error: 'Sessão obrigatória.' }, 401)

    // Confirma que quem pede e membro ativo de alguma clinica. Sem isso,
    // qualquer usuario autenticado poderia consumir a cota da chave.
    const scoped = userClient(authorization)
    // So quem atende (24/09/2026): o audio e a consulta falada, dado de saude
    // de crianca, e sai para um servico fora do pais. Antes qualquer membro
    // da clinica podia mandar.
    if (!(await clinicaDeQuemAtende(scoped))) {
      return json({ error: 'A transcrição é só para o médico.', code: 'SEM_PERMISSAO' }, 403)
    }

    const apiKey = Deno.env.get('GROQ_API_KEY')?.trim()
    if (!apiKey) {
      return json({
        error: 'A transcrição por voz ainda não foi configurada no servidor.',
        code: 'NO_GROQ_KEY',
      }, 503)
    }

    const entrada = await req.formData()
    const audio = entrada.get('audio')
    if (!(audio instanceof File)) {
      return json({ error: 'Nenhum áudio foi enviado.' }, 400)
    }
    if (audio.size === 0) {
      return json({ error: 'O áudio chegou vazio. Fale mais perto do microfone e tente de novo.' }, 400)
    }
    if (audio.size > TAMANHO_MAXIMO) {
      return json({ error: 'O áudio ficou grande demais. Grave trechos mais curtos.' }, 413)
    }

    const paraGroq = new FormData()
    paraGroq.append('file', audio, audio.name || 'audio.webm')
    paraGroq.append('model', GROQ_MODEL)
    paraGroq.append('language', 'pt')
    paraGroq.append('response_format', 'json')

    const inicio = Date.now()
    const resposta = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: paraGroq,
    })

    if (!resposta.ok) {
      const detalhe = await resposta.text()
      console.error('Groq recusou', resposta.status, detalhe)
      if (resposta.status === 401) {
        return json({ error: 'A chave de transcrição foi recusada. Gere outra e atualize o servidor.', code: 'GROQ_UNAUTHORIZED' }, 502)
      }
      if (resposta.status === 429) {
        return json({ error: 'Limite de transcrições atingido por agora. Tente novamente em alguns minutos.', code: 'GROQ_RATE_LIMIT' }, 429)
      }
      return json({ error: 'Não foi possível transcrever o áudio agora.', code: 'GROQ_ERROR' }, 502)
    }

    const corpo = await resposta.json()
    const texto = String(corpo?.text ?? '').trim()
    console.log(`transcrever-audio: ${(audio.size / 1024).toFixed(0)}KB em ${Date.now() - inicio}ms, ${texto.length} caracteres`)

    return json({ ok: true, texto })
  } catch (error) {
    console.error(error)
    return json({ error: 'Falha ao transcrever o áudio.' }, 500)
  }
})
