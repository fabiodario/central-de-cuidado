import { useMemo, useState } from 'react'
import { LineChart } from 'lucide-react'
import {
  alerta,
  idadeEmMeses,
  idadeLegivel,
  idadeMaxima,
  janelaDeIdade,
  linhasDeReferencia,
  NOME_DO_INDICADOR,
  pontosDoPaciente,
  UNIDADE,
  type Indicador,
  type MedidaDaConsulta,
  type Sexo,
} from '@/lib/crescimento/curvas'
import { fmtBR, todayISO } from '@/lib/followup'

/**
 * Curva de crescimento do paciente sobre a referencia da OMS (25/09/2026).
 *
 * Desenho proprio em SVG, sem biblioteca de grafico: sao sete linhas e alguns
 * pontos, e assim o desenho imprime e escala igual em qualquer tela. As faixas
 * seguem a Caderneta da Crianca - verde entre -2 e +2, amarelo ate +-3.
 */

const LARGURA = 640
const ALTURA = 330
const MARGEM = { esquerda: 46, direita: 44, topo: 14, baixo: 34 }

const COR_DA_LINHA: Record<number, { cor: string; largura: number; traco?: string }> = {
  [-3]: { cor: '#b42318', largura: 1 },
  [-2]: { cor: '#b54708', largura: 1.2 },
  [-1]: { cor: '#94a3b8', largura: 0.8, traco: '3 3' },
  0: { cor: '#1c6b3a', largura: 1.6 },
  1: { cor: '#94a3b8', largura: 0.8, traco: '3 3' },
  2: { cor: '#b54708', largura: 1.2 },
  3: { cor: '#b42318', largura: 1 },
}

const COR_DO_PONTO = { normal: '#1f4f78', atencao: '#b54708', alerta: '#b42318' }

function passoBonito(amplitude: number, alvo: number) {
  const bruto = amplitude / alvo
  const potencia = Math.pow(10, Math.floor(Math.log10(bruto)))
  const n = bruto / potencia
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * potencia
}

function passoDaIdade(amplitudeEmMeses: number) {
  if (amplitudeEmMeses <= 12) return 1
  if (amplitudeEmMeses <= 30) return 3
  if (amplitudeEmMeses <= 72) return 6
  if (amplitudeEmMeses <= 144) return 12
  return 24
}

function numeroBR(valor: number, casas = 1) {
  return valor.toFixed(casas).replace('.', ',')
}

