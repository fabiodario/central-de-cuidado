// Lote do WhatsApp de 25/09/2026: nono digito, localizacao/contato e notas.
// Numeros e nomes inventados.
import { variantesDoTelefone, mesmoTelefone } from './telefone-br.build.mjs'
import { textoDaLocalizacao, textoDosContatos, semRespostaDoRobo } from './mensagem-recebida.build.mjs'
import { linhaDoTempo } from './linha-do-tempo.build.mjs'
import { avaliarSaude } from './saude-dos-envios.build.mjs'
import { consultasDeUmDia, avisoDoBloqueio } from './bloqueio-de-dia.build.mjs'

let ok = 0
let falhas = 0
function confere(nome, cond, detalhe) {
  if (cond) ok++
  else {
    falhas++
    console.error('FALHOU:', nome, detalhe ?? '')
  }
}

// ---------------------------------------------------------------- nono digito
{
  const v = variantesDoTelefone('551391234567') // como a Meta manda numero antigo
  confere('sem o 9 da Meta acha o cadastro com o 9', v.includes('13991234567'), JSON.stringify(v))
  confere('e a grafia com 55 e 9', v.includes('5513991234567'))
  const w = variantesDoTelefone('(13) 9 9123-4567') // como o cadastro guarda
  confere('com o 9 do cadastro acha o wa_id sem o 9', w.includes('551391234567'), JSON.stringify(w))
  confere('fixo nao ganha 9', !variantesDoTelefone('1332345678').some((x) => x.includes('913323')), JSON.stringify(variantesDoTelefone('1332345678')))
  confere('mesmo telefone em grafias diferentes', mesmoTelefone('551391234567', '13 99123-4567'))
  confere('telefones diferentes nao casam', !mesmoTelefone('551391234567', '13991234568'))
  confere('vazio devolve lista vazia', variantesDoTelefone('').length === 0)
}

// ---------------------------------------------------------------- localizacao e contato
{
  const t = textoDaLocalizacao({ latitude: -23.96, longitude: -46.33, name: 'Clínica', address: 'Rua Exemplo, 10' })
  confere('localizacao vira endereco e link de mapa', t.includes('Rua Exemplo, 10') && t.includes('maps.google.com/?q=-23.96,-46.33'), t)
  confere('localizacao sem nada ainda diz o que e', textoDaLocalizacao(undefined).includes('Localização'))
  const c = textoDosContatos([{ name: { formatted_name: 'Maria Teste' }, phones: [{ phone: '+55 13 99999-0000' }] }])
  confere('contato vira nome e telefone', c.includes('Maria Teste: +55 13 99999-0000'), c)
}

// ---------------------------------------------------------------- notas na linha do tempo
{
  const msgs = [
    { id: 'm1', createdAt: '2026-09-24T10:00:00Z' },
    { id: 'm2', createdAt: '2026-09-24T10:05:00Z' },
  ]
  const notas = [
    { id: 'n1', texto: 'x', autorNome: '', criadoEm: '2026-09-24T10:02:00Z' },
    { id: 'n2', texto: 'y', autorNome: '', criadoEm: '2026-09-24T10:05:00Z' },
  ]
  const ordem = linhaDoTempo(msgs, notas).map((e) => e.item.id)
  confere('nota entra na hora certa entre as mensagens', JSON.stringify(ordem) === JSON.stringify(['m1', 'n1', 'm2', 'n2']), JSON.stringify(ordem))
}

