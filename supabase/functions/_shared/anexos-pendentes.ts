import { cabecalhoDoAnexo, mensagemDoAnexo, nomeDoAnexo } from './anexo-para-equipe.ts'
import { variantesDoTelefone } from './telefone-br.ts'

/**
 * O arquivo do paciente que nao chegou ao celular da equipe (25/10/2026,
 * vindo do sistema do Dr. Marcello, do mesmo dia).
 *
 * No Dr. Marcello, num domingo: a mae mandou um audio, o alerta chegou aos
 * dois celulares e o audio nao. A Meta aceita o envio na hora e so depois
 * manda a recusa pelo aviso de status - 131047, "mais de 24 horas desde que
 * esse numero escreveu para a clinica". O sistema olhava so a primeira
 * resposta, contou como entregue e nao deixou nota nenhuma.
 *
 * Aqui cada envio fica registrado (tabela anexos_para_equipe) e:
 *  - a recusa vira nota na conversa, uma por arquivo, e o arquivo fica
 *    pendente;
 *  - o pendente vai sozinho quando aquele celular escrever para a clinica ou
 *    tocar num botao do alerta, que e o que abre a janela de 24 horas da Meta.
 *
 * Tudo em try/catch: a tabela pode nao existir ainda (a funcao sobe junto com
 * a migration), e perder o registro do arquivo nao pode custar o alerta.
 */

// O mesmo tipo solto do alerta-de-urgencia: o modulo e chamado de la e do
// webhook, e os testes passam um banco falso.
type Admin = {
  from: (tabela: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
  storage?: { from: (balde: string) => { createSignedUrl: (caminho: string, segundos: number) => Promise<{ data: { signedUrl?: string } | null; error: unknown }> } }
}

export type EnvioDeAnexo = {
  clinicId: string
  conversationId?: string
  numero: string
  tipo: string
  caminho: string
  nome?: string
  quem: string
  recebidoEm: string
  metaId: string | null
  ok: boolean
  erro?: string
}

/** Recusa por janela fechada: a unica que se resolve sozinha quando o celular escreve. */
export function recusaPelaJanela(erros: { code?: number | string }[] | null | undefined): boolean {
  return (erros ?? []).some((e) => String(e?.code ?? '') === '131047')
}

/** A nota da conversa quando o arquivo nao chegou: uma por arquivo, nao uma por celular. */
export function notaDaRecusa(tipo: string, pelaJanela: boolean, detalhe?: string): string {
  const nome = nomeDoAnexo(tipo)
  if (pelaJanela) {
    return `⚠️ ${nome} não chegou aos celulares: a Meta só deixa mandar arquivo para quem escreveu ao número da clínica nas últimas 24 horas. Vai sozinho assim que o celular escrever para a clínica ou tocar num botão do alerta. Está aqui na Central.`
  }
  return `⚠️ ${nome} não chegou aos celulares (${(detalhe || 'recusado pela Meta').slice(0, 120)}). Está aqui na Central.`
}

/** Grava o envio. Sem a tabela, so avisa no log: o alerta ja saiu. */
export async function registrarEnvioDoAnexo(admin: Admin, e: EnvioDeAnexo): Promise<void> {
  try {
    const { error } = await admin.from('anexos_para_equipe').insert({
      clinic_id: e.clinicId,
      conversation_id: e.conversationId ?? null,
      numero: e.numero,
      tipo: e.tipo,
      caminho: e.caminho,
      nome: e.nome ?? null,
      quem: e.quem,
      recebido_em: e.recebidoEm,
      meta_id: e.metaId,
      situacao: e.ok ? 'enviado' : 'pendente',
      erro: e.ok ? null : (e.erro ?? 'recusado pela Meta').slice(0, 300),
    })
    if (error) throw error
  } catch (erro) {
    console.warn('Anexo para a equipe: nao registrei o envio; uma recusa da Meta nao vai virar nota', erro)
  }
}

type Linha = {
  id: string
  clinic_id: string
  conversation_id: string | null
  tipo: string
  caminho: string
  situacao: string
}

/**
 * O aviso de status de um envio de arquivo para a equipe. Devolve true quando
 * o id era de um desses envios (o webhook para por aqui: eles nao estao em
 * whatsapp_messages), false quando nao era ou quando a tabela nao respondeu.
 */
export async function acompanharEnvioDoAnexo(
  admin: Admin,
  metaId: string,
  status: string,
  erros: { code?: number | string; title?: string; message?: string; error_data?: { details?: string } }[] | null | undefined,
  agora: Date,
): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from('anexos_para_equipe')
      .select('id,clinic_id,conversation_id,tipo,caminho,situacao')
      .eq('meta_id', metaId)
      .maybeSingle()
    if (error) throw error
    const linha = data as Linha | null
    if (!linha) return false
    const quando = agora.toISOString()

    if (status === 'delivered' || status === 'read') {
      await admin.from('anexos_para_equipe').update({ situacao: 'entregue', erro: null, atualizado_em: quando }).eq('id', linha.id)
      return true
    }
    if (status !== 'failed') return true

    const pelaJanela = recusaPelaJanela(erros)
    const detalhe = (erros ?? []).map((e) => e?.error_data?.details || e?.title || e?.message).filter(Boolean).join('; ')
    await admin
      .from('anexos_para_equipe')
      .update({ situacao: 'pendente', erro: (detalhe || 'recusado pela Meta').slice(0, 300), atualizado_em: quando })
      .eq('id', linha.id)
    console.warn('Anexo para a equipe recusado pela Meta depois de aceito', metaId, detalhe)

    // Uma nota por arquivo: o mesmo audio recusado nos dois celulares e uma
    // coisa so para quem le a conversa.
    if (linha.conversation_id) {
      const { data: avisados } = await admin
        .from('anexos_para_equipe')
        .select('id')
        .eq('caminho', linha.caminho)
        .not('nota_em', 'is', null)
        .limit(1)
      if (!avisados?.length) {
        await admin.from('anexos_para_equipe').update({ nota_em: quando }).eq('caminho', linha.caminho)
        const { error: erroDaNota } = await admin
          .from('conversation_notes')
          .insert({ clinic_id: linha.clinic_id, conversation_id: linha.conversation_id, texto: notaDaRecusa(linha.tipo, pelaJanela, detalhe) })
        if (erroDaNota) console.error('Anexo para a equipe: nota da recusa nao gravada', erroDaNota)
      }
    }
    return true
  } catch (erro) {
    console.warn('Anexo para a equipe: nao consegui conferir o aviso de status', metaId, erro)
    return false
  }
}

