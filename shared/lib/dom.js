/*
 * dom.js — creación segura de nodos. Contrato: docs/UTILIDADES.md §10.
 * El texto de los hijos entra SIEMPRE como nodo de texto (nunca HTML). Se lanza Error (error de programación) ante
 * innerHTML/outerHTML, atributos on* como texto, o href/src/action que no pasen esUrlSegura. Sin efectos al importar:
 * h() y hSvg() usan globalThis.document al llamarse; crearDom({ documento }) permite inyectarlo (pruebas).
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const ETIQUETAS_PROHIBIDAS = new Set(['script', 'iframe', 'object', 'embed']);
const ATRIBUTOS_URL = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'data']);
const ATRIBUTOS_PROHIBIDOS = new Set(['innerhtml', 'outerhtml', 'srcdoc']);
const PROPS_BOOLEANAS = ['disabled', 'checked', 'hidden'];

/**
 * PURO. Relativa ('./x', '../x', '#ancla', 'pagina.html'), 'blob:' o 'data:image/'. Rechaza cualquier otro esquema
 * (javascript:, data:text/html, http:, https:, mailto:…), las rutas que empiezan con '/' (rompen en GitHub Pages) y las
 * protocolo-relativas ('//otro.sitio'). Ignora espacios y caracteres de control que los navegadores descartan.
 */
