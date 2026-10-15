import { adminClient, corsHeaders, json, userClient } from '../_shared/whatsapp.ts'
import { clinicaDeQuemAtende } from '../_shared/papel.ts'
import { escolherIngredientes, lerIngredientes, primeiraPalavra, termosDeAlergia } from '../_shared/alergias.ts'

/**
 * Devolve o token do medico na Memed para a tela abrir a prescricao.
 *
 * Por que passa pelo servidor: o par de chaves da Memed (api-key e secret-key)
 * identifica o SISTEMA, nao o medico. Se ele saisse daqui para o navegador,
 * qualquer um com o console aberto poderia emitir receita em nome da clinica.
 * A Memed inclusive revoga as chaves de producao de quem faz isso.
 *
 * O medico ja tem conta na Memed, com historico e configuracoes proprias. Entao
 * a ordem e sempre: procurar primeiro, cadastrar so se nao existir. Criar uma
 * conta nova em cima de uma existente jogaria fora anos de protocolos dele.
 *
 * O token nao e fixo - a documentacao pede para buscar o mais recente a cada
 * uso, e e por isso que esta funcao existe em vez de um valor guardado.
 */

type Ambiente = { api: string }

function producaoAtiva() {
  return Deno.env.get('MEMED_AMBIENTE')?.trim().toLowerCase() === 'producao'
}

function ambiente(): Ambiente {
  const producao = producaoAtiva()
  return {
    api: producao
      ? 'https://api.memed.com.br/v1'
      : 'https://integrations.api.memed.com.br/v1',
  }
}

/** Chaves da Memed. As de homologacao sao publicas e fixas na documentacao. */
function chaves() {
  const apiKey = Deno.env.get('MEMED_API_KEY')?.trim()
  const secretKey = Deno.env.get('MEMED_SECRET_KEY')?.trim()
  if (!apiKey || !secretKey) throw new Error('Chaves da Memed não configuradas.')
  return `api-key=${encodeURIComponent(apiKey)}&secret-key=${encodeURIComponent(secretKey)}`
}

const CABECALHOS = {
  Accept: 'application/vnd.api+json',
  'Content-Type': 'application/json',
}

function soDigitos(valor: string) {
  return valor.replace(/\D/g, '')
}

/** "Marcello Ruiz da Silva" -> ["Marcello", "Ruiz da Silva"] */
function partirNome(completo: string) {
  const partes = completo.trim().split(/\s+/)
  if (partes.length === 1) return { nome: partes[0], sobrenome: partes[0] }
  return { nome: partes[0], sobrenome: partes.slice(1).join(' ') }
}

/** date do Postgres (YYYY-MM-DD) -> dd/mm/YYYY, que e o formato da Memed. */
function dataBR(iso: string) {
  const [ano, mes, dia] = iso.slice(0, 10).split('-')
  return `${dia}/${mes}/${ano}`
}

type Ajustes = {
  clinic_id: string
  signer_name: string | null
  signer_crm: string | null
  prescriber_email: string | null
  prescriber_birth_date: string | null
  prescriber_specialty_id: number | null
  prescriber_city_id: number | null
  memed_cadastro_completo_em: string | null
  memed_cadastro_dados: string | null
  clinic_phone: string | null
  clinic_phone_alt: string | null
}

/**
 * Telefone da clinica como a Memed guarda no cadastro: um numero, so digitos.
 *
 * Prefere o celular (11 digitos). Ate 16/09/2026 levava sempre o PRIMEIRO
 * numero de Preferencias, que aqui e o fixo de Santos - 10 digitos. A validacao
 * nova da Memed, a que veio com a exigencia da Anvisa, recusa esse numero: a
 * tela de Identificacao mostrava 1332736828 com um X vermelho e "Informe seu
 * telefone", e nao deixava passar. O celular passa, e e o numero que o paciente
 * ja usa - o mesmo do site e da bio do Instagram.
 */
