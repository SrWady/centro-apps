/*
 * comun.js — ayudas compartidas por las vistas de Finanzas (DOM seguro: todo texto entra por h()).
 * Selectores, pedir monto/fecha/texto en hojas inferiores, ejecución de acciones con avisos y formato es-CO.
 */
import { h, vaciar } from '../../shared/lib/dom.js';
import { formatearPesos, analizarPesos } from '../../shared/lib/dinero.js';
import { unSoloEnvio } from '../../shared/lib/envio.js';
import { MAX_PESOS } from '../logica/esquema.js';
import { formatearNumero, formatearPorcentaje } from '../../shared/lib/numeros.js';
import { formatearFecha } from '../../shared/lib/fechas.js';
import { etiquetaCiclo, inicioCiclo } from '../../shared/lib/ciclos.js';
import { icono } from '../../shared/ui/icono.js';
import { abrirHoja, confirmar } from '../../shared/ui/hoja.js';
import { mostrarAviso } from '../../shared/ui/aviso.js';
import { haptic } from '../../shared/ui/haptica.js';
import { crearTeclado, formatoTecleado } from '../../shared/ui/teclado.js';
import { enlazarStepper } from '../../shared/ui/controles.js';

export { h, icono, haptic, mostrarAviso };
// R2F: unSoloEnvio vive ahora en shared/lib/envio.js; se re-exporta aquí para no romper los imports de las vistas.
export { unSoloEnvio };

export const pesos = (n) => formatearPesos(n);
export const porcentaje = (f, d = 1) => formatearPorcentaje(f, d);
export const fechaCorta = (f) => formatearFecha(f, 'corta');
export const fechaLarga = (f) => formatearFecha(f, 'larga');
/** '1 dic' (sin día de la semana). */
export const diaMes = (f) => formatearFecha(f, 'dia-mes');
export const capitalizar = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

/** 'noviembre 2026' (mes en que EMPIEZA el ciclo). */
export const nombreCiclo = (ciclo, historial) => capitalizar(formatearFecha(inicioCiclo(ciclo, historial), 'mes-anio'));
export { etiquetaCiclo };

export const GRUPOS_TITULO = { necesidades: 'Necesidades', gustos: 'Gustos', ahorro: 'Ahorro' };
export const GRUPOS_COLOR = { necesidades: 'var(--cat-needs)', gustos: 'var(--cat-wants)', ahorro: 'var(--cat-save)' };

/** Plural simple: (3, 'mes', 'meses') → '3 meses'. */
export const cantidad = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/**
 * Ronda del usuario B: cada cuenta es un método de pago. Tipos de cuenta en el orden en que se agrupan en los selectores:
 * `titulo` = nombre del tipo al crear; `grupo` = encabezado en los selectores; `icono` = ícono por omisión (claves del catálogo de shared/ui).
 */
export const ORDEN_TIPOS_CUENTA = Object.freeze(['efectivo', 'ahorro', 'banco', 'billetera', 'credito']);
export const TIPOS_CUENTA_INFO = Object.freeze({
  efectivo: { titulo: 'Efectivo', corto: 'Efectivo', grupo: 'Efectivo', icono: 'efectivo', ejemplo: 'Ej.: Efectivo o Alcancía', ayuda: 'Billetes y monedas.' },
  ahorro: { titulo: 'Cuenta de ahorros', corto: 'Ahorro', grupo: 'Cuentas de ahorros', icono: 'ahorro', ejemplo: 'Ej.: Ahorros', ayuda: 'Para guardar dinero.' },
  banco: { titulo: 'Cuenta corriente o débito', corto: 'Banco', grupo: 'Corriente y débito', icono: 'banco', ejemplo: 'Ej.: Cuenta principal', ayuda: 'La que usas con tarjeta débito.' },
  billetera: { titulo: 'Billetera digital', corto: 'Billetera', grupo: 'Billeteras digitales', icono: 'celular', ejemplo: 'Ej.: Nequi o Daviplata', ayuda: 'Nequi, Daviplata y similares.' },
  credito: { titulo: 'Tarjeta de crédito', corto: 'Crédito', grupo: 'Tarjetas de crédito', icono: 'tarjeta', ejemplo: 'Ej.: Tarjeta Visa', ayuda: 'Crea su deuda y su cuenta juntas.' },
});
export const tipoCuentaTexto = (tipo) => TIPOS_CUENTA_INFO[tipo]?.titulo ?? 'Cuenta';
/** Nombre corto del tipo (el de las filas de la pantalla Cuentas: "Banco · saldo calculado"). */
export const tipoCuentaCorto = (tipo) => TIPOS_CUENTA_INFO[tipo]?.corto ?? 'Cuenta';
/** Íconos que se pueden elegir para una cuenta (todos del catálogo de shared/ui/iconos.js). */
export const ICONOS_CUENTA = Object.freeze(['banco', 'efectivo', 'ahorro', 'celular', 'escudo', 'hogar', 'viaje', 'compras', 'regalo', 'otro']);
/** Paleta opcional de una cuenta (claves de `COLORES_CUENTA` en logica/esquema.js; el valor visible vive aquí). */
export const COLORES_CUENTA_CSS = Object.freeze({ azul: '#3b82f6', verde: '#16a34a', naranja: '#f97316', rojo: '#dc2626', morado: '#8b5cf6', rosa: '#ec4899', turquesa: '#14b8a6', gris: '#6b7280' });
/** Estilo del círculo de un ícono teñido con el color de la cuenta (o undefined si no tiene color). */
export function estiloIconoColor(clave) {
  const c = COLORES_CUENTA_CSS[clave];
  return c ? { background: `${c}2e`, color: c } : undefined;
}
/** Cuentas activas ordenadas por tipo (en `ORDEN_TIPOS_CUENTA`) y luego por `orden`. */
export function cuentasPorTipo(cuentas) {
  return [...cuentas].sort((a, b) => ORDEN_TIPOS_CUENTA.indexOf(a.tipo) - ORDEN_TIPOS_CUENTA.indexOf(b.tipo) || a.orden - b.orden);
}

