/**
 * A clinica de teste do sistema virando a identidade "demo" do simulador.
 *
 * Pedido de 14/10/2026: o que for configurado na conta de teste (Consultorio
 * Central de Cuidado, a mesma da demonstracao) tem de chegar sozinho ao
 * simulador - unidades, enderecos, textos das unidades, horarios, datas,
 * preferencias da agenda, saudacao e respostas prontas. Antes disso o
 * simulador tinha uma copia fixa, e mudar o endereco no sistema nao mudava
 * nada na demonstracao.
 *
 * Aqui so a traducao das linhas do banco, sem rede: o mesmo arquivo roda no
 * teste. Quem le o banco e ler-clinica.ts. Nenhuma linha de paciente ou de
 * consulta passa por aqui; as consultas da demonstracao continuam no banco
 * falso.
 */
import type { Linha } from './banco-falso'
import type { AgendaDaClinica } from './agenda'
import type { Identidade } from './dados'

export type LinhasDaClinica = {
  clinica: Linha | null
  unidades: Linha[]
  regras: Linha[]
  excecoes: Linha[]
  configuracoes: Linha | null
  respostas: Linha[]
}

const texto = (v: unknown) => (typeof v === 'string' ? v : '')
const hora = (v: unknown) => texto(v).slice(0, 5)

/** O coalesce de available_slots: nulo vira o padrao do banco, zero continua zero. */
function numero(v: unknown, padrao: number) {
  const n = Number(v)
  return v === null || v === undefined || !Number.isFinite(n) ? padrao : n
}

/**
 * A identidade demo com o que esta no sistema. O que nao vier (coluna que o
 * banco ainda nao tem, texto vazio) fica como no sistema - vazio -, e nao
 * como na copia fixa: o robo da demonstracao tem de responder o que o robo da
 * clinica de teste responderia.
 */
export function identidadeDoSistema(base: Identidade, linhas: LinhasDaClinica): Identidade {
  const cfg = linhas.configuracoes ?? {}
  const ativas = linhas.unidades.filter((u) => !u.archived_at)
  const agenda: AgendaDaClinica = {
    versao: 1,
    unidades: ativas.map((u) => ({
      id: String(u.id),
      nome: texto(u.name),
      endereco: texto(u.address),
      informacoes: texto(u.info_text),
      valor: Number(u.price_cents) > 0 ? Number(u.price_cents) : null,
      convenio: texto(u.accepts_insurance),
      telemedicina: u.telemedicina === true,
      periodos: linhas.regras
        .filter((r) => r.unit_id === u.id)
        .map((r) => ({ id: String(r.id), weekday: Number(r.weekday), inicio: hora(r.starts_at), fim: hora(r.ends_at) }))
        .sort((a, b) => a.weekday - b.weekday || a.inicio.localeCompare(b.inicio)),
    })),
    datasExtras: linhas.excecoes
      .filter((e) => !e.is_closed)
      .map((e) => ({
        id: String(e.id),
        data: texto(e.exception_date),
        inicio: hora(e.starts_at),
        fim: hora(e.ends_at),
        unidadeId: e.unit_id ? String(e.unit_id) : null,
      })),
    bloqueios: linhas.excecoes
      .filter((e) => e.is_closed)
      .map((e) => ({ id: String(e.id), data: texto(e.exception_date), motivo: texto(e.reason), unidadeId: e.unit_id ? String(e.unit_id) : null })),
    preferencias: {
      duracao: numero(cfg.schedule_slot_minutes, 40),
      janela: numero(cfg.schedule_horizon_days, 15),
      antecedencia: numero(cfg.schedule_min_notice_hours, 2),
    },
    telemedicinaAtiva: cfg.telemedicine_enabled === true,
    telemedicinaValor: Number(cfg.telemedicine_price_cents) > 0 ? Number(cfg.telemedicine_price_cents) : null,
  }

  return {
    ...base,
    nomeNoWhatsApp: texto(linhas.clinica?.name) || base.nomeNoWhatsApp,
    textos: {
      saudacao: texto(cfg.whatsapp_autoreply_text),
      saudacaoConhecida: texto(cfg.whatsapp_autoreply_known_text),
      informacoes: texto(cfg.whatsapp_menu_info_text),
    },
    telemedicina: texto(cfg.telemedicine_info_text),
    respostas: linhas.respostas.map((r) => ({ ...r, clinic_id: base.clinicId })),
    agendaPadrao: agenda,
  }
}
