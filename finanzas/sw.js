/* Service worker de la app (script clásico). Red primero con caché de respaldo.
 *
 * Para publicar una versión nueva:
 *   1) node tools/generar-precache.mjs --subir-version   (regenera la lista y sube CACHE_VERSION) -- o edite CACHE_VERSION a mano.
 *   2) node tools/verificar-precache.mjs --final
 * No escriba rutas que empiecen con barra: la app vive en una subruta (/<repo>/<app>/) y se rompería.
 * Todas las rutas son relativas al alcance de este service worker (la carpeta de la app). */
'use strict';

const APP = 'finanzas';
const CACHE_VERSION = 'v1';
const CACHE_PREFIX = 'cte-' + APP + '-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
const TIEMPO_RED_MS = 3000; // con copia en caché, si la red tarda más se usa la copia (señal débil)

// >>> PRECACHE:INICIO (generado por tools/generar-precache.mjs; no editar a mano)
const PRECACHE = [
  './',
  './index.html',
  './app.js',
  './estilos.css',
  './icons/apple-touch-icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './logica/acciones.js',
  './logica/bienvenida.js',
  './logica/carga.js',
  './logica/deudas.js',
  './logica/esquema.js',
  './logica/importacion.js',
  './logica/metas.js',
  './logica/periodo.js',
  './logica/preferencias.js',
  './logica/presupuesto.js',
  './logica/recurrentes.js',
  './logica/reportes.js',
  './logica/saldos.js',
  './logica/tasas.js',
  './manifest.webmanifest',
  './registrar-sw.js',
  './seed.js',
  './vistas/agregar.js',
  './vistas/ajustes.js',
  './vistas/comun.js',
  './vistas/cuentas.js',
  './vistas/datos.js',
  './vistas/deudas.js',
  './vistas/editores.js',
  './vistas/inicio.js',
  './vistas/metas.js',
  './vistas/movimientos.js',
  './vistas/presupuesto.js',
  './vistas/recuperacion.js',
  './vistas/reportes.js',
  '../shared/lib/ciclos.js',
  '../shared/lib/dinero.js',
  '../shared/lib/dispositivo.js',
  '../shared/lib/dom.js',
  '../shared/lib/envio.js',
  '../shared/lib/exportacion.js',
  '../shared/lib/fechas.js',
  '../shared/lib/ids.js',
  '../shared/lib/instantes.js',
  '../shared/lib/numeros.js',
  '../shared/lib/reloj.js',
  '../shared/lib/repositorio.js',
  '../shared/lib/storage.js',
  '../shared/lib/tienda.js',
  '../shared/lib/validacion.js',
  '../shared/ui/aviso.js',
  '../shared/ui/components.css',
  '../shared/ui/controles.js',
  '../shared/ui/el.js',
  '../shared/ui/graficos.js',
  '../shared/ui/haptica.js',
  '../shared/ui/hoja.js',
  '../shared/ui/icono.js',
  '../shared/ui/iconos.js',
  '../shared/ui/patrones-finanzas.css',
  '../shared/ui/teclado.js',
  '../shared/ui/tokens.css',
];
// <<< PRECACHE:FIN

const BASE = self.registration.scope; // p. ej. https://usuario.github.io/repo/<app>/
const BASE_SHARED = new URL('../shared/', BASE).href; // p. ej. https://usuario.github.io/repo/shared/
const INDEX = new URL('./index.html', BASE).href;
const RUTA_SW = new URL('./sw.js', BASE).href;

/** Solo se atienden las URL de esta app y de shared/ (el service worker de otra app o del lanzador no se toca). */
function esNuestra(url) {
  return url.origin === self.location.origin && (url.href.startsWith(BASE) || url.href.startsWith(BASE_SHARED));
}

function claveDe(url) {
  const u = new URL(url);
  u.search = '';
  u.hash = '';
  return u.href;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // 'reload' evita copiar versiones viejas desde la caché HTTP del navegador o de GitHub Pages.
      cache.addAll(PRECACHE.map((ruta) => new Request(new URL(ruta, BASE).href, { cache: 'reload' })))
    )
  );
  // Sin skipWaiting aquí: una versión nueva espera a que se cierre la app (o a SKIP_WAITING, ver registrar-sw.js).
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      // Solo borra las cachés de ESTA app. Las de la otra app y las del lanzador comparten origen y no se tocan.
      .then((nombres) => Promise.all(nombres.filter((n) => n.startsWith(CACHE_PREFIX) && n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  const dato = event.data || {};
  if (dato.type === 'SKIP_WAITING') self.skipWaiting();
  else if (dato.type === 'GET_VERSION' && event.ports && event.ports[0]) event.ports[0].postMessage({ app: APP, version: CACHE_VERSION, cache: CACHE_NAME });
});

function fetchConLimite(peticion, limiteMs) {
  const controlador = new AbortController();
  const reloj = limiteMs > 0 ? setTimeout(() => controlador.abort(), limiteMs) : null;
  // 'no-cache' revalida contra el servidor; así no se mezclan módulos de dos despliegues distintos.
  return fetch(peticion, { cache: 'no-cache', signal: controlador.signal }).finally(() => { if (reloj) clearTimeout(reloj); });
}

async function redPrimero(peticion, evento) {
  const cache = await caches.open(CACHE_NAME);
  const clave = claveDe(peticion.url);
  const respaldo = await cache.match(clave);
  try {
    const respuesta = await fetchConLimite(peticion, respaldo ? TIEMPO_RED_MS : 0);
    if (respuesta.ok) {
      if (respuesta.status === 200 && !respuesta.redirected) evento.waitUntil(cache.put(clave, respuesta.clone()).catch(() => {}));
      return respuesta;
    }
    // Error del servidor (p. ej. despliegue a medias): mejor la copia que una página de error.
    return respaldo || respuesta;
  } catch (e) {
    if (respaldo) return respaldo;
    if (peticion.mode === 'navigate') {
      const inicio = await cache.match(INDEX);
      if (inicio) return inicio;
    }
    return new Response('Sin conexión y sin copia guardada. Abra la app una vez con internet.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('fetch', (event) => {
  const peticion = event.request;
  if (peticion.method !== 'GET') return;
  const url = new URL(peticion.url);
  if (!esNuestra(url)) return;
  if (url.href === RUTA_SW) return; // el navegador revisa sw.js por su cuenta, sin caché
  event.respondWith(redPrimero(peticion, event));
});
