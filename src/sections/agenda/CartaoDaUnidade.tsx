import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, MapPin, RotateCcw, Save, Trash2, Video, Wand2 } from 'lucide-react'
import {
  CAMPOS,
  formatarValor,
  preencherCampos,
  problemasDoTexto,
  trocarPorCampo,
  valorDaConsulta,
  valoresEscritos,
  type Lugar,
  type Onde,
} from '../../../supabase/functions/_shared/campos-do-texto.ts'
import { saveTelemedicina, saveUnit, type Telemedicina, type Unit } from '@/lib/repository'
import { ID_DA_TELEMEDICINA, NOME_DA_TELEMEDICINA } from '@/lib/lugares'

/**
 * Cartao da unidade na Configuracao da Agenda (14/10/2026).
 *
 * Antes, a unidade tinha nome, endereco e CNES aqui, e o que o robo responde
 * sobre ela ficava em Configuracoes > Informacoes por unidade, com o valor
 * escrito a mao dentro do texto. Mudar o preco era lembrar de tres lugares.
 * Agora e um cartao so: endereco, valor e texto juntos, e o texto usa {valor}
 * e {endereco}, que o robo troca na hora de enviar.
 *
 * Um botao Salvar, que so salva o que esta certo (pedido do Edu, 14/10). Se
 * algo nao fecha, nada vai para o banco: o que esta valendo continua valendo,
 * e o cartao mostra o que falta. O rascunho fica na tela para corrigir.
 */

type Rascunho = {
  nome: string
  endereco: string
  valor: string
  cnes: string
  texto: string
  /** So na telemedicina: se o robo oferece. */
  ativa: boolean
}

const MODELO_DA_UNIDADE = '💙 *Consulta em {unidade}: {valor}.* Inclui retorno em até 30 dias.\n\n📍 {endereco}'
const MODELO_DA_TELEMEDICINA =
  '💻 *Telemedicina: {valor}.* A consulta é por vídeo, e o retorno presencial em até 30 dias está incluído.'

const campo =
  'w-full rounded-xl border border-[#081b2c]/10 bg-white px-2.5 py-1.5 text-[11px] text-[#081b2c] outline-none transition focus:border-[#2f7fc1]'
const rotulo = 'text-[9px] font-extrabold uppercase tracking-[0.12em] text-slate-400'

function valorNaTela(centavos: number | null | undefined) {
  return centavos ? formatarValor(centavos).replace('R$ ', '') : ''
}

/** *negrito* do WhatsApp, para a previa parecer o que a familia ve. */
function ComoNoWhatsApp({ texto }: { texto: string }) {
  return (
    <>
      {texto.split(/(\*[^*\n]+\*)/g).map((parte, i) =>
        /^\*[^*\n]+\*$/.test(parte) ? <strong key={i}>{parte.slice(1, -1)}</strong> : <span key={i}>{parte}</span>,
      )}
    </>
  )
}

