/**
 * Quem pode fazer o que o medico faz: prescrever, transcrever consulta, ler
 * receita. Owner ou clinician, com vinculo ativo (24/09/2026).
 *
 * Ate aqui as funcoes da Memed e da transcricao so perguntavam "voce e membro
 * de alguma clinica?". Qualquer usuario logado - recepcao, "somente
 * visualizacao" - recebia o acesso de prescritor do Dr. Marcello na Memed e
 * podia emitir receita no nome dele.
 *
 * A pergunta vai com o cliente do USUARIO (RLS): cada um enxerga so o proprio
 * vinculo, entao nao ha como responder pelo outro.
 */

// So o pedaco do cliente do Supabase que esta funcao usa. Recebe unknown e
// converte aqui dentro: os tipos genericos do supabase-js nao casam com um tipo
// estrutural, e o que importa e o encadeamento abaixo.
type Busca = {
  eq: (coluna: string, valor: string) => Busca
  in: (coluna: string, valores: string[]) => Busca
  limit: (n: number) => {
    maybeSingle: () => PromiseLike<{ data: { clinic_id?: string } | null; error: unknown }>
  }
}
type ClienteDoUsuario = { from: (tabela: string) => { select: (colunas: string) => Busca } }

export const PAPEIS_DE_QUEM_ATENDE = ['owner', 'clinician']

/**
 * A clinica em que este usuario atende, ou null. Com clinicId, confere essa
 * clinica especifica.
 */
export async function clinicaDeQuemAtende(
  cliente: unknown,
  clinicId?: string,
): Promise<string | null> {
  const escopo = cliente as ClienteDoUsuario
  let busca = escopo
    .from('clinic_memberships')
    .select('clinic_id')
    .eq('status', 'active')
    .in('role', PAPEIS_DE_QUEM_ATENDE)
  if (clinicId) busca = busca.eq('clinic_id', clinicId)
  const { data, error } = await busca.limit(1).maybeSingle()
  if (error) {
    console.error('Nao consegui conferir o papel do usuario', error)
    return null
  }
  return data?.clinic_id ?? null
}
