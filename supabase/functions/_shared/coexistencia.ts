import { variantesDoTelefone } from './telefone-br.ts'

/**
 * Coexistencia: o numero do consultorio no app WhatsApp Business E na API da
 * Meta ao mesmo tempo (preparado em 27/10/2026, pedido do Edu).
 *
 * O consultorio do Dr. Fabio atende hoje por um numero fixo no app WhatsApp
 * Business, em varios aparelhos. Em vez de apagar a conta do app para levar o
 * numero a API (e perder as conversas), a Meta deixa ligar o mesmo numero nos
 * dois. O robo e a Central falam pela API; a equipe continua no celular. Para
 * isso a Meta manda tres avisos alem do "messages" de sempre, e e deles que
 * este arquivo cuida:
 *
 *  - history: as conversas dos ultimos 6 meses do app, uma vez, nas 24 horas
 *    seguintes a ligacao. Foto e audio vem como "media_placeholder", sem o
 *    arquivo; o arquivo chega depois, num segundo "history" com `messages`,
 *    so para o que foi enviado nas duas ultimas semanas.
 *  - smb_message_echoes: o que a equipe escreve pelo app do celular. Entra na
 *    conversa como resposta da equipe (automatic = false), e por isso o robo
 *    fica quieto pelas 12 horas de sempre, como quando alguem responde pela
 *    Central. Sem isto o robo falaria por cima da secretaria.
 *  - smb_app_state_sync: os contatos da agenda do celular. O nome que a equipe
 *    deu ao contato vira o nome da conversa quando nao ha cadastro.
 *
 * Nada daqui chama o robo, acende alerta ou manda mensagem: e so registro. O
 * formato dos avisos e o da documentacao da Meta ("Onboarding WhatsApp
 * Business app users"), lida em 27/10/2026.
 *
 * O que vem da Meta e passado pelas mesmas funcoes do webhook (o texto da
 * mensagem, o bloco da midia, o download do arquivo): `Ferramentas`. Assim o
 * historico mostra foto, localizacao e contato do mesmo jeito que a mensagem
 * que chega ao vivo.
 */

