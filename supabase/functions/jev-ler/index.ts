import { corsHeaders, json, userClient } from '../_shared/whatsapp.ts'
import { entradaDoSimulador, lerComJev, modoDaSegundaLeitura } from '../_shared/segunda-leitura.ts'
import { lerCaminhoComJev, type OpcaoDaLista } from '../_shared/caminho-pelo-jev.ts'

/**
 * O Jev no simulador de dentro do sistema (17/10/2026, pedido do Edu).
 *
 * O simulador roda o robo no navegador, e a chave da TypeSafe nao pode ir para
 * la: qualquer pessoa com acesso ao computador a copiaria. Esta funcao recebe
 * a mensagem digitada no simulador, confere que quem pede tem acesso ativo a
 * clinica, le o modo do Jev em Preferencias e faz a mesma leitura do
 * meta-webhook (lerComJev). O que fazer com a nota decide o simulador, com a
 * mesma funcao do webhook (decidirSegundaLeitura), porque so ele sabe o que o
 * robo respondeu.
 *
 * Desligado em Preferencias, nem chama a TypeSafe.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  try {
    const authorization = req.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return json({ error: 'Sessão obrigatória.' }, 401)

    // Membro ativo de uma clinica, pelo cliente do proprio usuario (RLS).
    // Sem isso, qualquer conta logada gastaria o credito da TypeSafe.
    const cliente = userClient(authorization)
    const { data: quem } = await cliente.auth.getUser()
    if (!quem?.user) return json({ error: 'Sessão obrigatória.' }, 401)
    const { data: vinculo, error: erroDoVinculo } = await cliente
      .from('clinic_memberships')
      .select('clinic_id')
      .eq('user_id', quem.user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (erroDoVinculo || !vinculo?.clinic_id) return json({ error: 'Só para quem tem acesso ativo à clínica.' }, 403)

    // O modo, em consulta propria: coluna nova, e o Postgres recusa a query
    // inteira quando uma coluna nao existe. Sem conseguir ler, desligado.
    const { data: opcao, error: erroDaOpcao } = await cliente
      .from('clinic_settings')
      .select('jev_segunda_leitura')
      .eq('clinic_id', vinculo.clinic_id)
      .maybeSingle()
    if (erroDaOpcao) console.warn('jev-ler: nao li o modo do Jev; segue desligado', erroDaOpcao.message)
    const modo = modoDaSegundaLeitura((opcao?.jev_segunda_leitura as string | null | undefined) ?? null)
    if (modo === 'desligada') return json({ modo, leitura: null })

    const corpo = await req.json().catch(() => null)
    const entrada = entradaDoSimulador(corpo)
    if (!entrada) return json({ error: 'Mensagem vazia ou grande demais.' }, 400)

    // O caminho pelo Jev (26/10/2026, ver _shared/caminho-pelo-jev.ts): a
    // lista que o simulador mostrou vem do navegador, conferida e cortada.
    if ((corpo as { acao?: unknown } | null)?.acao === 'caminho') {
      const bruta = (corpo as { lista?: unknown }).lista
      const lista: OpcaoDaLista[] = Array.isArray(bruta)
        ? bruta
            .filter((o): o is { numero: string; rotulo: string } =>
              Boolean(o) && typeof (o as { numero?: unknown }).numero === 'string' && /^\d{1,2}$/.test((o as { numero: string }).numero) &&
              typeof (o as { rotulo?: unknown }).rotulo === 'string')
            .slice(0, 12)
            .map((o) => ({ numero: o.numero, rotulo: o.rotulo.slice(0, 200) }))
        : []
      const leitura = await lerCaminhoComJev({ ...entrada, lista }, { chave: Deno.env.get('TYPESAFE_API_KEY') ?? '' })
      return json({ modo, leitura })
    }

    const leitura = await lerComJev(entrada, { chave: Deno.env.get('TYPESAFE_API_KEY') ?? '' })
    return json({ modo, leitura })
  } catch (erro) {
    console.error('jev-ler', erro)
    return json({ error: 'Falha ao perguntar ao Jev.' }, 500)
  }
})