export function esUrlSegura(url) {
  if (typeof url !== 'string') return false;
  // Quita los caracteres de control y los espacios (incluidos los Unicode) que los navegadores ignoran dentro de una URL.
  const ignorados = (k) =>
    k <= 0x20 || (k >= 0x7f && k <= 0xa0) || k === 0x1680 || k === 0x180e || (k >= 0x2000 && k <= 0x200d) ||
    k === 0x2028 || k === 0x2029 || k === 0x202f || k === 0x205f || k === 0x2060 || k === 0x3000 || k === 0xfeff;
  const limpia = Array.from(url).filter((c) => !ignorados(c.codePointAt(0))).join('');
  if (limpia === '') return false;
  const minuscula = limpia.toLowerCase();
  if (minuscula.startsWith('blob:') || minuscula.startsWith('data:image/')) return true;
  if (/^[/\\]/.test(limpia)) return false;
  const finEsquema = limpia.search(/[/?#]/);
  const cabeza = finEsquema === -1 ? limpia : limpia.slice(0, finEsquema);
  return !cabeza.includes(':');
}

function kebab(clave) {
  return clave.startsWith('--') || clave.includes('-') ? clave : clave.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

function fijarAtributo(nodo, nombre, valor) {
  if (valor === null || valor === undefined || valor === false) return;
  const bajo = String(nombre).toLowerCase();
  if (ATRIBUTOS_PROHIBIDOS.has(bajo)) throw new Error(`dom: "${nombre}" no está permitido; use hijos de texto.`);
  if (/^on/.test(bajo)) throw new Error(`dom: el atributo "${nombre}" como texto no está permitido; use la propiedad "on".`);
  const texto = valor === true ? '' : String(valor);
  if (ATRIBUTOS_URL.has(bajo) && !esUrlSegura(texto)) throw new Error(`dom: la URL de "${nombre}" no es segura: "${texto}".`);
  nodo.setAttribute(nombre, texto);
}

function aplicarPropiedades(nodo, props, esSvg) {
  if (props === null || props === undefined) return;
  if (typeof props !== 'object' || Array.isArray(props)) throw new TypeError('dom: props debe ser un objeto o null.');
  for (const [clave, valor] of Object.entries(props)) {
    switch (clave) {
      case 'text':
      case 'html':
        throw new Error(`dom: la propiedad "${clave}" no existe en h(); el texto va como hijo (h('p', null, texto)).`);
      case 'class':
        if (valor) nodo.setAttribute('class', Array.isArray(valor) ? valor.filter(Boolean).join(' ') : String(valor));
        break;
      case 'value':
        if (valor !== null && valor !== undefined) {
          if (esSvg) fijarAtributo(nodo, 'value', valor);
          else nodo.value = String(valor);
        }
        break;
      case 'disabled':
      case 'checked':
      case 'hidden':
        if (esSvg) fijarAtributo(nodo, clave, valor ? true : null);
        else nodo[clave] = !!valor;
        break;
      case 'tabIndex':
        if (valor !== null && valor !== undefined) {
          if (esSvg) fijarAtributo(nodo, 'tabindex', valor);
          else nodo.tabIndex = Number(valor);
        }
        break;
      case 'dataset':
        for (const [k, v] of Object.entries(valor ?? {})) if (v !== null && v !== undefined) nodo.dataset[k] = String(v);
        break;
      case 'aria':
        for (const [k, v] of Object.entries(valor ?? {})) if (v !== null && v !== undefined) nodo.setAttribute('aria-' + k, String(v));
        break;
      case 'attrs':
        for (const [k, v] of Object.entries(valor ?? {})) fijarAtributo(nodo, k, v);
        break;
      case 'style':
        if (valor === null || valor === undefined) break;
        if (typeof valor !== 'object') throw new TypeError('dom: style debe ser un objeto { propiedad: valor }.');
        for (const [k, v] of Object.entries(valor)) if (v !== null && v !== undefined) nodo.style.setProperty(kebab(k), String(v));
        break;
      case 'on':
        for (const [evento, manejador] of Object.entries(valor ?? {})) {
          const [fn, opciones] = Array.isArray(manejador) ? manejador : [manejador];
          if (typeof fn !== 'function') throw new TypeError(`dom: el manejador de "${evento}" debe ser una función.`);
          nodo.addEventListener(evento, fn, opciones);
        }
        break;
      default:
        fijarAtributo(nodo, clave, valor); // title, placeholder, for, href…: cualquier otro es un atributo (con las mismas reglas)
    }
  }
}

function anexar(documento, nodo, hijos) {
  for (const hijo of hijos) {
    if (hijo === null || hijo === undefined || hijo === false || hijo === true) continue;
    if (Array.isArray(hijo)) anexar(documento, nodo, hijo);
    else if (typeof hijo === 'string' || typeof hijo === 'number' || typeof hijo === 'bigint') nodo.appendChild(documento.createTextNode(String(hijo)));
    else if (typeof hijo === 'object' && typeof hijo.nodeType === 'number') nodo.appendChild(hijo);
    else throw new TypeError('dom: un hijo debe ser texto, número, nodo, arreglo o null/false.');
  }
}

function etiquetaValida(etiqueta) {
  if (typeof etiqueta !== 'string' || !/^[a-zA-Z][a-zA-Z0-9:-]*$/.test(etiqueta)) throw new TypeError('dom: etiqueta inválida.');
  if (ETIQUETAS_PROHIBIDAS.has(etiqueta.toLowerCase())) throw new Error(`dom: la etiqueta <${etiqueta}> no está permitida.`);
}

/** Constructor ligado a un `documento` concreto (por defecto, el del navegador al momento de usarse). */
export function crearDom({ documento } = {}) {
  const doc = () => documento ?? globalThis.document;
  return {
    h(etiqueta, props = null, ...hijos) {
      etiquetaValida(etiqueta);
      const nodo = doc().createElement(etiqueta);
      aplicarPropiedades(nodo, props, false);
      anexar(doc(), nodo, hijos);
      return nodo;
    },
    hSvg(etiqueta, attrs = null, ...hijos) {
      etiquetaValida(etiqueta);
      const nodo = doc().createElementNS(SVG_NS, etiqueta);
      aplicarPropiedades(nodo, attrs, true);
      anexar(doc(), nodo, hijos);
      return nodo;
    },
    vaciar(nodo) {
      while (nodo.firstChild) nodo.removeChild(nodo.firstChild);
      return nodo;
    },
  };
}

const porDefecto = crearDom();

/** Crea un HTMLElement. Hijos string/number → texto; null/false/undefined se ignoran; arreglos se aplanan. */
export function h(etiqueta, props = null, ...hijos) {
  return porDefecto.h(etiqueta, props, ...hijos);
}

/** Crea un SVGElement (createElementNS). */
export function hSvg(etiqueta, attrs = null, ...hijos) {
  return porDefecto.hSvg(etiqueta, attrs, ...hijos);
}

/** Quita todos los hijos de un nodo. */
export function vaciar(nodo) {
  return porDefecto.vaciar(nodo);
}