// ---------------------------------------------------------------- saude dos envios
{
  const agora = new Date('2026-09-25T15:00:00Z')
  const tudoBem = avaliarSaude({
    robos: [{ nome: 'lembretes-consulta', ultimo_inicio: '2026-09-25T14:20:00Z', status: 'succeeded' }],
    chamadas_recusadas_6h: 0,
    lembretes_atrasados: 0,
    lembretes_enviados_24h: 12,
    ultima_recebida: '2026-09-25T14:50:00Z',
  }, agora)
  confere('tudo certo nao gera problema', tudoBem.problemas.length === 0, JSON.stringify(tudoBem))

  // O caso de setembro: o agendador diz sucesso, o outro lado recusa.
  const segredoErrado = avaliarSaude({
    robos: [{ nome: 'lembretes-consulta', ultimo_inicio: '2026-09-25T14:20:00Z', status: 'succeeded' }],
    chamadas_recusadas_6h: 6,
    ultima_recusa: '401 Unauthorized',
  }, agora)
  confere('chamada recusada vira erro mesmo com o robo "succeeded"', segredoErrado.problemas.some((p) => p.nivel === 'erro' && /recusada/.test(p.texto)))

  const parado = avaliarSaude({ robos: [{ nome: 'lembretes-consulta', ultimo_inicio: '2026-09-25T09:20:00Z', status: 'succeeded' }] }, agora)
  confere('robo de hora em hora parado ha 6h e erro', parado.problemas.some((p) => p.nivel === 'erro' && /não roda há/.test(p.texto)), JSON.stringify(parado))

  // Robo recem-criado, que ainda nao teve a primeira hora dele, nao e alarme.
  const novo = avaliarSaude({ robos: [{ nome: 'fechar-presencas', ultimo_inicio: null, status: null }] }, agora)
  confere('robo que ainda nao rodou nao grita', novo.problemas.length === 0, JSON.stringify(novo))

  const atrasado = avaliarSaude({ lembretes_atrasados: 3 }, agora)
  confere('lembrete atrasado e erro', atrasado.problemas.some((p) => p.nivel === 'erro' && /3 consultas/.test(p.texto)))
  confere('lembrete desligado nao acusa atraso', avaliarSaude({ lembretes_atrasados: 3, lembrete_ligado: false }, agora).problemas.length === 0)

  const falhou = avaliarSaude({ robos: [{ nome: 'x', ultimo_inicio: null, status: 'failed', mensagem: 'erro' }] }, agora)
  confere('qualquer robo que falhou e erro', falhou.problemas.some((p) => p.nivel === 'erro'))

  const mudo = avaliarSaude({ ultima_recebida: '2026-09-23T10:00:00Z' }, agora)
  confere('dia e meio sem mensagem recebida e aviso', mudo.problemas.some((p) => p.nivel === 'aviso' && /Nenhuma mensagem/.test(p.texto)))
}

// ---------------------------------------------------------------- bloquear dia
{
  const consultas = [
    { startsAt: '2026-10-12T11:00:00Z', status: 'scheduled', patientName: 'Paciente A', contactName: '' },
    { startsAt: '2026-10-12T13:00:00Z', status: 'cancelled', patientName: 'Paciente B', contactName: '' },
    // 23h30 de 11/10 em Sao Paulo: e do dia 11, nao do 12.
    { startsAt: '2026-10-12T02:30:00Z', status: 'scheduled', patientName: 'Paciente C', contactName: '' },
  ]
  const doDia = consultasDeUmDia(consultas, '2026-10-12')
  confere('so consultas de pe, no dia de Sao Paulo', doDia.length === 1 && doDia[0].patientName === 'Paciente A', JSON.stringify(doDia))
  const aviso = avisoDoBloqueio(doDia)
  confere('aviso diz que ninguem e avisado', /NÃO são avisadas/.test(aviso.detalhe) && /1 consulta marcada/.test(aviso.titulo), JSON.stringify(aviso))
}

// ------------------------------------------- figurinha nao puxa resposta (14/10/2026)
confere('figurinha nao recebe resposta do robo', semRespostaDoRobo('sticker') === true)
for (const tipo of ['text', 'image', 'document', 'audio', 'interactive', 'button', undefined]) {
  confere(`${tipo} continua com resposta`, semRespostaDoRobo(tipo) === false)
}

console.log(`WhatsApp (lote 25/09): ${ok} verificações passaram.`)
if (falhas) {
  console.error(`FALHAS: ${falhas}`)
  process.exit(1)
}
