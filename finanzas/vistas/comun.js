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
import { abrirHoja } from '../../shared/ui/hoja.js';
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
    const fila = (o) => h('button', { class: 'item', type: 'button', aria: { pressed: String(o.valor === seleccionado) }, on: { click: () => { elegido = o.valor; hoja.cerrar(); } } },
      o.icono ? h('span', { class: 'item__icon' }, icono(o.icono)) : null,
      h('span', { class: 'item__main' }, h('span', { class: 'item__title', style: { display: 'block' } }, o.titulo), o.sub ? h('span', { class: 'item__sub', style: { display: 'block' } }, o.sub) : null),
      o.valor === seleccionado ? h('span', { class: 'accent' }, icono('check')) : (o.fin ? h('span', { class: 'item__end money' }, o.fin) : null));
    const cuerpo = h('div', { class: 'sheet__body' }, opciones.length ? h('div', { class: 'list' }, opciones.map(fila)) : estadoVacio({ titulo: vacio }));
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