type Pendente = { id: string; tipo: string; caminho: string; nome: string | null; quem: string; recebido_em: string; tentativas: number }

/** Quantos dias um arquivo pendente ainda vale a pena mandar. */
const VALIDADE_DO_PENDENTE_MS = 7 * 24 * 3600 * 1000
/** Mais que isso numa vez so vira enxurrada no celular. */
const POR_VEZ = 10

/**
 * O celular da equipe escreveu para a clinica (ou tocou num botao): a janela
 * da Meta abriu, e os arquivos que ficaram para tras vao agora. Devolve
 * quantos foram.
 */
export async function entregarAnexosPendentes(
  admin: Admin,
  clinicId: string,
  numero: string,
  enviar: (para: string, conteudo: Record<string, unknown>) => Promise<{ ok: boolean; id?: string | null; erro?: string }>,
  agora: Date,
): Promise<number> {
  let foram = 0
  try {
    const { data, error } = await admin
      .from('anexos_para_equipe')
      .select('id,tipo,caminho,nome,quem,recebido_em,tentativas')
      .eq('clinic_id', clinicId)
      .eq('situacao', 'pendente')
      .in('numero', variantesDoTelefone(numero))
      .gte('recebido_em', new Date(agora.getTime() - VALIDADE_DO_PENDENTE_MS).toISOString())
      .order('recebido_em')
      .limit(POR_VEZ)
    if (error) throw error
    for (const p of (data ?? []) as Pendente[]) {
      if (!admin.storage) throw new Error('banco sem acervo de arquivos')
      const { data: assinado, error: erroDoLink } = await admin.storage.from('whatsapp-anexos').createSignedUrl(p.caminho, 24 * 3600)
      if (erroDoLink || !assinado?.signedUrl) {
        console.warn('Anexo pendente: nao gerei o link do arquivo', p.caminho, erroDoLink)
        continue
      }
      const corpo = mensagemDoAnexo({ tipo: p.tipo, link: assinado.signedUrl, nome: p.nome ?? undefined }, p.quem)
      if (!corpo) continue
      // O arquivo que ficou para tras chega depois do alerta: a linha antes diz
      // de quem e e de quando (o audio nem tem legenda).
      await enviar(numero, { type: 'text', text: { body: cabecalhoDoAnexo(p.tipo, p.quem, p.recebido_em) } })
      const r = await enviar(numero, corpo)
      await admin
        .from('anexos_para_equipe')
        .update({
          situacao: r.ok ? 'reenviado' : 'pendente',
          meta_id: r.ok ? (r.id ?? null) : null,
          erro: r.ok ? null : (r.erro ?? 'recusado pela Meta').slice(0, 300),
          tentativas: p.tentativas + 1,
          atualizado_em: agora.toISOString(),
        })
        .eq('id', p.id)
      if (r.ok) foram++
      else console.warn('Anexo pendente: a Meta recusou de novo', p.caminho, r.erro)
    }
  } catch (erro) {
    console.warn('Anexo pendente: nao consegui mandar os arquivos que ficaram para tras', erro)
  }
  return foram
}
