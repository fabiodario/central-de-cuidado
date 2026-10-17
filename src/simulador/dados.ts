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
import { horariosLivres, tabelasDaAgenda, type AgendaDaClinica, type Bloqueio } from './agenda'
import { CLINICA_DR_FABIO } from '../../supabase/functions/_shared/quem-atende.ts'
import { feriadosDoAno } from '../../supabase/functions/_shared/expediente.ts'

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

// Sem "particular" e "premium" (16/10/2026, painel): "preciso de uma consulta
// o quanto antes, particular, em qualquer unidade" e jeito de pagar, e nao
// pergunta de valor, e recebia o texto de valores em cima da agenda.
const PALAVRAS_DO_VALOR = ['credito', 'parcela', 'parcelar', 'pix', 'valor', 'valores', 'pagamento', 'preco', 'preço', 'preços', 'pagar', 'quanto', 'recibo', 'cartao', 'cartão', 'custa', 'debito', 'custo', 'fiscal', 'dinheiro', 'boleto']
// Sem "carro", "estacionamento" e "fica" (16/10/2026, painel de pacientes
// simulados): "tem estacionamento?" recebia os enderecos, que nao falam de
// estacionamento, e "fica dificil ir ate ai" tambem. Estacionamento ganhou
// resposta propria, logo abaixo.
const PALAVRAS_DO_ENDERECO = ['local', 'endereco', 'endereço', 'localizacao', 'localização', 'onde', 'mapa', 'referencia', 'referência', 'chegar', 'rua', 'bairro', 'unidades', 'telefone', 'telefones']

/** Linhas de bot_answers, na ordem em que a clinica cadastrou. */
function respostas(clinicId: string, lista: Omit<Linha, 'id'>[]): Linha[] {
  return lista.map((r, i) => ({ id: `resposta-${i + 1}`, clinic_id: clinicId, is_active: true, position: i, hand_off: false, ...r }))
}

// O que o consultorio ainda nao informou (16/10/2026): a resposta diz que a
// equipe confirma e chama a equipe (hand_off), para a pergunta nao ficar sem
// dono. Quando o consultorio informar, escrever a resposta e desligar.
const A_EQUIPE_CONFIRMA = { ask_unit: false, hand_off: true }

const LEVAR = '📋 Traga um documento com foto e os exames anteriores que tiver, como tomografia, endoscopia nasal ou audiometria.'

