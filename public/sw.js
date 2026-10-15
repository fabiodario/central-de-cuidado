/*
 * Service worker da Central de Cuidado (28/09/2026).
 *
 * Existe so para as notificacoes no celular: recebe o aviso do servidor
 * (meta-webhook -> _shared/push-da-equipe.ts), mostra, e ao tocar abre a
 * conversa certa.
 *
 * De proposito NAO tem cache nem evento fetch. O site e publicado varias vezes
 * por dia; um service worker guardando paginas faria a equipe trabalhar numa
 * versao velha sem saber - o mesmo tipo de defeito silencioso que o rodape com
 * a versao publicada veio acabar.
 */

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (evento) => evento.waitUntil(self.clients.claim()))

self.addEventListener('push', (evento) => {
  let aviso = {}
  try {
    aviso = evento.data ? evento.data.json() : {}
  } catch (erro) {
    aviso = { titulo: 'Central de Cuidado', corpo: evento.data ? evento.data.text() : '' }
  }

  // O iPhone cancela a inscricao se um push chegar e nada for mostrado. Por
  // isso sempre mostra alguma coisa, mesmo com carga estranha.
  const titulo = aviso.titulo || 'Central de Cuidado'
  evento.waitUntil(
    self.registration.showNotification(titulo, {
      body: aviso.corpo || 'Nova mensagem',
      icon: 'icone-192.png?v=3',
      // Icone pequeno da barra de status (02/10/2026). O Android pinta de
      // branco tudo o que nao e transparente: com o icone colorido aparecia um
      // quadrado branco ao lado do relogio. Este e so o desenho do logo, em
      // branco sobre fundo transparente.
      badge: 'icone-badge.png?v=1',
      tag: aviso.etiqueta || undefined,
      // Mesma conversa escrevendo de novo: troca a notificacao e toca de novo,
      // como o WhatsApp, em vez de empilhar ou ficar muda.
      renotify: Boolean(aviso.etiqueta),
      requireInteraction: Boolean(aviso.urgente),
      vibrate: aviso.urgente ? [300, 120, 300, 120, 300] : [200],
      data: { conversa: aviso.conversa || '' },
    }),
  )
})

self.addEventListener('notificationclick', (evento) => {
  evento.notification.close()
  const conversa = (evento.notification.data && evento.notification.data.conversa) || ''
  const destino = new URL(self.registration.scope)
  if (conversa) destino.searchParams.set('conversa', conversa)

  evento.waitUntil(
    (async () => {
      const abertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const minha = abertas.find((c) => c.url.startsWith(self.registration.scope))
      if (minha) {
        // App ja aberto: pede para ele trocar de conversa, sem recarregar e
        // perder o que estiver sendo digitado.
        minha.postMessage({ tipo: 'abrir-conversa', conversa })
        return minha.focus()
      }
      return self.clients.openWindow(destino.href)
    })(),
  )
})