type Admin = {
  from: (tabela: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

export type Midia = { id?: string; mime_type?: string; caption?: string; filename?: string }

/** Uma mensagem como a Meta manda no historico, no eco e no webhook comum. */
export type MensagemDoCelular = {
  from?: string
  to?: string
  id?: string
  timestamp?: string
  type?: string
  history_context?: { status?: string }
  errors?: { code?: number; title?: string }[]
  [conteudo: string]: unknown
}

export type Ferramentas = {
  /** O texto da mensagem, como o webhook grava (messageBody). */
  corpo: (m: MensagemDoCelular) => string
  /** O bloco de midia (foto, documento, audio...), ou null. */
  midia: (m: MensagemDoCelular) => Midia | null
  /** Traz o arquivo da Meta para o acervo (guardarAnexo do webhook). */
  guardarAnexo: (clinicId: string, idDaMensagem: string, midia: Midia) => Promise<{ path: string; mime: string } | null>
}

/** Os avisos da coexistencia. "messages" e "statuses" seguem no webhook. */
export const CAMPOS_DO_CELULAR = ['history', 'smb_message_echoes', 'smb_app_state_sync']

export function campoDoCelular(campo: unknown): boolean {
  return CAMPOS_DO_CELULAR.includes(String(campo))
}

/**
 * O que a tela mostra no lugar da foto ou do audio que ficou so no celular:
 * a Meta so entrega o arquivo do que foi enviado nas duas ultimas semanas.
 */
export const TEXTO_ARQUIVO_DO_HISTORICO = '[Arquivo de antes da Central: está só no celular do consultório]'

/**
 * Mensagem que so o celular mostra (erro 131060 da Meta).
 *
 * Com o numero em coexistencia, a Meta avisa assim quando a pessoa escreve
 * pela primeira vez (a mensagem de verdade chega segundos depois, pelo caminho
 * de sempre) ou usa um aparelho que a API nao le (e ai a mensagem esta no app
 * do celular). Nos dois casos o robo nao deve responder: hoje o "[unsupported]"
 * pede "Pode escrever em texto?", e a pessoa receberia isso por cima da propria
 * mensagem.
 */
export function soNoCelular(m: { type?: string; errors?: { code?: number }[] } | null | undefined): boolean {
  return m?.type === 'unsupported' && (m.errors ?? []).some((e) => Number(e?.code) === 131060)
}

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '')

/** Segundos Unix da Meta para ISO. Sem data valida, a mensagem nao entra. */
function quando(timestamp: unknown): string | null {
  const segundos = Number(timestamp)
  if (!Number.isFinite(segundos) || segundos <= 0) return null
  return new Date(segundos * 1000).toISOString()
}

type Situacao = 'queued' | 'sent' | 'delivered' | 'read' | 'failed'

/** O status do historico (history_context.status) no status do banco. */
export function statusDoHistorico(status: unknown): Situacao {
  switch (String(status ?? '').toUpperCase()) {
    case 'READ':
    case 'PLAYED':
      return 'read'
    case 'DELIVERED':
      return 'delivered'
    case 'PENDING':
      return 'queued'
    case 'ERROR':
      return 'failed'
    default:
      return 'sent'
  }
}

/** Uma linha de whatsapp_messages, ainda sem clinica nem conversa. */
export type MensagemParaGravar = {
  external_message_id: string
  direction: 'inbound' | 'outbound'
  message_type: string
  body: string
  status: Situacao
  created_at: string
  sent_at?: string
  delivered_at?: string
  read_at?: string
  failed_at?: string
  automatic: false
  /** De onde veio (coluna whatsapp_messages.origem). */
  origem: 'historico' | 'celular'
  /** O arquivo a baixar, quando a Meta mandou o id dele. Nao vai ao banco. */
  midia: Midia | null
}

/**
 * Datas de envio, entrega e leitura de uma mensagem nossa: o historico so
 * traz o momento do envio e a situacao final, entao as tres ficam nele.
 */
function datasDoEnvio(situacao: Situacao, em: string) {
  const datas: Pick<MensagemParaGravar, 'sent_at' | 'delivered_at' | 'read_at' | 'failed_at'> = {}
  if (situacao === 'failed') datas.failed_at = em
  else if (situacao !== 'queued') datas.sent_at = em
  if (situacao === 'delivered' || situacao === 'read') datas.delivered_at = em
  if (situacao === 'read') datas.read_at = em
  return datas
}

/** O pedaco comum a historico, eco e arquivo do historico. */
function paraGravar(
  m: MensagemDoCelular,
  entrada: boolean,
  origem: MensagemParaGravar['origem'],
  situacao: Situacao,
  f: Ferramentas,
): MensagemParaGravar | null {
  const id = String(m?.id ?? '').trim()
  const em = quando(m?.timestamp)
  if (!id || !em) return null
  const reservado = m.type === 'media_placeholder'
  const midia = reservado ? null : f.midia(m)
  const texto = reservado ? TEXTO_ARQUIVO_DO_HISTORICO : f.corpo(m)
  return {
    external_message_id: id,
    direction: entrada ? 'inbound' : 'outbound',
    message_type: String(m.type || 'text'),
    body: texto,
    // Recebida do paciente fica "entregue", como a que chega ao vivo.
    status: entrada ? 'delivered' : situacao,
    created_at: em,
    ...(entrada ? { delivered_at: em } : datasDoEnvio(situacao, em)),
    automatic: false,
    origem,
    midia: midia?.id ? midia : null,
  }
}

/**
 * Do paciente ou da clinica? No historico, `from` e o numero de um ou de
 * outro; e do paciente quando bate com o numero da conversa (com e sem o nono
 * digito, ver telefone-br.ts).
 */
function doContato(de: unknown, contato: string): boolean {
  const numero = soDigitos(de)
  return Boolean(numero) && variantesDoTelefone(contato).includes(numero)
}

export type LeituraDoHistorico = {
  conversas: { contato: string; mensagens: MensagemParaGravar[] }[]
  /** A clinica escolheu nao compartilhar o historico (erro 2593109). */
  recusado: boolean
  partes: { fase: number | null; parte: number | null; progresso: number | null }[]
}

/** O aviso "history" com as conversas (ou com a recusa). */
export function lerHistorico(value: unknown, f: Ferramentas): LeituraDoHistorico {
  const v = (value ?? {}) as { history?: unknown[] }
  const leitura: LeituraDoHistorico = { conversas: [], recusado: false, partes: [] }
  const numero = (x: unknown) => (Number.isFinite(Number(x)) && x !== null && x !== undefined ? Number(x) : null)
  for (const bloco of (v.history ?? []) as Record<string, unknown>[]) {
    const erros = (bloco?.errors ?? []) as { code?: number }[]
    if (erros.some((e) => Number(e?.code) === 2593109)) leitura.recusado = true
    const meta = (bloco?.metadata ?? {}) as Record<string, unknown>
    if (bloco?.metadata) {
      leitura.partes.push({ fase: numero(meta.phase), parte: numero(meta.chunk_order), progresso: numero(meta.progress) })
    }
    for (const fio of (bloco?.threads ?? []) as { id?: string; messages?: MensagemDoCelular[] }[]) {
      const contato = soDigitos(fio?.id)
      if (!contato) continue
      const mensagens = (fio.messages ?? [])
        .map((m) =>
          paraGravar(m, doContato(m?.from, contato), 'historico', statusDoHistorico(m?.history_context?.status), f),
        )
        .filter((m): m is MensagemParaGravar => m !== null)
      if (mensagens.length) leitura.conversas.push({ contato, mensagens })
    }
  }
  return leitura
}

/**
 * O arquivo de uma mensagem do historico (o segundo "history", com
 * `messages`). `from` e o paciente ou a clinica; quando e a clinica, o
 * paciente esta em `to` (se a Meta mandar).
 */
export function lerArquivosDoHistorico(
  value: unknown,
  f: Ferramentas,
): { contato: string; mensagem: MensagemParaGravar }[] {
  const v = (value ?? {}) as { messages?: MensagemDoCelular[]; metadata?: { display_phone_number?: string } }
  const daClinica = soDigitos(v.metadata?.display_phone_number)
  const lidos: { contato: string; mensagem: MensagemParaGravar }[] = []
  for (const m of v.messages ?? []) {
    const de = soDigitos(m?.from)
    const entrada = Boolean(de) && de !== daClinica
    const contato = entrada ? de : soDigitos(m?.to)
    if (!contato) continue
    const mensagem = paraGravar(m, entrada, 'historico', 'sent', f)
    if (mensagem) lidos.push({ contato, mensagem })
  }
  return lidos
}

/** O aviso "smb_message_echoes": a equipe escreveu pelo app do celular. */
export function lerEcos(value: unknown, f: Ferramentas): { contato: string; mensagem: MensagemParaGravar }[] {
  const v = (value ?? {}) as { message_echoes?: MensagemDoCelular[] }
  const lidos: { contato: string; mensagem: MensagemParaGravar }[] = []
  for (const m of v.message_echoes ?? []) {
    const contato = soDigitos(m?.to)
    if (!contato) continue
    const mensagem = paraGravar(m, false, 'celular', 'sent', f)
    if (mensagem) lidos.push({ contato, mensagem })
  }
  return lidos
}

export type ContatoDoCelular = { contato: string; nome: string | null; removido: boolean; em: string | null }

/** O aviso "smb_app_state_sync": contato salvo, mudado ou apagado na agenda. */
export function lerContatos(value: unknown): ContatoDoCelular[] {
  const v = (value ?? {}) as { state_sync?: Record<string, unknown>[] }
  const lidos: ContatoDoCelular[] = []
  for (const item of v.state_sync ?? []) {
    if (item?.type !== 'contact') continue
    const c = (item.contact ?? {}) as { full_name?: string; first_name?: string; phone_number?: string }
    const contato = soDigitos(c.phone_number)
    if (!contato) continue
    const removido = item.action === 'remove'
    const nome = removido ? null : String(c.full_name || c.first_name || '').trim().slice(0, 120) || null
    lidos.push({ contato, nome, removido, em: quando((item.metadata as { timestamp?: string } | undefined)?.timestamp) })
  }
  return lidos
}

// ---------------------------------------------------------------------------
// Gravacao
// ---------------------------------------------------------------------------

type Conversa = {
  id: string
  wa_id: string
  patient_id: string | null
  last_message_at: string | null
  status?: string | null
}

/** Pedacos de lista: centenas de valores num .in() estouram a URL do PostgREST. */
function emLotes<T>(lista: T[], tamanho: number): T[][] {
  const lotes: T[][] = []
  for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho))
  return lotes
}

