// Web Push feito a mao (supabase/functions/_shared/web-push.ts).
//
// Criptografia errada nao da erro no envio: o Google e a Apple aceitam os
// bytes (202) e o celular descarta em silencio. Por isso o teste compara com
// o vetor oficial do Apendice A da RFC 8291 - mesmas chaves e mesmo sal
// precisam dar exatamente os mesmos bytes.
import assert from 'node:assert/strict'
import { cifrar, cabecalhoVapid, gerarChavesVapid, paraBase64Url, deBase64Url } from './web-push.build.mjs'

let ok = 0
async function caso(nome, fn) {
  try {
    await fn()
    ok++
  } catch (erro) {
    console.error('FALHOU:', nome)
    throw erro
  }
}

const RFC = {
  texto: 'When I grow up, I want to be a watermelon',
  asPrivada: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublica: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPublica: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  sal: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  esperado:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
}

async function parDaRfc() {
  const pub = deBase64Url(RFC.asPublica)
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: paraBase64Url(pub.slice(1, 33)),
    y: paraBase64Url(pub.slice(33, 65)),
    d: RFC.asPrivada,
    ext: true,
  }
  const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const publicKey = await crypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, true, [])
  return { privateKey, publicKey }
}

await caso('vetor do Apendice A da RFC 8291, byte a byte', async () => {
  const corpo = await cifrar(new TextEncoder().encode(RFC.texto), RFC.uaPublica, RFC.auth, {
    parEfemero: await parDaRfc(),
    sal: deBase64Url(RFC.sal),
  })
  assert.equal(paraBase64Url(corpo), RFC.esperado)
})

await caso('sem o par fixo, cada envio usa sal e chave novos', async () => {
  const a = await cifrar(new TextEncoder().encode('x'), RFC.uaPublica, RFC.auth)
  const b = await cifrar(new TextEncoder().encode('x'), RFC.uaPublica, RFC.auth)
  assert.notEqual(paraBase64Url(a), paraBase64Url(b))
  // sal(16) + rs(4) + idlen(1) + chave(65) + 1 byte + delimitador + tag(16)
  assert.equal(a.length, 16 + 4 + 1 + 65 + 2 + 16)
})

await caso('VAPID: JWT assinado que a chave publica confere, com aud = origem do endpoint', async () => {
  const chaves = await gerarChavesVapid()
  assert.equal(deBase64Url(chaves.publica).length, 65)
  const cab = await cabecalhoVapid('https://fcm.googleapis.com/fcm/send/abc', chaves, Date.UTC(2026, 8, 28))
  const m = cab.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/)
  assert.ok(m, cab)
  assert.equal(m[4], chaves.publica)
  const claims = JSON.parse(new TextDecoder().decode(deBase64Url(m[2])))
  assert.equal(claims.aud, 'https://fcm.googleapis.com')
  assert.equal(claims.exp, Date.UTC(2026, 8, 28) / 1000 + 12 * 3600)
  assert.match(claims.sub, /^(https:|mailto:)/)
  const pub = await crypto.subtle.importKey('raw', deBase64Url(chaves.publica), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
  const valido = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    pub,
    deBase64Url(m[3]),
    new TextEncoder().encode(`${m[1]}.${m[2]}`),
  )
  assert.equal(valido, true)
})

console.log(`web-push: ${ok} verificacoes ok`)
