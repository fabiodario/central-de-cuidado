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
 * Tempo esgotado (23/10/2026): o furo voltou por outra porta, no sistema do
 * Dr. Marcello. Uma mae respondeu "sexta, 30/10" as 10:01 com o Supabase instavel; a primeira
 * tentativa caiu ("Bad Gateway") e liberou a chave, como devia. O reenvio da
 * Meta ficou lento e a PLATAFORMA derrubou a funcao (504 as 10:03:39) - e
 * funcao derrubada nao chega ao catch. A chave ficou gravada, os reenvios das
 * 10:04 e 10:06 foram descartados como repetidos, e a familia ficou sem
 * resposta sem nada avisar. Por isso a chave agora so vale como "feito" depois
 * de concluir() gravar concluded_at. Chave sem conclusao e mais velha que
 * ABANDONO_MS e de uma execucao que morreu: o reenvio a retoma.
 *
 * O que impede resposta dobrada no reenvio e a propria mensagem gravada: se a
 * primeira tentativa chegou a salva-la, o insert do reenvio bate na chave
 * unica (23505), e o webhook para ali e acende a conversa para a equipe.
 */

type Resultado = { error: { code?: string; message?: string } | null }

/**
 * Mais que o tempo maximo de uma Edge Function (150 s no plano atual). Antes
 * disso a execucao original pode estar viva e ainda responder.
 */
export const ABANDONO_MS = 3 * 60 * 1000

export interface TabelaDeEventos {
  inserir(linha: { event_key: string; event_kind: string; payload: unknown }): PromiseLike<Resultado>
  apagar(eventKey: string): PromiseLike<Resultado>
  /** Grava concluded_at. Opcional: sem ele, vale o comportamento antigo. */
  concluir?(eventKey: string): PromiseLike<Resultado>
  /**
   * Retoma o evento se ninguem o concluiu e ele foi gravado antes de
   * `gravadoAntesDe` (UPDATE condicional: so um reenvio ganha). Devolve as
   * linhas tomadas.
   */
  retomar?(eventKey: string, gravadoAntesDe: string): PromiseLike<{ data: unknown[] | null; error: Resultado['error'] }>
}

export class RegistroDeEventos {
  private emCurso: string | null = null

  constructor(
    private readonly tabela: TabelaDeEventos,
    private readonly agora: () => Date = () => new Date(),
  ) {}

  /**
   * Grava a chave. 'repetido' quando o aviso ja foi processado antes (a Meta
   * reenviou algo que deu certo) ou ainda esta em curso em outra execucao;
   * 'novo' quando e para processar - inclusive o abandonado por tempo esgotado.
   */
  async registrar(eventKey: string, eventKind: string, payload: unknown): Promise<'novo' | 'repetido'> {
    this.emCurso = null
    const { error } = await this.tabela.inserir({ event_key: eventKey, event_kind: eventKind, payload })
    if (error?.code === '23505') {
      if (!this.tabela.retomar) return 'repetido'
      try {
        const corte = new Date(this.agora().getTime() - ABANDONO_MS).toISOString()
        const { data, error: erroRetomada } = await this.tabela.retomar(eventKey, corte)
        if (erroRetomada) throw erroRetomada
        if (!data?.length) return 'repetido'
        console.warn('Evento abandonado (execucao derrubada?) retomado no reenvio da Meta', eventKey)
        this.emCurso = eventKey
        return 'novo'
      } catch (erro) {
        console.warn('Nao consegui conferir se o evento repetido foi abandonado; descartado como antes', eventKey, erro)
        return 'repetido'
      }
    }
    if (error) throw error
    this.emCurso = eventKey
    return 'novo'
  }

  /**
   * O evento em curso terminou (com sucesso ou pulado de proposito): grava a
   * conclusao. Nunca lanca - falhar aqui so deixa o evento retomavel, e o
   * reenvio que o retomasse bateria na mensagem ja gravada (ver acima).
   */
  async concluir(): Promise<void> {
    const chave = this.emCurso
    this.emCurso = null
    if (!chave || !this.tabela.concluir) return
    try {
      const { error } = await this.tabela.concluir(chave)
      if (error) console.warn('Nao gravei a conclusao do evento', chave, error)
    } catch (erro) {
      console.warn('Nao gravei a conclusao do evento', chave, erro)
    }
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
