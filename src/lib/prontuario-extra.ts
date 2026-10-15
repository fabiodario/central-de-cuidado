import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/**
 * Rascunho, adendo, exames e horarios de retorno do prontuario (25/09/2026).
 *
 * Tabelas e funcao novas, que os tipos gerados ainda nao conhecem: por isso o
 * cliente sem tipo aqui, isolado neste arquivo, em vez de espalhar cast pelo
 * repository. Quando os tipos forem regerados, isto pode voltar a usar o
 * cliente tipado.
 *
 * Tudo aqui e complemento do prontuario. Se a migration ainda nao rodou, as
 * leituras devolvem vazio e a tela diz que o recurso esta indisponivel - o
 * atendimento em si nunca deixa de abrir por causa delas.
 */
const db = supabase as unknown as SupabaseClient

function mensagem(erro: unknown, padrao: string) {
  const texto = (erro as { message?: string } | null)?.message
  return texto ? `${padrao} (${texto})` : padrao
}

async function usuarioAtual(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new Error('Sessão expirada. Entre de novo para continuar.')
  return id
}

// ---------------------------------------------------------------- rascunho

export type Rascunho = { conteudo: Record<string, unknown>; atualizadoEm: string }

/** "nova" para consulta ainda nao salva; o id, para a que esta em edicao. */
export function alvoDoRascunho(consultaId: string | null) {
  return consultaId ?? 'nova'
}

export async function lerRascunho(patientId: string, alvo: string): Promise<Rascunho | null> {
  const usuario = await usuarioAtual()
  const { data, error } = await db
    .from('consultation_drafts')
    .select('conteudo,updated_at')
    .eq('user_id', usuario)
    .eq('patient_id', patientId)
    .eq('alvo', alvo)
    .maybeSingle()
  if (error) throw new Error(mensagem(error, 'Não consegui ler o rascunho'))
  if (!data) return null
  return { conteudo: (data.conteudo ?? {}) as Record<string, unknown>, atualizadoEm: data.updated_at as string }
}

/** Grava (ou regrava) o rascunho e devolve a hora gravada. Lanca se falhar. */
export async function salvarRascunho(
  clinicId: string,
  patientId: string,
  alvo: string,
  conteudo: Record<string, unknown>,
): Promise<string> {
  const usuario = await usuarioAtual()
  const agora = new Date().toISOString()
  const { error } = await db.from('consultation_drafts').upsert(
    {
      clinic_id: clinicId,
      patient_id: patientId,
      user_id: usuario,
      alvo,
      conteudo,
      updated_at: agora,
    },
    { onConflict: 'user_id,patient_id,alvo' },
  )
  if (error) throw new Error(mensagem(error, 'Não consegui salvar o rascunho'))
  return agora
}

export async function apagarRascunho(patientId: string, alvo: string) {
  const usuario = await usuarioAtual()
  const { error } = await db
    .from('consultation_drafts')
    .delete()
    .eq('user_id', usuario)
    .eq('patient_id', patientId)
    .eq('alvo', alvo)
  if (error) throw new Error(mensagem(error, 'Não consegui descartar o rascunho'))
}

// ---------------------------------------------------------------- adendos

export type Adendo = {
  id: string
  consultationId: string
  texto: string
  autorNome: string
  criadoEm: string
}

export async function listarAdendos(clinicId: string, patientId: string): Promise<Adendo[]> {
  const { data, error } = await db
    .from('consultation_addenda')
    .select('id,consultation_id,texto,autor_nome,criado_em')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .order('criado_em', { ascending: true })
  if (error) throw new Error(mensagem(error, 'Não consegui carregar os adendos'))
  return (data ?? []).map((linha) => ({
    id: linha.id as string,
    consultationId: linha.consultation_id as string,
    texto: linha.texto as string,
    autorNome: (linha.autor_nome as string) ?? '',
    criadoEm: linha.criado_em as string,
  }))
}

export async function registrarAdendo(clinicId: string, patientId: string, consultationId: string, texto: string) {
  const limpo = texto.trim()
  if (!limpo) throw new Error('Escreva o adendo antes de registrar.')
  const { error } = await db.from('consultation_addenda').insert({
    clinic_id: clinicId,
    patient_id: patientId,
    consultation_id: consultationId,
    texto: limpo,
  })
  if (error) throw new Error(mensagem(error, 'O adendo não foi registrado'))
}

// ---------------------------------------------------------------- exames

export type Exame = {
  id: string
  titulo: string
  dataExame: string | null
  caminho: string
  mime: string
  tamanho: number
  enviadoEm: string
}

