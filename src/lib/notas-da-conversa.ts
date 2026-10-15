import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

/**
 * Notas internas da conversa (25/09/2026): recado da equipe para a equipe, que
 * a familia nunca ve. Ver a migration notas_internas_da_conversa.
 *
 * Cliente sem tipo porque a tabela e mais nova que os tipos gerados. Ler e
 * complemento: se falhar (migration ainda nao rodou), a conversa abre do mesmo
 * jeito e a tela diz que as notas estao indisponiveis.
 */
const db = supabase as unknown as SupabaseClient

export type NotaDaConversa = {
  id: string
  texto: string
  autorNome: string
  criadoEm: string
}

export async function listarNotas(conversationId: string): Promise<NotaDaConversa[]> {
  const { data, error } = await db
    .from('conversation_notes')
    .select('id,texto,autor_nome,criado_em')
    .eq('conversation_id', conversationId)
    .order('criado_em', { ascending: true })
  if (error) throw new Error(`Não consegui carregar as notas internas (${error.message})`)
  return (data ?? []).map((linha) => ({
    id: linha.id as string,
    texto: linha.texto as string,
    autorNome: (linha.autor_nome as string) ?? '',
    criadoEm: linha.criado_em as string,
  }))
}

export async function criarNota(clinicId: string, conversationId: string, texto: string) {
  const limpo = texto.trim()
  if (!limpo) throw new Error('Escreva a nota antes de salvar.')
  const { error } = await db.from('conversation_notes').insert({
    clinic_id: clinicId,
    conversation_id: conversationId,
    texto: limpo,
  })
  if (error) throw new Error(`A nota não foi salva (${error.message})`)
}
