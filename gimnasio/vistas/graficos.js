/*
 * graficos.js — extensión LOCAL de Gimnasio: barras agrupadas (dos personas por categoría), con las mismas clases CSS del
 * sistema de diseño (.chart, .bars__rect…). shared/ui/graficos.js solo traza una serie; si se unifica allí, esto se retira.
 */
import { hSvg } from '../../shared/lib/dom.js';
import { reducedMotion, siguienteFotograma } from '../../shared/ui/el.js';

/**
 * @param {{ etiquetas: string[], series: {nombre:string, color:string, valores:number[]}[], alto?:number, max?:number, etiquetaAccesible:string, resaltar?:number, unidad?:string }} o
 * @returns {SVGElement} <svg role="img"> con un <title> accesible por barra
 */
export function barrasAgrupadas({ etiquetas, series, alto = 168, max, etiquetaAccesible, resaltar = -1, unidad = 'kg' }) {
  const n = etiquetas.length;
  const ancho1 = 44;
  const ancho = n * ancho1;
  const arriba = 14;
  const abajo = 22;
  const ch = alto - arriba - abajo;
  const tope = max || Math.max(1, ...series.flatMap((s) => s.valores));
  const svg = hSvg('svg', { class: 'chart', viewBox: `0 0 ${ancho} ${alto}`, role: 'img', 'aria-label': etiquetaAccesible });
  svg.appendChild(hSvg('title', null, etiquetaAccesible));
  for (const f of [0.5, 1]) svg.appendChild(hSvg('line', { class: 'chart__grid', x1: 0, x2: ancho, y1: arriba + ch * (1 - f), y2: arriba + ch * (1 - f) }));
  svg.appendChild(hSvg('line', { class: 'chart__axis', x1: 0, x2: ancho, y1: arriba + ch, y2: arriba + ch }));
  const k = series.length;
  const bw = k === 1 ? ancho1 * 0.5 : (ancho1 - 10) / k;
  const rects = [];
  etiquetas.forEach((et, i) => {
    series.forEach((s, j) => {
      const v = s.valores[i] ?? 0;
      const bh = Math.max(v > 0 ? 3 : 0, (v / tope) * ch);
      const x = i * ancho1 + (ancho1 - bw * k) / 2 + j * bw;
      const r = hSvg('rect', { class: 'bars__rect is-pre', x, y: arriba + ch - bh, width: Math.max(bw - (k > 1 ? 2 : 0), 2), height: bh, rx: 4 });
      r.style.setProperty('--i', String(i));
      r.style.setProperty('--bar-fill', s.color);
      r.appendChild(hSvg('title', null, `${et} · ${s.nombre}: ${Math.round(v)} ${unidad}`));
      svg.appendChild(r);
      rects.push(r);
    });
    svg.appendChild(hSvg('text', { x: i * ancho1 + ancho1 / 2, y: alto - 6, 'text-anchor': 'middle', class: i === resaltar ? 'chart__val' : '' }, et));
  });
  const quitar = () => rects.forEach((r) => r.classList.remove('is-pre'));
  if (reducedMotion()) quitar(); else siguienteFotograma(quitar);
  return svg;
}
