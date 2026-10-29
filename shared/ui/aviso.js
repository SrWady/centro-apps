/* aviso.js — toasts (mensajes breves). Texto siempre como texto. */
import { el, reducedMotion } from './el.js';

let anfitrion = null;

/**
 * mostrarAviso(mensaje, {tipo: 'ok'|'warn'|'danger', accion:{etiqueta, alPulsar}, duracion}) -> función para descartar
 */
export function mostrarAviso(mensaje, o = {}) {
  if (!anfitrion || !anfitrion.isConnected) {
    anfitrion = el('div', { class: 'toasts', 'aria-live': 'polite', 'aria-atomic': 'false' });
    document.body.appendChild(anfitrion);
  }
  let ido = false;
  const descartar = () => {
    if (ido) return; ido = true; aviso.classList.add('is-leaving');
    setTimeout(() => aviso.remove(), reducedMotion() ? 0 : 240);
  };
  const aviso = el('div', { class: 'toast' + (o.tipo ? ' toast--' + o.tipo : ''), role: 'status' },
    el('span', null, mensaje),
    o.accion ? el('button', { class: 'toast__action', type: 'button', onclick: () => { try { o.accion.alPulsar(); } finally { descartar(); } } }, o.accion.etiqueta) : null);
  anfitrion.appendChild(aviso);
  setTimeout(descartar, o.duracion || 4000);
  return descartar;
}
