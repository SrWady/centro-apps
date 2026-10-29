/*
 * editor-dia.js — hojas "Editar día" (nombre, día de la semana, calentamiento) y "Editar cardio" (T2.5).
 * Los cambios solo afectan sesiones no iniciadas; el historial nunca cambia.
 */
import { h } from '../../shared/lib/dom.js';
import { abrirHoja, confirmar } from '../../shared/ui/hoja.js';
import { haptic } from '../../shared/ui/haptica.js';
import { icono } from '../../shared/ui/icono.js';
import { guardarDiaRutina, borrarDiaRutina } from '../logica/acciones.js';
import { NOMBRES_DIA, CORTOS_DIA } from '../logica/formato.js';
import { interruptor, crearAmbito, ejecutar, fila, callout, redibujarConFoco } from './comun.js';

function campo({ etiqueta, valor, max, alCambiar, area = false, placeholder = '' }) {
  const control = area
    ? h('textarea', { class: 'input', rows: 2, maxLength: max, placeholder, aria: { label: etiqueta } })
    : h('input', { class: 'input', type: 'text', maxLength: max, autocomplete: 'off', placeholder, aria: { label: etiqueta } });
  control.value = valor;
  control.addEventListener('input', () => alCambiar(control.value));
  return h('div', { class: 'field' }, h('span', { class: 'field__label' }, etiqueta), control);
}

/** Hoja para crear (sin `dia`) o editar un día de la rutina. */
export function abrirEditorDia({ ctx, dia = null, alGuardar }) {
  const dias = ctx.tienda.datos().rutina.dias;
  const ocupados = new Map(dias.filter((x) => !dia || x.id !== dia.id).map((x) => [x.diaSemana, x.nombre]));
  const libre = [1, 2, 3, 4, 5, 6, 7].find((n) => !ocupados.has(n));
  const d = { nombre: dia ? dia.nombre : '', diaSemana: dia ? dia.diaSemana : libre, calentamiento: dia ? dia.calentamiento : '' };
  const chips = h('div', { class: 'chip-row chip-row--wrap', role: 'group', aria: { label: 'Día de la semana' } });
  const pintarChips = () => redibujarConFoco(chips, () => chips.replaceChildren(...[1, 2, 3, 4, 5, 6, 7].map((n) => h('button', {
    class: 'chip', type: 'button', aria: { pressed: String(d.diaSemana === n), label: `${NOMBRES_DIA[n]}${ocupados.has(n) ? `, ocupado por ${ocupados.get(n)}` : ''}` },
    disabled: ocupados.has(n),
    on: { click: () => { d.diaSemana = n; haptic('select'); pintarChips(); } },
  }, CORTOS_DIA[n]))));
  pintarChips();

  const cuerpo = h('div', { class: 'sheet__body stack stack--lg' },
    campo({ etiqueta: 'Nombre del día', valor: d.nombre, max: 60, placeholder: 'Ej.: Torso completo', alCambiar: (v) => { d.nombre = v; } }),
    h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Día de la semana'), chips,
      ocupados.size ? h('p', { class: 'field__hint' }, 'Los días deshabilitados ya tienen otra rutina.') : null),
    campo({ etiqueta: 'Calentamiento (opcional)', valor: d.calentamiento, max: 200, area: true, placeholder: 'Ej.: movilidad de hombros y escápulas', alCambiar: (v) => { d.calentamiento = v; } }),
    dia ? null : callout({ icon: 'info', texto: 'El día nuevo empieza con un ejercicio de ejemplo que podrás editar o cambiar.' }),
    callout({ tipo: 'accent', icon: 'info', texto: 'Solo cambia las sesiones que aún no has iniciado. Lo ya entrenado no se modifica.' }));

  const guardar = () => {
    const r = ejecutar(ctx, guardarDiaRutina, { dia: { ...(dia ? { id: dia.id } : {}), diaSemana: d.diaSemana, nombre: d.nombre, calentamiento: d.calentamiento } });
    if (!r.ok) { haptic('error'); return; }
    haptic('success');
    hoja.cerrar();
    if (alGuardar) alGuardar(ctx.tienda.datos().rutina.dias.find((x) => x.diaSemana === d.diaSemana));
  };
  const borrar = async () => {
    const ok = await confirmar({ titulo: `¿Borrar «${dia.nombre}»?`, mensaje: 'Se quita el día de la rutina. Las sesiones ya iniciadas y tu historial se conservan.', confirmar: 'Borrar día', peligro: true });
    if (!ok) return;
    if (ejecutar(ctx, borrarDiaRutina, { diaId: dia.id }).ok) { hoja.cerrar(); if (alGuardar) alGuardar(null); }
  };
  const pie = h('div', { class: 'sheet__foot' },
    dia ? h('button', { class: 'btn btn--danger-ghost', type: 'button', aria: { label: 'Borrar día' }, on: { click: borrar } }, icono('trash')) : null,
    h('button', { class: 'btn', type: 'button', dataset: { guardarDia: '' }, on: { click: guardar } }, dia ? 'Guardar cambios' : 'Agregar día'));
  const hoja = abrirHoja([cuerpo, pie], { titulo: dia ? 'Editar día' : 'Agregar día' });
  return hoja;
}

