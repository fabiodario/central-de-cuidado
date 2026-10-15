/**
 * O primeiro nome que da para usar numa saudacao, ou null.
 *
 * O nome do perfil do WhatsApp e escolhido pela propria pessoa e muitas vezes
 * nao e nome: emoji, ponto, "Mae do Joao", "Deus e fiel", "tudo bem". Em
 * 23/09/2026 um convite saiu como "retomar o atendimento com tudo bem". Nome de
 * cadastro (paciente) e confiavel e passa direto; o de perfil so passa se a
 * primeira palavra tiver cara de nome.
 */

// Primeiras palavras comuns em nome de perfil que nao sao nome de gente.
const NAO_E_NOME = new Set([
  'tudo', 'bem', 'oi', 'ola', 'bom', 'boa', 'dia', 'deus', 'jesus', 'fe',
  'mae', 'mamae', 'pai', 'papai', 'vovo', 'vo', 'tia', 'tio', 'familia',
  'amor', 'minha', 'meu', 'sou', 'eu', 'the', 'mrs', 'mr', 'sr', 'sra', 'dr', 'dra',
  'loja', 'consultorio', 'clinica', 'whatsapp', 'usuario', 'contato',
])

function semAcento(texto: string) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function primeiroNomeUtil(nome: string | null | undefined, doCadastro = false): string | null {
  const primeira = String(nome ?? '').trim().split(/\s+/)[0] ?? ''
  if (!primeira) return null
  if (doCadastro) return primeira.slice(0, 60)

  // So letras (com acento), hifen e apostrofo; entre 2 e 30 caracteres.
  if (!/^[\p{L}][\p{L}'’-]{1,29}$/u.test(primeira)) return null
  if (NAO_E_NOME.has(semAcento(primeira).toLowerCase())) return null

  // Perfil escrito todo em maiusculas ou minusculas vira "Maria".
  const base = primeira.toLowerCase()
  return base.charAt(0).toUpperCase() + base.slice(1)
}
