/*
 * comun.js — piezas de interfaz compartidas por las vistas de Gimnasio (todo con h(): el texto del usuario entra como texto).
 */
import { h } from '../../shared/lib/dom.js';
import { formatearNumero } from '../../shared/lib/numeros.js';
import { icono } from '../../shared/ui/icono.js';
import { haptic } from '../../shared/ui/haptica.js';
import { enlazarStepper } from '../../shared/ui/controles.js';
import { abrirHoja } from '../../shared/ui/hoja.js';
import { crearTeclado, formatoTecleado } from '../../shared/ui/teclado.js';
import { mostrarAviso } from '../../shared/ui/aviso.js';

export function nombreDe(datos, personaId) {
  const p = datos.ajustes.personas.find((x) => x.id === personaId);
  return p ? p.nombre : personaId;
}

/**
 * Ejecuta una acción de la tienda; si la acción no aplica (error en español) lo muestra. Los fallos de guardado ya los avisa app.js.
 * Todas las acciones de Gimnasio son puras (se prueban con datos congelados en profundidad), así que se ejecutan con
 * `pura: true` y la tienda no copia todos los datos en cada guardado (R1-02). `opciones` se pasa tal cual (p. ej. conservarRespaldo).
 */
export function ejecutar(ctx, accion, payload, opciones = {}) {
  const r = ctx.tienda.ejecutar(accion, payload, { pura: true, ...opciones });
  if (!r.ok && r.error === 'accion') mostrarAviso(r.mensaje, { tipo: 'warn' });
  return r;
}

/**
 * Selector segmentado (radiogrupo). opciones: [{ valor, texto }]. Con permitirNinguno se puede desmarcar (valor null).
 * @returns {HTMLElement & { fijar(valor): void }}
 */
export function segmentado({ etiqueta, opciones, valor, alElegir, clase = '', permitirNinguno = false }) {
  let actual = valor ?? null;
  const botones = opciones.map((o, i) =>
    h('button', {
      type: 'button', role: 'radio', aria: { checked: 'false' },
      on: {
        click: () => elegir(o.valor, true),
        keydown: (ev) => {
          const d = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
          if (!d) return;
          ev.preventDefault();
          const n = (i + d + opciones.length) % opciones.length;
          elegir(opciones[n].valor, true);
          botones[n].focus();
        },
      },
    }, o.texto));
  const raiz = h('div', { class: ['seg', clase], role: 'radiogroup', aria: { label: etiqueta } }, botones);
  function pintar() {
    botones.forEach((b, i) => {
      const sel = opciones[i].valor === actual;
      b.setAttribute('aria-checked', String(sel));
      b.tabIndex = sel || (actual === null && i === 0) ? 0 : -1;
    });
  }
  function elegir(v, delUsuario) {
    if (v === actual) {
      if (delUsuario && permitirNinguno) { actual = null; pintar(); haptic('select'); if (alElegir) alElegir(null); }
      return;
    }
    actual = v;
    pintar();
    if (delUsuario) { haptic('select'); if (alElegir) alElegir(v); }
  }
  pintar();
  raiz.fijar = (v) => { actual = v ?? null; pintar(); };
  return raiz;
}

/** Interruptor accesible (role="switch"). */
export function interruptor({ etiqueta, valor, alCambiar }) {
  const b = h('button', { class: 'switch', type: 'button', role: 'switch', aria: { checked: String(!!valor), label: etiqueta } });
  b.addEventListener('click', () => {
    const nuevo = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(nuevo));
    haptic('select');
    if (alCambiar) alCambiar(nuevo);
  });
  return b;
}

/**
 * Hoja con teclado numérico propio para escribir un valor exacto. → Promise<number|null> (null = cancelado o vacío).
 * El valor actual se muestra tenue hasta que se teclea algo.
 */