/**
 * Hoja con un mensaje y varios botones (más de dos salidas, que `confirmar` no ofrece). opciones: [{ valor, texto, icono?, clase? }].
 * Devuelve Promise<valor | undefined> (undefined = cerrada o cancelada).
 */
export function elegirOpcion({ titulo, mensaje, opciones, cancelar = 'Cancelar' }) {
  return new Promise((resolver) => {
    let elegido;
    const botones = opciones.map((o) => boton(o.texto, { icono: o.icono, clase: `btn--block ${o.clase ?? 'btn--secondary'}`, onClick: () => { elegido = o.valor; hoja.cerrar(); } }));
    const cuerpo = h('div', { class: 'sheet__body stack' },
      ...[].concat(mensaje ?? []).map((p) => h('p', { class: 't-small' }, p)),
      h('div', { class: 'stack stack--sm' }, botones),
      boton(cancelar, { clase: 'btn--ghost btn--block', onClick: () => hoja.cerrar() }));
    const hoja = abrirHoja([cuerpo], { titulo, alCerrar: () => resolver(elegido) });
  });
}

/**
 * RU-03 / RU-04: texto de un aviso de saldo (logica/acciones.js `avisosDeSaldo`): "<Cuenta> quedará en −$ X (hoy tiene $ Y)". Si el punto más bajo
 * cae otro día (un movimiento con fecha anterior o futura), lo dice ("el 6 nov").
 */
export function frasesDeAvisoSaldo(avisos, hoy) {
  return avisos.map((a) => `${a.cuenta.nombre} quedará en ${pesos(a.queda)}${a.fecha !== hoy ? ` el ${diaMes(a.fecha)}` : ''} (hoy tiene ${pesos(a.saldoHoy)})`);
}

/**
 * RU-03: hoja de confirmación antes de guardar un movimiento que deja una o más cuentas en negativo. NO bloquea: "Cancelar" vuelve a la hoja y
 * "Continuar" sigue. Con una sola cuenta el mensaje es "Esta cuenta quedará en −$ X (hoy tiene $ Y). ¿Continuar?" y el título lleva su nombre.
 * Devuelve Promise<boolean> (true = continuar; también false si no hay avisos que confirmar → el llamador no debe llamarla sin avisos).
 */
export function confirmarSaldoNegativo(avisos, hoy) {
  const uno = avisos.length === 1 ? avisos[0] : null;
  const mensaje = uno
    ? `Esta cuenta quedará en ${pesos(uno.queda)}${uno.fecha !== hoy ? ` el ${diaMes(uno.fecha)}` : ''} (hoy tiene ${pesos(uno.saldoHoy)}). ¿Continuar?`
    : `${frasesDeAvisoSaldo(avisos, hoy).join('. ')}. ¿Continuar?`;
  return confirmarRiesgo({ titulo: uno ? `${uno.cuenta.nombre} quedará en negativo` : 'Estas cuentas quedarán en negativo', mensaje, confirmar: 'Continuar', cancelar: 'Cancelar' });
}

/**
 * R-FIN-01: tiempo que el botón de confirmar de una confirmación de RIESGO arranca deshabilitado. La hoja de confirmación se abre justo encima del
 * botón "Guardar"/"Eliminar" que la abrió: un segundo toque "humano" (≥ ~230 ms tras el primero) cae en "Continuar" y confirmaba sin que se leyera.
 */
export const RETARDO_CONFIRMAR_RIESGO_MS = 700;

/**
 * Como `confirmar` (shared/ui/hoja.js, que no se toca) pero para confirmaciones de riesgo (sobregiro, mover o borrar con efecto en saldos): el botón de
 * confirmar nace deshabilitado (`aria-disabled="true"`, atenuado por `.btn[aria-disabled]`) durante `retardo` ms y se habilita solo con un temporizador
 * que se limpia al responder y al cerrarse la hoja (Esc, fondo, arrastre), y la hoja se abre con el foco en "Cancelar", que NUNCA se deshabilita.
 * El estado cambia sin animación (cumple `prefers-reduced-motion`). `retardo` 0 = sin espera (solo para pruebas).
 * @param {{titulo?:string, mensaje?:string, confirmar?:string, cancelar?:string, peligro?:boolean}} o
 * @returns {Promise<boolean>}
 */
