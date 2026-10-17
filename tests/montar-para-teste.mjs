// Pecas comuns dos testes do alerta de urgencia no WhatsApp (17/10/2026):
// montar o modulo com o esbuild e um banco de mentira que falha como o
// Postgres falha quando a migration ainda nao chegou.
//
// DESLIGAR (variavel de ambiente) prova que o teste pega o defeito: e uma
// lista JSON de trocas [{ "arquivo": "alerta-de-urgencia.ts", "de": "...",
// "para": "..." }] aplicadas no codigo na hora de montar (ou de ler, nos
// testes que conferem o texto do arquivo), sem mexer no arquivo de verdade.
// "arquivo" e o fim do caminho ("meta-webhook/index.ts"). Troca que nao acha
// o trecho para tudo: um "desligado" que nao desligou nada faria o teste
// parecer bom.
import { build, buildSync } from 'esbuild'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const trocas = JSON.parse(process.env.DESLIGAR ?? '[]')
const usadas = new Set()
const doArquivo = (caminho) => trocas.filter((t) => caminho.replaceAll('\\', '/').endsWith(`/${t.arquivo}`))

/** O arquivo como texto (sem CR: o git no Windows grava CRLF), com as trocas de DESLIGAR. */
export function lerComTrocas(caminho) {
  let codigo = readFileSync(caminho, 'utf8').replaceAll('\r\n', '\n')
  for (const t of doArquivo(caminho)) {
    if (!codigo.includes(t.de)) throw new Error(`DESLIGAR: "${t.de.slice(0, 60)}" nao esta em ${t.arquivo}`)
    codigo = codigo.replace(t.de, t.para)
    usadas.add(t)
  }
  return codigo
}

const desligar = {
  name: 'desligar',
  setup(montagem) {
    montagem.onLoad({ filter: /\.(ts|tsx)$/ }, (args) => {
      if (!doArquivo(args.path).length) return undefined
      return { contents: lerComTrocas(args.path), loader: args.path.endsWith('x') ? 'tsx' : 'ts' }
    })
  },
}

/** Monta o arquivo .ts (com tudo o que ele importa) e devolve o modulo. */
export async function montar(entrada, saida) {
  const opcoes = { entryPoints: [entrada], bundle: true, format: 'esm', outfile: saida, logLevel: 'warning' }
  // buildSync nao aceita plugin; com troca, vai pelo build assincrono.
  if (trocas.length) await build({ ...opcoes, plugins: [desligar] })
  else buildSync(opcoes)
  return import(`${pathToFileURL(saida).href}?v=${Date.now()}`)
}

/** Chamado no fim: toda troca pedida precisa ter sido aplicada em algum modulo. */
export function conferirDesligar() {
  const sobrou = trocas.filter((t) => !usadas.has(t))
  if (sobrou.length) throw new Error(`DESLIGAR: troca nao aplicada em nenhum modulo: ${sobrou.map((t) => t.arquivo).join(', ')}`)
}

/** Uma consulta que sempre volta com o erro do Postgres, por mais filtros que se ponham. */
function consultaQueFalha(mensagem) {
  const r = { data: null, error: { message: mensagem } }
  const q = new Proxy(
    {},
    {
      get(_, chave) {
        if (chave === 'then') return (ok, ko) => Promise.resolve(r).then(ok, ko)
        if (chave === 'maybeSingle' || chave === 'single') return async () => r
        return () => q
      },
    },
  )
  return q
}

/**
 * O banco de mentira do simulador (src/simulador/banco-falso.ts), com falhas
 * de proposito: tabela que nao existe, coluna que nao existe no select.
 */
export function bancoCom(banco, { semTabela = [], semColuna = [] } = {}) {
  return {
    banco,
    linhas: (t) => banco.linhas(t),
    from(tabela) {
      if (semTabela.includes(tabela)) return consultaQueFalha(`relation "public.${tabela}" does not exist`)
      const pedido = banco.from(tabela)
      const select = pedido.select.bind(pedido)
      pedido.select = (colunas = '*') => {
        const falta = semColuna.find((c) => String(colunas).includes(c))
        return falta ? consultaQueFalha(`column ${tabela}.${falta} does not exist`) : select(colunas)
      }
      return pedido
    },
  }
}
