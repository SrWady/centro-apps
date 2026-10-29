/*
 * graficos.js — gráficos SVG animados (anillo, dona, barras, línea, minilínea). Sin dependencias.
 * Todos devuelven un nodo con role="img" + aria-label (pase siempre `etiqueta`). Con movimiento reducido no animan.
 * Los colores se pasan como cadenas CSS ('var(--cat-needs)'); se aplican por style, nunca por concatenar HTML.
 */
import { el, svgEl, reducedMotion, siguienteFotograma } from './el.js';

function envolver(clase, svg, centro, tam) {
  const w = el('div', { class: clase, style: { width: tam + 'px', height: tam + 'px' } }, svg);
  if (centro) w.appendChild(el('div', { class: clase + '__center' }, centro));
  return w;
}
function accesible(svg, etiqueta) {
  svg.setAttribute('role', 'img');
  if (etiqueta) { svg.setAttribute('aria-label', etiqueta); svg.appendChild(svgEl('title', null, etiqueta)); }
}
function entrar(nodos) {
  const quitar = () => nodos.forEach((n) => n.classList.remove('is-pre'));
  if (reducedMotion()) quitar(); else siguienteFotograma(quitar);
}
const centroDe = (c) => (typeof c === 'string' ? el('span', { class: 'ring__value' }, c) : c);
/** R0-14: valores no finitos (NaN de 0/0, undefined) se dibujan como 0 o se omiten, nunca como atributo "NaN". */
const finito = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const esPunto = (p) => typeof p === 'number' && Number.isFinite(p);

/** anillo({tam, trazo, valor(0..1), color, centro(Node|texto), etiqueta}) -> div.ring con actualizar(v) */
export function anillo(o) {
  const tam = o.tam || 96, trazo = o.trazo || 10, r = (tam - trazo) / 2, c = 2 * Math.PI * r;
  const svg = svgEl('svg', { viewBox: `0 0 ${tam} ${tam}`, width: tam, height: tam });
  const pista = svgEl('circle', { class: 'ring__track', cx: tam / 2, cy: tam / 2, r, 'stroke-width': trazo });
  const relleno = svgEl('circle', { class: 'ring__fill', cx: tam / 2, cy: tam / 2, r, 'stroke-width': trazo, 'stroke-dasharray': c, 'stroke-dashoffset': c, transform: `rotate(-90 ${tam / 2} ${tam / 2})` });
  if (o.color) relleno.style.setProperty('stroke', o.color);
  svg.append(pista, relleno); accesible(svg, o.etiqueta);
  const nodo = envolver('ring', svg, centroDe(o.centro), tam);
  const fijar = (v) => relleno.setAttribute('stroke-dashoffset', c * (1 - Math.max(0, Math.min(1, finito(v))))); // R0-14: 0/0 → 0
  nodo.actualizar = fijar;
  if (reducedMotion()) { relleno.style.transition = 'none'; fijar(o.valor || 0); } else siguienteFotograma(() => fijar(o.valor || 0));
  return nodo;
}

/**
 * dona({tam, trazo, hueco, anillos:[{trazo?, segmentos:[{valor, color, etiqueta}]}], centro, etiqueta})
 * Varios anillos concéntricos (exterior = real, interior = meta). Los valores se normalizan por anillo.
 */
