/**
 * Uma conversa do simulador: o papel do meta-webhook, sem Meta e sem banco.
 *
 * O robo e o de producao (motor.js). O que fica aqui e o que o webhook faz em
 * volta dele: ler o estado da conversa e os pacientes do telefone, chamar
 * tratarConversa, montar o que chega no celular (montarMensagens) e acender a
 * bandeira de atencao do jeito que a producao acende. Quando o webhook mudar
 * essa parte, esta precisa acompanhar - o robo em si acompanha sozinho.
 *
 * Nada aqui conhece React: o mesmo arquivo roda na pagina e em
 * tests/simulador.test.mjs.
 */
import { BancoFalso, type Escrita, type Linha } from './banco-falso'
import { horariosLivres, tabelasDaAgenda, type AgendaDaClinica } from './agenda'
import { bancoInicial, type Familia, type Identidade } from './dados'
import { colherEventos, montarMensagens, tratarConversa, type Toque } from './motor.js'
import {
  BOTOES_URGENCIA_OU_DUVIDA,
  contextoDaLeitura,
  decidirSegundaLeitura,
  descreverLeituraDoJev,
  PERGUNTA_URGENCIA_OU_DUVIDA,
  precisaDeLeitura,
  temBotaoDeUrgencia,
  type Decisao,
  type Leitura,
  type ModoDaSegundaLeitura,
} from '../../supabase/functions/_shared/segunda-leitura.ts'

/**
 * Quem pergunta ao Jev no simulador (17/10/2026): no sistema, a funcao
 * jev-ler, pelo servidor, porque a chave nao pode vir para o navegador. modo
 * null = nao deu para perguntar (rede, sessao). Sem leitor, o simulador e o de
 * sempre: o arquivo da reuniao nao tem login nem rede.
 */
export type LeitorDoJev = (entrada: {
  texto: string
  anteriores: string[]
  ultimaDoRobo: string
}) => Promise<{ modo: ModoDaSegundaLeitura | null; leitura: Leitura | null }>

export type Autor = 'familia' | 'robo' | 'equipe'

export type Toques =
  | { tipo: 'botoes'; opcoes: Toque[] }
  | { tipo: 'lista'; rotulo: string; opcoes: Toque[] }

export type Mensagem = {
  id: string
  autor: Autor
  texto: string
  em: Date
  /** Foto ou documento: o robo nao le, so sabe que veio. */
  anexo?: boolean
  toques?: Toques
}

export type Tom = 'neutro' | 'bom' | 'atencao' | 'alerta'

/** Uma linha dos bastidores: o que o robo fez ou gravou. */
export type Registro = {
  id: string
  em: Date
  tipo: 'evento' | 'consulta' | 'cadastro' | 'ficha' | 'bandeira' | 'alerta'
  titulo: string
  detalhe?: string
  tom: Tom
}

/**
 * A notificacao que chegaria no celular de quem recebe o alerta de
 * sangramento (15/10/2026). Em producao e o aviso no celular da equipe (ver
 * _shared/aviso-da-equipe.ts); aqui a tela desenha a notificacao, para a
 * reuniao ver o que o Dr. Fabio e a Dayane receberiam.
 */
export type Alerta = {
  id: string
  em: Date
  para: string[]
  titulo: string
  texto: string
}

export type Situacao = 'robo' | 'aguardando_equipe' | 'equipe' | 'resolvida'

const CONVERSA = 'conversa-simulada'

const NOME_DA_OPCAO: Record<string, string> = {
  '1': 'Dúvidas sobre a consulta',
  '2': 'Marcar uma consulta',
  '3': 'Falar com a equipe',
  '4': 'Minha consulta',
  '5': '2ª via ou exame',
}