async function clinicaDoNumero(admin: Admin, phoneNumberId: string): Promise<string | null> {
  if (!phoneNumberId) return null
  const { data, error } = await admin
    .from('clinic_settings')
    .select('clinic_id')
    .eq('whatsapp_phone_number_id', phoneNumberId)
    .maybeSingle()
  if (error) throw error
  return (data?.clinic_id as string | undefined) ?? null
}

/** Os nomes da agenda do celular (tabela nova: sem ela, fica sem nome). */
async function nomesDaAgenda(admin: Admin, clinicId: string, variantes: string[]): Promise<Map<string, string>> {
  const nomes = new Map<string, string>()
  try {
    for (const lote of emLotes(variantes, 100)) {
      const { data, error } = await admin
        .from('whatsapp_contatos_do_celular')
        .select('wa_id,nome')
        .eq('clinic_id', clinicId)
        .in('wa_id', lote)
        .is('removido_em', null)
      if (error) throw error
      for (const l of (data ?? []) as { wa_id: string; nome: string | null }[]) if (l.nome) nomes.set(l.wa_id, l.nome)
    }
  } catch (erro) {
    console.warn('Coexistencia: sem a agenda do celular; conversas novas ficam sem o nome dela', erro)
  }
  return nomes
}

/**
 * A conversa de cada contato, criada quando nao existe.
 *
 * Procura por todas as grafias do numero (com e sem o nono digito), como o
 * webhook. Conversa nova liga ao paciente do mesmo telefone; sem paciente,
 * leva o nome que a equipe deu ao contato na agenda do celular.
 */