export function dona(o) {
  const tam = o.tam || 180, hueco = o.hueco ?? 2, anillos = o.anillos || [{ segmentos: o.segmentos }];
  const svg = svgEl('svg', { viewBox: `0 0 ${tam} ${tam}`, width: tam, height: tam });
  const segs = [], cx = tam / 2; let desplazo = 0;
  for (const anillo_ of anillos) {
    const trazo = anillo_.trazo || o.trazo || 22, r = cx - trazo / 2 - desplazo, c = 2 * Math.PI * r;
    svg.appendChild(svgEl('circle', { class: 'donut__track', cx, cy: cx, r, 'stroke-width': trazo }));
    const total = anillo_.segmentos.reduce((s, x) => s + x.valor, 0) || 1; let acum = 0;
    for (const s of anillo_.segmentos) {
      const largo = Math.max(0, (s.valor / total) * c - hueco);
      const arco = svgEl('circle', { class: 'donut__seg', cx, cy: cx, r, 'stroke-width': trazo, 'stroke-dasharray': `0 ${c}`, 'stroke-dashoffset': (-acum * c) / total, transform: `rotate(-90 ${cx} ${cx})` });
      arco.style.setProperty('stroke', s.color);
      arco.appendChild(svgEl('title', null, s.etiqueta || ''));
      arco.dataset.largo = String(largo); arco.dataset.c = String(c);
      svg.appendChild(arco); segs.push(arco); acum += s.valor;
    }
    desplazo += trazo + 6;
  }
  accesible(svg, o.etiqueta);
  const nodo = envolver('donut', svg, centroDe(o.centro), tam);
  const aplicar = () => segs.forEach((s) => s.setAttribute('stroke-dasharray', `${s.dataset.largo} ${s.dataset.c}`));
  if (reducedMotion()) aplicar(); else siguienteFotograma(aplicar);
  return nodo;
}

/** barras({datos:[{etiqueta, valor, resaltar, atenuar, etiquetaValor}], alto, max, color, etiquetaAccesible}) -> <svg> */
export function barras(o) {
  const datos = o.datos, n = datos.length, alto = o.alto || 150, ancho1 = 44, ancho = n * ancho1, arriba = 18, abajo = 22, ch = alto - arriba - abajo;
  const max = o.max || Math.max(...datos.map((d) => d.valor), 1);
  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${ancho} ${alto}` });
  for (const f of [0.5, 1]) svg.appendChild(svgEl('line', { class: 'chart__grid', x1: 0, x2: ancho, y1: arriba + ch * (1 - f), y2: arriba + ch * (1 - f) }));
  svg.appendChild(svgEl('line', { class: 'chart__axis', x1: 0, x2: ancho, y1: arriba + ch, y2: arriba + ch }));
  const rects = [];
  datos.forEach((d, i) => {
    const bh = Math.max(d.valor > 0 ? 3 : 0, (d.valor / max) * ch), bw = ancho1 * 0.5, x = i * ancho1 + (ancho1 - bw) / 2;
    const r = svgEl('rect', { class: 'bars__rect is-pre' + (d.resaltar ? ' is-hl' : '') + (d.atenuar ? ' is-muted' : ''), x, y: arriba + ch - bh, width: bw, height: bh, rx: 5 });
    r.style.setProperty('--i', String(i));
    if (o.color && !d.atenuar) r.style.setProperty('--bar-fill', o.color);
    r.appendChild(svgEl('title', null, `${d.etiqueta}: ${d.etiquetaValor || d.valor}`));
    svg.appendChild(r); rects.push(r);
    svg.appendChild(svgEl('text', { x: i * ancho1 + ancho1 / 2, y: alto - 6, 'text-anchor': 'middle' }, d.etiqueta));
    if (d.etiquetaValor && d.valor > 0) svg.appendChild(svgEl('text', { class: 'chart__val', x: i * ancho1 + ancho1 / 2, y: arriba + ch - bh - 5, 'text-anchor': 'middle' }, d.etiquetaValor));
  });
  accesible(svg, o.etiquetaAccesible); entrar(rects);
  return svg;
}

/**
 * linea({series:[{nombre, color, puntos:[n|null], discontinua}], etiquetas, alto, min, max, area, etiquetaAccesible, formato})
 * Trazo animado; el último punto lleva marcador. Varias series permitidas (con leyenda externa en HTML).
 */
export function linea(o) {
  const etiquetas = o.etiquetas || [], n = Math.max(...o.series.map((s) => s.puntos.length)), alto = o.alto || 160, ancho = 320, pad = 18, arriba = 14, abajo = 24, ch = alto - arriba - abajo;
  const todos = o.series.flatMap((s) => s.puntos.filter(esPunto));
  let min = o.min ?? (todos.length ? Math.min(...todos) : 0), max = o.max ?? (todos.length ? Math.max(...todos) : 1);
  if (max === min) { max += 1; min -= 1; }
  const x = (i) => (n === 1 ? ancho / 2 : pad + (i * (ancho - 2 * pad)) / (n - 1));
  const y = (v) => arriba + ch * (1 - (v - min) / (max - min));
  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${ancho} ${alto}` });
  for (const f of [0, 0.5, 1]) svg.appendChild(svgEl('line', { class: 'chart__grid', x1: 0, x2: ancho, y1: arriba + ch * f, y2: arriba + ch * f }));
  etiquetas.forEach((l, i) => svg.appendChild(svgEl('text', { x: x(i), y: alto - 6, 'text-anchor': 'middle' }, l)));
  const previos = [];
  o.series.forEach((s, si) => {
    let d = '', iniciada = false, ultimo = -1;
    s.puntos.forEach((p, i) => { if (!esPunto(p)) { iniciada = false; return; } d += `${iniciada ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p).toFixed(1)}`; iniciada = true; ultimo = i; });
    const color = s.color || `var(--series-${si + 1})`;
    if (o.area && si === 0 && s.puntos.length > 1 && ultimo >= 0) {
      const area = svgEl('path', { class: 'line__area is-pre', d: `${d}L${x(ultimo).toFixed(1)} ${arriba + ch}L${x(0).toFixed(1)} ${arriba + ch}Z` });
      area.style.setProperty('--line-color', color); svg.appendChild(area); previos.push(area);
    }
    if (d) {
      const trazo = svgEl('path', { class: 'line__path is-pre' + (s.discontinua ? ' line__path--dashed' : ''), d, pathLength: 1 });
      trazo.style.setProperty('--line-color', color); svg.appendChild(trazo); previos.push(trazo);
    }
    if (ultimo >= 0) {
      const punto = svgEl('circle', { class: 'line__dot is-pre', cx: x(ultimo), cy: y(s.puntos[ultimo]), r: 4.5 });
      punto.style.setProperty('--line-color', color);
      punto.appendChild(svgEl('title', null, `${s.nombre}: ${o.formato ? o.formato(s.puntos[ultimo]) : s.puntos[ultimo]}`));
      svg.appendChild(punto); previos.push(punto);
    }
  });
  accesible(svg, o.etiquetaAccesible); entrar(previos);
  return svg;
}

