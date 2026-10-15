import { supabase } from '@/lib/supabase'
import type { Consultation, Patient } from '@/types/patient'

/**
 * Prescricao digital da Memed dentro do prontuario.
 *
 * A Memed nao e um iframe que a gente desenha: e um script que ela carrega na
 * pagina e comanda por eventos. Este arquivo isola essa conversa - o resto do
 * sistema so pede "abrir a prescricao deste paciente" e recebe de volta a
 * receita emitida.
 *
 * Vive fora do React de proposito. O script da Memed e global, carrega uma vez
 * por sessao e sobrevive a qualquer componente; tentar amarrar isso ao ciclo de
 * vida de uma tela produziria dois scripts carregados e eventos duplicados.
 */

const URL_SCRIPT_HOMOLOGACAO =
  'https://integrations.memed.com.br/modulos/plataforma.sinapse-prescricao/build/sinapse-prescricao.min.js'
// Producao: MESMO caminho da homologacao, so muda o dominio.
//
// Ate 16/09/2026 aqui estava 'https://partners.memed.com.br/integration.js',
// tirado de um guia de boas praticas. Esse arquivo nao existe: no primeiro
// teste com as chaves de producao o script falhou em silencio, e o botao
// "Prescrever" ficou girando para sempre esperando algo que nunca chegava.
// Conferido no ar: este endereco responde 200 com a versao 3.25.0; o outro
// nao responde.
const URL_SCRIPT_PRODUCAO =
  'https://partners.memed.com.br/modulos/plataforma.sinapse-prescricao/build/sinapse-prescricao.min.js'
// Id fixo exigido pela homologacao da Memed: e por ele que se garante que o
// script entrou uma unica vez na pagina.
const ID_SCRIPT = 'memed-prescricao-script'

/** Os objetos que a Memed pendura no window quando o script carrega. */
type MemedGlobal = {
  MdSinapsePrescricao?: {
    event: { add: (nome: string, callback: (dados: unknown) => void) => void }
  }
  MdHub?: {
    command: { send: (modulo: string, comando: string, dados: unknown) => Promise<unknown> }
    module: { show: (modulo: string) => Promise<unknown>; hide?: (modulo: string) => void }
    event: { add: (nome: string, callback: (dados: unknown) => void) => void }
  }
}

function janela() {
  return window as unknown as MemedGlobal
}

export type ReceitaEmitida = {
  id: string
  itens: number
}

type Ouvintes = {
  onReceita?: (dados: unknown) => void
  onExcluida?: (id: string) => void
  onFechar?: () => void
}

let carregando: Promise<void> | null = null
const ouvintes: Ouvintes = {}

/**
 * Devolve a rolagem da pagina depois que a Memed fecha.
 *
 * Relatado em 21/09/2026: prescrever e voltar para a lista de pacientes
 * deixava a tela travada - a roda do mouse nao descia mais, e so recarregando
 * voltava ao normal. Conferido no navegador do consultorio: o <body> ficava
 * com style="overflow: hidden" inline, e todos os iframes da Memed ja estavam
 * display:none. Ou seja, nada estava aberto; so a trava tinha ficado.
 *
 * E a trava que qualquer modal poe para a pagina de tras nao rolar junto. A
 * Memed poe ao abrir e nao tira em todos os caminhos de saida.
 *
 * Limpar aqui e seguro porque ESTE sistema nunca mexe em body.style.overflow -
 * conferido no codigo inteiro. Qualquer valor inline ali e da Memed.
 */
function destravarRolagem() {
  document.body.style.removeProperty('overflow')
  document.body.style.removeProperty('overflow-y')
  document.body.style.removeProperty('position')
  document.documentElement.style.removeProperty('overflow')
  document.documentElement.style.removeProperty('overflow-y')
}

/** Algum modulo da Memed esta aberto na tela neste momento? */
function memedNaTela(): boolean {
  return [...document.querySelectorAll('iframe[id^="mdhub-module-"]')].some(
    (quadro) => getComputedStyle(quadro).display !== 'none',
  )
}

