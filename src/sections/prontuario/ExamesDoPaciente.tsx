import { useEffect, useRef, useState } from 'react'
import { FileImage, FileText, Loader2, Paperclip, Trash2, Upload } from 'lucide-react'
import {
  anexarExame,
  linkDoExame,
  listarExames,
  removerExame,
  TAMANHO_MAXIMO_DO_EXAME,
  type Exame,
} from '@/lib/prontuario-extra'
import { fmtBR, todayISO } from '@/lib/followup'
import { VisualizadorDeArquivo, type ArquivoAberto } from '@/components/VisualizadorDeArquivo'

/**
 * Exames do paciente, dentro do prontuario (25/09/2026).
 *
 * Anexar e simples de proposito: escolher o arquivo, conferir titulo e data,
 * enviar. O titulo nasce do nome do arquivo porque e o que a familia manda
 * ("hemograma_maria.pdf") - o medico so corrige se quiser.
 *
 * Erro aparece na tela, em vermelho, e nunca some sozinho: exame que a pessoa
 * acha que anexou e nao anexou e o tipo de falha calada que o sistema evita.
 */

function tamanhoLegivel(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function tituloDoArquivo(nome: string) {
  return nome.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 200)
}

export function ExamesDoPaciente({ clinicId, patientId }: { clinicId: string | null; patientId: string }) {
  const [exames, setExames] = useState<Exame[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState('')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [titulo, setTitulo] = useState('')
  const [dataExame, setDataExame] = useState(todayISO())
  const [enviando, setEnviando] = useState(false)
  const [abrindo, setAbrindo] = useState<string | null>(null)
  const [aberto, setAberto] = useState<ArquivoAberto | null>(null)
  const seletor = useRef<HTMLInputElement>(null)

  async function carregar() {
    if (!clinicId) return
    setCarregando(true)
    try {
      setExames(await listarExames(clinicId, patientId))
      setErro('')
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Não consegui carregar os exames.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    void carregar()
    // So recarrega quando muda o paciente ou a clinica.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, patientId])

  function escolher(lista: FileList | null) {
    const escolhido = lista?.[0] ?? null
    setErro('')
    if (!escolhido) return
    if (escolhido.size > TAMANHO_MAXIMO_DO_EXAME) {
      setErro('Arquivo maior que 20 MB. Reduza a foto ou divida o PDF.')
      return
    }
    setArquivo(escolhido)
    setTitulo(tituloDoArquivo(escolhido.name))
    setDataExame(todayISO())
  }

  async function enviar() {
    if (!clinicId || !arquivo) return
    setEnviando(true)
    setErro('')
    try {
      await anexarExame(clinicId, patientId, arquivo, titulo, dataExame || null)
      setArquivo(null)
      setTitulo('')
      if (seletor.current) seletor.current.value = ''
      await carregar()
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'O exame não foi anexado.')
    } finally {
      setEnviando(false)
    }
  }

  // Abre por cima do prontuario, sem aba nova: o medico continua na consulta.
  async function abrir(exame: Exame) {
    setAbrindo(exame.id)
    try {
      setAberto({ url: await linkDoExame(exame.caminho), mime: exame.mime, titulo: exame.titulo })
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Não consegui abrir o exame.')
    } finally {
      setAbrindo(null)
    }
  }

  async function remover(exame: Exame) {
    if (!window.confirm(`Remover "${exame.titulo}" da lista de exames?\n\nO arquivo continua guardado no acervo da clínica.`)) return
    try {
      await removerExame(exame.id)
      await carregar()
    } catch (causa) {
      setErro(causa instanceof Error ? causa.message : 'Não consegui remover o exame.')
    }
  }

  return (
    <div className="surface-card rounded-[20px] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-extrabold text-[#081b2c]">Exames anexados</p>
        <input
          ref={seletor}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          className="hidden"
          onChange={(evento) => escolher(evento.target.files)}
        />
        <button
          type="button"
          onClick={() => seletor.current?.click()}
          disabled={!clinicId || enviando}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#1f4f78] px-3 py-2 text-[11px] font-extrabold text-white transition hover:bg-[#183f61] disabled:opacity-50"
        >
          <Paperclip className="h-3.5 w-3.5" /> Anexar exame
        </button>
      </div>

      {arquivo && (
        <div className="mt-3 rounded-[14px] border border-[#1f4f78]/20 bg-[#f1f7fd] p-3">
          <p className="text-[11px] font-bold text-[#16456b]">
            {arquivo.name} · {tamanhoLegivel(arquivo.size)}
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_150px]">
            <label className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
              Título
              <input
                value={titulo}
                onChange={(evento) => setTitulo(evento.target.value)}
                maxLength={200}
                placeholder="Ex.: Hemograma, Ultrassom de abdome"
                className="mt-1 w-full rounded-xl border border-[#081b2c]/10 bg-white px-3 py-2 text-[12px] font-semibold normal-case tracking-normal text-[#081b2c] outline-none focus:border-[#2f7fc1]/60"
              />
            </label>
            <label className="text-[10px] font-extrabold uppercase tracking-wide text-slate-500">
              Data do exame
              <input
                type="date"
                value={dataExame}
                onChange={(evento) => setDataExame(evento.target.value)}
                className="mt-1 w-full rounded-xl border border-[#081b2c]/10 bg-white px-3 py-2 text-[12px] font-semibold text-[#081b2c] outline-none focus:border-[#2f7fc1]/60"
              />
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void enviar()}
              disabled={enviando || !titulo.trim()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#081b2c] px-3.5 py-2 text-[11px] font-extrabold text-white disabled:opacity-50"
            >
              {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {enviando ? 'Enviando...' : 'Enviar'}
            </button>
            <button
              type="button"
              onClick={() => {
                setArquivo(null)
                if (seletor.current) seletor.current.value = ''
              }}
              disabled={enviando}
              className="rounded-xl border border-[#081b2c]/10 bg-white px-3.5 py-2 text-[11px] font-bold text-slate-500"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {erro && (
        <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-600">{erro}</p>
      )}

      {carregando ? (
        <p className="mt-4 flex items-center gap-2 text-[11px] font-semibold text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando exames...
        </p>
      ) : exames.length === 0 ? (
        <p className="mt-4 text-[11px] font-semibold text-slate-400">
          Nenhum exame anexado. PDF ou foto, até 20 MB.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-[#081b2c]/[0.06]">
          {exames.map((exame) => {
            const Icone = exame.mime === 'application/pdf' ? FileText : FileImage
            return (
              <li key={exame.id} className="flex items-center gap-3 py-2.5">
                <Icone className="h-4 w-4 shrink-0 text-[#6d28d9]" />
                <button
                  type="button"
                  onClick={() => void abrir(exame)}
                  className="min-w-0 flex-1 text-left"
                  title="Ver o exame"
                >
                  <span className="block truncate text-[12px] font-extrabold text-[#081b2c] hover:underline">
                    {exame.titulo}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400">
                    {exame.dataExame ? fmtBR(exame.dataExame) : 'sem data'} · {tamanhoLegivel(exame.tamanho)}
                  </span>
                </button>
                {abrindo === exame.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
                <button
                  type="button"
                  onClick={() => void remover(exame)}
                  className="rounded-lg p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                  aria-label={`Remover ${exame.titulo}`}
                  title="Remover da lista"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <VisualizadorDeArquivo arquivo={aberto} onFechar={() => setAberto(null)} />
    </div>
  )
}