/** Hoja para editar o quitar el cardio de un día. */
export function abrirEditorCardio({ ctx, dia }) {
  const ambito = crearAmbito();
  const stepper = (o) => ambito.stepper(o);
  const c = dia.cardio;
  const d = {
    incluir: c !== null, nombre: c ? c.nombre : 'Caminadora', minutos: c ? c.minutos : 20, nota: c ? c.nota : '',
    usaVel: !!(c && c.velocidadKmH), velMin: c?.velocidadKmH?.min ?? 4.5, velMax: c?.velocidadKmH?.max ?? 5.5,
    usaInc: !!(c && c.inclinacionPct), incMin: c?.inclinacionPct?.min ?? 8, incMax: c?.inclinacionPct?.max ?? 10,
  };
  const cuerpo = h('div', { class: 'sheet__body stack stack--lg' });
  function pintar() {
    ambito.liberar();
    const y = cuerpo.scrollTop;
    const nodos = [
      h('div', { class: 'list' }, fila({ icon: 'activity', titulo: 'Incluir cardio', sub: 'Aparece al final de la sesión', fin: interruptor({ etiqueta: 'Incluir cardio', valor: d.incluir, alCambiar: (v) => { d.incluir = v; pintar(); } }) })),
      d.incluir ? campo({ etiqueta: 'Tipo de cardio', valor: d.nombre, max: 60, placeholder: 'Caminadora, bicicleta, elíptica…', alCambiar: (v) => { d.nombre = v; } }) : null,
      d.incluir ? stepper({ etiqueta: 'Duración', valor: d.minutos, min: 1, max: 180, paso: 1, sufijo: ' min', alCambiar: (v) => { d.minutos = v; } }).el : null,
      d.incluir ? h('div', { class: 'list' }, fila({ icon: 'trend', titulo: 'Rango de velocidad', sub: 'km/h', fin: interruptor({ etiqueta: 'Indicar velocidad', valor: d.usaVel, alCambiar: (v) => { d.usaVel = v; pintar(); } }) })) : null,
      d.incluir && d.usaVel ? h('div', { class: 'grid-2' },
        stepper({ etiqueta: 'Velocidad mín.', valor: d.velMin, min: 0, max: 30, paso: 0.1, decimales: 1, sufijo: ' km/h', alCambiar: (v) => { d.velMin = v; } }).el,
        stepper({ etiqueta: 'Velocidad máx.', valor: d.velMax, min: 0, max: 30, paso: 0.1, decimales: 1, sufijo: ' km/h', alCambiar: (v) => { d.velMax = v; } }).el) : null,
      d.incluir ? h('div', { class: 'list' }, fila({ icon: 'trend', titulo: 'Rango de inclinación', sub: '%', fin: interruptor({ etiqueta: 'Indicar inclinación', valor: d.usaInc, alCambiar: (v) => { d.usaInc = v; pintar(); } }) })) : null,
      d.incluir && d.usaInc ? h('div', { class: 'grid-2' },
        stepper({ etiqueta: 'Inclinación mín.', valor: d.incMin, min: 0, max: 30, paso: 0.5, decimales: 1, sufijo: ' %', alCambiar: (v) => { d.incMin = v; } }).el,
        stepper({ etiqueta: 'Inclinación máx.', valor: d.incMax, min: 0, max: 30, paso: 0.5, decimales: 1, sufijo: ' %', alCambiar: (v) => { d.incMax = v; } }).el) : null,
      d.incluir ? campo({ etiqueta: 'Nota (opcional)', valor: d.nota, max: 300, placeholder: 'Ej.: intervalos', alCambiar: (v) => { d.nota = v; } }) : null,
      callout({ tipo: 'accent', icon: 'info', texto: 'Solo cambia las sesiones que aún no has iniciado. Lo ya entrenado no se modifica.' }),
    ];
    redibujarConFoco(cuerpo, () => cuerpo.replaceChildren(...nodos.filter(Boolean)));
    cuerpo.scrollTop = y;
  }
  pintar();
  const guardar = () => {
    const cardio = d.incluir
      ? {
        nombre: d.nombre.trim(), minutos: d.minutos,
        velocidadKmH: d.usaVel ? { min: d.velMin, max: d.velMax } : null, inclinacionPct: d.usaInc ? { min: d.incMin, max: d.incMax } : null, nota: d.nota.trim(),
      }
      : null;
    const r = ejecutar(ctx, guardarDiaRutina, { dia: { id: dia.id, diaSemana: dia.diaSemana, nombre: dia.nombre, calentamiento: dia.calentamiento, cardio } });
    if (r.ok) { haptic('success'); hoja.cerrar(); } else haptic('error');
  };
  const pie = h('div', { class: 'sheet__foot' }, h('button', { class: 'btn', type: 'button', dataset: { guardarCardio: '' }, on: { click: guardar } }, 'Guardar cambios'));
  const hoja = abrirHoja([cuerpo, pie], { titulo: 'Editar cardio', alCerrar: () => ambito.liberar() });
  return hoja;
}