export default function CartaoDaUnidade({
  unidade,
  tele,
  lugares,
  clinicId,
  podeArquivar,
  onSalvo,
  onArquivar,
}: {
  unidade: Unit
  /** Preenchido so no cartao da agenda da telemedicina. */
  tele: Telemedicina | null
  /** Os atendimentos como estao SALVOS, para conferir {valores}. */
  lugares: Lugar[]
  clinicId: string
  podeArquivar: boolean
  onSalvo: (mensagem: string) => void
  onArquivar: () => void
}) {
  const ehTele = Boolean(unidade.telemedicina)
  // Clinica que oferece telemedicina mas nao tem a agenda propria dela (criada
  // depois de 03/10/2026): o cartao aparece assim mesmo, para o texto e o valor
  // continuarem editaveis, so sem CNES - nao ha unidade onde guardar.
  const temUnidade = Boolean(unidade.id)
  const onde: Onde = ehTele ? 'telemedicina' : 'unidade'

  const salvo: Rascunho = useMemo(
    () => ({
      nome: unidade.name,
      endereco: unidade.address ?? '',
      valor: valorNaTela(ehTele ? tele?.valorCentavos : unidade.priceCents),
      cnes: unidade.cnes ?? '',
      texto: ehTele ? (tele?.texto ?? '') : (unidade.infoText ?? ''),
      ativa: ehTele ? Boolean(tele?.ativa) : true,
    }),
    [unidade, tele, ehTele],
  )
  const [aberto, setAberto] = useState(false)
  const [r, setR] = useState<Rascunho>(salvo)
  const [salvando, setSalvando] = useState(false)
  // Mensagem do ultimo Salvar recusado (pela tela ou pelo banco).
  const [recusa, setRecusa] = useState<string[]>([])
  const caixa = useRef<HTMLTextAreaElement>(null)

  const mudar = (parte: Partial<Rascunho>) => {
    setR((antes) => ({ ...antes, ...parte }))
    setRecusa([])
  }

  const valorLido = valorDaConsulta(r.valor)
  const centavos = 'centavos' in valorLido ? valorLido.centavos : null

  // O lugar como vai ficar se salvar agora, e a lista do robo com ele no meio:
  // e contra isso que {valor} e {valores} sao conferidos e a previa e montada.
  const lugar: Lugar = {
    id: ehTele ? ID_DA_TELEMEDICINA : unidade.id,
    nome: ehTele ? NOME_DA_TELEMEDICINA : r.nome.trim(),
    endereco: ehTele ? '' : r.endereco,
    valorCentavos: centavos,
    telemedicina: ehTele,
  }
  const lugaresComEste = ehTele
    ? [...lugares.filter((l) => !l.telemedicina), ...(r.ativa ? [lugar] : [])]
    : lugares.map((l) => (l.id === unidade.id ? lugar : l))

  const problemas = [
    ...(!ehTele && !r.nome.trim() ? ['Preencha o nome da unidade.'] : []),
    ...(!ehTele && !r.endereco.trim() ? ['Preencha o endereço: ele vai na confirmação e no lembrete da véspera.'] : []),
    ...('erro' in valorLido ? [valorLido.erro] : []),
    ...(r.texto.trim().length > 1024 ? [`O texto tem ${r.texto.trim().length} caracteres; o limite é 1024.`] : []),
    ...problemasDoTexto(r.texto, onde, lugar, lugaresComEste),
  ]
  // Nao bloqueia: o texto pode citar outra quantia de proposito. Mas texto
  // dizendo um preco e cartao dizendo outro e o erro de 28/09.
  const escritos = valoresEscritos(r.texto)
  const divergentes = centavos ? escritos.filter((v) => v.centavos !== centavos) : []
  const iguais = centavos ? escritos.filter((v) => v.centavos === centavos) : []
  // Cartao ainda sem valor e texto com UM preco escrito a mao: e a situacao de
  // toda unidade no dia em que isto entrou. Um clique traz o preco do texto
  // para o campo; o segundo troca o texto por {valor}.
  const doTexto = [...new Set(escritos.map((v) => v.centavos).filter((c): c is number => c !== null))]
  const sugerido = !r.valor.trim() && doTexto.length === 1 ? doTexto[0] : null

  const alterado = JSON.stringify(r) !== JSON.stringify(salvo)
  const previa = r.texto.trim() ? preencherCampos(r.texto.trim(), lugar, lugaresComEste).texto : ''

  function inserir(nome: string) {
    const el = caixa.current
    const chave = `{${nome}}`
    if (!el) return mudar({ texto: r.texto + chave })
    const inicio = el.selectionStart ?? r.texto.length
    const fim = el.selectionEnd ?? r.texto.length
    mudar({ texto: r.texto.slice(0, inicio) + chave + r.texto.slice(fim) })
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(inicio + chave.length, inicio + chave.length)
    })
  }

  async function salvar() {
    if (problemas.length > 0) {
      setRecusa(problemas)
      return
    }
    setSalvando(true)
    try {
      if (ehTele) {
        await saveTelemedicina(clinicId, { ativa: r.ativa, texto: r.texto, valorCentavos: centavos })
        if (temUnidade && r.cnes !== salvo.cnes) await saveUnit(unidade.id, { cnes: r.cnes })
      } else {
        await saveUnit(unidade.id, {
          name: r.nome,
          address: r.endereco,
          cnes: r.cnes,
          priceCents: centavos,
          infoText: r.texto,
        })
      }
      setAberto(false)
      onSalvo(`${ehTele ? 'Telemedicina' : r.nome.trim()} salva. O robô já responde com o que está aqui.`)
    } catch (causa) {
      setRecusa([causa instanceof Error ? causa.message : 'O banco recusou a gravação.'])
    } finally {
      setSalvando(false)
    }
  }

  const valorSalvo = ehTele ? tele?.valorCentavos : unidade.priceCents

  return (
    <div className={`rounded-xl ${aberto ? 'border border-[#2f7fc1]/30 bg-white' : 'bg-[#fafaf8]'}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setAberto((a) => !a)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={aberto}
        >
          {ehTele ? (
            <Video className="h-3.5 w-3.5 shrink-0 text-[#2f7fc1]" />
          ) : (
            <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          )}
          <span className="min-w-0 truncate text-[11px] font-bold text-[#081b2c]">
            {unidade.name}
            {!ehTele && unidade.address && <span className="font-normal text-slate-500"> · {unidade.address}</span>}
          </span>
          {/* O valor aparece fechado tambem: e o que a recepcao mais confere. */}
          {valorSalvo ? (
            <span className="ml-auto shrink-0 rounded-full bg-[#eef3f2] px-2 py-0.5 text-[10px] font-extrabold text-[#557f75]">
              {formatarValor(valorSalvo)}
            </span>
          ) : (
            <span
              className="ml-auto shrink-0 rounded-full bg-[#fff4e5] px-2 py-0.5 text-[10px] font-extrabold text-[#b54708]"
              title="Sem valor cadastrado, o {valor} dos textos do robô não tem o que mostrar."
            >
              sem valor
            </span>
          )}
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition ${aberto ? 'rotate-180' : ''}`} />
        </button>
        {podeArquivar && (
          <button
            type="button"
            onClick={onArquivar}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
            aria-label={`Arquivar ${unidade.name}`}
            title="Arquivar unidade"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {aberto && (
        <div className="space-y-3 border-t border-[#081b2c]/[0.06] px-3 pb-3 pt-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            {!ehTele && (
              <>
                <label className="block">
                  <span className={rotulo}>Nome</span>
                  <input value={r.nome} onChange={(e) => mudar({ nome: e.target.value })} className={`${campo} mt-1`} />
                </label>
                <label className="block">
                  <span className={rotulo}>Endereço</span>
                  <input
                    value={r.endereco}
                    onChange={(e) => mudar({ endereco: e.target.value })}
                    className={`${campo} mt-1`}
                  />
                </label>
              </>
            )}
            <label className="block">
              <span className={rotulo}>Valor da consulta</span>
              <span className="relative mt-1 block">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400">
                  R$
                </span>
                <input
                  value={r.valor}
                  onChange={(e) => mudar({ valor: e.target.value })}
                  inputMode="decimal"
                  placeholder="600,00"
                  className={`${campo} pl-8`}
                />
              </span>
              <span className="mt-1 block text-[9px] text-slate-400">Retorno não tem custo.</span>
            </label>
            {temUnidade && (
              <label className="block">
                <span className={rotulo}>CNES</span>
                <input
                  value={r.cnes}
                  onChange={(e) => mudar({ cnes: e.target.value.replace(/\D/g, '') })}
                  inputMode="numeric"
                  placeholder="Sai impresso na receita"
                  className={`${campo} mt-1`}
                />
              </label>
            )}
          </div>

          {ehTele && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={r.ativa}
                onChange={(e) => mudar({ ativa: e.target.checked })}
                className="h-3.5 w-3.5 accent-[#2f7fc1]"
              />
              <span className="text-[11px] font-bold text-[#081b2c]">
                O robô oferece telemedicina nas informações e no agendamento
              </span>
            </label>
          )}

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={rotulo}>O que o robô responde (opção 1 do menu)</span>
              {!r.texto.trim() && (
                <button
                  type="button"
                  onClick={() => mudar({ texto: ehTele ? MODELO_DA_TELEMEDICINA : MODELO_DA_UNIDADE })}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#eef3f2] px-2 py-1 text-[10px] font-extrabold text-[#557f75]"
                >
                  <Wand2 className="h-3 w-3" /> Usar modelo
                </button>
              )}
            </div>
            <textarea
              ref={caixa}
              value={r.texto}
              onChange={(e) => mudar({ texto: e.target.value })}
              rows={6}
              placeholder="Vazio, o robô manda só o fecho comum do menu."
              className={`${campo} mt-1 resize-y leading-relaxed`}
            />
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[9px] font-bold text-slate-400">Inserir:</span>
              {CAMPOS.filter((c) => c.onde.includes(onde)).map((c) => (
                <button
                  key={c.nome}
                  type="button"
                  onClick={() => inserir(c.nome)}
                  title={c.ajuda}
                  className="rounded-md border border-[#2f7fc1]/20 bg-[#f1f7fd] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#1f4f78] transition hover:bg-[#e2effa]"
                >
                  {`{${c.nome}}`}
                </button>
              ))}
              <span className="ml-auto text-[9px] font-bold text-slate-300">{r.texto.trim().length}/1024</span>
            </div>
          </div>

          {sugerido && (
            <div className="rounded-xl border border-[#b54708]/20 bg-[#fffaf2] px-3 py-2 text-[10px] leading-relaxed text-[#93370d]">
              O texto tem o valor escrito à mão e o cartão ainda não tem valor.{' '}
              <button
                type="button"
                onClick={() => mudar({ valor: valorNaTela(sugerido) })}
                className="font-extrabold underline"
              >
                Usar {formatarValor(sugerido)} como valor da consulta
              </button>
            </div>
          )}
          {(divergentes.length > 0 || iguais.length > 0) && (
            <div className="rounded-xl border border-[#b54708]/20 bg-[#fffaf2] px-3 py-2 text-[10px] leading-relaxed text-[#93370d]">
              {divergentes.length > 0 && (
                <p className="font-bold">
                  O texto diz {divergentes.map((v) => v.trecho).join(', ')}, e o valor da consulta é{' '}
                  {centavos ? formatarValor(centavos) : ''}. Confira se é isso mesmo.
                </p>
              )}
              {iguais.length > 0 && centavos && (
                <p className={divergentes.length > 0 ? 'mt-1' : ''}>
                  Valor escrito à mão não acompanha quando o preço mudar.{' '}
                  <button
                    type="button"
                    onClick={() => mudar({ texto: trocarPorCampo(r.texto, centavos) })}
                    className="font-extrabold underline"
                  >
                    Trocar {iguais[0].trecho} por {'{valor}'}
                  </button>
                </p>
              )}
            </div>
          )}

          {previa && (
            <div>
              <span className={rotulo}>Como chega no WhatsApp (antes do fecho comum)</span>
              <div className="mt-1 whitespace-pre-wrap rounded-xl bg-[#e7f0ed] px-3 py-2.5 text-[11px] leading-relaxed text-[#081b2c]">
                <ComoNoWhatsApp texto={previa} />
              </div>
            </div>
          )}

          {recusa.length > 0 && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[10px] leading-relaxed text-red-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <p className="font-extrabold">Não salvei. O que está valendo continua o mesmo.</p>
                <ul className="mt-0.5 list-disc pl-4 font-semibold">
                  {recusa.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {recusa.length === 0 && alterado && problemas.length > 0 && (
            <p className="text-[10px] font-semibold text-[#b54708]">
              Falta acertar: {problemas[0]}
              {problemas.length > 1 ? ` (e mais ${problemas.length - 1})` : ''}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void salvar()}
              disabled={!alterado || salvando}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#081b2c] px-3.5 py-2 text-[10px] font-extrabold text-white transition hover:bg-[#102d47] disabled:opacity-40"
            >
              {salvando ? <Save className="h-3.5 w-3.5 animate-pulse" /> : <Check className="h-3.5 w-3.5" />}
              {salvando ? 'Salvando...' : 'Salvar'}
            </button>
            {alterado && (
              <button
                type="button"
                onClick={() => {
                  setR(salvo)
                  setRecusa([])
                }}
                className="inline-flex items-center gap-1 rounded-xl px-3 py-2 text-[10px] font-bold text-slate-500 transition hover:bg-slate-100"
              >
                <RotateCcw className="h-3 w-3" /> Desfazer alterações
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