/**
 * Rede de seguranca para a trava de rolagem.
 *
 * Os dois ganchos de evento cobrem os caminhos de saida que a Memed anuncia.
 * Este observador cobre os que ela nao anuncia: se o <body> ganhar overflow
 * escondido SEM nenhum modulo visivel, a trava e resto de algo que ja fechou, e
 * cai fora na hora.
 *
 * So dispara quando o atributo style do body muda, entao nao custa nada
 * enquanto ninguem prescreve. E a checagem de modulo visivel e o que impede
 * este codigo de brigar com uma trava legitima: com a Memed aberta na frente,
 * a pagina de tras DEVE ficar presa.
 */
let vigia: MutationObserver | null = null

function vigiarTravaDeRolagem() {
  if (vigia) return
  vigia = new MutationObserver(() => {
    if (!document.body.style.overflow) return
    if (memedNaTela()) return
    destravarRolagem()
  })
  vigia.observe(document.body, { attributes: true, attributeFilter: ['style'] })
}

/**
 * Carrega o script uma unica vez.
 *
 * A promessa fica guardada para que dois cliques seguidos no botao nao
 * disparem dois carregamentos - o segundo espera o primeiro em vez de criar um
 * script paralelo, que e a origem classica de evento chegando em dobro.
 */
async function carregarScript(token: string, producao: boolean) {
  if (carregando) return carregando
  // Guarda exigida pela Memed: se o script ja esta na pagina (por exemplo,
  // depois de um hot reload), nao entra de novo.
  if (document.getElementById(ID_SCRIPT) && janela().MdHub) return Promise.resolve()

  carregando = new Promise<void>((resolve, reject) => {
    // Guardado fora dos dois fechamentos para o prazo tambem conseguir parar a
    // espera: sem isso, um carregamento que falhou continuaria perguntando pelo
    // MdHub a cada 200ms para sempre.
    let espera = 0
    // Prazo para o script se anunciar.
    //
    // A promessa só termina dentro do evento 'core:moduleInit' da Memed. Se
    // esse evento não vier - script inexistente, rede caída, mudança do lado
    // deles -, o botão gira para sempre e ninguém sabe por quê. Foi o que
    // aconteceu em 16/09/2026, com o endereço errado do script de produção.
    // Quarenta segundos, e não vinte: desde 21/09/2026 a espera inclui os
    // módulos da Memed, não só o script dela. Medido a frio, script e módulos
    // levaram uns 16 s juntos; vinte ficava perto demais do limite num dia de
    // rede lenta. Como isto roda no login, e não no clique, o prazo maior não
    // custa espera para ninguém - só evita desistir de um carregamento que ia
    // terminar.
    const prazo = window.setTimeout(() => {
      window.clearInterval(espera)
      carregando = null
      reject(new Error('A Memed não respondeu a tempo. Tente de novo em instantes.'))
    }, 40_000)
    const pronto = () => {
      window.clearTimeout(prazo)
      resolve()
    }
    const falhou = (causa: Error) => {
      window.clearTimeout(prazo)
      window.clearInterval(espera)
      carregando = null
      reject(causa)
    }

    const script = document.createElement('script')
    script.id = ID_SCRIPT
    script.src = producao ? URL_SCRIPT_PRODUCAO : URL_SCRIPT_HOMOLOGACAO
    script.dataset.token = token
    script.async = true

    script.onload = () => {
      const memed = janela()
      if (!memed.MdSinapsePrescricao) {
        falhou(new Error('A Memed carregou mas não se anunciou.'))
        return
      }

      // Fechamento do modulo e evento do MdSinapsePrescricao, nao do MdHub.
      memed.MdSinapsePrescricao.event.add('core:moduleHide', (modulo) => {
        const dados = modulo as { moduleName?: string; name?: string }
        const nome = dados?.moduleName ?? dados?.name

        // A rolagem volta a QUALQUER modulo que feche, e nao so ao da
        // prescricao. A Memed tem dezesseis modulos (preview, assinatura,
        // alerta, medicamento...) e qualquer um deles pode ter sido o ultimo a
        // sair; se a gente so destravasse no nome certo, bastaria o medico
        // fechar pela previa para a tela continuar presa. Destravar duas vezes
        // nao custa nada; deixar preso custa uma recarga.
        destravarRolagem()

        if (nome && nome !== 'plataforma.prescricao') return
        ouvintes.onFechar?.()
      })

      // Espera o MdHub existir, e nao um evento com um nome especifico.
      //
      // Ate 16/09/2026 a promessa so terminava dentro do evento
      // 'core:moduleInit' quando o modulo se chamasse 'plataforma.prescricao'.
      // Isso funcionava em homologacao e travou no primeiro teste em producao:
      // o console mostrava "Todos os modulos da plataforma foram carregados com
      // sucesso", o MdHub existia, a prescricao abria quando chamada a mao - e
      // o botao girava para sempre, porque o evento nunca casou com a condicao.
      //
      // Perguntar "o MdHub ja existe?" nao depende do nome nem do formato do
      // evento, que sao deles e mudam sem aviso. O que a gente precisa saber e
      // exatamente isso: da para mandar comando.
      //
      // Os ouvintes de receita sao registrados aqui, uma vez so. Registrar a
      // cada abertura acumularia callbacks e salvaria a mesma receita varias
      // vezes.
      // 60ms, e não 200: como isto agora roda antes do clique, o custo de
      // perguntar com mais frequência é invisível, e a diferença aparece
      // inteira no caso em que o médico clica logo que abre o prontuário.
      let ouvintesRegistrados = false
      espera = window.setInterval(() => {
        const hub = janela().MdHub
        if (!hub) return

        if (!ouvintesRegistrados) {
          ouvintesRegistrados = true
          // Destrava tambem ao emitir: em alguns caminhos a Memed fecha sozinha
          // depois de imprimir, e o moduleHide correspondente nem sempre chega.
          hub.event.add('prescricaoImpressa', (receita) => {
            destravarRolagem()
            ouvintes.onReceita?.(receita)
          })

          // Liga a rede de seguranca so depois que a Memed existe: antes disso
          // nao ha o que vigiar.
          vigiarTravaDeRolagem()
          hub.event.add('prescricaoExcluida', (dados) => {
            const excluida = dados as { id?: string | number }
            if (excluida?.id !== undefined) ouvintes.onExcluida?.(String(excluida.id))
          })
        }

        // O MdHub existir NAO quer dizer que da para mandar comando.
        //
        // Medido em 21/09/2026, primeira abertura do dia: o hub apareceu, o
        // setFeatureToggle foi mandado na hora, e esperou 8 segundos ate
        // desistir - o modulo da prescricao ainda estava baixando. A linha
        // "Todos os modulos foram carregados" so apareceu no console DEPOIS
        // do comando falhar. Oito segundos de espera por perguntar cedo.
        //
        // O sinal certo e o iframe do modulo estar na pagina: e o proprio
        // MdHub que o cria, quando o modulo termina de carregar. DOM, e nao
        // nome de evento - pelo mesmo motivo da espera pelo hub, logo acima.
        if (!document.getElementById('mdhub-module-plataforma.prescricao')) return

        window.clearInterval(espera)
        pronto()
      }, 60)
    }

    script.onerror = () => {
      falhou(new Error('Não foi possível carregar a prescrição da Memed.'))
    }

    document.body.appendChild(script)
  })

  return carregando
}

