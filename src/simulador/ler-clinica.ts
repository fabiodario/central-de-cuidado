/**
 * Le a configuracao da clinica de teste no Supabase, so leitura, com a sessao
 * de quem abriu o simulador. Ver da-clinica.ts para o que vira o que.
 *
 * Qual clinica: a do login que esta no simulador (14/10/2026). A conta de teste
 * tem login proprio, e o fluxo de reuniao e entrar nela
 * no sistema, configurar a clinica do cliente ("Clinica Cintia") e abrir o
 * simulador no mesmo navegador. Ate aqui o id da clinica de teste era fixo e o
 * banco recusava a leitura para quem nao era membro dela - o simulador caia na
 * copia fixa e a Clinica Cintia nao aparecia. A clinica real do Dr. Marcello
 * nunca e lida: com esse login, tenta a clinica de teste de sempre.
 *
 * So tabelas de configuracao: unidades, horarios, excecoes, clinic_settings e
 * respostas prontas. Paciente e consulta nunca sao lidos - a demonstracao
 * aparece na frente de cliente.
 *
 * Mesma regra do resto do sistema para coluna nova: vai em consulta separada,
 * dentro de try/catch. O Postgres recusa o SELECT inteiro quando falta uma
 * coluna, e perder a marca de telemedicina e um arranhao; perder a agenda
 * inteira por causa dela, nao.
 */
import { supabase } from '@/lib/supabase'
import { CLINICA_DE_TESTE } from '@/lib/clinica-de-teste'
import type { Linha } from './banco-falso'
import { diaDeBrasilia } from './agenda'
import type { LinhasDaClinica } from './da-clinica'

/** A clinica real (ver lib/marca.ts): nunca vira demonstracao. */
const CLINICA_DO_DR_MARCELLO = '1ffde840-a905-4300-b4fd-51571fcefdc0'

type Resposta = { data: unknown; error: { message: string } | null }
type Consulta = PromiseLike<Resposta> & {
  select(colunas: string): Consulta
  eq(coluna: string, valor: unknown): Consulta
  gte(coluna: string, valor: unknown): Consulta
  order(coluna: string, opcoes?: { ascending?: boolean }): Consulta
  limit(n: number): Consulta
}

// As tabelas de configuracao do robo nem todas estao nos tipos gerados do
// banco (bot_answers, colunas novas de clinic_units); repository.ts faz o
// mesmo com tabelaCrua.
const tabela = (nome: string) => (supabase.from as unknown as (n: string) => Consulta)(nome)

async function linhas(consulta: Consulta): Promise<Linha[]> {
  const { data, error } = await consulta
  if (error) throw new Error(error.message)
  return (data ?? []) as Linha[]
}

/** Coluna opcional: se o banco ainda nao a tem, fica sem ela e avisa no console. */
async function opcional(consulta: Consulta, oQue: string): Promise<Linha[]> {
  try {
    return await linhas(consulta)
  } catch (erro) {
    console.warn(`[simulador] sem ${oQue} da clinica de teste; seguindo sem`, erro)
    return []
  }
}

/**
 * A clinica do login, na mesma ordem do getCurrentMembership do sistema (a
 * vinculacao ativa mais antiga), pulando a clinica real. Sem nenhuma, a clinica
 * de teste de sempre - e se o login nao for membro dela, a leitura acusa.
 */
async function clinicaDoLogin(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession()
    const usuario = data.session?.user.id
    if (!usuario) return CLINICA_DE_TESTE
    const vinculos = await linhas(
      tabela('clinic_memberships').select('clinic_id').eq('user_id', usuario).eq('status', 'active').order('created_at', { ascending: true }),
    )
    const outra = vinculos.map((v) => String(v.clinic_id)).find((id) => id && id !== CLINICA_DO_DR_MARCELLO)
    return outra ?? CLINICA_DE_TESTE
  } catch (erro) {
    console.warn('[simulador] nao consegui ver de qual clinica e este login; tentando a clinica de teste', erro)
    return CLINICA_DE_TESTE
  }
}

export async function lerClinicaDeTeste(): Promise<LinhasDaClinica> {
  const c = await clinicaDoLogin()
  const hoje = diaDeBrasilia(new Date())
  const [clinica, unidades, regras, excecoes, agenda, saudacao, telemedicina, respostas, marcaTele, convenios, valores, valorTele] =
    await Promise.all([
      opcional(tabela('clinics').select('id,name').eq('id', c), 'o nome da clinica'),
      linhas(tabela('clinic_units').select('id,name,address,info_text,archived_at').eq('clinic_id', c)),
      linhas(tabela('availability_rules').select('id,unit_id,weekday,starts_at,ends_at').eq('clinic_id', c)),
      linhas(
        tabela('schedule_exceptions')
          .select('id,unit_id,exception_date,is_closed,starts_at,ends_at,reason')
          .eq('clinic_id', c)
          .gte('exception_date', hoje),
      ),
      opcional(
        tabela('clinic_settings').select('schedule_slot_minutes,schedule_horizon_days,schedule_min_notice_hours').eq('clinic_id', c).limit(1),
        'as preferencias da agenda',
      ),
      opcional(
        tabela('clinic_settings').select('whatsapp_autoreply_text,whatsapp_autoreply_known_text,whatsapp_menu_info_text').eq('clinic_id', c).limit(1),
        'a saudacao do robo',
      ),
      opcional(tabela('clinic_settings').select('telemedicine_enabled,telemedicine_info_text').eq('clinic_id', c).limit(1), 'a telemedicina'),
      opcional(tabela('bot_answers').select('id,subject,keywords,answer,ask_unit,is_active,position').eq('clinic_id', c), 'as respostas prontas'),
      opcional(tabela('clinic_units').select('id,telemedicina').eq('clinic_id', c), 'a marca de telemedicina das unidades'),
      opcional(tabela('clinic_units').select('id,accepts_insurance').eq('clinic_id', c), 'o convenio das unidades'),
      // Colunas de 14/10/2026: sem elas, a demonstracao segue sem os valores.
      opcional(tabela('clinic_units').select('id,price_cents').eq('clinic_id', c), 'o valor das unidades'),
      opcional(tabela('clinic_settings').select('telemedicine_price_cents').eq('clinic_id', c).limit(1), 'o valor da telemedicina'),
    ])

  // RLS nao da erro para quem nao e membro: devolve lista vazia. Sem unidade
  // nenhuma, ou a conta nao enxerga a clinica de teste ou ela esta sem
  // unidades - nos dois casos o simulador nao pode fingir que leu.
  if (unidades.length === 0) {
    throw new Error('a sua conta não enxerga nenhuma unidade da clínica de teste')
  }

  const porId = (lista: Linha[]) => new Map(lista.map((l) => [l.id, l]))
  const tele = porId(marcaTele)
  const convenio = porId(convenios)
  const valor = porId(valores)
  return {
    clinica: clinica[0] ?? null,
    unidades: unidades.map((u) => ({
      ...u,
      telemedicina: tele.get(u.id)?.telemedicina === true,
      accepts_insurance: convenio.get(u.id)?.accepts_insurance ?? null,
      price_cents: valor.get(u.id)?.price_cents ?? null,
    })),
    regras,
    excecoes,
    configuracoes: { ...(agenda[0] ?? {}), ...(saudacao[0] ?? {}), ...(telemedicina[0] ?? {}), ...(valorTele[0] ?? {}) },
    respostas,
  }
}