/** Os mesmos rotulos das etiquetas da tela de Respostas (Conversations.tsx). */
export const MOTIVOS: Record<string, { rotulo: string; tom: Tom }> = {
  atendente: { rotulo: 'Quer falar com a equipe', tom: 'alerta' },
  urgencia: { rotulo: '🚨 Urgência: ligar agora', tom: 'alerta' },
  sangramento: { rotulo: '🩸 Sangramento: ligar agora', tom: 'alerta' },
  falha: { rotulo: 'Falha no atendimento automático', tom: 'alerta' },
  anexo: { rotulo: '📎 Enviou um arquivo', tom: 'atencao' },
  documento: { rotulo: '📄 Pediu 2ª via / exame', tom: 'atencao' },
  farmacia: { rotulo: '🏥 Farmácia/laboratório', tom: 'atencao' },
  numero_errado: { rotulo: '☎️ Número errado no cadastro', tom: 'atencao' },
  cancelou_sozinho: { rotulo: 'Cancelou pelo WhatsApp', tom: 'atencao' },
}

export const ETAPAS: Record<string, string> = {
  menu: 'No menu de opções',
  minha_consulta: 'Vendo a consulta marcada',
  confirmar_cancelamento: 'Confirmando o cancelamento',
  ja_tem_consulta: 'Já tem consulta marcada',
  aguardando_paciente: 'Escolhendo para quem é a consulta',
  aguardando_unidade: 'Escolhendo a unidade',
  aguardando_convenio: 'Escolhendo convênio ou particular',
  aguardando_dia: 'Escolhendo o dia',
  aguardando_horario: 'Escolhendo o horário',
  dados_nome: 'Ficha: nome do paciente',
  dados_nascimento: 'Ficha: data de nascimento',
  dados_responsavel: 'Ficha: responsável (menor de idade)',
  dados_motivo: 'Ficha: motivo da consulta',
  dados_cpf: 'Ficha: CPF do paciente',
  dados_email: 'Ficha: e-mail',
  informacoes_unidade: 'Lendo as informações da unidade',
  atendente: 'Na fila da equipe',
  documento_quem: 'Pedido de documento: quem pede',
  documento_paciente: 'Pedido de documento: qual paciente',
  documento_tipo: 'Pedido de documento: receita ou exame',
  documento_item: 'Pedido de documento: qual item',
  documento_exigencia: 'Pedido de documento: o que foi pedido',
  documento_farmacia: 'Pedido de documento: farmácia',
}

/** O sinal de alarme do otorrino, como a tela conta (ver sinalDeAlarme). */
const SINAIS: Record<string, string> = {
  corpo_estranho: 'corpo estranho',
  respiracao: 'respiração',
  surdez: 'surdez súbita',
  tontura: 'tontura forte',
  engolir: 'não consegue engolir',
  rosto: 'rosto ou fala',
  pos_operatorio: 'pós-operatório',
  mal_estar: 'passando mal',
}

