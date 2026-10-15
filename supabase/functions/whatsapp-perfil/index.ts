import { adminClient, corsHeaders, json, userClient } from '../_shared/whatsapp.ts'
import { chaveDoWhatsApp } from '../_shared/whatsapp-teste.ts'

/**
 * Troca a foto de perfil do WhatsApp Business pela API.
 *
 * O Gerenciador da Meta nem sempre deixa trocar a imagem - foi o que aconteceu
 * aqui. Pela API funciona, mas em tres etapas, porque a Meta nao aceita a
 * imagem direto no perfil:
 *
 *   1. abrir uma sessao de upload, dizendo tamanho e tipo do arquivo;
 *   2. enviar os bytes nessa sessao, que devolve um "handle";
 *   3. gravar o handle no perfil.
 *
 * A imagem vem de uma URL publica em vez de subir pelo navegador: assim o
 * arquivo fica versionado junto do site, e trocar a foto amanha e trocar o
 * arquivo la e chamar isto de novo.
 */

type Pedido = { imagemUrl?: string; acao?: 'foto' | 'status' | 'dados' }

/**
 * O perfil que a familia ve ao tocar no nome da conversa.
 *
 * Site, endereco, descricao e e-mail. Nada disso e o "nome de exibicao", que e
 * outra coisa e mora no Gerenciador; aqui e o cartao de visita da conta.
 *
 * Os textos sao da clinica e ficam no banco, editaveis em Preferencias: o
 * endereco muda de sala, de predio e de unidade, e trocar isso nao pode
 * depender de programador. Se algum campo estiver vazio, ele simplesmente nao
 * vai para a Meta - e melhor um perfil incompleto do que um endereco errado.
 *
 * vertical 'HEALTH' e a categoria da Meta para saude, e aparece como rotulo.
 * Essa fica no codigo porque e classificacao da Meta, e nao texto da clinica.
 */
const LIMITES = { about: 139, address: 256, description: 512, email: 128 }

function montarPerfil(linha: Record<string, unknown>) {
  const texto = (campo: string, limite: number) =>
    String(linha[campo] ?? '').trim().slice(0, limite)

  const perfil: Record<string, unknown> = { vertical: 'HEALTH' }
  const about = texto('whatsapp_profile_about', LIMITES.about)
  const address = texto('whatsapp_profile_address', LIMITES.address)
  const description = texto('whatsapp_profile_description', LIMITES.description)
  const email = texto('whatsapp_profile_email', LIMITES.email)
  const site = texto('whatsapp_profile_website', 256)

  if (about) perfil.about = about
  if (address) perfil.address = address
  if (description) perfil.description = description
  if (email) perfil.email = email
  // A Meta aceita ate dois sites; a clinica tem um.
  if (site) perfil.websites = [site]
  return perfil
}

/**
 * Como a Meta chama cada situacao do nome, em portugues.
 *
 * Os codigos dela sao secos e alguns enganam: DECLINED nao quer dizer que o
 * numero esta bloqueado, so que aquele nome especifico foi recusado. Sem esta
 * traducao, quem le a tela conclui coisa errada - foi exatamente a duvida que
 * levou a este painel.
 */
const SITUACOES: Record<string, string> = {
  APPROVED: 'Aprovado',
  AVAILABLE_WITHOUT_REVIEW: 'Em uso, sem necessidade de análise',
  DECLINED: 'Recusado',
  EXPIRED: 'Expirado',
  PENDING_REVIEW: 'Em análise',
  NONE: 'Nenhum pedido em andamento',
}

// Foto padrao do perfil (15/10/2026). Era a do Dr. Marcello, no site dele, de
// onde este espelho veio. O endereco onde a foto do Dr. Fabio vai ficar ainda
// nao existe: o marcador abaixo e de proposito, para o botao "Atualizar foto
// do perfil" falhar dizendo de onde tentou baixar, e nao subir para a Meta a
// foto de outro medico. Trocar quando a imagem estiver publicada (PNG ou
// JPEG); a lista do que falta preencher esta no LEIA-ME do projeto.
const PADRAO = 'https://PREENCHER-DOMINIO-DO-DR-FABIO/assets/perfil-whatsapp.png'

