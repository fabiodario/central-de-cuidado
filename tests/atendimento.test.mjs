// Bateria completa do atendimento automatico do WhatsApp.
//
// Cada caso descreve o que a pessoa digita e o que a resposta PRECISA conter.
// A ideia nao e imprimir tela bonita: e falhar sozinho quando o robo mudar de
// comportamento sem querer.
//
// Como rodar:  npm run test:bot
//
// O banco aqui e falso e mora neste arquivo. Isso e proposital: o objetivo e
// exercitar as DECISOES do robo (o que responder, o que gravar, quando ficar
// calado), e nao o Supabase.
import { tratarConversa, iniciarQuestionario, colherEventos, abrirFichaPeloLembrete, faltamNaFicha, retornoAlemDaAgenda, pediuMudarConsulta, diaPeloNome, avisoDoDiaDaConsulta, respostaAutomaticaDaFamilia, despedida, oferecerHorarios } from './atendimento.build.mjs'
import { readFileSync } from 'node:fs'
import { montarMensagens } from './conteudo.build.mjs'

// ---------------------------------------------------------------
// Banco falso
// ---------------------------------------------------------------

function fazerAdmin({
  unidades,
  slotsPorUnidade,
  falharSlots = false,
  erroInsert = null,
  remarcacoesAnteriores = 0,
  respostasProntas = [],
  telemedicina = { ativa: false, texto: '' },
  // Colunas que este banco falso NÃO tem. Recusa o update inteiro quando
  // alguma aparece, que é exatamente o que o Postgres faz.
  colunasAusentes = [],
  // Consultas com o cadastro (intake_*) como o banco devolve.
  consultasComFicha = [],
  // Horarios semanais cadastrados por unidade (so a contagem importa aqui).
  regrasPorUnidade = {},
  // Horarios alem da agenda aberta: so a funcao com periodo os enxerga, como
  // available_slots_periodo no banco (14/10/2026).
  slotsAlemDaAgenda = {},
}) {
  const conversa = {
    booking_state: null,
    booking_options: null,
    booking_unit_id: null,
    booking_patient_id: null,
    booking_replaces_id: null,
    menu_sent_at: null,
  }
  const marcadas = []
  const canceladas = []
  // O que foi gravado na ficha do paciente. Antes o banco falso nem conhecia a
  // tabela: a ficha so era exercitada ate a PRIMEIRA pergunta, e o que
  // acontecia com a resposta ninguem via.
  const fichas = []

  // O que o robo ja mandou nesta conversa, como o webhook grava. E daqui que
  // ele confere se uma resposta pronta acabou de sair (jaMandada).
  const enviadas = []
  const dadosDasConsultas = []

  const chain = (resultado) => ({
    select: () => chain(resultado),
    eq: (_col, valor) => chain(resultado._porId ? { ...resultado, single: resultado._porId(valor) } : resultado),
    gte: () => chain(resultado),
    is: () => chain(resultado),
    in: () => chain(resultado),
    order: () => chain(resultado),
    limit: () => chain(resultado),
    maybeSingle: async () => ({ data: resultado.single ?? null, error: resultado.erro ?? null }),
    then: (r) => r({ data: resultado.list ?? (resultado.erro ? null : []), error: resultado.erro ?? null }),
  })

  const admin = {
    from(tabela) {
      if (tabela === 'whatsapp_conversations') {
        return {
          update: (campos) => {
            const faltando = colunasAusentes.filter((c) => c in campos)
            if (faltando.length > 0) {
              return {
                eq: async () => ({
                  error: { code: '42703', message: `column ${faltando[0]} does not exist` },
                }),
              }
            }
            Object.assign(conversa, campos)
            return { eq: async () => ({}) }
          },
        }
      }
      if (tabela === 'clinic_units') {
        return {
          select: (colunas = '') => {
            // Postgres recusa a consulta INTEIRA quando uma coluna não existe.
            const faltando = colunasAusentes.find((c) => String(colunas).includes(c))
            if (faltando) {
              return chain({
                list: null,
                single: null,
                erro: { code: '42703', message: `column ${faltando} does not exist` },
              })
            }
            return chain({
              list: unidades,
              single: unidades[0],
              _porId: (id) => unidades.find((u) => u.id === id) ?? null,
            })
          },
        }
      }
      // Ficha do paciente. Recebe o que a familia responde quando ja existe
      // cadastro - e, desde 16/09/2026, e o unico destino quando a equipe
      // dispara o questionario para quem nao tem consulta marcada.
      if (tabela === 'patients') {
        return {
          select: () => chain({ single: null, list: [] }),
          update: (campos) => ({
            eq: async (_coluna, valor) => {
              fichas.push({ id: valor, ...campos })
              return { error: null }
            },
          }),
        }
      }
      if (tabela === 'clinics') {
        return { select: () => chain({ single: { timezone: 'America/Sao_Paulo' } }) }
      }
      // Agenda da telemedicina (03/10/2026): o robo so pergunta se ha horario.
      if (tabela === 'availability_rules') {
        return {
          select: () => ({
            eq: (_c, id) => ({ limit: async () => ({ data: regrasPorUnidade[id] ?? [], error: null }) }),
          }),
        }
      }
      // Respostas prontas: o que a clinica cadastrou para o robo responder
      // sozinho. Vazio por padrao - a maioria dos casos nao passa por aqui.
      if (tabela === 'bot_answers') {
        return { select: () => chain({ list: respostasProntas }) }
      }
      if (tabela === 'whatsapp_messages') {
        return { select: () => chain({ list: [...enviadas].reverse() }) }
      }
      // Telemedicina: desligada por padrao, para os casos antigos continuarem
      // vendo so as unidades fisicas.
      if (tabela === 'clinic_settings') {
        return {
          select: (colunas = '') => {
            // Coluna nova que o banco ainda nao tem recusa a consulta inteira.
            const faltando = colunasAusentes.find((c) => String(colunas).includes(c))
            if (faltando) {
              return chain({ single: null, erro: { code: '42703', message: `column ${faltando} does not exist` } })
            }
            return chain({
              single: {
                telemedicine_enabled: telemedicina.ativa,
                telemedicine_info_text: telemedicina.texto,
                telemedicine_price_cents: telemedicina.valor ?? null,
              },
            })
          },
        }
      }
      if (tabela === 'appointments') {
        return {
          // A consulta lida de volta. Alem do contador de remarcacoes, traz o
          // horario e a unidade: e com eles que o fim do questionario decide se
          // monta um comprovante. O horario e FUTURO de proposito, para o teste
          // do questionario manual provar que quem segura o comprovante e a
          // regra do "manual", e nao a data.
          select: () =>
            chain({
              // Consultas lidas em lista (cadastro pela metade, 24/09/2026).
              list: consultasComFicha,
              single: {
                reschedule_count: remarcacoesAnteriores,
                starts_at: '2027-09-14T18:00:00Z',
                modality: 'presencial',
                clinic_units: { name: 'Livance Ibirapuera - São Paulo', address: 'Rua Y, 30' },
              },
            }),
          // A consulta marcada e lida de volta: e o id dela que a ficha de
          // dados (nome, nascimento, CPF...) usa para saber onde guardar.
          insert: (linha) => ({
            select: () => ({
              maybeSingle: async () => {
                if (erroInsert) return { data: null, error: erroInsert }
                // Coluna que este banco não tem recusa o INSERT inteiro, como
                // o Postgres faz. Sem isto, o plano B de marcar() passaria
                // sem nunca ter sido exercitado.
                const faltando = colunasAusentes.find((c) => c in linha)
                if (faltando) {
                  return {
                    data: null,
                    error: { code: '42703', message: `column ${faltando} does not exist` },
                  }
                }
                marcadas.push(linha)
                return { data: { id: `consulta-${marcadas.length}` }, error: null }
              },
            }),
          }),
          update: (campos) => ({
            eq: (_c, valor) => ({
              eq: async () => {
                if (campos.status === 'cancelled') canceladas.push(valor)
                return { error: null }
              },
              // UPDATE com um filtro so (a ficha gravando nome, nascimento...):
              // o que foi gravado fica em dadosDasConsultas, para o teste ler.
              then: (resolver) => {
                dadosDasConsultas.push({ id: valor, ...campos })
                resolver({ error: null })
              },
            }),
          }),
        }
      }
      throw new Error('tabela nao prevista: ' + tabela)
    },
    async rpc(nome, args) {
      if (nome === 'liberar_reservas_vencidas') return { data: 0, error: null }
      if (nome === 'available_slots') {
        if (falharSlots) {
          return { data: null, error: { code: '42501', message: 'permission denied for table clinics' } }
        }
        return { data: slotsPorUnidade[args.p_unit_id] ?? [], error: null }
      }
      if (nome === 'available_slots_periodo') {
        if (falharSlots) {
          return { data: null, error: { code: '42501', message: 'permission denied for table clinics' } }
        }
        // Dia de Sao Paulo (UTC-3), como o banco compara.
        const dia = (iso) => new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10)
        const todos = [...(slotsPorUnidade[args.p_unit_id] ?? []), ...(slotsAlemDaAgenda[args.p_unit_id] ?? [])]
        return {
          data: todos.filter((h) => (!args.p_de || dia(h.slot_start) >= args.p_de) && (!args.p_ate || dia(h.slot_start) <= args.p_ate)),
          error: null,
        }
      }
      throw new Error('rpc nao prevista: ' + nome)
    },
  }
  return { admin, conversa, marcadas, canceladas, fichas, enviadas, dadosDasConsultas }
}

const TRES_UNIDADES = [
  { id: 'u-santos', name: 'Liferty · Santos', address: 'Av. Ana Costa, 100' },
  { id: 'u-andre', name: 'Livance · Santo André', address: 'Rua X, 20' },
  // Nome longo de proposito: 30 caracteres, igual ao da unidade real. Foi ele
  // que estourou o limite de 24 da Meta e fez a lista chegar sem botao.
  { id: 'u-vila', name: 'Livance Ibirapuera - São Paulo', address: 'Rua Y, 30' },
]
const UMA_UNIDADE = [TRES_UNIDADES[0]]

const diasSantos = ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-07', '2026-09-08']
const horasManha = ['11:00', '11:40', '12:20', '13:00', '13:40', '14:20'] // UTC -> 08h a 11h20 BRT
const SLOTS_CHEIOS = {
  'u-santos': diasSantos.flatMap((d) =>
    horasManha.map((h) => ({ slot_start: `${d}T${h}:00Z`, slot_end: `${d}T${h}:40Z` })),
  ),
  'u-andre': [],
  'u-vila': [],
}
const SLOTS_VAZIOS = { 'u-santos': [], 'u-andre': [], 'u-vila': [] }

const TEXTOS = {
  saudacao: 'Olá! Aqui é o consultório do Dr. Marcello Ruiz, gastropediatra.',
  saudacaoConhecida: 'Olá, {nome}! Aqui é o consultório do Dr. Marcello Ruiz.',
  informacoes: 'O valor da consulta é R$ 450,00.\n13 3273-6828',
}

// Ana tem a ficha completa: e o paciente de anos, que nao deve ser
// interrogado de novo. Pedro so tem o nome, e serve para exercitar a ficha.
const ANA = {
  id: 'p1',
  name: 'Ana Paula Souza',
  nascimento: '2019-03-12',
  responsavel: 'Marina Souza',
  cpf: '39053344705',
  email: 'marina@exemplo.com',
}
const PEDRO = { id: 'p2', name: 'Pedro Souza' }

// ---------------------------------------------------------------
// Motor de casos
// ---------------------------------------------------------------

let passou = 0
const falhas = []
const achados = []

/**
 * `passos` e uma lista de [mensagem, esperado].
 * `esperado` pode ser:
 *   - string  -> a resposta precisa conter esse trecho
 *   - array   -> precisa conter todos
 *   - null    -> o robo precisa ficar em silencio
 */
const QUARTA_10H = new Date('2026-10-07T13:00:00Z')
const VAZIO = Symbol('vazio')
const SEXTA_23H = new Date('2026-10-10T02:00:00Z')

async function caso(titulo, passos, opcoes = {}) {
  const { admin, conversa, marcadas, canceladas, fichas, enviadas, dadosDasConsultas } = fazerAdmin({
    unidades: opcoes.unidades ?? TRES_UNIDADES,
    slotsPorUnidade: opcoes.slots ?? SLOTS_CHEIOS,
    falharSlots: opcoes.falharSlots,
    erroInsert: opcoes.erroInsert,
    remarcacoesAnteriores: opcoes.remarcacoesAnteriores ?? 0,
    respostasProntas: opcoes.respostasProntas ?? [],
    telemedicina: opcoes.telemedicina ?? { ativa: false, texto: '' },
    colunasAusentes: opcoes.colunasAusentes ?? [],
    consultasComFicha: opcoes.fichas ?? [],
    regrasPorUnidade: opcoes.regras ?? {},
    slotsAlemDaAgenda: opcoes.alemDaAgenda ?? {},
  })

  // A conversa começa como se o menu já tivesse aparecido alguma vez.
  //
  // Desde 16/09/2026 a PRIMEIRA mensagem de alguém sempre recebe o menu, sem
  // atalho: quem chega pelo botão do site, com "gostaria de agendar" escrito
  // pronto, precisa ver a apresentação e as outras opções antes de ser levado
  // para dentro do agendamento. Os casos abaixo testam o que acontece DEPOIS
  // disso, então nascem com o menu já visto. Quem quiser testar a primeira
  // mensagem passa `primeiraMensagem: true`.
  conversa.menu_sent_at = opcoes.primeiraMensagem ? null : '2026-08-31T12:00:00Z'

  // Conversa que ja estava no meio de uma etapa quando o caso comeca - por
  // exemplo, parada numa pergunta que deixou de fazer sentido.
  Object.assign(conversa, opcoes.estadoInicial ?? {})
  // Algo que acontece antes da primeira mensagem, com o mesmo banco - a
  // equipe mandando horarios pela tela, por exemplo.
  if (opcoes.antes) await opcoes.antes({ admin, conversa })

  const transcricao = []
  let ultimoToque = { resposta: '', botoes: undefined, lista: undefined }

  // O webhook real relê as consultas futuras a cada mensagem, entao uma que foi
  // cancelada some da lista. O banco falso precisa fazer o mesmo, senao o teste
  // pergunta ao robo sobre uma consulta que ja nao existe.
  let consultas = opcoes.consultas ?? []

  // Terceiro item do passo: ajustes que valem só daquela mensagem em diante.
  // Serve para simular alguém da equipe entrando no meio da conversa, que é
  // quando o robô precisa se calar.
  let ajustes = {}
  for (const [texto, esperado, mudanca] of passos) {
    if (mudanca) ajustes = { ...ajustes, ...mudanca }
    consultas = consultas.filter((c) => !canceladas.includes(c.id))
    const r = await tratarConversa({
      admin,
      clinicId: 'c1',
      conversationId: 'conv1',
      estadoAtual: conversa.booking_state,
      opcoesAtuais: conversa.booking_options,
      unidadeEmAndamento: conversa.booking_unit_id,
      modalidadeEmAndamento: conversa.booking_modality ?? null,
      pacienteEmAndamento: conversa.booking_patient_id ?? null,
      // A consulta cuja ficha esta sendo preenchida. Faltava aqui: sem ela, a
      // segunda resposta da familia caia no "nao ha onde guardar" e o teste
      // nunca via o questionario ate o fim.
      consultaEmCadastro: conversa.booking_intake_id ?? null,
      convenioEmAndamento: conversa.booking_insurance ?? null,
      consultas,
      consultaASubstituir: conversa.booking_replaces_id ?? null,
      // Quantas respostas prontas o robo ja deu nesta espera pela equipe. Sai
      // do banco falso, como no webhook de verdade, para o limite de tres ser
      // contado entre uma mensagem e outra.
      respostasNaEspera: conversa.auto_replies_while_waiting ?? 0,
      // A mensagem e um anexo? No teste, o texto "[ANEXO]" faz as vezes da foto
      // que a Meta entrega sem corpo nenhum.
      anexo: texto === '[ANEXO]',
      // ... e sem corpo nenhum e literal: foto sem legenda chega com texto
      // vazio. Mandar a palavra "[ANEXO]" como se fosse o que a pessoa
      // escreveu faria o robo guardar isso como resposta dela - foi assim que
      // o pedido de 2a via registrou "[ANEXO]" no lugar do motivo.
      // O banco falso guarda menu_sent_at como o de verdade: assim o teste sabe
      // se aquela mensagem e a primeira da conversa.
      jaViuOMenu: Boolean(conversa.menu_sent_at),
      podeIniciarMenu: ajustes.podeIniciarMenu ?? opcoes.podeIniciarMenu ?? true,
      posAcompanhamento: ajustes.posAcompanhamento ?? opcoes.posAcompanhamento ?? false,
      texto: texto === '[ANEXO]' ? '' : texto,
      telefone: opcoes.telefone ?? '5511999999999',
      pacientes: opcoes.pacientes ?? [],
      nomeDoPerfil: opcoes.nomeDoPerfil ?? 'Paula Medina',
      textos: opcoes.textos ?? TEXTOS,
      // Relogio fixo numa quarta as 10h (Brasilia): a resposta de urgencia muda
      // fora do expediente, e o teste nao pode depender da hora em que roda.
      agora: opcoes.agora ?? QUARTA_10H,
      consultaHoje: ajustes.consultaHoje ?? opcoes.consultaHoje ?? false,
    })

    const resposta = r?.resposta ?? null
    if (resposta) enviadas.push({ body: resposta, direction: 'outbound', automatic: true })
    // Auditoria de botoes (01/10/2026), em TODA mensagem de TODO caso: o que
    // oferece opcao numerada tem de chegar com botao ou lista, depois de
    // passar pelo envio de verdade (montarMensagens), e caber no limite da
    // Meta. Pedido do Edu: tocar ou digitar, a escolha e da familia. Antes
    // disto, 19 respostas so aceitavam digitar, e a de informacoes da unidade
    // perdia a lista por passar de 1024 caracteres.
    if (resposta) {
      const enviadas = montarMensagens(resposta, r?.botoes || r?.lista ? { botoes: r?.botoes, lista: r?.lista } : undefined)
      const ofereceNumero = /\*\d\*|[Dd]igite \*?\d|[Rr]esponda (com )?\*?\d/.test(resposta)
      if (ofereceNumero && !enviadas.some((m) => m.type === 'interactive')) {
        falhas.push(`${titulo} | oferece opção sem botão: ${resposta.slice(0, 70)}`)
      }
      if (enviadas.some((m) => m.type === 'interactive' && m.interactive.body.text.length > 1024)) {
        falhas.push(`${titulo} | mensagem com botão acima de 1024 caracteres`)
      }
    }
    ultimoToque = { resposta: r?.resposta ?? '', botoes: r?.botoes, lista: r?.lista, concluida: r?.concluida, atencao: r?.atencao }
    transcricao.push(`  > ${texto}\n    ${resposta ? resposta.replace(/\n/g, '\n    ') : '(silêncio)'}`)

    // Resposta vazia de proposito: o robo processou e decidiu nao dizer nada
    // (resposta automatica do WhatsApp Business da familia).
    if (esperado === VAZIO) {
      if (resposta === '') passou++
      else falhas.push(`${titulo} | "${texto}" deveria ser resposta vazia, veio: ${String(resposta).slice(0, 60)}`)
      continue
    }

    if (esperado === null) {
      if (resposta !== null) {
        falhas.push(`${titulo} | "${texto}" deveria ser silêncio, veio: ${resposta.slice(0, 60)}`)
      } else passou++
      continue
    }

    const trechos = Array.isArray(esperado) ? esperado : [esperado]
    for (const trecho of trechos) {
      if (resposta && resposta.includes(trecho)) passou++
      else {
        falhas.push(
          `${titulo} | "${texto}" deveria conter "${trecho}"\n     veio: ${(resposta ?? '(silêncio)').slice(0, 140)}`,
        )
      }
    }
  }

  if (opcoes.verificar) {
    opcoes.verificar({ marcadas, canceladas, conversa, transcricao, titulo, ultimoToque, fichas, dadosDasConsultas })
  }
  return { marcadas, canceladas, conversa, transcricao, fichas, dadosDasConsultas }
}

// ---------------------------------------------------------------
// 1. Menu
// ---------------------------------------------------------------

await caso('Primeiro contato mostra o menu', [
  ['Oi', ['Aqui é o consultório', '*1* 💬 Dúvidas', '*2* 🗓️ Marcar', '*3* 🗣️ Falar com alguém', '*4* 🔄 Ver, remarcar']],
])

// Desde 15/10/2026 o nome e o da crianca, citada no menu: quem escreve e a mae,
// e "Ola, Ana!" cumprimentava a crianca como se fosse ela digitando.
await caso('Paciente cadastrado: a criança é citada pelo nome, sem cumprimentá-la', [['Oi', ['Olá! Aqui é', 'cuidar de Ana']]], {
  pacientes: [ANA],
  verificar: ({ ultimoToque, titulo }) => {
    if (!ultimoToque.resposta.includes('Olá, Ana')) passou++
    else falhas.push(`${titulo} | ainda cumprimenta a criança`)
  },
})
await caso('Irmãos no telefone: nenhum nome, "do seu filho"', [['Oi', 'cuidar do seu filho']], { pacientes: [ANA, PEDRO] })

await caso('Dois pacientes no telefone: saudação sem nome', [['Oi', 'Aqui é o consultório']], {
  pacientes: [ANA, PEDRO],
})

// Com mais de uma unidade, a opcao 1 pergunta onde antes de responder: o
// valor de Santos nao e o de Sao Paulo. O texto geral da clinica continua
// valendo para a unidade que nao tem texto proprio.
await caso('Opção 1 pergunta a unidade e depois entrega as informações', [
  ['Oi', 'Como podemos ajudar'],
  ['1', ['Para qual atendimento', '*1* Liferty · Santos', '*3* Livance Ibirapuera']],
  ['1', ['R$ 450,00', 'ver outra unidade']],
])

// Com um atendimento só, o robô não oferece "ver outra unidade": o *1* levava
// de volta à mesmíssima mensagem, que convidava de novo a ver a outra unidade
// que não existe. Digita 1, lê o mesmo texto, digita 1, lê o mesmo texto.
await caso('Opção 1 com uma unidade só responde direto, e sem oferecer outra', [
  ['Oi', 'Como podemos ajudar'],
  ['1', ['R$ 450,00', 'voltar ao início']],
], {
  unidades: UMA_UNIDADE,
  verificar: ({ ultimoToque, titulo }) => {
    if (ultimoToque.resposta.includes('outra unidade')) {
      falhas.push(`${titulo} | ofereceu uma unidade que não existe`)
    } else passou++
    const ids = (ultimoToque.lista?.linhas ?? []).map((l) => l.id)
    if (ids.includes('1')) falhas.push(`${titulo} | a lista ainda tem a linha "Outra unidade"`)
    else passou++
  },
})

// O fecho comum (telefones, horario, como agendar) vai no fim do texto de
// qualquer unidade: e o campo antigo de informacoes, editado uma vez so.
await caso('O fecho comum vai no fim do texto da unidade', [
  ['Oi', 'Como podemos ajudar'],
  ['1', 'Para qual atendimento'],
  ['3', ['R$ 550,00', '13 3273-6828']],
], {
  unidades: [TRES_UNIDADES[0], TRES_UNIDADES[1], { ...TRES_UNIDADES[2], info_text: '*Consulta em São Paulo: R$ 550,00.*' }],
})

await caso('Texto próprio da unidade vence o texto geral', [
  ['Oi', 'Como podemos ajudar'],
  ['1', 'Para qual atendimento'],
  ['3', ['R$ 550,00', 'Vila Clementino']],
], {
  unidades: [
    TRES_UNIDADES[0],
    TRES_UNIDADES[1],
    { ...TRES_UNIDADES[2], info_text: '*Consulta em São Paulo: R$ 550,00.*\nVila Clementino.' },
  ],
})