export function confirmarRiesgo(o = {}, retardo = RETARDO_CONFIRMAR_RIESGO_MS) {
  return new Promise((resolver) => {
    let respondido = false;
    let temporizador = null;
    let esperando = retardo > 0;
    const detener = () => { if (temporizador !== null) { clearTimeout(temporizador); temporizador = null; } };
    const responder = (v) => { if (respondido) return; respondido = true; detener(); resolver(v); hoja.cerrar(v); };
    const btnCancelar = h('button', { class: 'btn btn--secondary js-cancelar-riesgo', type: 'button', on: { click: () => responder(false) } }, o.cancelar || 'Cancelar');
    const btnConfirmar = h('button', {
      class: 'btn' + (o.peligro ? ' btn--danger' : ''), type: 'button', aria: esperando ? { disabled: 'true' } : undefined,
      on: { click: () => { if (esperando) return; responder(true); } },
    }, o.confirmar || 'Confirmar');
    const cuerpo = h('div', { class: 'sheet__body stack' }, o.mensaje ? h('p', { class: 'muted' }, o.mensaje) : null);
    const pie = h('div', { class: 'sheet__foot' }, btnCancelar, btnConfirmar);
    const hoja = abrirHoja([cuerpo, pie], {
      titulo: o.titulo || 'Confirmar', enfocar: '.js-cancelar-riesgo',
      alCerrar: () => { detener(); if (!respondido) { respondido = true; resolver(false); } },
    });
    const cerrarHoja = hoja.cerrar;
    hoja.cerrar = (v) => { detener(); cerrarHoja(v); }; // Esc, fondo, arrastre o botón: el temporizador se limpia en cuanto empieza a cerrarse
    if (esperando) {
      temporizador = setTimeout(() => { temporizador = null; esperando = false; btnConfirmar.removeAttribute('aria-disabled'); }, retardo);
    }
  });
}

/**
 * Rótulos de los íconos del catálogo (shared/ui/iconos.js trae solo las claves, sin tilde: "educacion"). Mapa LOCAL de Finanzas para que el selector
 * diga "Educación" (R-USR: observación N6-03); una clave sin rótulo se capitaliza.
 */
export const ROTULOS_ICONO = Object.freeze({
  hogar: 'Hogar', servicios: 'Servicios', celular: 'Celular', mercado: 'Mercado', transporte: 'Transporte', educacion: 'Educación', comida: 'Comida', ocio: 'Ocio',
  compras: 'Compras', suscripciones: 'Suscripciones', deporte: 'Deporte', salud: 'Salud', viaje: 'Viaje', regalo: 'Regalo', deuda: 'Deuda', ahorro: 'Ahorro',
  escudo: 'Escudo', ingreso: 'Ingreso', otro: 'Otro', banco: 'Banco', efectivo: 'Efectivo', tarjeta: 'Tarjeta',
});
export const nombreIcono = (clave) => ROTULOS_ICONO[clave] ?? (clave ? clave.charAt(0).toUpperCase() + clave.slice(1) : '');

/** Fila de íconos elegibles (radiogroup de chips). alCambiar(clave). Devuelve el nodo; el llamador lo vuelve a pintar al cambiar. */
export function selectorDeIcono({ etiqueta = 'Ícono', valor, claves = ICONOS_CUENTA, alCambiar, nombres = {} }) {
  return h('div', { class: 'chip-row chip-row--wrap', role: 'radiogroup', aria: { label: etiqueta } },
    claves.map((k) => h('button', { class: 'chip', type: 'button', role: 'radio', aria: { checked: String(k === valor), pressed: String(k === valor), label: nombres[k] ?? k }, on: { click: () => alCambiar(k) } }, icono(k))));
}

/** Fila de colores elegibles (con "sin color"). alCambiar(clave | null). */
export function selectorDeColor({ etiqueta = 'Color', valor, alCambiar }) {
  const punto = (hex) => h('span', { style: { display: 'inline-block', width: '18px', height: '18px', borderRadius: '50%', background: hex || 'transparent', border: hex ? '0' : '2px dashed var(--text-3)', boxSizing: 'border-box' }, aria: { hidden: 'true' } });
  return h('div', { class: 'chip-row chip-row--wrap', role: 'radiogroup', aria: { label: etiqueta } },
    h('button', { class: 'chip', type: 'button', role: 'radio', aria: { checked: String(!valor), pressed: String(!valor), label: 'Sin color' }, on: { click: () => alCambiar(null) } }, punto(null)),
    Object.entries(COLORES_CUENTA_CSS).map(([k, hex]) => h('button', { class: 'chip', type: 'button', role: 'radio', aria: { checked: String(k === valor), pressed: String(k === valor), label: k.charAt(0).toUpperCase() + k.slice(1) }, on: { click: () => alCambiar(k) } }, punto(hex))));
}

