/**
 * Controle de "ja processei este aviso da Meta" que nao engole mensagem.
 *
 * O webhook grava a chave do evento (message:<id>, status:<id>:...) ANTES de
 * processar, para a Meta nao fazer o robo responder duas vezes quando manda o
 * mesmo aviso de novo. Ate 24/09/2026 havia um furo: se o processamento
 * falhava no meio (banco fora, tempo esgotado), a funcao devolvia 500, a Meta
 * reenviava - e o reenvio encontrava a chave gravada e era descartado. A
 * mensagem da familia nunca entrava no sistema, e nada avisava.
 *
 * Agora a chave do evento que estava em curso quando deu erro e apagada antes
 * do 500, e o reenvio da Meta processa de novo. So a do evento em curso: os
 * anteriores do mesmo lote terminaram, e reprocessa-los duplicaria respostas.
 *
 * O que impede resposta dobrada no reenvio e a propria mensagem gravada: se a
 * primeira tentativa chegou a salva-la, o insert do reenvio bate na chave
 * unica (23505), e o webhook para ali e acende a conversa para a equipe.
 */

type Resultado = { error: { code?: string; message?: string } | null }

export interface TabelaDeEventos {
  inserir(linha: { event_key: string; event_kind: string; payload: unknown }): PromiseLike<Resultado>
  apagar(eventKey: string): PromiseLike<Resultado>
}

export class RegistroDeEventos {
  private emCurso: string | null = null

  constructor(private readonly tabela: TabelaDeEventos) {}

  /**
   * Grava a chave. 'repetido' quando o aviso ja foi processado antes (a Meta
   * reenviou algo que deu certo); 'novo' quando e para processar.
   */
  async registrar(eventKey: string, eventKind: string, payload: unknown): Promise<'novo' | 'repetido'> {
    this.emCurso = null
    const { error } = await this.tabela.inserir({ event_key: eventKey, event_kind: eventKind, payload })
    if (error?.code === '23505') return 'repetido'
    if (error) throw error
    this.emCurso = eventKey
    return 'novo'
  }

  /** O evento em curso terminou (com sucesso ou pulado de proposito). */
  concluir() {
    this.emCurso = null
  }

  /**
   * Chamado no catch, antes do 500: libera o evento que falhou para o reenvio
   * da Meta. Nunca lanca - um erro aqui nao pode esconder o erro original.
   */
  async desfazerEmCurso(): Promise<string | null> {
    const chave = this.emCurso
    this.emCurso = null
    if (!chave) return null
    try {
      const { error } = await this.tabela.apagar(chave)
      if (error) {
        console.error('Nao consegui liberar o evento para o reenvio da Meta; a mensagem pode se perder', chave, error)
        return null
      }
      console.warn('Evento liberado para o reenvio da Meta', chave)
      return chave
    } catch (erro) {
      console.error('Nao consegui liberar o evento para o reenvio da Meta; a mensagem pode se perder', chave, erro)
      return null
    }
  }
}
