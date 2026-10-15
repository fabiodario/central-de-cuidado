import { adminClient, corsHeaders, json, userClient } from '../_shared/whatsapp.ts'
import { montarPdfDoAtendimento } from '../_shared/pdf-do-prontuario.ts'

/**
 * Assinatura digital do atendimento com o certificado ICP-Brasil do medico.
 *
 * Duas etapas, porque tem um humano no meio:
 *
 *   iniciar  - o sistema pede a permissao a BRy e devolve o endereco do VIDaaS.
 *              O medico sai daqui, aprova com a digital no celular, e o
 *              navegador volta com o numero do pedido.
 *   concluir - o sistema monta o PDF a partir do banco, manda assinar com a
 *              permissao guardada, e arquiva o documento assinado.
 *
 * Por que o PDF nasce aqui e nao no navegador: a assinatura precisa provar que
 * o medico assinou AQUELE atendimento, e nao um PDF qualquer que o navegador
 * montou. Gerando no servidor a partir das mesmas linhas do banco, o documento
 * assinado e o registro sao a mesma coisa por construcao.
 *
 * O que esta funcao NAO faz: nao marca nada como assinado sem que a BRy tenha
 * devolvido o arquivo. Um prontuario que diz "assinado" sem estar e pior do que
 * um que diz "pendente", porque ninguem vai conferir.
 */

type Pedido =
  | { acao: 'iniciar'; consultationId: string; voltarPara?: string }
  | { acao: 'concluir'; pedido: string }

const AMBIENTES = {
  producao: {
    cloud: 'https://cloud.bry.com.br',
    integra: 'https://integra.bry.com.br/api/service',
    hub: 'https://hub2.bry.com.br',
  },
  homologacao: {
    cloud: 'https://cloud-hom.bry.com.br',
    integra: 'https://integra.hom.bry.com.br/api/service',
    hub: 'https://hub2.hom.bry.com.br',
  },
}

function ambiente() {
  const producao = Deno.env.get('BRY_AMBIENTE')?.trim().toLowerCase() === 'producao'
  return producao ? AMBIENTES.producao : AMBIENTES.homologacao
}