await caso('Opção 3 chama a equipe e sinaliza', [
  ['Oi', 'Como podemos ajudar'],
  ['3', ['direcionando você para alguém da nossa equipe', 'segunda a sexta']],
  ['tenho uma dúvida', null],
])

await caso('Resposta sem sentido no menu não deixa no vácuo', [
  ['Oi', 'Como podemos ajudar'],
  ['blablabla', ['Não entendi', '*1* 💬 Dúvidas']],
  ['7', ['Não entendi', '*2* 🗓️ Marcar']],
])

await caso('MENU volta ao início de qualquer etapa', [
  ['agendar', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['MENU', 'Como podemos ajudar'],
])

await caso('0 também volta ao menu', [
  ['agendar', 'Em qual unidade'],
  ['0', 'Como podemos ajudar'],
])

await caso('ATENDENTE funciona no meio do agendamento', [
  ['agendar', 'Em qual unidade'],
  ['atendente', 'direcionando você'],
])

await caso('CANCELAR no meio do fluxo devolve ao menu', [
  ['agendar', 'Em qual unidade'],
  ['cancelar', ['parei por aqui', '*1* 💬 Dúvidas']],
])

// ---------------------------------------------------------------
// 2. Agendamento
// ---------------------------------------------------------------

await caso(
  'Cadastrado marca direto e a consulta sai confirmada',
  [
    ['Oi', 'cuidar de Ana'],
    ['2', 'Em qual unidade'],
    ['1', 'Datas disponíveis'],
    ['1', 'Horários de'],
    ['1', ['Consulta marcada!', 'Av. Ana Costa', 'confirmar sua presença']],
  ],
  {
    pacientes: [ANA],
    verificar: ({ marcadas, titulo }) => {
      const m = marcadas[0]
      if (!m) return falhas.push(`${titulo} | nenhuma consulta gravada`)
      if (m.confirmed_by_clinic !== true) falhas.push(`${titulo} | deveria nascer confirmada`)
      else passou++
      if (m.hold_expires_at !== null) falhas.push(`${titulo} | cadastrado não deve ter reserva provisória`)
      else passou++
      if (m.patient_id !== 'p1') falhas.push(`${titulo} | patient_id errado: ${m.patient_id}`)
      else passou++
    },
  },
)

await caso(
  'Sem cadastro também sai com a consulta confirmada na hora',
  [
    ['Oi', 'Aqui é o consultório'],
    ['2', 'Em qual unidade'],
    ['1', 'Datas disponíveis'],
    ['1', 'Horários de'],
    // Nada de "solicitacao": quem chega pelo WhatsApp e quem menos conhece a
    // clinica, e sai daqui com o horario garantido. O comprovante inteiro vem
    // depois da ficha, para ser a ultima coisa da conversa.
    ['1', ['está guardado', 'perguntas rápidas', 'nome completo do paciente']],
  ],
  {
    verificar: ({ marcadas, titulo }) => {
      const m = marcadas[0]
      if (!m) return falhas.push(`${titulo} | nenhuma consulta gravada`)
      if (m.confirmed_by_clinic !== true) falhas.push(`${titulo} | deveria nascer confirmada`)
      else passou++
      if (m.hold_expires_at !== null) falhas.push(`${titulo} | não deve mais reservar provisoriamente`)
      else passou++
      if (m.contact_name !== 'Paula Medina')
        falhas.push(`${titulo} | deveria usar o nome do WhatsApp, veio "${m.contact_name}"`)
      else passou++
    },
  },
)

await caso(
  'Dois irmãos: pergunta e grava no escolhido',
  [
    ['Oi', 'Como podemos ajudar'],
    ['2', ['Para quem é a consulta', '*1* Ana Paula Souza', '*2* Pedro Souza', 'Digite *9*']],
    ['2', 'Em qual unidade'],
    ['1', 'Datas disponíveis'],
    ['1', 'Horários de'],
    ['2', 'está guardado'],
  ],
  {
    pacientes: [ANA, PEDRO],
    verificar: ({ marcadas, titulo }) => {
      const m = marcadas[0]
      if (m?.patient_id !== 'p2') falhas.push(`${titulo} | gravou no paciente errado: ${m?.patient_id}`)
      else passou++
      if (m?.contact_name !== 'Pedro Souza')
        falhas.push(`${titulo} | nome errado na consulta: ${m?.contact_name}`)
      else passou++
    },
  },
)

await caso(
  'Uma unidade só: pula a pergunta de unidade',
  [
    ['Oi', 'Como podemos ajudar'],
    ['2', 'Datas disponíveis'],
  ],
  { unidades: UMA_UNIDADE },
)

await caso('Unidade sem agenda: continua na lista, não trava', [
  ['agendar', 'Em qual unidade'],
  ['2', ['não temos horários abertos em Livance · Santo André', 'outra unidade da lista']],
  ['1', 'Datas disponíveis'],
])

await caso(
  'Nenhuma unidade com agenda: manda para a equipe',
  [
    ['agendar', ['não temos horários abertos para agendamento', '*9*']],
  ],
  { slots: SLOTS_VAZIOS },
)

await caso(
  'Banco recusando a consulta: admite a falha em vez de mentir',
  [['agendar', ['Tive um problema para consultar a agenda', 'Já avisei a nossa equipe']]],
  { falharSlots: true },
)

await caso(
  'Horário tomado por outro entre a lista e a escolha',
  [
    ['agendar', 'Em qual unidade'],
    ['1', 'Datas disponíveis'],
    ['1', 'Horários de'],
    ['1', ['acabou de ser ocupado', 'Digite *2* para ver os horários atualizados']],
  ],
  { erroInsert: { code: '23505' } },
)

await caso(
  'Falha inesperada ao gravar: nao promete o que nao cumpriu',
  [
    ['agendar', 'Em qual unidade'],
    ['1', 'Datas disponíveis'],
    ['1', 'Horários de'],
    ['1', ['Não consegui concluir o agendamento', 'equipe']],
  ],
  { erroInsert: { code: '42501', message: 'boom' } },
)

await caso('VOLTAR sobe um nível de cada vez', [
  ['agendar', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['1', 'Horários de'],
  ['VOLTAR', 'Datas disponíveis'],
  ['VOLTAR', 'Em qual unidade'],
  ['VOLTAR', 'Como podemos ajudar'],
])

await caso(
  'VOLTAR com dois irmãos sobe até a escolha do paciente',
  [
    ['agendar', 'Para quem é a consulta'],
    ['1', 'Em qual unidade'],
    ['VOLTAR', 'Para quem é a consulta'],
    ['VOLTAR', 'Como podemos ajudar'],
  ],
  { pacientes: [ANA, PEDRO] },
)

await caso('Número fora da faixa em cada etapa', [
  ['agendar', 'Em qual unidade'],
  ['99', ['Não entendi', 'número da unidade']],
  ['1', 'Datas disponíveis'],
  ['99', ['Não entendi', 'número do dia']],
  ['1', 'Horários de'],
  ['99', ['Não entendi', 'número do horário']],
])

// ---------------------------------------------------------------
// 3. Silêncio
// ---------------------------------------------------------------

// Quem escolhe a opcao 3 e quem realmente cala o robo - e so ele. A bandeira de
// atencao deixou de silenciar em 30/08/2026: ela acende tambem para quem
// cancelou sozinho, e essa pessoa nao esta esperando ninguem falar.
await caso('Quem pediu atendente: robô não fala por cima', [
  ['Oi', 'Como podemos ajudar'],
  ['3', 'direcionando você'],
  ['tudo bem?', null],
  ['e aí?', null],
])


await caso('Mas MENU fura o silêncio e o fluxo volta a responder', [
  ['Oi', 'Como podemos ajudar'],
  ['3', 'direcionando você'],
  ['tudo bem?', null],
  ['MENU', 'Como podemos ajudar'],
  ['2', 'Em qual unidade'],
])


await caso('Respondendo acompanhamento: nada de menu', [['Estou bem, obrigada', null]], {
  podeIniciarMenu: false,
})

await caso(
  'Mas quem pede para agendar é atendido mesmo assim',
  [['agendar', 'Em qual unidade']],
  { podeIniciarMenu: false },
)

// Depois do acompanhamento pos-consulta (casos reais de 03/10/2026). O
// "Que bom saber!" do robo ja tinha saido, entao podeIniciarMenu era verdadeiro
// e a mensagem seguinte era tratada como inicio de conversa.
await caso(
  'Real 03/10: recado depois do acompanhamento vai para a equipe, sem sermão',
  [[
    'Bom dia dos 3 exames que o Dr pediu para o Rafael, já consegui fazer 2. Estou no aguardo da autorização do convênio para o 3 exame.',
    ['Obrigado por nos contar', 'Dr. Marcello fica sabendo'],
  ]],
  {
    posAcompanhamento: true,
    verificar: ({ conversa, ultimoToque, titulo }) => {
      if (ultimoToque.atencao !== 'atendente') falhas.push(`${titulo} | atenção ${ultimoToque.atencao}`)
      else passou++
      if (conversa.booking_state !== 'atendente') falhas.push(`${titulo} | etapa ${conversa.booking_state}`)
      else passou++
      if (/sintomas, remédios/.test(ultimoToque.resposta)) falhas.push(`${titulo} | ainda diz que não orienta`)
      else passou++
    },
  },
)

await caso(
  'Real 03/10: "Obrigada🙏🏻🌹" depois do acompanhamento não recebe a apresentação',
  [['Obrigada🙏🏻🌹', 'Nós que agradecemos']],
  {
    posAcompanhamento: true,
    verificar: ({ ultimoToque, titulo }) => {
      if (/consultório do Dr/.test(ultimoToque.resposta)) falhas.push(`${titulo} | mandou a apresentação`)
      else passou++
      if (!ultimoToque.concluida || ultimoToque.atencao) falhas.push(`${titulo} | deveria concluir sem chamar a equipe`)
      else passou++
    },
  },
)

// Resposta digitada direto no acompanhamento (podeIniciarMenu falso): antes era
// silencio, e a familia ficava sem saber se alguem leu.
await caso(
  'Acompanhamento respondido por escrito: a família ouve que a equipe recebeu',
  [['Ele melhorou bastante da constipação, obrigada doutor', 'Obrigado por nos contar']],
  { posAcompanhamento: true, podeIniciarMenu: false },
)

await caso(
  'Acompanhamento com urgência sobe como urgência',
  [['Ele piorou muito, está vomitando sem parar, é urgente', 'é urgência']],
  {
    posAcompanhamento: true,
    verificar: ({ ultimoToque, titulo }) => {
      if (ultimoToque.atencao !== 'urgencia') falhas.push(`${titulo} | atenção ${ultimoToque.atencao}`)
      else passou++
    },
  },
)

await caso(
  'Depois do acompanhamento, pedido de retorno abre a agenda (não vira recado)',
  [['quero marcar o retorno dele', 'Em qual unidade']],
  { posAcompanhamento: true },
)

await caso(
  'Depois do acompanhamento, cumprimento continua recebendo o menu',
  [['Bom dia', 'Como podemos ajudar']],
  { posAcompanhamento: true },
)

// Fora do acompanhamento, "ok obrigada" sem etapa aberta (depois de "Consulta
// confirmada", por exemplo) tambem nao recebe a apresentacao.
await caso(
  'Agradecimento sem etapa aberta: "Por nada", sem apresentação',
  [['Ok, obrigada!', 'Por nada']],
  {
    verificar: ({ ultimoToque, titulo }) => {
      if (/consultório do Dr/.test(ultimoToque.resposta)) falhas.push(`${titulo} | mandou a apresentação`)
      else passou++
    },
  },
)

// Sem o contexto do acompanhamento, frase longa continua no caminho de sempre.
await caso(
  'Sem acompanhamento recente, sintoma continua recebendo a orientação de sempre',
  [['meu filho está com dor de barriga desde ontem', 'o Dr. Marcello examina a criança']],
)

// ---------------------------------------------------------------
// 4. Bordas de texto
// ---------------------------------------------------------------

await caso('Aceita "1." e "opção 2"', [
  ['Oi', 'Como podemos ajudar'],
  ['1.', 'Para qual atendimento'],
  ['1', 'R$ 450,00'],
  ['opção 2', 'Em qual unidade'],
])

await caso('Mensagem de áudio não quebra o fluxo', [
  ['Oi', 'Como podemos ajudar'],
  ['[audio]', 'Não entendi'],
])

await caso(
  'Sem textos configurados, ainda existe uma saudação',
  [['Oi', ['Aqui é o consultório do Dr. Marcello Ruiz, Gastroenterologista Pediátrico', '*1* 💬 Dúvidas']]],
  { textos: { saudacao: '', saudacaoConhecida: '', informacoes: '' } },
)

await caso(
  'Opção 1 sem texto cadastrado não devolve mensagem vazia',
  [
    ['Oi', 'Como podemos ajudar'],
    ['1', '*1* 💬 Dúvidas'],
  ],
  { textos: { ...TEXTOS, informacoes: '' }, unidades: UMA_UNIDADE },
)

// ---------------------------------------------------------------
// 4b. Minha consulta (opcao 4)
// ---------------------------------------------------------------

const CONSULTA_ANA = {
  id: 'a1',
  inicio: '2026-09-01T11:00:00Z',
  unidade: 'Liferty · Santos',
  endereco: 'Av. Ana Costa, 100',
  paciente: 'Ana Paula Souza',
  confirmada: true,
}

await caso('Sem consulta marcada, a opção 4 não deixa no vácuo', [
  ['Oi', 'Como podemos ajudar'],
  ['4', ['Não encontrei nenhuma consulta marcada', 'Digite *2* para agendar']],
])

await caso(
  'Com consulta marcada, a opção 4 mostra os dados',
  [
    ['Oi', 'Como podemos ajudar'],
    ['4', ['Sua consulta', 'Ana Paula Souza', 'Liferty · Santos', 'CANCELAR', 'REMARCAR']],
  ],
  { consultas: [CONSULTA_ANA] },
)

await caso(
  'Cancelar exige confirmação explícita',
  [
    ['Oi', 'Como podemos ajudar'],
    ['4', 'Sua consulta'],
    ['CANCELAR', ['Confirma o cancelamento', 'Responda SIM']],
    ['não', ['continua marcada', '*1* 💬 Dúvidas']],
  ],
  {
    consultas: [CONSULTA_ANA],
    verificar: ({ canceladas, titulo }) => {
      if (canceladas.length > 0) falhas.push(`${titulo} | cancelou sem o SIM`)
      else passou++
    },
  },
)

await caso(
  'Cancelar com SIM desmarca e acende a conversa',
  [
    ['Oi', 'Como podemos ajudar'],
    ['4', 'Sua consulta'],
    ['CANCELAR', 'Responda SIM'],
    ['SIM', ['Consulta cancelada', 'digite 2']],
  ],
  {
    consultas: [CONSULTA_ANA],
    verificar: ({ canceladas, titulo }) => {
      if (canceladas[0] !== 'a1') falhas.push(`${titulo} | não cancelou a consulta certa`)
      else passou++
    },
  },
)

// Quem desiste no meio das perguntas fica com a consulta marcada e a ficha
// vazia. Até 16/09/2026 a remarcação pulava a ficha inteira, e virava a porta
// dos fundos para nunca mais responder nada: foi o caso do Marcos, que saiu na
// primeira pergunta, remarcou e recebeu "Consulta remarcada!" sem cadastro.
await caso('Remarcação de quem não completou o cadastro volta a perguntar', [
  ['Oi', 'Como podemos ajudar'],
  ['4', 'Sua consulta'],
  ['REMARCAR', 'Vamos remarcar'],
  ['SIM', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['1', 'Horários de'],
  ['1', ['está guardado', 'nome completo do paciente']],
], {
  // Consulta existente sem paciente vinculado: é o contato que marcou pelo
  // WhatsApp e abandonou as perguntas.
  consultas: [{ ...CONSULTA_ANA, paciente: 'Marcos' }],
  pacientes: [],
})

// E quem já tem tudo continua sem ser interrogado na remarcação.
await caso(
  'Remarcar leva a contagem adiante em vez de zerar',
  [
    ['Oi', 'Como podemos ajudar'],
    ['4', 'Sua consulta'],
    ['REMARCAR', 'Vamos remarcar'],
    ['SIM', 'Em qual unidade'],
    ['1', 'Datas disponíveis'],
    ['1', 'Horários de'],
    ['1', 'Consulta remarcada!'],
  ],
  {
    consultas: [CONSULTA_ANA],
    pacientes: [ANA],
    // A antiga ja tinha trocado de data duas vezes.
    remarcacoesAnteriores: 2,
    verificar: ({ marcadas, titulo }) => {
      const nova = marcadas[0] ?? {}
      // Remarcar cria linha nova e cancela a antiga. Sem carregar a contagem, a
      // terceira troca de data apareceria na agenda como se fosse a primeira.
      if (nova.reschedule_count !== 3) {
        falhas.push(`${titulo} | esperava contagem 3, veio ${nova.reschedule_count}`)
      } else passou++
      if (nova.rescheduled_from !== 'a1') {
        falhas.push(`${titulo} | perdeu o vínculo com a consulta anterior`)
      } else passou++
    },
  },
)

await caso(
  'Marcação nova nasce com contagem zero',
  [
    ['agendar', 'Em qual unidade'],
    ['1', 'Datas disponíveis'],
    ['1', 'Horários de'],
    ['1', 'Consulta marcada!'],
  ],
  {
    pacientes: [ANA],
    verificar: ({ marcadas, titulo }) => {
      const nova = marcadas[0] ?? {}
      if (nova.reschedule_count !== 0 || nova.rescheduled_from !== null) {
        falhas.push(`${titulo} | consulta nova não deveria contar remarcação`)
      } else passou++
    },
  },
)

await caso(
  'Remarcar so cancela a antiga depois que a nova entra',
  [
    ['Oi', 'Como podemos ajudar'],
    ['4', 'Sua consulta'],
    ['REMARCAR', ['Vamos remarcar', 'só será cancelada depois']],
    ['SIM', 'Em qual unidade'],
    ['1', 'Datas disponíveis'],
    ['1', 'Horários de'],
    ['1', 'Consulta remarcada!'],
  ],
  {
    consultas: [CONSULTA_ANA],
    pacientes: [ANA],
    verificar: ({ marcadas, canceladas, titulo }) => {
      if (marcadas.length !== 1) falhas.push(`${titulo} | deveria marcar exatamente uma`)
      else passou++
      if (canceladas[0] !== 'a1') falhas.push(`${titulo} | não cancelou a antiga`)
      else passou++
    },
  },
)

await caso(
  'Quem já tem consulta é avisado antes de criar outra',
  [
    ['Oi', 'Como podemos ajudar'],
    ['2', ['Você já tem uma consulta marcada', '1 - Remarcar', '2 - Marcar mais uma']],
  ],
  { consultas: [CONSULTA_ANA], pacientes: [ANA] },
)

await caso(
  'Escolhendo "marcar mais uma", segue o fluxo normal',
  [
    ['Oi', 'Como podemos ajudar'],
    ['2', 'Você já tem uma consulta'],
    // Desde 14/10/2026 "marcar mais uma" pergunta para quem (ver OUTRA_CRIANCA).
    ['2', ['Para quem é a consulta', 'Ana Paula Souza', 'Outra criança']],
    ['1', 'Em qual unidade'],
    ['1', 'Datas disponíveis'],
    ['1', 'Horários de'],
    ['1', ['Consulta marcada!', '👶 Ana Paula Souza']],
  ],
  {
    consultas: [CONSULTA_ANA],
    pacientes: [ANA],
    verificar: ({ canceladas, titulo }) => {
      if (canceladas.length > 0) falhas.push(`${titulo} | não devia cancelar a existente`)
      else passou++
    },
  },
)

// Regressao de 30/08/2026: o cancelamento acende a bandeira de atencao, e a
// bandeira silencia o robo quando nao ha etapa aberta. A mensagem prometia
// "digite 2" e o robo emudecia. O menu tem de continuar ativo depois de toda
// mensagem que oferece um numero.
await caso(
  'Depois de cancelar, o "2" prometido continua funcionando',
  [
    ['Oi', 'Como podemos ajudar'],
    ['4', 'Sua consulta'],
    ['CANCELAR', 'Responda SIM'],
    ['SIM', ['Consulta cancelada', 'digite 2']],
    ['2', 'Em qual unidade'],
  ],
  { consultas: [CONSULTA_ANA], pacientes: [ANA] },
)

await caso(
  'Depois de cancelar, um "Oi" novo não cai no vácuo',
  [
    ['Oi', 'Como podemos ajudar'],
    ['4', 'Sua consulta'],
    ['CANCELAR', 'Responda SIM'],
    ['SIM', 'Consulta cancelada'],
    ['Oi', ['*1* 💬 Dúvidas', '*2* 🗓️ Marcar']],
  ],
  { consultas: [CONSULTA_ANA], pacientes: [ANA] },
)

await caso(
  'Horário tomado por outro: o "2" prometido também funciona',
  [
    ['agendar', 'Em qual unidade'],
    ['1', 'Datas disponíveis'],
    ['1', 'Horários de'],
    ['1', 'Digite *2* para ver os horários atualizados'],
    ['2', 'Em qual unidade'],
  ],
  { erroInsert: { code: '23505' } },
)

// ---------------------------------------------------------------
// 4c. Botoes e listas tocaveis
//
// A Meta recusa a mensagem INTEIRA quando um limite estoura, entao os limites
// sao verificados aqui: 3 botoes, 10 linhas, titulo de botao com 20, linha com
// 24, descricao com 72.
// ---------------------------------------------------------------

/**
 * Toda lista precisa terminar com a volta ao menu.
 *
 * Sem ela, quem so toca fica preso: o texto oferece "0", mas quem nao le o
 * texto - que e justamente quem usa a lista - nao tem por onde sair.
 */
function conferirSaida(toque, titulo) {
  const linhas = toque?.lista?.linhas
  if (!linhas) return
  // O proprio menu nao precisa de linha para voltar ao menu.
  if (toque.lista.rotulo === 'Ver opções') return
  const fim = linhas[linhas.length - 1]
  if (fim.id !== '0') falhas.push(`${titulo} | lista sem saída tocável no fim (último id: ${fim.id})`)
  else passou++
}

function conferirLimites(toque, titulo) {
  conferirSaida(toque, titulo)
  for (const b of toque.botoes ?? []) {
    if (b.titulo.length > 20) falhas.push(`${titulo} | botão "${b.titulo}" passa de 20 caracteres`)
    else passou++
  }
  if ((toque.botoes ?? []).length > 3) falhas.push(`${titulo} | mais de 3 botões`)

  const lista = toque.lista
  if (lista) {
    if (lista.rotulo.length > 20) falhas.push(`${titulo} | rótulo "${lista.rotulo}" passa de 20`)
    else passou++
    if (lista.linhas.length > 10) falhas.push(`${titulo} | lista com mais de 10 linhas`)
    else passou++
    for (const l of lista.linhas) {
      if (l.titulo.length > 24) falhas.push(`${titulo} | linha "${l.titulo}" passa de 24`)
      else passou++
      if ((l.descricao ?? '').length > 72) falhas.push(`${titulo} | descrição longa em "${l.titulo}"`)
      else passou++
    }
  }
}

await caso(
  'Menu vem como lista tocável com as cinco opções',
  [['Oi', 'Como podemos ajudar']],
  {
    verificar: ({ ultimoToque, titulo }) => {
      const linhas = ultimoToque.lista?.linhas ?? []
      if (linhas.length !== 5) falhas.push(`${titulo} | esperava 5 linhas, veio ${linhas.length}`)
      else passou++
      // Os ids precisam ser exatamente o que o robô aceita digitado.
      if (linhas.map((l) => l.id).join(',') !== '1,2,3,4,5') {
        falhas.push(`${titulo} | ids fora do padrão: ${linhas.map((l) => l.id).join(',')}`)
      } else passou++
      conferirLimites(ultimoToque, titulo)
    },
  },
)

await caso(
  'Tocar na lista funciona igual a digitar o número',
  [
    ['Oi', 'Como podemos ajudar'],
    // O webhook manda o id do toque no lugar do texto - aqui é o mesmo "2".
    ['2', 'Em qual unidade'],
  ],
  {
    verificar: ({ ultimoToque, titulo }) => {
      if (!ultimoToque.lista) falhas.push(`${titulo} | unidade deveria vir como lista`)
      else passou++
      conferirLimites(ultimoToque, titulo)
    },
  },
)

await caso(
  'Minha consulta oferece três botões',
  [
    ['Oi', 'Como podemos ajudar'],
    ['4', 'Sua consulta'],
  ],
  {
    consultas: [CONSULTA_ANA],
    verificar: ({ ultimoToque, titulo }) => {
      const ids = (ultimoToque.botoes ?? []).map((b) => b.id).join(',')
      if (ids !== 'REMARCAR,CANCELAR,MENU') falhas.push(`${titulo} | botões inesperados: ${ids}`)
      else passou++
      conferirLimites(ultimoToque, titulo)
    },
  },
)

await caso(
  'Confirmação de cancelamento vira sim/não tocável',
  [
    ['Oi', 'Como podemos ajudar'],
    ['4', 'Sua consulta'],
    ['CANCELAR', 'Responda SIM'],
  ],
  {
    consultas: [CONSULTA_ANA],
    verificar: ({ ultimoToque, titulo }) => {
      const ids = (ultimoToque.botoes ?? []).map((b) => b.id).join(',')
      if (ids !== 'SIM,MENU') falhas.push(`${titulo} | botões inesperados: ${ids}`)
      else passou++
      conferirLimites(ultimoToque, titulo)
    },
  },
)

await caso(
  'Dia vem como lista, e horário também quando cabe',
  [
    ['agendar', 'Em qual unidade'],
    ['1', 'Datas disponíveis'],
    ['1', 'Horários de'],
  ],
  {
    verificar: ({ ultimoToque, titulo }) => {
      const linhas = ultimoToque.lista?.linhas ?? []
      // 6 horarios + a linha de volta que toda lista carrega no fim
      // Seis horarios mais as duas saidas: falar com a equipe e voltar ao menu.
      if (linhas.length !== 8) falhas.push(`${titulo} | esperava 6 horários + 2 saídas, veio ${linhas.length}`)
      else passou++
      conferirLimites(ultimoToque, titulo)
    },
  },
)

// ---------------------------------------------------------------
// 5. Coisas que quero OBSERVAR, nao afirmar
// ---------------------------------------------------------------

const r1 = await caso('Paciente quer cancelar consulta fora do lembrete', [['cancelar minha consulta', []]])
achados.push(
  'Cancelar/remarcar fora da janela do lembrete:\n' +
    r1.transcricao.join('\n'),
)

const r2 = await caso('Paciente pergunta quando é a consulta dele', [['quando é minha consulta?', []]])
achados.push('Consultar a propria consulta:\n' + r2.transcricao.join('\n'))

const r3 = await caso('Responde com o horário em vez do número da linha', [
  ['agendar', []],
  ['1', []],
  ['1', []],
  ['08:40', []],
])
achados.push('Responder "08:40" em vez de "2":\n' + r3.transcricao.slice(-1).join('\n'))

// ---------------------------------------------------------------------------
// O 9 como saida universal
//
// Ele so pode significar "falar com a equipe" porque nenhuma lista chega a nove
// opcoes. Se um dia alguem aumentar MAX_DIAS ou MAX_HORARIOS_DIA, e aqui que
// isso vai doer, e nao numa conversa real em que o paciente pediu o nono
// horario e caiu na fila da secretaria.
// ---------------------------------------------------------------------------

await caso('O 9 chama a equipe a partir do menu', [
  ['Oi', 'Como podemos ajudar'],
  ['9', 'alguém da nossa equipe'],
])

await caso('O 9 chama a equipe no meio do agendamento', [
  ['agendar', 'Em qual unidade'],
  ['9', 'alguém da nossa equipe'],
])

await caso('Unidade de nome longo continua com botão e sem estourar o limite', [
  ['Oi', 'Como podemos ajudar'],
  ['2', 'Em qual unidade'],
])

// ---------------------------------------------------------------------------
// Respostas prontas
//
// O robo responde a pergunta escrita quando a clinica cadastrou aquele assunto.
// Tres coisas precisam continuar valendo: acertar o assunto, calar a boca em
// assunto clinico, e nao inventar quando nada bate.
// ---------------------------------------------------------------------------

const TELE = { ativa: true, texto: '*Telemedicina: R$ 450,00.* Retorno presencial em 30 dias.' }

const RESPOSTAS = [
  {
    id: 'r1',
    subject: 'Valor e pagamento',
    keywords: ['valor', 'quanto', 'custa', 'preco', 'pix', 'cartao', 'pagamento'],
    answer: 'A consulta particular custa R$ 450,00. Aceitamos pix e cartão.',
  },
  {
    id: 'r2',
    subject: 'Convênios',
    keywords: ['convenio', 'plano', 'reembolso', 'carteirinha'],
    answer: 'O atendimento é particular. Emitimos recibo para reembolso.',
  },
]

// Quatro assuntos diferentes, para o limite da fila ser contado com
// respostas DIFERENTES: desde 14/10/2026 a mesma resposta nao sai duas vezes
// em meia hora (jaMandada), e "Aceitam cartao?" logo depois do valor - que ja
// fala de cartao - fica em silencio.
const RESPOSTAS_DA_FILA = [
  ...RESPOSTAS,
  { id: 'r3', subject: 'Endereço', keywords: ['endereco', 'onde', 'fica'], answer: '📍 Av. Ana Costa, 228, 20º andar, Gonzaga.' },
  { id: 'r4', subject: 'Idade', keywords: ['idade', 'anos', 'adolescente'], answer: 'Atendemos crianças e adolescentes de 0 a 18 anos.' },
]

await caso('Pergunta de valor recebe a resposta pronta', [
  ['Quanto custa a consulta?', 'custa R$ 450,00'],
], { respostasProntas: RESPOSTAS })

await caso('Acento e plural não atrapalham', [
  ['Vocês atendem convênios?', 'particular. Emitimos recibo'],
], { respostasProntas: RESPOSTAS })

await caso('Depois da resposta pronta o 2 ainda marca consulta', [
  ['Qual o valor?', 'custa R$ 450,00'],
  ['2', 'Em qual unidade'],
], { respostasProntas: RESPOSTAS })

await caso('Pergunta clínica não é respondida, mas recebe o caminho certo', [
  ['Meu filho está com dor de barriga, posso dar dipirona?', ['o Dr. Marcello examina a criança', '*3* para falar com a equipe']],
], { respostasProntas: RESPOSTAS })

await caso('Palavra de valor junto de sintoma não recebe o preço', [
  ['Ele está com febre, quanto custa a consulta?', 'o Dr. Marcello examina a criança'],
], { respostasProntas: RESPOSTAS })

await caso('Assunto que ninguém cadastrou cai no menu, sem inventar', [
  ['Vocês têm convênio com o meu banco de leite?', 'particular. Emitimos recibo'],
], { respostasProntas: RESPOSTAS })

await caso('Sintoma junto de "quero marcar" continua podendo marcar pelo menu', [
  ['oi, meu filho tem refluxo, queria marcar uma consulta', 'o Dr. Marcello examina a criança'],
  ['2', 'Em qual unidade'],
], { respostasProntas: RESPOSTAS })

await caso('Sem nada cadastrado, tudo segue como antes', [
  ['Quanto custa a consulta?', 'Como podemos ajudar'],
])

await caso('Pergunta escrita depois do menu também é respondida', [
  ['Oi', 'Como podemos ajudar'],
  ['e o valor?', 'custa R$ 450,00'],
], { respostasProntas: RESPOSTAS })

// ---------------------------------------------------------------
// Resposta pronta enquanto a equipe nao chega
// ---------------------------------------------------------------

// A fila pode durar a noite inteira, e nela a pessoa escreve as duvidas de
// sempre. Tres respostas prontas ela recebe; da quarta em diante o robo cala.
// Se tres textos prontos nao resolveram, o quarto tambem nao resolve.
await caso('Esperando a equipe: três respostas prontas, depois silêncio', [
  ['Oi', 'Como podemos ajudar'],
  ['3', 'direcionando você'],
  ['Vocês atendem convênio?', ['particular', 'continua na fila']],
  ['Qual o valor?', ['R$ 450,00', 'continua na fila']],
  ['Onde fica o consultório?', ['Ana Costa', 'continua na fila']],
  ['Atende até que idade?', null],
], { respostasProntas: RESPOSTAS_DA_FILA })

// A resposta pronta nao tira a pessoa da fila: a etapa continua 'atendente' e a
// equipe continua devendo resposta. Por isso o "bom dia" seguinte cai no
// silencio, e nao no menu.
await caso('Resposta pronta na fila não solta a conversa da equipe', [
  ['Oi', 'Como podemos ajudar'],
  ['3', 'direcionando você'],
  ['Vocês atendem convênio?', 'continua na fila'],
  ['bom dia', null],
], { respostasProntas: RESPOSTAS })

// Caso real de 22/09/2026: a familia estava na fila desde a vespera e mandou
// "Boa tarde". Calar esta certo. O defeito era outro: o webhook calava sem
// acender a conversa, e ela ficou apagada o dia inteiro. Este caso fixa que o
// robo devolve silencio aqui - e e esse silencio (resultado nulo) que agora faz
// o webhook subir a bandeira de atencao.
await caso('Real 22/09: "Boa tarde" de quem está na fila fica em silêncio', [
  ['Oi', 'Como podemos ajudar'],
  ['3', 'direcionando você'],
  ['Boa tarde', null],
])

// Com alguem da equipe escrevendo agora, nem palavra-chave aparece: seria o
// robo falando por cima da atendente.
await caso('Equipe conversando: o robô não responde nem palavra-chave', [
  ['Vocês atendem convênio?', null],
], { respostasProntas: RESPOSTAS, podeIniciarMenu: false })

// O mesmo vale no menu, e ali a trava nao existia. Caso real de 15/09/2026: a
// equipe explicou a mao que a Trasmontano e atendida, e meia hora depois o robo
// repetiu a resposta pronta de convenio por cima dela.
await caso('Equipe conversando: nem resposta pronta nem "não entendi" no menu', [
  ['Unimed não?', null],
], { respostasProntas: RESPOSTAS, podeIniciarMenu: false })

// Numero de menu a pessoa escolheu de propósito, entao continua valendo mesmo
// com a equipe na conversa.
await caso('Mas o número do menu continua valendo', [
  ['Oi', 'Como podemos ajudar'],
  // A equipe entra na conversa a partir daqui.
  ['2', 'Em qual unidade', { podeIniciarMenu: false }],
])

// Pergunta curta na fila continua respondida: uma palavra basta quando a pessoa
// nao esta pedindo para marcar.
await caso('"Convênio?" na fila é respondido mesmo casando com uma palavra só', [
  ['Oi', 'Como podemos ajudar'],
  ['3', 'direcionando você'],
  ['convênio?', ['particular', 'continua na fila']],
], { respostasProntas: RESPOSTAS })

// E o pedido de marcar nao recebe a lista de documentos, porque "retorno"
// sozinho nao e pergunta. Desde 25/09/2026 ele recebe o botao de marcar - e so
// isso: a conversa continua na fila.
await caso('"Quero marcar retorno para o Tomás" na fila ganha o botão, não os documentos', [
  ['Oi', 'Como podemos ajudar'],
  ['3', 'direcionando você'],
  ['quero marcar retorno para o Tomás', ['Marcar uma consulta', 'continua na fila']],
], {
  verificar: ({ transcricao, titulo, ultimoToque, conversa }) => {
    if ((transcricao.at(-1) ?? '').includes('Leve um documento')) falhas.push(`${titulo}: recebeu a lista de documentos`)
    else passou++
    if (ultimoToque.botoes?.[0]?.titulo === 'Marcar uma consulta') passou++
    else falhas.push(`${titulo}: sem o botão de marcar`)
    if (conversa.booking_state === 'atendente') passou++
    else falhas.push(`${titulo}: saiu da fila (${conversa.booking_state})`)
  },
  respostasProntas: [...RESPOSTAS, {
  id: 'r4',
  subject: 'O que levar',
  keywords: ['levar', 'documento', 'retorno', 'exames'],
  answer: 'Leve um documento com foto do responsável.',
}] })

// ---------------------------------------------------------------
// "Quero marcar" escrito como as pessoas escrevem
// ---------------------------------------------------------------
//
// Ate 15/09/2026 so valia a frase exata. "Quero marcar retorno para o Tomás"
// caia na resposta pronta de documentos, porque "retorno" e palavra-chave dela.

for (const frase of [
  'quero marcar retorno para o Tomás Oliveira',
  'queria marcar uma consulta',
  'gostaria de agendar para o meu filho',
  'tem horarios essa semana?',
  'MARCAR',
]) {
  await caso(`"${frase}" abre o agendamento`, [[frase, 'Em qual unidade']])
}

// Primeira mensagem pedindo para agendar (01/10/2026): vai direto para a
// agenda, com a apresentação em cima e o *0* para ver as outras opções. Antes
// recebia o menu inteiro: das 16 conversas que chegaram pelo botão do site em
// 10 dias, três tocaram em "Minha consulta" achando que era "marcar" e
// acabaram pedindo atendente.
await caso('Mensagem do site vai direto para a agenda, com a apresentação', [
  ['Olá! Vim pelo site do Dr. Marcello e gostaria de agendar uma consulta.',
    ['Aqui é o consultório', 'Já separei a agenda', 'digite *0*', 'Em qual unidade']],
], { primeiraMensagem: true })

// E a agenda vence a resposta pronta: "retorno" é palavra-chave do texto de
// documentos, e quem pediu para marcar não perguntou o que levar (Regina,
// 15/09/2026).
await caso('Pedido de agendamento na primeira mensagem não vira resposta pronta', [
  ['quero marcar retorno para o Tomás', 'Em qual unidade'],
], { primeiraMensagem: true, respostasProntas: RESPOSTAS })

// Quem só cumprimentou continua vendo o menu, e o atalho vale depois dele.
await caso('Cumprimento na primeira mensagem vê o menu; depois o atalho vale', [
  ['Oi', 'Como podemos ajudar'],
  ['quero agendar', 'Em qual unidade'],
], { primeiraMensagem: true })

// Depois da agenda direta, o *0* mostra o menu completo - a saída prometida.
await caso('Da agenda direta, o 0 leva ao menu completo', [
  ['Olá! Vim pelo site do Dr. Marcello e gostaria de agendar uma consulta.', 'Em qual unidade'],
  ['0', 'Como podemos ajudar'],
], { primeiraMensagem: true })

// Remarcar e desmarcar contem "marcar" e sao o oposto: quem pede isso ja tem
// consulta. Vao para o menu, onde o *4* cuida do assunto.
for (const frase of ['quero remarcar', 'preciso desmarcar minha consulta']) {
  await caso(`"${frase}" não abre consulta nova`, [[frase, 'Como podemos ajudar']])
}

// Preco continua sendo preco: "consulta" sozinha nao abre a agenda.
await caso('"Quanto custa a consulta?" continua respondendo o valor', [
  ['Quanto custa a consulta?', 'custa R$ 450,00'],
], { respostasProntas: RESPOSTAS })

// ---------------------------------------------------------------
// Anexo: foto, exame, áudio
// ---------------------------------------------------------------

// O robo nao le arquivo nenhum. Responder o menu a uma foto de exame e dizer
// "nao vi o que voce mandou, escolha uma opcao".
await caso('Foto vai para a equipe, não recebe menu', [
  ['[ANEXO]', ['Recebi o que você enviou', 'equipe']],
])

// Segunda foto na mesma espera nao merece outro "vou entregar": a equipe ja
// esta com a conversa.
await caso('Segunda foto na fila não repete o aviso', [
  ['[ANEXO]', 'Recebi o que você enviou'],
  ['[ANEXO]', null],
])

// Anexo no meio de um agendamento tambem entrega: alguma coisa fora do comum
// esta acontecendo, e a pessoa quer que alguem olhe.
await caso('Foto no meio do agendamento também entrega para a equipe', [
  ['Oi', 'Como podemos ajudar'],
  ['2', 'Em qual unidade'],
  ['[ANEXO]', 'Recebi o que você enviou'],
])

// MENU continua furando tudo, inclusive a entrega do anexo.
await caso('Depois do anexo, MENU ainda volta ao início', [
  ['[ANEXO]', 'Recebi o que você enviou'],
  ['0', 'Como podemos ajudar'],
])

// ---------------------------------------------------------------
// Pergunta no meio de uma escolha
// ---------------------------------------------------------------

// Quem escreve "convenio" quando o robo espera um numero nao errou: mudou de
// assunto. A resposta vem primeiro e a pergunta da etapa e repetida abaixo.
await caso('Pergunta no meio da escolha da unidade é respondida', [
  ['Oi', 'Como podemos ajudar'],
  ['2', 'Em qual unidade'],
  ['Vocês atendem convênio?', ['particular', 'número da unidade']],
  ['1', 'Datas disponíveis'],
], { respostasProntas: RESPOSTAS })

await caso('E também no meio da escolha do dia e do horário', [
  ['Oi', 'Como podemos ajudar'],
  ['2', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['Qual o valor?', ['R$ 450,00', 'número do dia']],
  ['1', 'Horários de'],
  ['Aceitam cartão?', ['R$ 450,00', 'número do horário']],
  ['1', 'nome completo do paciente'],
], { respostasProntas: RESPOSTAS })

// Sintoma continua sem resposta automática, mesmo no meio de uma escolha: é
// consulta médica. E desde 20/09/2026 o robô diz POR QUE não responde, em vez
// de "não entendi" - a mãe que escreve um sintoma não errou a forma de
// responder, e mandá-la reler o menu não avisa ninguém.
await caso('Sintoma no meio da escolha não vira resposta automática', [
  ['Oi', 'Como podemos ajudar'],
  ['2', 'Em qual unidade'],
  ['ele está com febre, quanto custa?', ['não posso orientar', 'número da unidade']],
], { respostasProntas: RESPOSTAS })

// Urgencia nunca entra na conta: ela responde sempre, mesmo depois do limite.
await caso('Urgência responde mesmo com o limite estourado', [
  ['Oi', 'Como podemos ajudar'],
  ['3', 'direcionando você'],
  ['Vocês atendem convênio?', 'continua na fila'],
  ['Qual o valor?', 'continua na fila'],
  ['Onde fica o consultório?', 'continua na fila'],
  ['Atende até que idade?', null],
  ['é urgente, ele está passando mal', 'urgente'],
], { respostasProntas: RESPOSTAS_DA_FILA })

// O assunto marcado para perguntar a unidade nao responde o texto dele: faz a
// mesma pergunta da opcao 1 e entrega o texto do lugar escolhido.
const RESPOSTAS_POR_UNIDADE = [
  { ...RESPOSTAS[0], ask_unit: true },
  RESPOSTAS[1],
]

await caso('"Quanto custa" pergunta onde antes de responder', [
  ['Quanto custa a consulta?', ['custa R$ 450,00', 'Escolha o atendimento', 'Liferty · Santos', 'Telemedicina']],
  ['4', 'Retorno presencial em 30 dias'],
], { respostasProntas: RESPOSTAS_POR_UNIDADE, telemedicina: TELE })

await caso('"Quanto custa" com um lugar só responde o texto do assunto', [
  ['Quanto custa a consulta?', 'custa R$ 450,00'],
], { respostasProntas: RESPOSTAS_POR_UNIDADE, unidades: UMA_UNIDADE })

// ---------------------------------------------------------------------------
// Telemedicina
//
// Clinica SEM agenda propria de telemedicina: usa os horarios das unidades
// fisicas e grava na unidade que cedeu o horario, com modalidade
// 'telemedicina'. Com agenda propria (03/10/2026), ver os casos COM_TELE. E a
// unica etapa com saida de urgencia.
// ---------------------------------------------------------------------------

const SLOTS_DUAS = {
  'u-santos': [
    { slot_start: '2026-08-31T11:00:00Z', slot_end: '2026-08-31T11:40:00Z' },
    { slot_start: '2026-08-31T11:40:00Z', slot_end: '2026-08-31T12:20:00Z' },
  ],
  'u-andre': [],
  'u-vila': [
    { slot_start: '2026-09-02T13:00:00Z', slot_end: '2026-09-02T13:40:00Z' },
  ],
}

await caso('Telemedicina aparece na lista de unidades quando ligada', [
  ['agendar', ['Em qual unidade', 'Telemedicina (por vídeo)']],
], { telemedicina: TELE })

await caso('Telemedicina desligada não aparece', [
  ['agendar', 'Em qual unidade'],
], {
  verificar: ({ transcricao, titulo }) => {
    if (transcricao.join('').includes('Telemedicina')) falhas.push(`${titulo} | listou telemedicina desligada`)
    else passou++
  },
})

await caso('Telemedicina junta os dias das duas unidades', [
  ['agendar', 'Em qual unidade'],
  ['4', ['Datas disponíveis para telemedicina', '31/08', '02/09', 'urgência']],
], { telemedicina: TELE, slots: SLOTS_DUAS })

await caso('Telemedicina marca na unidade que cedeu o horário, como telemedicina', [
  ['agendar', 'Em qual unidade'],
  ['4', 'Datas disponíveis para telemedicina'],
  ['2', 'Horários de'],
  ['1', ['Consulta marcada', 'por vídeo', 'link da consulta']],
], {
  telemedicina: TELE,
  slots: SLOTS_DUAS,
  pacientes: [ANA],
  verificar: ({ marcadas, titulo }) => {
    const m = marcadas[0]
    if (!m) return falhas.push(`${titulo} | nada foi marcado`)
    if (m.unit_id !== 'u-vila') falhas.push(`${titulo} | unidade errada: ${m.unit_id}`)
    else passou++
    if (m.modality !== 'telemedicina') falhas.push(`${titulo} | modalidade errada: ${m.modality}`)
    else passou++
  },
})

// Agenda propria da telemedicina (03/10/2026). Em 03/10 o Dr. Marcello atendeu
// por video o Caio e a consulta estava gravada em "Livance Ibirapuera", onde
// ninguem procurou. A telemedicina virou uma unidade marcada (telemedicina =
// true), que nao e lugar: nao aparece entre as unidades, e e la que a consulta
// por video fica gravada.
const COM_TELE = [...TRES_UNIDADES, { id: 'u-tele', name: 'Telemedicina', address: '', telemedicina: true }]

await caso('Agenda da telemedicina não aparece como unidade física', [
  ['agendar', ['Em qual unidade', 'Telemedicina (por vídeo)']],
], {
  telemedicina: TELE,
  unidades: COM_TELE,
  verificar: ({ transcricao, titulo }) => {
    const lista = transcricao.join('')
    // So a opcao de video; a unidade "Telemedicina" crua nao pode aparecer.
    if ((lista.match(/Telemedicina/g) ?? []).length !== 1) falhas.push(`${titulo} | telemedicina listada duas vezes`)
    else passou++
  },
})

await caso('Sem horários próprios: usa os das unidades, mas grava na agenda da telemedicina', [
  ['agendar', 'Em qual unidade'],
  ['4', ['Datas disponíveis para telemedicina', '31/08', '02/09']],
  ['2', 'Horários de'],
  ['1', ['Consulta marcada', 'por vídeo']],
], {
  telemedicina: TELE,
  unidades: COM_TELE,
  slots: { ...SLOTS_DUAS, 'u-tele': [] },
  pacientes: [ANA],
  verificar: ({ marcadas, titulo }) => {
    const m = marcadas[0]
    if (!m) return falhas.push(`${titulo} | nada foi marcado`)
    if (m.unit_id !== 'u-tele') falhas.push(`${titulo} | gravou em ${m.unit_id}, e não na agenda da telemedicina`)
    else passou++
    if (m.modality !== 'telemedicina') falhas.push(`${titulo} | modalidade ${m.modality}`)
    else passou++
  },
})

await caso('Com horários próprios: só a agenda da telemedicina vale', [
  ['agendar', 'Em qual unidade'],
  ['4', ['Datas disponíveis para telemedicina', '05/09']],
  ['1', 'Horários de'],
  ['1', ['Consulta marcada', 'por vídeo']],
], {
  telemedicina: TELE,
  unidades: COM_TELE,
  slots: { ...SLOTS_DUAS, 'u-tele': [{ slot_start: '2026-09-05T22:00:00Z', slot_end: '2026-09-05T22:40:00Z' }] },
  regras: { 'u-tele': [{ id: 'r1' }] },
  pacientes: [ANA],
  verificar: ({ marcadas, transcricao, titulo }) => {
    if (/31\/08|02\/09/.test(transcricao.join(''))) falhas.push(`${titulo} | ofereceu horário das unidades físicas`)
    else passou++
    if (marcadas[0]?.unit_id !== 'u-tele') falhas.push(`${titulo} | gravou em ${marcadas[0]?.unit_id}`)
    else passou++
  },
})

await caso('Agenda da telemedicina configurada e cheia: não cai nos horários das unidades', [
  ['agendar', 'Em qual unidade'],
  ['4', 'não temos horários abertos em Telemedicina'],
], {
  telemedicina: TELE,
  unidades: COM_TELE,
  slots: { ...SLOTS_DUAS, 'u-tele': [] },
  regras: { 'u-tele': [{ id: 'r1' }] },
  verificar: ({ transcricao, titulo }) => {
    if (/31\/08|02\/09/.test(transcricao.join(''))) falhas.push(`${titulo} | ofereceu horário das unidades físicas`)
    else passou++
  },
})

await caso('Urgência na telemedicina transfere para a equipe', [
  ['agendar', 'Em qual unidade'],
  ['4', 'Datas disponíveis para telemedicina'],
  ['é urgente', ['transferindo você para um atendente', 'urgência']],
  ['meu filho não para de vomitar', null],
], {
  telemedicina: TELE,
  slots: SLOTS_DUAS,
  verificar: ({ conversa, titulo }) => {
    if (conversa.booking_state !== 'atendente') falhas.push(`${titulo} | estado ${conversa.booking_state}`)
    else passou++
  },
})

// Nasceu na telemedicina, mas vale em qualquer etapa: quem escreve "urgente"
// escolhendo o dia em Santos tambem e transferido, com a bandeira.
await caso('Urgência vale em qualquer etapa', [
  ['agendar', 'Em qual unidade'],
  ['1', 'Datas disponíveis em Liferty'],
  ['urgente', 'transferindo você para um atendente'],
], { telemedicina: TELE, slots: SLOTS_DUAS })

await caso('Urgência como primeira mensagem também transfere', [
  ['é urgente, meu filho está passando mal', 'transferindo você para um atendente'],
])

await caso('Informações da telemedicina vêm do texto próprio', [
  ['Oi', 'Como podemos ajudar'],
  ['1', ['Para qual atendimento', 'Telemedicina']],
  ['4', ['Retorno presencial em 30 dias', 'urgência']],
  ['urgente', 'transferindo você para um atendente'],
], { telemedicina: TELE })

// ---------------------------------------------------------------


// ---------------------------------------------------------------
// Questionário disparado pela equipe (botão "Questionário")
// ---------------------------------------------------------------
//
// O caminho normal é o robô perguntar logo depois de marcar. Este é o outro:
// alguém da recepção aperta o botão na tela de Respostas e o robô refaz as
// perguntas na conversa que já existe.

// Pedro tem ficha e nenhuma consulta marcada - o caso que o botão não atendia
// até 16/09/2026, porque exigia consulta FUTURA. As respostas vão para a
// ficha, que é o único destino que existe aqui.
{
  const titulo = 'Questionário sem consulta grava na ficha'
  const { admin, conversa, fichas } = fazerAdmin({
    unidades: TRES_UNIDADES,
    slotsPorUnidade: SLOTS_CHEIOS,
  })
  conversa.menu_sent_at = '2026-08-31T12:00:00Z'

  const inicio = await iniciarQuestionario(admin, 'conv1', null, PEDRO)
  if (!inicio?.resultado?.resposta?.includes('nascimento')) {
    falhas.push(`${titulo} | a primeira pergunta deveria ser o nascimento, veio: ${inicio?.resultado?.resposta?.slice(0, 80)}`)
  } else passou++

  // Sem "Voltar ao menu": a pessoa não estava em fluxo nenhum, e um pedido de
  // quatro dados não deve virar porta de entrada para o menu inteiro.
  if ((inicio?.resultado?.botoes ?? []).some((b) => b.id === 'MENU')) {
    falhas.push(`${titulo} | o questionário manual não deve oferecer "Voltar ao menu"`)
  } else passou++

  // Sem consulta, quem diz de quem são as respostas é o vínculo na conversa.
  if (conversa.booking_patient_id !== PEDRO.id) {
    falhas.push(`${titulo} | deveria amarrar a conversa ao paciente, veio ${conversa.booking_patient_id}`)
  } else passou++

  const responder = async (texto) => {
    const r = await tratarConversa({
      admin,
      clinicId: 'c1',
      conversationId: 'conv1',
      estadoAtual: conversa.booking_state,
      opcoesAtuais: conversa.booking_options,
      unidadeEmAndamento: conversa.booking_unit_id,
      modalidadeEmAndamento: null,
      pacienteEmAndamento: conversa.booking_patient_id ?? null,
      consultas: [],
      consultaASubstituir: null,
      consultaEmCadastro: conversa.booking_intake_id ?? null,
      respostasNaEspera: 0,
      jaViuOMenu: true,
      podeIniciarMenu: true,
      texto,
      telefone: '5511999999999',
      pacientes: [PEDRO],
      nomeDoPerfil: 'Paula Medina',
      textos: TEXTOS,
    })
    return r?.resposta ?? ''
  }

  await responder('12/05/2019')
  await responder('Marina Souza')
  await responder('390.533.447-05')
  const fecho = await responder('marina@exemplo.com')

  const gravado = Object.assign({}, ...fichas.map((f) => ({ ...f })))
  for (const [campo, valor] of [
    ['birth_date', '2019-05-12'],
    ['guardian_name', 'Marina Souza'],
    ['cpf', '39053344705'],
  ]) {
    if (gravado[campo] !== valor) {
      falhas.push(`${titulo} | ${campo} deveria ser "${valor}", veio "${gravado[campo]}"`)
    } else passou++
  }
  // Todas as gravações são na ficha do Pedro, e não na de outra pessoa.
  if (fichas.some((f) => f.id !== PEDRO.id)) {
    falhas.push(`${titulo} | gravou em ficha alheia: ${fichas.map((f) => f.id).join(', ')}`)
  } else passou++

  // Sem consulta, o robô não pode dizer "anotamos na sua consulta": quem lê
  // sairia procurando por uma consulta que não existe.
  if (fecho.includes('na sua consulta')) {
    falhas.push(`${titulo} | o fecho fala de consulta que não existe: ${fecho.slice(0, 120)}`)
  } else passou++
  if (!fecho.includes('no seu cadastro')) {
    falhas.push(`${titulo} | o fecho deveria falar do cadastro, veio: ${fecho.slice(0, 120)}`)
  } else passou++
}

// Com consulta em mãos o questionário manual grava nela - mas não anuncia
// "Consulta marcada!" no fim. Em 16/09/2026 anunciou: pegou a consulta do dia
// 14, dois dias ANTES, e a família leu um comprovante de algo que ninguém
// tinha acabado de marcar.
{
  const titulo = 'Questionário manual não anuncia consulta'
  const { admin, conversa, fichas } = fazerAdmin({
    unidades: TRES_UNIDADES,
    slotsPorUnidade: SLOTS_CHEIOS,
  })
  conversa.menu_sent_at = '2026-08-31T12:00:00Z'

  await iniciarQuestionario(admin, 'conv1', 'consulta-antiga', PEDRO)

  const responder = async (texto) => {
    const r = await tratarConversa({
      admin,
      clinicId: 'c1',
      conversationId: 'conv1',
      estadoAtual: conversa.booking_state,
      opcoesAtuais: conversa.booking_options,
      unidadeEmAndamento: conversa.booking_unit_id,
      modalidadeEmAndamento: null,
      pacienteEmAndamento: conversa.booking_patient_id ?? null,
      consultas: [],
      consultaASubstituir: null,
      consultaEmCadastro: conversa.booking_intake_id ?? null,
      respostasNaEspera: 0,
      jaViuOMenu: true,
      podeIniciarMenu: true,
      texto,
      telefone: '5511999999999',
      pacientes: [PEDRO],
      nomeDoPerfil: 'Paula Medina',
      textos: TEXTOS,
    })
    return r?.resposta ?? ''
  }

  await responder('12/05/2019')
  await responder('Marina Souza')
  await responder('PULAR')
  const fecho = await responder('PULAR')

  if (fecho.includes('Consulta marcada')) {
    falhas.push(`${titulo} | anunciou comprovante: ${fecho.slice(0, 140)}`)
  } else passou++
  if (!fecho.includes('Tudo certo')) {
    falhas.push(`${titulo} | deveria agradecer e encerrar, veio: ${fecho.slice(0, 140)}`)
  } else passou++
  // O que a família respondeu tem de ter chegado à ficha mesmo assim.
  if (!fichas.some((f) => f.birth_date === '2019-05-12')) {
    falhas.push(`${titulo} | o nascimento não chegou à ficha`)
  } else passou++
}

// Cadastro completo não vira mensagem: a Ana tem tudo, e perguntar de novo a
// quem a clínica atende há anos é o robô dizendo que não a conhece.
{
  const titulo = 'Questionário não pergunta a quem já tem tudo'
  const { admin } = fazerAdmin({ unidades: TRES_UNIDADES, slotsPorUnidade: SLOTS_CHEIOS })
  const inicio = await iniciarQuestionario(admin, 'conv1', null, ANA)
  if (inicio !== null) {
    falhas.push(`${titulo} | deveria devolver null, veio ${JSON.stringify(inicio)?.slice(0, 100)}`)
  } else passou++
}


// ---------------------------------------------------------------
// Idade atendida não pode cair no texto de convênio
// ---------------------------------------------------------------
//
// Em 18/09/2026 a Daniela perguntou três vezes se o consultório atende bebê
// de três meses, e nas três recebeu a resposta de convênio, porque 'atende'
// estava na lista de palavras de plano de saúde. Ela só foi respondida por
// gente às 00:03, seis horas depois. Este bloco é aquela conversa.

const RESPOSTAS_IDADE = [
  {
    id: 'r-conv',
    subject: 'Convênios',
    keywords: [
      'convenio', 'plano', 'saude', 'aceita', 'aceitam', 'carteirinha',
      'reembolso', 'particular', 'unimed', 'trasmontano', 'bradesco',
    ],
    answer: 'Atendemos Trasmontano na unidade de Santos. Outros convênios não são atendidos.',
  },
  {
    id: 'r-idade',
    subject: 'Idade atendida',
    keywords: [
      'bebe', 'bebê', 'bebes', 'bebês', 'recem', 'recém', 'nascido',
      'idade', 'meses', 'crianca', 'criança', 'adolescente', 'anos',
    ],
    answer: 'O Dr. Marcello atende desde recém-nascidos até 19 anos.',
  },
]

await caso('Pergunta de bebê recebe a idade, e não convênio', [
  ['Vocês atendem bebês?', 'recém-nascidos até 19 anos'],
], { respostasProntas: RESPOSTAS_IDADE })

await caso('"A partir de qual idade" recebe a idade', [
  ['A partir de qual idade vocês atendem?', 'recém-nascidos até 19 anos'],
], { respostasProntas: RESPOSTAS_IDADE })

await caso('Bebê de três meses: a pergunta inteira da Daniela', [
  ['Qual valor da consulta? E vocês atendem bebês com 3 meses de vida?', 'recém-nascidos até 19 anos'],
], { respostasProntas: RESPOSTAS_IDADE })

// O outro lado da correção: tirar 'atende' da lista de convênio não pode fazer
// o robô deixar de reconhecer quem pergunta de plano.
await caso('Pergunta de convênio continua reconhecida', [
  ['Vocês aceitam convênio?', 'Trasmontano'],
], { respostasProntas: RESPOSTAS_IDADE })

await caso('Marca do plano sozinha é reconhecida', [
  ['atendem trasmontano?', 'Trasmontano'],
], { respostasProntas: RESPOSTAS_IDADE })

await caso('Plano que não é atendido também cai no texto certo', [
  ['vocês aceitam unimed?', 'Outros convênios não são atendidos'],
], { respostasProntas: RESPOSTAS_IDADE })


// ---------------------------------------------------------------
// Convênio no agendamento
// ---------------------------------------------------------------
//
// O Dr. Marcello passou a atender Trasmontano em Santos em 19/09/2026. A
// recepção precisa saber antes da pessoa chegar se fatura pelo plano ou cobra
// particular - antes disso ela descobria na hora, com a família na frente.
//
// A pergunta é da UNIDADE: quem não aceita convênio não pergunta nada, e o
// fluxo continua com o mesmo número de passos de sempre.

const UNIDADE_COM_CONVENIO = [
  { id: 'u-santos', name: 'Liferty · Santos', address: 'Av. Ana Costa, 100', accepts_insurance: 'Trasmontano' },
]

await caso('Unidade com convênio pergunta antes das datas', [
  ['Oi', 'Como podemos ajudar'],
  ['2', ['pelo convênio', 'Trasmontano', 'Particular']],
], { unidades: UNIDADE_COM_CONVENIO, slots: { 'u-santos': SLOTS_CHEIOS['u-santos'] } })

await caso('Escolhendo o convênio, ele é gravado na consulta', [
  ['Oi', 'Como podemos ajudar'],
  ['2', 'pelo convênio'],
  ['1', 'Datas disponíveis'],
  ['1', 'Horários de'],
  ['1', 'está guardado'],
], {
  unidades: UNIDADE_COM_CONVENIO,
  slots: { 'u-santos': SLOTS_CHEIOS['u-santos'] },
  verificar: ({ marcadas, titulo }) => {
    const m = marcadas[0]
    if (!m) return falhas.push(`${titulo} | nenhuma consulta gravada`)
    if (m.insurance !== 'Trasmontano') {
      falhas.push(`${titulo} | deveria gravar Trasmontano, veio "${m.insurance}"`)
    } else passou++
  },
})

await caso('Escolhendo particular, a consulta fica sem convênio', [
  ['Oi', 'Como podemos ajudar'],
  ['2', 'pelo convênio'],
  ['2', 'Datas disponíveis'],
  ['1', 'Horários de'],
  ['1', 'está guardado'],
], {
  unidades: UNIDADE_COM_CONVENIO,
  slots: { 'u-santos': SLOTS_CHEIOS['u-santos'] },
  verificar: ({ marcadas, titulo }) => {
    const m = marcadas[0]
    if (!m) return falhas.push(`${titulo} | nenhuma consulta gravada`)
    if (m.insurance !== '') {
      falhas.push(`${titulo} | particular deveria ficar vazio, veio "${m.insurance}"`)
    } else passou++
  },
})

await caso('Responder o nome do plano por escrito também vale', [
  ['Oi', 'Como podemos ajudar'],
  ['2', 'pelo convênio'],
  ['trasmontano', 'Datas disponíveis'],
], { unidades: UNIDADE_COM_CONVENIO, slots: { 'u-santos': SLOTS_CHEIOS['u-santos'] } })

// ---------------------------------------------------------------
// Cadastro que ficou pela metade (24/09/2026)
// ---------------------------------------------------------------
//
// A mãe marcou, tocou em "Voltar ao menu" no meio do cadastro e depois
// escreveu o nome da criança. Recebia "Não entendi" e a recepção tinha de
// mandar o questionário à mão. Nomes inventados.

const CONSULTA_SEM_FICHA = [
  { id: 'c-ficha', inicio: '2027-09-14T18:00:00Z', unidade: 'Liferty · Santos', endereco: '', paciente: '', confirmada: true },
]
const FICHA_VAZIA = [
  { id: 'c-ficha', starts_at: '2027-09-14T18:00:00Z', patient_id: null, intake_patient_name: null, intake_birth_date: null, intake_guardian: null, intake_cpf: null, intake_email: null },
]
const FICHA_COMPLETA = [
  { ...FICHA_VAZIA[0], intake_patient_name: 'Helena Souza Lima', intake_birth_date: '01/02/2020', intake_guardian: 'Marta Souza' },
]
const NO_MENU = { booking_state: 'menu' }

await caso('Nome escrito depois de sair do cadastro é anotado e o cadastro segue', [
  ['Helena Souza Lima', ['Anotei o nome', 'data de nascimento']],
], { consultas: CONSULTA_SEM_FICHA, fichas: FICHA_VAZIA, estadoInicial: NO_MENU })

await caso('Texto que não é nome oferece completar o cadastro', [
  ['tudo bem', ['ficou pela metade', 'Quer completar agora']],
], { consultas: CONSULTA_SEM_FICHA, fichas: FICHA_VAZIA, estadoInicial: NO_MENU })

await caso('Tocar em Completar cadastro retoma da primeira pergunta', [
  ['FICHA', 'nome completo do paciente'],
], { consultas: CONSULTA_SEM_FICHA, fichas: FICHA_VAZIA, estadoInicial: NO_MENU })

// O caminho real de 24/09: saiu do cadastro, tocou em "Marcar uma consulta",
// caiu em "você já tem uma consulta" e escreveu o nome da criança.
await caso('Já tem consulta com cadastro pela metade: oferece completar', [
  ['2', ['já tem uma consulta', 'Completar cadastro']],
], { consultas: CONSULTA_SEM_FICHA, fichas: FICHA_VAZIA, estadoInicial: NO_MENU })

await caso('Nome escrito em "já tem consulta" é anotado', [
  ['2', 'já tem uma consulta'],
  ['Helena Souza Lima', ['Anotei o nome', 'data de nascimento']],
], { consultas: CONSULTA_SEM_FICHA, fichas: FICHA_VAZIA, estadoInicial: NO_MENU })

// Na fila da equipe, com gente conversando: o toque em "Marcar uma
// consulta" de um menu antigo abre o agendamento (24/09/2026).
await caso('Toque em Marcar uma consulta na fila da equipe abre o agendamento', [
  ['Marcar uma consulta', 'Em qual unidade'],
], { estadoInicial: { booking_state: 'atendente' }, podeIniciarMenu: false })

// Mas texto qualquer, na mesma situação, continua sendo da equipe.
await caso('Texto solto na fila com equipe conversando continua sem robô', [
  ['ok, aguardo', null],
], { estadoInicial: { booking_state: 'atendente' }, podeIniciarMenu: false })

// ---------------------------------------------------------------
// Reserva sem cadastro: o lembrete de 6h abre a ficha (01/10/2026)
// ---------------------------------------------------------------
//
// O lembrete nao e fluxo novo: ele poe a conversa na primeira pergunta que
// falta, e a resposta da familia cai no mesmo caminho de logo depois de marcar.

{
  const titulo = 'Lembrete de ficha pendente abre a ficha na pergunta que falta'
  const { admin, conversa } = fazerAdmin({ unidades: TRES_UNIDADES, slotsPorUnidade: SLOTS_CHEIOS, consultasComFicha: FICHA_VAZIA })
  const { faltam, faltaObrigatoria } = faltamNaFicha(FICHA_VAZIA[0])
  if (!faltaObrigatoria || faltam[0] !== 'nome') {
    falhas.push(`${titulo} | ficha vazia deveria cobrar o nome primeiro, veio: ${faltam.join(',')}`)
  } else passou++

  const r = await abrirFichaPeloLembrete(admin, 'conv1', 'c-ficha', faltam, '📋 Sua reserva está quase confirmada.')
  if (!r?.resposta?.includes('quase confirmada') || !r.resposta.includes('nome completo do paciente')) {
    falhas.push(`${titulo} | lembrete deveria trazer o aviso e a pergunta do nome, veio: ${r?.resposta?.slice(0, 120)}`)
  } else passou++
  if (conversa.booking_state !== 'dados_nome' || conversa.booking_intake_id !== 'c-ficha') {
    falhas.push(`${titulo} | conversa deveria ficar na pergunta do nome da reserva c-ficha, ficou: ${conversa.booking_state} / ${conversa.booking_intake_id}`)
  } else passou++
}

// A resposta da mae ao lembrete segue a ficha normalmente.
await caso('Resposta ao lembrete de ficha segue para a próxima pergunta', [
  ['Helena Souza Lima', 'data de nascimento'],
], {
  consultas: CONSULTA_SEM_FICHA,
  fichas: FICHA_VAZIA,
  estadoInicial: {
    booking_state: 'dados_nome',
    booking_intake_id: 'c-ficha',
    booking_options: { tentativas: 0, faltam: ['nome', 'nascimento', 'responsavel', 'cpf', 'email'], manual: false },
  },
})

// Consulta ja ligada a um paciente, ou com o obrigatorio preenchido, nao tem
// o que cobrar - o lembrete nao sai.
{
  const titulo = 'Ficha completa ou paciente ligado: nada a cobrar'
  const comPaciente = faltamNaFicha({ ...FICHA_VAZIA[0], patient_id: 'p1' })
  const completa = faltamNaFicha(FICHA_COMPLETA[0])
  if (comPaciente.faltaObrigatoria || completa.faltaObrigatoria) {
    falhas.push(`${titulo} | nao deveria cobrar: paciente=${comPaciente.faltaObrigatoria} completa=${completa.faltaObrigatoria}`)
  } else passou++
}

// 24/09/2026: a atendente disse "basta escolher a opção 2"; a mãe escreveu
// "Pode agendar" e "2" e o robô ficou mudo por 35 minutos. Agora ela recebe o
// botão, mesmo com a equipe na conversa.
await caso('"Pode agendar" na fila recebe o botão de marcar', [
  ['Pode agendar', 'Marcar uma consulta'],
  ['2', 'Marcar uma consulta'],
  ['Marcar uma consulta', 'Em qual unidade'],
], { estadoInicial: { booking_state: 'atendente' }, podeIniciarMenu: false })

// Real 05/10/2026 (Leandro): o toque no botão manda o ID do botão, e não o
// título. Com id "2", o toque virava "quero marcar" de novo e o robô oferecia o
// mesmo botão - três vezes. O teste acima só mandava o título, que é o caso do
// botão de mensagem antiga, e por isso não viu o laço.
{
  let idDoBotao = null
  await caso('Real 05/10: na fila, o botão de marcar tem id próprio', [
    ['Gostaria de agendar', 'Marcar uma consulta'],
  ], {
    estadoInicial: { booking_state: 'atendente' },
    podeIniciarMenu: false,
    verificar: ({ ultimoToque }) => { idDoBotao = ultimoToque.botoes?.[0]?.id ?? null },
  })
  await caso('Real 05/10: tocar no botão abre a agenda (não repete o convite)', [
    [idDoBotao ?? '(sem botão)', 'Em qual unidade'],
  ], { estadoInicial: { booking_state: 'atendente', auto_replies_while_waiting: 1 }, podeIniciarMenu: false })
}

await caso('Real 05/10: "Voltar ao início" de uma mensagem antiga mostra o menu', [
  ['Voltar ao início', 'Como podemos ajudar'],
], { estadoInicial: { booking_state: 'atendente' }, podeIniciarMenu: false })

// Retorno para daqui a meses (real 03/10/2026, Igor). Depois do "Estou bem",
// o pai pediu o retorno de 3 meses; o robo abriu uma agenda de 15 dias e ele
// saiu sem marcar e sem ninguem saber.
await caso('Real 03/10: retorno em 3 meses vai para a equipe, não para a agenda de 15 dias', [
  ['Dr. pediu para agendar retorno em 3 meses. Gostaria de deixar agendado.', ['Anotei seu pedido de retorno', '15 dias']],
], {
  posAcompanhamento: true,
  verificar: ({ ultimoToque, conversa, titulo }) => {
    if (ultimoToque.atencao !== 'atendente') falhas.push(`${titulo} | atenção ${ultimoToque.atencao}`)
    else passou++
    if (conversa.booking_state !== 'atendente') falhas.push(`${titulo} | etapa ${conversa.booking_state}`)
    else passou++
  },
})

await caso('Retorno "daqui a dois meses" com o menu na tela também vai para a equipe', [
  ['quero marcar o retorno daqui a dois meses', 'Anotei seu pedido de retorno'],
], { estadoInicial: NO_MENU })

await caso('Na fila: retorno em 6 meses responde sem oferecer a agenda', [
  ['Preciso agendar o retorno dele em 6 meses', 'Anotei seu pedido de retorno'],
], { estadoInicial: { booking_state: 'atendente' }, podeIniciarMenu: false })

await caso('Idade do filho não é prazo de retorno: "tem 6 meses" abre a agenda', [
  ['Meu filho tem 6 meses, quero marcar uma consulta', 'Em qual unidade'],
], { estadoInicial: NO_MENU })

await caso('Retorno em 10 dias cabe na agenda e abre a agenda normal', [
  ['quero marcar o retorno em 10 dias', 'Em qual unidade'],
], { estadoInicial: NO_MENU })

{
  const titulo = 'retornoAlemDaAgenda: mês certo e limites'
  const hoje = new Date('2026-10-05T12:00:00-03:00')
  const tres = retornoAlemDaAgenda('retorno em 3 meses', 15, hoje)
  if (tres?.mes !== 'janeiro') falhas.push(`${titulo} | 3 meses deveria cair em janeiro, veio ${tres?.mes}`)
  else passou++
  if (retornoAlemDaAgenda('retorno em 2 semanas', 15, hoje) !== null) falhas.push(`${titulo} | 2 semanas cabe em 15 dias`)
  else passou++
  if (retornoAlemDaAgenda('retorno em 3 semanas', 15, hoje) === null) falhas.push(`${titulo} | 3 semanas passa de 15 dias`)
  else passou++
  if (retornoAlemDaAgenda('ela nasceu há 3 meses', 15, hoje) !== null) falhas.push(`${titulo} | idade não é prazo`)
  else passou++
}

// Número errado (real 06/10/2026, Rogerio). O telefone da ficha é de outra
// pessoa; ela respondeu "Nao sou o Rogerio" a dois lembretes e o robô ficou
// calado nas duas.
await caso('Real 06/10: "Nao sou o Rogerio" pede desculpas e marca número errado', [
  ['Nao sou o Rogerio', 'desculpe o engano'],
], {
  podeIniciarMenu: false,
  verificar: ({ ultimoToque, titulo }) => {
    if (ultimoToque.atencao !== 'numero_errado') falhas.push(`${titulo} | atenção ${ultimoToque.atencao}`)
    else passou++
  },
})

await caso('"Número errado" também', [['Acho que é número errado', 'desculpe o engano']], { podeIniciarMenu: false })

await caso('"Não sou a mãe, sou a avó" é da família, não engano', [
  ['Não sou a mãe dele, sou a avó, queria marcar uma consulta', 'Em qual unidade'],
], {
  podeIniciarMenu: false,
  verificar: ({ transcricao, titulo }) => {
    if (transcricao.join('').includes('engano')) falhas.push(`${titulo} | tratou a avó como número errado`)
    else passou++
  },
})

// Real 06/10/2026 (Patricia): tocou "É urgência" por engano e corrigiu.
await caso('Real 06/10: "Não é urgência" não volta a gritar urgência', [
  ['Nao é urgência. Gostaria de informações a respeito do valor da consulta', null],
], {
  estadoInicial: { booking_state: 'atendente' },
  podeIniciarMenu: false,
  verificar: ({ ultimoToque, titulo }) => {
    if (/urgente|urgência/i.test(ultimoToque.resposta ?? '')) falhas.push(`${titulo} | tratou como urgência`)
    else passou++
  },
})

await caso('Mas "é urgente" continua sendo urgência', [
  ['é urgente, ele está passando mal', 'de que é urgente'],
], { estadoInicial: { booking_state: 'atendente' }, podeIniciarMenu: false })

// Real 06/10/2026 (Patricia): nas datas, tocou o nome de outra unidade numa
// lista de cima e recebeu "Não entendi".
await caso('Real 06/10: tocar outra unidade numa lista antiga troca a unidade', [
  ['agendar', 'Em qual unidade'],
  ['1', 'Datas disponíveis em Liferty'],
  ['Telemedicina (por vídeo)', 'Datas disponíveis para telemedicina'],
], { telemedicina: TELE, slots: SLOTS_DUAS })

// Real 06/10/2026 (Patricia): pergunta longa na fila não é pedido de marcar.
await caso('Real 06/10: pergunta longa na fila não recebe o botão de marcar', [
  ['Tenho gêmeas idênticas de 3 anos e meio. Poderia agendar a consulta pro valor de 450 para as duas?', null],
], { estadoInicial: { booking_state: 'atendente' }, podeIniciarMenu: false })

// Real 06/10/2026 (Samuel): 3 dias depois do acompanhamento, sintoma vira recado.
await caso('Real 06/10: sintoma depois do acompanhamento vai para a equipe', [
  ['Samuel ele faz cocô todos dias, porém tem dia que faz as bolinhas mais duras, depois faz 4 vez no dia', 'Obrigado por nos contar'],
], { posAcompanhamento: true })

await caso('Pergunta comum depois do acompanhamento segue o caminho de sempre', [
  ['Qual o valor da consulta?', 'consultório'],
], {
  posAcompanhamento: true,
  verificar: ({ transcricao, titulo }) => {
    if (transcricao.join('').includes('Obrigado por nos contar')) falhas.push(`${titulo} | virou recado`)
    else passou++
  },
})

// Real 07/10/2026 (Andre): pergunta clínica na opção de informações. Antes:
// "Sobre sintomas, remédios... não posso orientar" + "responda com o número da
// unidade". Agora explica que é avaliação de consulta e volta ao menu, de onde
// ele marca (2) ou fala com a equipe (3).
await caso('Real 07/10: dúvida escrita depois de tocar "Dúvidas" vai para a equipe', [
  ['Oi', 'Como podemos ajudar'],
  ['1', 'Para qual atendimento'],
  ['Dr. Marcello costuma solicitar exames para investigar dor abdominal crônica?', ['avaliação para a consulta', 'Passei sua pergunta para a nossa equipe']],
], {
  telemedicina: TELE,
  verificar: ({ transcricao, ultimoToque, conversa, titulo }) => {
    if (transcricao.join('').includes('número da unidade da lista acima')) falhas.push(`${titulo} | ainda pediu o número da unidade`)
    else passou++
    if (ultimoToque.atencao !== 'atendente' || conversa.booking_state !== 'atendente') falhas.push(`${titulo} | não foi para a equipe`)
    else passou++
  },
})

await caso('Dúvida não clínica nas informações também vai para a equipe', [
  ['Oi', 'Como podemos ajudar'],
  ['1', 'Para qual atendimento'],
  ['Vocês emitem nota fiscal no nome da empresa?', 'Passei sua pergunta para a nossa equipe'],
], { telemedicina: TELE })

// Ate 09/10/2026 "santos?" pedia o numero. Passou a escolher a unidade: o nome
// do lugar e a resposta a "para qual atendimento?" (Bianca, ver unidadePeloNome).
await caso('O nome da cidade nas informações escolhe a unidade', [
  ['Oi', 'Como podemos ajudar'],
  ['1', 'Para qual atendimento'],
  ['santos?', 'outra unidade'],
], { telemedicina: TELE })

await caso('Palavra solta que não é unidade continua pedindo o número', [
  ['Oi', 'Como podemos ajudar'],
  ['1', 'Para qual atendimento'],
  ['ok?', 'número da unidade'],
], { telemedicina: TELE })

// "Marca consulta pra minha filha, e valor da consulta" (24/09/2026): recebia
// so o valor, porque "marca" nao era "marcar".
await caso('"Marca consulta" conta como pedido de agendamento', [
  ['Marca consulta pra minha filha de dois anos', 'Em qual unidade'],
], { estadoInicial: NO_MENU })

await caso('"marca de fórmula" não é agendamento, e "nasceu em março" também não', [
  ['nasceu em março do ano passado e toma leite', 'passei sua mensagem'],
], { estadoInicial: NO_MENU })

// "Aguardo retorno" casava com "retorno" e recebia os documentos para levar.
await caso('"Aguardo retorno" na fila não recebe resposta pronta', [
  ['Oi', 'Como podemos ajudar'],
  ['3', 'direcionando você'],
  ['Aguardo retorno', null],
], { respostasProntas: [...RESPOSTAS, {
  id: 'r4',
  subject: 'O que levar',
  keywords: ['levar', 'documento', 'retorno', 'exames'],
  answer: 'Leve um documento com foto do responsável.',
}] })

// Frase que o robô não entende vai para a equipe; agradecimento não.
await caso('"Dr está ciente." no menu vai para a equipe', [
  ['Dr está ciente do caso', ['passei sua mensagem', 'direcionando você']],
], {
  estadoInicial: NO_MENU,
  verificar: ({ conversa, titulo }) => {
    if (conversa.booking_state === 'atendente') passou++
    else falhas.push(`${titulo}: não entrou na fila (${conversa.booking_state})`)
  },
})
await caso('"Ok, obrigada!" no menu não é "Não entendi" nem fila', [
  ['Ok, obrigada!', 'Por nada'],
], {
  estadoInicial: NO_MENU,
  verificar: ({ conversa, titulo }) => {
    if (conversa.booking_state !== 'atendente') passou++
    else falhas.push(`${titulo}: agradecimento foi para a fila`)
  },
})
// A outra instalacao achou (25/09/2026): "Bom dia" com o menu na tela
// recebia "Por nada!", porque bom e dia estavam na lista de cortesia.
await caso('"Bom dia" com o menu na tela recebe o menu, não "Por nada"', [
  ['Bom dia', 'Como podemos ajudar'],
  ['Oi, tudo bem?', 'Como podemos ajudar'],
], {
  estadoInicial: NO_MENU,
  verificar: ({ transcricao, titulo }) => {
    if (transcricao.some((t) => t.includes('Por nada') || t.includes('Não entendi'))) falhas.push(`${titulo}: cumprimento tratado como agradecimento ou erro`)
    else passou++
  },
})
await caso('"Bom dia, obrigada!" continua sendo agradecimento', [
  ['Bom dia, obrigada!', 'Por nada'],
], { estadoInicial: NO_MENU })

await caso('Palavra solta no menu continua recebendo o menu', [
  ['blablabla', 'Não entendi'],
], { estadoInicial: NO_MENU })

// "Consigo para amanhã com o dr" recebia "Não entendi" (24/09/2026).
await caso('Pedido de vaga sem o verbo marcar abre o agendamento', [
  ['Consigo para amanhã com o dr Marcello', 'Em qual unidade'],
], { estadoInicial: NO_MENU })

await caso('"Tem vaga?" abre o agendamento', [
  ['Tem vaga essa semana?', 'Em qual unidade'],
], { estadoInicial: NO_MENU })

// Com o cadastro completo o nome nao e ficha - e, desde 25/09/2026, frase de
// tres palavras que o robo nao entende vai para a equipe.
// 25/09/2026: foto mandada no meio do cadastro não derruba a etapa. A regra
// geral mandava para a fila e zerava o agendamento que estava pela metade.
await caso('Anexo no meio do cadastro avisa a equipe e mantém a pergunta', [
  ['Oi', 'Aqui é o consultório'],
  ['2', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['1', 'Horários de'],
  ['1', ['está guardado', 'nome completo do paciente']],
  ['[ANEXO]', ['avisei a nossa equipe', 'pergunta acima']],
  ['Helena Souza Lima', 'data de nascimento'],
], {
  verificar: ({ conversa, titulo }) => {
    if (conversa.booking_state !== 'atendente') passou++
    else falhas.push(`${titulo}: o anexo mandou a conversa para a fila`)
  },
})

// 24/09/2026: duas famílias tocaram em "Voltar ao menu" logo na pergunta do
// nome, com o horário já guardado, e a consulta ficou no nome da mãe.
await caso('Ficha depois do agendamento não oferece "Voltar ao menu"', [
  ['Oi', 'Aqui é o consultório'],
  ['2', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['1', 'Horários de'],
  ['1', ['está guardado', 'nome completo do paciente']],
], {
  verificar: ({ ultimoToque, titulo }) => {
    const botoes = (ultimoToque.botoes ?? []).map((b) => b.titulo)
    if (botoes.includes('Voltar ao menu')) falhas.push(`${titulo}: ainda oferece "Voltar ao menu"`)
    else passou++
  },
})

await caso('Com o cadastro completo, nome solto não vira ficha', [
  ['Helena Souza Lima', 'passei sua mensagem'],
], { consultas: CONSULTA_SEM_FICHA, fichas: FICHA_COMPLETA, estadoInicial: NO_MENU })

// 23/09/2026: o convênio foi encerrado com uma família parada na pergunta.
// A unidade agora está sem plano; a próxima mensagem dela não pode receber
// "Responda 1 para  ou 2 para particular" com o nome em branco.
await caso('Convênio encerrado no meio da pergunta segue como particular', [
  ['quero marcar', 'Datas disponíveis'],
], {
  unidades: UMA_UNIDADE,
  estadoInicial: { booking_state: 'aguardando_convenio', booking_unit_id: UMA_UNIDADE[0].id },
})

// A unidade sem convênio não ganha passo nenhum: vai direto para as datas.
await caso('Unidade sem convênio vai direto para as datas', [
  ['Oi', 'Como podemos ajudar'],
  ['2', 'Datas disponíveis'],
], { unidades: UMA_UNIDADE })


// ---------------------------------------------------------------
// Coluna nova que o banco ainda não tem
// ---------------------------------------------------------------
//
// Em 19/09/2026 o robô foi ao ar gravando booking_insurance antes de a coluna
// existir. O Postgres não ignora coluna desconhecida: recusa o UPDATE inteiro.
// O estado da conversa parou de ser gravado e o robô nunca saía do menu - o
// paciente digitava 1, recebia o menu, digitava 1 de novo, recebia o menu.
// Três voltas, sem erro visível em lugar nenhum.
//
// Perder o campo novo é um arranhão. Perder o estado trava o atendimento.

await caso('Sem a coluna nova, o menu continua funcionando', [
  ['Oi', 'Como podemos ajudar'],
  ['1', 'Para qual atendimento'],
], { colunasAusentes: ['booking_insurance'] })

await caso('Sem a coluna nova, dá para marcar consulta até o fim', [
  ['Oi', 'Como podemos ajudar'],
  ['2', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['1', 'Horários de'],
  ['1', 'está guardado'],
], { colunasAusentes: ['booking_insurance'] })

// E com a unidade que pede convênio: a pergunta acontece, a resposta não pode
// ser gravada, e mesmo assim o agendamento chega ao fim.
await caso('Sem a coluna nova, o convênio some mas o agendamento segue', [
  ['Oi', 'Como podemos ajudar'],
  ['2', 'pelo convênio'],
  ['1', 'Datas disponíveis'],
  ['1', 'Horários de'],
  ['1', 'está guardado'],
], {
  unidades: UNIDADE_COM_CONVENIO,
  slots: { 'u-santos': SLOTS_CHEIOS['u-santos'] },
  colunasAusentes: ['booking_insurance'],
})


// A unidade sem a coluna nova: o atendimento não pode parar por causa disso.
//
// Foi assim que o robô caiu em 19/09/2026. A consulta pedia accepts_insurance
// antes de a migration rodar, o Postgres recusou tudo, a lista de unidades
// voltou vazia, e a opção 1 não tinha o que mostrar: devolvia o menu. O
// paciente digitava 1, recebia o menu, digitava 1 de novo, recebia o menu.

await caso('Coluna de convênio ausente não derruba a opção 1', [
  ['Oi', 'Como podemos ajudar'],
  ['1', 'Para qual atendimento'],
], { colunasAusentes: ['accepts_insurance'] })

await caso('Coluna de convênio ausente não derruba o agendamento', [
  ['Oi', 'Como podemos ajudar'],
  ['2', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['1', 'Horários de'],
  ['1', 'está guardado'],
], { colunasAusentes: ['accepts_insurance'] })

// ---------------------------------------------------------------
// 2ª via de receita e pedido de exame (opção 5)
// ---------------------------------------------------------------

await caso('Primeiro contato mostra também a opção 5', [
  ['Oi', ['*5* 📄 2ª via de receita ou pedido de exame']],
])

await caso('Paciente único pula a escolha e vai direto ao tipo', [
  ['Oi', 'Como podemos ajudar'],
  ['5', ['O que você precisa para *Ana Paula Souza*', '2ª via de receita', 'Pedido de exame']],
], { pacientes: [ANA] })

const pedidoDeReceita = await caso('2ª via de receita, com correção pedida pela farmácia', [
  ['Oi', 'Como podemos ajudar'],
  ['5', 'O que você precisa'],
  ['1', 'Qual medicamento'],
  ['Domperidona', 'A farmácia pediu alguma correção'],
  ['A validade venceu', [
    'Pedido registrado',
    '💊 2ª via de receita · Ana Paula Souza',
    'Domperidona',
    'A validade venceu',
    '1 dia útil',
  ]],
], {
  pacientes: [ANA],
  verificar: ({ conversa, titulo }) => {
    // Sem a bandeira o pedido não aparece na lista da clínica: fica um recado
    // no meio da conversa, que é exatamente o problema que isto resolve.
    if (conversa.booking_state !== 'atendente') {
      falhas.push(`${titulo} | deveria terminar esperando a equipe, veio ${conversa.booking_state}`)
    } else passou++
  },
})

achados.push('2ª via de receita, do menu ao comprovante:\n' + pedidoDeReceita.transcricao.join('\n'))

// Quem devolveu o documento muda com o tipo. "A farmácia pediu correção no seu
// ultrassom?" faz a mãe parar para entender uma pergunta que não era para ela.
await caso('Pedido de exame diz "exame", e não "medicamento"', [
  ['Oi', 'Como podemos ajudar'],
  ['5', 'O que você precisa'],
  ['2', 'Qual exame'],
  ['Ultrassom de abdome', 'O laboratório ou a clínica de exames pediu alguma correção'],
  ['não', ['Pedido registrado', '🔬 Pedido de exame', 'Ultrassom de abdome']],
], { pacientes: [ANA] })

// "Não" é resposta completa, não recusa: nada foi exigido e o pedido segue.
// Escrever "Pediram correção: não" no comprovante faria a clínica procurar uma
// exigência que não existe.
await caso('Sem exigência, o comprovante não inventa uma', [
  ['Oi', 'Como podemos ajudar'],
  ['5', 'O que você precisa'],
  ['1', 'Qual medicamento'],
  ['Domperidona', 'pediu alguma correção'],
  ['não', 'Pedido registrado'],
], {
  pacientes: [ANA],
  verificar: ({ transcricao, titulo }) => {
    const comprovante = transcricao[transcricao.length - 1]
    if (comprovante.includes('Pediram correção')) {
      falhas.push(`${titulo} | comprovante inventou uma exigência que ninguém fez`)
    } else passou++
  },
})

await caso('Com dois filhos, pergunta de quem é o pedido', [
  ['Oi', 'Como podemos ajudar'],
  ['5', ['Para qual paciente', 'Ana Paula Souza', 'Pedro Souza']],
  ['2', 'O que você precisa para *Pedro Souza*'],
  ['1', 'Qual medicamento'],
  ['Omeprazol', 'pediu alguma correção'],
  ['não', ['Pedido registrado', '💊 2ª via de receita · Pedro Souza', 'Omeprazol']],
], { pacientes: [ANA, PEDRO] })

// A foto sozinha basta. Quem está no balcão da farmácia fotografa o que foi
// recusado em vez de repetir de cabeça o que o atendente disse - e essa é a
// informação mais confiável das duas.
await caso('Foto do documento recusado conta como resposta', [
  ['Oi', 'Como podemos ajudar'],
  ['5', 'O que você precisa'],
  ['1', 'Qual medicamento'],
  ['Domperidona', 'pediu alguma correção'],
  ['[ANEXO]', ['Pedido registrado', 'enviou foto do documento']],
], { pacientes: [ANA] })

// A trava do anexo entrega qualquer foto à equipe e encerra o fluxo. Aqui ela
// não pode valer, ou o pedido morre no penúltimo passo.
await caso('Foto no meio do pedido não cai na entrega genérica de anexo', [
  ['Oi', 'Como podemos ajudar'],
  ['5', 'O que você precisa'],
  ['1', 'Qual medicamento'],
  ['Domperidona', 'pediu alguma correção'],
  ['[ANEXO]', 'Pedido registrado'],
], {
  pacientes: [ANA],
  verificar: ({ transcricao, titulo }) => {
    const ultima = transcricao[transcricao.length - 1]
    if (ultima.includes('já avisei a nossa equipe')) {
      falhas.push(`${titulo} | a foto virou anexo genérico e o pedido se perdeu`)
    } else passou++
  },
})

// ---- Controlado ----

// A promessa de "1 dia útil" não pode existir aqui: a receita de controlado sai
// em receituário especial, a farmácia retém a via original, e mandar um PDF
// faria a família ir ao balcão para ouvir não.
await caso('Controlado não recebe promessa de 2ª via por aqui', [
  ['Oi', 'Como podemos ajudar'],
  ['5', 'O que você precisa'],
  ['1', 'Qual medicamento'],
  ['Rivotril', ['receituário especial', 'via original', 'avisei a equipe']],
], {
  pacientes: [ANA],
  verificar: ({ transcricao, titulo, conversa }) => {
    const ultima = transcricao[transcricao.length - 1]
    if (ultima.includes('1 dia útil')) {
      falhas.push(`${titulo} | prometeu prazo de 2ª via para receita que não sai por aqui`)
    } else passou++
    if (conversa.booking_state !== 'atendente') {
      falhas.push(`${titulo} | deveria ir para a equipe, veio ${conversa.booking_state}`)
    } else passou++
  },
})

await caso('Quem diz "é controlado" também sai do automático', [
  ['Oi', 'Como podemos ajudar'],
  ['5', 'O que você precisa'],
  ['1', 'Qual medicamento'],
  ['é o remédio controlado dele', 'receituário especial'],
], { pacientes: [ANA] })

// O caminho normal não pode ser arrastado junto: domperidona, omeprazol e
// afins continuam resolvendo sozinhos.
await caso('Remédio comum não é tratado como controlado', [
  ['Oi', 'Como podemos ajudar'],
  ['5', 'O que você precisa'],
  ['1', 'Qual medicamento'],
  ['Omeprazol', 'pediu alguma correção'],
], { pacientes: [ANA] })

// Exame não passa pela peneira de controlado: "azul" pode ser o nome de um
// laboratório, e "especial" aparece em nome de exame.
await caso('Pedido de exame não é barrado pela lista de controlados', [
  ['Oi', 'Como podemos ajudar'],
  ['5', 'O que você precisa'],
  ['2', 'Qual exame'],
  ['Exame no laboratório Azul', 'pediu alguma correção'],
], { pacientes: [ANA] })

// ---- O pedido não pode evaporar no meio ----

// Mandar a foto da receita quando o robô pede o nome do medicamento é a coisa
// mais natural do mundo - e era o que apagava o pedido: o anexo caía na regra
// geral, que zera booking_options, e a etapa seguinte respondia no vazio.
await caso('Foto antes do nome do medicamento não apaga o pedido', [
  ['Oi', 'Como podemos ajudar'],
  ['5', 'O que você precisa'],
  ['1', 'Qual medicamento'],
  ['[ANEXO]', 'nome'],
  ['Domperidona', 'pediu alguma correção'],
  ['não', ['Pedido registrado', 'Domperidona']],
], { pacientes: [ANA] })

// "é urgente, ela precisa do omeprazol" não é ida ao pronto-socorro: é uma mãe
// com pressa de receita. Mandá-la ao 192 e jogar fora o pedido é errado duas
// vezes.
await caso('Pressa pela receita não vira transferência de urgência', [
  ['Oi', 'Como podemos ajudar'],
  ['5', 'O que você precisa'],
  ['1', 'Qual medicamento'],
  ['é urgente, ela precisa do omeprazol', 'pediu alguma correção'],
], {
  pacientes: [ANA],
  verificar: ({ transcricao, titulo }) => {
    if (transcricao.join('\n').includes('192')) {
      falhas.push(`${titulo} | mandou ao pronto-socorro quem só queria a receita de volta`)
    } else passou++
  },
})

// Urgência de verdade continua valendo: sintoma junto do pedido tem que sair
// do fluxo e chamar gente.
await caso('Urgência com sintoma ainda transfere, mesmo dentro do pedido', [
  ['Oi', 'Como podemos ajudar'],
  ['5', 'O que você precisa'],
  ['1', 'Qual medicamento'],
  ['é urgente, ela está vomitando sangue', 'urgência'],
], { pacientes: [ANA] })

// "cancelar" no meio do pedido é a pessoa querendo sair - e aí o pedido some
// mesmo. O que não pode é sumir em silêncio, sem ela ter pedido.
await caso('Escrever "cancelar" no meio do pedido sai do fluxo, e avisa', [
  ['Oi', 'Como podemos ajudar'],
  ['5', 'O que você precisa'],
  ['1', 'Qual medicamento'],
  ['cancelar', 'parei por aqui'],
], { pacientes: [ANA] })

// ---- Quando a resposta não é um número ----

// As duas etapas reemitiam a MESMA mensagem, sem dizer que não entenderam. No
// celular isso lê como travamento: a pessoa responde o rótulo do botão que
// acabou de ler, e recebe a pergunta de novo, idêntica.
await caso('Responder o nome do botão em vez do número não trava', [
  ['Oi', 'Como podemos ajudar'],
  ['5', 'O que você precisa'],
  ['2ª via de receita', 'Qual medicamento'],
], { pacientes: [ANA] })

await caso('Responder o nome do filho em vez do número não trava', [
  ['Oi', 'Como podemos ajudar'],
  ['5', 'Para qual paciente'],
  ['Pedro', 'O que você precisa para *Pedro Souza*'],
], { pacientes: [ANA, PEDRO] })

await caso('Resposta que não casa com nada diz que não entendeu', [
  ['Oi', 'Como podemos ajudar'],
  ['5', 'O que você precisa'],
  ['azul', 'Não entendi'],
], { pacientes: [ANA] })

// ---- A portaria ----

await caso('Número sem atendimento não entra no fluxo do paciente', [
  ['Oi', 'Como podemos ajudar'],
  ['5', ['não localizei atendimento neste número', 'Sou o paciente ou responsável', 'Sou de farmácia ou laboratório']],
])

await caso('Quem diz ser o responsável vai para a equipe', [
  ['Oi', 'Como podemos ajudar'],
  ['5', 'não localizei atendimento'],
  ['1', 'direcionando você para alguém da nossa equipe'],
])

await caso('Farmácia registra o pedido sem receber dado de paciente', [
  ['Oi', 'Como podemos ajudar'],
  ['5', 'não localizei atendimento'],
  ['2', ['nome do paciente', 'precisa ser corrigido']],
  ['Henrique Souza, o CID não confere', ['Registrado', 'enviado ao paciente, não por este canal']],
])

// O robô não pode confirmar que alguém se trata na clínica para um número que
// nunca consultou aqui. Isso é dado de saúde, e quem escreveu não provou ser
// ninguém: confirmar a pedido seria entregar prontuário a quem souber um nome.
await caso('Farmácia não recebe confirmação de que o paciente existe', [
  ['Oi', 'Como podemos ajudar'],
  ['5', 'não localizei atendimento'],
  ['2', 'nome do paciente'],
  ['A Ana Paula Souza se trata aí?', 'Registrado'],
], {
  verificar: ({ transcricao, titulo }) => {
    const conversaInteira = transcricao.join('\n')
    if (/Ana Paula Souza/.test(conversaInteira.split('> A Ana Paula')[1] ?? '')) {
      falhas.push(`${titulo} | o robô repetiu o nome do paciente para um número desconhecido`)
    } else passou++
  },
})

// ---------------------------------------------------------------
// Defeitos encontrados na varredura de 20/09/2026
// ---------------------------------------------------------------

// Escolher telemedicina, voltar ao menu e escolher uma unidade FÍSICA deixava
// booking_modality valendo 'telemedicina'. Como a unidade em andamento é
// derivada da modalidade, tudo dali para frente virava vídeo: a família saía
// achando que marcou presencial em Santos e o Dr. Marcello esperava na tela.
//
// Só aparecia em unidade com convênio, que na produção é justamente Santos.
await caso('Voltar da telemedicina para uma unidade física não marca vídeo', [
  ['Oi', 'Como podemos ajudar'],
  ['2', 'Em qual unidade'],
  ['2', 'Datas disponíveis'],
  ['0', 'Como podemos ajudar'],
  ['2', 'Em qual unidade'],
  ['1', 'pelo convênio'],
  ['2', 'Datas disponíveis'],
  ['1', 'Horários de'],
  ['1', 'está guardado'],
], {
  unidades: UNIDADE_COM_CONVENIO,
  slots: { 'u-santos': SLOTS_CHEIOS['u-santos'] },
  telemedicina: { ativa: true, texto: 'Telemedicina R$ 450' },
  verificar: ({ marcadas, titulo }) => {
    const c = marcadas.at(-1)
    if (!c) {
      falhas.push(`${titulo} | não marcou consulta nenhuma`)
      return
    }
    if (c.modality === 'telemedicina') {
      falhas.push(`${titulo} | marcou TELEMEDICINA para quem escolheu unidade física`)
    } else passou++
    if (!c.unit_id) {
      falhas.push(`${titulo} | consulta presencial gravada sem unidade`)
    } else passou++
  },
})

// Com duas consultas marcadas, CANCELAR e REMARCAR não funcionavam depois de
// escolher qual: o atalho olhava para quantas consultas a pessoa TEM, e não
// para qual delas está em foco. O robô respondia "digite CANCELAR" a quem
// tinha acabado de digitar CANCELAR, e os botões caíam no mesmo lugar - laço
// fechado, justamente para a mãe com dois filhos em acompanhamento.
const DUAS_CONSULTAS = [
  {
    id: 'c-1',
    inicio: '2026-09-28T11:00:00Z',
    unidade: 'Liferty · Santos',
    endereco: 'Av. Ana Costa, 100',
    paciente: 'Ana Paula Souza',
    confirmada: true,
  },
  {
    id: 'c-2',
    inicio: '2026-09-29T12:00:00Z',
    unidade: 'Liferty · Santos',
    endereco: 'Av. Ana Costa, 100',
    paciente: 'Pedro Souza',
    confirmada: true,
  },
]

await caso('Com duas consultas, CANCELAR funciona depois de escolher qual', [
  ['Oi', 'Como podemos ajudar'],
  ['4', 'consultas marcadas'],
  ['2', 'Digite CANCELAR'],
  ['cancelar', 'Confirma o cancelamento'],
  ['sim', 'cancelada'],
], {
  pacientes: [ANA, PEDRO],
  consultas: DUAS_CONSULTAS,
  verificar: ({ canceladas, titulo }) => {
    if (!canceladas.includes('c-2')) {
      falhas.push(`${titulo} | não cancelou a consulta escolhida (canceladas: ${canceladas})`)
    } else passou++
  },
})

await caso('Com duas consultas, REMARCAR também funciona', [
  ['Oi', 'Como podemos ajudar'],
  ['4', 'consultas marcadas'],
  ['1', 'Digite CANCELAR'],
  ['remarcar', 'Vamos remarcar'],
], { pacientes: [ANA, PEDRO], consultas: DUAS_CONSULTAS })

// "sim, pode cancelar por favor" é sim. A comparação exata devolvia "sua
// consulta continua marcada" para quem tinha acabado de confirmar - e no
// caminho da remarcação, jogava a pessoa no menu depois de ela dizer sim.
await caso('Confirmação com palavra a mais continua sendo sim', [
  ['Oi', 'Como podemos ajudar'],
  ['4', 'Digite CANCELAR'],
  ['cancelar', 'Confirma o cancelamento'],
  ['sim, pode cancelar por favor', 'cancelada'],
], {
  pacientes: [ANA],
  consultas: [DUAS_CONSULTAS[0]],
  verificar: ({ canceladas, titulo }) => {
    if (!canceladas.includes('c-1')) {
      falhas.push(`${titulo} | entendeu o sim como desistência e manteve a consulta`)
    } else passou++
  },
})

// E "não" continua sendo não: aceitar demais aqui cancelaria consulta de quem
// estava recusando.
await caso('Confirmação em negativo mantém a consulta', [
  ['Oi', 'Como podemos ajudar'],
  ['4', 'Digite CANCELAR'],
  ['cancelar', 'Confirma o cancelamento'],
  ['não, deixa pra lá', 'continua marcada'],
], {
  pacientes: [ANA],
  consultas: [DUAS_CONSULTAS[0]],
  verificar: ({ canceladas, titulo }) => {
    if (canceladas.length) falhas.push(`${titulo} | cancelou a consulta de quem disse não`)
    else passou++
  },
})

// Um dígito solto dentro de uma frase não é escolha de menu.
//
// escolha() raspava TODOS os caracteres não numéricos e lia o que sobrava.
// "meu filho de 2 anos está com sangue nas fezes" virava a opção 2 e abria o
// agendamento; "ele tem 5 anos, o que devo levar?" abria a 2ª via. A pergunta
// nunca era respondida, e um sintoma de alarme entrava como "quero marcar".
await caso('Idade no meio da frase não escolhe opção do menu', [
  ['Oi', 'Como podemos ajudar'],
  ['meu filho de 2 anos está com sangue nas fezes', 'não posso orientar'],
])

await caso('Pergunta com número não vira escolha de menu', [
  ['Oi', 'Como podemos ajudar'],
  ['ele tem 5 anos, o que devo levar?', 'passei sua mensagem'],
])

// E o que é escolha continua sendo escolha, escrito como as pessoas escrevem.
for (const [frase, esperado] of [
  ['2', 'Em qual unidade'],
  [' 2 ', 'Em qual unidade'],
  ['opção 2', 'Em qual unidade'],
  ['2.', 'Em qual unidade'],
  ['*2*', 'Em qual unidade'],
]) {
  await caso(`Escolha escrita como "${frase}"`, [
    ['Oi', 'Como podemos ajudar'],
    [frase, esperado],
  ])
}

// A função sobe antes das migrations - é a ordem normal do projeto. Sem plano
// B, um 'insurance' que o banco ainda não tem faz o Postgres recusar o INSERT
// inteiro, e TODO agendamento pelo WhatsApp passa a responder "não consegui
// concluir agora". Perder o convênio é arranhão; perder o horário é a família
// sem consulta.
await caso('Coluna nova ausente em appointments não impede o agendamento', [
  ['Oi', 'Como podemos ajudar'],
  ['2', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['1', 'Horários de'],
  ['1', 'está guardado'],
], {
  colunasAusentes: ['insurance'],
  verificar: ({ marcadas, titulo }) => {
    if (!marcadas.length) falhas.push(`${titulo} | não marcou nada`)
    else passou++
    if (marcadas.at(-1) && 'insurance' in marcadas.at(-1)) {
      falhas.push(`${titulo} | insistiu na coluna que o banco não tem`)
    } else passou++
  },
})

// ---------------------------------------------------------------
// O robô fecha o que ele mesmo resolveu
// ---------------------------------------------------------------

// Cadastro completo e consulta marcada: não sobrou nada para a equipe. Antes a
// conversa não ganhava marca nenhuma - "Respondida" é sobre gente da equipe, e
// "Resolvida" só vinha de alguém clicar em Concluir -, então o cartão ficava
// com cara de pendente sem ter pendência, e a recepção abria um por um.
await caso('Fim da ficha marca o atendimento como concluído', [
  ['Oi', 'Como podemos ajudar'],
  ['2', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['1', 'Horários de'],
  ['1', 'nome completo do paciente'],
  ['Tomás Oliveira Prado', 'data de nascimento'],
  ['14/03/2021', 'nome do responsável'],
  ['Renata Oliveira Prado', 'CPF'],
  ['39053344705', 'e-mail'],
  ['pular', ['Tudo certo', 'Consulta marcada']],
], {
  verificar: ({ ultimoToque, titulo }) => {
    if (!ultimoToque.concluida) {
      falhas.push(`${titulo} | terminou sem marcar a conversa como concluída`)
    } else passou++
  },
})

// Pular o e-mail não deixa pendência: é campo opcional, e o robô já disse isso
// a quem respondeu PULAR. Foi o caso real de 18/09/2026.
await caso('Pular campo opcional ainda conclui o atendimento', [
  ['Oi', 'Como podemos ajudar'],
  ['2', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['1', 'Horários de'],
  ['1', 'nome completo do paciente'],
  ['Tomás Oliveira', 'data de nascimento'],
  ['14/03/2021', 'nome do responsável'],
  ['Renata Oliveira', 'CPF'],
  ['pular', 'e-mail'],
  ['pular', 'Tudo certo'],
], {
  verificar: ({ ultimoToque, titulo }) => {
    if (!ultimoToque.concluida) falhas.push(`${titulo} | não marcou como concluída`)
    else passou++
  },
})

// No meio do caminho, não. Conversa em andamento não é conversa resolvida.
await caso('Meio da ficha não é conclusão', [
  ['Oi', 'Como podemos ajudar'],
  ['2', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['1', 'Horários de'],
  ['1', 'nome completo do paciente'],
  ['Tomás Oliveira', 'data de nascimento'],
], {
  verificar: ({ ultimoToque, titulo }) => {
    if (ultimoToque.concluida) falhas.push(`${titulo} | fechou uma conversa que ainda estava andando`)
    else passou++
  },
})

// Quem pediu a equipe continua pedindo. A bandeira vence a conclusão, ou o
// robô fecharia a conversa de quem está esperando uma pessoa.
await caso('Pedido de atendente não é fechado pelo robô', [
  ['Oi', 'Como podemos ajudar'],
  ['3', 'direcionando você para alguém da nossa equipe'],
], {
  verificar: ({ ultimoToque, titulo }) => {
    if (ultimoToque.concluida) falhas.push(`${titulo} | fechou a conversa de quem pediu gente`)
    else passou++
  },
})

// ---------------------------------------------------------------
// A tela de configuracao nao pode mentir sobre o menu
// ---------------------------------------------------------------

// A previa "Como a mensagem chega", em Respostas, desenha o menu a mao: e uma
// COPIA da lista que o robo envia. Nao da para a tela buscar a lista do robo em
// tempo de execucao - cada numero esta amarrado a uma funcao no codigo, entao
// acrescentar ou tirar item e programacao, e a chamada de rede seria paga a
// cada abertura de tela para saber algo que so muda em deploy.
//
// O que faltava era alguem avisar quando as duas listas desencontram. Em
// 20/09/2026 a previa passou semanas mostrando TRES opcoes enquanto o robo ja
// mandava cinco - e era justamente a tela onde a clinica ia conferir o menu.
// Este teste quebra a publicacao quando uma muda sem a outra.
await caso('Menu da tela de configuração bate com o que o robô envia', [
  ['Oi', 'Como podemos ajudar'],
], {
  verificar: ({ ultimoToque, titulo }) => {
    const tela = readFileSync('src/sections/Conversations.tsx', 'utf8')
    const bloco = tela.match(/const MENU_DO_ROBO = \[([\s\S]*?)\]/)
    if (!bloco) {
      falhas.push(`${titulo} | não achei MENU_DO_ROBO em Conversations.tsx`)
      return
    }
    const daTela = [...bloco[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    const doRobo = ultimoToque.resposta
      .split('\n')
      .filter((linha) => /^\*\d\*/.test(linha.trim()))
      .map((linha) => linha.trim())

    if (daTela.length !== doRobo.length) {
      falhas.push(
        `${titulo} | a tela mostra ${daTela.length} opções e o robô manda ${doRobo.length}`,
      )
    } else passou++

    for (let i = 0; i < Math.max(daTela.length, doRobo.length); i += 1) {
      if (daTela[i] !== doRobo[i]) {
        falhas.push(`${titulo} | linha ${i + 1}\n     tela: ${daTela[i]}\n     robô: ${doRobo[i]}`)
      } else passou++
    }
  },
})


// ---------------------------------------------------------------
// Registro dos eventos (numeros do WhatsApp)
// ---------------------------------------------------------------
//
// O painel da Visao geral conta em cima destes eventos. Se o robo deixar de
// registrar, a tela nao quebra: ela passa a mentir, mostrando zero onde houve
// movimento. Mentira silenciosa e o defeito que este projeto mais paga caro,
// entao ela precisa falhar aqui.
//
// PARA PROVAR QUE ESTE TESTE PEGA O DEFEITO: comente a linha `registrar(...)`
// correspondente em atendimento.ts e rode de novo. Cada caso abaixo aponta
// qual linha derruba ele.

// Esvazia o que sobrou dos casos anteriores: os eventos se acumulam por
// conversa ate alguem colher, e todos os casos usam 'conv1'.
colherEventos('conv1')

async function eventosDe(titulo, passos, opcoes = {}) {
  colherEventos('conv1')
  await caso(titulo, passos, opcoes)
  return colherEventos('conv1')
}

function exigirEvento(lista, evento, titulo, detalhe = undefined) {
  const achado = lista.find(
    (e) => e.evento === evento && (detalhe === undefined || e.detalhe === detalhe),
  )
  if (achado) passou++
  else {
    const vistos = lista.map((e) => e.evento + (e.detalhe ? `:${e.detalhe}` : '')).join(', ') || '(nenhum)'
    falhas.push(
      `${titulo} | faltou o evento "${evento}"${detalhe !== undefined ? ` com detalhe "${detalhe}"` : ''}\n     registrados: ${vistos}`,
    )
  }
}

// mostrarMenu -> registrar('menu_enviado')
{
  const eventos = await eventosDe('Evento: o menu aparecendo fica registrado', [
    ['Oi', 'Como podemos ajudar'],
  ])
  exigirEvento(eventos, 'menu_enviado', 'Evento do menu')
}

// tratarConversa, bloco do menu -> registrar('opcao_escolhida', ...)
// Este e o que responde "o que as pessoas mais pedem".
{
  const eventos = await eventosDe('Evento: a opção escolhida no menu fica registrada', [
    ['Oi', 'Como podemos ajudar'],
    ['3', 'direcionando você para alguém da nossa equipe'],
  ])
  exigirEvento(eventos, 'opcao_escolhida', 'Evento da opção', '3')
}

// A opcao escrita por extenso tambem conta, porque escolha() ja aceita.
{
  const eventos = await eventosDe('Evento: "opção 2" por extenso também é registrada', [
    ['Oi', 'Como podemos ajudar'],
    ['opção 2', 'Em qual unidade'],
  ])
  exigirEvento(eventos, 'opcao_escolhida', 'Evento da opção por extenso', '2')
}

// Frase solta NAO pode virar opcao escolhida: era o defeito que fazia
// "meu filho de 2 anos" abrir o agendamento. Se voltar, o painel passa a
// contar escolhas que ninguem fez.
{
  const eventos = await eventosDe('Evento: frase com número não vira opção escolhida', [
    ['Oi', 'Como podemos ajudar'],
    ['meu filho de 2 anos está com dor de barriga', 'Dr. Marcello'],
  ])
  const inventado = eventos.find((e) => e.evento === 'opcao_escolhida')
  if (inventado) {
    falhas.push(
      `Evento inventado | uma frase virou "opção ${inventado.detalhe}" no painel`,
    )
  } else passou++
  // Sintoma tem nome proprio: o robo entendeu e escolheu nao opinar. Contar
  // como "nao entendi" misturaria limite nosso com menu confuso.
  exigirEvento(eventos, 'assunto_clinico', 'Evento do assunto clínico')
}

// mostrarMenu com aviso de "Nao entendi" -> registrar('nao_entendi').
// Este e o alarme de menu incompleto, e e o caminho por onde mais gente passa.
{
  const eventos = await eventosDe('Evento: o "não entendi" do menu fica registrado', [
    ['Oi', 'Como podemos ajudar'],
    ['blablabla', 'Não entendi'],
  ])
  exigirEvento(eventos, 'nao_entendi', 'Evento do não entendi no menu')
}

// A funcao naoEntendi(), que e OUTRO ponto: vale para quem ja esta dentro de
// um fluxo - escolhendo unidade, dia ou horario - e escreve qualquer coisa.
//
// Este caso nasceu da propria prova: desliguei o registrar() de dentro de
// naoEntendi() e nenhum teste caiu, porque so o caminho do menu estava coberto.
// Linha de instrumentacao sem teste e linha que morre calada na proxima
// refatoracao, e o painel nunca conta que parou.
{
  const eventos = await eventosDe('Evento: o "não entendi" dentro do fluxo fica registrado', [
    ['Oi', 'Como podemos ajudar'],
    ['2', 'Em qual unidade'],
    ['xyz nada a ver', 'Não entendi'],
  ])
  exigirEvento(eventos, 'nao_entendi', 'Evento do não entendi no fluxo')
}

// marcar() -> registrar('agendou'), so depois do INSERT dar certo.
{
  const eventos = await eventosDe('Evento: consulta marcada fica registrada', [
    ['Oi', 'cuidar de Ana'],
    ['2', 'Em qual unidade'],
    ['1', 'Datas disponíveis'],
    ['1', 'Horários de'],
    ['1', 'Consulta marcada!'],
  ], { pacientes: [ANA] })
  exigirEvento(eventos, 'agendou', 'Evento do agendamento')
}

// ... e NAO pode registrar quando o banco recusa: o painel diria que o robo
// marcou mais consultas do que existem na agenda.
{
  const eventos = await eventosDe('Evento: agendamento que falhou não conta como marcado', [
    ['Oi', 'cuidar de Ana'],
    ['2', 'Em qual unidade'],
    ['1', 'Datas disponíveis'],
    ['1', 'Horários de'],
    ['1', 'Não consegui concluir'],
  ], { pacientes: [ANA], erroInsert: { code: '23503', message: 'falhou' } })
  if (eventos.some((e) => e.evento === 'agendou')) {
    falhas.push('Evento do agendamento que falhou | contou como consulta marcada')
  } else passou++
}


// ---------------------------------------------------------------
// Trocar de dia estando na lista de horarios
// ---------------------------------------------------------------
//
// Caso real de 22/09/2026: a mae via os horarios de um dia, mudou de ideia e
// tocou no item de OUTRO dia, na lista de datas da mensagem anterior. O robo
// marcou um horario que ela nunca escolheu. O webhook agora passa o texto do
// item ("terça, 01/09") quando o toque e numa lista antiga - e o robo precisa
// entender esse texto como troca de dia, nunca como horario.
//
// PARA PROVAR: apague o bloco "Mudou de ideia sobre o DIA" em
// aguardando_horario. O primeiro caso cai.
await caso(
  'Real 22/09: data digitada na lista de horários mostra os horários daquele dia',
  [
    ['Oi', 'cuidar de Ana'],
    ['2', 'Em qual unidade'],
    ['1', 'Datas disponíveis'],
    ['1', 'Horários de'],
    ['terça, 01/09', ['Horários de', '01/09']],
  ],
  {
    pacientes: [ANA],
    verificar: ({ marcadas, titulo }) => {
      if (marcadas.length !== 0) {
        falhas.push(`${titulo} | marcou ${marcadas.length} consulta(s) sem a pessoa escolher horário`)
      } else passou++
    },
  },
)

await caso(
  'Data sem vaga na lista de horários avisa e não marca nada',
  [
    ['Oi', 'cuidar de Ana'],
    ['2', 'Em qual unidade'],
    ['1', 'Datas disponíveis'],
    ['1', 'Horários de'],
    ['25/12', 'Não há horários livres em 25/12'],
  ],
  {
    pacientes: [ANA],
    verificar: ({ marcadas, titulo }) => {
      if (marcadas.length !== 0) falhas.push(`${titulo} | marcou sem escolha`)
      else passou++
    },
  },
)

// ...e o numero continua valendo como sempre: "4" e o quarto horario.
await caso(
  'Número na lista de horários continua marcando aquele horário',
  [
    ['Oi', 'cuidar de Ana'],
    ['2', 'Em qual unidade'],
    ['1', 'Datas disponíveis'],
    ['1', 'Horários de'],
    ['4', 'Consulta marcada!'],
  ],
  { pacientes: [ANA] },
)


// ---------------------------------------------------------------
// Pedido de nota fiscal (22/09/2026)
// ---------------------------------------------------------------
//
// Uma mae pediu a NF de uma consulta na primeira mensagem e recebeu o menu
// inteiro, como se nao tivesse dito nada. O pedido e administrativo: o robo
// entende, pede o que falta e chama a equipe.
//
// PARA PROVAR: comente as duas linhas `if (pediuNotaFiscal(texto))` em
// atendimento.ts. Os dois primeiros casos caem.
await caso(
  'NF pedida na primeira mensagem vira pedido para a equipe, sem menu',
  [['Boa tarde, estive com meu filho em consulta com o dr. e foi solicitado a nf', ['Anotei o pedido de *nota fiscal', 'nome do paciente']]],
  {
    primeiraMensagem: true,
    verificar: ({ conversa, ultimoToque, titulo }) => {
      if (ultimoToque.atencao !== 'documento') falhas.push(`${titulo} | atenção ${ultimoToque.atencao}`)
      else passou++
      if (conversa.booking_state !== 'atendente') falhas.push(`${titulo} | estado ${conversa.booking_state}`)
      else passou++
      if (ultimoToque.resposta.includes('Como podemos ajudar')) falhas.push(`${titulo} | mandou o menu`)
      else passou++
    },
  },
)

await caso('NF escrita com o menu na tela também é entendida', [
  ['Oi', 'Como podemos ajudar'],
  ['preciso da nota fiscal da consulta de agosto', 'Anotei o pedido de *nota fiscal'],
])

await caso('"preciso do recibo da consulta" também é pedido', [
  ['Oi', 'Como podemos ajudar'],
  ['preciso do recibo da consulta para o reembolso', 'Anotei o pedido'],
])

// Pergunta sobre a clinica nao e pedido: quem so quer saber se ha recibo nao
// pode ir para a fila da equipe.
{
  const { transcricao } = await caso('"vocês emitem recibo?" não vira pedido', [
    ['Oi', 'Como podemos ajudar'],
    ['vocês emitem recibo?', ''],
  ])
  const ultima = transcricao.at(-1) ?? ''
  if (ultima.includes('Anotei o pedido')) falhas.push('"vocês emitem recibo?" virou pedido de nota')
  else passou++
}

// Palavras que contem "nf" nao podem disparar.
{
  const { transcricao } = await caso('"confirmar" não é nota fiscal', [
    ['Oi', 'Como podemos ajudar'],
    ['quero confirmar uma informação', ''],
  ])
  if ((transcricao.at(-1) ?? '').includes('Anotei o pedido')) falhas.push('"confirmar" virou pedido de nota')
  else passou++
}

// ---------------------------------------------------------------------------
// Revisao das mensagens (07/10/2026)
// ---------------------------------------------------------------------------

// Urgencia numa sexta as 23h: nada de "vamos entrar em contato com urgencia",
// que ninguem cumpre ate segunda. Diz quando a equipe volta e poe o
// pronto-socorro em primeiro plano. Continua marcada como urgencia.
await caso('Urgência fora do expediente diz a verdade sobre o horário', [
  ['socorro, é urgente, meu filho está muito mal', ['é urgência', 'fora do horário', 'não espere a nossa resposta', '192']],
], {
  agora: SEXTA_23H,
  verificar: ({ ultimoToque, titulo }) => {
    if (ultimoToque.atencao !== 'urgencia') falhas.push(`${titulo} | atenção ${ultimoToque.atencao}`)
    else passou++
    if (/vai entrar em contato com urgência/.test(ultimoToque.resposta)) falhas.push(`${titulo} | prometeu contato urgente de madrugada`)
    else passou++
  },
})

await caso('Urgência na fila, fora do expediente, também', [
  ['Oi', 'Como podemos ajudar'],
  ['3', 'alguém da nossa equipe'],
  ['é urgente, ele está muito mal', ['fora do horário', 'não espere a nossa resposta']],
], { agora: SEXTA_23H })

await caso('No expediente a urgência continua igual', [
  ['é urgente, meu filho está muito mal', ['transferindo você para um atendente', 'com urgência por aqui']],
])

// Pergunta clinica: alem de "nao posso orientar", o caminho se a crianca piorar.
await caso('Pergunta clínica aponta a saída de urgência', [
  ['Oi', 'Como podemos ajudar'],
  ['meu filho está com dor de barriga há 3 dias, posso dar dipirona?', ['não posso orientar', 'digite *URGÊNCIA*']],
])

// "Quero remarcar" vai direto para a consulta, em vez do menu.
await caso('"Quero remarcar" mostra a consulta', [
  ['quero remarcar', ['Sua consulta', 'REMARCAR']],
], { consultas: [CONSULTA_ANA], pacientes: [] })

await caso('"Preciso desmarcar a consulta" na primeira mensagem também, com a apresentação', [
  ['preciso desmarcar a consulta de quinta', ['Aqui é o consultório', 'Sua consulta', 'CANCELAR']],
], { consultas: [CONSULTA_ANA], primeiraMensagem: true })

await caso('Com o menu na tela, "queria trocar a data" é a opção 4', [
  ['Oi', 'Como podemos ajudar'],
  ['queria trocar a data da consulta', 'Sua consulta'],
], { consultas: [CONSULTA_ANA] })

{
  const { transcricao } = await caso('Sem consulta marcada, "quero remarcar" segue para o menu', [
    ['quero remarcar', 'Como podemos ajudar'],
  ])
  if ((transcricao.at(-1) ?? '').includes('Não encontrei nenhuma consulta')) falhas.push('"quero remarcar" sem consulta virou beco')
  else passou++
}

for (const [frase, esperado] of [
  ['quero remarcar', true],
  ['preciso cancelar a consulta da Helena', true],
  ['dá para mudar o horário?', true],
  ['não quero cancelar, só confirmar', false],
  ['nao precisa remarcar', false],
  ['cancelar', false],
  ['quero marcar uma consulta', false],
]) {
  if (pediuMudarConsulta(frase) === esperado) passou++
  else falhas.push(`pediuMudarConsulta("${frase}") deveria ser ${esperado}`)
}

// Ficha: sem "dele(a)" de formulario.
await caso('Data de nascimento pergunta pela criança, sem "dele(a)"', [
  ['Helena Souza Lima', '*data de nascimento* da criança'],
], { consultas: CONSULTA_SEM_FICHA, fichas: FICHA_VAZIA, estadoInicial: NO_MENU })

// ---------------------------------------------------------------------------
// Conversas de 07 a 09/10/2026
// ---------------------------------------------------------------------------

// Tatiane: a secretaria entrou na escolha do dia; a resposta para ela nao pode
// receber "Nao entendi" do robo. Resposta que o robo entende continua valendo.
await caso('Com a equipe conversando, "não entendi" na etapa vira silêncio', [
  ['agendar', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['10:40h', null, { podeIniciarMenu: false }],
  ['1', 'Horários'],
])
await caso('Sem a equipe, a mesma resposta ainda recebe "não entendi"', [
  ['agendar', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['10:40h', 'Não entendi'],
])

// Tatiane: "Sexta pela manha" com a lista de datas na tela.
await caso('Dia escrito por nome escolhe a data', [
  ['agendar', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['terça pela manhã', 'Horários de terça, 01/09'],
])
await caso('Dia da semana sem vaga diz que não há vaga nesse dia', [
  ['agendar', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['sexta pela manhã', 'não temos horário livre na sexta'],
  ['VOLTAR', 'Em qual unidade'],
])
for (const [frase, esperado] of [
  ['quarta', 2], ['segunda de manhã', 0], ['dia 7', 3], ['sexta', -1], ['segunda ou terça', -1], ['quero o primeiro', -1],
]) {
  const r = diaPeloNome(frase, diasSantos, QUARTA_10H)
  if (r === esperado) passou++
  else falhas.push(`diaPeloNome("${frase}") deveria ser ${esperado}, veio ${r}`)
}

// Bianca: tocou o NOME da unidade numa lista antiga e recebeu o endereco.
await caso('Nome da unidade na escolha das informações é escolha, não resposta pronta', [
  ['Oi', 'Como podemos ajudar'],
  ['1', 'Para qual atendimento'],
  ['Liferty · Santos', 'Consulta em Santos'],
], {
  respostasProntas: [{ id: 'e', subject: 'Endereço', keywords: ['livance', 'liferty', 'endereco'], answer: 'Atendemos em duas unidades: X e Y.' }],
  unidades: [{ ...TRES_UNIDADES[0], info_text: '*Consulta em Santos: R$ 450,00.*' }, TRES_UNIDADES[1], TRES_UNIDADES[2]],
})
await caso('"Santos" sozinho também escolhe a unidade', [
  ['Oi', 'Como podemos ajudar'],
  ['1', 'Para qual atendimento'],
  ['santos', 'Consulta em Santos'],
], { unidades: [{ ...TRES_UNIDADES[0], info_text: '*Consulta em Santos: R$ 450,00.*' }, TRES_UNIDADES[1], TRES_UNIDADES[2]] })
await caso('"Bom dia" na escolha das informações repete a pergunta, com lista', [
  ['Oi', 'Como podemos ajudar'],
  ['1', 'Para qual atendimento'],
  ['Bom dia', 'Para qual atendimento'],
], {
  verificar: ({ ultimoToque, titulo }) => {
    if (ultimoToque.lista) passou++
    else falhas.push(`${titulo} | sem lista`)
  },
})
await caso('"Não entendi" na escolha das informações volta com a lista', [
  ['Oi', 'Como podemos ajudar'],
  ['1', 'Para qual atendimento'],
  ['228', 'Não entendi'],
], {
  verificar: ({ ultimoToque, titulo }) => {
    if (ultimoToque.lista) passou++
    else falhas.push(`${titulo} | sem lista`)
  },
})

// Veronica: "400,00 a consulta, certo?" e pergunta de valor.
await caso('Valor escrito em número casa com a resposta de valor', [
  ['Oi', 'Como podemos ajudar'],
  ['Confirmando, 400,00 a consulta, certo', 'custa R$ 450,00'],
], { respostasProntas: RESPOSTAS })

// Veronica e Cinthia: o WhatsApp Business da familia respondendo sozinho.
for (const frase of [
  'Oie. No momento, estou fora do meu horário de atendimento. Retorno sua mensagem assim que possível 😊',
  'Cinthia Esteves agradece seu contato. Como podemos ajudar?',
  // Renata, 10/10/2026: a imobiliaria dela respondeu ao acompanhamento.
  'Olá! Seja muito bem-vindo(a). Aqui é *Natália*, proprietária da *Imobiliária*. 🏠 Agradeço imensamente o seu contato. Em breve eu ou um membro da nossa equipe entraremos em contato para lhe atender com toda atenção. Até já!',
]) {
  await caso(`Resposta automática da família não recebe nada: ${frase.slice(0, 30)}`, [
    ['Oi', 'Como podemos ajudar'],
    ['3', 'alguém da nossa equipe'],
    [frase, VAZIO],
  ], {
    verificar: ({ ultimoToque, titulo }) => {
      if (ultimoToque.resposta === '' && !ultimoToque.atencao) passou++
      else falhas.push(`${titulo} | respondeu: ${ultimoToque.resposta.slice(0, 60)}`)
    },
  })
}
for (const [frase, esperado] of [
  ['vocês estão fora do horário de atendimento?', false],
  ['retorno para o Matheus', false],
  ['Esta é uma mensagem automática', true],
  ['Agradeço o contato! Retornaremos em breve.', true],
  // Mae agradecendo de verdade nao pode ser calada.
  ['Agradeço muito pela consulta, ele melhorou bastante', false],
  ['obrigada, a gente entra em contato depois', false],
]) {
  if (respostaAutomaticaDaFamilia(frase) === esperado) passou++
  else falhas.push(`respostaAutomaticaDaFamilia("${frase}") deveria ser ${esperado}`)
}

// Renata: a resposta automatica chegou logo depois do acompanhamento. Nao e
// recado sobre a crianca: nem resposta, nem equipe chamada.
await caso('Resposta automática depois do acompanhamento não vira recado', [
  ['Olá! Seja muito bem-vindo(a). Agradeço imensamente o seu contato. Em breve eu ou um membro da nossa equipe entraremos em contato.', VAZIO],
], {
  posAcompanhamento: true,
  verificar: ({ ultimoToque, titulo }) => {
    if (!ultimoToque.atencao) passou++
    else falhas.push(`${titulo} | chamou a equipe: ${ultimoToque.atencao}`)
  },
})

// Veronica e Dani: atraso e chegada no dia da consulta.
await caso('"Vou atrasar" no dia da consulta vai para a equipe, sem menu', [
  ['Apenas para avisar que pode ser que o Otavio atrase uns 15 min', ['Obrigado por avisar', 'avisa o Dr. Marcello']],
], {
  consultaHoje: true,
  primeiraMensagem: true,
  verificar: ({ ultimoToque, titulo }) => {
    if (ultimoToque.atencao === 'atendente') passou++
    else falhas.push(`${titulo} | atenção ${ultimoToque.atencao}`)
  },
})
await caso('"Estamos aqui na recepção" avisa a equipe', [
  ['Sou a mãe do Martín, estamos aqui na recepção', 'Obrigado por avisar que chegaram'],
], { primeiraMensagem: true })
await caso('"Atraso de fala" não é aviso de atraso', [
  ['Oi', 'Como podemos ajudar'],
  ['meu filho tem atraso na fala, vocês atendem?', ''],
], {
  consultaHoje: true,
  verificar: ({ ultimoToque, titulo }) => {
    if (/Obrigado por avisar/.test(ultimoToque.resposta)) falhas.push(`${titulo} | virou aviso de atraso`)
    else passou++
  },
})
await caso('Aviso de atraso com a equipe conversando: silêncio', [
  ['estamos a caminho, pegamos trânsito', null],
], { consultaHoje: true, podeIniciarMenu: false })
for (const [frase, esperado] of [
  ['vamos atrasar uns 10 minutos', 'atraso'],
  ['chegamos em 5 min', 'atraso'],
  ['cheguei', 'chegada'],
  ['ele tem atraso no crescimento', null],
]) {
  if (avisoDoDiaDaConsulta(frase) === esperado) passou++
  else falhas.push(`avisoDoDiaDaConsulta("${frase}") deveria ser ${esperado}`)
}

// Dani: dois dias depois da consulta, "ele segue com dores", com o menu na tela.
await caso('Relato de evolução depois da consulta vira recado, com o menu na tela', [
  ['Recebi sim, já estamos aplicando os medicamentos, mas o Martín segue com dores abdominais à noite', ['Obrigado por nos contar', 'URGÊNCIA']],
], { posAcompanhamento: true, estadoInicial: { booking_state: 'menu' } })

// ---------------------------------------------------------------
// Campos {valor}, {endereco}, {valores} (14/10/2026)
// ---------------------------------------------------------------
// O valor mora no cartao da unidade e o texto diz {valor}. Mudou no cartao,
// mudou na mensagem. E nada de "{valor}" cru na tela de uma mae.
//
// PARA PROVAR QUE ESTE BLOCO PEGA O DEFEITO: em atendimento.ts, troque o
// `await comCampos(...)` de responderInformacoes pelo texto sem trocar, ou
// apague a guarda final de tratarConversa (`if (resultado && temCampo(...`).
// Os casos com "nao sai cru" falham.

const COM_VALOR = [
  { ...TRES_UNIDADES[0], price_cents: 45000 },
  { ...TRES_UNIDADES[1], price_cents: 50000 },
  {
    ...TRES_UNIDADES[2],
    price_cents: 60000,
    info_text: '💙 *Consulta em {unidade}: {valor}.* Inclui retorno em até 30 dias.\n📍 {endereco}',
  },
]

function semCampoCru(titulo) {
  return ({ ultimoToque }) => {
    if (/\{\s*(valor|valores|endereco|enderecos|unidade)\s*\}/i.test(ultimoToque.resposta)) {
      falhas.push(`${titulo} | campo saiu cru para a família: ${ultimoToque.resposta.slice(0, 120)}`)
    } else passou++
  }
}

await caso('Campos: texto da unidade sai com o valor e o endereço do cartão', [
  ['Oi', 'Como podemos ajudar'],
  ['1', 'Para qual atendimento'],
  ['3', ['Consulta em Livance Ibirapuera - São Paulo: R$ 600,00.', '📍 Rua Y, 30', '13 3273-6828']],
], { unidades: COM_VALOR, verificar: semCampoCru('Campos: texto da unidade') })

await caso('Campos: valor novo no cartão já vale na próxima mensagem', [
  ['Oi', 'Como podemos ajudar'],
  ['1', 'Para qual atendimento'],
  ['3', 'R$ 650,00'],
], { unidades: [COM_VALOR[0], COM_VALOR[1], { ...COM_VALOR[2], price_cents: 65000 }] })

{
  const titulo = 'Campos: unidade sem valor perde a linha, não o resto, e grita'
  const eventos = await eventosDe(titulo, [
    ['Oi', 'Como podemos ajudar'],
    ['1', 'Para qual atendimento'],
    ['3', ['Bem-vindo à unidade.', 'Traga a carteirinha.']],
  ], {
    unidades: [
      COM_VALOR[0],
      COM_VALOR[1],
      { ...TRES_UNIDADES[2], info_text: 'Bem-vindo à unidade.\n*Consulta: {valor}.*\nTraga a carteirinha.' },
    ],
    verificar: (r) => {
      semCampoCru(titulo)(r)
      if (r.ultimoToque.resposta.includes('Consulta:')) falhas.push(`${titulo} | a linha sem valor ficou pela metade`)
      else passou++
    },
  })
  exigirEvento(eventos, 'campo_sem_valor', titulo, 'valor de Livance Ibirapuera - São Paulo')
}

{
  // A Edge sobe antes da migration: a coluna nova ainda nao existe. Perde-se a
  // linha do valor; a lista de unidades e o resto do atendimento seguem.
  const titulo = 'Campos: sem a coluna price_cents o atendimento segue de pé'
  const eventos = await eventosDe(titulo, [
    ['Oi', 'Como podemos ajudar'],
    ['1', ['Para qual atendimento', '*1* Liferty · Santos', '*3* Livance Ibirapuera']],
    ['3', ['📍 Rua Y, 30', '13 3273-6828']],
  ], {
    unidades: COM_VALOR,
    colunasAusentes: ['price_cents', 'telemedicine_price_cents'],
    verificar: (r) => {
      semCampoCru(titulo)(r)
      // A linha do valor cai inteira: preco pela metade e pior que nenhum.
      if (r.ultimoToque.resposta.includes('Consulta em')) falhas.push(`${titulo} | linha do valor ficou sem o valor`)
      else passou++
    },
  })
  exigirEvento(eventos, 'campo_sem_valor', titulo)
}

await caso('Campos: telemedicina com o valor dela', [
  ['Oi', 'Como podemos ajudar'],
  ['1', ['Para qual atendimento', 'Telemedicina']],
  ['4', ['*Telemedicina: R$ 420,00.*', 'URGÊNCIA']],
], {
  unidades: COM_VALOR,
  telemedicina: { ativa: true, texto: '*Telemedicina: {valor}.* Retorno presencial em até 30 dias.', valor: 42000 },
  verificar: semCampoCru('Campos: telemedicina'),
})

await caso('Campos: resposta pronta com {valores} lista cada atendimento', [
  ['Oi', 'Como podemos ajudar'],
  ['quanto custa a consulta?', [
    '• Liferty · Santos: R$ 450,00',
    '• Livance · Santo André: R$ 500,00',
    '• Livance Ibirapuera - São Paulo: R$ 600,00',
    '• Telemedicina (por vídeo): R$ 420,00',
  ]],
], {
  unidades: COM_VALOR,
  telemedicina: { ativa: true, texto: 'Por vídeo.', valor: 42000 },
  respostasProntas: [{ id: 'v', subject: 'Valor e pagamento', keywords: ['valor', 'custa', 'preco'], answer: '💰 Valores da consulta:\n{valores}\n\nPix, débito ou crédito.' }],
  verificar: semCampoCru('Campos: resposta pronta com {valores}'),
})

{
  // A tela nao deixa salvar {valor} numa resposta pronta (nao se sabe de qual
  // unidade). Se mesmo assim estiver no banco, a guarda final segura.
  const titulo = 'Campos: {valor} numa resposta pronta não sai cru'
  const eventos = await eventosDe(titulo, [
    ['Oi', 'Como podemos ajudar'],
    ['quanto custa a consulta?', ['Pix, débito ou crédito.']],
  ], {
    unidades: COM_VALOR,
    respostasProntas: [{ id: 'v', subject: 'Valor', keywords: ['valor', 'custa'], answer: 'A consulta custa {valor}.\nPix, débito ou crédito.' }],
    verificar: semCampoCru(titulo),
  })
  exigirEvento(eventos, 'campo_sem_valor', titulo)
}

// ---------------------------------------------------------------
// Mandar horarios (a equipe pela tela, 14/10/2026)
// ---------------------------------------------------------------
// A secretaria escolhe a unidade e o periodo; a familia toca no dia e no
// horario e o robo marca. PARA PROVAR: em perguntarHorario, tire a segunda
// busca ("Dia alem da agenda aberta") e o caso do dia 27/11 falha; em
// oferecerHorarios, troque `periodo` por undefined e o caso "ate 02/09" falha.

const PEDIDOS = []
const pedirHorarios = (pedido) => async ({ admin }) => {
  const r = await oferecerHorarios(admin, 'c1', 'conv1', pedido)
  PEDIDOS.push(r)
}

{
  PEDIDOS.length = 0
  const r = await caso('Mandar horários: a família toca no dia e no horário e a consulta fica marcada', [
    ['1', ['Horários de segunda, 31/08', '08:00']],
    ['1', 'Consulta marcada'],
  ], { antes: pedirHorarios({ unidade: 'u-santos' }), pacientes: [ANA] })
  const enviado = PEDIDOS[0]?.resultado
  if (enviado?.resposta.includes('Separei os horários') && enviado.resposta.includes('Datas disponíveis em Liferty · Santos') && enviado.lista) passou++
  else falhas.push(`Mandar horários | mensagem da equipe errada: ${JSON.stringify(PEDIDOS[0]).slice(0, 160)}`)
  if (r.marcadas.length === 1 && r.marcadas[0].unit_id === 'u-santos') passou++
  else falhas.push(`Mandar horários | consulta não marcada: ${JSON.stringify(r.marcadas)}`)
}

{
  // A secretaria escreveu antes ("vou verificar, só um minuto"): a conversa e
  // humana, mas a lista foi ela que mandou - o toque da familia tem de marcar.
  PEDIDOS.length = 0
  const r = await caso('Mandar horários: com a equipe conversando, o toque ainda marca', [
    ['1', '08:00'],
    ['1', 'Consulta marcada'],
  ], { antes: pedirHorarios({ unidade: 'u-santos' }), pacientes: [ANA], podeIniciarMenu: false })
  if (r.marcadas.length === 1) passou++
  else falhas.push('Mandar horários com a equipe conversando | não marcou')
}

{
  PEDIDOS.length = 0
  await caso('Mandar horários com período: só os dias pedidos', [], {
    antes: pedirHorarios({ unidade: 'u-santos', de: '2026-09-01', ate: '2026-09-02' }),
  })
  const texto = PEDIDOS[0]?.resultado?.resposta ?? ''
  if (texto.includes('01/09') && texto.includes('02/09') && !texto.includes('31/08') && !texto.includes('07/09')) passou++
  else falhas.push(`Mandar horários com período | dias errados: ${texto.slice(0, 200)}`)
}

{
  // A Cecilia: o Dr. pediu retorno em 40 dias, "dia 27/11" - fora da agenda aberta.
  PEDIDOS.length = 0
  const r = await caso('Mandar horários de um dia além da agenda aberta (27/11)', [
    ['2', 'Consulta marcada'],
  ], {
    antes: pedirHorarios({ unidade: 'u-santos', de: '2026-11-27', ate: '2026-11-27' }),
    alemDaAgenda: {
      'u-santos': ['11:00', '11:40', '12:20'].map((h) => ({ slot_start: `2026-11-27T${h}:00Z`, slot_end: `2026-11-27T${h}:40Z` })),
    },
    pacientes: [ANA],
  })
  const texto = PEDIDOS[0]?.resultado?.resposta ?? ''
  if (texto.includes('Horários de sexta, 27/11') && texto.includes('08:40')) passou++
  else falhas.push(`Mandar horários 27/11 | lista errada: ${texto.slice(0, 200)}`)
  if (r.marcadas.length === 1 && String(r.marcadas[0].starts_at).startsWith('2026-11-27T11:40')) passou++
  else falhas.push(`Mandar horários 27/11 | não marcou o horário tocado: ${JSON.stringify(r.marcadas).slice(0, 160)}`)
}

{
  PEDIDOS.length = 0
  const r = await caso('Mandar horários sem vaga no período não envia nada', [], {
    antes: pedirHorarios({ unidade: 'u-andre', de: '2026-09-01', ate: '2026-09-05' }),
  })
  const erro = PEDIDOS[0]?.erro ?? ''
  if (erro.includes('Não há horário livre em Livance · Santo André entre 01/09 e 05/09') && r.conversa.booking_state !== 'aguardando_dia') passou++
  else falhas.push(`Mandar horários sem vaga | ${JSON.stringify(PEDIDOS[0])} estado=${r.conversa.booking_state}`)
}

{
  PEDIDOS.length = 0
  await caso('Mandar horários: data invertida e unidade inexistente são recusadas', [], {
    antes: async ({ admin }) => {
      PEDIDOS.push(await oferecerHorarios(admin, 'c1', 'conv1', { unidade: 'u-santos', de: '2026-09-05', ate: '2026-09-01' }))
      PEDIDOS.push(await oferecerHorarios(admin, 'c1', 'conv1', { unidade: 'nao-existe' }))
    },
  })
  if (PEDIDOS[0]?.erro && PEDIDOS[1]?.erro) passou++
  else falhas.push(`Mandar horários recusas | ${JSON.stringify(PEDIDOS)}`)
}

// ---------------------------------------------------------------
// Painel de familias simuladas (14/10/2026): um caso por achado
// ---------------------------------------------------------------
// As 16 conversas estao em tests/painel/resultados/. PARA PROVAR: desligue a
// correcao citada em cada bloco e o caso falha (ver a prova no relatorio do dia).

// 1. Unidade pelo nome (unidadeCitada) - 7 das 16 familias travaram aqui.
for (const [frase, onde] of [
  ['santos', 'Liferty · Santos'],
  ['pode ser em santos por favor', 'Liferty · Santos'],
  ['SAO PAULO', 'Livance Ibirapuera - São Paulo'],
  ['sp', 'Livance Ibirapuera - São Paulo'],
  ['santo andre', 'Livance · Santo André'],
]) {
  await caso(`Painel: "${frase}" escolhe a unidade pelo nome`, [
    ['quero marcar', 'Em qual unidade'],
    [frase, `Datas disponíveis em ${onde}`],
  ], { slots: { 'u-santos': SLOTS_CHEIOS['u-santos'], 'u-andre': SLOTS_CHEIOS['u-santos'], 'u-vila': SLOTS_CHEIOS['u-santos'] } })
}
await caso('Painel: unidade não entendida volta com a lista', [
  ['quero marcar', 'Em qual unidade'],
  ['a mais perto de casa', ['Não entendi qual unidade', 'Em qual unidade']],
], {
  verificar: ({ ultimoToque, titulo }) => {
    if (ultimoToque.lista?.linhas?.length >= 3) passou++
    else falhas.push(`${titulo} | voltou sem a lista`)
  },
})

// 2. Cadastro sem dado errado (nomeDaFicha, data no meio da frase, pulou).
await caso('Painel: nome com data, responsável com "sou a mãe", CPF "mando depois"', [
  ['quero marcar', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['1', 'Horários de'],
  ['1', 'nome completo do paciente'],
  ['Lucas Ferreira Campos, nasceu 03/05/2022', 'nome do responsável'],
  ['Fernanda Oliveira Prado, sou a mae', 'CPF do paciente'],
  ['nao sei de cabeça, mando depois', 'e-mail'],
  ['NAO TENHO EMAIL', 'Tudo certo'],
], {
  verificar: ({ dadosDasConsultas, titulo, transcricao }) => {
    const gravado = Object.assign({}, ...dadosDasConsultas)
    const confere = (campo, esperado) => {
      if (gravado[campo] === esperado) passou++
      else falhas.push(`${titulo} | ${campo}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(gravado[campo])}`)
    }
    confere('intake_patient_name', 'Lucas Ferreira Campos')
    confere('intake_birth_date', '03/05/2022')
    confere('intake_guardian', 'Fernanda Oliveira Prado')
    if (!('intake_cpf' in gravado)) passou++
    else falhas.push(`${titulo} | gravou CPF: ${gravado.intake_cpf}`)
    if (!transcricao.join('\n').includes('CPF não confere')) passou++
    else falhas.push(`${titulo} | disse "CPF não confere" para "mando depois"`)
  },
})
await caso('Painel: data por extenso e nome em maiúsculas', [
  ['quero marcar', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['1', 'Horários de'],
  ['1', 'nome completo do paciente'],
  ['ANA CLARA DOS SANTOS', 'data de nascimento'],
  ['12 de março de 2020', 'nome do responsável'],
], {
  verificar: ({ dadosDasConsultas, titulo }) => {
    const gravado = Object.assign({}, ...dadosDasConsultas)
    if (gravado.intake_patient_name === 'Ana Clara dos Santos') passou++
    else falhas.push(`${titulo} | nome: ${gravado.intake_patient_name}`)
  },
})

// 3. Consulta no filho certo (OUTRA_CRIANCA, nome do filho, nome no comprovante).
await caso('Painel: "marcar mais uma" para outra criança não grava no nome da Ana', [
  ['Oi', 'Como podemos ajudar'],
  ['2', 'Você já tem uma consulta'],
  ['2', 'Para quem é a consulta'],
  ['Outra criança', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['1', 'Horários de'],
  ['1', 'nome completo do paciente'],
], {
  consultas: [CONSULTA_ANA],
  pacientes: [ANA],
  verificar: ({ marcadas, titulo }) => {
    if (marcadas.length === 1 && !marcadas[0].patient_id) passou++
    else falhas.push(`${titulo} | consulta gravada no paciente ${marcadas[0]?.patient_id}`)
  },
})
await caso('Painel: o filho pelo nome', [
  ['quero marcar', 'Para quem é a consulta'],
  ['pedro', 'Em qual unidade'],
], { pacientes: [ANA, PEDRO] })

// 4. Pedidos que se perdiam.
await caso('Painel: nota fiscal com a lista de unidades na tela', [
  ['Oi', 'Como podemos ajudar'],
  ['1', 'Para qual atendimento'],
  ['preciso da nota fiscal da consulta do mes passado pra mandar pro plano', 'nota fiscal'],
], { respostasProntas: RESPOSTAS })
await caso('Painel: "perdi a receita, segunda via" abre a 2ª via', [
  ['Oi', 'Como podemos ajudar'],
  ['Perdi a receita do omeprazol da Ana, tem como mandar segunda via?', 'receita'],
], {
  pacientes: [ANA],
  verificar: ({ ultimoToque, titulo, conversa }) => {
    if (!ultimoToque.resposta.includes('não posso orientar') && String(conversa.booking_state).startsWith('documento')) passou++
    else falhas.push(`${titulo} | não abriu a 2ª via: ${conversa.booking_state} · ${ultimoToque.resposta.slice(0, 80)}`)
  },
})
await caso('Painel: "daqui uns 40 dias" é retorno distante', [
  ['Oi', 'Como podemos ajudar'],
  ['o dr pediu pra voltar daqui uns 40 dias, consigo marcar ja?', ['Anotei seu pedido de retorno', 'novembro']],
], { pacientes: [ANA], agora: QUARTA_10H })
await caso('Painel: "e pro dia 25 de novembro?" na lista de dias', [
  ['quero marcar', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['e pro dia 25 de novembro?', 'Anotei seu pedido de retorno para *novembro*'],
], { agora: QUARTA_10H })

// 5. Laco de "Nao entendi", desistencia e despedida nas etapas.
await caso('Painel: terceiro "Não entendi" seguido chama a equipe', [
  ['quero marcar', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['xyz', 'Não entendi'],
  ['abc abc', 'Não entendi'],
  ['hmm hmm', 'Já chamei alguém da nossa equipe'],
])
await caso('Painel: desistir no meio da remarcação mantém a consulta', [
  ['Oi', 'Como podemos ajudar'],
  ['4', 'Sua consulta'],
  ['REMARCAR', 'Vamos remarcar'],
  ['SIM', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['ah nao, pensando bem deixa a que ja ta marcada', ['continua marcada', '01/09']],
], {
  consultas: [CONSULTA_ANA],
  pacientes: [ANA],
  verificar: ({ canceladas, conversa, titulo }) => {
    if (canceladas.length === 0 && !conversa.booking_state) passou++
    else falhas.push(`${titulo} | cancelou ${canceladas.length} ou ficou na etapa ${conversa.booking_state}`)
  },
})
await caso('Painel: "tá bom, obrigada!" na lista de unidades encerra', [
  ['quero marcar', 'Em qual unidade'],
  ['ta bom, obrigada!', 'não marquei nada'],
])

// Segunda rodada do painel (14/10/2026): desistencia clara vence data e hora
// escritas. Sem isso, "vou manter a do dia 01/09" abria os horarios, e "vou
// manter a das 8" trocava a consulta das 08:00 por ela mesma - cancelando a
// original.
for (const [titulo, ate, frase] of [
  ['na lista de dias', 1, 'deixa quieto, vou manter a do dia 01/09 mesmo'],
  ['na lista de horários', 2, 'nao, vou manter a das 8 mesmo'],
]) {
  await caso(`Painel 2: "${frase}" ${titulo} mantém a consulta`, [
    ['Oi', 'Como podemos ajudar'],
    ['4', 'Sua consulta'],
    ['REMARCAR', 'Vamos remarcar'],
    ['SIM', 'Em qual unidade'],
    ['1', 'Datas disponíveis'],
    ...(ate === 2 ? [['1', 'Horários de']] : []),
    [frase, ['Não mudei nada', 'continua marcada']],
  ], {
    consultas: [CONSULTA_ANA],
    pacientes: [ANA],
    verificar: ({ canceladas, marcadas, conversa, titulo }) => {
      if (canceladas.length === 0 && marcadas.length === 0 && !conversa.booking_state) passou++
      else falhas.push(`${titulo} | cancelou ${canceladas.length}, marcou ${marcadas.length}, etapa ${conversa.booking_state}`)
    },
  })
}
await caso('Painel 2: "pensando bem, prefiro 01/09" continua sendo troca de dia', [
  ['quero marcar', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['pensando bem, prefiro 01/09', 'Horários de'],
])
await caso('Painel 2: "nao agora nao precisa... obrigada" na lista de unidades encerra', [
  ['quero marcar', 'Em qual unidade'],
  ['nao agora nao precisa, so queria saber mesmo. obrigada', 'não marquei nada'],
])
await caso('Painel 2: "não precisa ser em Santos" não é desistência', [
  ['quero marcar', 'Em qual unidade'],
  ['nao precisa ser em santos', 'Não entendi'],
])
await caso('Painel 2: "inclui retorno em 30 dias?" é pergunta, não pedido de retorno', [
  ['Oi', 'Como podemos ajudar'],
  ['ah ta entao inclui retorno em 30 dias ne? nao vou pagar de novo?', ''],
], {
  pacientes: [ANA],
  agora: QUARTA_10H,
  verificar: ({ ultimoToque, titulo }) => {
    if (!/pedido de retorno/.test(ultimoToque.resposta ?? '')) passou++
    else falhas.push(`${titulo} | virou pedido de retorno: ${ultimoToque.resposta.slice(0, 80)}`)
  },
})
await caso('Painel 2: "quero marcar em São Paulo" com a lista de informações na tela', [
  ['Oi', 'Como podemos ajudar'],
  ['1', 'Para qual atendimento'],
  ['ENTAO QUERO MARCAR EM SAO PAULO PRO MEU NETO', 'Em qual unidade'],
])

// Lote de 15/10/2026: CPF depois, farmacia, receita e exame juntos.
const ANA_SEM_CPF = { ...ANA, cpf: null }
await caso('15/10: CPF mandado depois entra no cadastro', [
  ['529.982.247-25', 'Recebi o CPF de *Ana*'],
], {
  pacientes: [ANA_SEM_CPF],
  verificar: ({ fichas, titulo }) => {
    if (fichas.some((f) => f.id === 'p1' && f.cpf === '52998224725')) passou++
    else falhas.push(`${titulo} | CPF não gravado: ${JSON.stringify(fichas)}`)
  },
})
await caso('15/10: irmãos, CPF com o nome vai para quem foi citado', [
  ['segue o cpf do pedro 52998224725', 'Recebi o CPF de *Pedro*'],
], {
  pacientes: [ANA, PEDRO],
  verificar: ({ fichas, titulo }) => {
    if (fichas.length === 1 && fichas[0].id === 'p2') passou++
    else falhas.push(`${titulo} | gravou em ${JSON.stringify(fichas)}`)
  },
})
await caso('15/10: irmãos sem CPF e sem nome: não chuta', [
  ['52998224725', ''],
], {
  pacientes: [ANA_SEM_CPF, PEDRO],
  verificar: ({ fichas, ultimoToque, titulo }) => {
    if (fichas.length === 0 && !/Recebi o CPF/.test(ultimoToque.resposta)) passou++
    else falhas.push(`${titulo} | gravou sem saber de quem: ${JSON.stringify(fichas)}`)
  },
})
await caso('15/10: telefone de 11 dígitos não vira CPF', [
  ['13996274790', ''],
], {
  pacientes: [ANA_SEM_CPF],
  verificar: ({ fichas, titulo }) => {
    if (fichas.length === 0) passou++
    else falhas.push(`${titulo} | gravou telefone como CPF`)
  },
})
await caso('15/10: farmácia com o recado inteiro vai direto para a equipe', [
  ['Boa tarde, sou da Drogaria São Paulo, estou com uma receita do Dr. Marcello da paciente Tatiane e preciso confirmar a dosagem', ['Registrado', 'enviado ao paciente']],
], {
  primeiraMensagem: true,
  verificar: ({ ultimoToque, titulo }) => {
    if (ultimoToque.atencao === 'farmacia' && !ultimoToque.resposta.includes('não posso orientar')) passou++
    else falhas.push(`${titulo} | atencao ${ultimoToque.atencao}`)
  },
})
await caso('15/10: "sou da farmácia" pergunta o paciente e o que corrigir', [
  ['oi, sou da farmácia', 'nome do paciente'],
])
await caso('15/10: mãe "na farmácia" continua sendo mãe', [
  ['estou na farmacia e nao aceitaram a receita da Ana', ''],
], {
  pacientes: [ANA],
  verificar: ({ ultimoToque, titulo }) => {
    if (ultimoToque.atencao !== 'farmacia') passou++
    else falhas.push(`${titulo} | virou farmácia`)
  },
})
await caso('15/10: "preciso dos dois" registra receita e exame', [
  ['Oi', 'Como podemos ajudar'],
  ['5', 'O que você precisa'],
  ['na verdade preciso dos dois, a receita e o pedido do exame de sangue', 'Anoto os dois'],
  ['omeprazol', ['Anotei: *omeprazol*', 'Qual exame']],
  ['hemograma', 'A farmácia ou o laboratório pediu'],
  ['não', ['Pedido registrado', '2ª via de receita', 'omeprazol', 'Pedido de exame', 'hemograma']],
], { pacientes: [ANA] })
await caso('15/10: receita e exame já na primeira frase', [
  ['Oi', 'Como podemos ajudar'],
  ['Perdi a receita do omeprazol e o pedido do exame de sangue da Ana', 'Anoto os dois'],
], { pacientes: [ANA] })

// Exames pelo convenio (15/10/2026): "exame" de papel nao e assunto medico, e
// o assunto mais certeiro ganha mesmo com o Convenios cadastrado em quatro
// grafias.
const CONVENIOS_INFLADO = {
  id: 'r2', subject: 'Convênios',
  keywords: ['convenio', 'convênio', 'convenios', 'convênios', 'plano', 'planos', 'unimed', 'reembolso', 'carteirinha'],
  answer: 'O atendimento é particular. Emitimos recibo para reembolso.', is_active: true, position: 2,
}
const EXAMES_PELO_CONVENIO = {
  id: 'r9', subject: 'Exames pelo convênio',
  keywords: ['convenio', 'convênio', 'plano', 'unimed', 'exame', 'exames', 'solicitar', 'pedir', 'pede', 'pedido', 'guia', 'autorizar'],
  answer: 'Sim! O Dr. Marcello pode solicitar os exames pelo seu convênio.', is_active: true, position: 99,
}
const COM_EXAMES = [...RESPOSTAS.filter((r) => r.id !== 'r2'), CONVENIOS_INFLADO, EXAMES_PELO_CONVENIO]
// "a guia pode ser pelo convênio?": com a contagem antiga o Convenios fazia 4
// pontos so com "convenio" escrito em quatro grafias, e ganhava.
for (const frase of ['o dr pede exame pelo convênio?', 'o pedido de exames pode ser pelo convenio?', 'O dr consegue solicitar os exames pela Unimed?', 'a guia pode ser pelo convênio?']) {
  await caso(`15/10: "${frase}" responde exames pelo convênio`, [
    ['Oi', 'Como podemos ajudar'],
    [frase, 'pode solicitar os exames pelo seu convênio'],
  ], { respostasProntas: COM_EXAMES })
}
await caso('15/10: "aceita Unimed?" continua com a resposta de convênios', [
  ['Oi', 'Como podemos ajudar'],
  ['aceita Unimed?', 'Emitimos recibo para reembolso'],
], { respostasProntas: COM_EXAMES })
await caso('15/10: resultado de exame continua sendo de médico', [
  ['Oi', 'Como podemos ajudar'],
  ['o resultado do exame pelo convenio saiu, o dr pode ver?', 'não posso orientar'],
], { respostasProntas: COM_EXAMES })

// 6. Horario digitado.
await caso('Painel: "8h" marca as 08:00 direto', [
  ['quero marcar', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['1', 'Horários de'],
  ['8h', 'às 08:00* está guardado'],
])
await caso('Painel: "9 e 20" é 09:20', [
  ['quero marcar', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['1', 'Horários de'],
  ['tem 9 e 20?', 'às 09:20* está guardado'],
])
await caso('Painel: "o mais cedo que tiver" escolhe o primeiro dia', [
  ['quero marcar', 'Em qual unidade'],
  ['1', 'Datas disponíveis'],
  ['qualquer dia, o mais cedo que tiver', 'Horários de segunda, 31/08'],
])

// 7. Sintoma com o consultorio fechado traz o pronto-socorro.
await caso('Painel: sintoma à noite traz pronto-socorro e 192', [
  ['meu filho ta vomitando desde a tarde e com febre, posso dar dipirona?', ['não posso orientar', 'pronto-socorro', '192']],
], { agora: SEXTA_23H, primeiraMensagem: true })
await caso('Painel: sintoma no horário não fala em pronto-socorro', [
  ['meu filho ta vomitando desde a tarde e com febre, posso dar dipirona?', 'não posso orientar'],
], {
  agora: QUARTA_10H,
  primeiraMensagem: true,
  verificar: ({ ultimoToque, titulo }) => {
    if (!ultimoToque.resposta.includes('pronto-socorro')) passou++
    else falhas.push(`${titulo} | falou em pronto-socorro em horário de atendimento`)
  },
})

// ---------------------------------------------------------------
// Repeticao e despedida (Viviane, 14/10/2026)
// ---------------------------------------------------------------
// PARA PROVAR: em atendimento.ts, faca jaMandada devolver sempre false, ou
// tire as chamadas a despedida(). Os casos abaixo falham.

await caso('Viviane: despedida na fila não repete convênios nem oferece a agenda', [
  ['Oi', 'Como podemos ajudar'],
  ['9', 'direcionando você'],
  ['Queria saber se atende o convênio da Petrobrás', ['particular', 'continua na fila']],
  ['Ok obrigada vou tentar achar um pelo convênio, se não conseguir, volto pra marcar uma consulta', 'Combinado'],
], {
  respostasProntas: RESPOSTAS,
  verificar: ({ ultimoToque, titulo }) => {
    if (/particular|Marcar uma consulta/.test(ultimoToque.resposta)) falhas.push(`${titulo} | repetiu: ${ultimoToque.resposta.slice(0, 80)}`)
    else passou++
  },
})

await caso('Na fila, a mesma resposta pronta não sai duas vezes', [
  ['Oi', 'Como podemos ajudar'],
  ['3', 'direcionando você'],
  ['Vocês atendem convênio?', 'continua na fila'],
  ['e convênio da Unimed?', null],
], { respostasProntas: RESPOSTAS })

await caso('Sem fila, a pergunta repetida aponta para a resposta de cima', [
  ['Oi', 'Como podemos ajudar'],
  ['Qual o valor?', 'R$ 450,00'],
  ['quanto custa a consulta?', 'logo acima'],
], {
  respostasProntas: RESPOSTAS,
  verificar: ({ ultimoToque, titulo }) => {
    if (ultimoToque.resposta.includes('R$ 450,00')) falhas.push(`${titulo} | repetiu o texto inteiro`)
    else passou++
  },
})

await caso('Despedida com o menu na tela recebe resposta curta', [
  ['Oi', 'Como podemos ajudar'],
  ['Ok, obrigada! Vou conversar com o pai dele e volto pra marcar', 'Combinado'],
], { respostasProntas: RESPOSTAS })

// Pergunta nao e despedida, mesmo com "vou ver".
for (const [frase, esperado] of [
  ['Ok obrigada vou tentar achar um pelo convênio, se não conseguir, volto pra marcar uma consulta', true],
  ['Obrigada, depois eu volto', true],
  ['vou ver com meu marido e te falo, obrigada', true],
  ['Obrigada! Vou marcar agora', false],
  ['ok, vou tentar. Qual o valor?', false],
  ['volto pra marcar', false],
]) {
  if (despedida(frase) === esperado) passou++
  else falhas.push(`despedida("${frase}") deveria ser ${esperado}`)
}

// Texto antigo, com o valor escrito a mao: igual a antes, sem ler valor nenhum.
await caso('Campos: texto sem campo continua exatamente igual', [
  ['Oi', 'Como podemos ajudar'],
  ['1', 'Para qual atendimento'],
  ['3', '*Consulta em São Paulo: R$ 550,00.*'],
], {
  unidades: [TRES_UNIDADES[0], TRES_UNIDADES[1], { ...TRES_UNIDADES[2], info_text: '*Consulta em São Paulo: R$ 550,00.*' }],
  colunasAusentes: ['price_cents'],
})

console.log('\n============================================')
console.log(`VERIFICAÇÕES QUE PASSARAM: ${passou}`)
console.log(`FALHAS: ${falhas.length}`)
console.log('============================================')
for (const f of falhas) console.log('\n✗ ' + f)

console.log('\n\n===== PONTOS PARA OLHAR =====')
for (const a of achados) console.log('\n' + a)

// Ate 25/09/2026 este arquivo imprimia "FALHAS: 4" e saia com codigo 0 - o
// npm run test:bot seguia verde e o PUBLICAR subiria o robo quebrado. Teste
// que falha calado e o mesmo defeito que ele existe para pegar.
if (falhas.length) process.exit(1)