/** Barra de progreso accesible. fraccion 0..1 (se recorta); clase: '' | 'warn' | 'danger' | 'ok'. */
export function barra({ fraccion, clase = '', etiqueta, grande = false }) {
  const p = Math.max(0, Math.min(1, Number.isFinite(fraccion) ? fraccion : 1));
  return h('div', { class: `bar${grande ? ' bar--lg' : ''}${clase ? ` bar--${clase}` : ''}`, role: 'progressbar', aria: { label: etiqueta, valuemin: 0, valuemax: 100, valuenow: Math.round(p * 100) } },
    h('div', { class: 'bar__fill', style: { '--p': `${(p * 100).toFixed(1)}%` } }));
}

/** Estado vacío con ícono, título, texto y acción opcional. */
export function estadoVacio({ icono: nombre = 'info', titulo, texto, accion }) {
  return h('div', { class: 'empty' },
    h('span', { class: 'empty__icon' }, icono(nombre)),
    h('div', { class: 'empty__title' }, titulo),
    texto ? h('p', { class: 't-small' }, texto) : null,
    accion || null);
}

export function boton(texto, { icono: ic, clase = '', tipo = 'button', onClick, aria } = {}) {
  return h('button', { class: `btn ${clase}`.trim(), type: tipo, aria, on: onClick ? { click: onClick } : undefined }, ic ? icono(ic) : null, texto);
}

/**
 * Ejecuta una acción de la tienda. En error muestra el mensaje (en español) y vibra/pulsa. Devuelve el resultado.
 * `exito` (texto) muestra un aviso; `deshacer` es { accion, payload } para el botón "Deshacer".
 */
export function ejecutar(ctx, accion, payload, { exito, deshacer, tipoAviso = 'ok' } = {}) {
  const r = ctx.tienda.ejecutar(accion, payload);
  if (!r.ok) {
    haptic('error');
    mostrarAviso(r.mensaje || 'No se pudo guardar.', { tipo: 'danger', duracion: 6000 });
    return r;
  }
  if (exito) {
    mostrarAviso(exito, {
      tipo: tipoAviso,
      accion: deshacer ? { etiqueta: 'Deshacer', alPulsar: () => ejecutar(ctx, deshacer.accion, deshacer.payload, { exito: 'Deshecho' }) } : undefined,
    });
  }
  return r;
}

/**
 * Hoja con una lista de opciones. opciones: [{ valor, titulo, sub?, icono?, fin? }]. Devuelve Promise<valor | undefined>.
 */
export function abrirSelector({ titulo, opciones, seleccionado, vacio = 'No hay opciones.' }) {
  return new Promise((resolver) => {
    let elegido;
    // Ronda del usuario B: `grupo` (texto) agrupa las opciones consecutivas bajo un encabezado (p. ej. las cuentas por tipo); `color` tiñe el ícono.
    const fila = (o) => h('button', { class: 'item', type: 'button', aria: { pressed: String(o.valor === seleccionado) }, on: { click: () => { elegido = o.valor; hoja.cerrar(); } } },
      o.icono ? h('span', { class: 'item__icon', style: o.color ? estiloIconoColor(o.color) : undefined }, icono(o.icono)) : null,
      h('span', { class: 'item__main' }, h('span', { class: 'item__title', style: { display: 'block' } }, o.titulo), o.sub ? h('span', { class: 'item__sub', style: { display: 'block' } }, o.sub) : null),
      o.valor === seleccionado ? h('span', { class: 'accent' }, icono('check')) : (o.fin ? h('span', { class: 'item__end money' }, o.fin) : null));
    const filas = [];
    let grupoActual = null;
    for (const o of opciones) {
      if (o.grupo && o.grupo !== grupoActual) { grupoActual = o.grupo; filas.push(h('div', { class: 't-label list-title', role: 'presentation' }, o.grupo)); }
      filas.push(fila(o));
    }
    const cuerpo = h('div', { class: 'sheet__body' }, opciones.length ? h('div', { class: 'list' }, filas) : estadoVacio({ titulo: vacio }));
    const hoja = abrirHoja([cuerpo], { titulo, alCerrar: () => resolver(elegido) });
  });
}

/** Dígitos del monto máximo (R1F-19: MAX_PESOS = 10^10 → 11 dígitos); el tope real lo da MAX_PESOS, no los dígitos. */
export const DIGITOS_MAX_MONTO = String(MAX_PESOS).length;
/** Dígitos que el teclado en pantalla deja llegar a `alCambiar` (3 más que el tope: así el que pasa el tope se RECHAZA con un aviso en vez de ignorarse sin decir nada; N3-04). */
export const DIGITOS_TECLADO_MONTO = DIGITOS_MAX_MONTO + 3;
/** N3-04: aviso de un monto sobre el tope. El valor que lo pasaría se rechaza entero (no se recorta): "10.000.000.001" nunca queda en 1.000.000.000. */
export function mensajeTopeMonto(maxDigitos = DIGITOS_MAX_MONTO) {
  const maximo = Math.min(MAX_PESOS, 10 ** maxDigitos - 1);
  return `El máximo es ${formatearPesos(maximo)}: ese valor no se aceptó. Escribe uno menor.`;
}
/** ¿Un monto tecleado (cadena de dígitos) pasa el tope de pesos o de dígitos? */
export const pasaTopeMonto = (digitos, maxDigitos = DIGITOS_MAX_MONTO) => String(digitos).replace(/^0+/, '').length > maxDigitos || Number(digitos) > MAX_PESOS;

