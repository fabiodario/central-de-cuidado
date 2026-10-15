/**
 * Campos que se trocam sozinhos nos textos do robo (14/10/2026).
 *
 * Ate aqui o valor e o endereco eram escritos a mao em cada texto: o da
 * unidade, a resposta pronta "Valor e pagamento", o fecho do menu, o perfil do
 * WhatsApp. Quando Sao Paulo passou de R$ 550 para R$ 600 (28/09) foi preciso
 * uma migration cacando "R$ 550,00" em tres tabelas, e o andar da Livance foi
 * do mesmo jeito. Esquecer um lugar e a familia receber dois precos diferentes.
 *
 * Agora o valor e o endereco moram na unidade, e o texto diz {valor}. O robo
 * troca na hora de ENVIAR, e nao na hora de salvar: mudou no cartao da
 * unidade, mudou em toda mensagem que sai depois disso.
 *
 * Arquivo puro, sem Deno nem banco: o robo (atendimento.ts) e a tela (cartao da
 * unidade, respostas prontas) usam a mesma regra, e o teste roda no Node.
 */

export type Lugar = {
  id: string
  nome: string
  /** Vazio na telemedicina. */
  endereco: string
  /** Em centavos. Nulo enquanto a equipe nao preencheu. */
  valorCentavos: number | null
  telemedicina?: boolean
}

/** Onde o texto vive. Decide quais campos fazem sentido nele. */
export type Onde = 'unidade' | 'telemedicina' | 'geral'

export type NomeDoCampo = 'valor' | 'endereco' | 'unidade' | 'valores' | 'enderecos'

export const CAMPOS: { nome: NomeDoCampo; ajuda: string; onde: Onde[] }[] = [
  { nome: 'valor', ajuda: 'O valor da consulta deste atendimento', onde: ['unidade', 'telemedicina'] },
  { nome: 'endereco', ajuda: 'O endereço desta unidade', onde: ['unidade'] },
  { nome: 'unidade', ajuda: 'O nome desta unidade', onde: ['unidade', 'telemedicina'] },
  { nome: 'valores', ajuda: 'A lista com o valor de cada atendimento', onde: ['unidade', 'telemedicina', 'geral'] },
  { nome: 'enderecos', ajuda: 'A lista com o endereço de cada unidade', onde: ['unidade', 'telemedicina', 'geral'] },
]

const NOMES = new Set<string>(CAMPOS.map((c) => c.nome))

// Chave com letras, acento opcional e espaco nas bordas: "{ endereço }" vale.
// So letras de proposito - "{nome}" das saudacoes tambem casa aqui, mas nao e
// nosso e passa intacto (ver chave()).
const CHAVE = /\{\s*([A-Za-z\u00c0-\u00ff]+)\s*\}/g

function semAcento(texto: string) {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

/** O nome do campo, ou null quando a chave nao e de campo nenhum desta lista. */
function chave(bruta: string): NomeDoCampo | null {
  const nome = semAcento(bruta)
  return NOMES.has(nome) ? (nome as NomeDoCampo) : null
}

/** Ha algum campo nosso no texto? Barato: o robo so le o banco quando ha. */
export function temCampo(texto: string): boolean {
  for (const m of texto.matchAll(CHAVE)) if (chave(m[1])) return true
  return false
}

/**
 * "R$ 1.200,00". Feito a mao, e nao com toLocaleString: o Deno da Edge e o
 * navegador nao garantem o mesmo ICU, e o espaco tem de ser o comum - em
 * 14/09 um "R$ 450" gravado com espaco duro escapou de um like '%R$ 450%'.
 */
export function formatarValor(centavos: number): string {
  const reais = Math.floor(centavos / 100)
  const resto = String(centavos % 100).padStart(2, '0')
  const milhar = String(reais).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `R$ ${milhar},${resto}`
}

/** Teto de R$ 100.000: acima disso e erro de digitacao, nao consulta. */
const TETO = 100_000_00

/**
 * O valor digitado na tela, em centavos. Nulo quando nao da para ter certeza.
 *
 * Aceita "600", "600,00", "R$ 600,00", "1.200,50" e "600.00". Ponto seguido de
 * exatamente dois digitos no fim e centavo; senao e milhar. Na duvida, nulo: o
 * cartao recusa salvar, e a familia nao recebe um preco cem vezes maior.
 */
export function lerValor(digitado: string): number | null {
  const limpo = digitado.replace(/r\$/gi, '').replace(/\s/g, '')
  if (!/^\d[\d.,]*$/.test(limpo)) return null
  let normal: string
  if (limpo.includes(',')) {
    if ((limpo.match(/,/g) ?? []).length > 1) return null
    const [inteiro, decimal] = limpo.split(',')
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(inteiro) || !/^\d{1,2}$/.test(decimal)) return null
    normal = `${inteiro.replace(/\./g, '')}.${decimal}`
  } else if (/^\d+\.\d{2}$/.test(limpo)) {
    normal = limpo
  } else if (/^\d{1,3}(\.\d{3})+$|^\d+$/.test(limpo)) {
    normal = limpo.replace(/\./g, '')
  } else {
    return null
  }
  const centavos = Math.round(Number(normal) * 100)
  if (!Number.isFinite(centavos) || centavos <= 0 || centavos > TETO) return null
  return centavos
}

