/**
 * Le a configuracao da clinica de quem esta logado, so leitura, com a sessao
 * do sistema. Ver da-clinica.ts para o que vira o que.
 *
 * Simulador dentro de Respostas (16/10/2026): o Edu pediu o simulador aberto
 * no proprio sistema, "ja como vai ser o robo do Dr. Fabio". O robo da
 * simulacao responde com o que esta cadastrado de verdade: unidades, horarios,
 * excecoes, preferencias da agenda, saudacao e respostas prontas. Mudou uma
 * resposta pronta, recarrega o simulador e ve o robo novo.
 *
 * Herdado do sistema do Dr. Marcello, onde lia so a clinica de teste das
 * demonstracoes de venda e nunca a clinica real dele. Aqui a clinica e a do
 * login: e para ela que o robo vai responder.
 *
 * So tabelas de configuracao. Paciente e consulta nunca sao lidos: as
 * consultas da simulacao continuam no banco falso, no navegador.
 *
 * Mesma regra do resto do sistema para coluna nova: vai em consulta separada,
 * dentro de try/catch. O Postgres recusa o SELECT inteiro quando falta uma
 * coluna, e perder a marca de telemedicina e um arranhao; perder a agenda
 * inteira por causa dela, nao.
 */
import { supabase } from '@/lib/supabase'
import type { Linha } from './banco-falso'
import { diaDeBrasilia } from './agenda'
import type { LinhasDaClinica } from './da-clinica'

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
    console.warn(`[simulador] sem ${oQue} da clinica; seguindo sem`, erro)
    return []
  }
}

/**
 * A clinica do login, na mesma ordem do getCurrentMembership do sistema: a
 * vinculacao ativa mais antiga. Sem nenhuma, para com o motivo, em vez de cair
 * calado nos dados de exemplo.
 */
async function clinicaDoLogin(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const usuario = data.session?.user.id
  if (!usuario) throw new Error('não há ninguém logado no sistema neste navegador')
  const vinculos = await linhas(
    tabela('clinic_memberships').select('clinic_id').eq('user_id', usuario).eq('status', 'active').order('created_at', { ascending: true }),
  )
  const clinica = vinculos.map((v) => String(v.clinic_id)).find(Boolean)
  if (!clinica) throw new Error('a sua conta não tem acesso ativo a nenhuma clínica')
  return clinica
}

export async function lerClinicaDoLogin(): Promise<LinhasDaClinica> {
  const c = await clinicaDoLogin()
  const hoje = diaDeBrasilia(new Date())
  const [clinica, unidades, regras, excecoes, agenda, saudacao, telemedicina, respostas, marcaTele, convenios, valores, valorTele, chamaAEquipe] =
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
      opcional(tabela('clinic_units').select('id,price_cents').eq('clinic_id', c), 'o valor das unidades'),
      opcional(tabela('clinic_settings').select('telemedicine_price_cents').eq('clinic_id', c).limit(1), 'o valor da telemedicina'),
      // Coluna de 16/10/2026: a resposta que tambem chama a equipe.
      opcional(tabela('bot_answers').select('id,hand_off').eq('clinic_id', c), 'o "chamar a equipe" das respostas prontas'),
    ])

  // RLS nao da erro para quem nao enxerga: devolve lista vazia. Sem unidade
  // nenhuma, o robo nao tem onde marcar, e a simulacao nao pode fingir que leu.
  if (unidades.filter((u) => !u.archived_at).length === 0) {
    throw new Error('a clínica ainda não tem nenhuma unidade ativa cadastrada')
  }

  const porId = (lista: Linha[]) => new Map(lista.map((l) => [l.id, l]))
  const tele = porId(marcaTele)
  const convenio = porId(convenios)
  const valor = porId(valores)
  const equipe = porId(chamaAEquipe)
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
    respostas: respostas.map((r) => ({ ...r, hand_off: equipe.get(r.id)?.hand_off === true })),
  }
}
