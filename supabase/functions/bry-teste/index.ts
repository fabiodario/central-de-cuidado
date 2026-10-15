// Sem importar nada do projeto de proposito: assim este arquivo pode ser colado
// inteiro no editor do painel do Supabase quando a CLI der trabalho. E uma
// funcao temporaria de diagnostico - some quando a assinatura estiver pronta.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  })
}

/**
 * Teste de conexao com a BRy. Nao assina nada.
 *
 * Existe para responder uma pergunta de cada vez, antes de escrever a
 * assinatura de verdade:
 *   1. As tres chaves salvas nos segredos estao certas?
 *   2. A BRy devolve um token de acesso para esta aplicacao?
 *   3. O VIDaaS - o certificado que o medico ja tem - aparece na lista de
 *      provedores disponiveis para esta conta?
 *   4. (com ?acao=link) O VIDaaS gera a tela de autorizacao para o CPF dele?
 *
 * Se qualquer uma das quatro falhar, nao adianta escrever o resto: o erro
 * apareceria la na frente misturado com dez outras coisas e ninguem saberia
 * dizer se o problema era a chave, o ambiente ou o certificado.
 *
 * Nenhuma das quatro consome credito. So a assinatura em si custa.
 *
 * Roda contra a HOMOLOGACAO por padrao, que nao consome credito. Producao so
 * com BRY_AMBIENTE=producao.
 *
 * O token NUNCA volta na resposta. Ele autoriza assinar em nome da clinica; sair
 * daqui pela tela seria a mesma coisa que publicar uma senha.
 */

type Ambiente = { cloud: string; integra: string; nome: string }

function ambiente(): Ambiente {
  const producao = Deno.env.get('BRY_AMBIENTE')?.trim().toLowerCase() === 'producao'
  return producao
    ? {
      nome: 'producao',
      cloud: 'https://cloud.bry.com.br',
      integra: 'https://integra.bry.com.br/api/service',
    }
    : {
      nome: 'homologacao',
      cloud: 'https://cloud-hom.bry.com.br',
      integra: 'https://integra.hom.bry.com.br/api/service',
    }
}