/**
 * O valor do cartao da unidade, ou a frase que explica por que nao serve.
 *
 * Piso de R$ 10: "1.20" e um valor valido para lerValor, mas como preco de
 * consulta e engano de digitacao - e e esse o numero que o robo mandaria.
 */
export function valorDaConsulta(digitado: string): { centavos: number } | { erro: string } {
  if (!digitado.trim()) return { erro: 'Preencha o valor da consulta.' }
  const centavos = lerValor(digitado)
  if (centavos === null) return { erro: 'Não entendi o valor. Escreva assim: 600 ou 600,00.' }
  if (centavos < 10_00) return { erro: 'Valor abaixo de R$ 10,00: confira se digitou certo.' }
  return { centavos }
}

function listaDeValores(lugares: Lugar[]) {
  const com = lugares.filter((l) => l.valorCentavos)
  return {
    texto: com.map((l) => `• ${l.nome}: ${formatarValor(l.valorCentavos as number)}`).join('\n'),
    sem: lugares.filter((l) => !l.valorCentavos).map((l) => `valor de ${l.nome}`),
  }
}

function listaDeEnderecos(lugares: Lugar[]) {
  const fisicos = lugares.filter((l) => !l.telemedicina)
  return {
    texto: fisicos
      .filter((l) => l.endereco.trim())
      .map((l) => `• ${l.nome}: ${l.endereco.trim()}`)
      .join('\n'),
    sem: fisicos.filter((l) => !l.endereco.trim()).map((l) => `endereço de ${l.nome}`),
  }
}

/**
 * Troca os campos do texto pelos dados de agora.
 *
 * `lugar` e o atendimento de que o texto fala (o texto da unidade, ou o fecho
 * que vai colado nele); nulo num texto geral, como a resposta pronta.
 *
 * O que nao der para preencher NAO sai cru: a linha inteira com o campo cai, e
 * o motivo volta em `faltando` para quem chamou registrar e avisar. Uma linha a
 * menos e ruim; "{valor}" na tela de uma mae e pior, e um preco inventado e
 * pior ainda. A tela do cartao impede salvar nesse estado; isto e a rede de
 * baixo, para coluna que ainda nao chegou ou unidade arquivada.
 */
