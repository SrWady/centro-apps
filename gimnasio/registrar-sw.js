/* Registro del service worker (script clásico, sin dependencias). Rutas relativas al documento (la raíz de la app).
 * Política de actualización:
 *  - Primera visita: el service worker se instala y precarga todo para funcionar sin red.
 *  - Versión nueva: queda en espera y se activa cuando la app se oculta o se cierra; no recarga la página
 *    ni interrumpe lo que se esté haciendo. Al volver a abrir la app ya está la versión nueva.
 *  - Cada vez que la app vuelve a primer plano se pregunta si hay versión nueva.
 *  - Si la carga de un módulo falla (p. ej. justo tras una actualización con señal muy débil, cuando pueden mezclarse archivos de dos versiones),
 *    la pantalla quedaría en blanco sin mensaje: aquí solo se MUESTRA un aviso con "Reintentar". No cambia la estrategia de caché. */
(function () {
  'use strict';
  var avisado = false;
  function mostrarAviso() {
    if (avisado) return;
    if (!document.body) { document.addEventListener('DOMContentLoaded', mostrarAviso); return; }
    avisado = true;
    var caja = document.createElement('div');
    caja.setAttribute('role', 'alert');
    caja.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:2147483647;padding:14px 16px;border-radius:14px;background:#1b1f2a;color:#fff;font:15px/1.4 system-ui,sans-serif;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.5)';
    caja.textContent = 'La app no cargó bien. Ciérrela por completo y ábrala de nuevo con buena señal de internet. ';
    var boton = document.createElement('button');
    boton.type = 'button';
    boton.textContent = 'Reintentar';
    boton.style.cssText = 'margin-top:8px;min-height:44px;min-width:44px;padding:10px 18px;border:0;border-radius:10px;background:#a98bff;color:#0a0c11;font:600 15px system-ui,sans-serif';
    boton.addEventListener('click', function () { location.reload(); });
    caja.appendChild(boton);
    document.body.appendChild(caja);
  }
  function avisarCargaFallida(ev) {
    var t = ev && ev.target;
    if (t && t !== window && t.tagName === 'SCRIPT' && t.type === 'module') { mostrarAviso(); return; }
    var m = String((ev && ev.message) || '');
    if (/does not provide an export named|Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(m)) mostrarAviso();
  }
  window.addEventListener('error', avisarCargaFallida, true);
  if (!('serviceWorker' in navigator)) return;
  var enEspera = null;
  function activarSiOculta() {
    if (enEspera && document.visibilityState === 'hidden') {
      try { enEspera.postMessage({ type: 'SKIP_WAITING' }); } catch (e) { /* sin acción */ }
      enEspera = null;
    }
  }
  function vigilar(trabajador) {
    trabajador.addEventListener('statechange', function () {
      if (trabajador.state === 'installed' && navigator.serviceWorker.controller) enEspera = trabajador;
    });
  }
  window.addEventListener('load', function () {
    try {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).then(function (reg) {
        if (reg.waiting && navigator.serviceWorker.controller) enEspera = reg.waiting;
        if (reg.installing) vigilar(reg.installing);
        reg.addEventListener('updatefound', function () { if (reg.installing) vigilar(reg.installing); });
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible') { try { reg.update().catch(function () {}); } catch (e) { /* sin acción */ } }
          else activarSiOculta();
        });
      }).catch(function () { /* sin service worker: la app sigue funcionando en línea */ });
    } catch (e) { /* contexto no seguro o navegador sin soporte */ }
  });
})();
