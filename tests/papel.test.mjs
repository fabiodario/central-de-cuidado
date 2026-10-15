// Quem pode prescrever e transcrever: so owner e clinician ativos
// (24/09/2026). Antes bastava ser membro da clinica.

import { clinicaDeQuemAtende } from './papel.build.mjs'

let passou = 0
const falhas = []
function igual(titulo, veio, esperado) {
  if (veio === esperado) passou++
  else falhas.push(`${titulo}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(veio)}`)
}

// Banco falso: aplica os filtros como o PostgREST, sobre os vinculos do usuario.
function clienteCom(vinculos) {
  return {
    from: () => ({
      select: () => {
        const filtros = []
        const busca = {
          eq: (coluna, valor) => (filtros.push((l) => l[coluna] === valor), busca),
          in: (coluna, valores) => (filtros.push((l) => valores.includes(l[coluna])), busca),
          limit: () => ({
            maybeSingle: async () => ({
              data: vinculos.find((l) => filtros.every((f) => f(l))) ?? null,
              error: null,
            }),
          }),
        }
        return busca
      },
    }),
  }
}

const CLINICA = 'c1'
igual('medico', await clinicaDeQuemAtende(clienteCom([{ clinic_id: CLINICA, role: 'clinician', status: 'active' }])), CLINICA)
igual('dono', await clinicaDeQuemAtende(clienteCom([{ clinic_id: CLINICA, role: 'owner', status: 'active' }])), CLINICA)
igual('recepcao', await clinicaDeQuemAtende(clienteCom([{ clinic_id: CLINICA, role: 'staff', status: 'active' }])), null)
igual('somente visualizacao', await clinicaDeQuemAtende(clienteCom([{ clinic_id: CLINICA, role: 'viewer', status: 'active' }])), null)
igual('medico suspenso', await clinicaDeQuemAtende(clienteCom([{ clinic_id: CLINICA, role: 'clinician', status: 'suspended' }])), null)
igual('medico de outra clinica', await clinicaDeQuemAtende(clienteCom([{ clinic_id: 'c2', role: 'clinician', status: 'active' }]), CLINICA), null)
igual('sem vinculo', await clinicaDeQuemAtende(clienteCom([])), null)

console.log(`Papel: ${passou} verificações passaram.`)
if (falhas.length) {
  for (const f of falhas) console.log('✗ ' + f)
  process.exit(1)
}
