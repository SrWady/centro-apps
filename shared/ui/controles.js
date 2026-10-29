/* controles.js — enlace de comportamiento para steppers y segmentados ya presentes en el DOM. */
import { haptic } from './haptica.js';
import { formatearNumero } from '../lib/numeros.js';

/**
 * enlazarStepper(raiz, {min, max, paso, valor, decimales, formato(v)->texto, alCambiar(v)}) -> {valor(), fijar(v), destruir()}
 * Marcado: [data-stepper-dec] [data-stepper-value] [data-stepper-inc]. Mantener pulsado repite el cambio.
 * La repetición se detiene (R0-05) con pointerup/pointercancel en cualquier parte del documento, pointerleave, blur,
 * pérdida de la captura implícita del puntero (táctil), pestaña oculta, si el botón sale del DOM o queda deshabilitado (tope), y con
 * destruir(). Un segundo dedo no deja una repetición huérfana: solo hay una a la vez por stepper.
 * Recomendación a las vistas: no reconstruir el stepper que se está pulsando; actualizar solo su texto.
 */
export function enlazarStepper(raiz, o = {}) {
  const min = o.min ?? -Infinity, max = o.max ?? Infinity, paso = o.paso || 1;
  const decimales = o.decimales ?? (String(paso).split('.')[1] || '').length;
  let valor = o.valor ?? min;
  const salida = raiz.querySelector('[data-stepper-value]');
  const dec = raiz.querySelector('[data-stepper-dec]'), inc = raiz.querySelector('[data-stepper-inc]');
  // R0-21: mismo formato que el resto de la app ('1.500'); Intl en español no agrupa 4 dígitos en todos los motores.
  const fmt = o.formato || ((v) => formatearNumero(v, { maxDecimales: Math.min(20, decimales) }));
  const pintar = () => {
    if (salida) salida.textContent = fmt(valor);
    if (dec) dec.disabled = valor <= min;
    if (inc) inc.disabled = valor >= max;
  };
  const fijar = (v, silencioso) => {
    v = Math.min(max, Math.max(min, Number(v.toFixed(decimales))));
    if (v === valor) return;
    valor = v; pintar();
    if (!silencioso && o.alCambiar) o.alCambiar(valor);
  };

  const doc = raiz.ownerDocument || globalThis.document;
  let t = null, r = null;
  const quitarGlobales = [];
  const parar = () => {
    clearTimeout(t); clearInterval(r); t = r = null;
    while (quitarGlobales.length) quitarGlobales.pop()();
  };
  const escucharGlobal = (objetivo, tipo, fn) => {
    if (!objetivo || typeof objetivo.addEventListener !== 'function') return;
    objetivo.addEventListener(tipo, fn);
    quitarGlobales.push(() => objetivo.removeEventListener(tipo, fn));
  };
  const alOcultar = () => { if (doc && doc.hidden) parar(); };
  const sigueVivo = (boton) => boton.isConnected !== false && !boton.disabled;

  const quitarLocales = [];
  const mantener = (boton, dir) => {
    const abajo = () => {
      parar(); // un segundo dedo (o el otro botón) reemplaza la repetición anterior: nunca quedan dos
      haptic('tap'); fijar(valor + dir * paso);
      escucharGlobal(doc, 'pointerup', parar);
      escucharGlobal(doc, 'pointercancel', parar);
      escucharGlobal(doc, 'visibilitychange', alOcultar);
      t = setTimeout(() => {
        if (!sigueVivo(boton)) return parar();
        r = setInterval(() => {
          if (!sigueVivo(boton)) return parar();
          fijar(valor + dir * paso);
        }, 90);
      }, 420);
    };
    const tecla = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); fijar(valor + dir * paso); } };
    const pares = [['pointerdown', abajo], ['keydown', tecla]];
    for (const e of ['pointerup', 'pointerleave', 'pointercancel', 'lostpointercapture', 'blur']) pares.push([e, parar]);
    for (const [e, fn] of pares) {
      boton.addEventListener(e, fn);
      quitarLocales.push(() => boton.removeEventListener(e, fn));
    }
  };
  if (dec) mantener(dec, -1);
  if (inc) mantener(inc, 1);
  pintar();
  return {
    valor: () => valor,
    fijar: (v) => fijar(v, true),
    /** Detiene cualquier repetición y quita todos los listeners (llamar en desmontar). */
    destruir() { parar(); while (quitarLocales.length) quitarLocales.pop()(); },
  };
}

/** enlazarSegmentado(raiz, {alCambiar(indice, boton)}) — hijos <button>; usa aria-checked y flechas ← →. */
export function enlazarSegmentado(raiz, o = {}) {
  const botones = [...raiz.querySelectorAll(':scope > button')];
  raiz.setAttribute('role', 'radiogroup');
  const elegir = (i, delUsuario) => {
    botones.forEach((b, j) => { b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', j === i ? 'true' : 'false'); b.tabIndex = j === i ? 0 : -1; });
    if (delUsuario) { haptic('select'); if (o.alCambiar) o.alCambiar(i, botones[i]); }
  };
  botones.forEach((b, i) => {
    b.addEventListener('click', () => elegir(i, true));
    b.addEventListener('keydown', (ev) => {
      const d = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      ev.preventDefault();
      const n = (i + d + botones.length) % botones.length; elegir(n, true); botones[n].focus();
    });
  });
  const actual = botones.findIndex((b) => b.getAttribute('aria-checked') === 'true' || b.classList.contains('is-active'));
  elegir(actual < 0 ? 0 : actual, false);
  return { elegir: (i) => elegir(i, false) };
}
