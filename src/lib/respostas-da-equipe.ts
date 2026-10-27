/**
 * Quais respostas prontas aparecem na lista "Resposta pronta..." da conversa
 * (23/10/2026, vindo do sistema do Dr. Marcello em 25/10/2026).
 *
 * Ate ali a lista mostrava so as ligadas. Ligada e a que o robo usa sozinho
 * quando acha uma palavra-chave; o Edu queria um texto so para a equipe
 * escolher (la, uma apresentacao do medico para quem some depois de saber que
 * nao tem convenio), e ligar esse texto faria o robo manda-lo para quem
 * escrevesse "convenio". Agora as desligadas tambem aparecem, marcadas "(so
 * equipe)": o robo nunca as envia (carregarRespostas filtra is_active), a
 * equipe escolhe.
 */
export type RespostaDaLista = { id: string; assunto: string; resposta: string; ativa: boolean }

export type OpcaoDaEquipe<T extends RespostaDaLista> = T & { rotulo: string }

export function respostasDaEquipe<T extends RespostaDaLista>(lista: T[]): OpcaoDaEquipe<T>[] {
  return lista
    .filter((p) => p.resposta.trim())
    .map((p) => ({ ...p, rotulo: p.ativa ? p.assunto : `${p.assunto} (só equipe)` }))
}

/**
 * A mensagem que a equipe vai mandar e uma resposta pronta, sem mudanca?
 * (26/10/2026, vindo do sistema do Dr. Marcello no mesmo dia)
 *
 * La, o Edu mandou a apresentacao do medico pela Central para quatro
 * familias. O texto termina com "se quiser, te mostro os proximos horarios
 * livres. E so me responder aqui", mas saiu marcado como escrito pela equipe,
 * e a regra das 12h calou o robo: uma familia respondeu "Oi quero marcar" e
 * ficou 18 minutos sem nada, ate alguem mandar os horarios a mao.
 *
 * Resposta pronta enviada como esta nao segura o robo: sao os mesmos textos
 * informativos que ele usa (valor, convenio, endereco) ou a apresentacao do
 * medico, que chama o paciente de volta para ele. O que a equipe digita - ou
 * muda no texto pronto - continua segurando, porque ai e conversa de gente.
 * Espacos e quebras de linha nao contam como mudanca.
 */
export function ehRespostaProntaSemMudanca(enviado: string, prontasColocadas: readonly string[]): boolean {
  const limpar = (t: string) => t.replace(/\s+/g, ' ').trim()
  const alvo = limpar(enviado)
  return Boolean(alvo) && prontasColocadas.some((p) => limpar(p) === alvo)
}
