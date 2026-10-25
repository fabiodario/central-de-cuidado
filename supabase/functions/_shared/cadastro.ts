import type { adminClient } from './whatsapp.ts'
import { dataDeNascimentoIso } from './datas.ts'
import { quemAtende } from './quem-atende.ts'
import { mesmoTelefone, variantesDoTelefone } from './telefone-br.ts'

/**
 * O cadastro do paciente a partir do que a familia informou no WhatsApp.
 *
 * Vive aqui, e nao dentro de uma funcao so, porque duas horas diferentes
 * precisam do mesmo cuidado: logo depois de a familia responder a ficha, e na
 * vespera da consulta, quando o robo tenta fechar o que ficou aberto.
 */

type Admin = ReturnType<typeof adminClient>

export type ConsultaParaCadastro = {
  id: string
  /** Preenchido quando a consulta ja esta ligada a uma ficha. */
  patient_id?: string | null
  starts_at: string
  contact_name: string | null
  contact_phone: string | null
  intake_patient_name?: string | null
  intake_birth_date?: string | null
  intake_guardian?: string | null
  intake_cpf?: string | null
  intake_email?: string | null
  clinic_units?: { name: string } | { name: string }[] | null
}

/**
 * O nome da ficha e o do cadastro sao da mesma crianca?
 *
 * Todas as palavras do nome mais curto aparecem no mais longo: "Helena" e
 * "Helena Martins Costa" sao a mesma; "Maria Clara Souza" e "Maria Eduarda
 * Souza", nao - comparar so o primeiro nome juntaria as duas Marias. Apelido
 * ("Juju" para Julia) vira cadastro novo, que a equipe confere e junta.
 */
export function mesmaCrianca(cadastro: string, ficha: string): boolean {
  const palavras = (nome: string) =>
    nome
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((p) => p.length >= 2 && !['de', 'da', 'do', 'das', 'dos'].includes(p))
  const a = palavras(cadastro)
  const b = palavras(ficha)
  if (!a.length || !b.length) return false
  const [curto, longo] = a.length <= b.length ? [a, b] : [b, a]
  return curto.every((p) => longo.includes(p))
}

/**
 * Cria o cadastro de quem marcou pelo WhatsApp e ainda nao tem prontuario.
 *
 * Roda assim que a familia termina de responder a ficha, e de novo na vespera
 * para o que tiver ficado aberto. Existe por um motivo pratico: sem cadastro
 * nao ha prontuario, e o medico so descobriria isso com a familia sentada na
 * frente. Assim o dado que a familia acabou de digitar ja vira cadastro, sem
 * depender de alguem lembrar de clicar num botao.
 *
 * Tres cuidados, porque o dado veio por mensagem e ninguem conferiu:
 *  - paciente ja conhecido nao vira cadastro novo, vira vinculo. Duplicar o
 *    paciente e pior do que nao criar: o historico se parte em dois. Conhecido
 *    e o mesmo telefone (em qualquer grafia) ou o mesmo nome com a mesma data
 *    de nascimento. A excecao e o irmao: nome na ficha que nao e de ninguem do
 *    telefone (ver mesmaCrianca);
 *  - sem nome nenhum nao cria. "Consulta de quem?" nao se responde chutando;
 *  - o que nasce aqui fica marcado como automatico ate alguem da equipe abrir,
 *    conferir e salvar.
 */
