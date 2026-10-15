// Simulacao de conversas inteiras, com os textos do consultorio do Dr. Fabio.
//
// Diferente dos testes, aqui nada e verificado automaticamente: o objetivo e
// imprimir a conversa como ela chega no celular do paciente, do "oi" ate o
// comprovante, para alguem LER e julgar se faz sentido. Teste que passa nao
// garante que o texto esta bom.
//
// Como rodar:  npm run simular   (ou o SIMULAR CONVERSAS.bat)
//
// Espelho do Dr. Fabio Dario (15/10/2026): no sistema do Dr. Marcello este
// arquivo tinha uma copia dos textos do banco dele. Aqui ele usa a mesma
// identidade e os mesmos roteiros do simulador (src/simulador), entao o que se
// le e exatamente o que aparece na reuniao. Relogio fixo numa quarta as 10h,
// e um caso as 22h, para o texto de fora do expediente aparecer tambem.
import { Simulacao } from './simulador.build/sessao.mjs'
import { IDENTIDADES, FAMILIAS } from './simulador.build/dados.mjs'
import { ROTEIROS } from './simulador.build/roteiros.mjs'

const FABIO = IDENTIDADES.fabio
const QUARTA_10H = Date.parse('2026-10-14T13:00:00Z')
const QUARTA_22H = Date.parse('2026-10-15T01:00:00Z')
const LINHA = '='.repeat(72)
const FINA = '-'.repeat(72)

const hora = (d) => d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
const recuo = (texto) => texto.split('\n').map((l) => `    ${l}`).join('\n')

function imprimirToques(m) {
  if (!m.toques) return
  const nomes = m.toques.opcoes.map((o) => o.titulo).join(' | ')
  console.log(m.toques.tipo === 'lista' ? `    [lista "${m.toques.rotulo}": ${nomes}]` : `    [botoes: ${nomes}]`)
}

async function conversa(titulo, subtitulo, familia, passos, inicio = QUARTA_10H) {
  let agora = inicio
  const s = new Simulacao(FABIO, FAMILIAS[familia], { relogio: () => new Date((agora += 40000)) })
  console.log(`\n${LINHA}\n${titulo}\n${subtitulo}\n${FINA}`)
  let ultima = null
  for (const passo of passos) {
    if (typeof passo === 'object' && 'equipe' in passo) {
      const r = s.responderComoEquipe(passo.equipe)
      console.log(`\n[${hora(r.mensagem.em)}] ${FABIO.equipe.toUpperCase()} (equipe):\n${recuo(passo.equipe)}`)
      continue
    }
    let entrada
    if (typeof passo === 'object' && 'toque' in passo) {
      const opcao = ultima?.toques?.opcoes.find((o) => o.id === passo.toque)
      if (!opcao) {
        console.log(`\n!!! o toque "${passo.toque}" nao existe na ultima mensagem: o roteiro parou aqui`)
        return
      }
      entrada = { texto: opcao.titulo, idDoToque: opcao.id }
    } else if (typeof passo === 'object' && 'anexo' in passo) {
      entrada = { texto: '', anexo: true }
    } else {
      entrada = { texto: passo }
    }
    const r = await s.enviarDaFamilia(entrada)
    const como = entrada.anexo ? ' (mandou uma foto)' : entrada.idDoToque ? ' (tocou)' : ''
    console.log(`\n[${hora(r.familia.em)}] PACIENTE${como}: ${r.familia.texto}`)
    for (const a of r.alertas) console.log(`\n    >>> NOTIFICACAO NO CELULAR de ${a.para.join(' e ')}: ${a.titulo}`)
    if (r.respostas.length === 0) console.log('\n    (robo em silencio: a conversa e da equipe)')
    for (const m of r.respostas) {
      console.log(`\n[${hora(m.em)}] ROBO:\n${recuo(m.texto)}`)
      imprimirToques(m)
    }
    ultima = [...r.respostas].reverse().find((m) => m.toques) ?? (r.respostas.length ? null : ultima)
  }
  const marcadas = s.consultas().filter((c) => c.status === 'scheduled')
  console.log(`\n${FINA}`)
  console.log(`Na tela da equipe: ${s.motivo ? `etiqueta "${s.motivo}"` : s.situacao === 'resolvida' ? 'resolvida pelo robo' : 'sem pendencia'}`)
  for (const c of marcadas) {
    console.log(
      `Agenda: ${new Date(c.starts_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · ${c.unidade} · ` +
        `${c.insurance || 'particular'}${c.intake_complaint ? ` · queixa: ${c.intake_complaint}` : ''}`,
    )
  }
}

const p = (r) => r.passos.map((x) => ('texto' in x ? x.texto : x))

console.log('SIMULACAO DO ROBO DO DR. FABIO DARIO')
console.log('Conversas inteiras, como chegam no celular. Nada aqui e enviado a ninguem.')

for (const [i, r] of ROTEIROS.entries()) {
  await conversa(`ROTEIRO ${i + 1}: ${r.titulo}`, `${FAMILIAS[r.familia].rotulo}. ${r.resumo}`, r.familia, p(r))
}

await conversa(
  'EXTRA: sangramento as 22h',
  'Fora do expediente: o alerta sai do mesmo jeito, e o robo diz para nao esperar.',
  'cadastrada',
  ['Boa noite, meu nariz está sangrando desde cedo'],
  QUARTA_22H,
)
await conversa(
  'EXTRA: "sem sangramento" nao dispara alerta',
  'A negacao e lida: a pergunta segue o caminho normal.',
  'nova',
  ['Meu filho vive com o nariz entupido, sem sangramento. Vocês atendem criança?'],
)
await conversa(
  'EXTRA: menor de idade marcado pela mae',
  'O responsavel so e perguntado porque a data mostra que o paciente e crianca.',
  'nova',
  ['Oi', '2', '1', '1', '1', 'Lucas Pereira Lima', '10/06/2017', 'Fernanda Pereira Lima', 'Respira pela boca e ronca', 'PULAR', 'PULAR'],
)
