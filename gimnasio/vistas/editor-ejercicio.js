/*
 * editor-ejercicio.js — hoja "Editar ejercicio" (T2.5): nombre, medida, series, descanso, repeticiones o segundos (mín./máx.),
 * RIR, por lado, superserie, consejo y ajuste opcional por persona. Guardar solo afecta sesiones que aún no se han iniciado.
 */
import { h } from '../../shared/lib/dom.js';
import { abrirHoja, confirmar } from '../../shared/ui/hoja.js';
import { haptic } from '../../shared/ui/haptica.js';
import { icono } from '../../shared/ui/icono.js';
import { guardarEjercicio, borrarEjercicio, moverEjercicio } from '../logica/acciones.js';
import { LETRAS_SUPERSERIE } from '../logica/esquema.js';
import { segmentado, interruptor, crearAmbito, ejecutar, fila, callout, redibujarConFoco } from './comun.js';

const clon = (o) => JSON.parse(JSON.stringify(o));

function leerAjuste(a = {}) {
  return {
    nota: a.nota ?? '',
    usaSerRep: a.series !== undefined || a.min !== undefined || a.max !== undefined,
    series: a.series ?? null, min: a.min ?? null, max: a.max ?? null,
    usaRir: a.rir !== undefined, rirMin: a.rir?.min ?? null, rirMax: a.rir?.max ?? null,
    usaDescanso: a.descansoSeg !== undefined, descansoSeg: a.descansoSeg ?? null,
  };
}

