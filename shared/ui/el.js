/*
 * el.js — DOM seguro para shared/ui (módulo ES, sin efectos al importar).
 * REGLA: nada en shared/ui usa innerHTML. Todo texto entra por textContent / nodos de texto.
 * Mismas protecciones que h()/hSvg() de shared/lib/dom.js (R0-11): etiquetas prohibidas, atributos on* solo como
 * función, URL (href/src/xlink:href/action…) validadas con esUrlSegura, sin innerHTML/srcdoc y sin url(...) en style.
 * API propia (se mantiene): `text`, `class` como arreglo, `dataset`, `style` objeto, `onClick`/`onclick` = función.
 * Para las vistas de las apps, la vía documentada es h()/hSvg() de shared/lib/dom.js.
 */
import { esUrlSegura } from '../lib/dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ETIQUETAS_PROHIBIDAS = new Set(['script', 'iframe', 'object', 'embed', 'frame', 'frameset', 'base', 'meta', 'link', 'style']);
const ATRIBUTOS_URL = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'data']);
const ATRIBUTOS_PROHIBIDOS = new Set(['html', 'innerhtml', 'outerhtml', 'srcdoc']);

function etiquetaPermitida(etiqueta) {
  if (ETIQUETAS_PROHIBIDAS.has(String(etiqueta).toLowerCase())) throw new Error(`el(): la etiqueta <${etiqueta}> no está permitida.`);
}

/** Atributo de texto con las reglas de h(): sin on* como texto, sin innerHTML/srcdoc, URL seguras, style sin url(). */
function atributoSeguro(nodo, k, v, svg = false) {
  const bajo = String(k).toLowerCase();
  const texto = v === true && !svg ? '' : String(v); // svgEl siempre usó String(v) (true → "true")
  if (ATRIBUTOS_PROHIBIDOS.has(bajo)) throw new Error(`el(): "${k}" no está permitido; use hijos o text.`);
  if (bajo.startsWith('on')) throw new Error(`el(): el atributo "${k}" como texto no está permitido; pase una función.`);
  if (ATRIBUTOS_URL.has(bajo) && !esUrlSegura(texto)) throw new Error(`el(): la URL de "${k}" no es segura: "${texto}".`);
  if (bajo === 'style' && /url\s*\(|expression\s*\(/i.test(texto)) throw new Error('el(): style como texto no admite url(...).');
  nodo.setAttribute(k, texto);
}

function anexar(nodo, hijos) {
  for (const c of hijos) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) anexar(nodo, c);
    else if (c.nodeType) nodo.appendChild(c);
    else nodo.appendChild(document.createTextNode(String(c)));
  }
}

function aplicar(nodo, attrs) {
  if (!attrs) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') nodo.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
    else if (k === 'text') nodo.textContent = String(v);
    else if (k === 'dataset') Object.assign(nodo.dataset, v);
    else if (k === 'style' && typeof v === 'object') for (const [p, val] of Object.entries(v)) nodo.style.setProperty(p, val);
    else if (k.startsWith('on') && typeof v === 'function') nodo.addEventListener(k.slice(2).toLowerCase(), v);
    else atributoSeguro(nodo, k, v);
  }
}

/** Crea un elemento HTML. Hijos: texto (siempre como texto), nodos o arreglos. */
export function el(etiqueta, attrs, ...hijos) {
  etiquetaPermitida(etiqueta);
  const nodo = document.createElement(etiqueta);
  aplicar(nodo, attrs);
  anexar(nodo, hijos);
  return nodo;
}

/** Crea un elemento SVG. Atributos de texto (con las mismas reglas); `on*` con función registra el evento. */
export function svgEl(etiqueta, attrs, ...hijos) {
  etiquetaPermitida(etiqueta);
  const bajo = String(etiqueta).toLowerCase();
  if (bajo === 'animate' || bajo === 'set' || bajo === 'foreignobject') throw new Error(`svgEl(): la etiqueta <${etiqueta}> no está permitida.`);
  const nodo = document.createElementNS(SVG_NS, etiqueta);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined) continue;
      if (k.startsWith('on') && typeof v === 'function') nodo.addEventListener(k.slice(2).toLowerCase(), v);
      else atributoSeguro(nodo, k, v, true);
    }
  }
  anexar(nodo, hijos);
  return nodo;
}

export function reducedMotion() {
  return !!(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/** Ejecuta fn dos fotogramas después (para que las transiciones CSS partan del estado inicial). */
export function siguienteFotograma(fn) {
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 16);
  raf(() => raf(fn));
}
