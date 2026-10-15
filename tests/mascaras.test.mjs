// Mascaras de telefone e CPF do cadastro (23/09/2026). Numeros inventados.

import { editarComMascara, mascararCpf, mascararTelefone } from './mascaras.build.mjs'

let passou = 0
const falhas = []
function igual(titulo, veio, esperado) {
  if (veio === esperado) passou++
  else falhas.push(`${titulo}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(veio)}`)
}

igual('celular', mascararTelefone('13912345678'), '(13) 9 1234-5678')
igual('fixo', mascararTelefone('1332221234'), '(13) 3222-1234')
igual('ja mascarado', mascararTelefone('(13) 9 1234-5678'), '(13) 9 1234-5678')
igual('com 55 mantem o 55', mascararTelefone('5513912345678'), '+55 (13) 9 1234-5678')
igual('digitando 1', mascararTelefone('1'), '(1')
igual('digitando DDD', mascararTelefone('139'), '(13) 9')
igual('digitando meio', mascararTelefone('1391234'), '(13) 9123-4')
igual('vazio', mascararTelefone(''), '')
igual('corta excesso', mascararTelefone('139123456789999'), '(13) 9 1234-5678')

igual('cpf completo', mascararCpf('12345678901'), '123.456.789-01')
igual('cpf parcial', mascararCpf('1234567'), '123.456.7')
igual('cpf ja mascarado', mascararCpf('123.456.789-01'), '123.456.789-01')
igual('cpf corta excesso', mascararCpf('123456789012345'), '123.456.789-01')

// Backspace em cima do separador apaga o digito anterior, em vez de travar.
igual('backspace no hifen do telefone', editarComMascara('(13) 9123-4', '(13) 91234', mascararTelefone), '(13) 9123')
igual('backspace no ultimo digito', editarComMascara('(13) 9123-4', '(13) 9123-', mascararTelefone), '(13) 9123')
igual('backspace no ponto do cpf', editarComMascara('123.4', '1234', mascararCpf), '123')
igual('digitacao normal', editarComMascara('(13) 9', '(13) 91', mascararTelefone), '(13) 91')

console.log(`Mascaras: ${passou} verificações passaram.`)
if (falhas.length) {
  for (const f of falhas) console.log('✗ ' + f)
  process.exit(1)
}