/** Teclado numérico en hoja para pedir un monto entero. Devuelve Promise<number | null> (null = cancelado). */
export function pedirMonto({ titulo, mensaje, inicial = 0, textoGuardar = 'Guardar', permitirCero = true, maxDigitos = DIGITOS_MAX_MONTO }) {
  return new Promise((resolver) => {
    let resultado = null;
    let monto = inicial;
    const valor = h('span', { class: `amount__value${monto ? '' : ' is-empty'}` }, monto ? formatoTecleado(String(monto)) : '0');
    const teclado = crearTeclado({
      maxDigitos: maxDigitos + 3,
      teclado: false,
      valor: monto ? String(monto) : '',
      alCambiar: (v) => {
        if (pasaTopeMonto(v, maxDigitos)) { haptic('warning', valor); teclado.fijar(monto ? String(monto) : ''); mostrarAviso(mensajeTopeMonto(maxDigitos), { tipo: 'warn' }); return; } // R1F-19: nunca sobre el tope; N3-04: se rechaza entero y se dice el máximo
        monto = v ? Number(v) : 0;
        valor.textContent = v ? formatoTecleado(v) : '0';
        valor.classList.toggle('is-empty', !v);
      },
    });
    const guardar = boton(textoGuardar, {
      icono: 'check', clase: 'btn--lg btn--block',
      onClick: () => {
        if (!permitirCero && monto === 0) { haptic('error', valor); mostrarAviso('Escribe un monto', { tipo: 'warn' }); return; }
        resultado = monto; haptic('success', guardar); hoja.cerrar();
      },
    });
    const cuerpo = h('div', { class: 'sheet__body stack' },
      mensaje ? h('p', { class: 'muted t-small' }, mensaje) : null,
      h('div', { class: 'amount', aria: { live: 'polite', label: 'Monto' } }, h('span', { class: 'amount__currency' }, '$'), valor),
      teclado.el);
    const hoja = abrirHoja([cuerpo, h('div', { class: 'sheet__foot' }, guardar)], { titulo, alCerrar: () => { teclado.destruir(); resolver(resultado); } });
    const fisico = { coma: false };
    hoja.panel.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { guardar.click(); return; }
      const r = teclaDeMonto(fisico, monto, ev.key, maxDigitos); // R2F-06: la coma y lo que sigue ya no suman ceros al monto
      if (r.aviso) mostrarAviso(r.aviso, { tipo: 'warn' });
      if (r.digitos !== null) teclado.fijar(r.digitos);
    });
  });
}

/** Pide una fecha (input nativo). Devuelve Promise<'YYYY-MM-DD' | null>. */
export function pedirFecha({ titulo = 'Fecha', valor, min, max, atajos = [] }) {
  return new Promise((resolver) => {
    let resultado = null;
    const entrada = h('input', { class: 'input', type: 'date', value: valor, attrs: { min, max, 'aria-label': titulo } });
    const guardar = boton('Listo', { icono: 'check', clase: 'btn--lg btn--block', onClick: () => { if (entrada.value) { resultado = entrada.value; hoja.cerrar(); } else { haptic('error'); mostrarAviso('Elige una fecha', { tipo: 'warn' }); } } });
    const fila = atajos.length ? h('div', { class: 'chip-row chip-row--wrap' }, atajos.map((a) => h('button', { class: 'chip', type: 'button', on: { click: () => { resultado = a.valor; hoja.cerrar(); } } }, a.titulo))) : null;
    const hoja = abrirHoja([h('div', { class: 'sheet__body stack' }, fila, h('div', { class: 'field' }, h('label', { class: 'field__label' }, 'Fecha'), entrada)), h('div', { class: 'sheet__foot' }, guardar)], { titulo, alCerrar: () => resolver(resultado) });
  });
}

/** Pide un texto corto o largo. Devuelve Promise<string | null> (null = cancelado). */
export function pedirTexto({ titulo, valor = '', max = 200, placeholder = '', multilinea = true, etiqueta = 'Texto', obligatorio = false }) {
  return new Promise((resolver) => {
    let resultado = null;
    const entrada = multilinea
      ? h('textarea', { class: 'input', attrs: { maxlength: max, placeholder, 'aria-label': etiqueta }, value: valor })
      : h('input', { class: 'input', type: 'text', value: valor, attrs: { maxlength: max, placeholder, 'aria-label': etiqueta, autocomplete: 'off' } });
    const guardar = boton('Listo', {
      icono: 'check', clase: 'btn--lg btn--block',
      onClick: () => {
        if (obligatorio && !entrada.value.trim()) { haptic('error'); mostrarAviso('Este campo es obligatorio', { tipo: 'warn' }); return; }
        resultado = entrada.value.trim(); hoja.cerrar();
      },
    });
    const hoja = abrirHoja([h('div', { class: 'sheet__body' }, h('div', { class: 'field' }, h('label', { class: 'field__label' }, etiqueta), entrada, h('span', { class: 'field__hint' }, `Hasta ${max} caracteres`))), h('div', { class: 'sheet__foot' }, guardar)], { titulo, alCerrar: () => resolver(resultado) });
    setTimeout(() => entrada.focus(), 350);
  });
}

