import type { Sexo } from '@/types/patient'

/**
 * Sugere o sexo pelo primeiro nome (vindo do sistema do Dr. Marcello em
 * 25/10/2026).
 *
 * Regra de terminacao, que da conta da maioria dos nomes brasileiros, mais uma
 * lista curta para o que a regra erraria ou nao alcancaria.
 *
 * Devolve null quando nao ha confianca, e nesse caso o campo fica em branco.
 * Chutar aqui e pior do que deixar a pessoa escolher: la, sexo entra no
 * percentil de crescimento da crianca; aqui, e dado do cadastro que a equipe
 * confere, e errado passa despercebido.
 */
const NOME_FEMININO = new Set([
  'beatriz', 'iris', 'isis', 'ester', 'esther', 'raquel', 'rachel', 'isabel', 'ingrid',
  'karen', 'karin', 'carmen', 'ruth', 'miriam', 'noemi', 'ellen', 'helen', 'nicole',
  'alice', 'denise', 'thais', 'tais', 'lais', 'ines', 'mercedes', 'jasmim', 'yasmin',
  'esther', 'lorena', 'agnes', 'sol',
])
const NOME_MASCULINO = new Set([
  'luca', 'nicola', 'noa', 'gabriel', 'rafael', 'miguel', 'daniel', 'samuel', 'ismael',
  'israel', 'joel', 'emanuel', 'manuel', 'matheus', 'mateus', 'lucas', 'nicolas', 'davi',
  'david', 'levi', 'vinicius', 'anderson', 'jefferson', 'wesley', 'kaique', 'felipe',
  'alexandre', 'andre', 'vicente', 'henrique', 'jorge', 'enzo', 'ravi', 'yuri', 'igor',
  'heitor', 'arthur', 'artur', 'benjamin', 'bernardo', 'joao', 'luiz', 'luis', 'thomas',
])

export function sexoPeloNome(nomeCompleto: string): 'F' | 'M' | null {
  const primeiro = nomeCompleto
    .trim()
    .split(/\s+/)[0]
    ?.normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
  if (!primeiro || primeiro.length < 3) return null

  if (NOME_FEMININO.has(primeiro)) return 'F'
  if (NOME_MASCULINO.has(primeiro)) return 'M'

  const fim = primeiro.at(-1)
  if (fim === 'a') return 'F'
  if (fim === 'o') return 'M'
  return null
}

/**
 * O sexo do formulario depois que alguem mexe no nome (24/10/2026).
 *
 * Ate aqui o cadastro manual abria com Feminino ja marcado. Quem nao reparava
 * no campo salvava homem como mulher (no Dr. Marcello, o painel mostrou a conta
 * inflada). Agora o campo comeca em branco e o salvar exige escolha.
 *
 * A sugestao acompanha o nome enquanto ele e digitado ou corrigido - inclusive
 * no cadastro que veio do WhatsApp com o nome do contato, quando a recepcao
 * troca pelo nome do paciente. Escolha da equipe manda: depois que alguem escolhe no
 * campo, mudar o nome nao mexe mais no sexo.
 */
export function sexoAoDigitarNome(
  nome: string,
  atual: Sexo | '',
  sugerido: boolean,
): { sexo: Sexo | ''; sugerido: boolean } {
  if (atual && !sugerido) return { sexo: atual, sugerido: false }
  const palpite = sexoPeloNome(nome)
  return palpite ? { sexo: palpite, sugerido: true } : { sexo: '', sugerido: false }
}
