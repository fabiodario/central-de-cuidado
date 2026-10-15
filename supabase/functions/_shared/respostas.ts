/**
 * Respostas prontas: casar a pergunta escrita com o assunto certo.
 *
 * A clínica cadastra assuntos ("Valor e pagamento") com as palavras que os
 * identificam ("valor", "quanto", "pix"). Quando chega uma mensagem que não é
 * resposta a nada que o robô perguntou, procuramos aqui antes de devolver o
 * menu. Se alguma linha bate, o robô responde o texto escrito pela clínica,
 * palavra por palavra. Se nenhuma bate, tudo segue como antes.
 *
 * Duas decisões que valem explicação:
 *
 * 1. Nada de adivinhação. A busca é por palavra, não por semelhança nem por
 *    modelo de linguagem. Um assunto só ganha se as palavras dele aparecerem
 *    escritas. É a diferença entre "não sei responder" - que é honesto, e cai
 *    no menu - e uma resposta errada dita com segurança, que numa clínica
 *    custa caro.
 *
 * 2. Assunto clínico nunca é respondido. Sintoma, remédio, dose, febre: mesmo
 *    que alguém cadastre um assunto assim sem querer, a trava abaixo desliga a
 *    busca inteira e a conversa segue para o menu e para a equipe. Isso é
 *    consulta médica, e consulta médica não se responde por robô.
 */

export type RespostaPronta = {
  id: string
  assunto: string
  palavras: string[]
  resposta: string
  /**
   * Ligado, a resposta e a pergunta "Santos, Sao Paulo ou Telemedicina?", e o
   * texto que vale e o de informacoes do lugar escolhido. Serve para o que
   * muda de unidade para unidade - o valor, principalmente.
   */
  perguntarUnidade: boolean
}

/** Tira acento e caixa: "Convênio" e "convenio" viram a mesma coisa. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** As palavras da mensagem, sem pontuação. */
function palavrasDe(texto: string): string[] {
  return normalizar(texto)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length > 0)
}

/**
 * O que o robô não responde nem que esteja cadastrado.
 *
 * Lista curta e grosseira de propósito: ela não precisa acertar o que a pessoa
 * quis dizer, só precisa reconhecer que o assunto é de médico. Errar para o
 * lado de calar a boca aqui não custa nada - a mensagem cai no menu e a família
 * fala com a equipe, que é o certo para uma dúvida clínica.
 */
const CLINICO = [
  'dor', 'dores', 'doi', 'doendo', 'febre', 'febril', 'temperatura',
  'remedio', 'remedios', 'medicamento', 'medicamentos', 'dose', 'doses',
  'dipirona', 'paracetamol', 'ibuprofeno', 'antibiotico', 'xarope', 'gotas',
  'vomito', 'vomitos', 'vomitando', 'vomitou', 'diarreia', 'sangue',
  'sangrando', 'fezes', 'coco', 'prisao', 'refluxo', 'golfando', 'golfa',
  'alergia', 'alergica', 'alergico', 'emagreceu', 'engasgo', 'engasgou',
  'internado', 'internar', 'urgencia', 'emergencia', 'grave', 'piorou',
  'sintoma', 'sintomas', 'tratamento', 'exame', 'resultado', 'receita',
  'posso dar', 'pode tomar', 'e normal',
]

/**
 * Exame como papel, e nao como saude (15/10/2026).
 *
 * "O dr consegue solicitar os exames pela Unimed?" e pergunta de secretaria:
 * quem pede, quem autoriza, quem paga. Com "exame" na lista de cima, o
 * singular ("o dr pede exame pelo convenio?") virava assunto medico e a mae
 * ouvia "nao posso orientar sobre exames". Em frase de convenio, plano, guia,
 * pedido ou autorizacao, o exame e o nome do papel - "exame de sangue"
 * inclusive. O RESULTADO continua de medico, e qualquer outra palavra da lista
 * (dor, febre, remedio) continua valendo.
 */
