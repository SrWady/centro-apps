/*
 * metas.js — progreso, aportes y aporte mensual sugerido según la fecha límite (ESQUEMA §11).
 * Aporte sugerido = lo que falta ÷ ciclos que quedan (incluye el actual), redondeado hacia arriba.
 */
import { h, icono, crearVista, pesos, porcentaje, fechaCorta, diaMes, ejecutar, boton, campoPesos, estadoVacio, cantidad, abrirSelector, pedirFecha, mostrarAviso, nombreCiclo, unSoloEnvio } from './comun.js';
import { anillo } from '../../shared/ui/graficos.js';
import { abrirHoja, confirmar } from '../../shared/ui/hoja.js';
import { CLAVES_ICONO_CATEGORIA } from '../../shared/ui/iconos.js';
import { abrirFormulario } from './agregar.js';
import { estadoCiclo } from '../logica/periodo.js';
import { progresoMeta } from '../logica/metas.js';
import { resumenCiclo } from '../logica/presupuesto.js';
import { guardarMeta, archivarMeta } from '../logica/acciones.js';

export function montar(raiz, ctx) {
  const vista = crearVista(raiz, () => dibujar(ctx));
  return vista;
}

function abrirEditorMeta(ctx, meta) {
  const nueva = !meta;
  const est = { icono: meta?.icono ?? 'escudo', fecha: meta?.fechaLimite ?? '' };
  const nombre = h('input', { class: 'input', type: 'text', value: meta?.nombre ?? '', attrs: { maxlength: 40, 'aria-label': 'Nombre de la meta', autocomplete: 'off', placeholder: 'Ej.: Fondo de emergencia' } });
  const objetivo = campoPesos({ etiqueta: 'Objetivo', valor: meta?.objetivo ?? null, id: 'm-obj' });
  const chipFecha = h('button', { class: 'chip', type: 'button' });
  const chipIcono = h('button', { class: 'chip', type: 'button' });
  const pintar = () => {
    chipFecha.replaceChildren(icono('calendar'), est.fecha ? `${diaMes(est.fecha)} ${est.fecha.slice(0, 4)}` : 'Elegir fecha límite');
    chipIcono.replaceChildren(icono(est.icono), 'Ícono');
  };
  chipFecha.addEventListener('click', async () => { const v = await pedirFecha({ titulo: 'Fecha límite', valor: est.fecha || undefined, min: ctx.reloj.hoy() }); if (v) { est.fecha = v; pintar(); } });
  chipIcono.addEventListener('click', async () => { const v = await abrirSelector({ titulo: 'Ícono de la meta', seleccionado: est.icono, opciones: CLAVES_ICONO_CATEGORIA.map((c) => ({ valor: c, titulo: c.charAt(0).toUpperCase() + c.slice(1), icono: c })) }); if (v) { est.icono = v; pintar(); } });
  pintar();
  const guardar = boton(nueva ? 'Crear meta' : 'Guardar cambios', {
    icono: 'check', clase: 'btn--lg btn--block',
    onClick: unSoloEnvio(() => {
      const obj = objetivo.valor();
      if (!obj) { mostrarAviso('Escribe el objetivo', { tipo: 'warn' }); return false; }
      if (!est.fecha) { mostrarAviso('Elige la fecha límite', { tipo: 'warn' }); return false; }
      const campos = { nombre: nombre.value, objetivo: obj, fechaLimite: est.fecha, icono: est.icono };
      const r = ejecutar(ctx, guardarMeta, { meta: nueva ? campos : { id: meta.id, ...campos } }, { exito: nueva ? 'Meta creada' : 'Meta actualizada' });
      if (r.ok) hoja.cerrar();
      return r.ok;
    }),
  });
  const archivar = nueva ? null : boton('Archivar', { icono: 'trash', clase: 'btn--danger-ghost', onClick: async () => {
    const ok = await confirmar({ titulo: '¿Archivar esta meta?', mensaje: 'Dejará de aparecer en Metas. Sus aportes se conservan en Movimientos y en los saldos.', confirmar: 'Archivar', peligro: true });
    if (ok) { const r = ejecutar(ctx, archivarMeta, { id: meta.id }, { exito: 'Meta archivada' }); if (r.ok) hoja.cerrar(); }
  } });
  const cuerpo = h('div', { class: 'sheet__body stack stack--lg' },
    h('div', { class: 'field' }, h('label', { class: 'field__label' }, 'Nombre'), nombre),
    objetivo.el,
    h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Fecha límite y ícono'), h('div', { class: 'chip-row' }, chipFecha, chipIcono)));
  const hoja = abrirHoja([cuerpo, h('div', { class: 'sheet__foot' }, archivar, guardar)], { titulo: nueva ? 'Nueva meta' : `Editar ${meta.nombre}` });
}

function dibujar(ctx) {
  const datos = ctx.tienda.datos();
  const hoy = ctx.reloj.hoy();
  const est = estadoCiclo(datos, hoy);
  const res = resumenCiclo(datos, est.ciclo, hoy);
  const metas = datos.metas.filter((m) => !m.archivada).map((m) => progresoMeta(datos, m, hoy));
  const presupuestado = res.lineas.find((l) => l.categoria.vinculo === 'metas')?.asignado ?? 0;
  const sugeridoTotal = metas.filter((p) => p.estado !== 'cumplida').reduce((s, p) => s + p.sugerido, 0);
  ctx.shell.titulo('Metas', 'Ahorro con fecha');
  ctx.shell.fab(false);
  const nodos = [];

  if (!metas.length) nodos.push(h('section', { class: 'card' }, estadoVacio({ icono: 'target', titulo: 'Aún no tienes metas', texto: 'Crea una con un objetivo y una fecha: la app calcula cuánto aportar cada ciclo.' })));
  for (const p of metas) {
    const m = p.meta;
    const cubre = presupuestado >= sugeridoTotal;
    const badge = p.estado === 'cumplida' ? h('span', { class: 'badge badge--ok', style: { marginTop: '6px' } }, 'Meta cumplida')
      : p.estado === 'vencida' ? h('span', { class: 'badge badge--danger', style: { marginTop: '6px' } }, 'Fecha vencida')
        : h('span', { class: `badge ${cubre ? 'badge--ok' : 'badge--warn'}`, style: { marginTop: '6px' } }, cubre ? 'En ritmo' : 'Por debajo del ritmo');
    const aportes = datos.movimientos.filter((x) => x.metaId === m.id).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : a.creadoEn < b.creadoEn ? 1 : -1)).slice(0, 3);
    nodos.push(h('section', { class: 'card', aria: { labelledby: `m-${m.id}` } },
      h('div', { class: 'goal' },
        anillo({ tam: 96, trazo: 10, valor: p.fraccion, etiqueta: `${m.nombre}: ${porcentaje(p.fraccion)} de la meta`, centro: h('span', { class: 'ring__value num' }, porcentaje(p.fraccion)) }),
        h('div', { class: 'item__main' },
          h('span', { class: 'item__icon item__icon--accent', style: { marginBottom: '6px' } }, icono(m.icono)),
          h('h2', { class: 't-h', id: `m-${m.id}` }, m.nombre),
          h('div', { class: 't-small muted num' }, `${pesos(p.ahorrado)} de ${pesos(m.objetivo)}`),
          h('div', { class: 't-small muted' }, `Meta: ${diaMes(m.fechaLimite)} ${m.fechaLimite.slice(0, 4)} (${m.fechaLimite.split('-').reverse().join('-')})${p.estado === 'en-curso' ? ` · ${cantidad(p.ciclosRestantes, 'ciclo', 'ciclos')}` : ''}`),
          badge)),
      p.estado === 'cumplida' ? null : h('div', { class: 'grid-2', style: { marginTop: 'var(--sp-3)' } },
        h('div', { class: 'fact' }, h('span', { class: 'fact__l' }, p.estado === 'vencida' ? 'Falta por aportar' : 'Aporte sugerido por ciclo'), h('span', { class: 'fact__v' }, pesos(p.estado === 'vencida' ? p.faltante : p.sugerido))),
        h('div', { class: 'fact' }, h('span', { class: 'fact__l' }, 'Pendiente este ciclo'), h('span', { class: 'fact__v' }, pesos(p.pendienteCiclo)))),
      // H-10: un aporte con fecha futura todavía no suma a lo ahorrado ni al ciclo: se muestra aparte para que las cifras cuadren.
      p.programado > 0 ? h('p', { class: 't-small', style: { marginTop: 'var(--sp-2)' } }, icono('calendar'), ` Programado con fecha futura: ${pesos(p.programado)} (aún no suma a lo ahorrado)`) : null,
      p.estado === 'cumplida' ? null : h('p', { class: 't-small muted', style: { marginTop: 'var(--sp-2)' } },
        `Faltan ${pesos(p.faltante)}${p.estado === 'en-curso' ? ` en ${cantidad(p.ciclosRestantes, 'ciclo', 'ciclos')}` : ''}. `,
        metas.length === 1 ? (presupuestado === p.sugerido ? 'Tu aporte presupuestado (Ahorro y metas) cubre exactamente lo sugerido.' : presupuestado > p.sugerido ? `Tu presupuesto de Ahorro y metas (${pesos(presupuestado)}) supera lo sugerido.` : `Tu presupuesto de Ahorro y metas (${pesos(presupuestado)}) es menor que lo sugerido.`) : ''),
      h('div', { class: 'grid-2', style: { marginTop: 'var(--sp-3)' } },
        h('button', { class: 'btn btn--sm', type: 'button', on: { click: () => abrirFormulario(ctx, { tipo: 'aporteMeta', preset: { tipo: 'aporteMeta', metaId: m.id, monto: p.pendienteCiclo || 0 } }) } }, icono('plus'), 'Aportar'),
        h('button', { class: 'btn btn--secondary btn--sm', type: 'button', on: { click: () => abrirEditorMeta(ctx, m) } }, icono('pencil'), 'Editar')),
      h('div', { class: 'cluster', style: { marginTop: 'var(--sp-2)' } },
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', disabled: p.ahorrado <= 0, on: { click: () => abrirFormulario(ctx, { tipo: 'retiroMeta', preset: { tipo: 'retiroMeta', metaId: m.id } }) } }, icono('arrow-up-right'), 'Retirar'),
        // R1F-04: un retiro no puede superar lo apartado; se avisa cuánto hay para que el mensaje de error no sorprenda.
        p.ahorrado > 0 ? h('span', { class: 't-caption muted' }, `Puedes retirar hasta ${pesos(p.ahorrado)}`) : null),
      aportes.length ? h('div', { style: { marginTop: 'var(--sp-3)' } }, h('span', { class: 't-label' }, 'Últimos movimientos'), h('div', { class: 'list' }, aportes.map((a) => h('button', { class: 'item', type: 'button', on: { click: () => abrirFormulario(ctx, { movimiento: a }) }, aria: { label: `Editar ${a.tipo === 'aporteMeta' ? 'aporte' : 'retiro'} del ${fechaCorta(a.fecha)}` } },
        h('span', { class: 'item__main' }, h('span', { class: 'item__title', style: { display: 'block' } }, a.tipo === 'aporteMeta' ? 'Aporte' : 'Retiro'), h('span', { class: 'item__sub', style: { display: 'block' } }, fechaCorta(a.fecha))),
        h('span', { class: `item__end money ${a.tipo === 'aporteMeta' ? 'money--pos' : ''}` }, `${a.tipo === 'aporteMeta' ? '+' : '−'}${pesos(a.monto)}`))))) : null));
  }
  nodos.push(h('button', { class: 'btn btn--secondary btn--block', type: 'button', on: { click: () => abrirEditorMeta(ctx, null) } }, icono('plus'), 'Nueva meta'));
  if (metas.length > 1) nodos.push(h('div', { class: 'callout callout--accent' }, icono('info'), h('div', null, `Aporte sugerido total ${pesos(sugeridoTotal)} por ciclo frente a ${pesos(presupuestado)} presupuestados en "Ahorro y metas" (${nombreCiclo(est.ciclo, est.historial).toLowerCase()}).`)));
  nodos.push(h('div', { class: 'callout' }, icono('info'), h('div', null, 'Aporte sugerido = lo que falta ÷ ciclos que quedan hasta la fecha (incluye el ciclo actual). Los aportes salen de "Ahorro y metas" en el presupuesto.')));
  return nodos;
}
