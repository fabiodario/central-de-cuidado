import { adminClient, corsHeaders, json, userClient } from '../_shared/whatsapp.ts'
import { clinicaDeQuemAtende } from '../_shared/papel.ts'

/**
 * Guarda no prontuario a receita que a Memed acabou de emitir.
 *
 * A tela escuta o evento prescricaoImpressa e manda o que a Memed devolveu.
 * Aqui esse pacote e reduzido ao que o medico vai precisar reler daqui a dois
 * anos: o que foi prescrito, em que dose, e o link para o documento.
 *
 * Por que nao guardar o payload inteiro: ele traz preco, fabricante, codigos
 * internos e dados do proprio prescritor - centenas de campos que envelhecem e
 * nao dizem nada sobre o atendimento. Prontuario nao e deposito de resposta de
 * API.
 *
 * Por que nao guardar so o link: se a integracao acabar, ou a Memed mudar de
 * endereco, o atendimento ficaria sem o que foi prescrito. O texto fica do
 * nosso lado; o link e conveniencia.
 */

type Item = {
  nome?: string
  titulo?: string
  sanitized_posology?: string
  posologia?: string
  quantidade?: number | null
  unit?: string | null
  tipo?: string
  receituario?: string
}

type Pedido = {
  consultationId?: string
  patientId?: string
  prescricao?: {
    id?: number | string
    prescriptionUuid?: string
    medicamentos?: Item[]
    link?: string
  }
  /** Chega no evento prescricaoExcluida. */
  excluir?: string
}

function limparHtml(valor: string) {
  return valor
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Reduz cada item ao que se le num prontuario. */
function resumirItens(itens: Item[]) {
  return itens.slice(0, 60).map((item) => ({
    nome: (item.nome || item.titulo || '').slice(0, 300),
    posologia: limparHtml(item.sanitized_posology || item.posologia || '').slice(0, 600),
    quantidade: item.quantidade ?? null,
    unidade: item.unit ?? null,
    tipo: item.tipo ?? null,
    receituario: item.receituario ?? null,
  }))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  const autorizacao = req.headers.get('Authorization') ?? ''
  if (!autorizacao.startsWith('Bearer ')) return json({ error: 'Sessão obrigatória.' }, 401)

  try {
    const corpo = (await req.json()) as Pedido
    const escopo = userClient(autorizacao)
    const admin = adminClient()

    // Receita excluida na Memed: marcar, nunca apagar. Um link morto no
    // prontuario sem explicacao parece defeito do sistema; marcado, a tela
    // sabe dizer que o proprio medico removeu.
    if (corpo.excluir) {
      if (!(await clinicaDeQuemAtende(escopo))) {
        return json({ error: 'Só o médico pode excluir receita.', code: 'SEM_PERMISSAO' }, 403)
      }
      const { data: existente } = await escopo
        .from('prescriptions')
        .select('id')
        .eq('memed_id', String(corpo.excluir))
        .maybeSingle()

      if (!existente) return json({ ok: true, ignorada: true })

      await admin
        .from('prescriptions')
        .update({ excluida_em: new Date().toISOString() })
        .eq('id', existente.id)

      return json({ ok: true })
    }

    const prescricao = corpo.prescricao
    if (!prescricao?.id) return json({ error: 'Receita não informada.' }, 400)
    if (!corpo.patientId) return json({ error: 'Paciente não informado.' }, 400)

    // A RLS confere o acesso: se o paciente nao aparece para este usuario, ele
    // nao pode pendurar receita no prontuario dele.
    const { data: paciente } = await escopo
      .from('patients')
      .select('id,clinic_id')
      .eq('id', corpo.patientId)
      .maybeSingle()

    if (!paciente) return json({ error: 'Paciente não encontrado.', code: 'NOT_VISIBLE' }, 403)

    // Receita so de quem prescreve, e so na consulta deste paciente
    // (24/09/2026). Antes qualquer membro gravava, e o consultationId vindo do
    // navegador entrava sem conferencia - dava para pendurar a receita no
    // atendimento de outra crianca.
    if (!(await clinicaDeQuemAtende(escopo, paciente.clinic_id))) {
      return json({ error: 'Só o médico pode registrar receita.', code: 'SEM_PERMISSAO' }, 403)
    }
    if (corpo.consultationId) {
      const { data: daConsulta } = await admin
        .from('consultations')
        .select('id')
        .eq('id', corpo.consultationId)
        .eq('patient_id', paciente.id)
        .eq('clinic_id', paciente.clinic_id)
        .maybeSingle()
      if (!daConsulta) {
        return json({ error: 'Esta consulta não é deste paciente.', code: 'CONSULTA_DE_OUTRO' }, 400)
      }
    }

    const { data: usuario } = await escopo.auth.getUser()

    const { error } = await admin.from('prescriptions').upsert(
      {
        clinic_id: paciente.clinic_id,
        patient_id: paciente.id,
        consultation_id: corpo.consultationId ?? null,
        memed_id: String(prescricao.id),
        memed_uuid: prescricao.prescriptionUuid ?? null,
        link: prescricao.link ?? null,
        itens: resumirItens(prescricao.medicamentos ?? []),
        created_by: usuario?.user?.id ?? null,
      },
      // A Memed reemite o evento quando o medico reimprime a mesma receita.
      // Sem isto, cada reimpressao viraria uma receita nova no prontuario.
      { onConflict: 'clinic_id,memed_id' },
    )

    if (error) {
      console.error('Falha ao guardar a receita', error)
      return json({ error: 'A receita foi emitida mas não pôde ser arquivada.' }, 500)
    }

    return json({ ok: true })
  } catch (causa) {
    console.error('memed-receita falhou', causa)
    return json({ error: causa instanceof Error ? causa.message : 'Falha inesperada.' }, 500)
  }
})