async function conversasDosContatos(admin: Admin, clinicId: string, contatos: string[]): Promise<Map<string, Conversa>> {
  const unicos = [...new Set(contatos)]
  const variantesDe = new Map(unicos.map((c) => [c, variantesDoTelefone(c)]))
  const todas = [...new Set([...variantesDe.values()].flat())]

  const existentes: Conversa[] = []
  for (const lote of emLotes(todas, 100)) {
    const { data, error } = await admin
      .from('whatsapp_conversations')
      .select('id,wa_id,patient_id,last_message_at,status')
      .eq('clinic_id', clinicId)
      .in('wa_id', lote)
    if (error) throw error
    existentes.push(...((data ?? []) as Conversa[]))
  }

  const porContato = new Map<string, Conversa>()
  const faltam: string[] = []
  for (const contato of unicos) {
    const exata = existentes.find((c) => c.wa_id === contato)
    const outra = existentes
      .filter((c) => variantesDe.get(contato)!.includes(c.wa_id))
      .sort((a, b) => String(b.last_message_at ?? '').localeCompare(String(a.last_message_at ?? '')))[0]
    const achada = exata ?? outra
    if (achada) porContato.set(contato, achada)
    else faltam.push(contato)
  }
  if (!faltam.length) return porContato

  const variantesQueFaltam = [...new Set(faltam.flatMap((c) => variantesDe.get(c)!))]
  const pacientes: { id: string; phone_digits: string }[] = []
  for (const lote of emLotes(variantesQueFaltam, 100)) {
    const { data, error } = await admin
      .from('patients')
      .select('id,phone_digits,name')
      .eq('clinic_id', clinicId)
      .is('archived_at', null)
      .in('phone_digits', lote)
      .order('name')
    if (error) throw error
    pacientes.push(...((data ?? []) as { id: string; phone_digits: string }[]))
  }
  const agenda = await nomesDaAgenda(admin, clinicId, variantesQueFaltam)

  for (const contato of faltam) {
    const grafias = variantesDe.get(contato)!
    const paciente = pacientes.find((p) => grafias.includes(p.phone_digits))
    const nome = paciente ? null : grafias.map((g) => agenda.get(g)).find(Boolean) ?? null
    const { data, error } = await admin
      .from('whatsapp_conversations')
      .insert({
        clinic_id: clinicId,
        wa_id: contato,
        display_phone: contato,
        ...(paciente ? { patient_id: paciente.id } : {}),
        ...(nome ? { nome_personalizado: nome } : {}),
      })
      .select('id,wa_id,patient_id,last_message_at,status')
      .single()
    if (error?.code === '23505') {
      // Criada agora mesmo por outra mensagem: usa a que ganhou.
      const { data: ganhou, error: erroDeNovo } = await admin
        .from('whatsapp_conversations')
        .select('id,wa_id,patient_id,last_message_at,status')
        .eq('clinic_id', clinicId)
        .eq('wa_id', contato)
        .single()
      if (erroDeNovo) throw erroDeNovo
      porContato.set(contato, ganhou as Conversa)
      continue
    }
    if (error) throw error
    porContato.set(contato, data as Conversa)
  }
  return porContato
}

