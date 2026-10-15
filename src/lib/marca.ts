import logoDrFabio from '@/assets/fabio-logo-transparente.png'
import logoCentral from '@/assets/logo-central-de-cuidado.webp'
import { CLINICA_DR_FABIO } from '../../supabase/functions/_shared/quem-atende.ts'

/**
 * O logo do menu, por clinica (27/09/2026).
 *
 * Ate aqui o menu mostrava o logo do Dr. Marcello para toda clinica - inclusive
 * a de teste, que e a que aparece nas demonstracoes para outros medicos. A
 * marca do produto e "Central de Cuidado"; so a clinica do Dr. Marcello tem
 * marca propria. Clinica nova entra com a marca do produto sem precisar de
 * nada aqui.
 *
 * Os dois arquivos sao desenhados em uma cor so: o menu pinta de branco
 * (brightness-0 invert), entao qualquer cor vira silhueta branca.
 *
 * Espelho do Dr. Fabio Dario (15/10/2026): a marca propria aqui e a dele, e e
 * ela que fica no login e na impressao. O logo veio do site dele em fundo
 * preto; fabio-logo-transparente.png e o mesmo desenho com o preto virado
 * transparencia, porque o menu so enxerga o contorno (o branco por cima do
 * preto viraria um retangulo branco).
 */
export type Marca = {
  src: string
  nome: string
  mostraEtiquetaDoProduto: boolean
  /** Titulo da aba do navegador. */
  titulo: string
  /**
   * Nome no rodape do menu, ao lado do botao de sair. Nulo = nome de quem
   * entrou. Ate 27/09/2026 era "Dr. Marcello Ruiz" fixo, e aparecia assim na
   * conta de teste mostrada a outros medicos.
   */
  nomeNoRodape: string | null
  /**
   * Como o consultorio se apresenta nos modelos da Meta, para as previas da
   * tela baterem com o que a familia recebe. Cada clinica tem os modelos
   * dela; os da clinica de teste nao citam o Dr. Marcello (27/09/2026).
   */
  quemEntraEmContato: string
  consultorioNaResposta: string
  /**
   * O acompanhamento desta clinica ja e o v2 (03/10/2026): fala com os pais e
   * pergunta pela crianca pelo primeiro nome. Ver acompanhamento_pos_consulta_v2
   * em supabase/functions/_shared/modelos.ts. A clinica de teste segue com o
   * modelo antigo (demo_acompanhamento) ate ganhar o dela.
   */
  acompanhamentoV2: boolean
}

const DR_FABIO: Marca = {
  src: logoDrFabio,
  nome: 'Dr. Fábio Dario',
  // A etiqueta "Central de cuidado" embaixo do logo diz de que sistema se
  // trata. Com o logo do produto, ela so repetiria o nome.
  mostraEtiquetaDoProduto: true,
  titulo: 'Central de Cuidado | Dr. Fábio Dario',
  nomeNoRodape: 'Dr. Fábio Dario',
  quemEntraEmContato: 'O consultório do Dr. Fábio Dario',
  consultorioNaResposta: 'o consultório do Dr. Fábio Dario',
  // O v2 e o modelo pediatrico (pergunta pela crianca). O Dr. Fabio fica no
  // modelo antigo ate ter os modelos dele aprovados na Meta.
  acompanhamentoV2: false,
}

const CENTRAL: Marca = {
  src: logoCentral,
  nome: 'Central de Cuidado',
  mostraEtiquetaDoProduto: false,
  titulo: 'Central de Cuidado',
  nomeNoRodape: null,
  quemEntraEmContato: 'O Consultório Central de Cuidado',
  consultorioNaResposta: 'o Consultório Central de Cuidado',
  acompanhamentoV2: false,
}

const CLINICAS_COM_MARCA_PROPRIA: Record<string, Marca> = {
  [CLINICA_DR_FABIO]: DR_FABIO, // Consultorio Dr. Fabio Dario
}

export function marcaDaClinica(clinicId: string | null | undefined): Marca {
  return (clinicId && CLINICAS_COM_MARCA_PROPRIA[clinicId]) || CENTRAL
}

/**
 * Para as telas que nao sabem a clinica: login, troca de senha e o prontuario
 * impresso. Usa a ultima clinica vista neste navegador; sem ela, fica o logo do
 * Dr. Fabio, a clinica deste sistema - a que mais imprime e mais entra, e nao
 * pode ganhar outro logo por um armazenamento bloqueado.
 */
export function marcaSemClinicaConhecida(clinicId?: string | null): Marca {
  const id = clinicId ?? ultimaClinicaVista()
  return id ? marcaDaClinica(id) : DR_FABIO
}

/**
 * Ultima clinica vista neste navegador. Sem isso, o menu abriria vazio ate a
 * consulta da clinica voltar, a cada recarga. Guardar so o id e inofensivo; se
 * o armazenamento estiver bloqueado, o menu apenas espera a consulta.
 */
const CHAVE = 'central.ultima-clinica'

export function ultimaClinicaVista(): string | null {
  try {
    return window.localStorage.getItem(CHAVE)
  } catch {
    return null
  }
}

export function lembrarClinica(clinicId: string) {
  try {
    window.localStorage.setItem(CHAVE, clinicId)
  } catch {
    // navegador sem armazenamento: so perde o atalho da proxima recarga
  }
}
