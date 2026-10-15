/**
 * Quem atende e quem escreve, no simulador.
 *
 * ESPELHO DO DR. FABIO DARIO (15/10/2026). O simulador nasceu no sistema do
 * Dr. Marcello Ruiz com duas identidades: a demonstracao (Dra. Ana, ficticia)
 * e a clinica real dele. Aqui fica uma so: o consultorio do Dr. Fabio Dario,
 * otorrinolaringologista, montado com o que esta publicado no site
 * (drfabiopavanidario.com.br), no Instagram (@drfabiodario, post de 31/08/2026
 * sobre Unimed Santos e Porto Saude) e no relatorio da Cintia (convenios,
 * a Dayane, o alerta de sangramento). Nada da clinica do Dr. Marcello entra
 * aqui: a demonstracao vai para a frente do Dr. Fabio.
 *
 * O id e o de CLINICA_DR_FABIO (_shared/quem-atende.ts): e por ele que o robo
 * escolhe o perfil - fala com o proprio paciente, adulto ou crianca, tem o
 * alerta de sangramento e o pronto-socorro com os convenios.
 *
 * O QUE AINDA E EXEMPLO, porque nao esta publicado em lugar nenhum: os dias e
 * horarios de cada unidade e o valor da consulta particular. A aba Agenda do
 * simulador edita tudo isso na hora, e o que for mudado fica salvo neste
 * navegador. Confirmar com o consultorio antes de virar sistema de verdade.
 *
 * Os textos aqui nao sao lidos do banco: a demonstracao precisa funcionar
 * igual na reuniao, sem depender de rede.
 */
import type { Linha } from './banco-falso'
import { horariosLivres, tabelasDaAgenda, type AgendaDaClinica } from './agenda'
import { CLINICA_DR_FABIO } from '../../supabase/functions/_shared/quem-atende.ts'

export type ChaveIdentidade = 'fabio'

export type Identidade = {
  chave: ChaveIdentidade
  rotulo: string
  clinicId: string
  /** Como a clinica aparece no topo da conversa, no celular do paciente. */
  nomeNoWhatsApp: string
  medico: string
  respostas: Linha[]
  telemedicina: string
  textos: { saudacao: string; saudacaoConhecida: string; informacoes: string }
  agendaPadrao: AgendaDaClinica
  /** Quem recebe no celular o alerta de sangramento, para a tela mostrar a notificacao. */
  alertaPara: string[]
  /** Quem da equipe responde as conversas, nos roteiros e na tela. */
  equipe: string
}

/** Um periodo semanal da agenda padrao, hora de Brasilia (0 = domingo). */
const periodo = (id: string, weekday: number, inicio: string, fim: string) => ({ id, weekday, inicio, fim })

// Consulta "sem pressa" (site: "Atendimento exclusivo... sem pressa"): 40 min.
const PREFERENCIAS = { duracao: 40, janela: 21, antecedencia: 2 }

const FECHO =
  '⚡ *Agendar por aqui é mais rápido*: digite *2* e escolha unidade, dia e horário na hora.\n\n' +
  '🙋 Quer falar com a Dayane ou alguém da equipe? Digite *9*.\n\n' +
  '⏰ Segunda a sexta, 8h às 18h. Fora desse horário, respondemos no próximo dia útil.'

const PALAVRAS_DO_VALOR = ['credito', 'parcela', 'parcelar', 'pix', 'valor', 'valores', 'pagamento', 'preco', 'preço', 'preços', 'pagar', 'quanto', 'recibo', 'cartao', 'cartão', 'custa', 'debito', 'custo', 'particular', 'premium']
const PALAVRAS_DO_ENDERECO = ['local', 'endereco', 'endereço', 'carro', 'localizacao', 'localização', 'onde', 'mapa', 'referencia', 'referência', 'estacionamento', 'estacionar', 'fica', 'chegar', 'rua', 'bairro', 'unidades', 'telefone', 'telefones']

/** Linhas de bot_answers, na ordem em que a clinica cadastrou. */
function respostas(clinicId: string, lista: Omit<Linha, 'id'>[]): Linha[] {
  return lista.map((r, i) => ({ id: `resposta-${i + 1}`, clinic_id: clinicId, is_active: true, position: i, ...r }))
}

