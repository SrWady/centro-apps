/*
 * hoja.js — hojas inferiores (bottom sheets) y diálogo de confirmación.
 * abrirHoja(contenido, opts) -> { el, panel, cerrar(valor) }.  confirmar(opts) -> Promise<boolean>.
 * Se cierra con arrastre hacia abajo (desde el asa/cabecera), toque en el fondo, Esc o cerrar().
 * Todo texto (título, mensaje) se inserta como texto: es seguro con datos del usuario.
 */
import { el, reducedMotion, siguienteFotograma } from './el.js';
import { icono } from './icono.js';

const pila = [];
let contadorHojas = 0; // R0-23: id de título único aunque las hojas se cierren en otro orden

function enfocables(nodo) {
  return [...nodo.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])')];
}
function fondoInerte(on) {
  const app = document.querySelector('.app');
  if (app) { if (on) app.setAttribute('inert', ''); else app.removeAttribute('inert'); }
}

/**
 * @param {Node|Node[]} contenido  típicamente .sheet__body y .sheet__foot
 * @param {{titulo?:string, etiqueta?:string, alCerrar?:(valor:any)=>void, descartable?:boolean, instantanea?:boolean, enfocar?:string}} [opts]
 */
export function abrirHoja(contenido, opts = {}) {
  const previo = document.activeElement;
  const idTitulo = 'hoja-titulo-' + (contadorHojas += 1);
  let cerrando = false;
  const btnCerrar = opts.descartable === false ? null : el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Cerrar', onclick: () => ctrl.cerrar() }, icono('x'));
  const cabecera = (opts.titulo || btnCerrar) ? el('div', { class: 'sheet__head' }, el('h2', { class: 'sheet__title', id: idTitulo }, opts.titulo || ''), btnCerrar) : null;
  const asa = el('div', { class: 'sheet__grab', 'aria-hidden': 'true' });
  const panel = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }, asa, cabecera, contenido);
  if (opts.titulo) panel.setAttribute('aria-labelledby', idTitulo); else if (opts.etiqueta) panel.setAttribute('aria-label', opts.etiqueta);
  const fondo = el('div', { class: 'sheet-backdrop' });
  const capa = el('div', { class: 'sheet-layer' + (opts.instantanea ? ' is-instant' : '') }, fondo, panel);
  document.body.appendChild(capa);
  fondoInerte(true);

  const ctrl = {
    el: capa, panel,
    cerrar(valor) {
      if (cerrando) return; cerrando = true;
      const i = pila.indexOf(ctrl); if (i >= 0) pila.splice(i, 1);
      capa.classList.remove('is-open');
      panel.style.transform = '';
      const fin = () => {
        capa.remove();
        if (!pila.length) fondoInerte(false);
        if (previo && previo.focus) try { previo.focus(); } catch { /* sin foco */ }
        if (opts.alCerrar) opts.alCerrar(valor);
      };
      if (opts.instantanea || reducedMotion()) fin(); else setTimeout(fin, 300);
    }
  };
  pila.push(ctrl);

  if (opts.descartable !== false) {
    fondo.addEventListener('click', () => ctrl.cerrar());
    let y0 = null, yPrev = 0, tPrev = 0, vel = 0;
    const abajo = (ev) => {
      if (ev.target.closest && ev.target.closest('button')) return;
      y0 = ev.clientY; yPrev = y0; tPrev = ev.timeStamp; vel = 0;
      panel.classList.add('is-dragging');
      try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* ok */ }
    };
    const mover = (ev) => {
      if (y0 === null) return;
      const dt = ev.timeStamp - tPrev; if (dt > 0) vel = (ev.clientY - yPrev) / dt;
      yPrev = ev.clientY; tPrev = ev.timeStamp;
      panel.style.transform = `translateY(${Math.max(0, ev.clientY - y0)}px)`;
    };
    const arriba = (ev) => {
      if (y0 === null) return;
      const dy = Math.max(0, ev.clientY - y0); y0 = null;
      panel.classList.remove('is-dragging');
      if (dy > panel.offsetHeight * 0.28 || vel > 0.6) ctrl.cerrar(); else panel.style.transform = '';
    };
    for (const zona of [asa, cabecera]) {
      if (!zona) continue;
      zona.addEventListener('pointerdown', abajo); zona.addEventListener('pointermove', mover);
      zona.addEventListener('pointerup', arriba); zona.addEventListener('pointercancel', arriba);
    }
  }
  panel.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && opts.descartable !== false) { ev.stopPropagation(); ctrl.cerrar(); return; }
    if (ev.key !== 'Tab') return;
    const f = enfocables(panel); if (!f.length) return;
    const primero = f[0], ultimo = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === primero) { ev.preventDefault(); ultimo.focus(); }
    else if (!ev.shiftKey && document.activeElement === ultimo) { ev.preventDefault(); primero.focus(); }
  });
  const mostrar = () => {
    capa.classList.add('is-open');
    // foco inicial: opts.enfocar (selector) o el propio diálogo (evita un anillo de foco sobre un control al abrir)
    const destino = (opts.enfocar && panel.querySelector(opts.enfocar)) || panel;
    destino.focus({ preventScroll: true });
  };
  if (opts.instantanea) mostrar(); else siguienteFotograma(mostrar);
  return ctrl;
}

export function cerrarHojaSuperior(valor) {
  const s = pila[pila.length - 1];
  if (s) s.cerrar(valor);
}

/**
 * Diálogo de confirmación en hoja inferior.
 * @param {{titulo?:string, mensaje?:string, confirmar?:string, cancelar?:string, peligro?:boolean}} o
 * @returns {Promise<boolean>}
 */
export function confirmar(o = {}) {
  return new Promise((resolver) => {
    let respondido = false;
    const responder = (v) => { if (respondido) return; respondido = true; resolver(v); hoja.cerrar(v); };
    const cuerpo = el('div', { class: 'sheet__body stack' }, o.mensaje ? el('p', { class: 'muted' }, o.mensaje) : null);
    const pie = el('div', { class: 'sheet__foot' },
      el('button', { class: 'btn btn--secondary', type: 'button', onclick: () => responder(false) }, o.cancelar || 'Cancelar'),
      el('button', { class: 'btn' + (o.peligro ? ' btn--danger' : ''), type: 'button', onclick: () => responder(true) }, o.confirmar || 'Confirmar'));
    const hoja = abrirHoja([cuerpo, pie], { titulo: o.titulo || 'Confirmar', alCerrar: () => { if (!respondido) { respondido = true; resolver(false); } } });
  });
}