export function preencherCampos(
  texto: string,
  lugar: Lugar | null,
  lugares: Lugar[],
): { texto: string; faltando: string[] } {
  if (!temCampo(texto)) return { texto, faltando: [] }
  const faltando: string[] = []
  const valores = listaDeValores(lugares)
  const enderecos = listaDeEnderecos(lugares)

  const valorDe = (nome: NomeDoCampo): string | null => {
    switch (nome) {
      case 'valor':
        return lugar?.valorCentavos ? formatarValor(lugar.valorCentavos) : null
      case 'endereco':
        return lugar && !lugar.telemedicina && lugar.endereco.trim() ? lugar.endereco.trim() : null
      case 'unidade':
        return lugar?.nome.trim() || null
      case 'valores':
        // Lista incompleta ainda serve (mostra quem tem valor), mas avisa.
        faltando.push(...valores.sem)
        return valores.texto || null
      case 'enderecos':
        faltando.push(...enderecos.sem)
        return enderecos.texto || null
    }
  }

  const linhas = texto.split('\n').flatMap((linha) => {
    let caiu = false
    const pronta = linha.replace(CHAVE, (inteira, bruta: string) => {
      const nome = chave(bruta)
      if (!nome) return inteira
      const valor = valorDe(nome)
      if (valor === null) {
        caiu = true
        faltando.push(lugar ? `${nome} de ${lugar.nome}` : `${nome} (texto sem unidade)`)
        return ''
      }
      return valor
    })
    return caiu ? [] : [pronta]
  })

  return {
    // Linha que caiu no meio deixaria buraco de tres quebras.
    texto: linhas.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    faltando: [...new Set(faltando)],
  }
}

/**
 * O que impede salvar este texto, em frases para a equipe ler.
 *
 * Vazio = pode salvar. `lugar` e o estado do cartao NA TELA (o que vai ser
 * salvo junto), e nao o do banco: quem preenche o valor e usa {valor} no mesmo
 * clique precisa poder salvar.
 */
export function problemasDoTexto(
  texto: string,
  onde: Onde,
  lugar: Lugar | null,
  lugares: Lugar[],
): string[] {
  const problemas: string[] = []
  for (const m of texto.matchAll(CHAVE)) {
    const nome = chave(m[1])
    if (!nome) {
      problemas.push(
        `"${m[0]}" não é um campo conhecido. Os campos são: ${CAMPOS.filter((c) => c.onde.includes(onde))
          .map((c) => `{${c.nome}}`)
          .join(', ')}.`,
      )
      continue
    }
    const campo = CAMPOS.find((c) => c.nome === nome)
    if (!campo?.onde.includes(onde)) {
      problemas.push(
        onde === 'telemedicina'
          ? `A telemedicina não tem endereço: tire o ${m[0]}.`
          : `${m[0]} precisa de uma unidade, e este texto vale para todas. Use {valores} ou {enderecos}, que listam cada uma.`,
      )
      continue
    }
    if (nome === 'valor' && !lugar?.valorCentavos) problemas.push('Preencha o valor para usar {valor}.')
    if (nome === 'endereco' && !lugar?.endereco.trim()) problemas.push('Preencha o endereço para usar {endereco}.')
    if (nome === 'valores') {
      const sem = listaDeValores(lugares).sem
      if (sem.length) problemas.push(`Falta o ${sem.join(', ')} para montar {valores}.`)
    }
    if (nome === 'enderecos') {
      const sem = listaDeEnderecos(lugares).sem
      if (sem.length) problemas.push(`Falta o ${sem.join(', ')} para montar {enderecos}.`)
    }
  }
  return [...new Set(problemas)]
}

/**
 * Valores escritos a mao no texto ("R$ 550,00"), em centavos.
 *
 * Nao bloqueia: um texto pode citar outra quantia de proposito (taxa de
 * relatorio). Serve para a tela avisar - e oferecer a troca por {valor} - quando
 * o texto diz um preco e o cartao diz outro, que e exatamente o erro de 28/09.
 */
// Termina em digito: o ponto final de "custa R$ 600." nao faz parte do valor.
const ESCRITO = /R\$[\s\u00a0]*\d(?:[\d.]*\d)?(?:,\d{1,2})?/gi

export function valoresEscritos(texto: string): { trecho: string; centavos: number | null }[] {
  return [...texto.matchAll(ESCRITO)].map((m) => ({
    trecho: m[0],
    centavos: lerValor(m[0].replace(/\u00a0/g, ' ')),
  }))
}

/** Troca por {valor} cada "R$ ..." do texto que e igual ao valor do cartao. */
export function trocarPorCampo(texto: string, centavos: number): string {
  return texto.replace(ESCRITO, (trecho) =>
    lerValor(trecho.replace(/\u00a0/g, ' ')) === centavos ? '{valor}' : trecho,
  )
}