export function pedirNumero({ titulo, valorActual = 0, unidad = '', decimal = true, max = 999, maxDigitos = 5, maxDecimales = 2 }) {
  return new Promise((resolver) => {
    let resuelto = false;
    const referencia = formatearNumero(valorActual, { maxDecimales });
    const mostrado = h('span', { class: 'amount__value is-empty' }, referencia);
    const teclado = crearTeclado({
      decimal, maxDigitos, maxDecimales,
      alCambiar: (v) => { mostrado.textContent = v ? formatoTecleado(v) : referencia; mostrado.classList.toggle('is-empty', !v); },
      alEnviar: () => aceptar(),
    });
    const cerrar = (valor) => { if (resuelto) return; resuelto = true; resolver(valor); hoja.cerrar(); };
    function aceptar() {
      const v = teclado.valor();
      cerrar(v ? Math.min(max, Number(v)) : null);
    }
    const cuerpo = h('div', { class: 'sheet__body stack' },
      h('div', { class: 'amount', aria: { live: 'polite' } }, mostrado, unidad ? h('span', { class: 'amount__currency' }, unidad) : null),
      teclado.el);
    const pie = h('div', { class: 'sheet__foot' },
      h('button', { class: 'btn btn--secondary', type: 'button', on: { click: () => cerrar(null) } }, 'Cancelar'),
      h('button', { class: 'btn', type: 'button', on: { click: aceptar } }, icono('check'), ' Listo'));
    const hoja = abrirHoja([cuerpo, pie], { titulo, alCerrar: () => { teclado.destruir(); if (!resuelto) { resuelto = true; resolver(null); } } });
  });
}

/**
 * Ámbito de steppers: enlazarStepper deja listeners (R0-05), así que cada vista u hoja crea un ámbito, construye sus steppers con
 * `ambito.stepper(...)` y llama a `ambito.liberar()` antes de redibujar y al desmontar/cerrar.
 */
export function crearAmbito() {
  const vivos = new Set();
  return {
    stepper(opciones) { const s = stepper(opciones); vivos.add(s); return s; },
    liberar() { for (const s of vivos) s.destruir(); vivos.clear(); },
  };
}

/**
 * Stepper [−] valor [+] con el valor tocable para escribirlo con el teclado numérico.
 * @returns {{ el: HTMLElement, valor(): number, fijar(v:number): void, destruir(): void }}
 */
export function stepper({ etiqueta, valor, min = 0, max = 999, paso = 1, decimales = 0, sufijo = '', formato, alCambiar, teclado = true, maxDigitos = 5 }) {
  const fmt = formato ?? ((v) => `${formatearNumero(v, { maxDecimales: decimales })}${sufijo}`);
  const dec = h('button', { class: 'stepper__btn', type: 'button', dataset: { stepperDec: '' }, aria: { label: `Disminuir ${etiqueta.toLowerCase()}` } }, icono('minus'));
  const val = h('button', { class: 'stepper__value', type: 'button', dataset: { stepperValue: '' }, aria: { label: `${etiqueta}: escribir valor` } });
  const inc = h('button', { class: 'stepper__btn', type: 'button', dataset: { stepperInc: '' }, aria: { label: `Aumentar ${etiqueta.toLowerCase()}` } }, icono('plus'));
  const caja = h('div', { class: 'stepper' }, dec, val, inc);
  // R1-17a: el aria-label del valor lo incluye (antes lo reemplazaba y el lector no anunciaba el peso) y una región viva anuncia
  // el nuevo valor al pulsar − / +.
  const anuncio = h('span', { class: 'sr-only', role: 'status', aria: { live: 'polite', atomic: 'true' } });
  const etiquetaDe = (v) => `${etiqueta}: ${fmt(v)}`;
  const conAnuncio = (v) => {
    val.setAttribute('aria-label', `${etiquetaDe(v)}. Tocar para escribir`);
    anuncio.textContent = etiquetaDe(v);
    if (alCambiar) alCambiar(v);
  };
  const ctrl = enlazarStepper(caja, { min, max, paso, valor, decimales: 2, formato: fmt, alCambiar: conAnuncio });
  val.setAttribute('aria-label', `${etiquetaDe(ctrl.valor())}. Tocar para escribir`);
  const raizStepper = h('div', null, etiqueta ? h('div', { class: 'stepper-label' }, etiqueta) : null, caja, anuncio);
  if (teclado) {
    val.addEventListener('click', async () => {
      const v = await pedirNumero({ titulo: etiqueta, valorActual: ctrl.valor(), unidad: sufijo.trim(), decimal: decimales > 0, max, maxDigitos, maxDecimales: Math.max(decimales, 0) });
      if (v === null) return;
      ctrl.fijar(Math.max(min, v)); // fijar es silencioso: se avisa a mano
      conAnuncio(ctrl.valor());
    });
  }
  return { el: raizStepper, valor: ctrl.valor, fijar: ctrl.fijar, destruir: ctrl.destruir };
}