/** @param {{ctx:object, diaId:string, ejercicio?:object}} o  sin `ejercicio` = nuevo ejercicio al final del día */
export function abrirEditorEjercicio({ ctx, diaId, ejercicio = null }) {
  const nuevo = !ejercicio;
  const ambito = crearAmbito();
  const stepper = (o) => ambito.stepper(o);
  const diaActual = () => ctx.tienda.datos().rutina.dias.find((x) => x.id === diaId);
  const posicion = () => (nuevo ? diaActual().ejercicios.length : diaActual().ejercicios.findIndex((e) => e.id === ejercicio.id));
  const base = ejercicio ? clon(ejercicio) : { nombre: '', medida: 'reps', series: 3, min: 10, max: 12, porLado: false, rir: { min: 2, max: 2 }, descansoSeg: 90, superserie: null, consejo: '', ajustes: {} };
  const personas = ctx.tienda.datos().ajustes.personas;

  const ejs = diaActual().ejercicios;
  const i0 = posicion();
  const previo = ejs[i0 - 1];
  const siguiente = nuevo ? undefined : ejs[i0 + 1];
  let superInicial = 'ninguna';
  if (base.superserie) superInicial = previo && previo.superserie === base.superserie ? 'anterior' : siguiente && siguiente.superserie === base.superserie ? 'siguiente' : 'ninguna';

  const d = {
    nombre: base.nombre, medida: base.medida, series: base.series, min: base.min, max: base.max, porLado: base.porLado,
    usaRir: base.rir !== null, rirMin: base.rir ? base.rir.min : 2, rirMax: base.rir ? base.rir.max : 2,
    descansoSeg: base.descansoSeg, consejo: base.consejo ?? '', superserie: superInicial,
    ajustes: Object.fromEntries(personas.map((p) => [p.id, leerAjuste(base.ajustes?.[p.id])])),
  };

  const cuerpo = h('div', { class: 'sheet__body stack stack--lg' });
  let hoja = null;

  function aCarga() {
    const dia = diaActual();
    const idx = posicion();
    const otros = dia.ejercicios.filter((e) => !ejercicio || e.id !== ejercicio.id);
    const ajustes = {};
    for (const p of personas) {
      const a = d.ajustes[p.id];
      const o = {};
      if (a.usaSerRep) {
        if (a.series !== null) o.series = a.series;
        if (a.min !== null) o.min = a.min;
        if (a.max !== null) o.max = a.max;
      }
      if (a.usaRir && d.usaRir) o.rir = { min: a.rirMin ?? d.rirMin, max: a.rirMax ?? d.rirMax };
      if (a.usaDescanso && a.descansoSeg !== null) o.descansoSeg = a.descansoSeg;
      if (a.nota.trim()) o.nota = a.nota.trim();
      if (Object.keys(o).length) ajustes[p.id] = o;
    }
    let superserie = null;
    let companeroId;
    if (d.superserie !== 'ninguna') {
      const vecino = d.superserie === 'anterior' ? dia.ejercicios[nuevo ? dia.ejercicios.length - 1 : idx - 1] : dia.ejercicios[idx + 1];
      if (vecino) {
        const usadas = new Set(otros.filter((e) => e.id !== vecino.id).map((e) => e.superserie).filter(Boolean));
        superserie = vecino.superserie ?? LETRAS_SUPERSERIE.find((l) => !usadas.has(l)) ?? null;
        companeroId = vecino.id;
      }
    }
    return {
      ejercicio: {
        ...(ejercicio ? { id: ejercicio.id } : {}),
        nombre: d.nombre.trim(), medida: d.medida, series: d.series, min: d.min, max: d.max, porLado: d.porLado,
        rir: d.usaRir ? { min: d.rirMin, max: d.rirMax } : null, descansoSeg: d.descansoSeg, superserie, consejo: d.consejo.trim(), ajustes,
      },
      companeroId,
    };
  }

  function guardar() {
    const { ejercicio: e, companeroId } = aCarga();
    const r = ejecutar(ctx, guardarEjercicio, { diaId, ejercicio: e, ...(companeroId ? { companeroId } : {}) });
    if (r.ok) { haptic('success'); hoja.cerrar(); }
    else haptic('error');
  }

  async function quitar() {
    const ok = await confirmar({ titulo: '¿Quitar este ejercicio de la rutina?', mensaje: 'Las sesiones ya iniciadas y tu historial se conservan.', confirmar: 'Quitar', peligro: true });
    if (!ok) return;
    const r = ejecutar(ctx, borrarEjercicio, { diaId, ejercicioId: ejercicio.id });
    if (r.ok) hoja.cerrar();
  }

  function mover(delta) {
    const idx = posicion();
    const r = ejecutar(ctx, moverEjercicio, { diaId, ejercicioId: ejercicio.id, haciaIndice: idx + delta });
    if (r.ok) { haptic('select'); pintar(); }
  }

  /* ---------- construcción del cuerpo ---------- */

  function campoTexto({ etiqueta, valor, max, alCambiar, area = false, placeholder = '' }) {
    const control = area
      ? h('textarea', { class: 'input', rows: 2, maxLength: max, placeholder, aria: { label: etiqueta } })
      : h('input', { class: 'input', type: 'text', maxLength: max, autocomplete: 'off', placeholder, aria: { label: etiqueta } });
    control.value = valor;
    control.addEventListener('input', () => alCambiar(control.value));
    return h('div', { class: 'field' }, h('span', { class: 'field__label' }, etiqueta), control);
  }

  function bloquePersona(p) {
    const a = d.ajustes[p.id];
    const unidad = d.medida === 'segundos' ? 'Segundos' : 'Reps';
    const grupo = (clave, titulo, sub, contenido) => h('div', null,
      fila({ titulo, sub, fin: interruptor({ etiqueta: `${titulo} para ${p.nombre}`, valor: a[clave], alCambiar: (v) => { a[clave] = v; if (v) rellenarBase(a, clave); pintar(); } }) }),
      a[clave] ? h('div', { class: 'grid-2', style: { marginTop: 'var(--sp-2)' } }, contenido) : null);
    return h('div', { class: 'bloque-persona' },
      h('h3', { class: 't-h' }, `Ajuste para ${p.nombre}`),
      campoTexto({ etiqueta: `Nota para ${p.nombre}`, valor: a.nota, max: 300, placeholder: 'Ej.: pies altos, pausa de 1 s arriba…', alCambiar: (v) => { a.nota = v; } }),
      grupo('usaSerRep', 'Series y repeticiones distintas', `${d.series} series de ${d.min}–${d.max} por defecto`, [
        stepper({ etiqueta: 'Series', valor: a.series ?? d.series, min: 1, max: 10, paso: 1, alCambiar: (v) => { a.series = v; } }).el,
        h('div'),
        stepper({ etiqueta: `${unidad} mín.`, valor: a.min ?? d.min, min: 1, max: 999, paso: d.medida === 'segundos' ? 5 : 1, alCambiar: (v) => { a.min = v; } }).el,
        stepper({ etiqueta: `${unidad} máx.`, valor: a.max ?? d.max, min: 1, max: 999, paso: d.medida === 'segundos' ? 5 : 1, alCambiar: (v) => { a.max = v; } }).el,
      ]),
      d.usaRir ? grupo('usaRir', 'RIR distinto', `RIR ${d.rirMin}–${d.rirMax} por defecto`, [
        stepper({ etiqueta: 'RIR mín.', valor: a.rirMin ?? d.rirMin, min: 0, max: 5, paso: 1, teclado: false, alCambiar: (v) => { a.rirMin = v; } }).el,
        stepper({ etiqueta: 'RIR máx.', valor: a.rirMax ?? d.rirMax, min: 0, max: 5, paso: 1, teclado: false, alCambiar: (v) => { a.rirMax = v; } }).el,
      ]) : null,
      grupo('usaDescanso', 'Descanso distinto', `${d.descansoSeg} s por defecto`, [
        stepper({ etiqueta: 'Descanso', valor: a.descansoSeg ?? d.descansoSeg, min: 0, max: 600, paso: 15, sufijo: ' s', alCambiar: (v) => { a.descansoSeg = v; } }).el,
      ]));
  }

  function rellenarBase(a, clave) {
    if (clave === 'usaSerRep') { a.series ??= d.series; a.min ??= d.min; a.max ??= d.max; }
    if (clave === 'usaRir') { a.rirMin ??= d.rirMin; a.rirMax ??= d.rirMax; }
    if (clave === 'usaDescanso') a.descansoSeg ??= d.descansoSeg;
  }

  function pintar() {
    ambito.liberar(); // steppers de la versión anterior del cuerpo
    const y = cuerpo.scrollTop;
    const dia = diaActual();
    const idx = posicion();
    const unidad = d.medida === 'segundos' ? 'Segundos' : 'Reps';
    const opcionesSuper = [{ valor: 'ninguna', texto: 'Ninguna' }];
    const hayAnterior = nuevo ? dia.ejercicios.length > 0 : idx > 0;
    const haySiguiente = !nuevo && idx < dia.ejercicios.length - 1;
    if (hayAnterior) opcionesSuper.push({ valor: 'anterior', texto: 'Con el anterior' });
    if (haySiguiente) opcionesSuper.push({ valor: 'siguiente', texto: 'Con el siguiente' });
    if (!opcionesSuper.some((o) => o.valor === d.superserie)) d.superserie = 'ninguna';

    const nodos = [
      campoTexto({ etiqueta: 'Nombre', valor: d.nombre, max: 60, placeholder: 'Nombre del ejercicio', alCambiar: (v) => { d.nombre = v; } }),
      h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Medida'),
        segmentado({ etiqueta: 'Medida', opciones: [{ valor: 'reps', texto: 'Repeticiones' }, { valor: 'segundos', texto: 'Segundos' }], valor: d.medida, alElegir: (v) => {
          d.medida = v;
          if (v === 'segundos') { d.usaRir = false; if (d.min < 10) d.min = 30; if (d.max < d.min) d.max = d.min + 15; } else if (d.min >= 30 && d.max >= 30) { d.min = 10; d.max = 12; }
          pintar();
        } })),
      h('div', { class: 'grid-2' },
        stepper({ etiqueta: 'Series', valor: d.series, min: 1, max: 10, paso: 1, alCambiar: (v) => { d.series = v; } }).el,
        stepper({ etiqueta: 'Descanso', valor: d.descansoSeg, min: 0, max: 600, paso: 15, sufijo: ' s', alCambiar: (v) => { d.descansoSeg = v; } }).el,
        stepper({ etiqueta: `${unidad} mín.`, valor: d.min, min: 1, max: 999, paso: d.medida === 'segundos' ? 5 : 1, alCambiar: (v) => { d.min = v; } }).el,
        stepper({ etiqueta: `${unidad} máx.`, valor: d.max, min: 1, max: 999, paso: d.medida === 'segundos' ? 5 : 1, alCambiar: (v) => { d.max = v; } }).el),
      h('div', { class: 'list' },
        fila({ icon: 'target', titulo: 'RIR objetivo', sub: 'Repeticiones en reserva al terminar la serie', fin: interruptor({ etiqueta: 'Usar RIR', valor: d.usaRir, alCambiar: (v) => { d.usaRir = v; pintar(); } }) }),
        fila({ icon: 'users', titulo: 'Por lado', sub: 'Las repeticiones son por pierna o por brazo; el volumen cuenta los dos lados (×2)', fin: interruptor({ etiqueta: 'Por lado', valor: d.porLado, alCambiar: (v) => { d.porLado = v; } }) })),
      d.usaRir ? h('div', { class: 'grid-2' },
        stepper({ etiqueta: 'RIR mín.', valor: d.rirMin, min: 0, max: 5, paso: 1, teclado: false, alCambiar: (v) => { d.rirMin = v; } }).el,
        stepper({ etiqueta: 'RIR máx.', valor: d.rirMax, min: 0, max: 5, paso: 1, teclado: false, alCambiar: (v) => { d.rirMax = v; } }).el) : null,
      h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Superserie'),
        opcionesSuper.length > 1
          ? segmentado({ etiqueta: 'Superserie', opciones: opcionesSuper, valor: d.superserie, alElegir: (v) => { d.superserie = v; } })
          : h('p', { class: 't-small muted' }, 'Hay que tener otro ejercicio en el día para formar una superserie.')),
      campoTexto({ etiqueta: 'Consejo de técnica', valor: d.consejo, max: 300, area: true, placeholder: 'Qué cuidar en este ejercicio', alCambiar: (v) => { d.consejo = v; } }),
      ...personas.map(bloquePersona),
      nuevo ? null : h('div', { class: 'field' }, h('span', { class: 'field__label' }, `Posición ${idx + 1} de ${dia.ejercicios.length}`),
        h('div', { class: 'grid-2' },
          h('button', { class: 'btn btn--secondary', type: 'button', disabled: idx === 0, on: { click: () => mover(-1) } }, icono('chevron-up'), ' Subir'),
          h('button', { class: 'btn btn--secondary', type: 'button', disabled: idx === dia.ejercicios.length - 1, on: { click: () => mover(1) } }, icono('chevron-down'), ' Bajar'))),
      callout({ tipo: 'accent', icon: 'info', texto: 'Solo cambia las sesiones que aún no has iniciado. Lo ya entrenado no se modifica.' }),
    ];
    redibujarConFoco(cuerpo, () => cuerpo.replaceChildren(...nodos.filter(Boolean)));
    cuerpo.scrollTop = y;
  }

  pintar();
  const pie = h('div', { class: 'sheet__foot' },
    nuevo ? null : h('button', { class: 'btn btn--danger-ghost', type: 'button', aria: { label: 'Quitar ejercicio' }, on: { click: quitar } }, icono('trash')),
    h('button', { class: 'btn', type: 'button', dataset: { guardarEjercicio: '' }, on: { click: guardar } }, nuevo ? 'Agregar ejercicio' : 'Guardar cambios'));
  hoja = abrirHoja([cuerpo, pie], { titulo: nuevo ? 'Agregar ejercicio' : 'Editar ejercicio', alCerrar: () => ambito.liberar() });
  return hoja;
}