const EVENTOS: Record<string, (detalhe?: string) => { titulo: string; tom: Tom } | null> = {
  menu_enviado: () => ({ titulo: 'Mostrou o menu de opções', tom: 'neutro' }),
  // A consulta gravada ja aparece pela escrita em appointments, com dia e
  // unidade; o evento repetiria a mesma linha sem eles.
  agendou: () => null,
  remarcou: () => null,
  duvida_para_equipe: () => ({ titulo: 'Dúvida sem resposta pronta: passou para a equipe', tom: 'atencao' }),
  opcao_escolhida: (d) => ({ titulo: `Paciente escolheu: ${NOME_DA_OPCAO[d ?? ''] ?? `opção ${d}`}`, tom: 'neutro' }),
  nao_entendi: () => ({ titulo: 'Não entendeu a resposta e explicou de novo', tom: 'atencao' }),
  ficha_oferecida: () => ({ titulo: 'Começou a pedir os dados do cadastro', tom: 'neutro' }),
  ficha_retomada: () => ({ titulo: 'Retomou o cadastro de onde parou', tom: 'neutro' }),
  cancelou: () => ({ titulo: 'O paciente cancelou a consulta', tom: 'atencao' }),
  calou_com_equipe: () => ({ titulo: 'Ficou em silêncio: a equipe está conversando', tom: 'neutro' }),
  aviso_do_dia: (d) => ({ titulo: `Recado do dia da consulta (${d === 'chegada' ? 'chegou' : 'atraso'})`, tom: 'atencao' }),
  assunto_clinico: () => ({ titulo: 'Assunto clínico: o robô não orienta e passa para a equipe', tom: 'atencao' }),
  controlado_bloqueado: () => ({ titulo: 'Remédio controlado: passou para a equipe', tom: 'atencao' }),
  nota_fiscal_pedida: () => ({ titulo: 'Pedido de nota fiscal', tom: 'atencao' }),
  numero_errado: () => ({ titulo: 'Número errado: avisou a equipe', tom: 'atencao' }),
  retorno_distante: () => ({ titulo: 'Retorno além da agenda aberta: anotado para a equipe', tom: 'atencao' }),
  resposta_automatica_da_familia: () => ({ titulo: 'Resposta automática do WhatsApp do paciente: ignorada', tom: 'neutro' }),
  acompanhamento_recado: () => ({ titulo: 'Recado do paciente: guardado para o médico', tom: 'atencao' }),
  // O alerta em si vira linha propria, com quem recebeu (ver enviarDaFamilia).
  alerta_sangramento: () => ({ titulo: 'Falou em sangramento: alerta disparado', tom: 'alerta' }),
  sinal_de_alarme: (d) => ({ titulo: `Sinal de alarme${d ? ` (${SINAIS[d] ?? d})` : ''}: pronto-socorro e alerta`, tom: 'alerta' }),
  pos_operatorio: () => ({ titulo: 'Paciente operado: passou para a equipe', tom: 'atencao' }),
  outro_medico: () => ({ titulo: 'Citou outro médico: explicou que aqui é outro consultório', tom: 'atencao' }),
  chamar_equipe_junto: () => ({ titulo: 'Dúvida que a equipe confirma: conversa acesa, agendamento segue', tom: 'atencao' }),
  em_ingles: () => ({ titulo: 'Escreveu em inglês: passou para a equipe', tom: 'atencao' }),
  pergunta_de_agenda: () => ({ titulo: 'Perguntou da agenda: respondeu com os dias e horários livres', tom: 'neutro' }),
  cpf_depois: () => ({ titulo: 'CPF mandado depois: guardado no cadastro', tom: 'bom' }),
  nao_entendi_repetido: () => ({ titulo: 'Terceiro "não entendi" seguido: chamou a equipe', tom: 'alerta' }),
  acompanhamento_agradeceu: () => ({ titulo: 'Agradecimento depois do acompanhamento', tom: 'neutro' }),
  chamou_equipe: (d) => ({ titulo: `Chamou a equipe: ${MOTIVOS[d ?? '']?.rotulo ?? d}`, tom: MOTIVOS[d ?? '']?.tom ?? 'alerta' }),
  concluiu_sozinho: () => ({ titulo: 'Atendimento concluído sem precisar de ninguém', tom: 'bom' }),
  campo_sem_valor: (d) => ({ titulo: `Texto com campo sem dado: ${d ?? 'confira o cartão da unidade'}`, tom: 'alerta' }),
}

const CAMPOS_DA_FICHA: Record<string, string> = {
  intake_patient_name: 'nome do paciente',
  intake_birth_date: 'data de nascimento',
  intake_guardian: 'responsável',
  intake_complaint: 'motivo da consulta',
  intake_cpf: 'CPF',
  intake_email: 'e-mail',
}