/** Troca client_id + client_secret por um token de acesso de curta duracao. */
async function obterToken(env: Ambiente, clientId: string, clientSecret: string) {
  const corpo = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  })

  const resposta = await fetch(`${env.cloud}/token-service/jwt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: corpo.toString(),
  })

  const texto = await resposta.text()
  if (!resposta.ok) {
    // O corpo do erro pode nao ser JSON quando o problema e de rede ou de
    // gateway. Devolver o texto cru e mais util do que um "falhou" generico.
    return { erro: texto.slice(0, 500), status: resposta.status }
  }

  const dados = JSON.parse(texto) as { access_token?: string; expires_in?: number }
  if (!dados.access_token) {
    return { erro: 'A BRy respondeu sem access_token.', status: resposta.status }
  }
  return { token: dados.access_token, expiraEm: dados.expires_in ?? null }
}

/**
 * Pede ao VIDaaS a tela onde o medico escolhe o certificado.
 *
 * scope single_signature: a permissao vale para UMA assinatura e morre. Foi a
 * escolha do medico - ele prefere aprovar no celular a cada atendimento. Trocar
 * para signature_session (uma aprovacao por periodo) e mudar esta palavra.
 *
 * O CPF vem de segredo, nunca do codigo nem da URL: o repositorio e publicado
 * no GitHub, e endereco com CPF fica no historico do navegador e nos logs.
 */
async function gerarLink(env: Ambiente, token: string, cpf: string, redirectUri: string) {
  const resposta = await fetch(`${env.integra}/psc/link`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pscName: 'Vidaas',
      redirectUri,
      // Sem valor real ainda: no sistema de verdade este campo leva o id da
      // consulta, para saber qual atendimento assinar quando o medico voltar.
      state: 'teste-de-conexao',
      scope: 'single_signature',
      numberOfDocuments: 1,
      // 15 minutos: tempo de sobra para autorizar no celular, curto o
      // bastante para nao deixar uma permissao esquecida de pe.
      lifetime: 900,
      cpf,
    }),
  })

  const texto = await resposta.text()
  if (!resposta.ok) return { erro: texto.slice(0, 500), status: resposta.status }

  const dados = JSON.parse(texto) as { token?: string; url?: string }
  if (!dados.url) return { erro: 'A BRy respondeu sem url de autorizacao.', status: resposta.status }
  return { url: dados.url, credencial: Boolean(dados.token) }
}

/** Campos de identificacao do corpo do JWT, sem nada sensivel. */
function identidadeDoToken(token: string): Record<string, unknown> {
  try {
    const corpo = token.split('.')[1]
    const json = atob(corpo.replace(/-/g, '+').replace(/_/g, '/'))
    const dados = JSON.parse(json) as Record<string, unknown>
    const chaves = ['sub', 'client_id', 'clientId', 'azp', 'name', 'preferred_username', 'email', 'account', 'conta', 'aud', 'iss']
    return Object.fromEntries(chaves.filter((k) => k in dados).map((k) => [k, dados[k]]))
  } catch {
    return { aviso: 'token nao decodificavel' }
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const env = ambiente()
  const acao = new URL(req.url).searchParams.get('acao')

  const clientId = Deno.env.get('BRY_CLIENT_ID')?.trim()
  const clientSecret = Deno.env.get('BRY_CLIENT_SECRET')?.trim()
  const chave = Deno.env.get('BRY_CHAVE')?.trim()

  // Falta de configuracao e um caso a parte: dizer QUAL segredo falta evita a
  // caca ao tesouro de conferir os tres um por um no painel.
  const faltando = [
    !clientId && 'BRY_CLIENT_ID',
    !clientSecret && 'BRY_CLIENT_SECRET',
    !chave && 'BRY_CHAVE',
  ].filter(Boolean)

  if (faltando.length) {
    return json({
      ok: false,
      etapa: 'segredos',
      erro: `Faltam segredos na Edge Function: ${faltando.join(', ')}.`,
    }, 503)
  }

  try {
    const autenticacao = await obterToken(env, clientId!, clientSecret!)

    if ('erro' in autenticacao) {
      return json({
        ok: false,
        etapa: 'autenticacao',
        ambiente: env.nome,
        status: autenticacao.status,
        erro: autenticacao.erro,
        dica: autenticacao.status === 401
          ? 'client_id ou client_secret nao conferem, ou foram emitidos no outro ambiente (a aplicacao de homologacao e a de producao tem chaves diferentes).'
          : undefined,
      }, 502)
    }

    // Segunda pergunta: esta conta enxerga o VIDaaS?
    const pscs = await fetch(`${env.integra}/psc/list`, {
      headers: { Authorization: `Bearer ${autenticacao.token}` },
    })

    const textoPsc = await pscs.text()
    if (!pscs.ok) {
      return json({
        ok: false,
        // O token saiu, entao a autenticacao esta resolvida - o problema e o
        // outro servico. Separar as etapas e o que torna o teste util.
        etapa: 'lista de certificadoras',
        ambiente: env.nome,
        tokenObtido: true,
        status: pscs.status,
        erro: textoPsc.slice(0, 500),
      }, 502)
    }

    const lista = JSON.parse(textoPsc) as Array<{ name?: string }>
    const nomes = lista.map((p) => p.name).filter(Boolean) as string[]
    const temVidaas = nomes.some((n) => /vidaas/i.test(n))

    if (acao === 'link') {
      const cpf = Deno.env.get('BRY_CPF_MEDICO')?.trim()
      if (!cpf) {
        return json({
          ok: false,
          etapa: 'segredos',
          erro: 'Falta o segredo BRY_CPF_MEDICO na Edge Function.',
        }, 503)
      }

      // Sem reserva fixa (15/10/2026): a que havia aqui era o endereco do
      // sistema do Dr. Marcello, de onde este espelho veio.
      const destino = Deno.env.get('BRY_REDIRECT_URI')?.trim()
      if (!destino) {
        return json({
          ok: false,
          etapa: 'segredos',
          erro: 'Falta o segredo BRY_REDIRECT_URI na Edge Function (o endereço do sistema do Dr. Fábio).',
        }, 503)
      }

      const link = await gerarLink(env, autenticacao.token, cpf, destino)
      if ('erro' in link) {
        return json({
          ok: false,
          etapa: 'link de autorizacao',
          ambiente: env.nome,
          status: link.status,
          erro: link.erro,
        }, 502)
      }

      return json({
        ok: true,
        ambiente: env.nome,
        // A URL precisa aparecer: e ela que o medico abre. As credenciais da
        // BRy continuam do lado de ca - o que sai daqui e so o endereco da
        // tela do VIDaaS, que sem o celular dele nao autoriza nada.
        abraEsteEndereco: link.url,
        credencialGerada: link.credencial,
        aviso: 'Este link vale 15 minutos e serve para UMA assinatura. Nao gastou credito.',
      })
    }

    // De quem e o token? O JWT da BRy traz a identificacao da aplicacao e da
    // conta no corpo. Mostrar isso (sem o segredo, que nao esta no token)
    // responde na hora "as chaves sao da conta do medico?" - em 06/09/2026 a
    // duvida surgiu porque o saldo nao mexeu depois de uma assinatura.
    const conta = identidadeDoToken(autenticacao.token)

    return json({
      ok: true,
      ambiente: env.nome,
      tokenObtido: true,
      conta,
      clientIdConfigurado: (Deno.env.get('BRY_CLIENT_ID') ?? '').trim().slice(0, 8) + '…',
      expiraEmSegundos: autenticacao.expiraEm,
      certificadoras: nomes,
      vidaasDisponivel: temVidaas,
      proximoPasso: temVidaas
        ? 'Caminho aberto. Da para vincular o certificado do medico e assinar.'
        : 'O VIDaaS nao apareceu nesta conta. Antes de escrever a assinatura, perguntar a BRy se ele precisa ser habilitado.',
    })
  } catch (causa) {
    console.error('bry-teste falhou', causa)
    return json({
      ok: false,
      etapa: 'inesperado',
      ambiente: env.nome,
      erro: String(causa).slice(0, 500),
    }, 500)
  }
})
