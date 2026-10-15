/**
 * O que a resposta de saude_dos_envios quer dizer, em frases (25/09/2026).
 *
 * Separado da tela para poder ser testado: a regra de "isto e problema" e o
 * que evita outras tres semanas de lembrete parado sem ninguem saber - e uma
 * regra errada aqui ou cala o alarme, ou grita todo dia ate ninguem mais ler.
 */

export type Robo = {
  nome: string
  agenda?: string
  ultimo_inicio: string | null
  status: string | null
  mensagem?: string
}

export type DadosDaSaude = {
  robos?: Robo[]
  robos_erro?: string
  chamadas_6h?: number
  chamadas_recusadas_6h?: number
  ultima_recusa?: string | null
  chamadas_erro?: string
  lembrete_ligado?: boolean
  lembretes_atrasados?: number
  lembretes_falhos_48h?: number
  lembretes_enviados_24h?: number
  acompanhamentos_hoje_parados?: number
  acompanhamentos_enviados_7d?: number
  acompanhamentos_falhos_7d?: number
  mensagens_falhas_24h?: number
  ultima_recebida?: string | null
  // 27/09/2026: clinica sem numero nao tem envio automatico; clinica em modo
  // teste so envia para os celulares da lista (ver whatsapp-teste.ts).
  whatsapp_conectado?: boolean
  modo_teste?: boolean
  telefones_teste?: number
}

export type Avaliacao = {
  problemas: Problema[]
  resumo: string
  /** 'desligado' = clinica sem WhatsApp: cartao cinza, sem cobrar atraso. */
  situacao: 'normal' | 'desligado'
}

export type Problema = { nivel: 'erro' | 'aviso'; texto: string }

/** Robos que importam, e de quanto em quanto tempo cada um deveria rodar. */
const ROBOS_CONHECIDOS: Record<string, { nome: string; minutos: number }> = {
  'lembretes-consulta': { nome: 'Lembrete da véspera', minutos: 60 },
  'disparo-acompanhamentos-diario': { nome: 'Acompanhamentos de 15, 30 e 90 dias', minutos: 24 * 60 },
  'fechar-presencas': { nome: 'Faltou automático', minutos: 24 * 60 },
  'liberar-reservas-vencidas': { nome: 'Liberar reservas vencidas', minutos: 60 },
  'liberar-conversas-travadas': { nome: 'Destravar conversas', minutos: 60 },
}

function haQuanto(iso: string, agora: Date) {
  const minutos = Math.round((agora.getTime() - Date.parse(iso)) / 60000)
  if (minutos < 60) return `${minutos} min`
  const horas = Math.round(minutos / 60)
  if (horas < 48) return `${horas} h`
  return `${Math.round(horas / 24)} dias`
}