/** Mensajes cuando un monto escrito o pegado no se puede leer con seguridad (R2F-06). */
export const MENSAJES_MONTO = {
  centavos: 'Solo pesos enteros: quita los centavos (por ejemplo, 1.234.567 en lugar de 1.234.567,50).',
  cientifica: 'Escribe el monto con números, sin notación científica (por ejemplo, 1.500.000).',
  formato: 'No se entiende el formato del monto: usa punto para los miles y coma para los decimales (por ejemplo, 1.234.567).',
  tope: mensajeTopeMonto(),
};

/**
 * Interpreta el texto de un campo de pesos (R2F-06, es-CO: punto = miles, coma = decimales; ver `analizarPesos` en shared/lib/dinero.js).
 * Los decimales en cero se descartan ('1.234.567,00' → 1234567); decimales distintos de cero ('1.500.000,50', '1,5'), notación científica
 * ('1e10') o un formato ambiguo se RECHAZAN (`rechazo`: 'centavos' | 'cientifica' | 'formato') en vez de leerse como dígitos sueltos
 * (antes '1.234.567,00' daba 123.456.700 y '1e10' daba 110). `estricto` (texto pegado) exige puntos de miles bien formados.
 * Además: tope de dígitos (`tope`: 11 al teclear; Infinity al leer un valor ya guardado) y nunca más que MAX_PESOS (R1F-19 / N3-04: un monto
 * que pasa el tope se rechaza entero con `rechazo: 'tope'`, no se recorta; `truncado` queda en true por compatibilidad); si el campo admite signo, un "-" inicial lo vuelve negativo (R1F-05) y `signoPrevio`
 * (1 | -1) es el del interruptor. Devuelve { digitos, signo, valor, rechazo, coma, decimales, truncado } con valor null si no hay dígitos
 * o hay rechazo (nunca -0).
 */
export function interpretarPesos(texto, { conSigno = false, signoPrevio = 1, tope = DIGITOS_MAX_MONTO, estricto = false } = {}) {
  const a = analizarPesos(String(texto ?? ''), { permitirNegativo: conSigno, estricto });
  const signo = conSigno ? (a.negativo ? -1 : signoPrevio) : 1;
  if (a.estado === 'centavos' || a.estado === 'cientifica' || a.estado === 'formato') {
    return { digitos: '', signo, valor: null, rechazo: a.estado, coma: a.coma, decimales: a.decimales, truncado: false };
  }
  const digitos = a.digitos;
  // R1F-19 / N3-04: al teclear o pegar, un monto que pasa el tope se RECHAZA entero (antes se recortaba el último dígito: "10.000.000.001"
  // quedaba en 1.000.000.000, diez veces menos). Al leer con tope Infinity no se toca nada.
  if (Number.isFinite(tope) && digitos && (digitos.replace(/^0+/, '').length > tope || Number(digitos) > MAX_PESOS)) {
    return { digitos: '', signo, valor: null, rechazo: 'tope', coma: false, decimales: a.decimales, truncado: true };
  }
  const n = digitos ? Number(digitos) : null;
  return { digitos, signo, valor: n === null ? null : n === 0 ? 0 : signo * n, rechazo: null, coma: a.coma && digitos !== '', decimales: a.decimales, truncado: false };
}

/**
 * Agrega un dígito tecleado (teclado físico) a un monto entero, con el mismo tope que el teclado en pantalla (R1F-13: nunca "1e+21";
 * R1F-19: nunca más que MAX_PESOS, el dígito que lo pasaría se ignora).
 */
export function agregarDigitoMonto(monto, tecla, maxDigitos = DIGITOS_MAX_MONTO) {
  const base = Number(monto) === 0 ? '' : String(Math.trunc(Number(monto)));
  const nuevo = `${base}${tecla}`.slice(0, maxDigitos);
  return Number(nuevo) > MAX_PESOS ? base : nuevo;
}

/**
 * R2F-06: una tecla del teclado FÍSICO sobre un monto entero. `entrada` es un objeto { coma: false } que el llamador conserva
 * mientras la hoja está abierta. Una "," empieza los decimales: los ceros que siguen se descartan (no suman al monto) y un dígito
 * distinto de cero se rechaza con un aviso (pesos enteros). El "." es separador de miles: se ignora. Backspace antes borra la coma.
 * → { digitos: string | null, aviso?: string }: `digitos` es el monto nuevo como cadena de dígitos, o null si no cambia.
 */
