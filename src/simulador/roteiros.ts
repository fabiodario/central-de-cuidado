/**
 * Roteiros prontos para reuniao: a conversa se digita sozinha, passo a passo.
 *
 * Cada passo e o que o paciente faria: escrever, tocar numa opcao (pelo id da
 * opcao, o mesmo que o WhatsApp devolve), mandar uma foto - ou a equipe
 * entrar na conversa.
 *
 * `espera` e o que precisa ter acontecido no fim, e tests/simulador.test.mjs
 * cobra isso a cada `npm run test:bot`. Quando o robo mudar um caminho, o
 * roteiro quebra no teste, e nao na frente do cliente.
 *
 * Espelho do Dr. Fabio Dario (15/10/2026): os roteiros sao os do consultorio
 * dele, otorrino. A ordem e a da reuniao: primeiro o que o Dr. Fabio pediu
 * (agendamento pelo convenio, o alerta de sangramento), depois as duvidas do
 * dia a dia da Dayane. As unidades aparecem em ordem alfabetica para o
 * paciente: 1 Higienopolis, 2 Santos, 3 Tatuape. Em Santos, os convenios: 1
 * Porto Saude, 2 Unimed Santos, 3 Santa Saude, 4 Particular.
 */
import type { ChaveFamilia } from './dados'

export type Passo = { texto: string } | { toque: string } | { anexo: true } | { equipe: string }

export type Roteiro = {
  chave: string
  titulo: string
  resumo: string
  familia: ChaveFamilia
  passos: Passo[]
  espera: {
    /** Consultas marcadas (status scheduled) deste telefone no fim. */
    marcadas: number
    canceladas?: number
    /** Pacientes deste telefone no fim. */
    pacientes?: number
    /** Motivo da bandeira acesa no fim; null = nenhuma. */
    motivo: string | null
    resolvida?: boolean
  }
}

const t = (texto: string): Passo => ({ texto })
const toque = (id: string): Passo => ({ toque: id })