function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`
}

export function avaliarSaude(dados: DadosDaSaude, agora: Date = new Date()): Avaliacao {
  // Sem numero conectado nao ha robo enviando nada para esta clinica. Ate
  // 27/09/2026 o cartao contava as consultas de amanha como "lembrete
  // atrasado" e ficava vermelho na clinica de teste - alarme falso ensina a
  // ignorar o alarme verdadeiro.
  if (dados.whatsapp_conectado === false) {
    return { problemas: [], resumo: 'WhatsApp não conectado nesta clínica', situacao: 'desligado' }
  }

  const problemas: Problema[] = []

  if (dados.modo_teste && (dados.telefones_teste ?? 0) === 0) {
    problemas.push({
      nivel: 'aviso',
      texto: 'Modo teste sem nenhum celular cadastrado: nenhum envio automático vai sair até a lista ser preenchida.',
    })
  }

  if (dados.robos_erro) problemas.push({ nivel: 'aviso', texto: `Não consegui ler os robôs agendados (${dados.robos_erro}).` })
  for (const robo of dados.robos ?? []) {
    const conhecido = ROBOS_CONHECIDOS[robo.nome]
    const rotulo = conhecido?.nome ?? robo.nome
    if (robo.status === 'failed') {
      problemas.push({ nivel: 'erro', texto: `${rotulo}: a última execução falhou. ${robo.mensagem ?? ''}`.trim() })
      continue
    }
    if (!conhecido) continue
    // Folga: o dobro do intervalo, mais meia hora. Um atraso de minutos nao e
    // alarme; um robo que pulou uma rodada inteira e.
    const limite = (conhecido.minutos * 2 + 30) * 60000
    // Robo que ainda nao rodou nenhuma vez e robo recem-criado (25/09/2026):
    // o "Faltou automatico" nasceu as 14h e so roda as 3h, e o cartao ficou
    // vermelho a tarde inteira dizendo "nunca rodou". O que interessa e o robo
    // que rodava e PAROU - esse o limite abaixo pega.
    if (!robo.ultimo_inicio) continue
    if (agora.getTime() - Date.parse(robo.ultimo_inicio) > limite) {
      problemas.push({ nivel: 'erro', texto: `${rotulo}: não roda há ${haQuanto(robo.ultimo_inicio, agora)}.` })
    }
  }

  if (dados.chamadas_erro) problemas.push({ nivel: 'aviso', texto: `Não consegui conferir as chamadas dos robôs (${dados.chamadas_erro}).` })
  if ((dados.chamadas_recusadas_6h ?? 0) > 0) {
    problemas.push({
      nivel: 'erro',
      texto:
        `${plural(dados.chamadas_recusadas_6h ?? 0, 'chamada de robô foi recusada', 'chamadas de robô foram recusadas')} nas últimas 6 horas. ` +
        `O robô rodou, mas o outro lado não aceitou${dados.ultima_recusa ? `: ${dados.ultima_recusa}` : ''}.`,
    })
  }

  if (dados.lembrete_ligado !== false && (dados.lembretes_atrasados ?? 0) > 0) {
    problemas.push({
      nivel: 'erro',
      texto: `${plural(dados.lembretes_atrasados ?? 0, 'consulta já devia ter recebido', 'consultas já deviam ter recebido')} o lembrete e não ${dados.lembretes_atrasados === 1 ? 'recebeu' : 'receberam'}.`,
    })
  }
  if ((dados.lembretes_falhos_48h ?? 0) > 0) {
    problemas.push({
      nivel: 'aviso',
      texto: `${plural(dados.lembretes_falhos_48h ?? 0, 'lembrete falhou', 'lembretes falharam')} (estão em "Ligar hoje", na Agenda).`,
    })
  }
  if ((dados.acompanhamentos_hoje_parados ?? 0) > 0) {
    problemas.push({
      nivel: 'aviso',
      texto: `${plural(dados.acompanhamentos_hoje_parados ?? 0, 'acompanhamento de hoje ainda não saiu', 'acompanhamentos de hoje ainda não saíram')} (pode ser quem pediu para não receber ou está sem telefone).`,
    })
  }
  if ((dados.acompanhamentos_falhos_7d ?? 0) > 0) {
    problemas.push({ nivel: 'aviso', texto: `${plural(dados.acompanhamentos_falhos_7d ?? 0, 'acompanhamento falhou', 'acompanhamentos falharam')} nos últimos 7 dias.` })
  }
  if ((dados.mensagens_falhas_24h ?? 0) > 0) {
    problemas.push({ nivel: 'aviso', texto: `${plural(dados.mensagens_falhas_24h ?? 0, 'mensagem falhou', 'mensagens falharam')} nas últimas 24 horas.` })
  }

  // Um dia util inteiro sem ninguem escrever e raro numa clinica com WhatsApp
  // no site: o mais provavel e o numero ter desconectado.
  if (dados.ultima_recebida && agora.getTime() - Date.parse(dados.ultima_recebida) > 30 * 3600 * 1000) {
    problemas.push({
      nivel: 'aviso',
      texto: `Nenhuma mensagem recebida há ${haQuanto(dados.ultima_recebida, agora)}. Confira se o número do WhatsApp continua conectado.`,
    })
  }

  const resumo =
    `${plural(dados.lembretes_enviados_24h ?? 0, 'lembrete enviado', 'lembretes enviados')} nas últimas 24h · ` +
    `${plural(dados.acompanhamentos_enviados_7d ?? 0, 'acompanhamento', 'acompanhamentos')} em 7 dias` +
    (dados.modo_teste ? ` · modo teste (${plural(dados.telefones_teste ?? 0, 'celular', 'celulares')})` : '')
  return { problemas, resumo, situacao: 'normal' }
}