/** Busca o token do medico. As chaves da Memed ficam no servidor, nunca aqui. */
async function tokenDoPrescritor() {
  const { data, error } = await supabase.functions.invoke('memed-prescritor', { body: {} })
  if (error) {
    const contexto = (error as { context?: unknown }).context
    if (contexto instanceof Response) {
      try {
        const corpo = await contexto.clone().json()
        if (corpo?.error) throw new Error(String(corpo.error))
      } catch (lido) {
        if (lido instanceof Error && lido.message) throw lido
      }
    }
    throw new Error('Não foi possível conectar à Memed.')
  }
  // O ambiente vem do servidor, que e quem tem as chaves: assim a tela nunca
  // carrega o script de producao com token de homologacao, nem o contrario.
  const resposta = data as {
    token: string
    ambiente?: string
    cadastro?: { feito: boolean; detalhe?: string }
  }
  return { token: resposta.token, producao: resposta.ambiente === 'producao', cadastro: resposta.cadastro }
}

/** Resultado da ultima tentativa de completar o cadastro do medico na Memed. */
export let ultimoCadastro: { feito: boolean; detalhe?: string } | undefined

/**
 * O que a Memed precisa saber sobre o paciente.
 *
 * O CPF vai porque a RDC 1000/25 passou a exigi-lo em toda prescricao, e a data
 * de nascimento pelo mesmo motivo. Sao os dois campos que fazem a emissao ser
 * recusada quando faltam - por isso a checagem acontece antes de abrir a tela,
 * e nao depois de o medico escrever a receita inteira.
 */