export async function cadastrarDaFicha(
  admin: Admin,
  clinicId: string,
  consulta: ConsultaParaCadastro,
): Promise<{ id: string; name: string; phone: string; whatsapp_opt_out_at: string | null } | null> {
  const telefone = (consulta.contact_phone ?? '').trim()
  const nomeNaFicha = (consulta.intake_patient_name ?? '').trim()
  // Data so quando e data. "marco de 2019" fica em branco e a equipe pergunta:
  // uma data inventada no prontuario e pior do que um campo vazio. No perfil
  // 'geral' (Dr. Fabio) o paciente pode ser adulto: "85" vira 1985.
  const geral = quemAtende(clinicId).publico === 'geral'
  const nascimento = dataDeNascimentoIso(consulta.intake_birth_date ?? '', new Date(), { adulto: geral })

  // Ja existe alguem com este telefone? Entao a consulta e dessa pessoa, e o
  // que faltava era so o vinculo.
  //
  // Menos quando a ficha traz o nome de OUTRA crianca (14/10/2026, painel de
  // familias). A mae da Helena marcou o Pedro, irmao dela, pelo "Outra
  // crianca"; a ficha veio com "Pedro Souza Lima" e a consulta foi ligada ao
  // cadastro da Helena, o unico daquele telefone. O comprovante dizia Pedro, o
  // prontuario aberto no dia seria o da Helena. Irmaos no mesmo celular sao
  // comuns, e consulta no prontuario errado e pior do que um cadastro a mais
  // para a equipe conferir (o novo nasce marcado como automatico).
  //
  // O telefone e procurado em todas as grafias (25/10/2026). Ate aqui a busca
  // era pelo texto exato, e o WhatsApp entrega "5513..." enquanto a recepcao
  // digita "13...": uma familia ja cadastrada que marcou pelo robo ganhou um
  // segundo cadastro com o mesmo numero, e a agenda e as mensagens dela
  // ficaram no repetido.
  if (telefone) {
    const { data: doTelefone, error: erroDoTelefone } = await admin
      .from('patients')
      .select('id,name,phone,whatsapp_opt_out_at')
      .eq('clinic_id', clinicId)
      .in('phone_digits', variantesDoTelefone(telefone))
      .is('archived_at', null)
      .limit(20)
    if (erroDoTelefone) {
      console.warn('Cadastro da ficha: nao consegui procurar o telefone; pode sair cadastro repetido', erroDoTelefone)
    }
    const conhecidos = (doTelefone ?? []) as Conhecido[]
    // Sem nome na ficha, o de sempre: o primeiro do telefone. contact_name nao
    // entra aqui de proposito - no site ele costuma ser o nome da mae.
    const conhecido = nomeNaFicha
      ? conhecidos.find((p) => mesmaCrianca(p.name, nomeNaFicha))
      : conhecidos[0]
    if (conhecido) {
      await admin.from('appointments').update({ patient_id: conhecido.id }).eq('id', consulta.id)
      return conhecido
    }
  }

  // A mesma crianca marcada de outro celular (25/10/2026). O pai cadastrou, a
  // mae marcou o retorno pelo celular dela: telefone novo, cadastro novo, e o
  // prontuario se partia em dois. Mesmo nome (sem acento, ver mesmaCrianca)
  // com a mesma data de nascimento e a mesma crianca; gemeos tem nomes
  // diferentes. So com as duas coisas: nome sozinho junta homonimos, e sem
  // data na ficha o cadastro novo continua sendo o caminho seguro.
  if (nomeNaFicha && nascimento) {
    const { data: doNascimento, error: erroDoNascimento } = await admin
      .from('patients')
      .select('id,name,phone,whatsapp_opt_out_at,notes')
      .eq('clinic_id', clinicId)
      .eq('birth_date', nascimento)
      .is('archived_at', null)
      .order('created_at')
      .limit(20)
    if (erroDoNascimento) {
      console.warn('Cadastro da ficha: nao consegui procurar pelo nascimento; pode sair cadastro repetido', erroDoNascimento)
    }
    const mesma = ((doNascimento ?? []) as (Conhecido & { notes: string | null })[]).find((p) =>
      mesmaCrianca(p.name, nomeNaFicha),
    )
    if (mesma) {
      await admin.from('appointments').update({ patient_id: mesma.id }).eq('id', consulta.id)
      await anotarOutroTelefone(admin, mesma, telefone, consulta.starts_at)
      return { id: mesma.id, name: mesma.name, phone: mesma.phone, whatsapp_opt_out_at: mesma.whatsapp_opt_out_at }
    }
  }

  const nome = (consulta.intake_patient_name || consulta.contact_name || '').trim()
  if (nome.length < 2) return null
  // Sem nome na ficha, o nome e o do contato do WhatsApp (18/10/2026, vindo do
  // sistema do Dr. Marcello, onde quase sempre era a mae). No perfil 'geral' o
  // contato costuma ser o proprio paciente, mas pode ser um parente. O cadastro
  // nasce do mesmo jeito, marcado: a tela mostra "Nome a confirmar" ate alguem
  // salvar o nome conferido.
  const nomeDoContato = !nomeNaFicha

  const unidade = Array.isArray(consulta.clinic_units)
    ? consulta.clinic_units[0]?.name ?? ''
    : consulta.clinic_units?.name ?? ''

  const linha: Record<string, unknown> = {
    clinic_id: clinicId,
    name: nome.slice(0, 200),
    guardian_name: (consulta.intake_guardian ?? '').slice(0, 200),
    birth_date: nascimento,
    phone: telefone.slice(0, 32),
    cpf: (consulta.intake_cpf ?? '').replace(/\D/g, '') || null,
    email: (consulta.intake_email ?? '') || null,
    unit: unidade.slice(0, 160),
    consultation_date: consulta.starts_at.slice(0, 10),
    notes:
      `Cadastro criado pelo sistema a partir do agendamento no WhatsApp. Confira os dados com ${geral ? 'o paciente' : 'a família'}.` +
      (nomeDoContato
        ? geral
          ? ' ATENÇÃO: a ficha ficou sem o nome do paciente, e o nome é o do contato do WhatsApp (pode ser o de um parente).'
          : ' ATENÇÃO: a ficha ficou sem o nome da criança, e o nome é o do contato do WhatsApp (pode ser o da mãe ou do pai).'
        : ''),
    auto_created_at: new Date().toISOString(),
    ...(nomeDoContato ? { name_from_contact_at: new Date().toISOString() } : {}),
  }
  let { data: criado, error } = await admin
    .from('patients')
    .insert(linha)
    .select('id,name,phone,whatsapp_opt_out_at')
    .maybeSingle()
  // Coluna nova que o banco ainda nao tem recusa o INSERT inteiro (ver o
  // CLAUDE.md). Sem a marca, o aviso ainda vai nas observacoes; sem o
  // cadastro, nao haveria prontuario.
  if (error && (error as { code?: string }).code === '42703' && 'name_from_contact_at' in linha) {
    console.warn('patients sem name_from_contact_at; cadastro criado sem a marca do nome', error)
    delete linha.name_from_contact_at
    const segunda = await admin.from('patients').insert(linha).select('id,name,phone,whatsapp_opt_out_at').maybeSingle()
    criado = segunda.data
    error = segunda.error
  }

  if (error || !criado) {
    console.error('Falha ao criar cadastro automatico', { appointmentId: consulta.id, error })
    return null
  }

  await admin.from('appointments').update({ patient_id: criado.id }).eq('id', consulta.id)
  return criado
}

