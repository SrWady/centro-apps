/*
 * teclado.js — teclado numérico propio (grande, 56 px por tecla).
 * crearTeclado({decimal, maxDigitos, maxDecimales, valor, alCambiar(valor), alEnviar(valor), teclado}) ->
 *   { el, valor(), fijar(v), limpiar(), destruir() }
 * `valor` es una cadena con '.' como decimal interno ('' si vacío). La conversión a entero/decimal y el dinero
 * son de shared/lib (dinero.js / numeros.js); aquí solo se teclea y se muestra.
 * decimal:false -> tecla auxiliar "000" (pesos). decimal:true -> coma (kg, km).
 * maxDigitos por defecto: 12 en pesos (como dinero.agregarDigitos), 10 con decimal.
 * Teclado físico (teclado !== false): ignora las teclas escritas en input/textarea/select/contenteditable, con
 * Ctrl/Alt/Meta o en composición; Enter envía solo con el foco dentro del teclado o en el body. Llame destruir() al
 * desmontar la vista (quita el listener de document).
 */
import { el } from './el.js';
import { icono } from './icono.js';
import { haptic } from './haptica.js';

/** Formato mientras se teclea (es-CO): "1234.5" -> "1.234,5". Solo presentación. */
export function formatoTecleado(v) {
  if (!v) return '';
  const [ent, dec] = String(v).split('.');
  const agrupado = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec === undefined ? agrupado : `${agrupado},${dec}`;
}

/** ¿El evento viene de un campo donde el usuario escribe texto? (input, textarea, select o contenteditable) */
function esCampoDeTexto(objetivo) {
  if (!objetivo || objetivo.nodeType !== 1) return false;
  if (objetivo.isContentEditable === true) return true;
  return typeof objetivo.closest === 'function' && !!objetivo.closest('input, textarea, select');
}

export function crearTeclado(o = {}) {
  let valor = o.valor ? String(o.valor) : '';
  // Tope por defecto: 12 dígitos en pesos (igual que dinero.agregarDigitos, R0-19); 10 con decimales (kg, km).
  const maxDigitos = o.maxDigitos || (o.decimal ? 10 : 12), maxDecimales = o.maxDecimales ?? 2;
  const nodo = el('div', { class: 'numpad', role: 'group', 'aria-label': 'Teclado numérico' });
  const cambio = () => { if (o.alCambiar) o.alCambiar(valor); };

  const pulsar = (k, boton) => {
    const digitos = valor.replace('.', '').length;
    if (k === 'borrar') valor = valor.slice(0, -1);
    else if (k === 'limpiar') valor = '';
    else if (k === ',') { if (!valor.includes('.')) valor = (valor || '0') + '.'; }
    else {
      if (valor.includes('.') && valor.split('.')[1].length + k.length > maxDecimales) { haptic('warning', boton); return; }
      if (digitos + k.length > maxDigitos) { haptic('warning', boton); return; }
      if (!valor && (k === '0' || k === '000')) { haptic('tap'); return; }
      if (valor === '0') valor = '';
      valor += k;
    }
    haptic('tap');
    cambio();
  };

  let mantenido = null;
  const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', o.decimal ? ',' : '000', '0', 'borrar'];
  for (const k of teclas) {
    const esBorrar = k === 'borrar';
    const boton = el('button', {
      type: 'button', class: 'numpad__key' + (k === '000' || k === ',' || esBorrar ? ' numpad__key--aux' : ''), 'data-key': k,
      'aria-label': esBorrar ? 'Borrar' : k === '000' ? 'Tres ceros' : k === ',' ? 'Coma decimal' : k
    }, esBorrar ? icono('backspace') : k);
    boton.addEventListener('click', () => { if (esBorrar && mantenido === 'disparado') { mantenido = null; return; } pulsar(k, boton); });
    if (esBorrar) { // mantener pulsado: limpiar todo
      boton.addEventListener('pointerdown', () => {
        // R0-20: un segundo dedo no deja el primer temporizador huérfano, y un 'disparado' viejo no bloquea este toque.
        if (mantenido && mantenido !== 'disparado') clearTimeout(mantenido);
        mantenido = setTimeout(() => { mantenido = 'disparado'; pulsar('limpiar', boton); }, 550);
      });
      const cancelar = () => { if (mantenido && mantenido !== 'disparado') { clearTimeout(mantenido); mantenido = null; } };
      for (const e of ['pointerup', 'pointerleave', 'pointercancel']) boton.addEventListener(e, cancelar);
    }
    nodo.appendChild(boton);
  }

  // R0-04: el teclado físico solo se usa si el usuario NO está escribiendo en un campo de texto (nota, búsqueda…),
  // sin modificadores (Ctrl/Alt/Meta = atajos) ni composición (IME). Enter solo envía con el foco en el teclado o el body.
  const alTeclear = (ev) => {
    if (!nodo.isConnected || ev.defaultPrevented || ev.isComposing || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const objetivo = ev.target;
    if (esCampoDeTexto(objetivo)) return;
    if (/^[0-9]$/.test(ev.key)) pulsar(ev.key);
    else if ((ev.key === ',' || ev.key === '.') && o.decimal) pulsar(',');
    else if (ev.key === 'Backspace') pulsar('borrar');
    else if (ev.key === 'Enter' && o.alEnviar) {
      const doc = nodo.ownerDocument || globalThis.document;
      const enFoco = !objetivo || objetivo === doc || objetivo === doc.body || objetivo === doc.documentElement || nodo.contains(objetivo);
      if (!enFoco) return;
      ev.preventDefault();
      o.alEnviar(valor);
    }
  };
  if (o.teclado !== false) document.addEventListener('keydown', alTeclear);

  return {
    el: nodo,
    valor: () => valor,
    fijar(v) { valor = v ? String(v) : ''; cambio(); },
    limpiar() { valor = ''; cambio(); },
    destruir() { document.removeEventListener('keydown', alTeclear); }
  };
}
