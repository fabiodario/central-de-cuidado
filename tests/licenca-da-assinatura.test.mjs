// Assinatura digital como modulo a parte (26/10/2026): sem a licenca, o botao
// "Assinar digitalmente" responde "Licença não configurada." e nada mais. Ver
// supabase/functions/_shared/licenca-da-assinatura.ts.
import { buildSync } from 'esbuild'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const AQUI = dirname(fileURLToPath(import.meta.url))
const saida = join(AQUI, 'licenca-da-assinatura.build.mjs')
buildSync({
  entryPoints: [join(AQUI, '..', 'supabase/functions/_shared/licenca-da-assinatura.ts')],
  format: 'esm',
  outfile: saida,
  logLevel: 'warning',
})
const { licencaDaAssinatura, licencaPelaResposta, LICENCA_NAO_CONFIGURADA } = await import(`${pathToFileURL(saida).href}?v=${Date.now()}`)

let ok = 0
const falhas = []
const confere = (nome, cond) => (cond ? ok++ : falhas.push(nome))
const segredos = (valores) => (nome) => valores[nome]

const completa = { BRY_CLIENT_ID: 'id', BRY_CLIENT_SECRET: 'segredo', BRY_CPF_MEDICO: '00000000000' }

confere('Com os tres segredos: licenca configurada', licencaDaAssinatura(segredos(completa)) === true)
confere('Clinica sem nada da BRy (o Dr. Fabio hoje): sem licenca', licencaDaAssinatura(segredos({})) === false)
// O caso do print de 26/10: o defeito era a tela falar do CPF. Faltando so ele,
// tambem e "sem licenca".
confere('So falta o CPF do certificado: sem licenca', licencaDaAssinatura(segredos({ ...completa, BRY_CPF_MEDICO: undefined })) === false)
confere('So falta o client id: sem licenca', licencaDaAssinatura(segredos({ ...completa, BRY_CLIENT_ID: undefined })) === false)
confere('So falta o client secret: sem licenca', licencaDaAssinatura(segredos({ ...completa, BRY_CLIENT_SECRET: undefined })) === false)
confere('Segredo so com espacos conta como vazio', licencaDaAssinatura(segredos({ ...completa, BRY_CPF_MEDICO: '   ' })) === false)
confere('O texto e o que o Edu pediu', LICENCA_NAO_CONFIGURADA === 'Licença não configurada.')

// A funcao confere a licenca antes de ler o pedido ou o banco, e responde com
// o texto da licenca, nao com o primeiro segredo que faltar.
const funcao = readFileSync(join(AQUI, '..', 'supabase/functions/assinar-consulta/index.ts'), 'utf8')
const posLicenca = funcao.indexOf('if (!licencaDaAssinatura(')
const trechoDaLicenca = posLicenca >= 0 ? funcao.slice(posLicenca, posLicenca + 200) : ''
confere('assinar-consulta confere a licenca', posLicenca >= 0)
confere('...antes de ler o pedido', posLicenca >= 0 && posLicenca < funcao.indexOf('await req.json()'))
confere('...antes da etapa iniciar', posLicenca >= 0 && posLicenca < funcao.indexOf("corpo.acao === 'iniciar'"))
confere('...e responde "Licença não configurada." com SEM_LICENCA', trechoDaLicenca.includes('LICENCA_NAO_CONFIGURADA') && trechoDaLicenca.includes('CODIGO_SEM_LICENCA'))

// O lembrete "atendimentos sem assinatura" (26/10/2026): sem licenca, some.
// A tela pergunta { acao: 'licenca' }; com licenca o servidor responde que ha.
const posPergunta = funcao.indexOf("if (corpo.acao === 'licenca') return json({ licenca: true })")
confere('assinar-consulta responde a pergunta da licenca', posPergunta >= 0)
confere('...depois da checagem (sem licenca, sai SEM_LICENCA antes)', posPergunta > posLicenca)
confere('...e antes da etapa iniciar', posPergunta >= 0 && posPergunta < funcao.indexOf("corpo.acao === 'iniciar'"))

// Como a tela le a resposta.
const respostaDe = (status, corpo) => Object.assign(new Error('non-2xx'), { context: new Response(JSON.stringify(corpo), { status }) })
confere('Sem erro: ha licenca', (await licencaPelaResposta(null)) === true)
confere('SEM_LICENCA: nao ha licenca', (await licencaPelaResposta(respostaDe(503, { error: 'Licença não configurada.', code: 'SEM_LICENCA' }))) === false)
const lanca = async (erro) => {
  try {
    await licencaPelaResposta(erro)
    return false
  } catch {
    return true
  }
}
// Falha que nao e de licenca nao pode esconder o lembrete por engano, nem
// mostrar por engano: lanca, e a tela tenta de novo na proxima carga.
confere('Servidor com outro erro (500): nao afirma nada', await lanca(respostaDe(500, { error: 'Falha.' })))
confere('Rede fora (erro sem resposta): nao afirma nada', await lanca(new Error('Failed to fetch')))

// A tela inicial pergunta a licenca antes de montar a lista, e zera o aviso.
const home = readFileSync(join(AQUI, '..', 'src/pages/Home.tsx'), 'utf8')
const carga = home.slice(home.indexOf('const carregarSemAssinatura'), home.indexOf('}, [podeAssinar, clinicaId])'))
confere('Tela inicial pergunta a licenca', carga.includes('if (!(await assinaturaLicenciada()))'))
confere('...antes de listar os atendimentos', carga.indexOf('assinaturaLicenciada()') >= 0 && carga.indexOf('assinaturaLicenciada()') < carga.indexOf('listAtendimentosSemAssinatura('))
confere('...e sem licenca zera o aviso', /if \(!\(await assinaturaLicenciada\(\)\)\) \{\s*setSemAssinatura\(\[\]\)\s*return/.test(carga))

const repositorio = readFileSync(join(AQUI, '..', 'src/lib/repository.ts'), 'utf8')
const pergunta = repositorio.slice(repositorio.indexOf('export function assinaturaLicenciada'), repositorio.indexOf('export interface AtendimentoSemAssinatura'))
confere('A pergunta vai como acao licenca', pergunta.includes("body: { acao: 'licenca' }") && pergunta.includes('licencaPelaResposta(error)'))
confere('...uma vez por sessao (fica guardada)', pergunta.includes('if (!licencaDaAssinaturaPedida)'))

if (falhas.length) {
  console.error(`licenca-da-assinatura: ${falhas.length} falha(s)`)
  for (const f of falhas) console.error('  x ' + f)
  process.exit(1)
}
console.log(`licenca-da-assinatura: ${ok} verificacoes ok`)