// Os feriados nacionais como dias fechados, como na clinica real: a carga de
// 15/10/2026 levou os da migration 20260831090000 (de 07/09/2026 ao fim de
// 2027). Sem eles o simulador oferecia Finados (02/11) em Santos (painel de
// pacientes simulados, 16/10/2026). Carnaval e Cinzas vao marcados como ponto
// facultativo, igual ao banco.
const FERIADOS: Bloqueio[] = [2026, 2027]
  .flatMap((ano) => [...feriadosDoAno(ano)])
  .filter(([data]) => data >= '2026-09-07')
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([data, nome]) => ({
    id: `feriado-${data}`,
    data,
    motivo: /Carnaval|Cinzas/.test(nome) ? `${nome} (ponto facultativo)` : nome,
    unidadeId: null,
  }))

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
    bloqueios: FERIADOS,
    preferencias: PREFERENCIAS,
    // Otorrino examina (nasofibroscopia, otoscopia): sem telemedicina.
    telemedicinaAtiva: false,
    telemedicinaValor: null,
  },
  // A ordem decide o empate (respostas.ts). O assunto especifico vem antes do
  // valor (16/10/2026, rodada 3 do painel): 'o retorno tem que pagar de novo?'
  // e 'aparelio pra escutar, qto fica?' empatavam com Valor e ouviam o valor da
  // consulta. O preco de uma coisa e assunto dela, e cada uma dessas respostas
  // ja diz que o valor a equipe confirma.
  respostas: respostas(CLINICA_DR_FABIO, [
    {
      subject: 'Cirurgia',
      // Antes de Convenios de proposito: "o Porto cobre a operacao de septo?"
      // empata nas duas, e o empate fica com a de cima.
      keywords: ['cirurgia', 'cirurgias', 'operar', 'operacao', 'operação', 'operacoes', 'opera', 'cobre', 'cobertura', 'coberta', 'septoplastia', 'turbinectomia', 'adenoidectomia', 'amigdalectomia'],
      answer:
        '🩺 *Cirurgia*\n\n' +
        'O Dr. Fábio é especialista em cirurgia das vias aéreas superiores. A indicação de cirurgia é feita na consulta, depois da avaliação: é nela que ele explica o tratamento para o seu caso.\n\n' +
        'Valores e cobertura do seu plano a nossa equipe confirma.',
      ...A_EQUIPE_CONFIRMA,
    },
    {
      subject: 'Retorno',
      keywords: ['retorno', 'retornos', 'revisao', 'revisão'],
      answer: '🔁 *Retorno*\n\nO prazo do retorno e se ele é cobrado, a nossa equipe confirma para você.',
      ...A_EQUIPE_CONFIRMA,
    },
    {
      subject: 'Exames no consultório',
      keywords: ['exame', 'exames', 'nasofibroscopia', 'nasofibro', 'videonasofibroscopia', 'endoscopia', 'audiometria', 'impedanciometria', 'imitanciometria', 'laringoscopia', 'videolaringoscopia', 'bera', 'otoneurologico', 'otoneurológico'],
      answer:
        '🔬 *Exames*\n\n' +
        'Quais exames são feitos no consultório, como a nasofibroscopia ou a audiometria, e em qual unidade, a nossa equipe confirma para você.',
      ...A_EQUIPE_CONFIRMA,
    },
    {
      subject: 'Aparelho auditivo',
      // "surdez", "vende" e "comprar" (16/10/2026, rodada 2 do painel): "tem
      // aparelho pra surdez ai? qual o valor" empatava com Valor e perdia, e
      // "e o aparelho de ouvido, vcs vendem?" perdia para "O que o Dr. Fabio trata".
      // 'aparelio' e 'aparelhinho' (rodada 3): como se escreve.
      keywords: ['aparelho', 'aparelhos', 'aparelio', 'aparelhinho', 'auditivo', 'auditiva', 'auditivos', 'protese', 'prótese', 'surdez', 'vende', 'vendem', 'venda', 'comprar'],
      answer:
        '🦻 *Aparelho auditivo*\n\n' +
        'Sobre aparelho auditivo, a nossa equipe confirma para você. Se a queixa é a audição, o primeiro passo é a consulta com o Dr. Fábio: digite *2* para marcar.',
      ...A_EQUIPE_CONFIRMA,
    },
    {
      subject: 'Rinoplastia',
      // "rino" (16/10/2026, rodada 2 do painel): e assim que muita gente escreve.
      keywords: ['rinoplastia', 'rino', 'plastica', 'plástica', 'estetica', 'estética', 'harmonia', 'harmonico', 'harmônico', 'formato'],
      answer:
        '✨ *Rinoplastia com o Dr. Fábio*\n\n' +
        'Função e estética em equilíbrio: o objetivo é um nariz harmônico que também respira bem.\n\n' +
        'O primeiro passo é a consulta de avaliação, em que o Dr. Fábio examina o nariz e explica as possibilidades para o seu caso. O valor da cirurgia é passado depois dessa avaliação. Digite *2* para marcar.',
      ask_unit: false,
    },
    {
      subject: 'Valor e pagamento',
      keywords: PALAVRAS_DO_VALOR,
      // O valor ainda nao foi configurado: a equipe passa, e e chamada.
      answer:
        '💙 *Consulta com o Dr. Fábio*\n\n' +
        '• *Particular (Consulta Particular Premium)*, nas três unidades: avaliação completa, sem pressa, com diagnóstico e plano de tratamento sob medida.\n' +
        '• *Convênio*, em Santos (Boqueirão): Porto Saúde, Unimed Santos e Santa Saúde.\n\n' +
        '💳 O valor da consulta particular e as formas de pagamento a nossa equipe passa por aqui. Emitimos recibo para você pedir reembolso ao seu plano.\n\n' +
        'O valor de cirurgias, como a rinoplastia, é passado depois da consulta de avaliação.',
      ...A_EQUIPE_CONFIRMA,
    },
    {
      subject: 'Guia e encaminhamento',
      // 'clinico' (rodada 2 do painel): "pela unimed precisa de pedido do clinico
      // geral?" e pergunta de encaminhamento.
      keywords: ['guia', 'guias', 'encaminhamento', 'encaminhar', 'encaminhado', 'encaminhada', 'autorizacao', 'autorização', 'autorizar', 'requisicao', 'requisição', 'clinico', 'clínico'],
      answer:
        '📄 *Guia e encaminhamento*\n\n' +
        'Se o seu plano pede guia, autorização ou encaminhamento para a consulta, a nossa equipe confirma para você. No dia, traga a carteirinha do convênio.',
      ...A_EQUIPE_CONFIRMA,
    },
    {
      subject: 'Convênios',
      keywords: ['convenio', 'convênio', 'convenios', 'convênios', 'plano', 'planos', 'aceita', 'aceitam', 'cobertura', 'coberto', 'cobre', 'credenciado', 'credenciada', 'carteirinha', 'reembolso', 'unimed', 'porto', 'santa', 'amil', 'bradesco', 'sulamerica', 'sulamérica', 'notredame', 'intermedica', 'hapvida', 'cassi', 'golden', 'prevent', 'omint', 'careplus', 'seguro', 'seguros', 'paulistana', 'allianz', 'mediservice', 'cabesp'],
      answer:
        '💳 *Convênios*\n\n' +
        'Em *Santos (Boqueirão)*, o Dr. Fábio atende pelos planos *Porto Saúde*, *Unimed Santos* e *Santa Saúde*, além do particular. Da Unimed, só a *Unimed Santos*.\n\n' +
        'Em *São Paulo* (Higienópolis e Tatuapé), a consulta é *particular*. Emitimos recibo para você pedir reembolso ao seu plano.\n\n' +
        'Cobertura de exames e de cirurgia depende do plano: a nossa equipe confirma.\n\n' +
        'Para marcar pelo convênio, digite *2* e escolha Santos.',
      ask_unit: false,
    },
    {
      subject: 'Crianças',
      // Antes de O que o Dr. Fabio trata (rodada 2 do painel): "o dr atende nenem?
      // nao sei se e normal levar no otorrino" empatava, e o empate fica com a de
      // cima. 'bb' e como muita mae escreve.
      keywords: ['bb', 'crianca', 'criança', 'criancas', 'crianças', 'filho', 'filha', 'filhos', 'filhas', 'bebe', 'bebê', 'bebes', 'bebês', 'nenem', 'neném', 'infantil', 'idade'],
      answer:
        '👶 Sim! O Dr. Fábio atende *crianças e adultos*.\n\n' +
        'Respiração pela boca, ronco e nariz sempre entupido são queixas comuns na infância, e a consulta é feita com calma, no tempo da criança.',
      ask_unit: false,
    },
    {
      subject: 'O que o Dr. Fábio trata',
      // No maximo 40 palavras: o banco recusa mais (bot_answers_keywords_limit),
      // e foi assim que a carga da clinica real falhou em 15/10/2026, com 41.
      // Sem "roncar", "roncando", "ouvidos" e "amigdalas": palavra de cinco
      // letras ou mais tambem vale pelo comeco (respostas.ts), entao "ronca",
      // "ouvido" e "amigdala" ja as encontram.
      keywords: ['trata', 'tratam', 'cuida', 'cuidam', 'especialidade', 'especialista', 'otorrino', 'otorrinolaringologista', 'nariz', 'entupido', 'entupida', 'entupimento', 'ronco', 'ronca', 'apneia', 'desvio', 'septo', 'respiracao', 'respiração', 'respirar', 'bucal', 'sinusite', 'rinite', 'olfato', 'cheiro', 'adenoide', 'amigdala', 'amígdala', 'ouvido', 'zumbido', 'audicao', 'audição', 'garganta', 'labirintite', 'tontura', 'sono'],
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
      subject: 'Estacionamento',
      keywords: ['estacionamento', 'estacionar', 'estaciono', 'carro', 'garagem', 'manobrista', 'valet'],
      answer: '🚗 *Estacionamento*\n\nA informação de estacionamento de cada unidade a nossa equipe confirma para você.',
      ...A_EQUIPE_CONFIRMA,
    },
    {
      subject: 'Consulta por vídeo',
      keywords: ['online', 'video', 'vídeo', 'videochamada', 'teleconsulta', 'telemedicina', 'distancia', 'distância', 'remota', 'remoto'],
      answer:
        '💻 *Consulta por vídeo*\n\n' +
        'As consultas com o Dr. Fábio são *presenciais*, nas unidades de Santos (Boqueirão), Higienópolis e Tatuapé. Digite *2* para ver os horários.',
      ask_unit: false,
    },
    {
      subject: 'Dias e horários',
      keywords: ['noite', 'sabado', 'sábado', 'sabados', 'sábados', 'domingo', 'domingos', 'feriado', 'feriados', 'fecha', 'abre', 'abrem', 'abrir', 'funcionam', 'funcionamento', 'expediente', 'madrugada'],
      answer:
        '🕐 *Dias e horários*\n\n' +
        'O Dr. Fábio atende de segunda a sexta, de manhã ou à tarde, conforme a unidade. Não há atendimento à noite nem aos fins de semana.\n\n' +
        'A nossa equipe responde por aqui de segunda a sexta, das 8h às 18h. Digite *2* para ver os dias e horários livres de cada unidade.',
      ask_unit: false,
    },
    {
      subject: 'Como é a consulta',
      // Sem "exames", "cirurgia", "retorno" e "pessoalmente" (16/10/2026,
      // painel): cada uma trazia este texto para quem perguntava outra coisa.
      // Cada assunto ganhou resposta propria. A duracao e a da agenda (40 min).
      keywords: ['funciona', 'inclui', 'incluso', 'incluído', 'incluido', 'demora', 'dura', 'duram', 'duracao', 'duração', 'tempo', 'minutos', 'avaliacao', 'avaliação', 'diagnostico', 'diagnóstico', 'acompanhamento'],
      answer:
        '🩺 *Como é a consulta com o Dr. Fábio*\n\n' +
        '⏱️ A consulta dura cerca de 40 minutos, sem pressa.\n\n' +
        '1️⃣ *Consulta*: você é ouvido com atenção: sua história, seus sintomas e como eles afetam a sua rotina.\n' +
        '2️⃣ *Diagnóstico*: preciso e objetivo. Se for necessário, ele indica exames complementares.\n' +
        '3️⃣ *Plano de tratamento*: a melhor rota para a sua melhora, que pode envolver medicação, acompanhamento ou, em alguns casos, cirurgia.\n' +
        '4️⃣ *Acompanhamento*: a equipe fica à disposição para tirar suas dúvidas durante o tratamento.\n\n' +
        'A avaliação é feita diretamente com o Dr. Fábio, sem intermediários.',
      ask_unit: false,
    },
    {
      subject: 'O que levar',
      // Sem "guia", "tomografia" e "audiometria" (16/10/2026): guia e exames
      // ganharam resposta propria, e "O que levar" respondia "voces fazem
      // audiometria?" com "traga a sua audiometria".
      keywords: ['levar', 'trazer', 'documento', 'documentos', 'antecedencia', 'antecedência', 'preparo', 'jejum'],
      answer:
        '📋 *Para a consulta, traga:*\n\n' +
        '• Documento com foto\n' +
        '• Carteirinha do convênio, se for usar o plano (em Santos)\n' +
        '• Exames anteriores que tiver, como tomografia, endoscopia nasal ou audiometria\n\n' +
        '✅ Não precisa de jejum nem de preparo para a consulta.',
      ask_unit: false,
    },
    {
      subject: 'Áudio',
      // Por ultimo: "audio" tambem e o comeco de "audiometria", e o empate fica
      // com Exames, que vem antes.
      keywords: ['audio', 'audios', 'áudio', 'áudios'],
      answer:
        '🎤 Pode mandar áudio, sim: ele vai para a nossa equipe, que ouve e responde por aqui, de segunda a sexta, das 8h às 18h.\n\n' +
        'Para marcar consulta é mais rápido por escrito: digite *2*.',
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