export const ROTEIROS: Roteiro[] = [
  {
    chave: 'marcar',
    titulo: 'Paciente novo marca pela Unimed em Santos',
    resumo: 'Do "oi" ao comprovante: unidade, convênio, dia, horário e a ficha com o motivo da consulta, sem ninguém da equipe.',
    familia: 'nova',
    passos: [
      t('Oi, boa tarde!'),
      toque('2'),
      toque('2'),
      toque('2'),
      toque('1'),
      toque('1'),
      t('Carla Mendes Rocha'),
      t('22/08/1988'),
      t('Nariz entupido há anos e ronco muito, acordo cansada'),
      toque('PULAR'),
      t('carla@exemplo.com'),
    ],
    espera: { marcadas: 1, pacientes: 1, motivo: null, resolvida: true },
  },
  {
    chave: 'sangramento',
    titulo: 'Sangramento depois da cirurgia',
    resumo: 'Na hora: alerta no celular do Dr. Fábio e da Dayane, e a orientação de pronto-socorro do convênio.',
    familia: 'cadastrada',
    passos: [t('Boa noite, operei o septo semana passada e meu nariz começou a sangrar e não para')],
    espera: { marcadas: 0, pacientes: 1, motivo: 'sangramento' },
  },
  {
    chave: 'sangramento_ficha',
    titulo: 'Fala em sangramento no meio do agendamento',
    resumo: 'O alerta sai do mesmo jeito, e o agendamento não se perde: a ficha continua de onde estava.',
    familia: 'nova',
    passos: [
      t('Oi'),
      toque('2'),
      toque('1'),
      toque('1'),
      toque('1'),
      t('Carla Mendes Rocha'),
      t('22/08/1988'),
      t('Tenho sangramento no nariz quase todo dia'),
      toque('PULAR'),
      t('carla@exemplo.com'),
    ],
    espera: { marcadas: 1, pacientes: 1, motivo: 'sangramento' },
  },
  {
    chave: 'valor',
    titulo: 'Pergunta o valor',
    resumo: 'Pergunta escrita do jeito dela: o robô responde direto e oferece o endereço da unidade.',
    familia: 'nova',
    passos: [t('Olá! Vi o site e queria saber o valor da consulta particular.'), toque('2')],
    espera: { marcadas: 0, motivo: null },
  },
  {
    chave: 'convenio',
    titulo: 'Convênio e endereço',
    resumo: 'Duas dúvidas de todo dia, respondidas com os textos do consultório.',
    familia: 'nova',
    passos: [t('Vocês atendem Unimed?'), t('E onde fica o consultório de Santos?')],
    espera: { marcadas: 0, motivo: null },
  },
  {
    chave: 'plano_nao_aceito',
    titulo: 'Plano que a unidade não atende',
    resumo: 'Tem Amil: o robô explica quais planos valem em Santos e segue como particular, sem "não entendi".',
    familia: 'nova',
    passos: [t('Oi'), toque('2'), toque('2'), t('Tenho Amil, dá pra usar?'), toque('4'), toque('1'), toque('1')],
    espera: { marcadas: 1, pacientes: 0, motivo: null },
  },
  {
    chave: 'trata',
    titulo: 'O que o Dr. Fábio trata',
    resumo: 'Ronco, nariz entupido, sinusite: o robô apresenta o foco do Dr. Fábio e convida a marcar.',
    familia: 'nova',
    passos: [t('Boa tarde! Vocês tratam ronco? Meu marido ronca demais e acorda cansado')],
    espera: { marcadas: 0, motivo: null },
  },
  {
    chave: 'rinoplastia',
    titulo: 'Pergunta sobre rinoplastia',
    resumo: 'Função e estética em equilíbrio, como no Instagram, e o caminho para a avaliação.',
    familia: 'nova',
    passos: [t('O Dr. Fábio faz rinoplastia?')],
    espera: { marcadas: 0, motivo: null },
  },
  {
    chave: 'clinica',
    titulo: 'Pergunta sobre remédio',
    resumo: 'O robô não orienta sobre sintomas nem remédios: explica e oferece a consulta.',
    familia: 'cadastrada',
    passos: [t('Estou com sinusite e dor de cabeça, posso tomar o antibiótico que sobrou?')],
    espera: { marcadas: 0, pacientes: 1, motivo: null },
  },
  {
    chave: 'remarcar',
    titulo: 'Paciente remarca a consulta',
    resumo: 'Escolhe a data nova; a antiga só é cancelada depois que a nova está garantida.',
    familia: 'com_consulta',
    passos: [t('Oi! Preciso remarcar minha consulta.'), toque('REMARCAR'), toque('SIM'), toque('2'), toque('4'), toque('2'), toque('1')],
    espera: { marcadas: 1, canceladas: 1, pacientes: 1, motivo: null },
  },
  {
    chave: 'irmaos',
    titulo: 'Mãe marca para o filho',
    resumo: 'Dois filhos no mesmo celular: o robô pergunta para quem é a consulta e anota a queixa.',
    familia: 'irmaos',
    passos: [t('Oi'), toque('2'), toque('2'), toque('2'), toque('2'), toque('1'), toque('1'), t('Ronca muito e dorme de boca aberta')],
    espera: { marcadas: 1, pacientes: 2, motivo: null, resolvida: true },
  },
  {
    chave: 'receita',
    titulo: '2ª via de receita',
    resumo: 'O pedido chega pronto para a equipe, com o remédio e a correção que a farmácia pediu.',
    familia: 'cadastrada',
    passos: [t('Oi'), toque('5'), toque('1'), t('Budesonida spray nasal 64mcg'), t('a farmácia pediu a receita com data atualizada')],
    espera: { marcadas: 0, pacientes: 1, motivo: 'documento' },
  },
  {
    chave: 'foto',
    titulo: 'Manda foto da tomografia',
    resumo: 'O robô não finge que leu: entrega para a equipe e diz que entregou.',
    familia: 'cadastrada',
    passos: [t('Oi, bom dia'), { anexo: true }],
    espera: { marcadas: 0, pacientes: 1, motivo: 'anexo' },
  },
  {
    chave: 'equipe',
    titulo: 'A Dayane assume a conversa',
    resumo: 'Com alguém da recepção conversando, o robô fica quieto e não atropela.',
    familia: 'cadastrada',
    passos: [
      t('Oi'),
      toque('3'),
      { equipe: 'Oi, Ricardo! Aqui é a Dayane, do consultório do Dr. Fábio. Como posso ajudar?' },
      t('Queria saber se preciso levar a tomografia antiga.'),
    ],
    espera: { marcadas: 0, pacientes: 1, motivo: 'atendente' },
  },
]