type Conhecido = { id: string; name: string; phone: string; whatsapp_opt_out_at: string | null }

/** "5513988028653" -> "(13) 98802-8653". */
function telefoneLegivel(numero: string): string {
  const digitos = numero.replace(/\D/g, '')
  const local = digitos.startsWith('55') && digitos.length >= 12 ? digitos.slice(2) : digitos
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  return local
}

/**
 * Vinculou pelo nome e nascimento, com outro celular: o numero novo vai para
 * as observacoes, para a equipe saber que a familia tem dois.
 *
 * Fica so na nota, e o telefone do cadastro nao muda: quem cadastrou pode ser
 * o pai, e trocar sozinho mudaria para onde vao os acompanhamentos. O lembrete
 * da vespera usa o telefone do cadastro (appointment-reminders). Falhar aqui
 * nao desfaz o vinculo, so avisa no log.
 */
async function anotarOutroTelefone(
  admin: Admin,
  paciente: Conhecido & { notes: string | null },
  telefone: string,
  startsAt: string,
) {
  if (!telefone || mesmoTelefone(paciente.phone ?? '', telefone)) return
  const legivel = telefoneLegivel(telefone)
  const notas = paciente.notes ?? ''
  if (notas.replace(/\D/g, '').includes(legivel.replace(/\D/g, ''))) return
  const [ano, mes, dia] = startsAt.slice(0, 10).split('-')
  const linha = `Outro telefone da família: ${legivel} (marcou pelo WhatsApp a consulta de ${dia}/${mes}/${ano}).`
  const { error } = await admin
    .from('patients')
    .update({ notes: notas ? `${notas}\n\n${linha}` : linha })
    .eq('id', paciente.id)
  if (error) console.warn('Cadastro da ficha: vinculei pelo nascimento, mas nao anotei o outro telefone', error)
}