export const TIPOS_DE_EXAME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
export const TAMANHO_MAXIMO_DO_EXAME = 20 * 1024 * 1024

export async function listarExames(clinicId: string, patientId: string): Promise<Exame[]> {
  const { data, error } = await db
    .from('patient_exams')
    .select('id,titulo,data_exame,caminho,mime,tamanho,enviado_em')
    .eq('clinic_id', clinicId)
    .eq('patient_id', patientId)
    .is('removido_em', null)
    .order('data_exame', { ascending: false, nullsFirst: false })
    .order('enviado_em', { ascending: false })
  if (error) throw new Error(mensagem(error, 'Não consegui carregar os exames'))
  return (data ?? []).map((linha) => ({
    id: linha.id as string,
    titulo: linha.titulo as string,
    dataExame: (linha.data_exame as string | null) ?? null,
    caminho: linha.caminho as string,
    mime: (linha.mime as string) ?? '',
    tamanho: Number(linha.tamanho ?? 0),
    enviadoEm: linha.enviado_em as string,
  }))
}

export function tipoPelaExtensao(nome: string): string {
  const extensao = nome.toLowerCase().split('.').pop() ?? ''
  const tipos: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
  }
  return tipos[extensao] ?? ''
}

/** Nome de arquivo seguro para o acervo: sem acento, espaco nem barra. */
export function nomeSeguro(nome: string) {
  const limpo = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return (limpo || 'exame').slice(-80)
}

/**
 * Sobe o arquivo e registra o exame. Se o registro falhar depois do upload, o
 * arquivo fica orfao no acervo - e melhor do que o contrario (registro sem
 * arquivo), e a mensagem de erro diz o que aconteceu.
 */
export async function anexarExame(
  clinicId: string,
  patientId: string,
  arquivo: File,
  titulo: string,
  dataExame: string | null,
) {
  // O Windows nem sempre informa o tipo de .heic (foto de iPhone): sem tipo,
  // vale a extensao.
  const tipo = arquivo.type || tipoPelaExtensao(arquivo.name)
  if (!TIPOS_DE_EXAME.includes(tipo)) {
    throw new Error('Formato não aceito. Anexe PDF ou foto (JPG, PNG, WEBP, HEIC).')
  }
  if (arquivo.size > TAMANHO_MAXIMO_DO_EXAME) {
    throw new Error('Arquivo maior que 20 MB. Reduza a foto ou divida o PDF.')
  }
  const caminho = `${clinicId}/${patientId}/${crypto.randomUUID()}-${nomeSeguro(arquivo.name)}`
  const envio = await supabase.storage.from('exames').upload(caminho, arquivo, {
    contentType: tipo,
    upsert: false,
  })
  if (envio.error) throw new Error(mensagem(envio.error, 'O arquivo não subiu'))

  const { error } = await db.from('patient_exams').insert({
    clinic_id: clinicId,
    patient_id: patientId,
    titulo: titulo.trim() || arquivo.name,
    data_exame: dataExame || null,
    caminho,
    mime: tipo,
    tamanho: arquivo.size,
  })
  if (error) throw new Error(mensagem(error, 'O arquivo subiu, mas o exame não foi registrado'))
}

/** Link temporario (5 minutos) para abrir o exame. */
export async function linkDoExame(caminho: string): Promise<string> {
  const { data, error } = await supabase.storage.from('exames').createSignedUrl(caminho, 300)
  if (error || !data?.signedUrl) throw new Error(mensagem(error, 'Não consegui abrir o exame'))
  return data.signedUrl
}

/** Esconde o exame da lista. O arquivo continua no acervo (ver a migration). */
export async function removerExame(exameId: string) {
  const { error } = await db
    .from('patient_exams')
    .update({ removido_em: new Date().toISOString() })
    .eq('id', exameId)
  if (error) throw new Error(mensagem(error, 'Não consegui remover o exame'))
}

// ---------------------------------------------------------------- retorno

/** Horarios livres da unidade entre duas datas (YYYY-MM-DD), sem o limite do robo. */
export async function horariosLivresEntre(unitId: string, de: string, ate: string): Promise<string[]> {
  const { data, error } = await db.rpc('horarios_livres_entre', { p_unit_id: unitId, p_de: de, p_ate: ate })
  if (error) throw new Error(mensagem(error, 'Não consegui buscar os horários'))
  return ((data ?? []) as { slot_start: string }[]).map((linha) => linha.slot_start)
}
