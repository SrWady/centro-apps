/*
 * rutina.js — editor de la rutina semanal (T2.5): días (día de la semana, nombre, calentamiento, cardio) y ejercicios
 * (agregar, quitar, reordenar y editar todos los campos). Los cambios solo afectan sesiones no iniciadas: al iniciar una
 * sesión se congela una copia de su día, así que el historial nunca cambia.
 */
import { h, vaciar } from '../../shared/lib/dom.js';
import { diaSemana } from '../../shared/lib/fechas.js';
import { icono } from '../../shared/ui/icono.js';
import { textoCardio, textoMetaEjercicio, NOMBRES_DIA, CORTOS_DIA } from '../logica/formato.js';
import { segmentado, callout, estadoVacio } from './comun.js';
import { abrirEditorEjercicio } from './editor-ejercicio.js';
import { abrirEditorDia, abrirEditorCardio } from './editor-dia.js';

export function montar(raiz, ctx) {
  const { tienda, reloj, shell } = ctx;
  let diaSel = ctx.parametros.get('dia');
  let montado = true;

  function render() {
    if (!montado) return;
    const datos = tienda.datos();
    const dias = datos.rutina.dias;
    const personas = datos.ajustes.personas;
    shell.titulo('Rutina', 'Plan semanal');
    if (!dias.some((x) => x.id === diaSel)) {
      const deHoy = dias.find((x) => x.diaSemana === diaSemana(reloj.hoy()));
      diaSel = (deHoy ?? dias[0])?.id ?? null;
    }
    const dia = dias.find((x) => x.id === diaSel) ?? null;
    const descanso = [1, 2, 3, 4, 5, 6, 7].filter((n) => !dias.some((x) => x.diaSemana === n));

    const nodos = [];
    if (dias.length) {
      nodos.push(segmentado({ etiqueta: 'Día de la rutina', opciones: dias.map((x) => ({ valor: x.id, texto: CORTOS_DIA[x.diaSemana] })), valor: diaSel, alElegir: (v) => { diaSel = v; render(); } }));
    }
    nodos.push(h('div', { class: 'split' },
      h('p', { class: 't-caption' }, descanso.length ? `${descanso.map((n) => CORTOS_DIA[n]).join(', ')}: descanso.` : 'La rutina usa los 7 días.'),
      dias.length < 7 ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button', dataset: { agregarDia: '' }, on: { click: () => abrirEditorDia({ ctx, alGuardar: (nuevo) => { if (nuevo) { diaSel = nuevo.id; render(); } } }) } }, icono('plus'), ' Agregar día') : null));

    if (!dia) {
      nodos.push(estadoVacio({ icon: 'clipboard', titulo: 'Sin días de rutina', texto: 'Agrega un día para empezar a planear tus entrenamientos.' }));
    } else {
      const total = dia.ejercicios.reduce((t, e) => t + e.series, 0);
      nodos.push(h('section', { class: 'card', dataset: { panelDia: dia.id }, aria: { labelledby: 'rut-t' } },
        h('div', { class: 'split', style: { marginBottom: 'var(--sp-2)' } },
          h('div', null, h('span', { class: 't-label' }, `${NOMBRES_DIA[dia.diaSemana]} · ${total} series`), h('h2', { class: 't-h', id: 'rut-t' }, dia.nombre)),
          h('button', { class: 'icon-btn icon-btn--filled', type: 'button', aria: { label: 'Editar día' }, dataset: { editarDia: '' }, on: { click: () => abrirEditorDia({ ctx, dia, alGuardar: (g) => { if (g) diaSel = g.id; render(); } }) } }, icono('pencil'))),
        dia.calentamiento ? callout({ icon: 'activity', titulo: 'Calentamiento', texto: dia.calentamiento }) : null,
        dia.ejercicios.map((e) => fila(e, dia, personas)),
        h('div', { class: 'routine-ex', style: { minHeight: '56px' } },
          h('span', { class: 'item__icon item__icon--accent' }, icono('activity')),
          h('div', { class: 'routine-ex__main' }, h('div', { class: 'item__title' }, 'Cardio'), h('div', { class: 'item__sub' }, dia.cardio ? textoCardio(dia.cardio) : 'Sin cardio en este día')),
          h('button', { class: 'icon-btn', type: 'button', aria: { label: dia.cardio ? 'Editar cardio' : 'Agregar cardio' }, dataset: { editarCardio: '' }, on: { click: () => abrirEditorCardio({ ctx, dia }) } }, icono(dia.cardio ? 'pencil' : 'plus'))),
        h('button', { class: 'btn btn--secondary btn--block', type: 'button', style: { marginTop: 'var(--sp-3)' }, dataset: { agregarEjercicio: '' }, disabled: dia.ejercicios.length >= 20, on: { click: () => abrirEditorEjercicio({ ctx, diaId: dia.id }) } }, icono('plus'), ' Agregar ejercicio')));
    }
    nodos.push(callout({ tipo: 'accent', icon: 'info', titulo: 'Los cambios no tocan tu historial', texto: 'Solo afectan sesiones que aún no has iniciado. Al empezar una sesión se congela una copia de sus ejercicios.' }));
    const y = raiz.scrollTop;
    vaciar(raiz);
    raiz.append(...nodos);
    raiz.scrollTop = y;
  }

  function fila(e, dia, personas) {
    const partes = [textoMetaEjercicio(e)];
    const lineas = [h('span', null, partes.join(''))];
    if (e.superserie) lineas.push(h('span', null, ' · '), h('span', { class: 'accent' }, `Superserie ${e.superserie}`));
    for (const p of personas) {
      const a = e.ajustes[p.id];
      if (!a) continue;
      const cambios = [];
      if (a.series !== undefined || a.min !== undefined || a.max !== undefined) cambios.push(`${a.series ?? e.series} × ${a.min ?? e.min}${(a.max ?? e.max) !== (a.min ?? e.min) ? `–${a.max ?? e.max}` : ''}`);
      if (a.rir) cambios.push(`RIR ${a.rir.min === a.rir.max ? a.rir.min : `${a.rir.min}–${a.rir.max}`}`);
      if (a.descansoSeg !== undefined) cambios.push(`${a.descansoSeg} s`);
      if (a.nota) cambios.push(a.nota);
      if (cambios.length) lineas.push(h('span', null, ' · '), h('span', { class: 'routine-ex__ajuste' }, `${p.nombre}: ${cambios.join(', ')}`));
    }
    return h('div', { class: ['routine-ex', e.superserie ? 'routine-ex--ss' : ''] },
      h('button', { class: 'routine-ex__main', type: 'button', style: { border: 0, background: 'none', color: 'inherit', textAlign: 'left', fontFamily: 'inherit', padding: 0, minHeight: 'var(--tap)', cursor: 'pointer' }, aria: { label: `Editar ${e.nombre}` }, on: { click: () => abrirEditorEjercicio({ ctx, diaId: dia.id, ejercicio: e }) } },
        h('div', { class: 'item__title' }, e.nombre), h('div', { class: 'item__sub' }, lineas),
        e.consejo ? h('div', { class: 'routine-ex__consejo', dataset: { consejo: '' } }, h('b', null, 'Técnica: '), e.consejo) : null), // F-01: el consejo también se lee en Rutina (se edita en el ejercicio)
      h('span', { class: 'icon-btn routine-ex__editar', aria: { hidden: 'true' } }, icono('pencil')));
  }

  const desuscribir = tienda.suscribir((ev) => { if (ev.tipo === 'cambio') render(); });
  render();
  return {
    actualizar() { render(); },
    desmontar() { montado = false; desuscribir(); },
  };
}
