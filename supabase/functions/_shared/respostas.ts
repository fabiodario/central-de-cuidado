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
  /**
   * Ligado, o robo responde e passa a conversa para a equipe (16/10/2026):
   * assunto que a equipe confirma, como estacionamento ou guia do convenio.
   * Ver a migration 20261016120000_resposta_pronta_chama_a_equipe.
   */
  chamarEquipe?: boolean
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
  // Otorrino (16/10/2026, painel de pacientes simulados). "Posso tomar
  // amoxicilina pra sinusite?", "qual anti inflamatorio eu tomo? nimesulida
  // serve?" e "posso pingar otosporin no ouvido? ta saindo pus" passavam pela
  // trava e recebiam a propaganda do consultorio, que casava "sinusite",
  // "garganta" e "ouvido". O pedido de remedio e a queixa de infeccao sao
  // consulta.
  'tomo', 'pingar', 'pingo', 'inflamatorio', 'antiinflamatorio', 'antibioticos',
  'nimesulida', 'amoxicilina', 'azitromicina', 'cefalexina', 'prednisona', 'prednisolona',
  'corticoide', 'otosporin', 'descongestionante', 'antialergico', 'loratadina',
  'capsula', 'capsulas', 'comprimido', 'comprimidos', 'pomada', 'spray',
  'pus', 'secrecao', 'catarro', 'inflamada', 'inflamado', 'inflamacao', 'infeccao',
  'infeccionado', 'infeccionada', 'inchado', 'inchada', 'inchaco',
  'posso tomar', 'devo tomar', 'posso usar', 'corpo quente', 'o que eu faco', 'oq eu faco',
  'o que faco', 'o que devo fazer', 'o que pode ser', 'e perigoso',
]

/**
 * O que parece assunto clinico e nao e (16/10/2026, painel de pacientes
 * simulados). "O Dr. Fabio atende bebe? E normal levar bebe no otorrino?" caiu
 * na recusa clinica pelo "e normal", e a mae insegura ouviu "nao posso orientar
 * sobre sintomas" em vez de "sim, atende criancas". "O que eu faco pra marcar?"
 * e pergunta de secretaria.
 */
const NAO_E_CLINICO = /\be normal (levar|trazer|ir|consultar|passar|marcar|atender)\b|\b(o que|oq) (eu )?(faco|devo fazer) (pra|para) (marcar|agendar|remarcar|desmarcar|cancelar|pagar|chegar|falar)\b/g

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
// "Voces fazem audiometria?", "mas faz o exame ai ou nao?" (16/10/2026,
// painel): pergunta sobre o consultorio, que caia na recusa clinica. So com
// quem faz (voces, o dr) ou onde (ai, no consultorio): "ela faz exame de
// sangue amanha" continua sendo da saude dela.
const EXAME_NO_CONSULTORIO =
  /\b(voces|vcs|vc|voce|dr|doutor|ele|consultorio|clinica)\s+(faz|fazem|realiza|realizam)\b|\b(faz|fazem|realiza|realizam)\b.{0,30}\b(ai|aqui|no consultorio|na clinica)\b/
const NOME_DE_EXAME = /\bexames? d[eo] (sangue|fezes|urina)\b/g

/**
 * Intervalo de dose (25/10/2026, rodada 5 do painel): "so fala se pode ou nao
 * rapidinho, de 8 em 8h ta bom?", sobre o antibiotico, foi lido como horario
 * de consulta e recebeu "Tem, sim 🙂 Às 8h...", que soa como liberar o
 * remedio. "De 8 em 8h" e "3 vezes ao dia" sao dose, nunca agenda.
 */
const DOSE = /\bde \d{1,2} ?(h|hs|hr|hrs|hora|horas)? em \d{1,2} ?(h|hs|hr|hrs|hora|horas)\b|\b\d{1,2} (vezes|vez) (ao|por|no) dia\b/

/** A mensagem fala de sintoma, remédio ou queixa? */
export function assuntoClinico(texto: string): boolean {
  let limpo = normalizar(texto).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').replace(NAO_E_CLINICO, ' ')
  if (DOSE.test(limpo)) return true
  let palavras = new Set(palavrasDe(limpo))
  if (ADMINISTRATIVO.test(limpo) || EXAME_NO_CONSULTORIO.test(limpo)) {
    limpo = limpo.replace(NOME_DE_EXAME, 'exames')
    palavras = new Set(palavrasDe(limpo).filter((p) => p !== 'exame'))
  }
  // Frase pela palavra inteira (16/10/2026): pelo pedaco, "e perigoso" casava
  // dentro de "pode perigoso" e "e normal" dentro de "se normal".
  const frase = ` ${limpo.trim()} `
  return CLINICO.some((termo) =>
    termo.includes(' ') ? frase.includes(` ${termo} `) : palavras.has(termo),
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
 * As palavras DA MENSAGEM que o assunto explica. Quantas forem, sao os pontos
 * do assunto (ver acharRespostas).
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
 *
 * O contrario - a palavra da mensagem sendo o comeco da chave - so vale para
 * diferenca de ate duas letras (16/10/2026, painel de pacientes simulados):
 * plural e erro de digitacao, como "exame" para "exames" e "higienopoli" para
 * "higienopolis". Sem limite, "pessoa" casava com "pessoalmente" ("QUERO FALAR
 * COM UMA PESSOA" recebeu "Como e a consulta"), e "audio" com "audiometria"
 * ("posso mandar audio?" recebeu "O que levar").
 */
function explicadasPor(palavras: string[], daMensagem: Set<string>): Set<string> {
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
        if (palavra.startsWith(chave) || (chave.startsWith(palavra) && palavra.length >= 5 && chave.length - palavra.length <= 2)) {
          explicadas.add(palavra)
          break
        }
      }
    }
  }
  return explicadas
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
  return acharRespostas(texto, respostas, minimoDePontos, 1)[0] ?? null
}

