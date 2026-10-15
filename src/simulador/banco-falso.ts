/**
 * Banco em memoria para o simulador do atendimento.
 *
 * Imita o pedaco do cliente do Supabase que o robo usa (from/select/insert/
 * update/delete, os filtros e rpc). Tudo fica no navegador e some ao recarregar:
 * a demonstracao nunca encosta no banco da clinica, nem para ler. Uma consulta
 * "marcada" numa reuniao com cliente nao pode aparecer na Agenda de verdade, e
 * um paciente real nao pode aparecer na tela de um cliente.
 *
 * As colunas pedidas no select sao ignoradas (volta a linha inteira). O que o
 * robo precisa de verdade e de filtro certo e de relacao embutida, como
 * 'clinic_units(name,address)' na consulta.
 */

export type Linha = Record<string, unknown>

export type Escrita = {
  tabela: string
  tipo: 'insert' | 'update' | 'delete'
  linhas: Linha[]
  /** No update, so os campos que mudaram. */
  mudanca?: Linha
}

type Resposta = { data: unknown; error: { message: string; code?: string } | null }
type Rpc = (args: Record<string, unknown>, banco: BancoFalso) => unknown

/** Coluna que aponta para cada tabela embutida no select. */
const CHAVE_DA_RELACAO: Record<string, string> = {
  clinic_units: 'unit_id',
  patients: 'patient_id',
  clinics: 'clinic_id',
}

function comparar(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === null || a === undefined) return -1
  if (b === null || b === undefined) return 1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

export class BancoFalso {
  tabelas: Record<string, Linha[]>
  escritas: Escrita[] = []
  private rpcs: Record<string, Rpc>
  private contador = 0

  constructor(inicial: Record<string, Linha[]>, rpcs: Record<string, Rpc>) {
    this.tabelas = Object.fromEntries(Object.entries(inicial).map(([t, linhas]) => [t, linhas.map((l) => ({ ...l }))]))
    this.rpcs = rpcs
  }

  from(tabela: string) {
    return new Pedido(this, tabela)
  }

  async rpc(nome: string, args?: Record<string, unknown>): Promise<Resposta> {
    const funcao = this.rpcs[nome]
    // Funcao que o robo passou a chamar e o simulador nao conhece: falha com
    // erro, e nao com lista vazia. O robo trata o erro com o aviso de falha que
    // a familia veria, e o teste do simulador acusa - lista vazia pareceria
    // "agenda sem horario" e passaria calada.
    if (!funcao) {
      console.warn(`[simulador] o robo chamou a funcao ${nome}, que o simulador nao imita`)
      return { data: null, error: { message: `rpc ${nome} nao existe no simulador` } }
    }
    return { data: funcao(args ?? {}, this), error: null }
  }

  linhas(tabela: string): Linha[] {
    return (this.tabelas[tabela] ??= [])
  }

  novoId(tabela: string): string {
    this.contador += 1
    return `${tabela}-${this.contador}`
  }
}

class Pedido implements PromiseLike<Resposta> {
  private operacao: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private valores: Linha | Linha[] | null = null
  private filtros: ((l: Linha) => boolean)[] = []
  private ordens: { coluna: string; crescente: boolean }[] = []
  private limite: number | null = null
  private colunas = '*'
  private devolverLinhas = false
  private banco: BancoFalso
  private tabela: string

  constructor(banco: BancoFalso, tabela: string) {
    this.banco = banco
    this.tabela = tabela
  }

  select(colunas = '*') {
    if (this.operacao !== 'select') this.devolverLinhas = true
    this.colunas = colunas
    return this
  }
  insert(valores: Linha | Linha[]) {
    this.operacao = 'insert'
    this.valores = valores
    return this
  }
  update(valores: Linha) {
    this.operacao = 'update'
    this.valores = valores
    return this
  }
  delete() {
    this.operacao = 'delete'
    return this
  }