const LEVAR = '📋 Traga um documento com foto e os exames anteriores que tiver, como tomografia, endoscopia nasal ou audiometria.'

const FABIO: Identidade = {
  chave: 'fabio',
  rotulo: 'Dr. Fábio Dario · Otorrino',
  clinicId: CLINICA_DR_FABIO,
  nomeNoWhatsApp: 'Dr. Fábio Dario | Otorrino',
  medico: 'Dr. Fábio Dario',
  alertaPara: ['Dr. Fábio', 'Dayane'],
  equipe: 'Dayane',
  agendaPadrao: {
    versao: 1,
    unidades: [
      {
        id: 'unidade-santos',
        nome: 'Santos · Boqueirão',
        endereco: 'Av. Dr. Conselheiro Nébias, 754, sala 2010, Boqueirão, Santos/SP',
        // Instagram (31/08/2026): "atende pelos planos de saude Unimed Santos e
        // Porto Saude". A Dayane cita tambem a Santa Saude.
        convenio: 'Porto Saúde, Unimed Santos, Santa Saúde',
        telemedicina: false,
        // Dias e horarios de EXEMPLO (ver o comentario do topo).
        periodos: [periodo('santos-seg', 1, '14:00', '18:00'), periodo('santos-qua', 3, '08:00', '12:00'), periodo('santos-sex', 5, '08:00', '12:00')],
        valor: null,
        informacoes:
          '💙 *Consulta em Santos (Boqueirão)*: particular ou pelos convênios *Porto Saúde*, *Unimed Santos* e *Santa Saúde*.\n\n' +
          '📍 Av. Dr. Conselheiro Nébias, 754, sala 2010, Boqueirão, Santos/SP.\n' +
          '☎️ (13) 3385-6889\n\n' +
          '📋 Traga um documento com foto, a carteirinha do convênio (se for usar o plano) e os exames anteriores que tiver, como tomografia, endoscopia nasal ou audiometria.',
      },
      {
        id: 'unidade-higienopolis',
        nome: 'Higienópolis · São Paulo',
        endereco: 'Rua Pará, 65, conj. 54, Higienópolis, São Paulo/SP',
        convenio: '',
        telemedicina: false,
        periodos: [periodo('higienopolis-ter', 2, '08:00', '12:00'), periodo('higienopolis-ter-tarde', 2, '14:00', '18:00')],
        valor: null,
        informacoes:
          '💙 *Consulta Particular Premium em Higienópolis*: avaliação completa com o Dr. Fábio, sem pressa, com diagnóstico e plano de tratamento sob medida.\n\n' +
          '💳 Consulta particular. Emitimos recibo para você pedir reembolso ao seu plano.\n\n' +
          '📍 Rua Pará, 65, conj. 54, Higienópolis, São Paulo/SP.\n' +
          '☎️ (11) 4301-1098\n\n' +
          LEVAR,
      },
      {
        id: 'unidade-tatuape',
        nome: 'Tatuapé · São Paulo',
        endereco: 'Rua Serra de Botucatu, 660, conj. 24/25, Vila Gomes Cardim, São Paulo/SP',
        convenio: '',
        telemedicina: false,
        periodos: [periodo('tatuape-qui', 4, '14:00', '18:00')],
        valor: null,
        informacoes:
          '💙 *Consulta Particular Premium no Tatuapé*: avaliação completa com o Dr. Fábio, sem pressa, com diagnóstico e plano de tratamento sob medida.\n\n' +
          '💳 Consulta particular. Emitimos recibo para você pedir reembolso ao seu plano.\n\n' +
          '📍 Rua Serra de Botucatu, 660, conj. 24/25, Vila Gomes Cardim, São Paulo/SP.\n' +
          '☎️ (11) 3569-1097\n\n' +
          LEVAR,
      },
    ],
    datasExtras: [],
    bloqueios: [],
    preferencias: PREFERENCIAS,
    // Otorrino examina (nasofibroscopia, otoscopia): sem telemedicina.
    telemedicinaAtiva: false,
    telemedicinaValor: null,
  },
  respostas: respostas(CLINICA_DR_FABIO, [
    {
      subject: 'Valor e pagamento',
      keywords: PALAVRAS_DO_VALOR,
      answer:
        '💙 *Consulta com o Dr. Fábio*\n\n' +
        '• *Particular (Consulta Particular Premium)*, nas três unidades: avaliação completa, sem pressa, com diagnóstico e plano de tratamento sob medida.\n' +
        '• *Convênio*, em Santos (Boqueirão): Porto Saúde, Unimed Santos e Santa Saúde.\n\n' +
        '💳 O valor da consulta particular e as formas de pagamento a nossa equipe passa por aqui. Emitimos recibo para você pedir reembolso ao seu plano.',
      ask_unit: true,
    },
    {
      subject: 'Convênios',
      keywords: ['convenio', 'convênio', 'convenios', 'convênios', 'plano', 'planos', 'aceita', 'aceitam', 'cobertura', 'coberto', 'credenciado', 'credenciada', 'carteirinha', 'reembolso', 'unimed', 'porto', 'santa', 'amil', 'bradesco', 'sulamerica', 'sulamérica', 'notredame', 'intermedica', 'hapvida', 'cassi', 'golden', 'prevent', 'omint', 'careplus', 'seguro', 'seguros'],
      answer:
        '💳 *Convênios*\n\n' +
        'Em *Santos (Boqueirão)*, o Dr. Fábio atende pelos planos *Porto Saúde*, *Unimed Santos* e *Santa Saúde*, além do particular.\n\n' +
        'Em *São Paulo* (Higienópolis e Tatuapé), a consulta é *particular*. Emitimos recibo para você pedir reembolso ao seu plano.\n\n' +
        'Para marcar pelo convênio, digite *2* e escolha Santos.',
      ask_unit: false,
    },
    {
      subject: 'O que o Dr. Fábio trata',
      keywords: ['trata', 'tratam', 'cuida', 'cuidam', 'especialidade', 'especialista', 'otorrino', 'otorrinolaringologista', 'nariz', 'entupido', 'entupida', 'entupimento', 'ronco', 'ronca', 'roncar', 'roncando', 'apneia', 'desvio', 'septo', 'respiracao', 'respiração', 'respirar', 'bucal', 'sinusite', 'rinite', 'olfato', 'cheiro', 'adenoide', 'amigdala', 'amígdala', 'amigdalas', 'amígdalas', 'ouvido', 'ouvidos', 'zumbido', 'audicao', 'audição', 'garganta', 'labirintite', 'tontura', 'sono'],
      answer:
        '👃 *Respirar bem é viver melhor.*\n\n' +
        'O Dr. Fábio Dario é otorrinolaringologista e especialista em cirurgia das vias aéreas superiores, com mais de 10 anos de experiência. ' +
        'Atende adultos e crianças, com foco especial na respiração:\n\n' +
        '• Nariz entupido e rinite\n' +
        '• Ronco e sono que não descansa\n' +
        '• Desvio de septo\n' +
        '• Respiração pela boca\n' +
        '• Sinusite de repetição\n' +
        '• Perda de olfato\n' +
        '• Rinoplastia, unindo função e estética\n\n' +
        'Também cuida de ouvido e garganta. Para entender o seu caso, o caminho é a consulta: digite *2* para marcar.',
      ask_unit: false,
    },
    {
      subject: 'Rinoplastia',
      keywords: ['rinoplastia', 'plastica', 'plástica', 'estetica', 'estética', 'harmonia', 'harmonico', 'harmônico', 'formato'],
      answer:
        '✨ *Rinoplastia com o Dr. Fábio*\n\n' +
        'Função e estética em equilíbrio: o objetivo é um nariz harmônico que também respira bem.\n\n' +
        'O primeiro passo é a consulta de avaliação, em que o Dr. Fábio examina o nariz e explica as possibilidades para o seu caso. Digite *2* para marcar.',
      ask_unit: false,
    },
    {
      subject: 'Endereços e telefones',
      keywords: [...PALAVRAS_DO_ENDERECO, 'higienopolis', 'higienópolis', 'tatuape', 'tatuapé', 'santos', 'boqueirao', 'boqueirão'],
      answer:
        '📍 *Onde o Dr. Fábio atende*\n\n' +
        '*Santos · Boqueirão*\nAv. Dr. Conselheiro Nébias, 754, sala 2010\n☎️ (13) 3385-6889\n\n' +
        '*São Paulo · Higienópolis*\nRua Pará, 65, conj. 54\n☎️ (11) 4301-1098\n\n' +
        '*São Paulo · Tatuapé*\nRua Serra de Botucatu, 660, conj. 24/25\n☎️ (11) 3569-1097',
      ask_unit: false,
    },
    {
      subject: 'Como é a consulta',
      keywords: ['funciona', 'inclui', 'incluso', 'incluído', 'incluido', 'demora', 'duracao', 'duração', 'tempo', 'primeira', 'avaliacao', 'avaliação', 'diagnostico', 'diagnóstico', 'exames', 'cirurgia', 'acompanhamento', 'retorno', 'proprio', 'próprio', 'pessoalmente'],
      answer:
        '🩺 *Como é a consulta com o Dr. Fábio*\n\n' +
        '1️⃣ *Consulta*: você é ouvido com atenção, sem pressa: sua história, seus sintomas e como eles afetam a sua rotina.\n' +
        '2️⃣ *Diagnóstico*: preciso e objetivo. Se for necessário, ele indica exames complementares.\n' +
        '3️⃣ *Plano de tratamento*: a melhor rota para a sua melhora, que pode envolver medicação, acompanhamento ou, em alguns casos, cirurgia.\n' +
        '4️⃣ *Acompanhamento*: a equipe fica à disposição para tirar suas dúvidas durante o tratamento.\n\n' +
        'A avaliação é feita diretamente com o Dr. Fábio, sem intermediários.',
      ask_unit: false,
    },
    {
      subject: 'O que levar',
      keywords: ['levar', 'trazer', 'documento', 'documentos', 'guia', 'antecedencia', 'antecedência', 'tomografia', 'audiometria', 'preparo', 'jejum'],
      answer:
        '📋 *Para a consulta, traga:*\n\n' +
        '• Documento com foto\n' +
        '• Carteirinha do convênio, se for usar o plano (em Santos)\n' +
        '• Exames anteriores que tiver, como tomografia, endoscopia nasal ou audiometria\n\n' +
        '✅ Não precisa de jejum nem de preparo para a consulta.',
      ask_unit: false,
    },
    {
      subject: 'Crianças',
      keywords: ['crianca', 'criança', 'criancas', 'crianças', 'filho', 'filha', 'filhos', 'filhas', 'bebe', 'bebê', 'infantil', 'idade'],
      answer:
        '👶 Sim! O Dr. Fábio atende *crianças e adultos*.\n\n' +
        'Respiração pela boca, ronco e nariz sempre entupido são queixas comuns na infância, e a consulta é feita com calma, no tempo da criança.',
      ask_unit: false,
    },
  ]),
  telemedicina: '',
  textos: {
    // A abertura da Dayane (relatorio da Cintia), sem o "meu nome e Dayane":
    // quem responde aqui e o robo, e a Dayane entra quando assume a conversa.
    saudacao: 'Olá! 👋 Seja muito bem-vindo(a) ao consultório do Dr. Fábio Dario, médico otorrinolaringologista.',
    saudacaoConhecida: 'Olá, {nome}! 👋 Que bom falar com você de novo. Aqui é o consultório do Dr. Fábio Dario, otorrinolaringologista.',
    informacoes: FECHO,
  },
}

