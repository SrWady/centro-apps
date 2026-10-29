/*
 * haptica.js — haptic(tipo[, elemento]).
 * Android: vibrar() de shared/lib/dispositivo.js (navigator.vibrate). iPhone/Safari (sin vibración, H6): pulso visual
 * sobre `elemento` o destello de borde. Con prefers-reduced-motion el pulso es un contorno breve sin animación.
 * Tipos: tap | select | success | serie | warning | error | pr | descanso.
 */
import { vibrar } from '../lib/dispositivo.js';
import { el, reducedMotion } from './el.js';

const PATRONES = { tap: 10, select: 8, success: 15, serie: 15, warning: [30, 50, 30], error: [40, 60, 40], pr: [20, 40, 20], descanso: [200, 100, 200] };
const CLASE = { success: 'fx-pulse--ok', serie: 'fx-pulse--ok', pr: 'fx-pulse--ok', warning: 'fx-pulse--warn', descanso: 'fx-pulse--warn', error: 'fx-pulse--danger' };
const estado = { activa: true };

/** Activa o desactiva toda la háptica (vibración y pulso) según el ajuste del usuario. */
export function configurarHaptica({ activa }) { estado.activa = !!activa; }

/** @returns {'vibrate'|'visual'|'off'} */
export function haptic(tipo, objetivo) {
  if (!estado.activa) return 'off';
  let vibro = false;
  try { vibro = vibrar(PATRONES[tipo] ?? PATRONES.tap) === true; } catch { vibro = false; }
  if (vibro) return 'vibrate';
  const suave = tipo === 'tap' || tipo === 'select';
  const cls = CLASE[tipo] || '';
  if (objetivo && objetivo.classList) {
    objetivo.classList.remove('fx-pulse', 'fx-pulse--ok', 'fx-pulse--warn', 'fx-pulse--danger');
    void objetivo.offsetWidth; // reinicia la animación
    objetivo.classList.add('fx-pulse');
    if (cls) objetivo.classList.add(cls);
    // R0-10: DOMTokenList lanza SyntaxError con el token vacío (tap/select/tipo desconocido no tienen clase extra).
    setTimeout(() => objetivo.classList.remove('fx-pulse', ...(cls ? [cls] : [])), reducedMotion() ? 320 : 560);
  } else if (!suave) {
    const destello = el('div', { class: 'fx-flash ' + cls, 'aria-hidden': 'true' });
    document.body.appendChild(destello);
    setTimeout(() => destello.remove(), 400);
  }
  return 'visual';
}
