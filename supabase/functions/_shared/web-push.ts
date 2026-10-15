/**
 * Web Push sem biblioteca: VAPID (RFC 8292) + criptografia aes128gcm (RFC 8291).
 *
 * Por que nao o pacote web-push do npm (28/09/2026): ele depende de
 * crypto.createECDH e de http_ece, que dependem da compatibilidade Node do
 * runtime das Edge Functions - e uma notificacao que deixa de sair nao grita
 * em lugar nenhum, a tela da familia so fica quieta. Aqui e so WebCrypto, que
 * e igual no Deno, no Node dos testes e no navegador.
 *
 * A prova de que esta certo mora em tests/web-push.test.mjs: o vetor oficial
 * do Apendice A da RFC 8291 (mesmas chaves, mesmo sal -> mesmos bytes) e a
 * decifragem pelo pacote http_ece, que e o que o Chrome e o Firefox usam por
 * baixo.
 */

const enc = new TextEncoder()

// Bytes sobre ArrayBuffer comum: e o que o WebCrypto aceita nos tipos novos
// do TypeScript (Uint8Array generico desde o 5.7).
type Bytes = Uint8Array<ArrayBuffer>

export function paraBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function deBase64Url(texto: string): Bytes {
  const b64 = texto.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function juntar(...partes: Uint8Array[]): Bytes {
  const total = partes.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const p of partes) {
    out.set(p, pos)
    pos += p.length
  }
  return out
}

async function hmac(chave: Bytes, dados: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', chave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, dados))
}

/** Par de chaves VAPID guardado como JWK (privada) + ponto publico em base64url. */
export type ChavesVapid = { publica: string; privadaJwk: JsonWebKey }

export async function gerarChavesVapid(): Promise<ChavesVapid> {
  const par = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const publica = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey))
  const privadaJwk = await crypto.subtle.exportKey('jwk', par.privateKey)
  return { publica: paraBase64Url(publica), privadaJwk }
}

/**
 * Cabecalho Authorization do VAPID.
 *
 * `sub` e o contato que o servico de push (Google, Apple) usa se precisar
 * reclamar de abuso. A Apple recusa o envio inteiro com sub invalido
 * (BadJwtToken), por isso ele e fixo e e uma URL real.
 *
 * Desde 15/10/2026 e o site do Dr. Fabio. Era o do Dr. Marcello, de onde este
 * espelho veio. Nao vale marcador aqui: um sub que nao e endereco de verdade
 * derruba na Apple o alerta de sangramento no celular dele e da Dayane.
 */
export async function cabecalhoVapid(endpoint: string, chaves: ChavesVapid, agora = Date.now()) {
  const aud = new URL(endpoint).origin
  const cab = paraBase64Url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const corpo = paraBase64Url(
    enc.encode(
      JSON.stringify({
        aud,
        // 12h: o maximo que a Apple aceita e 1h a menos que 24h; sobra folga
        // para relogio torto.
        exp: Math.floor(agora / 1000) + 12 * 60 * 60,
        sub: 'https://drfabiopavanidario.com.br',
      }),
    ),
  )
  const privada = await crypto.subtle.importKey('jwk', chaves.privadaJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
  ])
  // WebCrypto ja devolve r||s de 64 bytes, que e exatamente o formato do JWT.
  const assinatura = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privada, enc.encode(`${cab}.${corpo}`)),
  )
  return `vapid t=${cab}.${corpo}.${paraBase64Url(assinatura)}, k=${chaves.publica}`
}

/**
 * Cifra a mensagem para UM aparelho (RFC 8291, um registro so).
 *
 * `fixo` existe so para o teste reproduzir o vetor da RFC: em producao o par
 * efemero e o sal sao novos a cada envio.
 */
export async function cifrar(
  mensagem: Bytes,
  p256dh: string,
  auth: string,
  fixo?: { parEfemero: CryptoKeyPair; sal: Bytes },
): Promise<Bytes> {
  const uaPublica = deBase64Url(p256dh)
  const segredo = deBase64Url(auth)

  const par =
    fixo?.parEfemero ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair)
  const asPublica = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey))
  const chaveUa = await crypto.subtle.importKey('raw', uaPublica, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: chaveUa }, par.privateKey, 256))

  // HKDF feito a mao com HMAC: todas as saidas cabem num bloco so (<= 32 bytes).
  const prkKey = await hmac(segredo, ecdh)
  const keyInfo = juntar(enc.encode('WebPush: info\0'), uaPublica, asPublica)
  const ikm = await hmac(prkKey, juntar(keyInfo, new Uint8Array([1])))

  const sal = fixo?.sal ?? crypto.getRandomValues(new Uint8Array(16))
  const prk = await hmac(sal, ikm)
  const cek = (await hmac(prk, enc.encode('Content-Encoding: aes128gcm\0\x01'))).slice(0, 16)
  const nonce = (await hmac(prk, enc.encode('Content-Encoding: nonce\0\x01'))).slice(0, 12)

  // 0x02 = delimitador do ultimo (e unico) registro.
  const claro = juntar(mensagem, new Uint8Array([2]))
  const chaveAes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, chaveAes, claro))

  const rs = new Uint8Array([0, 0, 0x10, 0]) // 4096
  return juntar(sal, rs, new Uint8Array([asPublica.length]), asPublica, cifrado)
}

export type Inscricao = { endpoint: string; p256dh: string; auth: string }

/**
 * Entrega uma notificacao. Nunca lanca: devolve o status para quem chamou
 * decidir (404/410 = aparelho desinscrito, apagar a linha).
 */
export async function enviarPush(
  inscricao: Inscricao,
  carga: unknown,
  chaves: ChavesVapid,
): Promise<{ ok: boolean; status: number; detalhe: string }> {
  try {
    const corpo = await cifrar(enc.encode(JSON.stringify(carga)), inscricao.p256dh, inscricao.auth)
    const resposta = await fetch(inscricao.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await cabecalhoVapid(inscricao.endpoint, chaves),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        // Um dia: celular desligado a noite ainda recebe de manha. Depois
        // disso o aviso ja perdeu o sentido - a conversa esta na tela.
        TTL: '86400',
        // high acorda o Android em modo economia; sem isto o aviso podia
        // chegar minutos depois.
        Urgency: 'high',
      },
      body: corpo,
    })
    const detalhe = resposta.ok ? '' : (await resposta.text().catch(() => '')).slice(0, 300)
    return { ok: resposta.ok, status: resposta.status, detalhe }
  } catch (erro) {
    return { ok: false, status: 0, detalhe: String(erro).slice(0, 300) }
  }
}
