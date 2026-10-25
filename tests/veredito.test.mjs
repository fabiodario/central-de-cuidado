// O veredito do medico sobre a urgencia (17/10/2026, pedido do Edu): "e
// urgente" ou "nao e urgente" volta para o robo, que manda ao paciente um texto
// fixo em nome do medico, muda o motivo da conversa e registra o veredito.
// No "npm run test:bot". VEREDITO_TS aponta para outra copia do modulo (para
// provar que o teste pega o defeito com a regra desligada).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSync } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const AQUI = dirname(fileURLToPath(import.meta.url))
const fonte = process.env.VEREDITO_TS ?? join(AQUI, '..', 'supabase', 'functions', '_shared', 'veredito.ts')
const saida = join(AQUI, 'veredito.build.mjs')
buildSync({ entryPoints: [fonte], bundle: true, format: 'esm', outfile: saida, logLevel: 'warning' })
const V = await import(`${pathToFileURL(saida).href}?v=${Date.now()}`)
const { Simulacao } = await import(pathToFileURL(join(AQUI, 'simulador.build', 'sessao.mjs')).href)
const { IDENTIDADES, FAMILIAS } = await import(pathToFileURL(join(AQUI, 'simulador.build', 'dados.mjs')).href)
// Sem CR: o git no Windows grava CRLF, e os trechos procurados aqui sao com \n.
const ler = (...partes) => readFileSync(join(AQUI, '..', ...partes), 'utf8').replace(/\r\n/g, '\n')

let ok = 0
async function caso(nome, fn) {
  try {
    await fn()
    ok++
  } catch (erro) {
    console.error('FALHOU:', nome)
    throw erro
  }
}

const FABIO = 'b5d0f6a2-3c71-4e8a-9f2d-7a1c4e9b0d63'

await caso('os dois textos, em nome do medico da clinica, sem travessao', () => {
  const urgente = V.textoDoVeredito('urgente', FABIO)
  const calmo = V.textoDoVeredito('nao_urgente', FABIO)
  assert.match(urgente, /^🚨 O Dr\. Fábio viu a sua mensagem e orienta: \*procure o pronto-socorro agora\*/)
  // Relatorio da Cintia (25/10/2026): o pronto-socorro que atende ao plano, sem hospital fixo.
  assert.match(urgente, /\n\nEm caso de urgência, emergência ou sangramento intenso, dirija-se imediatamente ao Pronto-Socorro mais próximo que atenda ao seu plano de saúde \(Porto Saúde, Unimed, Santa Saúde\)/)
  assert.doesNotMatch(V.textoDoVeredito('urgente', 'c1'), /plano de saúde/, 'o perfil sem a frase fica como era')
  // Desde 17/10/2026 o "nao e urgente" leva o botao de marcar e o "se
  // piorar", igual ao "Pode aguardar" do alerta no WhatsApp do medico.
  assert.match(calmo, /^💙 O Dr\. Fábio viu a sua mensagem e, pelo que você contou, não parece urgência\. A nossa equipe continua com você por aqui\.\n\nSe quiser, toque em \*Marcar uma consulta\* para ver os horários mais próximos\. Se piorar, é só escrever aqui\.$/)
  assert.deepEqual(V.botoesDoVeredito('nao_urgente'), [{ id: 'MARCAR_AGORA', titulo: 'Marcar uma consulta' }])
  assert.equal(V.botoesDoVeredito('urgente'), undefined)
  assert.match(V.textoDoVeredito('urgente', 'c1'), /O Dr\. Marcello/, 'o nome vem do perfil da clinica')
  for (const t of [urgente, calmo]) assert.doesNotMatch(t, /[\u2013\u2014]/)
  assert.doesNotMatch(urgente, /192/, 'o 192 nao vai na mensagem padrao (decisao de 16/10/2026)')
})

await caso('so dois vereditos valem; a conversa depois de cada um; o registro sem texto do paciente', () => {
  assert.equal(V.vereditoValido('urgente'), 'urgente')
  assert.equal(V.vereditoValido('nao_urgente'), 'nao_urgente')
  for (const ruim of [undefined, '', 'sim', 'URGENTE', 1]) assert.equal(V.vereditoValido(ruim), null)
  assert.deepEqual(V.conversaDepoisDoVeredito('urgente'), { needs_attention: false, attention_reason: null })
  // A etapa da fila da equipe (17/10/2026): e nela que o toque em "Marcar uma
  // consulta" abre o agendamento com a equipe na conversa.
  assert.deepEqual(V.conversaDepoisDoVeredito('nao_urgente'), {
    needs_attention: true,
    attention_reason: 'atendente',
    booking_state: 'atendente',
    booking_options: null,
  })
  assert.equal(V.detalheDoVeredito('nao_urgente', 'urgencia'), 'nao_urgente motivo=urgencia')
  assert.ok(V.detalheDoVeredito('urgente', 'x'.repeat(300)).length <= 120)
  assert.deepEqual(V.MOTIVOS_COM_VEREDITO, ['urgencia', 'sangramento'])
})

