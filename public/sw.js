/* Service worker mínimo: permite instalar o SalvaTudo como aplicativo.
   Tudo continua vindo do servidor local (sem cache), para que uma
   atualização apareça na hora. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* rede normal */ });