export function faltaParaPrescrever(patient: Patient): string[] {
  const falta: string[] = []
  if (!patient.cpf?.trim()) falta.push('CPF')
  if (!patient.nascimento) falta.push('data de nascimento')
  return falta
}

function dataBR(iso: string) {
  const [ano, mes, dia] = iso.slice(0, 10).split('-')
  return `${dia}/${mes}/${ano}`
}

const SEXO: Record<string, string> = { F: 'Feminino', M: 'Masculino', O: 'Outro' }

/**
 * Resultado da traducao das alergias do prontuario para a Memed.
 *
 * falhou = nao deu para perguntar a Memed (fora do ar, lenta). A receita abre
 * mesmo assim, mas o medico precisa saber que o alerta de alergia NAO esta
 * ligado desta vez.
 */
export type AlergiasNaMemed = {
  semAlergia: boolean
  reconhecidas: { termo: string; id: number; nome: string }[]
  naoReconhecidas: string[]
  falhas: string[]
  falhou?: boolean
}

/**
 * Pergunta ao servidor quais principios ativos da Memed correspondem ao que
 * esta escrito no campo de alergias. O de/para fica no servidor porque a busca
 * usa as chaves da Memed (ver memed-prescritor).
 *
 * Nunca lanca e nunca demora mais de 6 segundos: alergia nao pode ser o motivo
 * de a receita nao abrir.
 */