/** minilinea(puntos, {ancho, alto, color, etiqueta}) -> <svg> pequeño sin ejes */
export function minilinea(puntos, o = {}) {
  const ancho = o.ancho || 96, alto = o.alto || 32, validos = puntos.filter(esPunto);
  let min = validos.length ? Math.min(...validos) : 0, max = validos.length ? Math.max(...validos) : 1;
  if (max === min) { max += 1; min -= 1; }
  let d = '', iniciada = false; // un punto que falta corta el trazo (igual que linea), sin NaN
  puntos.forEach((p, i) => {
    if (!esPunto(p)) { iniciada = false; return; }
    d += `${iniciada ? 'L' : 'M'}${(2 + (i * (ancho - 4)) / Math.max(1, puntos.length - 1)).toFixed(1)} ${(2 + (alto - 4) * (1 - (p - min) / (max - min))).toFixed(1)}`;
    iniciada = true;
  });
  const svg = svgEl('svg', { viewBox: `0 0 ${ancho} ${alto}`, width: ancho, height: alto });
  const trazo = svgEl('path', { class: 'line__path is-pre', d, pathLength: 1 });
  if (o.color) trazo.style.setProperty('--line-color', o.color);
  svg.appendChild(trazo); accesible(svg, o.etiqueta); entrar([trazo]);
  return svg;
}