export function teclaDeMonto(entrada, monto, tecla, maxDigitos = DIGITOS_MAX_MONTO) {
  if (tecla === ',') { entrada.coma = true; return { digitos: null }; }
  if (/^[0-9]$/.test(tecla)) {
    if (!entrada.coma) {
      const base = Number(monto) === 0 ? '' : String(Math.trunc(Number(monto)));
      if (pasaTopeMonto(`${base}${tecla}`, maxDigitos)) return { digitos: null, aviso: mensajeTopeMonto(maxDigitos) }; // N3-04: el dígito que pasa el tope se rechaza y se dice el máximo
      return { digitos: agregarDigitoMonto(monto, tecla, maxDigitos) };
    }
    return tecla === '0' ? { digitos: null } : { digitos: null, aviso: MENSAJES_MONTO.centavos };
  }
  if (tecla === 'Backspace') {
    if (entrada.coma) { entrada.coma = false; return { digitos: null }; }
    return { digitos: String(monto).slice(0, -1) };
  }
  return { digitos: null };
}

/**
 * Si el foco quedó en <body> porque se redibujó el control que lo tenía (típico al elegir algo en una hoja anidada),
 * lo devuelve a la hoja abierta más arriba: sin esto Esc y los dígitos del teclado físico dejan de funcionar (F7, R1F-12).
 */
export function recuperarFoco() {
  if (typeof document === 'undefined') return;
  // Las hojas que se están cerrando ya no tienen la clase "is-open": no cuentan.
  const paneles = [...document.querySelectorAll('.sheet')].filter((p) => p.parentNode && p.parentNode.classList.contains('is-open'));
  const panel = paneles[paneles.length - 1];
  if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
}

/**
 * Campo de pesos con formato de miles al teclear (inputmode numérico). Devuelve { el, input, valor():number|null, fijar(n), tocado() }.
 * Solo dígitos; el valor se lee con Number() sobre los dígitos (nunca flotantes).
 * `conSigno`: admite saldos negativos (p. ej. un sobregiro): se muestra el valor absoluto y un interruptor
 * (`textoPositivo` / `textoNegativo`) elige el signo; también se acepta un "-" inicial. `valor()` devuelve el número con signo.
 * `tocado()` dice si el usuario cambió el campo o el signo (para no reenviar un valor que no se editó).
 */
export function campoPesos({ etiqueta, valor = null, ayuda, id, alCambiar, conSigno = false, textoPositivo = 'A favor', textoNegativo = 'En contra (negativo)' }) {
  let signo = conSigno && valor !== null && valor < 0 ? -1 : 1;
  let tocado = false;
  const inicial = valor === null ? '' : formatoTecleado(String(conSigno ? Math.abs(valor) : valor));
  const entrada = h('input', { class: 'input num', id, attrs: { inputmode: 'numeric', autocomplete: 'off', 'aria-label': etiqueta }, value: inicial });
  const zonaSigno = conSigno ? h('div') : null;
  const leer = () => interpretarPesos(entrada.value, { conSigno, signoPrevio: signo, tope: Infinity }).valor; // sin tope al leer: un valor ya guardado (hasta 11 dígitos: MAX_PESOS = 10^10) no se trunca
  const pintarSigno = () => {
    if (!zonaSigno) return;
    poner(zonaSigno, segmentado({ etiqueta: `Signo: ${etiqueta}`, valor: signo, opciones: [{ valor: 1, titulo: textoPositivo }, { valor: -1, titulo: textoNegativo }], alCambiar: (v) => { signo = v; tocado = true; pintarSigno(); recuperarFoco(); if (alCambiar) alCambiar(leer()); } }));
  };
  let anterior = inicial; // último texto aceptado: si lo escrito o pegado se rechaza, el campo vuelve a él
  entrada.addEventListener('input', (ev) => {
    tocado = true;
    // R2F-06: un texto PEGADO se lee con rigor (puntos de miles bien formados); al teclear se toleran los puntos sueltos.
    const r = interpretarPesos(entrada.value, { conSigno, signoPrevio: signo, estricto: /paste|drop/i.test(String((ev && ev.inputType) || '')) });
    if (r.rechazo) { // centavos, notación científica o formato ambiguo: nunca se multiplica el valor por 100 en silencio
      entrada.value = anterior;
      haptic('error', entrada);
      mostrarAviso(MENSAJES_MONTO[r.rechazo], { tipo: 'warn', duracion: 6000 });
      return;
    }
    if (conSigno && r.signo !== signo) { signo = r.signo; pintarSigno(); }
    // Una coma recién tecleada (o con ceros detrás) se conserva para que los ceros siguientes no sumen pesos: '1.234.567,00' sigue valiendo 1.234.567.
    entrada.value = r.digitos ? formatoTecleado(r.digitos) + (r.coma ? `,${r.decimales}` : '') : '';
    anterior = entrada.value;
    if (alCambiar) alCambiar(leer());
  });
  pintarSigno();
  return {
    el: h('div', { class: 'field' }, h('label', { class: 'field__label', for: id }, etiqueta), entrada, zonaSigno, ayuda ? h('span', { class: 'field__hint' }, ayuda) : null),
    input: entrada,
    valor: leer,
    tocado: () => tocado,
    fijar: (n) => { signo = conSigno && n !== null && n < 0 ? -1 : 1; entrada.value = n === null ? '' : formatoTecleado(String(conSigno ? Math.abs(n) : n)); anterior = entrada.value; pintarSigno(); },
  };
}

