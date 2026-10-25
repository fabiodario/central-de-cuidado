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
