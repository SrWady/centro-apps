/* Service worker del lanzador (raíz). Solo guarda y atiende SUS propias URL (la página de inicio).
 * Su alcance (la raíz del sitio) contiene a /gimnasio/ y /finanzas/, pero este service worker NO responde a
 * ninguna URL fuera de su lista: las apps y shared/ pasan sin tocarse (lo atienden los service workers de cada app).
 * Tampoco hace clients.claim() ni borra cachés ajenas (solo las que empiezan con su prefijo).
 * Para una versión nueva: suba CACHE_VERSION. */
'use strict';

const CACHE_VERSION = 'v1';
const CACHE_PREFIX = 'cte-lanzador-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
const TIEMPO_RED_MS = 3000;
const PRECACHE = ['./', './index.html'];

const BASE = self.registration.scope;
const PROPIAS = new Set(PRECACHE.map((r) => new URL(r, BASE).href));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE.map((r) => new Request(new URL(r, BASE).href, { cache: 'reload' }))))
  );
  self.skipWaiting(); // página estática sin estado: no hay nada que interrumpir
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nombres) => Promise.all(nombres.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME).map((n) => caches.delete(n))))
  );
});

function fetchConLimite(peticion, limiteMs) {
  const controlador = new AbortController();
  const reloj = limiteMs > 0 ? setTimeout(() => controlador.abort(), limiteMs) : null;
  return fetch(peticion, { cache: 'no-cache', signal: controlador.signal }).finally(() => { if (reloj) clearTimeout(reloj); });
}

async function redPrimero(peticion, evento) {
  const cache = await caches.open(CACHE_NAME);
  const url = new URL(peticion.url);
  url.search = '';
  url.hash = '';
  const clave = url.href;
  const respaldo = await cache.match(clave);
  try {
    const respuesta = await fetchConLimite(peticion, respaldo ? TIEMPO_RED_MS : 0);
    if (respuesta.ok) {
      if (respuesta.status === 200 && !respuesta.redirected) evento.waitUntil(cache.put(clave, respuesta.clone()).catch(() => {}));
      return respuesta;
    }
    return respaldo || respuesta;
  } catch (e) {
    if (respaldo) return respaldo;
    return new Response('Sin conexión y sin copia guardada. Abra la página una vez con internet.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('fetch', (event) => {
  const peticion = event.request;
  if (peticion.method !== 'GET') return;
  const url = new URL(peticion.url);
  url.search = '';
  url.hash = '';
  if (!PROPIAS.has(url.href)) return; // cualquier otra URL: sin respondWith, la maneja el navegador (o el SW de cada app)
  event.respondWith(redPrimero(peticion, event));
});
