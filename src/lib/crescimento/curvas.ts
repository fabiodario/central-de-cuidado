import { TABELAS_OMS, type LinhaLMS } from './tabelas-oms'

/**
 * Curvas de crescimento da OMS a partir das consultas (25/09/2026).
 *
 * O peso e a altura ja eram anotados a cada consulta, e o cartao mostrava a
 * diferenca para a anterior. Mas "ganhou 300 g" nao diz se a crianca esta
 * crescendo como deveria: isso so aparece com a idade no eixo e a referencia
 * da OMS atras. Na gastro pediatrica e a pergunta de toda consulta - a curva
 * que achata e muitas vezes o primeiro sinal de doenca.
 *
 * O calculo e o metodo LMS da propria OMS: com os tres numeros de cada mes (L,
 * M, S) sai tanto a linha de referencia de cada escore-z quanto o escore-z de
 * uma medida. As faixas de classificacao sao as do Ministerio da Saude
 * (SISVAN), que sao as que o medico usa na Caderneta da Crianca.
 */

export type Indicador = 'peso' | 'altura' | 'imc'
export type Sexo = 'M' | 'F'

export const DIAS_POR_MES = 30.4375

/** Linhas de referencia desenhadas: de -3 a +3 desvios. */
export const ESCORES_Z = [-3, -2, -1, 0, 1, 2, 3] as const

export const NOME_DO_INDICADOR: Record<Indicador, string> = {
  peso: 'Peso para idade',
  altura: 'Estatura para idade',
  imc: 'IMC para idade',
}

export const UNIDADE: Record<Indicador, string> = { peso: 'kg', altura: 'cm', imc: 'kg/m²' }

export function tabela(indicador: Indicador, sexo: Sexo): readonly LinhaLMS[] {
  return TABELAS_OMS[`${indicador}_${sexo}`]
}

/** Ultima idade (em meses) que a OMS cobre para o indicador. */
export function idadeMaxima(indicador: Indicador): number {
  return indicador === 'peso' ? 120 : 228
}

/** "7,5" -> 7.5; "12 kg" -> 12; vazio ou zero -> null. */
export function numeroDaMedida(valor: string | null | undefined): number | null {
  const numero = parseFloat(String(valor ?? '').trim().replace(',', '.'))
  return Number.isFinite(numero) && numero > 0 ? numero : null
}