/** Coluna nova que o banco ainda nao tem: 42703 do Postgres, PGRST204 do PostgREST. */
function semAColuna(erro: { code?: string; message?: string } | null | undefined, coluna: string): boolean {
  if (!erro) return false
  return erro.code === '42703' || erro.code === 'PGRST204' || String(erro.message ?? '').includes(coluna)
}

/**
 * Grava as mensagens que ainda nao estao no banco, com o arquivo quando a
 * Meta mandou o id dele. Devolve quantas entraram.
 *
 * A Meta repete aviso que nao recebeu resposta a tempo, e o historico chega
 * em pedacos fora de ordem: o id da mensagem (external_message_id, unico) e o
 * que impede a mesma mensagem de entrar duas vezes.
 */
async function gravarMensagens(
  admin: Admin,
  clinicId: string,
  conversa: Conversa,
  mensagens: MensagemParaGravar[],
  f: Ferramentas,
  coluna: { origem: boolean },
): Promise<number> {
  const unicas = [...new Map(mensagens.map((m) => [m.external_message_id, m])).values()]
  const jaGravadas = new Set<string>()
  for (const lote of emLotes(unicas.map((m) => m.external_message_id), 100)) {
    const { data, error } = await admin
      .from('whatsapp_messages')
      .select('external_message_id')
      .in('external_message_id', lote)
    if (error) throw error
    for (const l of (data ?? []) as { external_message_id: string }[]) jaGravadas.add(l.external_message_id)
  }
  const novas = unicas.filter((m) => !jaGravadas.has(m.external_message_id))

  const linhas: Record<string, unknown>[] = []
  for (const m of novas) {
    const { midia, origem, ...resto } = m
    const anexo = midia ? await f.guardarAnexo(clinicId, m.external_message_id, midia) : null
    linhas.push({
      ...resto,
      clinic_id: clinicId,
      conversation_id: conversa.id,
      patient_id: conversa.patient_id,
      ...(coluna.origem ? { origem } : {}),
      ...(anexo ? { media_path: anexo.path, media_mime: anexo.mime } : {}),
    })
  }

  let gravadas = 0
  for (const lote of emLotes(linhas, 200)) {
    let { error } = await admin.from('whatsapp_messages').insert(lote)
    if (error && coluna.origem && semAColuna(error, 'origem')) {
      // Banco sem a migration da coexistencia: grava sem dizer de onde veio.
      console.warn('Coexistencia: whatsapp_messages.origem ainda nao existe; gravando sem ela')
      coluna.origem = false
      lote.forEach((l) => delete l.origem)
      ;({ error } = await admin.from('whatsapp_messages').insert(lote))
    }
    if (error?.code === '23505') {
      // Outra entrega do mesmo aviso gravou parte do lote: uma a uma.
      for (const linha of lote) {
        const { error: erroDaLinha } = await admin.from('whatsapp_messages').insert(linha)
        if (!erroDaLinha) gravadas++
        else if (erroDaLinha.code !== '23505') throw erroDaLinha
      }
      continue
    }
    if (error) throw error
    gravadas += lote.length
  }
  return gravadas
}

/** A conversa sobe na lista so se a mensagem e mais nova que a ultima dela. */
function maisRecente(conversa: Conversa, mensagens: MensagemParaGravar[]): string | null {
  const ultima = mensagens.map((m) => m.created_at).sort().at(-1) ?? null
  if (!ultima) return null
  return !conversa.last_message_at || ultima > conversa.last_message_at ? ultima : null
}

