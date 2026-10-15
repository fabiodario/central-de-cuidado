// available_slots_periodo num Postgres de verdade (PGlite, Postgres 17 em
// WebAssembly). Migration 20261014150000_horarios_por_periodo.sql.
//
// Fora do npm run test:bot de proposito: precisa do PGlite, que nao e
// dependencia do projeto. Rode quando mexer na regra de horarios livres:
//
//   npm i --no-save @electric-sql/pglite
//   node tests/horarios-periodo.test.mjs
//
// O que precisa valer:
//  1. available_slots devolve EXATAMENTE o que devolvia antes (a funcao de
//     03/10/2026 roda aqui ao lado, com outro nome, e as duas sao comparadas).
//  2. Com periodo, vale o pedido: dia alem da agenda aberta aparece, dia antes
//     de hoje nao, e nada passa de 180 dias.
import { readFileSync } from 'node:fs'

const { PGlite } = await import(process.env.PGLITE ?? '@electric-sql/pglite')
const db = new PGlite()

let ok = 0
const falhas = []
const confere = (nome, cond, detalhe = '') => (cond ? ok++ : falhas.push(`${nome} ${detalhe}`))

await db.exec(`
  create role authenticated; create role service_role;
  create table public.clinics (id uuid primary key, timezone text);
  create table public.clinic_units (id uuid primary key, clinic_id uuid, archived_at timestamptz, telemedicina boolean default false);
  create table public.clinic_settings (clinic_id uuid, schedule_slot_minutes int, schedule_horizon_days int, schedule_min_notice_hours int);
  create table public.availability_rules (unit_id uuid, weekday smallint, starts_at time, ends_at time);
  create table public.schedule_exceptions (clinic_id uuid, unit_id uuid, exception_date date, is_closed boolean, starts_at time, ends_at time);
  create table public.appointments (clinic_id uuid, unit_id uuid, status text, hold_expires_at timestamptz, starts_at timestamptz, ends_at timestamptz);
  -- "Hoje" de Sao Paulo, e nao hoje_sp() (UTC): das 21h a meia-noite os dois
  -- sao dias diferentes, e o teste errava o dia dos dados.
  create function hoje_sp() returns date language sql as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;
`)

// A funcao de antes, com outro nome, para comparar.
const migracaoAntiga = readFileSync(new URL('../supabase/migrations/20261003150000_agenda_propria_da_telemedicina.sql', import.meta.url), 'utf8')
const i = migracaoAntiga.indexOf('create or replace function public.available_slots(p_unit_id uuid)')
const j = migracaoAntiga.indexOf('$fn$;', i) + '$fn$;'.length
await db.exec(migracaoAntiga.slice(i, j).replace('public.available_slots(p_unit_id uuid)', 'public.available_slots_antiga(p_unit_id uuid)'))

// A migration nova, inteira (begin/commit inclusive).
await db.exec(readFileSync(new URL('../supabase/migrations/20261014150000_horarios_por_periodo.sql', import.meta.url), 'utf8'))

const C = '11111111-1111-1111-1111-111111111111'
const SANTOS = '22222222-2222-2222-2222-222222222222'
const SP = '33333333-3333-3333-3333-333333333333'
const TELE = '44444444-4444-4444-4444-444444444444'
await db.exec(`
  insert into public.clinics values ('${C}', 'America/Sao_Paulo');
  insert into public.clinic_units values ('${SANTOS}', '${C}', null, false), ('${SP}', '${C}', null, false), ('${TELE}', '${C}', null, true);
  insert into public.clinic_settings values ('${C}', 40, 15, 2);
  -- Santos quarta e sexta de manha, Sao Paulo sexta a tarde, video segunda.
  insert into public.availability_rules values
    ('${SANTOS}', 3, '08:00', '12:00'), ('${SANTOS}', 5, '08:00', '12:00'),
    ('${SP}', 5, '14:00', '17:20'), ('${TELE}', 1, '18:00', '20:00');
  -- Um feriado da clinica toda, um horario extra num sabado, e consultas:
  -- uma presencial, uma cancelada, uma reserva vencida e uma por video.
  insert into public.schedule_exceptions values
    ('${C}', null, hoje_sp() + 9, true, null, null),
    ('${C}', '${SANTOS}', hoje_sp() + 4, false, '09:00', '11:00');
  insert into public.appointments values
    ('${C}', '${SANTOS}', 'scheduled', null, (hoje_sp() + 7 + time '11:00') at time zone 'America/Sao_Paulo', (hoje_sp() + 7 + time '11:40') at time zone 'America/Sao_Paulo'),
    ('${C}', '${SANTOS}', 'cancelled', null, (hoje_sp() + 7 + time '08:00') at time zone 'America/Sao_Paulo', (hoje_sp() + 7 + time '08:40') at time zone 'America/Sao_Paulo'),
    ('${C}', '${SANTOS}', 'scheduled', now() - interval '1 hour', (hoje_sp() + 7 + time '08:40') at time zone 'America/Sao_Paulo', (hoje_sp() + 7 + time '09:20') at time zone 'America/Sao_Paulo'),
    ('${C}', '${TELE}', 'scheduled', null, (hoje_sp() + 5 + time '14:00') at time zone 'America/Sao_Paulo', (hoje_sp() + 5 + time '14:40') at time zone 'America/Sao_Paulo');
`)