export const IDENTIDADES: Record<ChaveIdentidade, Identidade> = { fabio: FABIO }

// ---------------------------------------------------------------
// Quem escreve
// ---------------------------------------------------------------

export type ChaveFamilia = 'nova' | 'cadastrada' | 'irmaos' | 'com_consulta'

export type Familia = {
  chave: ChaveFamilia
  rotulo: string
  descricao: string
  nomeDoPerfil: string
  telefone: string
  /** Quem ja esta cadastrado com este telefone. */
  pacientes: string[]
  /** Uma consulta futura ja marcada para o primeiro paciente. */
  comConsulta: boolean
}

export const TELEFONE_DA_FAMILIA = '5513987654321'

// Pacientes inventados: nome, CPF (valido so pelo digito) e e-mail de exemplo.
const PACIENTES: Record<string, Linha> = {
  ricardo: {
    id: 'paciente-ricardo',
    name: 'Ricardo Almeida Prado',
    birth_date: '1984-05-22',
    guardian_name: '',
    cpf: '52998224725',
    email: 'ricardo@exemplo.com',
  },
  helena: {
    id: 'paciente-helena',
    name: 'Helena Souza Lima',
    birth_date: '2019-03-14',
    guardian_name: 'Marina Souza Lima',
    cpf: '39053344705',
    email: 'marina@exemplo.com',
  },
  theo: {
    id: 'paciente-theo',
    name: 'Theo Souza Lima',
    birth_date: '2016-07-02',
    guardian_name: 'Marina Souza Lima',
    cpf: '39053344705',
    email: 'marina@exemplo.com',
  },
}