/** Junta as mensagens por contato, na ordem em que chegaram. */
function porContato(lidos: { contato: string; mensagem: MensagemParaGravar }[]) {
  const grupos = new Map<string, MensagemParaGravar[]>()
  for (const { contato, mensagem } of lidos) {
    const lista = grupos.get(contato)
    if (lista) lista.push(mensagem)
    else grupos.set(contato, [mensagem])
  }
  return [...grupos.entries()].map(([contato, mensagens]) => ({ contato, mensagens }))
}

/**
 * O arquivo que chegou para uma mensagem do historico ja gravada (com o texto
 * de "arquivo de antes da Central"): troca pelo arquivo e pela legenda.
 * Devolve as que nao estavam gravadas, para entrarem como mensagem nova.
 */
async function completarArquivos(
  admin: Admin,
  clinicId: string,
  lidos: { contato: string; mensagem: MensagemParaGravar }[],
  f: Ferramentas,
): Promise<{ completados: number; faltam: typeof lidos }> {
  let completados = 0
  const faltam: typeof lidos = []
  for (const item of lidos) {
    const m = item.mensagem
    const { data: gravada, error } = await admin
      .from('whatsapp_messages')
      .select('id,message_type,media_path')
      .eq('clinic_id', clinicId)
      .eq('external_message_id', m.external_message_id)
      .maybeSingle()
    if (error) throw error
    if (!gravada) {
      faltam.push(item)
      continue
    }
    if (gravada.media_path) continue
    const anexo = m.midia ? await f.guardarAnexo(clinicId, m.external_message_id, m.midia) : null
    const legenda = m.body && !/^\[/.test(m.body) ? m.body : null
    const { error: erroDaTroca } = await admin
      .from('whatsapp_messages')
      .update({
        message_type: m.message_type,
        // Sem o arquivo (download falhou), fica o aviso de que esta no celular.
        body: anexo ? m.body : legenda ?? TEXTO_ARQUIVO_DO_HISTORICO,
        ...(anexo ? { media_path: anexo.path, media_mime: anexo.mime } : {}),
      })
      .eq('id', gravada.id)
    if (erroDaTroca) throw erroDaTroca
    completados++
  }
  return { completados, faltam }
}

/** Contato salvo, mudado ou apagado na agenda do celular. */
async function gravarContatos(admin: Admin, clinicId: string, contatos: ContatoDoCelular[]): Promise<number> {
  let gravados = 0
  for (const c of contatos) {
    const { data: antes, error: erroDeLeitura } = await admin
      .from('whatsapp_contatos_do_celular')
      .select('nome')
      .eq('clinic_id', clinicId)
      .eq('wa_id', c.contato)
      .maybeSingle()
    if (erroDeLeitura) throw erroDeLeitura
    const linha = {
      nome: c.nome,
      removido_em: c.removido ? c.em ?? new Date().toISOString() : null,
      atualizado_em: c.em ?? new Date().toISOString(),
    }
    const { error } = antes
      ? await admin.from('whatsapp_contatos_do_celular').update(linha).eq('clinic_id', clinicId).eq('wa_id', c.contato)
      : await admin.from('whatsapp_contatos_do_celular').insert({ clinic_id: clinicId, wa_id: c.contato, ...linha })
    if (error) throw error
    gravados++

    // O nome tambem vai para a conversa que ja existe, se ela nao tem cadastro
    // e ninguem a renomeou (ou o nome era o da agenda, que mudou agora). O
    // nome que a equipe deu na Central ganha sempre; o do cadastro tambem.
    if (!c.nome) continue
    const nomeAntigo = (antes?.nome as string | null | undefined) ?? null
    const { data: conversas, error: erroDaConversa } = await admin
      .from('whatsapp_conversations')
      .select('id,patient_id,nome_personalizado')
      .eq('clinic_id', clinicId)
      .in('wa_id', variantesDoTelefone(c.contato))
    if (erroDaConversa) throw erroDaConversa
    for (const conversa of (conversas ?? []) as { id: string; patient_id: string | null; nome_personalizado: string | null }[]) {
      if (conversa.patient_id) continue
      if (conversa.nome_personalizado && conversa.nome_personalizado !== nomeAntigo) continue
      if (conversa.nome_personalizado === c.nome) continue
      const { error: erroDoNome } = await admin
        .from('whatsapp_conversations')
        .update({ nome_personalizado: c.nome })
        .eq('id', conversa.id)
      if (erroDoNome) throw erroDoNome
    }
  }
  return gravados
}

export type ResultadoDoCelular = {
  clinica: string | null
  campo: string
  /** Mensagens que entraram no banco. */
  gravadas: number
  conversas: number
  contatos: number
  /** Arquivos do historico que chegaram para mensagens ja gravadas. */
  arquivos: number
  recusado: boolean
}

/**
 * Trata um aviso da coexistencia (history, smb_message_echoes ou
 * smb_app_state_sync). Erro de banco sobe: o webhook responde com erro, e a
 * Meta manda o aviso de novo (o id de cada mensagem evita duplicar). A falta
 * da tabela da agenda, nova, nao derruba o resto.
 */
export async function tratarAvisoDoCelular(
  admin: Admin,
  campo: string,
  value: unknown,
  f: Ferramentas,
): Promise<ResultadoDoCelular> {
  const v = (value ?? {}) as { metadata?: { phone_number_id?: string } }
  const resultado: ResultadoDoCelular = {
    clinica: null,
    campo,
    gravadas: 0,
    conversas: 0,
    contatos: 0,
    arquivos: 0,
    recusado: false,
  }
  const clinicId = await clinicaDoNumero(admin, String(v.metadata?.phone_number_id ?? ''))
  if (!clinicId) return resultado
  resultado.clinica = clinicId
  const coluna = { origem: true }

  if (campo === 'smb_app_state_sync') {
    try {
      resultado.contatos = await gravarContatos(admin, clinicId, lerContatos(value))
    } catch (erro) {
      if (!semAColuna(erro as { code?: string; message?: string }, 'whatsapp_contatos_do_celular')) throw erro
      console.error('Coexistencia: a tabela da agenda do celular nao existe; contatos perdidos', erro)
    }
    return resultado
  }

  let grupos: { contato: string; mensagens: MensagemParaGravar[] }[] = []
  if (campo === 'history') {
    const historico = lerHistorico(value, f)
    resultado.recusado = historico.recusado
    if (historico.recusado) {
      console.warn('Coexistencia: o consultorio nao compartilhou o historico do celular (2593109)')
    }
    const { completados, faltam } = await completarArquivos(admin, clinicId, lerArquivosDoHistorico(value, f), f)
    resultado.arquivos = completados
    grupos = [...historico.conversas, ...porContato(faltam)]
  } else if (campo === 'smb_message_echoes') {
    grupos = porContato(lerEcos(value, f))
  } else {
    return resultado
  }
  if (!grupos.length) return resultado

  const conversas = await conversasDosContatos(admin, clinicId, grupos.map((g) => g.contato))
  for (const { contato, mensagens } of grupos) {
    const conversa = conversas.get(contato)
    if (!conversa) continue
    const entraram = await gravarMensagens(admin, clinicId, conversa, mensagens, f, coluna)
    resultado.gravadas += entraram
    resultado.conversas++

    const ultima = maisRecente(conversa, mensagens)
    if (campo === 'smb_message_echoes' && entraram > 0) {
      // A equipe respondeu pelo celular: a conversa fica como quando ela
      // responde pela Central (whatsapp-reply), sem pedido de atencao e sem
      // "novas". E a mensagem dela, com automatic = false, segura o robo.
      const { error } = await admin
        .from('whatsapp_conversations')
        .update({
          needs_attention: false,
          attention_reason: null,
          unread_count: 0,
          ...(ultima ? { last_message_at: ultima } : {}),
          ...(conversa.status === 'resolved' ? { status: 'open' } : {}),
        })
        .eq('id', conversa.id)
      if (error) throw error
    } else if (ultima && entraram > 0) {
      const { error } = await admin.from('whatsapp_conversations').update({ last_message_at: ultima }).eq('id', conversa.id)
      if (error) throw error
    }
  }
  return resultado
}