// Foto de cada clinica, quando nao vem uma URL no pedido (28/09/2026). No
// sistema do Dr. Marcello a clinica de teste dele tinha a marca do produto
// aqui; aquela clinica nao existe no banco do Dr. Fabio, entao a lista comeca
// vazia e todas usam a PADRAO. Para uma clinica com foto propria, acrescentar
// o id dela e o endereco da imagem.
const FOTO_DA_CLINICA: Record<string, string> = {}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  const autorizacao = req.headers.get('Authorization') ?? ''
  if (!autorizacao.startsWith('Bearer ')) return json({ error: 'Sessão obrigatória.' }, 401)

  try {
    const escopo = userClient(autorizacao)
    const { data: ajustes } = await escopo
      .from('clinic_settings')
      .select('clinic_id,whatsapp_phone_number_id')
      .maybeSingle()

    if (!ajustes?.whatsapp_phone_number_id) {
      return json({ error: 'WhatsApp não configurado para esta clínica.' }, 409)
    }

    const token = chaveDoWhatsApp(ajustes.whatsapp_phone_number_id)
    const appId = Deno.env.get('META_APP_ID')?.trim()
    if (!token) return json({ error: 'Token do WhatsApp não configurado.' }, 503)
    if (!appId) return json({ error: 'META_APP_ID não configurado.' }, 503)

    const versao = Deno.env.get('META_GRAPH_VERSION')?.trim() || 'v25.0'
    const corpo = (await req.json().catch(() => ({}))) as Pedido

    // Consulta o estado do nome. So leitura - nao submete nada, nao gasta
    // nenhuma das tres trocas permitidas em 30 dias.
    if (corpo.acao === 'status') {
      const campos = 'verified_name,name_status,new_name_status,display_phone_number,quality_rating'
      const consulta = await fetch(
        `https://graph.facebook.com/${versao}/${ajustes.whatsapp_phone_number_id}` +
          `?fields=${campos}&access_token=${encodeURIComponent(token)}`,
      )
      const dados = await consulta.json()
      if (!consulta.ok) {
        return json({
          error: 'A Meta recusou a consulta do número.',
          details: JSON.stringify(dados).slice(0, 400),
        }, 502)
      }

      const traduz = (v: unknown) =>
        typeof v === 'string' ? SITUACOES[v] ?? v : 'Não informado'

      return json({
        ok: true,
        numero: dados.display_phone_number ?? null,
        nomeAtual: dados.verified_name ?? null,
        situacaoDoNomeAtual: traduz(dados.name_status),
        situacaoDoPedido: traduz(dados.new_name_status),
        qualidade: dados.quality_rating ?? null,
      })
    }

    // Grava o cartao de visita da conta: site, endereco, descricao, e-mail.
    //
    // Endpoint diferente do da foto e de uma vez so - a Meta aceita o objeto
    // inteiro num POST. Nao mexe no nome de exibicao nem gasta nenhuma das
    // tres trocas de nome permitidas a cada 30 dias.
    if (corpo.acao === 'dados') {
      // Os textos vem do banco, escritos pela clinica em Preferencias.
      const { data: linha } = await escopo
        .from('clinic_settings')
        .select(
          'whatsapp_profile_about,whatsapp_profile_address,whatsapp_profile_description,' +
            'whatsapp_profile_email,whatsapp_profile_website',
        )
        .eq('clinic_id', ajustes.clinic_id)
        .maybeSingle()

      const PERFIL = montarPerfil((linha ?? {}) as Record<string, unknown>)
      if (Object.keys(PERFIL).length <= 1) {
        return json({
          error: 'Preencha o perfil em Preferências antes de enviar para a Meta.',
          code: 'PERFIL_VAZIO',
        }, 400)
      }

      const resposta = await fetch(
        `https://graph.facebook.com/${versao}/${ajustes.whatsapp_phone_number_id}/whatsapp_business_profile`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', ...PERFIL }),
        },
      )
      const dados = await resposta.json()
      if (!resposta.ok) {
        console.error('Falha ao gravar o perfil', dados)
        return json({
          error: 'A Meta recusou a gravação do perfil.',
          details: JSON.stringify(dados).slice(0, 400),
        }, 502)
      }
      return json({ ok: true, perfil: PERFIL })
    }

    const imagemUrl = corpo.imagemUrl?.trim() || FOTO_DA_CLINICA[String(ajustes.clinic_id)] || PADRAO

    // 1) Buscar a imagem.
    const imagem = await fetch(imagemUrl)
    if (!imagem.ok) {
      return json({ error: `Não consegui baixar a imagem em ${imagemUrl}.`, code: 'SEM_IMAGEM' }, 502)
    }
    const bytes = new Uint8Array(await imagem.arrayBuffer())
    const tipo = imagem.headers.get('content-type') || 'image/png'

    if (!/^image\/(png|jpe?g)$/i.test(tipo)) {
      return json({
        error: `A Meta só aceita PNG ou JPEG na foto de perfil. Este arquivo é ${tipo}.`,
        code: 'FORMATO',
      }, 400)
    }

    // 2) Abrir a sessao de upload. E aqui que o id do aplicativo entra - a
    // sessao pertence ao app, e nao ao numero de telefone.
    const sessao = await fetch(
      `https://graph.facebook.com/${versao}/${appId}/uploads` +
        `?file_length=${bytes.byteLength}&file_type=${encodeURIComponent(tipo)}` +
        `&access_token=${encodeURIComponent(token)}`,
      { method: 'POST' },
    )
    const sessaoCorpo = await sessao.json()
    if (!sessao.ok || !sessaoCorpo?.id) {
      console.error('Falha ao abrir a sessão de upload', sessaoCorpo)
      return json({
        error: 'A Meta recusou a abertura do envio.',
        code: 'SESSAO',
        details: JSON.stringify(sessaoCorpo).slice(0, 400),
      }, 502)
    }

    // 3) Enviar os bytes. O cabecalho de autorizacao aqui e "OAuth", e nao
    // "Bearer" - a Meta usa formatos diferentes entre as duas APIs, e trocar
    // um pelo outro devolve um 401 sem explicacao.
    const envio = await fetch(`https://graph.facebook.com/${versao}/${sessaoCorpo.id}`, {
      method: 'POST',
      headers: { Authorization: `OAuth ${token}`, file_offset: '0' },
      body: bytes,
    })
    const envioCorpo = await envio.json()
    if (!envio.ok || !envioCorpo?.h) {
      console.error('Falha ao enviar a imagem', envioCorpo)
      return json({
        error: 'A Meta recusou a imagem.',
        code: 'UPLOAD',
        details: JSON.stringify(envioCorpo).slice(0, 400),
      }, 502)
    }

    // 4) Gravar no perfil.
    const perfil = await fetch(
      `https://graph.facebook.com/${versao}/${ajustes.whatsapp_phone_number_id}/whatsapp_business_profile`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          profile_picture_handle: envioCorpo.h,
        }),
      },
    )
    const perfilCorpo = await perfil.json()
    if (!perfil.ok) {
      console.error('Falha ao gravar no perfil', perfilCorpo)
      return json({
        error: 'A imagem subiu mas o perfil não aceitou.',
        code: 'PERFIL',
        details: JSON.stringify(perfilCorpo).slice(0, 400),
      }, 502)
    }

    await adminClient()
      .from('clinic_settings')
      .update({ updated_at: new Date().toISOString() })
      .eq('clinic_id', ajustes.clinic_id)

    return json({ ok: true, imagem: imagemUrl, bytes: bytes.byteLength })
  } catch (causa) {
    console.error('whatsapp-perfil falhou', causa)
    return json({ error: causa instanceof Error ? causa.message : 'Falha inesperada.' }, 500)
  }
})
