/* confeti.js — confeti de récord personal (piezas DOM, sin canvas). Con movimiento reducido no hace nada: muestre la insignia PR igualmente. */
import { el, reducedMotion } from './el.js';

/** confeti({x, y, cantidad}) -> boolean (false si se omitió por movimiento reducido) */
export function confeti(o = {}) {
  if (reducedMotion()) return false;
  const capa = el('div', { class: 'confetti-layer', 'aria-hidden': 'true' });
  const colores = ['var(--accent)', 'var(--warn)', 'var(--ok)', 'var(--info)', 'var(--danger)'];
  const cantidad = o.cantidad || 36, W = window.innerWidth || 400, H = window.innerHeight || 800;
  for (let i = 0; i < cantidad; i++) {
    const p = el('span', { class: 'confetti-piece' });
    p.style.setProperty('--x', (o.x ?? W / 2) + 'px'); p.style.setProperty('--y', (o.y ?? H * 0.4) + 'px');
    p.style.setProperty('--c', colores[i % colores.length]);
    p.style.setProperty('--dx', ((Math.random() - 0.5) * W * 0.9).toFixed(0) + 'px');
    p.style.setProperty('--dy', (H * 0.25 + Math.random() * H * 0.45).toFixed(0) + 'px');
    p.style.setProperty('--r', ((Math.random() - 0.5) * 900).toFixed(0) + 'deg');
    p.style.setProperty('--d', Math.floor(Math.random() * 160) + 'ms');
    capa.appendChild(p);
  }
  document.body.appendChild(capa);
  setTimeout(() => capa.remove(), 1700);
  return true;
}