function telefoneDaClinica(ajustes: Ajustes) {
  const candidatos = [ajustes.clinic_phone, ajustes.clinic_phone_alt]
    .flatMap((numero) => (numero ?? '').split(/[/;,]|\se\s/))
    .map(soDigitos)
    .filter((numero) => numero.length >= 10)

  return candidatos.find((numero) => numero.length === 11) ?? candidatos[0]
}

/**
 * O que foi enviado ao cadastro da Memed da ultima vez.
 *
 * Servia so uma data ("ja completei"), e com ela o envio nunca mais acontecia:
 * o telefone errado ficou preso la dentro, recusado a cada receita, e nao havia
 * como corrigir sem mexer no banco a mao. Comparando a assinatura, qualquer
 * mudanca em Preferencias chega a Memed sozinha na proxima prescricao.
 */
function assinaturaDoCadastro(
  ajustes: Ajustes,
  especialidade: number | null,
  cidade: number | null,
) {
  return [
    ajustes.prescriber_email ?? '',
    telefoneDaClinica(ajustes) ?? '',
    especialidade ?? '',
    cidade ?? '',
  ].join('|')
}

/**
 * Id da especialidade na tabela da Memed, procurado pelo nome.
 *
 * Pelo nome, e nao por numero fixo, porque os ids de homologacao e de
 * producao nao sao garantidamente os mesmos.
 */
async function idDaEspecialidade(api: string, credenciais: string) {
  const resposta = await fetch(`${api}/especialidades?${credenciais}`, { headers: CABECALHOS })
  if (!resposta.ok) return null
  const corpo = await resposta.json()
  const lista = (corpo?.data ?? []) as { id: number; attributes?: { nome?: string } }[]
  const alvo = lista.find((e) => /gastro.*pedi/i.test(e.attributes?.nome ?? ''))
  return alvo?.id ?? null
}

/** Id de Santos/SP na tabela de cidades da Memed (paginada de 100 em 100). */
async function idDaCidade(api: string, credenciais: string, nome: string, uf: string) {
  for (let offset = 0; offset < 1000; offset += 100) {
    const resposta = await fetch(
      `${api}/cidades?${credenciais}&filter[uf]=${uf}&page[offset]=${offset}`,
      { headers: CABECALHOS },
    )
    if (!resposta.ok) return null
    const corpo = await resposta.json()
    const lista = (corpo?.data ?? []) as { id: number; attributes?: { nome?: string } }[]
    const alvo = lista.find((c) => (c.attributes?.nome ?? '').toLowerCase() === nome.toLowerCase())
    if (alvo) return alvo.id
    if (lista.length < 100) break
  }
  return null
}

/**
 * Completa o cadastro do prescritor na Memed, uma vez so.
 *
 * A liberacao das chaves de producao exige e-mail, especialidade e cidade no
 * cadastro; sem isso o medico teria de preencher dentro da plataforma deles.
 * Roda uma unica vez (marca a data) e nao derruba a prescricao se falhar.
 */
async function completarCadastro(
  api: string,
  credenciais: string,
  cpf: string,
  ajustes: Ajustes,
): Promise<{ feito: boolean; detalhe?: string }> {
  const especialidade = ajustes.prescriber_specialty_id ?? (await idDaEspecialidade(api, credenciais))
  const cidade = ajustes.prescriber_city_id ?? (await idDaCidade(api, credenciais, 'Santos', 'SP'))
  const assinatura = assinaturaDoCadastro(ajustes, especialidade, cidade)

  // Nada mudou desde o ultimo envio: nao ha o que reenviar.
  if (ajustes.memed_cadastro_completo_em && ajustes.memed_cadastro_dados === assinatura) {
    return { feito: true, detalhe: 'sem mudanca desde o ultimo envio' }
  }

  const relationships: Record<string, unknown> = {}
  if (especialidade) relationships.especialidade = { data: { type: 'especialidades', id: especialidade } }
  if (cidade) relationships.cidade = { data: { type: 'cidades', id: cidade } }

  const resposta = await fetch(`${api}/sinapse-prescricao/usuarios/${cpf}?${credenciais}`, {
    method: 'PATCH',
    headers: CABECALHOS,
    body: JSON.stringify({
      data: {
        type: 'usuarios',
        attributes: {
          ...(ajustes.prescriber_email ? { email: ajustes.prescriber_email } : {}),
          ...(telefoneDaClinica(ajustes) ? { telefone: telefoneDaClinica(ajustes) } : {}),
          sexo: 'M',
        },
        ...(Object.keys(relationships).length ? { relationships } : {}),
      },
    }),
  })

  if (!resposta.ok) {
    const texto = await resposta.text()
    console.error('Memed recusou completar o cadastro', resposta.status, texto)
    return { feito: false, detalhe: `${resposta.status}: ${texto.slice(0, 300)}` }
  }

  await adminClient()
    .from('clinic_settings')
    .update({
      memed_cadastro_completo_em: new Date().toISOString(),
      memed_cadastro_dados: assinatura,
      ...(especialidade ? { prescriber_specialty_id: especialidade } : {}),
      ...(cidade ? { prescriber_city_id: cidade } : {}),
    })
    .eq('clinic_id', ajustes.clinic_id)
  return { feito: true, detalhe: `especialidade ${especialidade ?? '?'}, cidade ${cidade ?? '?'}` }
}