/**
 * Ate duas respostas, quando a pergunta tem dois assuntos (16/10/2026, painel
 * de pacientes simulados).
 *
 * "Quanto tempo dura a consulta? E o retorno e cobrado a parte?" recebia so
 * "Como e a consulta", e a paciente teve de perguntar de novo. A segunda
 * resposta precisa explicar uma palavra que a primeira nao explica: dois
 * assuntos que casam com a mesma palavra ("cobre", em Cirurgia e em
 * Convenios) sao o mesmo assunto, e a segunda so repetiria a primeira.
 */
export function acharRespostas(
  texto: string,
  respostas: RespostaPronta[],
  minimoDePontos = 1,
  maximo = 2,
): RespostaPronta[] {
  if (!texto.trim() || respostas.length === 0) return []
  if (assuntoClinico(texto)) return []

  // "O quanto antes" e pressa, e nao pergunta de valor (16/10/2026): "gostaria
  // de ser atendida o quanto antes" recebeu a resposta de valores; "quanto
  // tempo dura?" e duracao. E "boa noite" e cumprimento: sem tirar, casaria com
  // "atende a noite?".
  // "Tem alguem online ai?" e quem quer saber se ha gente do outro lado, e
  // nao pergunta de consulta por video; "consulta por chamada no whatsapp" e
  // (16/10/2026, rodada 2 do painel).
  // "Qnto eh?" e "qto volta?" sao "quanto" (rodada 3 do painel): a pergunta do
  // valor da avaliacao recebeu "Como e a consulta". "Nem pelo whats?", sozinha,
  // e a consulta por video de novo.
  const daMensagem = new Set(
    palavrasDe(
      normalizar(texto)
        .replace(/\b(qnto|qnt|qto|qt)\b/g, 'quanto')
        .replace(/^\s*(e |nem |so |tambem )?(pelo|por|no) (whats|whatsapp|zap)\s*\??\s*$/g, ' videochamada ')
        .replace(/\bquanto tempo\b/g, 'tempo')
        // "Demora qto a consulta" (rodada 3 do painel) e a duracao, e nao o valor.
        .replace(/\b(demora|dura|leva) quanto\b|\bquanto (demora|dura|leva)\b/g, 'tempo dura')
        .replace(/\balguem (online|on line|on)\b/g, 'alguem')
        .replace(/\b(chamada|ligacao) (de video|no whatsapp|pelo whatsapp|por video|no zap|pelo zap)\b|\bconsulta (pelo|por|no) (whatsapp|zap|celular)\b/g, ' videochamada ')
        .replace(/\b(o )?quanto antes\b|\b(bom dia|boa tarde|boa noite)\b/g, ' '),
    ),
  )
  // Valor escrito em numero conta como pergunta de valor (09/10/2026): "400,00
  // a consulta, certo?" nao tem palavra-chave nenhuma, e a mae recebeu o menu
  // inteiro em vez dos valores - que diriam a ela que o certo era outro. "Uns
  // 300, 400?" e "uns 15 mil?" tambem (16/10/2026, rodada 2 do painel).
  if (
    /r\$\s*\d|\b\d{3}(?:[.,]00)?\s*(?:reais|a consulta|pela consulta)|\b\d{3},00\b/i.test(texto) ||
    /\b(uns|umas|tipo|mais ou menos|em torno de|cerca de|uns r\$)\s*\d{2,6}\b|\b\d{1,3}\s*mil\b/i.test(normalizar(texto))
  ) {
    daMensagem.add('valor')
  }
  if (daMensagem.size === 0) return []

  // Ordem de pontos; empate fica com a que a clinica pos primeiro.
  const pontuadas = respostas
    .map((resposta, posicao) => ({ resposta, posicao, explica: explicadasPor(resposta.palavras, daMensagem) }))
    .filter((p) => p.explica.size >= minimoDePontos)
    .sort((a, b) => b.explica.size - a.explica.size || a.posicao - b.posicao)
  const escolhidas: typeof pontuadas = []
  for (const p of pontuadas) {
    if (escolhidas.length >= maximo) break
    const jaExplicadas = new Set(escolhidas.flatMap((e) => [...e.explica]))
    if (escolhidas.length > 0 && [...p.explica].every((palavra) => jaExplicadas.has(palavra))) continue
    escolhidas.push(p)
  }
  return escolhidas.map((e) => e.resposta)
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

  // hand_off nasceu em 16/10/2026 e vem num pedido proprio: se o banco ainda nao
  // tem a coluna, o Postgres recusaria a consulta inteira, e o robo perderia
  // todas as respostas prontas em vez de so o "chamar a equipe".
  const chamaAEquipe = new Set<string>()
  try {
    const extra = await admin.from('bot_answers').select('id, hand_off').eq('clinic_id', clinicId).eq('is_active', true)
    if (extra.error) throw extra.error
    for (const linha of (extra.data ?? []) as { id: string; hand_off?: boolean | null }[]) {
      if (linha.hand_off) chamaAEquipe.add(linha.id)
    }
  } catch (erro) {
    console.warn('bot_answers sem hand_off; as respostas seguem sem chamar a equipe', erro)
  }

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
      chamarEquipe: chamaAEquipe.has(linha.id),
    }))
    .filter((r) => r.palavras.length > 0 && r.resposta.trim().length > 0)
}