async function tokenDaBry(cloud: string) {
  const clientId = Deno.env.get('BRY_CLIENT_ID')?.trim()
  const clientSecret = Deno.env.get('BRY_CLIENT_SECRET')?.trim()
  if (!clientId || !clientSecret) throw new Error('Chaves da BRy não configuradas.')

  const resposta = await fetch(`${cloud}/token-service/jwt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  })

  if (!resposta.ok) throw new Error(`A BRy recusou as credenciais (${resposta.status}).`)
  const dados = await resposta.json()
  if (!dados?.access_token) throw new Error('A BRy respondeu sem token de acesso.')
  return dados.access_token as string
}

/**
 * Pergunta a BRy se a credencial ja foi autorizada no celular.
 *
 * E a resposta definitiva: 'signatureReady' so vira true depois que o medico
 * aprova no VIDaaS. Antes disto o sistema tentava assinar e adivinhava, pelo
 * texto do erro, se era "ainda nao" ou "deu errado" - e um 401 de qualquer
 * outra origem (endereco errado, token vencido) viraria espera eterna.
 */
async function situacaoDaCredencial(integra: string, jwt: string, credencial: string) {
  const resposta = await fetch(`${integra}/auth/info`, {
    headers: { Authorization: `Bearer ${jwt}`, 'X-API-KEY': credencial },
  })
  const texto = await resposta.text()
  if (!resposta.ok) {
    return { ok: false as const, status: resposta.status, texto }
  }
  const dados = JSON.parse(texto) as { signatureReady?: boolean; expiration?: number; scope?: string }
  return { ok: true as const, pronta: dados.signatureReady === true, dados }
}

type Admin = ReturnType<typeof adminClient>

/**
 * Grava na consulta que ela foi assinada. Um lugar so, porque acontece em
 * dois caminhos: logo depois de assinar, e na recuperacao de um documento
 * que ja estava arquivado.
 */
async function registrarAssinatura(
  admin: Admin,
  clinicaId: string,
  consultaId: string,
  pedidoId: string,
  caminho: string,
  digital: string,
  assinadoEm: string,
) {
  const { data: ajustes } = await admin
    .from('clinic_settings')
    .select('signer_name')
    .eq('clinic_id', clinicaId)
    .maybeSingle()

  return admin
    .from('consultations')
    .update({
      signed_at: assinadoEm,
      signed_by_name: ajustes?.signer_name ?? null,
      signature_provider: 'BRy/VIDaaS',
      signature_reference: pedidoId,
      signed_pdf_path: caminho,
      signed_pdf_hash: digital,
    })
    .eq('id', consultaId)
}

/**
 * Pedido que assinou e arquivou mas nao registrou: termina o servico.
 * Devolve a data da assinatura quando conseguiu, null quando nao havia nada.
 */
async function recuperarAssinaturaArquivada(admin: Admin, consultaId: string) {
  const { data: pedido } = await admin
    .from('signature_requests')
    .select('id,clinic_id,failed_at,failure_reason')
    .eq('consultation_id', consultaId)
    .like('failure_reason', 'registro:%')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!pedido) return null

  const caminho = `${pedido.clinic_id}/${consultaId}.pdf`
  const { data: arquivo } = await admin.storage.from('prontuarios-assinados').download(caminho)
  if (!arquivo) return null

  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  const digital = await digitalDoArquivo(bytes)
  const assinadoEm = pedido.failed_at ?? new Date().toISOString()

  const { error } = await registrarAssinatura(admin, pedido.clinic_id, consultaId, pedido.id, caminho, digital, assinadoEm)
  if (error) {
    console.error('Recuperacao falhou', error)
    return null
  }
  await admin
    .from('signature_requests')
    .update({ used_at: assinadoEm, failed_at: null, failure_reason: null })
    .eq('id', pedido.id)
  return assinadoEm
}

/** Duracao da sessao de assinatura: um turno. */
const SESSAO_SEGUNDOS = 4 * 60 * 60

/**
 * Sessao do usuario que ainda assina: existe, foi aprovada, nao venceu.
 *
 * A BRy e quem responde se a credencial continua pronta - o prazo guardado
 * aqui e uma estimativa, e o certificado pode ter sido revogado no meio.
 * Sessao que a BRy nao reconhece mais e fechada na hora, para nao ser
 * tentada de novo a cada clique.
 */
async function sessaoAtiva(admin: Admin, integra: string, jwt: string, usuarioId: string) {
  const { data: sessao } = await admin
    .from('signature_sessions')
    .select('id,psc_credential,expires_at,ready_at')
    .eq('user_id', usuarioId)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!sessao) return null

  const situacao = await situacaoDaCredencial(integra, jwt, sessao.psc_credential)
  if (!situacao.ok || !situacao.pronta) {
    // Nunca aprovada (o medico desistiu no celular) ou ja invalida: encerra.
    // Uma sessao recem-criada e ainda nao aprovada tambem cai aqui, e tudo
    // bem: o clique gera outra, e a anterior nao vale nada.
    await admin.from('signature_sessions').update({ revoked_at: new Date().toISOString() }).eq('id', sessao.id)
    return null
  }

  const expiraEm = situacao.dados.expiration
    ? new Date(situacao.dados.expiration * 1000).toISOString()
    : sessao.expires_at
  if (new Date(expiraEm).getTime() < Date.now()) {
    await admin.from('signature_sessions').update({ revoked_at: new Date().toISOString() }).eq('id', sessao.id)
    return null
  }
  if (!sessao.ready_at || expiraEm !== sessao.expires_at) {
    await admin
      .from('signature_sessions')
      .update({ ready_at: sessao.ready_at ?? new Date().toISOString(), expires_at: expiraEm })
      .eq('id', sessao.id)
  }
  return { psc_credential: sessao.psc_credential as string, expires_at: expiraEm }
}

/** Marca de "alguem ja esta assinando este pedido". Some ao concluir. */
const EM_ANDAMENTO = 'em andamento'

async function digitalDoArquivo(bytes: Uint8Array) {
  const resumo = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(resumo), (b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  const autorizacao = req.headers.get('Authorization') ?? ''
  if (!autorizacao.startsWith('Bearer ')) return json({ error: 'Sessão obrigatória.' }, 401)

  const env = ambiente()
  const admin = adminClient()
  const escopo = userClient(autorizacao)

  try {
    const corpo = (await req.json()) as Pedido

    // -----------------------------------------------------------------------
    // ETAPA 1 - pedir a permissao
    // -----------------------------------------------------------------------
    if (corpo.acao === 'iniciar') {
      if (!corpo.consultationId) return json({ error: 'Consulta não informada.' }, 400)

      // A RLS e a autorizacao: se a consulta nao aparece para este usuario, ele
      // nao pode manda-la assinar. Nao ha checagem de papel aqui alem dessa -
      // e a mesma regra que ja governa quem enxerga o prontuario.
      const { data: consulta, error: erroConsulta } = await escopo
        .from('consultations')
        .select('id,clinic_id,patient_id,signed_at')
        .eq('id', corpo.consultationId)
        .maybeSingle()

      if (erroConsulta) {
        console.error('Falha ao ler a consulta', erroConsulta)
        return json({ error: 'Falha ao verificar o atendimento.' }, 500)
      }
      if (!consulta) return json({ error: 'Atendimento não encontrado.', code: 'NOT_VISIBLE' }, 403)
      if (consulta.signed_at) {
        return json({
          error: 'Este atendimento já está assinado.',
          code: 'JA_ASSINADO',
        }, 409)
      }

      // Antes de pedir uma autorizacao nova: existe assinatura pronta, feita e
      // arquivada, que so nao chegou a ser registrada? Em 06/09/2026 a BRy
      // assinou e o registro caiu por permissao. Pedir de novo custaria outra
      // assinatura e outra ida ao celular por um documento que ja existe.
      const recuperada = await recuperarAssinaturaArquivada(admin, consulta.id)
      if (recuperada) return json({ ok: true, recuperado: true, assinadoEm: recuperada })

      const cpf = Deno.env.get('BRY_CPF_MEDICO')?.trim()
      if (!cpf) return json({ error: 'CPF do certificado não configurado.', code: 'SEM_CPF' }, 503)

      const token = await tokenDaBry(env.cloud)
      const { data: usuario } = await escopo.auth.getUser()
      const usuarioId = usuario?.user?.id ?? null

      // O id do pedido e gerado antes da chamada porque a BRy devolve o "state"
      // sem alteracao: e por ele que a volta do VIDaaS sabe qual atendimento
      // estava sendo assinado.
      const pedidoId = crypto.randomUUID()

      // Sessao aberta? Uma aprovacao no celular vale por um turno (4 horas).
      // Se a credencial do turno ainda esta pronta, o pedido nasce ligado a
      // ela e a tela assina na hora, sem VIDaaS.
      const sessao = usuarioId ? await sessaoAtiva(admin, env.integra, token, usuarioId) : null
      if (sessao) {
        const { error: erroPedido } = await admin.from('signature_requests').insert({
          id: pedidoId,
          clinic_id: consulta.clinic_id,
          consultation_id: consulta.id,
          patient_id: consulta.patient_id,
          requested_by: usuarioId,
          psc_credential: sessao.psc_credential,
          expires_at: sessao.expires_at,
        })
        if (erroPedido) {
          console.error('Falha ao guardar o pedido', erroPedido)
          return json({ error: 'Falha ao registrar o pedido de assinatura.' }, 500)
        }
        return json({ ok: true, pedido: pedidoId, sessaoAtiva: true, expiraEm: sessao.expires_at })
      }

      // Para onde o VIDaaS devolve o medico depois de aprovar no celular. A
      // tela sempre manda o proprio endereco; o segredo e a reserva. Ate
      // 15/10/2026 havia uma terceira reserva fixa: o endereco do sistema do
      // Dr. Marcello, de onde este espelho veio. Aqui ela mandaria o Dr. Fabio,
      // assinatura aprovada, para a tela de outra clinica. Sem os dois, para
      // com o motivo, em vez de adivinhar.
      const destino = corpo.voltarPara || Deno.env.get('BRY_REDIRECT_URI')?.trim()
      if (!destino) {
        return json({
          error: 'Endereço de volta da assinatura não configurado (segredo BRY_REDIRECT_URI).',
          code: 'SEM_VOLTA',
        }, 503)
      }

      const resposta = await fetch(`${env.integra}/psc/link`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pscName: 'Vidaas',
          redirectUri: destino,
          state: pedidoId,
          // Sessao por turno, por escolha do medico (06/09/2026): aprova uma
          // vez, assina o resto das 4 horas sem celular. O PSC pode encurtar
          // o prazo; o valor real vem do auth/info depois da primeira vez.
          scope: 'signature_session',
          numberOfDocuments: 100,
          lifetime: SESSAO_SEGUNDOS,
          cpf,
        }),
      })

      const texto = await resposta.text()
      if (!resposta.ok) {
        console.error('psc/link recusado', resposta.status, texto)
        return json({
          error: 'A certificadora recusou o pedido de autorização.',
          code: 'PSC_RECUSOU',
          details: texto.slice(0, 300),
        }, 502)
      }

      const dados = JSON.parse(texto) as { token?: string; url?: string }
      if (!dados.url || !dados.token) {
        return json({ error: 'A certificadora respondeu incompleta.', code: 'PSC_INCOMPLETO' }, 502)
      }

      const expiraEm = new Date(Date.now() + SESSAO_SEGUNDOS * 1000).toISOString()

      if (usuarioId) {
        await admin.from('signature_sessions').insert({
          clinic_id: consulta.clinic_id,
          user_id: usuarioId,
          psc_credential: dados.token,
          expires_at: expiraEm,
        })
      }

      const { error: erroPedido } = await admin.from('signature_requests').insert({
        id: pedidoId,
        clinic_id: consulta.clinic_id,
        consultation_id: consulta.id,
        patient_id: consulta.patient_id,
        requested_by: usuarioId,
        psc_credential: dados.token,
        expires_at: expiraEm,
      })

      if (erroPedido) {
        console.error('Falha ao guardar o pedido', erroPedido)
        return json({ error: 'Falha ao registrar o pedido de assinatura.' }, 500)
      }

      return json({ ok: true, pedido: pedidoId, autorizarEm: dados.url, expiraEm })
    }

    // -----------------------------------------------------------------------
    // ETAPA 2 - assinar, ja com a permissao dada
    // -----------------------------------------------------------------------
    if (corpo.acao === 'concluir') {
      if (!corpo.pedido) return json({ error: 'Pedido não informado.' }, 400)

      const { data: pedido } = await admin
        .from('signature_requests')
        .select('id,clinic_id,consultation_id,patient_id,psc_credential,expires_at,used_at,failed_at,failure_reason')
        .eq('id', corpo.pedido)
        .maybeSingle()

      if (!pedido) return json({ error: 'Pedido de assinatura não encontrado.' }, 404)
      // Pedido ja usado e sucesso, nao erro: e a outra tela perguntando depois
      // que a primeira concluiu. Devolver erro aqui mostraria "falhou" para um
      // atendimento assinado.
      if (pedido.used_at) return json({ ok: true, assinadoEm: pedido.used_at, jaEstava: true })
      if (pedido.failed_at) {
        return json({
          error: 'Este pedido já falhou. Peça a assinatura de novo.',
          code: 'JA_FALHOU',
          details: pedido.failure_reason ?? undefined,
        }, 409)
      }
      if (new Date(pedido.expires_at).getTime() < Date.now()) {
        return json({
          error: 'A autorização expirou. Peça a assinatura de novo.',
          code: 'EXPIROU',
        }, 409)
      }

      // O pedido veio do banco com service_role, que ignora RLS. A checagem de
      // acesso precisa ser refeita com os olhos do usuario, senao qualquer
      // sessao valida poderia concluir o pedido de outra clinica.
      const { data: consulta } = await escopo
        .from('consultations')
        .select(
          'id,clinic_id,patient_id,consultation_date,encounter_type,unit,weight_kg,height_cm,chief_complaint,clinical_history,personal_history,family_history,allergies,current_medications,physical_exam,assessment,cid,plan,prescription,return_plan,signed_at',
        )
        .eq('id', pedido.consultation_id)
        .maybeSingle()

      if (!consulta) return json({ error: 'Atendimento não encontrado.', code: 'NOT_VISIBLE' }, 403)
      if (consulta.signed_at) return json({ ok: true, assinadoEm: consulta.signed_at, jaEstava: true })

      const { data: paciente } = await escopo
        .from('patients')
        .select('name,birth_date,sex,guardian_name,insurance')
        .eq('id', pedido.patient_id)
        .maybeSingle()

      if (!paciente) return json({ error: 'Paciente não encontrado.' }, 404)

      const jwt = await tokenDaBry(env.cloud)

      // Primeiro: o medico ja aprovou? Sem isto nao adianta montar PDF nenhum.
      // "Ainda nao" nao e falha, e espera: a tela pergunta de novo em segundos.
      const credencial = await situacaoDaCredencial(env.integra, jwt, pedido.psc_credential)
      if (!credencial.ok) {
        console.error('auth/info recusou', credencial.status, credencial.texto)
        await admin
          .from('signature_requests')
          .update({ failed_at: new Date().toISOString(), failure_reason: `auth/info ${credencial.status}: ${credencial.texto.slice(0, 400)}` })
          .eq('id', pedido.id)
        return json({
          error: 'A certificadora não reconheceu o pedido de assinatura.',
          code: 'CREDENCIAL_INVALIDA',
          status: credencial.status,
          details: credencial.texto.slice(0, 300),
        }, 502)
      }
      if (!credencial.pronta) {
        return json({
          ok: false,
          code: 'AGUARDANDO',
          error: 'Aguardando a autorização no celular.',
          details: `v2 auth/info ${JSON.stringify(credencial.dados)}`,
        }, 202)
      }

      // Aprovada: a sessao do turno passa a valer, com o prazo que a BRy diz.
      await admin
        .from('signature_sessions')
        .update({
          ready_at: new Date().toISOString(),
          ...(credencial.dados.expiration
            ? { expires_at: new Date(credencial.dados.expiration * 1000).toISOString() }
            : {}),
        })
        .eq('psc_credential', pedido.psc_credential)
        .is('ready_at', null)

      // Duas telas podem chegar aqui ao mesmo tempo: a que ficou perguntando
      // e a aba que o VIDaaS devolveu com o numero do pedido. Sem esta marca,
      // as duas assinariam - duas cobrancas e dois arquivos para um mesmo
      // atendimento. Quem marca primeiro assina; a outra espera e, na
      // proxima pergunta, encontra a consulta ja assinada.
      const { data: reservado } = await admin
        .from('signature_requests')
        .update({ failure_reason: EM_ANDAMENTO })
        .eq('id', pedido.id)
        .is('failure_reason', null)
        .is('used_at', null)
        .select('id')
      if (!reservado || reservado.length === 0) {
        return json({
          ok: false,
          code: 'AGUARDANDO',
          error: 'A assinatura já está sendo concluída.',
          details: 'outra tela está assinando',
        }, 202)
      }

      const { data: clinica } = await admin
        .from('clinics')
        .select('name')
        .eq('id', pedido.clinic_id)
        .maybeSingle()

      const { data: ajustes } = await admin
        .from('clinic_settings')
        .select('signer_name,signer_crm')
        .eq('clinic_id', pedido.clinic_id)
        .maybeSingle()

      // O selo da corrente entra no rodape para ligar o papel ao registro: quem
      // tiver o PDF na mao consegue perguntar ao sistema se aquele atendimento
      // continua igual ao que foi assinado.
      const { data: integridade } = await admin.rpc('conferir_integridade_prontuario', {
        p_clinic_id: pedido.clinic_id,
      })

      const pdf = await montarPdfDoAtendimento({
        clinica: clinica?.name ?? 'Clínica',
        medico: ajustes?.signer_name ?? 'Médico responsável',
        crm: ajustes?.signer_crm ?? '',
        paciente,
        consulta,
        selo: Array.isArray(integridade) ? integridade[0]?.selo ?? null : null,
        geradoEm: new Date(),
      })

      const token = jwt

      // O endereco do assinador e o perfil ficam configuraveis porque sao a
      // parte da integracao que ainda nao foi confirmada com a BRy. Errar aqui
      // e uma troca de segredo, e nao uma reimplantacao as pressas.
      //
      // Pela documentacao do Integra: a assinatura e feita no HUB Signer, e o
      // "url" da credencial PSC e a base do proprio Integra. Como isto nunca
      // foi exercitado ate 06/09/2026, o sistema tenta o HUB e, se ele
      // recusar, tenta o Integra - e guarda as duas respostas para leitura.
      const enderecosDoAssinador = [
        Deno.env.get('BRY_ASSINATURA_URL')?.trim() || '',
        `${env.hub}/fw/v1/pdf/kms/lote/assinaturas`,
        `${env.integra}/fw/v1/pdf/kms/lote/assinaturas`,
      ].filter((endereco, indice, lista) => endereco && lista.indexOf(endereco) === indice)
      const urlDoPsc = Deno.env.get('BRY_PSC_URL')?.trim() || env.integra
      // ADRB: assinatura ICP-Brasil basica. O perfil ADRT acrescenta carimbo do
      // tempo de autoridade credenciada - e o que prova a DATA perante
      // terceiros, nao so a autoria. Fica para depois de sabermos o preco dele.
      const perfil = Deno.env.get('BRY_PERFIL')?.trim() || 'ADRB'

      const formulario = new FormData()
      formulario.append(
        'documento[0]',
        new Blob([pdf], { type: 'application/pdf' }),
        `atendimento-${consulta.consultation_date}.pdf`,
      )
      formulario.append(
        'dados_assinatura',
        JSON.stringify({
          kms_data: { url: urlDoPsc, token: pedido.psc_credential },
          perfil,
          algoritmoHash: 'SHA256',
          tipoRetorno: 'BASE64',
          razao: 'Registro de atendimento médico',
          // Depois de assinado o documento nao aceita mais alteracao: e um
          // registro de prontuario, nao um formulario.
          tipoRestricao: 'DESABILITAR_QUALQUER_ALTERACAO',
        }),
      )

      // Carimbo visivel na ultima pagina. A assinatura em si e invisivel e
      // esta dentro do arquivo - e o que vale e o que o validador do ITI le.
      // Mas quem recebe o papel espera VER quem assinou e quando; sem o bloco,
      // o documento assinado parecia igual ao nao assinado. Canto inferior
      // direito, acima do rodape que o proprio PDF ja traz. Sem CPF impresso:
      // o certificado ja o carrega, e nao ha razao para imprimi-lo.
      formulario.append(
        'configuracao_imagem',
        JSON.stringify([{
          altura: 22,
          largura: 95,
          coordenadaX: -12,
          coordenadaY: 22,
          pagina: 'ULTIMA',
          posicao: 'INFERIOR_DIREITO',
          proporcaoImagem: 0,
        }]),
      )
      formulario.append(
        'configuracao_texto',
        JSON.stringify([{
          texto: `Assinado digitalmente em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}\nCertificado ICP-Brasil (VIDaaS). Confira em validar.iti.gov.br`,
          incluirCN: true,
          incluirCPF: false,
          fonte: 'HELVETICA',
          tamanhoFonte: '7',
        }]),
      )

      let assinatura: Response | null = null
      let respostaTexto = ''
      const recusas: string[] = []
      for (const endereco of enderecosDoAssinador) {
        // O FormData nao pode ser reaproveitado depois de enviado.
        const corpo = new FormData()
        for (const [chave, valor] of formulario.entries()) corpo.append(chave, valor)
        const tentativa = await fetch(endereco, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, kms_type: 'PSC' },
          body: corpo,
        })
        respostaTexto = await tentativa.text()
        if (tentativa.ok) {
          assinatura = tentativa
          break
        }
        console.error('Assinador recusou', endereco, tentativa.status, respostaTexto)
        recusas.push(`${new URL(endereco).host} ${tentativa.status}: ${respostaTexto.slice(0, 200)}`)
      }

      if (!assinatura) {
        const motivo = recusas.join(' | ')
        await admin
          .from('signature_requests')
          .update({ failed_at: new Date().toISOString(), failure_reason: motivo.slice(0, 500) })
          .eq('id', pedido.id)

        return json({
          error: 'A certificadora recusou a assinatura.',
          code: 'ASSINADOR_RECUSOU',
          details: motivo.slice(0, 500),
        }, 502)
      }

      const retorno = JSON.parse(respostaTexto)
      const base64 = Array.isArray(retorno) ? retorno[0] : retorno?.documentos?.[0]?.base64
      if (typeof base64 !== 'string') {
        return json({
          error: 'A certificadora não devolveu o documento assinado.',
          code: 'SEM_DOCUMENTO',
          details: respostaTexto.slice(0, 300),
        }, 502)
      }

      const assinado = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const digital = await digitalDoArquivo(assinado)
      const caminho = `${pedido.clinic_id}/${pedido.consultation_id}.pdf`

      const { error: erroArquivo } = await admin.storage
        .from('prontuarios-assinados')
        .upload(caminho, assinado, { contentType: 'application/pdf', upsert: true })

      if (erroArquivo) {
        console.error('Falha ao arquivar', erroArquivo)
        await admin
          .from('signature_requests')
          .update({ failed_at: new Date().toISOString(), failure_reason: `arquivo: ${erroArquivo.message}`.slice(0, 500) })
          .eq('id', pedido.id)
        return json({
          error: 'O documento foi assinado mas não pôde ser arquivado.',
          code: 'FALHA_ARQUIVO',
        }, 500)
      }

      const agora = new Date().toISOString()

      // So agora a consulta vira "assinada" - com o arquivo ja guardado. Se a
      // ordem fosse a inversa, uma falha no meio deixaria um prontuario que
      // afirma estar assinado e um acervo sem o documento.
      const { error: erroMarcar } = await registrarAssinatura(
        admin,
        pedido.clinic_id,
        pedido.consultation_id,
        pedido.id,
        caminho,
        digital,
        agora,
      )

      if (erroMarcar) {
        console.error('Falha ao marcar como assinada', erroMarcar)
        await admin
          .from('signature_requests')
          .update({ failed_at: new Date().toISOString(), failure_reason: `registro: ${erroMarcar.message}`.slice(0, 500) })
          .eq('id', pedido.id)
        return json({
          error: 'O documento foi assinado e arquivado, mas o prontuário não registrou.',
          code: 'FALHA_REGISTRO',
        }, 500)
      }

      await admin
        .from('signature_requests')
        .update({ used_at: agora, failure_reason: null })
        .eq('id', pedido.id)

      return json({ ok: true, assinadoEm: agora, arquivo: caminho, digital })
    }

    return json({ error: 'Ação desconhecida.' }, 400)
  } catch (causa) {
    console.error('assinar-consulta falhou', causa)
    return json({ error: String(causa instanceof Error ? causa.message : causa) }, 500)
  }
})