/** Especialidade e cidade para o cadastro novo, no formato da Memed. */
async function relacionamentosDoCadastro(api: string, credenciais: string, ajustes: Ajustes) {
  const especialidade = ajustes.prescriber_specialty_id ?? (await idDaEspecialidade(api, credenciais))
  const cidade = ajustes.prescriber_city_id ?? (await idDaCidade(api, credenciais, 'Santos', 'SP'))
  const relationships: Record<string, unknown> = {}
  if (especialidade) relationships.especialidade = { data: { type: 'especialidades', id: especialidade } }
  if (cidade) relationships.cidade = { data: { type: 'cidades', id: cidade } }
  return Object.keys(relationships).length ? { relationships } : {}
}

/** Principios ativos da Memed que respondem por este nome. */
async function buscarIngredientes(api: string, credenciais: string, termo: string) {
  const resposta = await fetch(
    `${api}/drugs/ingredients?${credenciais}&terms=${encodeURIComponent(termo)}&limit=20`,
    { headers: CABECALHOS },
  )
  if (!resposta.ok) throw new Error(`busca de "${termo}" recusada (${resposta.status})`)
  return lerIngredientes(await resposta.json())
}

/**
 * As alergias escritas no prontuario, traduzidas para ids da Memed.
 *
 * Devolve tambem o que NAO casou, para a tela mostrar ao medico: alergia que
 * some no caminho sem ninguem saber e exatamente o que este recurso existe para
 * evitar. Se a busca falhar, diz que falhou - a receita abre do mesmo jeito,
 * mas o medico fica sabendo que o alerta nao esta ligado.
 */