/** Segmentado simple (radiogroup) controlado por el llamador: opciones [{ valor, titulo }]. */
export function segmentado({ etiqueta, opciones, valor, alCambiar }) {
  const botones = opciones.map((o) => h('button', { type: 'button', role: 'radio', aria: { checked: String(o.valor === valor) }, tabIndex: o.valor === valor ? 0 : -1, on: { click: () => { if (o.valor !== valor) alCambiar(o.valor); } } }, o.titulo));
  return h('div', { class: 'seg', role: 'radiogroup', aria: { label: etiqueta } }, botones);
}

/**
 * Vista de "redibujar todo al actualizar": dibujar() devuelve un nodo o arreglo de nodos. Conserva el scroll.
 * La raíz es el contenedor con scroll (.screen).
 */
export function crearVista(raiz, dibujar, { alDesmontar } = {}) {
  const pintar = () => {
    const y = raiz.scrollTop;
    const nodos = [].concat(dibujar()).filter(Boolean);
    vaciar(raiz);
    raiz.append(...nodos);
    raiz.scrollTop = y;
  };
  pintar();
  return { actualizar: pintar, desmontar() { if (alDesmontar) alDesmontar(); vaciar(raiz); } };
}

/** Encabezado de sección con acción opcional. */
export function encabezado(titulo, accion) {
  return h('div', { class: 'section__head' }, h('h2', { class: 't-h' }, titulo), accion || null);
}

/**
 * Stepper [−] valor [+] (patrón de shared/ui/controles.js). Devuelve { el, ctrl } con ctrl.valor()/fijar(v).
 * opciones: { etiqueta, valor, min, max, paso, sufijo, alCambiar(v) }
 */
export function stepperControl({ etiqueta, valor, min, max, paso = 1, sufijo = '', alCambiar }) {
  const dec = h('button', { class: 'stepper__btn', type: 'button', dataset: { stepperDec: '' }, aria: { label: `Disminuir ${etiqueta.toLowerCase()}` } }, icono('minus'));
  const inc = h('button', { class: 'stepper__btn', type: 'button', dataset: { stepperInc: '' }, aria: { label: `Aumentar ${etiqueta.toLowerCase()}` } }, icono('plus'));
  const salida = h('div', { class: 'stepper__value', dataset: { stepperValue: '' }, aria: { live: 'polite' } });
  const raiz = h('div', { class: 'stepper' }, dec, salida, inc);
  const ctrl = enlazarStepper(raiz, { min, max, paso, valor, formato: (v) => `${formatearNumero(v, { maxDecimales: 0 })}${sufijo}`, alCambiar });
  return { el: h('div', null, h('div', { class: 'stepper-label' }, etiqueta), raiz), ctrl };
}

/** Interruptor (role=switch) controlado: alCambiar(nuevoValor). */
export function interruptor({ etiqueta, valor, alCambiar }) {
  const sw = h('button', { class: 'switch', type: 'button', role: 'switch', aria: { checked: String(valor), label: etiqueta } });
  sw.addEventListener('click', () => {
    const nuevo = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(nuevo));
    haptic('select');
    alCambiar(nuevo);
  });
  return sw;
}

const TEXTO_AVISO = {
  'respaldo-eliminado': 'Se eliminó el respaldo automático para liberar espacio. Exporta tus datos para tener una copia.',
  'respaldo-fallido': 'No se pudo guardar un respaldo antes del cambio.',
  'migrado-sin-guardar': 'Los datos se actualizaron pero no hay espacio para guardarlos. Exporta una copia y libera espacio.',
  'corrupto-no-preservado': 'No se pudo conservar una copia del texto ilegible: expórtalo antes de empezar de cero.',
  'cuota-llena': 'No hay espacio para guardar. Exporta tus datos y libera espacio.',
};
/** Muestra los avisos del repositorio (los que traen `codigo`) como avisos breves. */
export function avisarRepositorio(avisos) {
  for (const a of avisos ?? []) {
    if (!a || !a.codigo || a.codigo === 'no-disponible') continue;
    mostrarAviso(a.mensaje || TEXTO_AVISO[a.codigo] || 'Aviso del almacenamiento.', { tipo: 'warn', duracion: 8000 });
  }
}

/**
 * Reemplaza los hijos de `nodo`. A diferencia de Node.replaceChildren/append, ignora null/undefined/false (no escribe "null")
 * y aplana arreglos; los textos y números entran como nodos de texto.
 */
export function poner(nodo, ...hijos) {
  vaciar(nodo);
  const anexar = (lista) => {
    for (const x of lista) {
      if (x === null || x === undefined || x === false || x === true) continue;
      if (Array.isArray(x)) anexar(x);
      else if (typeof x === 'object' && typeof x.nodeType === 'number') nodo.appendChild(x);
      else nodo.appendChild(document.createTextNode(String(x)));
    }
  };
  anexar(hijos);
  return nodo;
}