export function CurvaDeCrescimento({
  nascimento,
  sexo,
  consultas,
}: {
  nascimento: string
  sexo: 'M' | 'F' | 'O'
  consultas: MedidaDaConsulta[]
}) {
  const [indicador, setIndicador] = useState<Indicador>('peso')
  // "Outro" no cadastro nao tem curva da OMS: o medico escolhe qual usar, e a
  // escolha fica so nesta tela.
  const [sexoEscolhido, setSexoEscolhido] = useState<Sexo>(sexo === 'F' ? 'F' : 'M')
  const sexoDaCurva: Sexo = sexo === 'O' ? sexoEscolhido : sexo

  const idadeAtual = nascimento ? idadeEmMeses(nascimento, todayISO()) : null

  const pontos = useMemo(
    () => (nascimento ? pontosDoPaciente(consultas, nascimento, sexoDaCurva, indicador) : []),
    [consultas, nascimento, sexoDaCurva, indicador],
  )

  if (!nascimento) {
    return (
      <Vazio texto="Cadastre a data de nascimento do paciente para ver a curva de crescimento." />
    )
  }

  const foraDaFaixa = idadeAtual !== null && idadeAtual > idadeMaxima(indicador)
  const [de, ate] = janelaDeIdade(
    pontos,
    idadeAtual !== null && idadeAtual <= idadeMaxima(indicador) ? idadeAtual : null,
    indicador,
  )
  const linhas = linhasDeReferencia(indicador, sexoDaCurva, de, ate)

  const valores = [
    ...linhas.flatMap((l) => (l.z === -3 || l.z === 3 ? l.pontos.map((p) => p.valor) : [])),
    ...pontos.map((p) => p.valor),
  ]
  const minimoBruto = Math.min(...valores)
  const maximoBruto = Math.max(...valores)
  const folga = (maximoBruto - minimoBruto) * 0.04
  const passoY = passoBonito(maximoBruto - minimoBruto, 6)
  const yMin = Math.floor((minimoBruto - folga) / passoY) * passoY
  const yMax = Math.ceil((maximoBruto + folga) / passoY) * passoY

  const areaL = LARGURA - MARGEM.esquerda - MARGEM.direita
  const areaA = ALTURA - MARGEM.topo - MARGEM.baixo
  const x = (meses: number) => MARGEM.esquerda + ((meses - de) / Math.max(ate - de, 1)) * areaL
  const y = (valor: number) => MARGEM.topo + (1 - (valor - yMin) / Math.max(yMax - yMin, 1e-9)) * areaA

  const caminho = (lista: { meses: number; valor: number }[]) =>
    lista.map((p, i) => `${i ? 'L' : 'M'}${x(p.meses).toFixed(1)},${y(p.valor).toFixed(1)}`).join(' ')

  const linha = (z: number) => linhas.find((l) => l.z === z)?.pontos ?? []
  const faixa = (zBaixo: number, zAlto: number) => {
    const baixo = linha(zBaixo)
    const alto = linha(zAlto)
    if (!baixo.length || !alto.length) return ''
    return `${caminho(alto)} ${[...baixo].reverse().map((p) => `L${x(p.meses).toFixed(1)},${y(p.valor).toFixed(1)}`).join(' ')} Z`
  }

  const marcasX: number[] = []
  const passoX = passoDaIdade(ate - de)
  for (let m = Math.ceil(de / passoX) * passoX; m <= ate; m += passoX) marcasX.push(m)
  const marcasY: number[] = []
  for (let v = yMin; v <= yMax + 1e-9; v += passoY) marcasY.push(Number(v.toFixed(6)))
  const casasY = passoY < 1 ? 1 : 0

  const ultimo = pontos[pontos.length - 1]

  return (
    <div className="surface-card rounded-[20px] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {(['peso', 'altura', 'imc'] as Indicador[]).map((opcao) => (
            <button
              key={opcao}
              type="button"
              onClick={() => setIndicador(opcao)}
              className={`rounded-xl px-3 py-1.5 text-[11px] font-extrabold transition ${
                indicador === opcao
                  ? 'bg-[#1f4f78] text-white'
                  : 'border border-[#081b2c]/10 bg-white text-slate-600 hover:text-[#081b2c]'
              }`}
            >
              {opcao === 'peso' ? 'Peso' : opcao === 'altura' ? 'Estatura' : 'IMC'}
            </button>
          ))}
        </div>
        {sexo === 'O' ? (
          <label className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
            Curva de
            <select
              value={sexoEscolhido}
              onChange={(evento) => setSexoEscolhido(evento.target.value as Sexo)}
              className="rounded-lg border border-[#081b2c]/10 bg-white px-2 py-1 text-[11px] font-bold text-[#081b2c]"
            >
              <option value="M">menino</option>
              <option value="F">menina</option>
            </select>
          </label>
        ) : (
          <span className="text-[10px] font-bold text-slate-400">
            OMS · {sexo === 'F' ? 'meninas' : 'meninos'}
          </span>
        )}
      </div>

      <p className="mt-3 text-[12px] font-extrabold text-[#081b2c]">
        {NOME_DO_INDICADOR[indicador]}
        {ultimo && (
          <span className={`ml-2 font-bold ${ultimo.z < -2 || ultimo.z > 2 ? 'text-[#b42318]' : 'text-[#557f75]'}`}>
            · última: {numeroBR(ultimo.valor, indicador === 'altura' ? 1 : indicador === 'imc' ? 1 : 2)} {UNIDADE[indicador]} (z {ultimo.z >= 0 ? '+' : ''}
            {numeroBR(ultimo.z, 2)}, {ultimo.classificacao.toLowerCase()})
          </span>
        )}
      </p>

      {foraDaFaixa && (
        <p className="mt-2 rounded-xl bg-[#fef6e7] px-3 py-2 text-[11px] font-semibold text-[#93370d]">
          {indicador === 'peso'
            ? 'A OMS não publica peso para idade depois dos 10 anos. Use o IMC.'
            : 'As curvas da OMS vão até 19 anos.'}
        </p>
      )}

      {!(foraDaFaixa && pontos.length === 0) && (
      <svg
        viewBox={`0 0 ${LARGURA} ${ALTURA}`}
        className="mt-2 w-full"
        role="img"
        aria-label={`${NOME_DO_INDICADOR[indicador]} com ${pontos.length} medidas`}
      >
        <path d={faixa(2, 3)} fill="#fef6e7" />
        <path d={faixa(-3, -2)} fill="#fef6e7" />
        <path d={faixa(-2, 2)} fill="#eef7f1" />

        {marcasY.map((v) => (
          <g key={`y${v}`}>
            <line x1={MARGEM.esquerda} x2={LARGURA - MARGEM.direita} y1={y(v)} y2={y(v)} stroke="#081b2c" strokeOpacity={0.06} />
            <text x={MARGEM.esquerda - 6} y={y(v) + 3} textAnchor="end" fontSize={9} fill="#64748b">
              {numeroBR(v, casasY)}
            </text>
          </g>
        ))}
        {marcasX.map((m) => (
          <g key={`x${m}`}>
            <line x1={x(m)} x2={x(m)} y1={MARGEM.topo} y2={ALTURA - MARGEM.baixo} stroke="#081b2c" strokeOpacity={0.06} />
            <text x={x(m)} y={ALTURA - MARGEM.baixo + 14} textAnchor="middle" fontSize={9} fill="#64748b">
              {idadeLegivel(m)}
            </text>
          </g>
        ))}

        {linhas.map((l) => {
          const estilo = COR_DA_LINHA[l.z]
          const fim = l.pontos[l.pontos.length - 1]
          return (
            <g key={`z${l.z}`}>
              <path d={caminho(l.pontos)} fill="none" stroke={estilo.cor} strokeWidth={estilo.largura} strokeDasharray={estilo.traco} />
              {fim && Math.abs(l.z) !== 1 && (
                <text x={x(fim.meses) + 4} y={y(fim.valor) + 3} fontSize={9} fontWeight={700} fill={estilo.cor}>
                  {l.z > 0 ? `+${l.z}` : l.z}
                </text>
              )}
            </g>
          )
        })}

        {pontos.length > 1 && (
          <path d={caminho(pontos)} fill="none" stroke="#1f4f78" strokeWidth={1.6} />
        )}
        {pontos.map((p) => (
          <circle
            key={p.data}
            cx={x(p.meses)}
            cy={y(p.valor)}
            r={4}
            fill={COR_DO_PONTO[alerta(indicador, p.z)]}
            stroke="white"
            strokeWidth={1.5}
          >
            <title>
              {`${fmtBR(p.data)} · ${idadeLegivel(p.meses)} · ${numeroBR(p.valor, 2)} ${UNIDADE[indicador]} · z ${numeroBR(p.z, 2)} · ${p.classificacao}`}
            </title>
          </circle>
        ))}

        <text x={MARGEM.esquerda} y={ALTURA - 4} fontSize={9} fill="#94a3b8">
          Idade
        </text>
        <text x={LARGURA - MARGEM.direita} y={ALTURA - 4} fontSize={9} fill="#94a3b8" textAnchor="end">
          {UNIDADE[indicador]} · escores-z da OMS
        </text>
      </svg>
      )}

      {pontos.length === 0 ? (
        <p className="mt-2 text-[11px] font-semibold text-slate-400">
          {indicador === 'imc'
            ? 'Nenhuma consulta com peso e altura no mesmo dia ainda.'
            : `Nenhuma consulta com ${indicador === 'peso' ? 'peso' : 'altura'} anotado ainda.`}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400">
                <th className="py-1 pr-3">Data</th>
                <th className="py-1 pr-3">Idade</th>
                <th className="py-1 pr-3">Medida</th>
                <th className="py-1 pr-3">Escore-z</th>
                <th className="py-1">Classificação</th>
              </tr>
            </thead>
            <tbody>
              {[...pontos].reverse().map((p) => {
                const faixaDoPonto = alerta(indicador, p.z)
                return (
                  <tr key={p.data} className="border-t border-[#081b2c]/[0.06] font-semibold text-[#081b2c]">
                    <td className="py-1.5 pr-3">{fmtBR(p.data)}</td>
                    <td className="py-1.5 pr-3">{idadeLegivel(p.meses)}</td>
                    <td className="py-1.5 pr-3">
                      {numeroBR(p.valor, indicador === 'peso' ? 2 : 1)} {UNIDADE[indicador]}
                    </td>
                    <td className="py-1.5 pr-3">
                      {p.z >= 0 ? '+' : ''}
                      {numeroBR(p.z, 2)}
                    </td>
                    <td
                      className={`py-1.5 font-extrabold ${
                        faixaDoPonto === 'alerta'
                          ? 'text-[#b42318]'
                          : faixaDoPonto === 'atencao'
                            ? 'text-[#b54708]'
                            : 'text-[#557f75]'
                      }`}
                    >
                      {p.classificacao}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[10px] leading-relaxed text-slate-400">
        Referência: OMS 2006 (0 a 5 anos) e OMS 2007 (5 a 19 anos), as mesmas curvas da Caderneta da
        Criança. Classificação pelos pontos de corte do Ministério da Saúde. Os pontos vêm do peso e da
        altura anotados em cada consulta.
      </p>
    </div>
  )
}

function Vazio({ texto }: { texto: string }) {
  return (
    <div className="surface-card flex items-center gap-3 rounded-[20px] p-5 text-[12px] font-semibold text-slate-500">
      <LineChart className="h-5 w-5 shrink-0 text-slate-300" />
      {texto}
    </div>
  )
}