async function alergiasNaMemed(api: string, credenciais: string, texto: string) {
  const { termos, semAlergia } = termosDeAlergia(texto)
  const reconhecidas: { termo: string; id: number; nome: string }[] = []
  const naoReconhecidas: string[] = []
  const falhas: string[] = []

  await Promise.all(
    termos.map(async (termo) => {
      try {
        let achados = escolherIngredientes(termo, await buscarIngredientes(api, credenciais, termo))
        const primeira = achados.length ? null : primeiraPalavra(termo)
        if (primeira) {
          achados = escolherIngredientes(primeira, await buscarIngredientes(api, credenciais, primeira))
        }
        if (achados.length) achados.forEach((c) => reconhecidas.push({ termo, id: c.id, nome: c.nome }))
        else naoReconhecidas.push(termo)
      } catch (causa) {
        console.warn('Memed: busca de principio ativo falhou', causa)
        falhas.push(termo)
      }
    }),
  )

  // Promise.all termina fora de ordem; a tela mostra na ordem em que o medico
  // escreveu.
  const ordem = (t: string) => termos.indexOf(t)
  reconhecidas.sort((a, b) => ordem(a.termo) - ordem(b.termo))
  naoReconhecidas.sort((a, b) => ordem(a) - ordem(b))
  falhas.sort((a, b) => ordem(a) - ordem(b))

  return { semAlergia, reconhecidas, naoReconhecidas, falhas }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  const autorizacao = req.headers.get('Authorization') ?? ''
  if (!autorizacao.startsWith('Bearer ')) return json({ error: 'Sessão obrigatória.' }, 401)

  try {
    const escopo = userClient(autorizacao)

    // A RLS decide de qual clinica sao os ajustes que este usuario enxerga.
    // Sem membership ativo nao vem linha nenhuma, e a funcao para aqui.
    const { data: ajustes } = await escopo
      .from('clinic_settings')
      .select('clinic_id,signer_name,signer_crm,prescriber_email,prescriber_birth_date,prescriber_specialty_id,prescriber_city_id,memed_cadastro_completo_em,memed_cadastro_dados,clinic_phone,clinic_phone_alt')
      .maybeSingle()

    if (!ajustes) return json({ error: 'Clínica não encontrada.', code: 'SEM_CLINICA' }, 403)

    // So quem atende recebe o acesso de prescritor (24/09/2026). Antes bastava
    // ser membro: a recepcao conseguia emitir receita no nome do medico.
    if (!(await clinicaDeQuemAtende(escopo, ajustes.clinic_id))) {
      return json({ error: 'Só o médico pode prescrever.', code: 'SEM_PERMISSAO' }, 403)
    }

    const env = ambiente()
    const credenciais = chaves()

    // Segundo servico desta funcao: traduzir as alergias do prontuario para os
    // ids da Memed. Fica aqui, e nao numa funcao nova, porque precisa das mesmas
    // chaves e da mesma checagem de quem atende - e as chaves nao podem ir ao
    // navegador (ver o topo do arquivo).
    const pedido = await req.json().catch(() => ({}))
    if (pedido?.acao === 'alergias') {
      return json(await alergiasNaMemed(env.api, credenciais, String(pedido.texto ?? '')))
    }

    const cpf = soDigitos(
      Deno.env.get('MEMED_CPF_PRESCRITOR')?.trim() ||
        Deno.env.get('BRY_CPF_MEDICO')?.trim() ||
        '',
    )
    if (!cpf) return json({ error: 'CPF do prescritor não configurado.', code: 'SEM_CPF' }, 503)

    // 1) Procurar. O CPF e um dos identificadores aceitos pela rota de usuarios.
    const procura = await fetch(
      `${env.api}/sinapse-prescricao/usuarios/${cpf}?${credenciais}`,
      { headers: CABECALHOS },
    )

    if (procura.ok) {
      const corpo = await procura.json()
      const token = corpo?.data?.attributes?.token
      const status = corpo?.data?.attributes?.status ?? null

      if (!token) {
        return json({
          error: 'A Memed respondeu sem o token do prescritor.',
          code: 'SEM_TOKEN',
        }, 502)
      }

      // Prescritor "Inativo" nao emite receita. Melhor dizer isso agora do que
      // deixar a tela abrir e falhar na hora de imprimir.
      if (typeof status === 'string' && /inativ/i.test(status)) {
        return json({
          error: 'O cadastro do médico está inativo na Memed. Fale com o suporte deles.',
          code: 'PRESCRITOR_INATIVO',
        }, 409)
      }

      // Cadastro ja existia (caso de hoje): completa o que a Memed exige
      // para producao, sem atrapalhar a prescricao se algo falhar.
      let cadastro: { feito: boolean; detalhe?: string }
      try {
        cadastro = await completarCadastro(env.api, credenciais, cpf, ajustes as Ajustes)
      } catch (causa) {
        console.error('Nao consegui completar o cadastro na Memed', causa)
        cadastro = { feito: false, detalhe: causa instanceof Error ? causa.message : String(causa) }
      }

      return json({ token, novo: false, ambiente: producaoAtiva() ? 'producao' : 'homologacao', cadastro })
    }

    // Qualquer coisa que nao seja "nao encontrei" e problema de verdade, e
    // cadastrar por cima seria criar conta duplicada em cima de um erro.
    if (procura.status !== 404) {
      const detalhe = await procura.text()
      console.error('Memed recusou a consulta', procura.status, detalhe)

      // 502/503/504 nao e recusa, e servico fora do ar - e a diferenca importa
      // para quem esta na frente da tela. O ambiente de teste da Memed dorme
      // nos fins de semana e das 0h as 6h; dizer "recusou" nesse caso manda o
      // medico procurar erro onde nao ha.
      const foraDoAr = procura.status >= 502 && procura.status <= 504
      return json({
        error: foraDoAr
          ? 'A Memed está fora do ar no momento. Tente de novo em alguns minutos.'
          : 'A Memed recusou a consulta do prescritor.',
        code: foraDoAr ? 'MEMED_FORA_DO_AR' : 'MEMED_RECUSOU',
        status: procura.status,
        details: detalhe.slice(0, 300),
      }, 502)
    }

    // 2) Nao existe: cadastrar. So chega aqui numa clinica nova ou no ambiente
    // de teste - o medico de hoje ja tem conta.
    if (!ajustes.signer_name || !ajustes.signer_crm) {
      return json({
        error: 'Cadastre o nome e o CRM do médico antes de prescrever.',
        code: 'CADASTRO_INCOMPLETO',
      }, 409)
    }
    // Data de nascimento e obrigatoria no cadastro (RDC 1000/25); e-mail e
    // opcional para a Memed, mas sem ele o medico tem de completar o cadastro
    // dentro da plataforma dela depois.
    if (!ajustes.prescriber_birth_date) {
      return json({
        error: 'A Memed exige a data de nascimento do médico para o primeiro acesso.',
        code: 'CADASTRO_INCOMPLETO',
      }, 409)
    }

    const { nome, sobrenome } = partirNome(ajustes.signer_name)

    const cadastro = await fetch(`${env.api}/sinapse-prescricao/usuarios?${credenciais}`, {
      method: 'POST',
      headers: CABECALHOS,
      body: JSON.stringify({
        data: {
          type: 'usuarios',
          attributes: {
            // O id da clinica como external_id: e unico, ja existe, e liga o
            // cadastro da Memed ao nosso sem inventar outro identificador.
            external_id: ajustes.clinic_id,
            nome,
            sobrenome,
            cpf,
            board: {
              board_code: 'CRM',
              board_number: soDigitos(ajustes.signer_crm),
              board_state: 'SP',
            },
            ...(ajustes.prescriber_email ? { email: ajustes.prescriber_email } : {}),
            ...(telefoneDaClinica(ajustes as Ajustes) ? { telefone: telefoneDaClinica(ajustes as Ajustes) } : {}),
            sexo: 'M',
            data_nascimento: dataBR(ajustes.prescriber_birth_date),
          },
          ...(await relacionamentosDoCadastro(env.api, credenciais, ajustes as Ajustes)),
        },
      }),
    })

    const corpoCadastro = await cadastro.text()
    if (!cadastro.ok) {
      console.error('Memed recusou o cadastro', cadastro.status, corpoCadastro)
      return json({
        error: 'A Memed recusou o cadastro do médico.',
        code: 'CADASTRO_RECUSADO',
        details: corpoCadastro.slice(0, 400),
      }, 502)
    }

    const criado = JSON.parse(corpoCadastro)
    const token = criado?.data?.attributes?.token
    if (!token) {
      return json({ error: 'A Memed cadastrou mas não devolveu o token.', code: 'SEM_TOKEN' }, 502)
    }

    // Registra que este medico passou a existir na Memed. Nao e essencial para
    // funcionar, mas evita ficar adivinhando depois se o cadastro foi feito
    // por aqui ou direto no site deles.
    await adminClient()
      .from('clinic_settings')
      .update({ memed_prescritor_criado_em: new Date().toISOString() })
      .eq('clinic_id', ajustes.clinic_id)

    return json({ token, novo: true, ambiente: producaoAtiva() ? 'producao' : 'homologacao' })
  } catch (causa) {
    console.error('memed-prescritor falhou', causa)
    return json({ error: causa instanceof Error ? causa.message : 'Falha inesperada.' }, 500)
  }
})