  eq(coluna: string, valor: unknown) {
    this.filtros.push((l) => l[coluna] === valor)
    return this
  }
  neq(coluna: string, valor: unknown) {
    this.filtros.push((l) => l[coluna] !== valor)
    return this
  }
  is(coluna: string, valor: unknown) {
    this.filtros.push((l) => (valor === null ? l[coluna] === null || l[coluna] === undefined : l[coluna] === valor))
    return this
  }
  in(coluna: string, valores: unknown[]) {
    this.filtros.push((l) => valores.includes(l[coluna]))
    return this
  }
  not(coluna: string, operador: string, valor: unknown) {
    if (operador === 'is' && valor === null) this.filtros.push((l) => l[coluna] !== null && l[coluna] !== undefined)
    else this.filtros.push((l) => l[coluna] !== valor)
    return this
  }
  gte(coluna: string, valor: unknown) {
    this.filtros.push((l) => comparar(l[coluna], valor) >= 0)
    return this
  }
  gt(coluna: string, valor: unknown) {
    this.filtros.push((l) => comparar(l[coluna], valor) > 0)
    return this
  }
  lte(coluna: string, valor: unknown) {
    this.filtros.push((l) => comparar(l[coluna], valor) <= 0)
    return this
  }
  lt(coluna: string, valor: unknown) {
    this.filtros.push((l) => comparar(l[coluna], valor) < 0)
    return this
  }
  order(coluna: string, opcoes?: { ascending?: boolean }) {
    this.ordens.push({ coluna, crescente: opcoes?.ascending !== false })
    return this
  }
  limit(n: number) {
    this.limite = n
    return this
  }

  async maybeSingle(): Promise<Resposta> {
    const r = await this.executar()
    return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error }
  }
  async single(): Promise<Resposta> {
    const r = await this.maybeSingle()
    if (!r.error && !r.data) return { data: null, error: { message: 'nenhuma linha', code: 'PGRST116' } }
    return r
  }

  then<A = Resposta, B = never>(
    ok?: ((r: Resposta) => A | PromiseLike<A>) | null,
    falha?: ((motivo: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return this.executar().then(ok, falha)
  }

  private escolhidas(): Linha[] {
    let linhas = this.banco.linhas(this.tabela).filter((l) => this.filtros.every((f) => f(l)))
    for (const { coluna, crescente } of [...this.ordens].reverse()) {
      linhas = [...linhas].sort((a, b) => (crescente ? 1 : -1) * comparar(a[coluna], b[coluna]))
    }
    return this.limite === null ? linhas : linhas.slice(0, this.limite)
  }

  /** Copia a linha e pendura as tabelas pedidas como relacao no select. */
  private montar(l: Linha): Linha {
    const copia: Linha = { ...l }
    for (const [relacao, chave] of Object.entries(CHAVE_DA_RELACAO)) {
      if (!this.colunas.includes(`${relacao}(`)) continue
      const alvo = this.banco.linhas(relacao).find((r) => r.id === l[chave])
      copia[relacao] = alvo ? { ...alvo } : null
    }
    return copia
  }

  private async executar(): Promise<Resposta> {
    const banco = this.banco
    if (this.operacao === 'select') {
      return { data: this.escolhidas().map((l) => this.montar(l)), error: null }
    }

    if (this.operacao === 'insert') {
      const novas = (Array.isArray(this.valores) ? this.valores : [this.valores ?? {}]).map((v) => ({
        id: banco.novoId(this.tabela),
        created_at: new Date().toISOString(),
        ...v,
      }))
      banco.linhas(this.tabela).push(...novas)
      banco.escritas.push({ tabela: this.tabela, tipo: 'insert', linhas: novas.map((l) => ({ ...l })) })
      return { data: this.devolverLinhas ? novas.map((l) => this.montar(l)) : null, error: null }
    }

    const alvo = this.escolhidas()
    if (this.operacao === 'update') {
      const mudanca = { ...(this.valores as Linha) }
      for (const l of alvo) Object.assign(l, mudanca)
      if (alvo.length) banco.escritas.push({ tabela: this.tabela, tipo: 'update', linhas: alvo.map((l) => ({ ...l })), mudanca })
      return { data: this.devolverLinhas ? alvo.map((l) => this.montar(l)) : null, error: null }
    }

    banco.tabelas[this.tabela] = banco.linhas(this.tabela).filter((l) => !alvo.includes(l))
    if (alvo.length) banco.escritas.push({ tabela: this.tabela, tipo: 'delete', linhas: alvo })
    return { data: this.devolverLinhas ? alvo : null, error: null }
  }
}