function simulacao() {
  let agora = Date.parse('2026-10-14T13:00:00Z')
  return new Simulacao(IDENTIDADES.fabio, FAMILIAS.nova, { relogio: () => new Date((agora += 30000)) })
}

await caso('simulador: nao e urgente manda o texto como equipe e devolve a conversa para a equipe, uma vez so', async () => {
  const s = simulacao()
  await s.enviarDaFamilia({ texto: 'Meu nariz está sangrando muito e não para' })
  assert.ok(s.pedeVeredito, 'sangramento pede veredito')
  const r = await s.darVeredito('nao_urgente')
  assert.equal(r.mensagem.autor, 'equipe')
  assert.equal(r.mensagem.texto, V.textoDoVeredito('nao_urgente', IDENTIDADES.fabio.clinicId))
  assert.equal(s.motivo, 'atendente')
  assert.equal(s.situacao, 'equipe', 'o robo fica calado: a equipe assumiu')
  assert.match(r.registros[0].titulo, /não é urgente/)
  assert.equal(s.pedeVeredito, false)
  assert.equal((await s.darVeredito('urgente')).mensagem, null, 'o segundo clique nao manda nada')
})

await caso('simulador: e urgente orienta o pronto-socorro e tira a conversa da lista; sem urgencia, nada', async () => {
  const s = simulacao()
  await s.enviarDaFamilia({ texto: 'Meu nariz está sangrando muito e não para' })
  const r = await s.darVeredito('urgente')
  assert.match(r.mensagem.texto, /procure o pronto-socorro agora/)
  assert.equal(s.motivo, null)
  assert.match(r.registros[0].titulo, /é urgente/)
  const calma = simulacao()
  await calma.enviarDaFamilia({ texto: 'Oi, tudo bem?' })
  assert.equal(calma.pedeVeredito, false)
  assert.deepEqual(await calma.darVeredito('urgente'), { mensagem: null, registros: [] })
})

await caso('o servidor: so quem atende, so em urgencia, texto montado la, conversa mudada e veredito registrado', () => {
  const f = ler('supabase', 'functions', 'whatsapp-reply', 'index.ts')
  assert.match(f, /\.select\('id,clinic_id,patient_id,wa_id,status,needs_attention,attention_reason'\)/)
  const bloco = f.slice(f.indexOf('    if (veredito) {\n      if (!(await clinicaDeQuemAtende'), f.indexOf('texto = textoDoVeredito(veredito, visivel.clinic_id)'))
  assert.match(bloco, /clinicaDeQuemAtende\(scoped, visivel\.clinic_id\)/)
  assert.match(bloco, /MOTIVOS_COM_VEREDITO\.includes/)
  assert.match(f, /let texto = veredito \? '' : \(body\.text \?\? ''\)\.trim\(\)/, 'o texto que a tela mandar e ignorado')
  assert.match(f, /\.\.\.\(veredito \? conversaDepoisDoVeredito\(veredito\) : \{\}\)/)
  assert.match(f, /evento: 'veredito_urgencia',\s*detalhe: detalheDoVeredito\(veredito, visivel\.attention_reason/)
})

await caso('a tela: so owner e clinician dao o veredito, nas duas versoes da conversa, com o texto exato na confirmacao', () => {
  const c = ler('src', 'sections', 'Conversations.tsx')
  assert.match(c, /setPodeDarVeredito\(membership\.role === 'owner' \|\| membership\.role === 'clinician'\)/)
  assert.equal((c.match(/<VereditoDaUrgencia/g) ?? []).length, 2, 'computador e celular')
  const v = ler('src', 'sections', 'VereditoDaUrgencia.tsx')
  assert.match(v, /detalhe: `O paciente recebe: "\$\{textoDoVeredito\(veredito, clinicId\)\}"\$\{botoesDoVeredito\(veredito\)/)
  assert.match(v, /if \(!motivo \|\| !MOTIVOS_COM_VEREDITO\.includes\(motivo\)\) return null/)
  const repo = ler('src', 'lib', 'repository.ts')
  const envio = repo.slice(repo.indexOf('export async function sendUrgencyVerdict'), repo.indexOf('export async function sendUrgencyVerdict') + 400)
  assert.match(envio, /body: \{ conversationId, veredito \}/, 'a tela nao manda texto: quem monta e o servidor')
  assert.match(ler('src', 'simulador', 'SimuladorBot.tsx'), /\{sim\.pedeVeredito && \(/)
})

console.log(`veredito: ${ok} casos ok`)