const ADMINISTRATIVO =
  /\b(convenios?|planos?|unimed|amil|bradesco|sulamerica|hapvida|notredame|seguradora|cobre|cobertura|coberto|autoriza\w*|guias?|pedidos?|solicit\w*|pede|pedir|reembolso)\b/
const NOME_DE_EXAME = /\bexames? d[eo] (sangue|fezes|urina)\b/g

/** A mensagem fala de sintoma, remédio ou queixa? */
export function assuntoClinico(texto: string): boolean {
  let limpo = normalizar(texto)
  let palavras = new Set(palavrasDe(texto))
  if (ADMINISTRATIVO.test(limpo)) {
    limpo = limpo.replace(NOME_DE_EXAME, 'exames')
    palavras = new Set(palavrasDe(limpo).filter((p) => p !== 'exame'))
  }
  return CLINICO.some((termo) =>
    termo.includes(' ') ? limpo.includes(termo) : palavras.has(termo),
  )
}

/**
 * Medicamento que a 2ª via automática não alcança.
 *
 * Controlado da Portaria 344 não se resolve por WhatsApp. A receita sai em
 * receituário próprio - notificação amarela, azul ou branca em duas vias -, a
 * farmácia RETÉM a via original e o número dela é escriturado. Reenviar um PDF
 * não substitui papel que ficou no balcão, e prometer isso ao pai faria a
 * família voltar na farmácia para ouvir não.
 *
 * A lista é curta e grosseira, como a de assunto clínico, e pelo mesmo motivo:
 * errar para o lado de chamar a equipe não custa nada. Quem cai aqui por engano
 * fala com gente; quem passaria batido receberia uma promessa que a lei não
 * deixa cumprir.
 *
 * O que está aqui: o que uma criança em acompanhamento gastro pode estar
 * usando por outro médico - neuro, psiquiatria, dor - e chegar pedindo 2ª via
 * por ser o WhatsApp que ela tem na mão.
 */
const CONTROLADO = [
  // Como a família costuma dizer, sem saber o nome da regra.
  'controlado', 'controlada', 'controlados', 'tarja', 'preta', 'azul', 'amarela',
  'notificacao', 'especial', 'retencao', 'reteve', 'retido',
  // Psicotrópicos e afins.
  'ritalina', 'metilfenidato', 'concerta', 'venvanse', 'lisdexanfetamina',
  'rivotril', 'clonazepam', 'diazepam', 'valium', 'bromazepam', 'lexotan',
  'alprazolam', 'frontal', 'fenobarbital', 'gardenal', 'fenitoina',
  'carbamazepina', 'tegretol', 'depakene', 'valproato', 'topiramato',
  'risperidona', 'risperdal', 'quetiapina', 'aripiprazol', 'haloperidol',
  'fluoxetina', 'sertralina', 'escitalopram', 'amitriptilina', 'imipramina',
  // Opioides e derivados.
  'codeina', 'tramadol', 'morfina', 'metadona', 'petidina', 'tylex',
  'clonidina', 'melatonina',
]

/**
 * A pessoa está pedindo 2ª via de algo que exige receituário especial?
 *
 * Só olha para o nome que ela escreveu. Não tenta ler prontuário: a 2ª via é
 * pedida por quem pode não ser paciente do Dr. Marcello para aquele remédio, e
 * a pergunta aqui é sobre a receita, não sobre o tratamento.
 */
export function medicamentoControlado(texto: string): boolean {
  const palavras = new Set(palavrasDe(texto))
  return CONTROLADO.some((termo) => palavras.has(termo))
}

/**
 * Quantas palavras DA MENSAGEM o assunto explica.
 *
 * Palavra com cinco letras ou mais também vale por começo ("convenio" acha
 * "convenios", "conveniada"). Abaixo disso a comparação é exata: "fica" não
 * pode casar com "ficar", "ficha", "ficou".
 *
 * Conta a palavra da mensagem uma vez só (15/10/2026). Antes contava a chave:
 * o assunto Convenios tem "convenio", "convênio", "convenios" e "convênios", e
 * um "convenio" escrito valia quatro pontos - mais que "pedido" + "exames" +
 * "convenio" de um assunto mais certeiro. Ganhar por ter cadastrado mais
 * grafias da mesma palavra nao e entender melhor a pergunta.
 */
