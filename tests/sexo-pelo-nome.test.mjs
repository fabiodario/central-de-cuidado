// Sexo no cadastro manual (24/10/2026): comeca em branco, sugere pelo nome e
// nunca chuta. Ver src/lib/sexo-pelo-nome.ts.
import { buildSync } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

// Vindo do sistema do Dr. Marcello (25/10/2026). Monta o modulo na hora.
const AQUI = dirname(fileURLToPath(import.meta.url))
const saida = join(AQUI, 'sexo-pelo-nome.build.mjs')
buildSync({ entryPoints: [join(AQUI, '..', 'src/lib/sexo-pelo-nome.ts')], format: 'esm', outfile: saida, logLevel: 'warning' })
const { sexoAoDigitarNome, sexoPeloNome } = await import(`${pathToFileURL(saida).href}?v=${Date.now()}`)

let ok = 0
const falhas = []
const confere = (nome, cond) => (cond ? ok++ : falhas.push(nome))
const igual = (a, b) => a.sexo === b.sexo && a.sugerido === b.sugerido

// O defeito: o formulario abria com Feminino e quem nao reparava salvava
// homem como mulher. Sem nome, sem sexo.
confere('Formulario vazio: sexo em branco', igual(sexoAoDigitarNome('', '', false), { sexo: '', sugerido: false }))
confere('Nome curto demais ("Lu"): em branco, nada de Feminino', igual(sexoAoDigitarNome('Lu', '', false), { sexo: '', sugerido: false }))
confere('Nome sem confianca ("Kim Souza"): em branco', igual(sexoAoDigitarNome('Kim Souza', '', false), { sexo: '', sugerido: false }))

confere('"Gabriel Souza": sugere Masculino', igual(sexoAoDigitarNome('Gabriel Souza', '', false), { sexo: 'M', sugerido: true }))
confere('"Maria Clara": sugere Feminino', igual(sexoAoDigitarNome('Maria Clara', '', false), { sexo: 'F', sugerido: true }))
confere('"Joao" com acento: sugere Masculino', igual(sexoAoDigitarNome('João Pedro', '', false), { sexo: 'M', sugerido: true }))

// Pre-cadastro do WhatsApp com o nome do contato: a recepcao troca pelo do
// paciente e a sugestao acompanha.
confere('Sugestao acompanha a correcao do nome (Maria -> Pedro)', igual(sexoAoDigitarNome('Pedro Lima', 'F', true), { sexo: 'M', sugerido: true }))
confere('Sugestao antiga some quando o nome novo nao da palpite', igual(sexoAoDigitarNome('Kim Lima', 'F', true), { sexo: '', sugerido: false }))

// Escolha da equipe manda.
confere('Escolhido no campo: mudar o nome nao mexe', igual(sexoAoDigitarNome('Pedro Lima', 'F', false), { sexo: 'F', sugerido: false }))
confere('"Outro / nao informado" escolhido fica', igual(sexoAoDigitarNome('Maria', 'O', false), { sexo: 'O', sugerido: false }))

// A regra do nome em si.
confere('Lista vence a terminacao ("Beatriz", "Luca")', sexoPeloNome('Beatriz') === 'F' && sexoPeloNome('Luca') === 'M')
confere('Terminacao: "Ana" F, "Bruno" M, "Kim" null', sexoPeloNome('Ana') === 'F' && sexoPeloNome('Bruno') === 'M' && sexoPeloNome('Kim') === null)

if (falhas.length) {
  console.error(`sexo-pelo-nome: ${falhas.length} falha(s):\n - ${falhas.join('\n - ')}`)
  process.exit(1)
}
console.log(`sexo-pelo-nome: ${ok} verificacoes ok`)
