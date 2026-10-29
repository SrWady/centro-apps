/* icono.js — construye el nodo <svg> de un ícono (ver iconos.js). Sin innerHTML. */
import { svgEl } from './el.js';
import { rutasDe } from './iconos.js';

/** icono(nombre[, {tam: 'sm'|'lg'}]) -> <svg class="icon">. Acepta íconos de UI y claves del catálogo (las guardadas en datos). */
export function icono(nombre, opts = {}) {
  const svg = svgEl('svg', { class: 'icon' + (opts.tam ? ' icon--' + opts.tam : ''), viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
  for (const d of rutasDe(nombre)) svg.appendChild(svgEl('path', { d }));
  return svg;
}