/** Fila de lista con ícono, título, subtítulo y control al final. */
export function fila({ icon, titulo, sub, fin }) {
  return h('div', { class: 'item' },
    icon ? h('span', { class: 'item__icon' }, icono(icon)) : null,
    h('div', { class: 'item__main' }, h('div', { class: 'item__title' }, titulo), sub ? h('div', { class: 'item__sub' }, sub) : null),
    fin ? h('div', { class: 'item__end' }, fin) : null);
}

export function callout({ tipo = '', icon = 'info', titulo, texto, hijos = [] }) {
  return h('div', { class: ['callout', tipo ? `callout--${tipo}` : ''] }, icono(icon),
    h('div', null, titulo ? h('span', { class: 'callout__title' }, titulo) : null, titulo && texto ? h('br') : null, texto ?? null, ...hijos));
}

export function estadoVacio({ icon = 'info', titulo, texto, accion }) {
  return h('div', { class: 'empty' },
    h('span', { class: 'empty__icon' }, icono(icon, { tam: 'lg' })),
    h('div', { class: 'empty__title' }, titulo),
    texto ? h('p', null, texto) : null,
    accion ?? null);
}

/**
 * Redibuja el contenido de `contenedor` (fn) conservando el scroll y el foco del teclado: si el elemento enfocado se vuelve a
 * crear, se enfoca su equivalente (mismo rol y nombre accesible), para que Esc, Tab y los lectores de pantalla no pierdan el sitio.
 */
export function redibujarConFoco(contenedor, fn) {
  const y = contenedor.scrollTop;
  const activo = document.activeElement && contenedor.contains(document.activeElement) ? document.activeElement : null;
  const firma = (e) => `${e.tagName}|${e.getAttribute('role') ?? ''}|${e.getAttribute('aria-label') ?? e.textContent.trim().slice(0, 40)}`;
  const buscada = activo ? firma(activo) : null;
  const antes = activo ? [...contenedor.querySelectorAll(activo.tagName)].filter((e) => firma(e) === buscada).indexOf(activo) : -1;
  fn();
  contenedor.scrollTop = y;
  if (buscada) {
    const candidatos = [...contenedor.querySelectorAll(activo.tagName)].filter((e) => firma(e) === buscada && !e.disabled);
    const nuevo = candidatos[Math.max(0, antes)] ?? candidatos[0];
    // Si el equivalente ya no existe o quedó deshabilitado (p. ej. "Subir" en el primer lugar), el foco pasa al diálogo.
    const destino = nuevo ?? contenedor.closest('[role="dialog"]') ?? contenedor;
    if (destino.tabIndex < 0 && destino === contenedor) destino.tabIndex = -1;
    destino.focus({ preventScroll: true });
  }
}

/** Mantiene el scroll de `.screen` al redibujar. */
export function conservarScroll(contenedor, fn) {
  const y = contenedor.scrollTop;
  fn();
  contenedor.scrollTop = y;
}