/** Idade em meses (com fracao) entre o nascimento e a data da medida. */
export function idadeEmMeses(nascimento: string, data: string): number | null {
  const de = Date.parse(`${nascimento.slice(0, 10)}T12:00:00Z`)
  const ate = Date.parse(`${data.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(de) || Number.isNaN(ate) || ate < de) return null
  return (ate - de) / 86_400_000 / DIAS_POR_MES
}

/** "2 a 3 m", "5 m", "10 a". Para eixo e tabela. */
export function idadeLegivel(meses: number): string {
  // Meses de 30,4 dias nao fecham o ano exato: 365 dias dao 11,99 meses, e o
  // aniversario de 1 ano aparecia como "11 m". A folga de ~1,5 dia resolve.
  const inteiros = Math.floor(meses + 0.05)
  const anos = Math.floor(inteiros / 12)
  const resto = inteiros % 12
  if (anos === 0) return `${resto} m`
  if (resto === 0) return `${anos} a`
  return `${anos} a ${resto} m`
}

/** L, M e S na idade pedida, interpolando entre os meses vizinhos. */
export function lmsNaIdade(indicador: Indicador, sexo: Sexo, meses: number): { L: number; M: number; S: number } | null {
  const linhas = tabela(indicador, sexo)
  if (!linhas || meses < 0 || meses > linhas[linhas.length - 1][0]) return null
  const antes = Math.floor(meses)
  const depois = Math.min(antes + 1, linhas.length - 1)
  const fracao = meses - antes
  const [, L0, M0, S0] = linhas[antes]
  const [, L1, M1, S1] = linhas[depois]
  return {
    L: L0 + (L1 - L0) * fracao,
    M: M0 + (M1 - M0) * fracao,
    S: S0 + (S1 - S0) * fracao,
  }
}

/** A medida que corresponde a um escore-z (a linha de referencia). */
export function valorNoEscore(L: number, M: number, S: number, z: number): number {
  if (Math.abs(L) < 1e-9) return M * Math.exp(S * z)
  return M * Math.pow(1 + L * S * z, 1 / L)
}

/** O escore-z de uma medida. */
export function escoreZ(valor: number, L: number, M: number, S: number): number {
  if (Math.abs(L) < 1e-9) return Math.log(valor / M) / S
  return (Math.pow(valor / M, L) - 1) / (L * S)
}

/**
 * Classificacao pelas faixas do Ministerio da Saude. O IMC tem faixas
 * diferentes antes e depois dos 5 anos - e a mesma divisao das duas curvas da
 * OMS.
 */
export function classificar(indicador: Indicador, z: number, meses: number): string {
  if (indicador === 'peso') {
    if (z < -3) return 'Muito baixo peso'
    if (z < -2) return 'Baixo peso'
    if (z <= 2) return 'Peso adequado'
    return 'Peso elevado'
  }
  if (indicador === 'altura') {
    if (z < -3) return 'Muito baixa estatura'
    if (z < -2) return 'Baixa estatura'
    return 'Estatura adequada'
  }
  if (z < -3) return 'Magreza acentuada'
  if (z < -2) return 'Magreza'
  if (z <= 1) return 'Eutrofia'
  if (meses < 60) {
    if (z <= 2) return 'Risco de sobrepeso'
    if (z <= 3) return 'Sobrepeso'
    return 'Obesidade'
  }
  if (z <= 2) return 'Sobrepeso'
  if (z <= 3) return 'Obesidade'
  return 'Obesidade grave'
}

/** Faixa de alerta, para a cor na tela. */
export function alerta(indicador: Indicador, z: number): 'normal' | 'atencao' | 'alerta' {
  if (z < -3 || z > 3) return 'alerta'
  if (z < -2) return 'alerta'
  if (indicador === 'altura') return 'normal'
  if (z > 2) return 'atencao'
  if (indicador === 'imc' && z > 1) return 'atencao'
  return 'normal'
}

export type MedidaDaConsulta = { data: string; peso: string; altura: string }

export type Ponto = {
  data: string
  meses: number
  valor: number
  z: number
  classificacao: string
}

/**
 * As medidas do paciente para um indicador, prontas para o grafico.
 *
 * Consulta sem a medida fica de fora; IMC precisa de peso E altura do mesmo
 * dia. Medida fora da faixa da OMS (peso depois dos 10 anos, qualquer uma
 * depois dos 19) tambem fica de fora - sem referencia, o ponto nao diz nada.
 * Duas consultas no mesmo dia valem uma vez so (a ultima da lista).
 */
export function pontosDoPaciente(
  consultas: MedidaDaConsulta[],
  nascimento: string,
  sexo: Sexo,
  indicador: Indicador,
): Ponto[] {
  const porDia = new Map<string, Ponto>()
  for (const consulta of consultas) {
    const meses = idadeEmMeses(nascimento, consulta.data)
    if (meses === null || meses > idadeMaxima(indicador)) continue
    const kg = numeroDaMedida(consulta.peso)
    const cm = numeroDaMedida(consulta.altura)
    const valor =
      indicador === 'peso' ? kg : indicador === 'altura' ? cm : kg && cm ? kg / (cm / 100) ** 2 : null
    if (valor === null) continue
    const lms = lmsNaIdade(indicador, sexo, meses)
    if (!lms) continue
    const z = escoreZ(valor, lms.L, lms.M, lms.S)
    porDia.set(consulta.data.slice(0, 10), {
      data: consulta.data.slice(0, 10),
      meses,
      valor,
      z,
      classificacao: classificar(indicador, z, meses),
    })
  }
  return [...porDia.values()].sort((a, b) => a.meses - b.meses)
}

/**
 * As linhas de referencia entre duas idades, com um ponto por mes (ou por
 * semana nos primeiros meses, onde a curva muda depressa).
 */
export function linhasDeReferencia(
  indicador: Indicador,
  sexo: Sexo,
  deMeses: number,
  ateMeses: number,
): { z: number; pontos: { meses: number; valor: number }[] }[] {
  const inicio = Math.max(0, deMeses)
  const fim = Math.min(idadeMaxima(indicador), ateMeses)
  const passo = fim - inicio <= 24 ? 0.25 : 1
  const idades: number[] = []
  for (let m = inicio; m <= fim + 1e-9; m += passo) idades.push(Math.min(m, fim))
  return ESCORES_Z.map((z) => ({
    z,
    pontos: idades.flatMap((meses) => {
      const lms = lmsNaIdade(indicador, sexo, meses)
      return lms ? [{ meses, valor: valorNoEscore(lms.L, lms.M, lms.S, z) }] : []
    }),
  }))
}

/**
 * A janela de idade do grafico: do primeiro ponto (com folga) ate um pouco
 * depois do ultimo, nunca menos de um ano de largura - com uma medida so, a
 * curva ainda precisa de contexto.
 */
export function janelaDeIdade(pontos: Ponto[], idadeAtual: number | null, indicador: Indicador): [number, number] {
  const idades = pontos.map((p) => p.meses)
  if (idadeAtual !== null) idades.push(idadeAtual)
  if (!idades.length) return [0, 24]
  let de = Math.max(0, Math.floor(Math.min(...idades)) - 3)
  let ate = Math.min(idadeMaxima(indicador), Math.ceil(Math.max(...idades)) + 6)
  if (ate - de < 12) {
    ate = Math.min(idadeMaxima(indicador), de + 12)
    de = Math.max(0, ate - 12)
  }
  return [de, ate]
}