export const FAMILIAS: Record<ChaveFamilia, Familia> = {
  nova: {
    chave: 'nova',
    rotulo: 'Paciente novo',
    descricao: 'Primeiro contato: ninguém cadastrado com este número.',
    nomeDoPerfil: 'Carla',
    telefone: TELEFONE_DA_FAMILIA,
    pacientes: [],
    comConsulta: false,
  },
  cadastrada: {
    chave: 'cadastrada',
    rotulo: 'Paciente cadastrado',
    descricao: 'Ricardo já é paciente: o robô chama pelo nome e não pede o cadastro de novo.',
    nomeDoPerfil: 'Ricardo',
    telefone: TELEFONE_DA_FAMILIA,
    pacientes: ['ricardo'],
    comConsulta: false,
  },
  irmaos: {
    chave: 'irmaos',
    rotulo: 'Mãe com dois filhos',
    descricao: 'Helena e Theo no mesmo celular: o robô pergunta para quem é a consulta.',
    nomeDoPerfil: 'Marina',
    telefone: TELEFONE_DA_FAMILIA,
    pacientes: ['helena', 'theo'],
    comConsulta: false,
  },
  com_consulta: {
    chave: 'com_consulta',
    rotulo: 'Com consulta marcada',
    descricao: 'Ricardo tem consulta nos próximos dias: dá para ver, remarcar ou cancelar.',
    nomeDoPerfil: 'Ricardo',
    telefone: TELEFONE_DA_FAMILIA,
    pacientes: ['ricardo'],
    comConsulta: true,
  },
}

