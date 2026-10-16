import { useEffect, useState } from 'react'
import { Check, MessageSquareText, Plus, Save, Trash2 } from 'lucide-react'
import { Ajuda } from '@/components/Ajuda'
import { useDialogos } from '@/components/dialogos-contexto'
import {
  deleteRespostaPronta,
  getCurrentMembership,
  getTelemedicina,
  listRespostasProntas,
  listUnits,
  saveRespostaPronta,
  type RespostaPronta,
} from '@/lib/repository'
import { lugaresDoRobo } from '@/lib/lugares'
import { publicoDaClinica } from '@/lib/publico'
import {
  CAMPOS,
  preencherCampos,
  problemasDoTexto,
  temCampo,
  valoresEscritos,
  type Lugar,
} from '../../supabase/functions/_shared/campos-do-texto.ts'

const campo =
  'mt-1.5 w-full rounded-[13px] border border-[#081b2c]/10 bg-[#fafaf8] px-3.5 py-2.5 text-xs font-semibold text-[#081b2c] outline-none transition placeholder:font-normal placeholder:text-slate-300 focus:border-[#2f7fc1] focus:bg-white focus:ring-4 focus:ring-[#2f7fc1]/10'

const rotulo = 'flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-wide text-slate-400'

/**
 * Linha em edição: o id vazio é a que ainda não existe no banco.
 *
 * textoDasPalavras guarda o campo como a pessoa digita (15/10/2026). O campo
 * era montado da lista a cada tecla: a vírgula recém-digitada virava um item
 * vazio, sumia, e "convenio, plano" saía "convenioplano". Só dava para colar.
 */
type Item = RespostaPronta & { removida?: boolean; textoDasPalavras?: string }

/** O limite do banco (bot_answers_keywords_limit). */
const MAXIMO_DE_PALAVRAS = 40

function palavrasDoTexto(texto: string): string[] {
  return texto.split(',').map((p) => p.trim()).filter(Boolean)
}

const NOVA: Omit<Item, 'ordem'> = {
  id: '',
  assunto: '',
  palavras: [],
  resposta: '',
  ativa: false,
  perguntarUnidade: false,
}

/**
 * As respostas que o robô dá sozinho.
 *
 * O robô do WhatsApp só entendia o que ele mesmo tinha perguntado: número do
 * menu, dia, horário. Quem escrevia "quanto custa a consulta?" recebia o menu
 * de volta e ficava esperando alguém responder algo que a clínica repete dez
 * vezes por dia.
 *
 * Aqui a clínica escreve esses assuntos. Nada é gerado por inteligência
 * artificial: o robô procura as palavras da mensagem nesta lista e, quando
 * acha, envia o texto exatamente como está escrito. Quando não acha, oferece o
 * menu como sempre fez - "não sei" é uma resposta honesta, resposta errada
 * dita com segurança não é.
 */
