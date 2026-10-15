/**
 * Quem atende, nas frases fixas do robo (27/09/2026).
 *
 * O robo foi escrito para uma clinica so, e dez frases levavam "Dr. Marcello"
 * no proprio codigo - "quem responde e o Dr. Marcello", "Vou passar para o Dr.
 * Marcello". A clinica de teste, usada para desenvolver e para demonstrar o
 * sistema a outros medicos, respondia com o nome dele.
 *
 * ESPELHO DO DR. FABIO DARIO (15/10/2026).
 *
 * Este sistema e uma copia do sistema do Dr. Marcello Ruiz (gastropediatria),
 * adaptada ao consultorio do Dr. Fabio Dario (otorrinolaringologia, Santos e
 * Sao Paulo). O robo e o mesmo; o que muda de uma clinica para a outra mora
 * aqui, no perfil:
 *  - com quem o robo fala: os pais, sobre a crianca (pediatria), ou o proprio
 *    paciente, adulto ou crianca (geral);
 *  - o alerta de sangramento, pedido do Dr. Fabio;
 *  - a frase do pronto-socorro, que no Dr. Fabio cita os convenios.
 *
 * O padrao AQUI e o Dr. Fabio: e a clinica deste sistema, e uma clinica sem
 * perfil cadastrado nao pode responder com o nome de um medico de outro
 * consultorio. O perfil pediatrico do Dr. Marcello continua existindo por um
 * motivo so: os ~1.200 casos de tests/atendimento.test.mjs (clinica "c1")
 * foram escritos para ele e continuam rodando nele. Sao a prova de que o
 * motor nao quebrou ao ganhar o perfil novo.
 */
export type QuemAtende = {
  /** No meio da frase: "quem responde e {o}", "Vou passar para {o}". */
  o: string
  /** No comeco da frase: "{O} vai revisar". */
  O: string
  /** Saudacao usada so quando a clinica nao cadastrou a dela. */
  saudacaoPadrao: string
  /**
   * Com quem o robo fala (15/10/2026).
   *
   * 'pediatria' e o robo de origem: fala com a mae sobre a crianca ("cuidar
   * do seu filho", "nome completo do paciente (a crianca)").
   *
   * 'geral' e o otorrino, que atende adultos e criancas: quem escreve costuma
   * ser o proprio paciente. A ficha pergunta o motivo da consulta e so pede o
   * responsavel quando o paciente e menor de idade.
   */
  publico: 'pediatria' | 'geral'
  /**
   * Quem recebe no celular o alerta de sangramento, como cabe na frase "Ja
   * avisei {alertaDeSangramento}". Nulo = o robo nao tem o modulo.
   *
   * Pedido do Dr. Fabio (relatorio da Cintia, 15/10/2026): qualquer mencao a
   * sangramento dispara na hora um aviso para o celular dele e da Dayane, a
   * secretaria. Ver falouDeSangramento em atendimento.ts.
   */
  alertaDeSangramento: string | null
  /**
   * A orientacao de pronto-socorro, quando o perfil tem uma propria. Nulo =
   * as frases de sempre ("procure o pronto-socorro mais proximo ou ligue 192").
   */
  prontoSocorro: string | null
}

/** O id da clinica do Dr. Fabio Dario no banco (e no simulador). */
export const CLINICA_DR_FABIO = 'b5d0f6a2-3c71-4e8a-9f2d-7a1c4e9b0d63'

const DR_FABIO: QuemAtende = {
  o: 'o Dr. Fábio',
  O: 'O Dr. Fábio',
  saudacaoPadrao: 'Olá! 👋 Seja muito bem-vindo(a) ao consultório do Dr. Fábio Dario, médico otorrinolaringologista.',
  publico: 'geral',
  alertaDeSangramento: 'o Dr. Fábio e a Dayane',
  // Redacao pedida pelo Dr. Fabio. Neutra de proposito: nao indica hospital
  // fixo, porque cada um atende convenios diferentes (o Hospital Ana Costa, por
  // exemplo, e do grupo Amil e nao atende Porto Saude). Mandar o paciente ao
  // hospital errado no meio de um sangramento e pior do que nao indicar.
  prontoSocorro:
    'Em caso de urgência, emergência ou sangramento intenso, dirija-se imediatamente ao Pronto-Socorro mais próximo ' +
    'que atenda ao seu plano de saúde (Porto Saúde, Unimed, Santa Saúde) ou ao atendimento particular de sua preferência.',
}

/** O robo de origem, pediatrico. So os testes do motor ("c1") rodam nele aqui. */
const DR_MARCELLO: QuemAtende = {
  o: 'o Dr. Marcello',
  O: 'O Dr. Marcello',
  saudacaoPadrao: 'Olá! 👋 Aqui é o consultório do Dr. Marcello Ruiz, Gastroenterologista Pediátrico.',
  publico: 'pediatria',
  alertaDeSangramento: null,
  prontoSocorro: null,
}

const PERFIS: Record<string, QuemAtende> = {
  [CLINICA_DR_FABIO]: DR_FABIO,
  c1: DR_MARCELLO,
}

export function quemAtende(clinicId: string | null | undefined): QuemAtende {
  return (clinicId && PERFIS[clinicId]) || DR_FABIO
}