const lista = async (sql) => (await db.query(sql)).rows.map((r) => new Date(r.slot_start).toISOString())

// 1. Sem periodo: identico ao de antes, em todas as agendas e configuracoes.
const comparados = {}
for (const [horizonte, aviso, duracao] of [[15, 2, 40], [30, 0, 30], [7, 48, 60]]) {
  await db.exec(`update public.clinic_settings set schedule_horizon_days = ${horizonte}, schedule_min_notice_hours = ${aviso}, schedule_slot_minutes = ${duracao}`)
  for (const [nome, unidade] of [['Santos', SANTOS], ['SP', SP], ['video', TELE]]) {
    const antes = await lista(`select * from public.available_slots_antiga('${unidade}')`)
    const agora = await lista(`select * from public.available_slots('${unidade}')`)
    confere(`${nome} (janela ${horizonte}, aviso ${aviso}h, ${duracao} min): available_slots igual ao de antes`,
      JSON.stringify(antes) === JSON.stringify(agora), `antes ${antes.length}, agora ${agora.length}`)
    comparados[nome] = (comparados[nome] ?? 0) + antes.length
  }
}
// Comparar duas listas vazias nao prova nada.
confere('houve horario de verdade para comparar', comparados.Santos > 0 && comparados.SP > 0 && comparados.video > 0, JSON.stringify(comparados))
await db.exec(`update public.clinic_settings set schedule_horizon_days = 15, schedule_min_notice_hours = 2, schedule_slot_minutes = 40`)

// 2. Com periodo.
const diaLocal = (iso) => new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10)
const hoje = (await db.query(`select (now() at time zone 'America/Sao_Paulo')::date::text as d`)).rows[0].d
const somar = (n) => new Date(Date.parse(`${hoje}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

{
  // 40 dias a frente (a Cecilia): fora da agenda aberta, dentro do periodo.
  const alvo = Array.from({ length: 7 }, (_, k) => somar(40 + k)).find((d) => [3, 5].includes(new Date(`${d}T12:00:00Z`).getUTCDay()))
  const semPeriodo = await lista(`select * from public.available_slots('${SANTOS}')`)
  const comPeriodo = await lista(`select * from public.available_slots_periodo('${SANTOS}', '${alvo}', '${alvo}')`)
  confere('dia a 40 dias nao aparece na agenda aberta', !semPeriodo.some((h) => diaLocal(h) === alvo))
  confere('dia a 40 dias aparece pedindo o periodo', comPeriodo.length === 6 && comPeriodo.every((h) => diaLocal(h) === alvo), `${comPeriodo.length}`)
}
{
  const dentro = await lista(`select * from public.available_slots_periodo('${SANTOS}', '${somar(1)}', '${somar(10)}')`)
  confere('periodo corta nas duas pontas', dentro.length > 0 && dentro.every((h) => diaLocal(h) >= somar(1) && diaLocal(h) <= somar(10)))
  const fechado = dentro.filter((h) => diaLocal(h) === somar(9))
  confere('dia fechado continua fechado no periodo', fechado.length === 0)
  const extra = dentro.filter((h) => diaLocal(h) === somar(4))
  confere('horario extra entra no periodo', extra.length >= 3, `${extra.length}`)
}
confere('periodo no passado nao devolve nada', (await lista(`select * from public.available_slots_periodo('${SANTOS}', '${somar(-20)}', '${somar(-1)}')`)).length === 0)
confere('periodo invertido nao devolve nada', (await lista(`select * from public.available_slots_periodo('${SANTOS}', '${somar(10)}', '${somar(5)}')`)).length === 0)
{
  const longe = await lista(`select * from public.available_slots_periodo('${SANTOS}', '${somar(150)}', '${somar(400)}')`)
  confere('nada alem de 180 dias', longe.length > 0 && longe.every((h) => diaLocal(h) <= somar(180)))
}
{
  // So "de", sem "ate": a janela da clinica a partir daquele dia.
  const deSo = await lista(`select * from public.available_slots_periodo('${SANTOS}', '${somar(30)}', null)`)
  confere('so a data inicial: janela da clinica a partir dela', deSo.length > 0 && deSo.every((h) => diaLocal(h) >= somar(30) && diaLocal(h) <= somar(45)))
}
{
  // Video ocupa o medico nas fisicas tambem com periodo.
  const sexta5 = await lista(`select * from public.available_slots_periodo('${SANTOS}', '${somar(5)}', '${somar(5)}')`)
  confere('consulta por video tira o horario da unidade fisica', !sexta5.some((h) => h.includes('T17:00')))
}

console.log(`Horarios por periodo (Postgres): ${ok} verificacoes passaram.`)
if (falhas.length) {
  for (const f of falhas) console.log('✗ ' + f)
  process.exit(1)
}
