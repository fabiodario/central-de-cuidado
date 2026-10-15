import { variantesDoTelefone } from './telefone-br.ts'

/**
 * Numero de teste da Meta na clinica de teste (27/09/2026).
 *
 * A "Clinica de teste Memed" nao tinha WhatsApp, e o painel de saude dela
 * acusava lembrete atrasado para consultas ficticias que nenhum robo ia
 * mandar. A saida foi ligar nela o numero de teste gratuito da Meta, que so
 * entrega para ate 5 celulares cadastrados no painel da Meta.
 *
 * Duas pecas moram aqui, e ficam separadas das funcoes para poderem ser
 * testadas sem Deno e sem rede.
 */

type LerAmbiente = (nome: string) => string | undefined

const lerDoDeno: LerAmbiente = (nome) =>
  (globalThis as { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(nome)

/**
 * Chave de acesso da Meta para um numero.
 *
 * Ate aqui havia uma chave so (WHATSAPP_ACCESS_TOKEN) para todas as clinicas.
 * O numero de teste vive numa conta de teste da Meta, e a chave da clinica
 * real pode nao alcancar essa conta. Para isso existe o segredo
 * WHATSAPP_ACCESS_TOKEN_<phone_number_id>: se estiver definido, vale para
 * aquele numero; se nao, cai na chave geral - que e o caso da clinica real, e
 * por isso nada muda para ela.
 */
export function chaveDoWhatsApp(
  phoneNumberId: string | null | undefined,
  ler: LerAmbiente = lerDoDeno,
): string | undefined {
  const propria = phoneNumberId ? ler(`WHATSAPP_ACCESS_TOKEN_${String(phoneNumberId).trim()}`)?.trim() : undefined
  return propria || ler('WHATSAPP_ACCESS_TOKEN')?.trim() || undefined
}

/**
 * O telefone esta fora da lista de teste?
 *
 * lista nula = clinica de verdade, sem trava: devolve sempre false.
 * lista vazia = clinica em modo teste sem nenhum celular cadastrado ainda:
 * ninguem recebe. Sem esta trava, cada paciente ficticio viraria um "Meta
 * recusou" no painel e na conversa, todo dia - o numero de teste da Meta so
 * entrega para quem esta cadastrado la.
 *
 * Compara todas as grafias do numero (nono digito, 55 do pais), como o resto
 * do sistema.
 */
export function foraDaListaDeTeste(lista: readonly string[] | null | undefined, telefone: string): boolean {
  if (lista == null) return false
  const permitidos = new Set(lista.flatMap((numero) => variantesDoTelefone(numero)))
  return !variantesDoTelefone(telefone).some((v) => permitidos.has(v))
}

type ClienteMinimo = {
  from(tabela: string): {
    select(colunas: string): {
      eq(coluna: string, valor: string): {
        maybeSingle(): PromiseLike<{ data: Record<string, unknown> | null; error: { message: string } | null }>
      }
    }
  }
}

/**
 * Le a lista de teste da clinica. Consulta separada e protegida, no padrao da
 * casa para coluna nova: se a coluna ainda nao existir, a clinica segue como
 * real (sem trava) e o log avisa - perder a trava custa, no maximo, uma
 * recusa da Meta; derrubar o lembrete da clinica real custaria familias sem
 * aviso.
 */
export async function listaDeTeste(admin: unknown, clinicId: string): Promise<string[] | null> {
  try {
    // unknown + cast: o cliente do Supabase tem tipos genericos pesados, e so
    // estas quatro chamadas importam aqui.
    const { data, error } = await (admin as ClienteMinimo)
      .from('clinic_settings')
      .select('whatsapp_telefones_teste')
      .eq('clinic_id', clinicId)
      .maybeSingle()
    if (error) {
      console.warn('AVISO: nao consegui ler whatsapp_telefones_teste; seguindo sem trava de teste.', error.message)
      return null
    }
    const valor = data?.whatsapp_telefones_teste
    return Array.isArray(valor) ? valor.map(String) : null
  } catch (causa) {
    console.warn('AVISO: falha ao ler a lista de teste; seguindo sem trava.', causa)
    return null
  }
}
