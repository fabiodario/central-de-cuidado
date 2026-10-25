// Atendidos e pre-agendados (25/10/2026). Ver src/lib/paciente-atendido.ts.
import { buildSync } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

// Vindo do sistema do Dr. Marcello (25/10/2026). Monta o modulo na hora.
const AQUI = dirname(fileURLToPath(import.meta.url))
const saida = join(AQUI, 'paciente-atendido.build.mjs')
buildSync({ entryPoints: [join(AQUI, '..', 'src/lib/paciente-atendido.ts')], bundle: true, format: 'esm', outfile: saida, logLevel: 'warning' })
const { pacientesAtendidos } = await import(`${pathToFileURL(saida).href}?v=${Date.now()}`)

let ok = 0
const falhas = []
const confere = (nome, cond, detalhe = '') => (cond ? ok++ : falhas.push(`${nome} ${detalhe}`))

const hoje = '2026-10-25'
// 14h em Sao Paulo = 17h UTC.
const horario = (patientId, dia, status) => ({ patientId, startsAt: `${dia}T17:00:00Z`, status })
const atendido = (paciente, agenda = [], prontuario = []) =>
  pacientesAtendidos([paciente], agenda, new Set(prontuario), hoje).has(paciente.id)

confere('presenca marcada: atendido', atendido({ id: 'a', dataConsulta: '2026-10-02' }, [horario('a', '2026-10-02', 'attended')]))
confere('cancelou e nunca voltou: pre-agendado', !atendido({ id: 'b', dataConsulta: '2026-10-02' }, [horario('b', '2026-10-02', 'cancelled')]))
confere('faltou: pre-agendado', !atendido({ id: 'c', dataConsulta: '2026-09-30' }, [horario('c', '2026-09-30', 'no_show')]))
confere('marcou para o futuro: pre-agendado', !atendido({ id: 'd', dataConsulta: '2026-10-28' }, [horario('d', '2026-10-28', 'scheduled')]))
confere('dia passou sem presenca marcada: pre-agendado', !atendido({ id: 'e', dataConsulta: '2026-09-23' }, [horario('e', '2026-09-23', 'scheduled')]))
confere('prontuario escrito: atendido mesmo sem presenca', atendido({ id: 'f', dataConsulta: '2026-09-23' }, [horario('f', '2026-09-23', 'scheduled')], ['f']))
confere('ficha a mao depois do atendimento, sem agenda: atendido', atendido({ id: 'g', dataConsulta: '2026-09-10' }))
confere('ficha a mao com data futura e sem agenda: pre-agendado', !atendido({ id: 'h', dataConsulta: '2026-11-03' }))
confere('cancelou, remarcou e veio em outro dia: atendido', atendido({ id: 'i', dataConsulta: '2026-10-02' }, [horario('i', '2026-10-02', 'cancelled'), horario('i', '2026-10-09', 'attended')]))
confere('presenca de OUTRO paciente nao conta', !atendido({ id: 'j', dataConsulta: '2026-10-02' }, [horario('j', '2026-10-02', 'cancelled'), horario('x', '2026-10-02', 'attended')]))
confere('consulta hoje ainda nao aconteceu: pre-agendado', !atendido({ id: 'k', dataConsulta: hoje }, [horario('k', hoje, 'scheduled')]))
// Consulta das 22h em Sao Paulo cai no dia seguinte em UTC: o dia e o daqui.
confere('dia da agenda no relogio de Sao Paulo', !atendido({ id: 'l', dataConsulta: '2026-10-02' }, [{ patientId: 'l', startsAt: '2026-10-03T01:00:00Z', status: 'cancelled' }]))

console.log(`paciente-atendido: ${ok} verificacoes ok`)
if (falhas.length) {
  for (const f of falhas) console.log('✗ ' + f)
  process.exit(1)
}