function quando(iso: unknown): string {
  return new Date(String(iso)).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export class Simulacao {
  /** Troca quando a clinica de teste e relida do sistema (atualizarClinica). */
  identidade: Identidade
  readonly familia: Familia
  readonly banco: BancoFalso
  /** Alguem da equipe respondeu: o robo deixa de puxar assunto, como no webhook. */
  equipeConversando = false
  /** O Jev, quando o simulador roda dentro do sistema (ver LeitorDoJev). */
  leitorDoJev: LeitorDoJev | null = null
  /** O modo que o servidor devolveu na ultima leitura, para o selo da tela. */
  ultimoModoDoJev: ModoDaSegundaLeitura | null = null
  private contador = 0
  private relogio: () => Date

  constructor(
    identidade: Identidade,
    familia: Familia,
    opcoes: { agenda?: AgendaDaClinica; relogio?: () => Date } = {},
  ) {
    this.identidade = identidade
    this.familia = familia
    this.relogio = opcoes.relogio ?? (() => new Date())
    const agora = this.relogio()
    this.banco = new BancoFalso(bancoInicial(identidade, opcoes.agenda ?? identidade.agendaPadrao, familia, agora), {
      liberar_reservas_vencidas: () => 0,
      available_slots: (args) => this.horariosLivres(String(args.p_unit_id)),
      available_slots_periodo: (args) =>
        this.horariosLivres(String(args.p_unit_id), {
          de: (args.p_de as string | null | undefined) ?? null,
          ate: (args.p_ate as string | null | undefined) ?? null,
        }),
    })
    this.banco.linhas('whatsapp_conversations').push({
      id: CONVERSA,
      clinic_id: identidade.clinicId,
      wa_id: familia.telefone,
      profile_name: familia.nomeDoPerfil,
      status: 'open',
      needs_attention: false,
      attention_reason: null,
      booking_state: null,
      auto_replies_while_waiting: 0,
      menu_sent_at: null,
    })
  }

  get conversa(): Linha {
    return this.banco.linhas('whatsapp_conversations')[0]
  }

  /** O available_slots do banco falso: a agenda de agora menos o que ja foi marcado. */
  horariosLivres(unidadeId: string, periodo?: { de: string | null; ate: string | null }): { slot_start: string; slot_end: string }[] {
    const b = this.banco
    return horariosLivres(
      {
        clinic_units: b.linhas('clinic_units'),
        availability_rules: b.linhas('availability_rules'),
        schedule_exceptions: b.linhas('schedule_exceptions'),
        clinic_settings: b.linhas('clinic_settings'),
        appointments: b.linhas('appointments'),
      },
      unidadeId,
      this.relogio(),
      periodo,
    )
  }

  /**
   * A clinica mudou a agenda com a conversa aberta. Vale na proxima mensagem,
   * como no sistema: o robo le unidades e horarios do banco a cada passo. As
   * consultas ja marcadas ficam onde estao.
   */
  /**
   * Textos e respostas prontas novos, com a conversa aberta: a clinica de
   * teste foi relida do sistema. A agenda vem a parte, por aplicarAgenda,
   * porque ela pode ter ajustes feitos so no simulador.
   */
  atualizarClinica(identidade: Identidade) {
    this.identidade = identidade
    this.banco.tabelas.bot_answers = identidade.respostas.map((r) => ({ ...r }))
    for (const s of this.banco.linhas('clinic_settings')) s.telemedicine_info_text = identidade.telemedicina
    for (const c of this.banco.linhas('clinics')) c.name = identidade.nomeNoWhatsApp
  }

  aplicarAgenda(agenda: AgendaDaClinica) {
    const t = tabelasDaAgenda(agenda, this.identidade.clinicId)
    this.banco.tabelas.clinic_units = t.clinic_units
    this.banco.tabelas.availability_rules = t.availability_rules
    this.banco.tabelas.schedule_exceptions = t.schedule_exceptions
    for (const s of this.banco.linhas('clinic_settings')) Object.assign(s, t.configuracoes)
  }

  get etapa(): string | null {
    return (this.conversa.booking_state as string | null) ?? null
  }

  get situacao(): Situacao {
    const c = this.conversa
    if (c.status === 'resolved') return 'resolvida'
    if (this.equipeConversando) return 'equipe'
    if (c.needs_attention) return 'aguardando_equipe'
    return 'robo'
  }

  get motivo(): string | null {
    return this.conversa.needs_attention ? ((this.conversa.attention_reason as string | null) ?? null) : null
  }

  /** Consultas deste telefone, da mais proxima em diante. */
  consultas(): Linha[] {
    const unidades = this.banco.linhas('clinic_units')
    return this.banco
      .linhas('appointments')
      .filter((c) => c.contact_phone === this.familia.telefone)
      .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))
      .map((c) => ({ ...c, unidade: unidades.find((u) => u.id === c.unit_id)?.name ?? '' }))
  }

  pacientes(): Linha[] {
    return this.banco.linhas('patients').filter((p) => p.phone === this.familia.telefone && !p.archived_at)
  }

  /**
   * Mensagem da familia. Toque em botao ou lista chega com o id da opcao, que
   * e o que o robo le (o webhook faz igual); o titulo e so o que aparece.
   */
  async enviarDaFamilia(entrada: { texto: string; idDoToque?: string; anexo?: boolean }): Promise<{
    familia: Mensagem
    respostas: Mensagem[]
    registros: Registro[]
    /** Notificacoes no celular de quem recebe o alerta de sangramento. */
    alertas: Alerta[]
  }> {
    const agora = this.relogio()
    const familia = this.mensagem('familia', entrada.anexo ? entrada.texto || '📷 Foto' : entrada.texto, agora, {
      anexo: entrada.anexo,
    })
    const conversa = this.conversa
    // Mensagem nova da familia reabre conversa resolvida, como no webhook.
    if (conversa.status === 'resolved') conversa.status = 'open'
    const escritasAntes = this.banco.escritas.length
    const atencaoAntes = { ligada: Boolean(conversa.needs_attention), motivo: conversa.attention_reason as string | null }

    const pacientes = this.pacientes()
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map((p) => ({
        id: String(p.id),
        name: String(p.name ?? ''),
        nascimento: (p.birth_date as string | null) ?? null,
        responsavel: (p.guardian_name as string | null) ?? null,
        cpf: (p.cpf as string | null) ?? null,
        email: (p.email as string | null) ?? null,
      }))
    const nomePorId = new Map(pacientes.map((p) => [p.id, p.name]))
    const unidades = this.banco.linhas('clinic_units')
    const futuras = this.consultas().filter(
      (c) => c.status === 'scheduled' && new Date(String(c.starts_at)).getTime() >= agora.getTime(),
    )
    // O Jev (17/10/2026), na ordem do meta-webhook: a leitura comeca antes do
    // robo, com as mensagens de antes (sem a de agora), e a decisao vem
    // depois, com o que o robo respondeu.
    const motivoAceso = conversa.needs_attention ? ((conversa.attention_reason as string | null) ?? null) : null
    const leituraDoJev =
      this.leitorDoJev && !entrada.anexo && precisaDeLeitura(entrada.texto, Boolean(entrada.idDoToque), motivoAceso)
        ? this.leitorDoJev({ texto: entrada.texto, ...contextoDaLeitura(this.historicoParaOJev()) }).catch(
            (erro): { modo: null; leitura: Leitura } => ({ modo: null, leitura: { ok: false, erro: String((erro as Error)?.message ?? erro) } }),
          )
        : null

    // A mensagem da familia entra no historico ANTES do robo, como o webhook
    // grava (16/10/2026): o robo le as mensagens de antes da conversa - a
    // queixa contada na primeira, por exemplo - e precisa ver a de agora tambem.
    const historico = this.banco.linhas('whatsapp_messages')
    historico.push({ conversation_id: CONVERSA, direction: 'inbound', automatic: false, body: familia.texto, created_at: agora.toISOString() })

    const hoje = agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
    const consultaHoje = this.consultas().some(
      (c) =>
        ['scheduled', 'attended'].includes(String(c.status)) &&
        new Date(String(c.starts_at)).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) === hoje,
    )

    const resultado = await tratarConversa({
      admin: this.banco,
      clinicId: this.identidade.clinicId,
      conversationId: CONVERSA,
      estadoAtual: (conversa.booking_state as string | null) ?? null,
      opcoesAtuais: conversa.booking_options ?? null,
      unidadeEmAndamento: (conversa.booking_unit_id as string | null) ?? null,
      modalidadeEmAndamento: (conversa.booking_modality as 'presencial' | 'telemedicina' | null) ?? null,
      podeIniciarMenu: !this.equipeConversando,
      posAcompanhamento: false,
      consultaHoje,
      motivoDaAtencao: (conversa.attention_reason as string | null) ?? null,
      texto: entrada.anexo ? '' : (entrada.idDoToque ?? entrada.texto),
      telefone: this.familia.telefone,
      pacientes,
      pacienteEmAndamento: (conversa.booking_patient_id as string | null) ?? null,
      consultas: futuras.map((c) => ({
        id: String(c.id),
        inicio: String(c.starts_at),
        unidade: String(c.unidade || 'nossa unidade'),
        endereco: String(unidades.find((u) => u.id === c.unit_id)?.address ?? ''),
        paciente: (c.patient_id ? nomePorId.get(String(c.patient_id)) : null) ?? String(c.contact_name ?? ''),
        confirmada: Boolean(c.confirmed_by_clinic),
      })),
      consultaASubstituir: (conversa.booking_replaces_id as string | null) ?? null,
      consultaEmCadastro: (conversa.booking_intake_id as string | null) ?? null,
      convenioEmAndamento: (conversa.booking_insurance as string | null) ?? null,
      respostasNaEspera: Number(conversa.auto_replies_while_waiting ?? 0),
      anexo: Boolean(entrada.anexo),
      jaViuOMenu: Boolean(conversa.menu_sent_at),
      nomeDoPerfil: this.familia.nomeDoPerfil,
      textos: this.identidade.textos,
      agora,
    })

    // A decisao do Jev (ver decidirSegundaLeitura): so acrescenta. A urgencia
    // que ele leu entra no lugar do motivo que a regra deu, como no webhook.
    let decisaoJev: Decisao | null = null
    let falhaDoJev: string | null = null
    if (leituraDoJev) {
      const { modo, leitura } = await leituraDoJev
      if (modo === null) {
        falhaDoJev = leitura && !leitura.ok ? leitura.erro : 'sem resposta'
      } else {
        this.ultimoModoDoJev = modo
        if (modo !== 'desligada') {
          decisaoJev = decidirSegundaLeitura(leitura, {
            modo,
            motivoDoRobo: resultado?.atencao ?? motivoAceso,
            roboRespondeu: Boolean(resultado),
            jaTemBotaoDeUrgencia: temBotaoDeUrgencia(resultado),
          })
          if (resultado && decisaoJev.atencao) {
            resultado.atencao = decisaoJev.atencao
            resultado.concluida = false
          }
        }
      }
    }

    // A bandeira de atencao, na mesma ordem do meta-webhook: concluida fecha,
    // pedido de gente acende com o motivo, e silencio acende com o motivo que
    // ja havia (ou "atendente"). Calar sem acender e o defeito de 22/09/2026.
    const eventos = colherEventos(CONVERSA)
    if (resultado) {
      // Bandeira que ja estava acesa nao se apaga por conclusao do robo.
      if (resultado.concluida && !resultado.atencao && !atencaoAntes.ligada) {
        Object.assign(conversa, { status: 'resolved', needs_attention: false, attention_reason: null })
      }
      if (resultado.atencao) Object.assign(conversa, { needs_attention: true, attention_reason: resultado.atencao })
      if (resultado.atencao) eventos.push({ evento: 'chamou_equipe', detalhe: resultado.atencao })
      if (resultado.concluida) eventos.push({ evento: 'concluiu_sozinho' })
    } else {
      Object.assign(conversa, {
        needs_attention: true,
        attention_reason: decisaoJev?.atencao ?? (conversa.attention_reason || 'atendente'),
      })
    }

    // A resposta tambem no banco falso, como o webhook grava: e dali que o
    // robo confere se uma resposta pronta acabou de sair (jaMandada).
    if (resultado?.resposta) {
      historico.push({ conversation_id: CONVERSA, direction: 'outbound', automatic: true, body: resultado.resposta, created_at: agora.toISOString() })
    }

    const respostas: Mensagem[] = []
    if (resultado?.resposta) {
      const enviadas = montarMensagens(
        resultado.resposta,
        resultado.botoes || resultado.lista ? { botoes: resultado.botoes, lista: resultado.lista } : undefined,
      )
      for (const m of enviadas) {
        if (m.type === 'text') {
          respostas.push(this.mensagem('robo', m.text.body, agora))
        } else if (m.interactive.type === 'button') {
          respostas.push(
            this.mensagem('robo', m.interactive.body.text, agora, {
              toques: {
                tipo: 'botoes',
                opcoes: m.interactive.action.buttons.map((b) => ({ id: b.reply.id, titulo: b.reply.title })),
              },
            }),
          )
        } else {
          respostas.push(
            this.mensagem('robo', m.interactive.body.text, agora, {
              toques: {
                tipo: 'lista',
                rotulo: m.interactive.action.button,
                opcoes: m.interactive.action.sections[0].rows.map((r) => ({
                  id: r.id,
                  titulo: r.title,
                  descricao: r.description,
                })),
              },
            }),
          )
        }
      }
    }
    // A pergunta do Jev vai depois da resposta, numa mensagem propria, como
    // no webhook, e entra no historico do banco falso.
    if (resultado?.resposta && decisaoJev?.botoes) {
      respostas.push(
        this.mensagem('robo', PERGUNTA_URGENCIA_OU_DUVIDA, agora, {
          toques: { tipo: 'botoes', opcoes: BOTOES_URGENCIA_OU_DUVIDA.map((b) => ({ id: b.id, titulo: b.titulo })) },
        }),
      )
      historico.push({
        conversation_id: CONVERSA, direction: 'outbound', automatic: true, body: PERGUNTA_URGENCIA_OU_DUVIDA, created_at: agora.toISOString(),
      })
    }

    const registros = [
      ...eventos.flatMap((e) => {
        const traduzir = EVENTOS[e.evento]
        const r = traduzir ? traduzir(e.detalhe) : { titulo: e.evento.replace(/_/g, ' '), tom: 'neutro' as Tom }
        return r ? [this.registro('evento', r.titulo, r.tom, agora)] : []
      }),
      ...this.traduzirEscritas(this.banco.escritas.slice(escritasAntes), agora),
    ]
    if (!resultado) {
      registros.push(this.registro('evento', 'Ficou em silêncio: quem responde agora é a equipe', 'neutro', agora))
    }
    // A nota do Jev em cada mensagem lida, e a falha quando nao deu para
    // perguntar: quem testa precisa ver que ele esta lendo.
    if (decisaoJev) {
      const lida = descreverLeituraDoJev(decisaoJev.detalhe)
      const tom: Tom = lida.tom === 'erro' ? 'alerta' : lida.tom === 'alerta' ? 'atencao' : 'neutro'
      registros.push(this.registro('evento', `Jev: ${lida.texto}`, tom, agora))
    } else if (falhaDoJev) {
      registros.push(this.registro('evento', `Jev: não consegui perguntar (${falhaDoJev}). O robô seguiu como sempre.`, 'alerta', agora))
    }
    const motivoAgora = this.motivo
    if (motivoAgora && (!atencaoAntes.ligada || atencaoAntes.motivo !== motivoAgora)) {
      const m = MOTIVOS[motivoAgora]
      registros.push(this.registro('bandeira', `Conversa acesa na lista: ${m?.rotulo ?? motivoAgora}`, m?.tom ?? 'alerta', agora))
    }

    // Sangramento e urgencia: a notificacao que chega no celular de quem recebe
    // o alerta, a cada mensagem - como o aviso da equipe faz em producao, que
    // marca os dois como urgentes (ver aviso-da-equipe.ts). A urgencia entrou
    // em 16/10/2026, com os sinais de alarme do otorrino.
    const alertas: Alerta[] = []
    // Robo calado (a equipe conversando) com urgencia lida pelo Jev tambem
    // toca o celular, como no webhook (17/10/2026).
    const motivoDoAlerta = resultado ? resultado.atencao : decisaoJev?.atencao
    const urgente = motivoDoAlerta === 'sangramento' || motivoDoAlerta === 'urgencia'
    if (urgente && this.identidade.alertaPara.length > 0) {
      const pacientes = this.pacientes()
      const quem = pacientes.length === 1 ? String(pacientes[0].name) : this.familia.nomeDoPerfil
      const titulo = motivoDoAlerta === 'sangramento' ? `🩸 Sangramento: ${quem}` : `🚨 Urgência: ${quem}`
      this.contador += 1
      alertas.push({ id: `a${this.contador}`, em: agora, para: this.identidade.alertaPara, titulo, texto: familia.texto })
      registros.push(
        this.registro('alerta', `📲 Alerta no celular: ${this.identidade.alertaPara.join(' e ')}`, 'alerta', agora, `"${familia.texto.slice(0, 120)}"`),
      )
    }

    return { familia, respostas, registros, alertas }
  }

  /** O historico do banco falso como o webhook le para o Jev: da mais nova para a mais antiga. */
  private historicoParaOJev() {
    return [...this.banco.linhas('whatsapp_messages')].reverse().map((m) => ({
      direction: String(m.direction),
      body: (m.body as string | null) ?? null,
      automatic: (m.automatic as boolean | null) ?? null,
    }))
  }

  /** A equipe assume a conversa: a partir daqui o robo so fala se for chamado. */
  responderComoEquipe(texto: string): { mensagem: Mensagem; registros: Registro[] } {
    const agora = this.relogio()
    const registros: Registro[] = []
    if (!this.equipeConversando) {
      registros.push(this.registro('evento', 'A equipe assumiu a conversa: o robô não fala por cima', 'neutro', agora))
    }
    this.equipeConversando = true
    Object.assign(this.conversa, { needs_attention: false, attention_reason: null, status: 'open' })
    this.banco.linhas('whatsapp_messages').push({
      conversation_id: CONVERSA, direction: 'outbound', automatic: false, body: texto, created_at: agora.toISOString(),
    })
    return { mensagem: this.mensagem('equipe', texto, agora), registros }
  }

  /** Concluir na tela de Respostas: a conversa sai da lista e o robo volta. */
  concluir(): Registro[] {
    this.equipeConversando = false
    Object.assign(this.conversa, {
      status: 'resolved',
      needs_attention: false,
      attention_reason: null,
      booking_state: null,
      booking_options: null,
      auto_replies_while_waiting: 0,
    })
    return [this.registro('evento', 'Conversa concluída pela equipe: a próxima mensagem volta para o robô', 'bom', this.relogio())]
  }

  private traduzirEscritas(escritas: Escrita[], agora: Date): Registro[] {
    const registros: Registro[] = []
    const unidade = (id: unknown) => this.banco.linhas('clinic_units').find((u) => u.id === id)?.name ?? ''
    for (const e of escritas) {
      if (e.tabela === 'appointments' && e.tipo === 'insert') {
        for (const c of e.linhas) {
          const onde = c.modality === 'telemedicina' ? 'telemedicina' : unidade(c.unit_id)
          registros.push(
            this.registro(
              'consulta',
              c.rescheduled_from ? 'Consulta remarcada na agenda' : 'Consulta marcada na agenda',
              'bom',
              agora,
              `${quando(c.starts_at)} · ${onde} · ${c.contact_name || 'sem nome ainda'} · ${c.insurance ? String(c.insurance) : 'particular'}`,
            ),
          )
        }
      }
      if (e.tabela === 'appointments' && e.tipo === 'update') {
        if (e.mudanca?.status === 'cancelled') {
          for (const c of e.linhas) {
            registros.push(this.registro('consulta', 'Consulta cancelada: o horário voltou a ficar livre', 'atencao', agora, `${quando(c.starts_at)} · ${unidade(c.unit_id)}`))
          }
        }
        for (const [coluna, rotulo] of Object.entries(CAMPOS_DA_FICHA)) {
          if (e.mudanca && coluna in e.mudanca && e.mudanca[coluna]) {
            registros.push(this.registro('ficha', `Ficha da consulta: ${rotulo}`, 'neutro', agora, String(e.mudanca[coluna])))
          }
        }
      }
      if (e.tabela === 'patients' && e.tipo === 'insert') {
        for (const p of e.linhas) {
          registros.push(this.registro('cadastro', 'Paciente cadastrado no sistema', 'bom', agora, String(p.name ?? '')))
        }
      }
      if (e.tabela === 'patients' && e.tipo === 'update') {
        registros.push(this.registro('cadastro', 'Cadastro do paciente completado', 'bom', agora, Object.keys(e.mudanca ?? {}).join(', ')))
      }
    }
    return registros
  }

  private mensagem(autor: Autor, texto: string, em: Date, extra: Partial<Mensagem> = {}): Mensagem {
    this.contador += 1
    return { id: `m${this.contador}`, autor, texto, em, ...extra }
  }

  private registro(tipo: Registro['tipo'], titulo: string, tom: Tom, em: Date, detalhe?: string): Registro {
    this.contador += 1
    return { id: `r${this.contador}`, tipo, titulo, tom, em, detalhe }
  }
}