/** As linhas iniciais do banco falso para esta clinica, esta agenda e esta familia. */
export function bancoInicial(
  identidade: Identidade,
  agenda: AgendaDaClinica,
  familia: Familia,
  agora: Date,
): Record<string, Linha[]> {
  const clinic_id = identidade.clinicId
  const tabelas = tabelasDaAgenda(agenda, clinic_id)
  const clinic_settings = [{ clinic_id, telemedicine_info_text: identidade.telemedicina, ...tabelas.configuracoes }]
  const patients: Linha[] = familia.pacientes.map((chave) => ({
    ...PACIENTES[chave],
    clinic_id,
    phone: familia.telefone,
    phone_digits: familia.telefone,
    archived_at: null,
    whatsapp_opt_out_at: null,
  }))

  const appointments: Linha[] = []
  if (familia.comConsulta && patients[0]) {
    // O primeiro horario livre a partir de dois dias, na primeira unidade que
    // tiver: perto o bastante para "minha consulta" fazer sentido, longe o
    // bastante para nao ser "hoje".
    const depois = new Date(agora.getTime() + 2 * 24 * 3600 * 1000)
    const leitura = { ...tabelas, clinic_settings, appointments: [] }
    for (const unidade of tabelas.clinic_units.filter((u) => !u.telemedicina)) {
      const [slot] = horariosLivres(leitura, unidade.id, depois)
      if (!slot) continue
      appointments.push({
        id: 'consulta-marcada',
        clinic_id,
        unit_id: unidade.id,
        patient_id: patients[0].id,
        starts_at: slot.slot_start,
        ends_at: slot.slot_end,
        status: 'scheduled',
        modality: 'presencial',
        source: 'agenda',
        contact_name: patients[0].name,
        contact_phone: familia.telefone,
        confirmed_by_clinic: true,
        reschedule_count: 0,
        insurance: '',
      })
      break
    }
  }

  return {
    clinics: [{ id: clinic_id, name: identidade.nomeNoWhatsApp, timezone: 'America/Sao_Paulo' }],
    clinic_settings,
    clinic_units: tabelas.clinic_units,
    availability_rules: tabelas.availability_rules,
    schedule_exceptions: tabelas.schedule_exceptions,
    bot_answers: identidade.respostas,
    patients,
    appointments,
    whatsapp_conversations: [],
  }
}