function pontos(palavras: string[], daMensagem: Set<string>): number {
  const explicadas = new Set<string>()
  for (const bruta of palavras) {
    const chave = normalizar(bruta).trim()
    if (!chave) continue
    if (daMensagem.has(chave)) {
      explicadas.add(chave)
      continue
    }
    if (chave.length >= 5) {
      for (const palavra of daMensagem) {
        if (palavra.startsWith(chave) || (chave.startsWith(palavra) && palavra.length >= 5)) {
          explicadas.add(palavra)
          break
        }
      }
    }
  }
  return explicadas.size
}

/**
 * O assunto que melhor explica a mensagem, ou nada.
 *
 * As respostas chegam na ordem de exibição, então empate de pontuação fica com
 * a que a clínica colocou primeiro - que é o que ela considera mais provável.
 */
/**
 * A resposta pronta que melhor casa com a mensagem.
 *
 * `minimoDePontos` e quantas palavras do assunto precisam aparecer. Uma basta
 * na conversa comum: quem escreve "convenio?" quer a resposta de convenio.
 *
 * Na fila da equipe o robo pede duas, e a diferenca importa. "Quero marcar
 * retorno para o Matheus" casa com UMA palavra ("retorno", do assunto de
 * documentos) e nao e pergunta nenhuma - responder ali seria falar do que
 * ninguem perguntou. Ja "ele aceita AMIL? Qual o valor da consulta particular e
 * as formas de pagamento?" casa com quatro, e e exatamente a duvida que a
 * clinica responde vinte vezes por dia. Duas palavras separam as duas coisas.
 */
export function acharResposta(
  texto: string,
  respostas: RespostaPronta[],
  minimoDePontos = 1,
): RespostaPronta | null {
  if (!texto.trim() || respostas.length === 0) return null
  if (assuntoClinico(texto)) return null

  const daMensagem = new Set(palavrasDe(texto))
  // Valor escrito em numero conta como pergunta de valor (09/10/2026): "400,00
  // a consulta, certo?" nao tem palavra-chave nenhuma, e a mae recebeu o menu
  // inteiro em vez dos valores - que diriam a ela que o certo era outro.
  if (/r\$\s*\d|\b\d{3}(?:[.,]00)?\s*(?:reais|a consulta|pela consulta)|\b\d{3},00\b/i.test(texto)) {
    daMensagem.add('valor')
  }
  if (daMensagem.size === 0) return null

  let melhor: RespostaPronta | null = null
  let melhorPonto = 0
  for (const resposta of respostas) {
    const ponto = pontos(resposta.palavras, daMensagem)
    if (ponto > melhorPonto) {
      melhor = resposta
      melhorPonto = ponto
    }
  }
  return melhorPonto >= minimoDePontos ? melhor : null
}

type Admin = {
  from: (table: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** As respostas ligadas desta clínica, na ordem que a equipe definiu. */
export async function carregarRespostas(
  admin: Admin,
  clinicId: string,
): Promise<RespostaPronta[]> {
  const { data, error } = await admin
    .from('bot_answers')
    .select('id, subject, keywords, answer, ask_unit')
    .eq('clinic_id', clinicId)
    .eq('is_active', true)
    .order('position', { ascending: true })

  if (error || !data) return []
  return (data as {
    id: string
    subject: string
    keywords: string[] | null
    answer: string
    ask_unit?: boolean | null
  }[])
    .map((linha) => ({
      id: linha.id,
      assunto: linha.subject,
      palavras: linha.keywords ?? [],
      resposta: linha.answer,
      perguntarUnidade: Boolean(linha.ask_unit),
    }))
    .filter((r) => r.palavras.length > 0 && r.resposta.trim().length > 0)
}