export async function alergiasParaMemed(texto: string): Promise<AlergiasNaMemed> {
  const vazio: AlergiasNaMemed = { semAlergia: false, reconhecidas: [], naoReconhecidas: [], falhas: [] }
  if (!texto.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').trim()) return vazio
  try {
    const resposta = await Promise.race([
      supabase.functions.invoke('memed-prescritor', { body: { acao: 'alergias', texto } }),
      new Promise<never>((_, rejeitar) => window.setTimeout(() => rejeitar(new Error('sem resposta')), 6000)),
    ])
    if (resposta.error || !resposta.data) throw resposta.error ?? new Error('resposta vazia')
    const dados = resposta.data as AlergiasNaMemed
    return {
      semAlergia: Boolean(dados.semAlergia),
      reconhecidas: dados.reconhecidas ?? [],
      naoReconhecidas: dados.naoReconhecidas ?? [],
      falhas: dados.falhas ?? [],
    }
  } catch (causa) {
    console.warn('[Memed] nao consegui traduzir as alergias', causa)
    return { ...vazio, falhou: true }
  }
}

/**
 * O que vai para a Memed alem do cadastro: alergias ja traduzidas em ids, e
 * peso e altura que podem ter vindo de uma consulta anterior (ver
 * dados-para-memed.ts). Sem isto, vale o que estiver na consulta aberta.
 */
export type ExtrasDaPrescricao = {
  peso?: string
  altura?: string
  alergiaIds?: number[]
}

export type LocalDeAtendimento = {
  nome: string
  endereco?: string
  telefone?: string
  cidade?: string
  /** Cadastro Nacional de Estabelecimentos de Saúde desta unidade. */
  cnes?: string
}

/**
 * A cidade dentro do nome da unidade.
 *
 * As unidades são cadastradas como "Liferty · Santos" e "Livance Ibirapuera ·
 * São Paulo": o que vem depois do separador é a cidade. Só aceita "·" e " - "
 * com espaços dos dois lados, para não partir um nome como "Santa-Cecília" no
 * meio. Sem separador, devolve nada e a Memed usa a cidade do cadastro.
 */
function cidadeDoNome(nome: string): string | undefined {
  const separador = nome.includes('·') ? '·' : nome.includes(' - ') ? ' - ' : null
  if (!separador) return undefined
  return nome.split(separador).pop()?.trim() || undefined
}

/**
 * Manda um comando para a Memed sem deixar a tela presa nele.
 *
 * Os comandos devolvem promessa, e promessa que nunca termina trava o botao
 * para sempre - foi o que aconteceu nos testes de producao de 16/09/2026, com
 * a Memed carregada e visivel no console, e o "Prescrever" girando. Oito
 * segundos e muito mais do que qualquer um deles leva.
 *
 * Nunca lanca: um comando recusado vira aviso no console e a prescricao segue.
 * Preferir abrir a tela com um campo em branco a nao abrir tela nenhuma.
 */
async function comando(
  hub: NonNullable<MemedGlobal['MdHub']>,
  passo: string,
  dados: unknown,
  prazo = 8000,
) {
  const inicio = performance.now()
  try {
    await Promise.race([
      hub.command.send('plataforma.prescricao', passo, dados),
      new Promise((_, rejeitar) =>
        window.setTimeout(() => rejeitar(new Error('sem resposta')), prazo),
      ),
    ])
    medir(passo, inicio)
    return true
  } catch (causa) {
    medir(`${passo} (falhou)`, inicio)
    console.warn(`[Memed] ${passo} não respondeu`, causa)
    return false
  }
}

/**
 * Quanto cada etapa do clique em Prescrever demora, no console.
 *
 * Existe para responder a uma pergunta feita em 21/09/2026: "da para abrir
 * mais rapido?". A resposta honesta era "nao sei onde o tempo vai". O script
 * ja carrega antes do clique; o que sobra sao tres comandos e o show da tela,
 * e sem numero nao da para saber se vale mexer nos comandos ou se e tudo o
 * show, que e da Memed e nao temos como acelerar.
 *
 * Fica no console, e nao numa tela, porque e para o desenvolvedor ler uma
 * vez e decidir. Quando a decisao estiver tomada, isto pode sair.
 */
function medir(etapa: string, inicio: number) {
  console.info(`[Memed] ${etapa}: ${Math.round(performance.now() - inicio)} ms`)
}

/**
 * O trabalho pesado, feito ANTES de alguém clicar em Prescrever.
 *
 * Abrir a prescrição custava a soma de três esperas em série, todas depois do
 * clique: a função do servidor buscando o token (que por sua vez consulta a
 * Memed), o download do script deles, e o módulo subindo até aceitar comando.
 * O médico ficava olhando o botão girar por isso.
 *
 * Nada disso depende do paciente, e nada disso precisa acontecer naquele
 * momento. Chamando esta função quando o prontuário abre, a espera acontece
 * enquanto ele lê a ficha - e o clique fica só com o que é do paciente.
 *
 * Roda UMA VEZ por sessão. O script da Memed é global e carrega uma vez só de
 * qualquer jeito, e o token vai grudado nele; então preparar no primeiro
 * prontuário do dia serve para todos os outros, sem repetir chamada à Memed.
 *
 * Falha não incomoda ninguém: a promessa é descartada e a próxima tentativa
 * acontece no clique, do jeito antigo, com o erro aparecendo aí sim na tela.
 */
let preparacao: Promise<{ token: string; producao: boolean; cadastro?: { feito: boolean; detalhe?: string } }> | null = null

export function prepararPrescricao() {
  if (!preparacao) {
    preparacao = (async () => {
      const dados = await tokenDoPrescritor()
      await carregarScript(dados.token, dados.producao)

      // So o VIDaaS na lista de certificadoras: e o certificado que o medico
      // ja usa para assinar o prontuario. Sem isto a Memed oferece sete opcoes
      // e a pessoa tem de saber qual e a sua.
      //
      // Fica aqui, e nao no clique, porque nao depende de paciente nem de
      // unidade - e uma vez por sessao basta. Ate 21/09/2026 era o primeiro
      // comando do clique, e a frio custou 8 segundos (ver carregarScript).
      const hub = janela().MdHub
      if (hub) await comando(hub, 'setFeatureToggle', { setAllowedSignatureProviders: ['vidaas'] })

      return dados
    })()
    preparacao.catch(() => {
      preparacao = null
    })
  }
  return preparacao
}

/**
 * Abre a prescricao com o paciente ja preenchido.
 *
 * Devolve se as alergias chegaram a Memed: null quando nao havia o que mandar,
 * false quando o comando foi recusado. A tela avisa o medico nos dois ultimos
 * casos que importam - alerta que ele acha que esta ligado e nao esta e pior do
 * que alerta nenhum.
 */
export async function abrirPrescricao(
  patient: Patient,
  consultation: Consultation | null,
  ouvir: Ouvintes,
  local?: LocalDeAtendimento | null,
  extras?: ExtrasDaPrescricao,
): Promise<{ alergiasEnviadas: boolean | null }> {
  const inicioDoClique = performance.now()

  // Se o prontuário já preparou, isto retorna na hora.
  const { cadastro } = await prepararPrescricao()
  ultimoCadastro = cadastro
  // Se isto der mais que uns poucos ms, o aquecimento do prontuario nao
  // aconteceu, e o medico esperou o download do script no clique.
  medir('preparação (token + script)', inicioDoClique)

  ouvintes.onReceita = ouvir.onReceita
  ouvintes.onExcluida = ouvir.onExcluida
  ouvintes.onFechar = ouvir.onFechar

  const hub = janela().MdHub
  if (!hub) throw new Error('A prescrição da Memed não está pronta.')

  // setFeatureToggle ja foi no aquecimento (prepararPrescricao). Daqui para
  // baixo so o que depende deste paciente e desta unidade.

  const peso = extras?.peso ?? consultation?.peso ?? ''
  const altura = extras?.altura ?? consultation?.altura ?? ''
  const alturaEmCm = numeroOuNada(altura)

  // O local de atendimento: endereco, cidade e telefone que a Memed imprime na
  // receita e cobra na tela de Identificacao desde que a Anvisa passou a exigi-los.
  //
  // OS NOMES DOS CAMPOS SAO DELES, EM INGLES, E NAO PODEM SER TRADUZIDOS.
  // Ate 16/09/2026 mandavamos id/nome/endereco/telefone/cidade/uf. A Memed nao
  // reclama de campo que nao conhece - ela ignora. Resultado: mandavamos tudo
  // certo e chegava nada, a tela de Identificacao abria com endereco, cidade e
  // telefone em branco, e o medico preenchia a mao a cada receita. Os nomes
  // certos, documentados em setWorkplace, sao: city, state, cnes, local_name,
  // address, phone.
  //
  // Vai ANTES do paciente, na ordem que a Memed documenta. Se ela recusar, a
  // receita ainda sai - local e cabecalho, nao e a prescricao.
  const nomeDoLocal = local?.nome ?? consultation?.unidade
  if (nomeDoLocal) {
    await comando(hub, 'setWorkplace', {
      local_name: nomeDoLocal,
      address: local?.endereco || undefined,
      city: local?.cidade || cidadeDoNome(nomeDoLocal),
      state: 'SP',
      phone: local?.telefone || undefined,
      // Obrigatorio para quem integra a partir de agora, e a clinica ainda vai
      // levantar o numero de cada unidade. Enquanto nao houver, nao se manda o
      // campo vazio: valor em branco e pior do que ausencia.
      ...(local?.cnes ? { cnes: local.cnes } : {}),
    })
  }

  await comando(hub, 'setPaciente', {
    // Prefixo do parceiro, como a Memed pede: o id sozinho colidiria com o
    // de outros sistemas no ambiente compartilhado de homologacao.
    idExterno: `central-de-cuidado-${patient.id}`,
    nome: patient.nome,
    sexo: SEXO[patient.sexo] ?? 'Outro',
    cpf: patient.cpf?.replace(/\D/g, '') || undefined,
    data_nascimento: patient.nascimento ? dataBR(patient.nascimento) : undefined,
    telefone: patient.telefone?.replace(/\D/g, '') || undefined,
    email: patient.email || undefined,
    nome_mae: patient.responsavel || undefined,
    peso: numeroOuNada(peso),
    // O prontuario guarda centimetros; a Memed quer metros.
    altura: alturaEmCm ? alturaEmCm / 100 : undefined,
    cidade: patient.cidade || undefined,
  })

  // Alergias DEPOIS do paciente: o setAllergy vale para o paciente que esta
  // definido naquele momento (e assim no exemplo da Memed). Lista vazia nao e
  // enviada - nao sabemos se a Memed trataria como "apagar as que o medico
  // cadastrou direto la", e na duvida o alerta que ja existe fica.
  const ids = extras?.alergiaIds ?? []
  const alergiasEnviadas = ids.length ? await comando(hub, 'setAllergy', ids) : null

  // A tela abre mesmo que algum comando acima tenha falhado: com o paciente em
  // branco o medico digita o nome e prescreve; com o botao girando, ele nao faz
  // nada.
  const inicioDoShow = performance.now()
  await Promise.race([
    hub.module.show('plataforma.prescricao'),
    new Promise((resolver) => window.setTimeout(resolver, 8000)),
  ])
  medir('show da tela', inicioDoShow)
  medir('TOTAL do clique ao abrir', inicioDoClique)
  return { alergiasEnviadas }
}

/**
 * "7,5" -> 7.5, "12 kg" -> 12; vazio ou texto sem numero -> nada. Ate
 * 24/09/2026 era Number(), que da NaN para "12 kg" - e NaN no setPaciente e o
 * tipo de valor que pode fazer a Memed recusar o paciente inteiro, abrindo a
 * receita em branco.
 */
function numeroOuNada(valor: string): number | undefined {
  const numero = parseFloat(String(valor ?? '').trim().replace(',', '.'))
  return Number.isFinite(numero) && numero > 0 ? numero : undefined
}

/** Arquiva no prontuario a receita que a Memed devolveu. */
export async function guardarReceita(
  patientId: string,
  consultationId: string | null,
  receita: unknown,
) {
  const pacote = receita as { prescricao?: Record<string, unknown> }
  const prescricao = pacote?.prescricao ?? (receita as Record<string, unknown>)

  const { error } = await supabase.functions.invoke('memed-receita', {
    body: { patientId, consultationId, prescricao },
  })
  if (error) throw new Error('A receita foi emitida, mas não pôde ser arquivada no prontuário.')
}

export async function marcarReceitaExcluida(memedId: string) {
  await supabase.functions.invoke('memed-receita', { body: { excluir: memedId } })
}