export default function RespostasProntas() {
  const { avisar, perguntar } = useDialogos()
  const [clinicId, setClinicId] = useState<string | null>(null)
  // Quem escreve a mensagem: o paciente no otorrino, a familia na pediatria
  // (15/10/2026, ver publico.ts).
  const geral = publicoDaClinica(clinicId) === 'geral'
  const [itens, setItens] = useState<Item[]>([])
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [salvo, setSalvo] = useState(false)
  // Os atendimentos com valor e endereco, para conferir e mostrar {valores}.
  // Nulo = nao deu para ler; ai a tela nao confere nem mostra previa, mas
  // tambem nao trava (o robo tem a propria rede, ver comCampos).
  const [lugares, setLugares] = useState<Lugar[] | null>(null)

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const membership = await getCurrentMembership()
        if (!membership || !vivo) return
        setClinicId(membership.clinicId)
        const lista = await listRespostasProntas(membership.clinicId)
        if (vivo) setItens(lista)
        try {
          const [units, tele] = await Promise.all([listUnits(membership.clinicId), getTelemedicina(membership.clinicId)])
          if (vivo) setLugares(lugaresDoRobo(units, tele))
        } catch (erro) {
          console.warn('Nao consegui ler valores e enderecos para conferir {valores}', erro)
        }
      } catch (causa) {
        if (vivo) avisar(causa instanceof Error ? causa.message : 'Não foi possível carregar as respostas.', 'erro')
      } finally {
        if (vivo) setCarregando(false)
      }
    })()
    return () => {
      vivo = false
    }
  }, [avisar])

  function mudar(indice: number, patch: Partial<Item>) {
    setItens((antes) => antes.map((item, i) => (i === indice ? { ...item, ...patch } : item)))
    setSalvo(false)
  }

  function adicionar() {
    const ordem = (itens.at(-1)?.ordem ?? 0) + 10
    setItens((antes) => [...antes, { ...NOVA, ordem }])
    setSalvo(false)
  }

  async function remover(indice: number) {
    const item = itens[indice]
    // Linha que nunca chegou ao banco some sem cerimônia; a que já existe
    // merece a pergunta, porque o texto pode ter levado tempo para ficar bom.
    if (!item.id) {
      setItens((antes) => antes.filter((_, i) => i !== indice))
      return
    }
    const certeza = await perguntar({
      titulo: `Apagar "${item.assunto || 'este assunto'}"?`,
      detalhe: 'O robô deixa de responder essa pergunta e passa a oferecer o menu, como antes.',
      confirmar: 'Apagar',
      perigo: true,
    })
    if (!certeza) return
    mudar(indice, { removida: true, ativa: false })
  }

  async function salvar() {
    if (!clinicId) return

    const validos = itens.filter((item) => !item.removida)
    const incompleto = validos.find(
      (item) => item.ativa && (!item.assunto.trim() || !item.resposta.trim() || item.palavras.length === 0),
    )
    if (incompleto) {
      avisar('Um assunto ligado precisa de nome, palavras e resposta. Desligue-o ou complete os campos.', 'erro')
      return
    }
    // Antes do banco, e em portugues: a recusa dele chegava como "violates check
    // constraint bot_answers_keywords_limit" (15/10/2026).
    const demais = validos.find((item) => item.palavras.length > MAXIMO_DE_PALAVRAS)
    if (demais) {
      avisar(
        `Não salvei. "${demais.assunto || 'Um assunto'}" tem ${demais.palavras.length} palavras; o máximo é ${MAXIMO_DE_PALAVRAS}. ` +
          'Acento e plural não precisam de palavra própria: "convenio" já acha "convênios".',
        'erro',
      )
      return
    }
    // Campo que o robo nao conseguiria preencher: nada e salvo, o que esta no
    // ar continua igual (pedido do Edu, 14/10/2026).
    const comProblema = validos.find((item) => problemasDe(item).length > 0)
    if (comProblema) {
      avisar(
        `Não salvei. Em "${comProblema.assunto || 'um assunto'}": ${problemasDe(comProblema)[0]} As respostas no ar continuam as mesmas.`,
        'erro',
      )
      return
    }

    setSalvando(true)
    try {
      for (const item of itens) {
        if (item.removida) {
          if (item.id) await deleteRespostaPronta(item.id)
          continue
        }
        if (!item.assunto.trim() && !item.resposta.trim()) continue
        await saveRespostaPronta(clinicId, item)
      }
      setItens(await listRespostasProntas(clinicId))
      setSalvo(true)
      window.setTimeout(() => setSalvo(false), 2500)
    } catch (causa) {
      avisar(causa instanceof Error ? causa.message : 'Não foi possível salvar.', 'erro')
    } finally {
      setSalvando(false)
    }
  }

  // Resposta pronta vale para qualquer lugar: so {valores} e {enderecos}.
  // Desligada tambem confere - ligar depois nao pode trazer o problema junto.
  function problemasDe(item: Item) {
    return problemasDoTexto(item.resposta, 'geral', null, lugares ?? [])
      // Sem a lista (falha ao ler), confere so o nome do campo.
      .filter((p) => lugares !== null || !p.startsWith('Falta'))
  }

  const visiveis = itens.map((item, indice) => ({ item, indice })).filter(({ item }) => !item.removida)

  return (
    <section className="surface-card overflow-hidden rounded-[26px]">
      <div className="border-b border-[#081b2c]/[0.06] bg-gradient-to-r from-white to-[#f0f6fc] p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[15px] bg-[#dceaf7] text-[#1f4f78]">
            <MessageSquareText className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[9px] font-extrabold uppercase tracking-[0.15em] text-[#1f4f78]">Atendimento automático</p>
            <h2 className="mt-1 text-base font-extrabold tracking-[-0.03em] text-[#081b2c]">Respostas prontas</h2>
            <p className="mt-1.5 max-w-2xl text-[11px] leading-relaxed text-slate-400">
              Perguntas que o robô responde sozinho, no seu texto. Ele procura as palavras abaixo na mensagem
              {geral ? ' do paciente' : ' da família'} e envia a resposta correspondente. Quando nada bate, oferece o menu como sempre.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-5 sm:p-6">
        <div className="flex items-start gap-2 rounded-[16px] border border-[#081b2c]/[0.06] bg-[#f8f7f4] px-4 py-3">
          <span className="mt-0.5 text-[13px]">🩺</span>
          <p className="text-[10px] font-bold leading-relaxed text-slate-500">
            Dúvida clínica nunca é respondida pelo robô. Mensagem com sintoma, remédio, dose ou queixa vai direto
            para a equipe, mesmo que exista um assunto cadastrado com essas palavras.
          </p>
        </div>

        {carregando ? (
          <p className="rounded-[16px] bg-[#f8f7f4] px-4 py-6 text-center text-[11px] text-slate-400">Carregando...</p>
        ) : visiveis.length === 0 ? (
          <p className="rounded-[16px] bg-[#f8f7f4] px-4 py-6 text-center text-[11px] text-slate-400">
            Nenhum assunto cadastrado. O robô continua oferecendo o menu.
          </p>
        ) : (
          visiveis.map(({ item, indice }) => (
            <div key={item.id || `nova-${indice}`} className="rounded-[22px] border border-[#081b2c]/[0.07] bg-white p-4 sm:p-5">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <label className="block min-w-[220px] flex-1">
                  <span className={rotulo}>
                    Assunto
                    <Ajuda texto="Nome interno, só a equipe vê. Serve para você achar este bloco na lista." />
                  </span>
                  <input
                    className={campo}
                    value={item.assunto}
                    onChange={(e) => mudar(indice, { assunto: e.target.value })}
                    placeholder="Ex.: Valor e pagamento"
                  />
                </label>
                <div className="flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-2 rounded-[13px] border border-[#081b2c]/10 bg-[#fafaf8] px-3.5 py-2.5">
                    <input
                      type="checkbox"
                      checked={item.ativa}
                      onChange={(e) => mudar(indice, { ativa: e.target.checked })}
                      className="h-3.5 w-3.5 accent-[#2f7fc1]"
                    />
                    <span className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
                      {item.ativa ? 'Respondendo' : 'Desligado'}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => void remover(indice)}
                    aria-label="Apagar assunto"
                    className="rounded-[13px] border border-[#081b2c]/10 p-2.5 text-slate-400 transition hover:border-red-200 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <label className="mt-3 block">
                <span className={rotulo}>
                  Palavras que identificam a pergunta
                  <Ajuda texto="Separe por vírgula. Acento e maiúscula não importam. Palavras com cinco letras ou mais também valem no plural: convenio acha convênios." />
                </span>
                <input
                  className={campo}
                  value={item.textoDasPalavras ?? item.palavras.join(', ')}
                  onChange={(e) =>
                    mudar(indice, { textoDasPalavras: e.target.value, palavras: palavrasDoTexto(e.target.value) })
                  }
                  placeholder="valor, quanto custa, preço, pix, cartão"
                />
                <span
                  className={`mt-1 block text-right text-[9px] font-bold ${
                    item.palavras.length > MAXIMO_DE_PALAVRAS ? 'text-red-600' : 'text-slate-300'
                  }`}
                >
                  {item.palavras.length}/{MAXIMO_DE_PALAVRAS} palavras
                </span>
              </label>

              <label className="mt-3 block">
                <span className={rotulo}>
                  Resposta
                  <Ajuda texto="Enviada exatamente como está escrita. Para negrito no WhatsApp, use *asteriscos*." />
                </span>
                <textarea
                  className={`${campo} min-h-[110px] resize-y font-medium leading-relaxed`}
                  value={item.resposta}
                  onChange={(e) => mudar(indice, { resposta: e.target.value })}
                  placeholder={'💰 Valores da consulta:\n{valores}'}
                  maxLength={1024}
                />
              </label>
              <div className="mt-1 flex flex-wrap items-center gap-1">
                <span className="mr-1 text-[9px] font-bold text-slate-400">Inserir:</span>
                {CAMPOS.filter((c) => c.onde.includes('geral')).map((c) => (
                  <button
                    key={c.nome}
                    type="button"
                    onClick={() =>
                      mudar(indice, { resposta: `${item.resposta.replace(/\s+$/, '')}${item.resposta.trim() ? '\n' : ''}{${c.nome}}` })
                    }
                    title={c.ajuda}
                    className="rounded-md border border-[#2f7fc1]/20 bg-[#f1f7fd] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#1f4f78] transition hover:bg-[#e2effa]"
                  >
                    {`{${c.nome}}`}
                  </button>
                ))}
                <span className="ml-auto text-[9px] font-bold text-slate-300">{item.resposta.length}/1024</span>
              </div>
              {problemasDe(item).map((p) => (
                <p key={p} className="mt-1.5 text-[10px] font-bold text-red-600">
                  {p}
                </p>
              ))}
              {valoresEscritos(item.resposta).length > 0 && (
                <p className="mt-1.5 text-[10px] font-semibold leading-relaxed text-[#b54708]">
                  Esta resposta tem valor escrito à mão ({valoresEscritos(item.resposta).map((v) => v.trecho).join(', ')}).
                  Quando o preço mudar, ele não acompanha: troque pela lista {'{valores}'}, que pega o valor do cartão de
                  cada unidade.
                </p>
              )}
              {lugares && temCampo(item.resposta) && problemasDe(item).length === 0 && (
                <div className="mt-2">
                  <span className={rotulo}>Como chega no WhatsApp</span>
                  <p className="mt-1 whitespace-pre-wrap rounded-[13px] bg-[#e7f0ed] px-3.5 py-2.5 text-[11px] leading-relaxed text-[#081b2c]">
                    {preencherCampos(item.resposta, null, lugares).texto}
                  </p>
                </div>
              )}

              {/* Para o que muda de unidade para unidade - o endereco, o que
                  levar. Ligado, o robo responde o texto acima e pergunta onde e
                  o atendimento, para mandar o texto do cartao daquela unidade
                  (Agenda > Configuracao > Unidades). */}
              <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-[14px] border border-[#081b2c]/[0.06] bg-[#f8f7f4] px-3.5 py-3">
                <input
                  type="checkbox"
                  checked={item.perguntarUnidade}
                  onChange={(e) => mudar(indice, { perguntarUnidade: e.target.checked })}
                  className="mt-0.5 h-3.5 w-3.5 accent-[#2f7fc1]"
                />
                <span className="text-[10px] font-bold leading-relaxed text-slate-500">
                  Depois da resposta, perguntar onde é o atendimento (Santos, São Paulo ou Telemedicina) para
                  enviar o texto daquela unidade, que fica no cartão dela em Agenda → Configuração → Unidades.
                </span>
              </label>
            </div>
          ))
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={adicionar}
            className="inline-flex items-center justify-center gap-2 rounded-[14px] border border-[#081b2c]/10 px-4 py-3 text-xs font-extrabold text-[#1f4f78] transition hover:bg-[#f0f6fc]"
          >
            <Plus className="h-4 w-4" />
            Novo assunto
          </button>
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={salvando || !clinicId}
            className={`inline-flex items-center justify-center gap-2 rounded-[14px] px-5 py-3 text-xs font-extrabold text-white shadow-[0_10px_22px_rgba(8,27,44,.15)] transition disabled:opacity-60 ${
              salvo ? 'bg-[#6f9d91]' : 'bg-[#081b2c] hover:bg-[#102d47]'
            }`}
          >
            {salvo ? <Check className="h-4 w-4" strokeWidth={3} /> : <Save className="h-4 w-4 text-[#6aa8d9]" />}
            {salvando ? 'Salvando...' : salvo ? 'Respostas salvas' : 'Salvar respostas'}
          </button>
        </div>
      </div>
    </section>
  )
}
