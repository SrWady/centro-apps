/*
 * metas.js — metas de ahorro personalizadas (Viaje, Vehículo, Fondo de emergencia, Casa…): crear, editar, archivar, eliminar, aportar y retirar.
 * Cada meta tiene nombre, ícono y color; el monto objetivo y la fecha límite son OPCIONALES. Sin objetivo es un "ahorro libre": solo
 * acumula (sin faltante ni aporte sugerido). Con objetivo y fecha: aporte sugerido = lo que falta ÷ ciclos que quedan (incluye el actual),
 * redondeado hacia arriba (ESQUEMA §11). Un aporte consume UNA sola línea del presupuesto: la barra propia de la meta (si el usuario eligió
 * "Presupuestar un monto mensual") o, si no, "Ahorro y metas" (Q8).
 */
import { h, icono, crearVista, pesos, porcentaje, fechaCorta, diaMes, ejecutar, boton, campoPesos, estadoVacio, cantidad, abrirSelector, pedirFecha, mostrarAviso, nombreCiclo, unSoloEnvio, interruptor, haptic, poner, nombreIcono } from './comun.js';
import { anillo } from '../../shared/ui/graficos.js';
import { abrirHoja, confirmar } from '../../shared/ui/hoja.js';
import { CLAVES_ICONO_CATEGORIA } from '../../shared/ui/iconos.js';
import { abrirFormulario } from './agregar.js';
import { respaldarAntesDe } from './datos.js';
import { estadoCiclo } from '../logica/periodo.js';
import { totalApartadoMetas } from '../logica/saldos.js';
import { barraDeMeta, progresoMeta } from '../logica/metas.js';
import { resumenCiclo } from '../logica/presupuesto.js';
import { COLORES_META } from '../logica/esquema.js';
import { guardarMeta, archivarMeta, borrarMeta, usosDeMeta } from '../logica/acciones.js';

/** Color de cada etiqueta de meta (variables del tema: se ven bien en claro y oscuro). */
export const COLOR_DE_META = { acento: 'var(--accent)', azul: 'var(--cat-needs)', naranja: 'var(--cat-wants)', verde: 'var(--cat-save)', celeste: 'var(--info)', amarillo: 'var(--warn)', rojo: 'var(--danger)', gris: 'var(--series-muted)' };
const NOMBRE_COLOR = { acento: 'Violeta', azul: 'Azul', naranja: 'Naranja', verde: 'Verde', celeste: 'Celeste', amarillo: 'Amarillo', rojo: 'Rojo', gris: 'Gris' };
export const colorDeMeta = (meta) => COLOR_DE_META[meta.color] ?? COLOR_DE_META.verde;

export function montar(raiz, ctx) {
  const estado = { archivadas: false };
  const vista = crearVista(raiz, () => dibujar(ctx, estado, () => vista.actualizar()));
  return vista;
}

/** Hoja para crear o editar una meta de ahorro. */
export function abrirEditorMeta(ctx, meta) {
  const nueva = !meta;
  const datos0 = ctx.tienda.datos();
  const hoy = ctx.reloj.hoy();
  const barraActual = meta ? barraDeMeta(datos0, meta.id) : null;
  const est = { icono: meta?.icono ?? 'ahorro', color: meta?.color ?? 'verde', fecha: meta?.fechaLimite ?? '', presupuestar: false };
  const nombre = h('input', { class: 'input', type: 'text', value: meta?.nombre ?? '', attrs: { maxlength: 40, 'aria-label': 'Nombre de la meta', autocomplete: 'off', placeholder: 'Ej.: Viaje, Vehículo, Casa' } });
  const errorNombre = h('p', { class: 'field__hint danger', role: 'alert' });
  errorNombre.hidden = true;
  const decir = (texto) => { errorNombre.textContent = texto ?? ''; errorNombre.hidden = !texto; nombre.setAttribute('aria-invalid', texto ? 'true' : 'false'); if (texto) { haptic('error'); nombre.focus(); } };
  nombre.addEventListener('input', () => { if (!errorNombre.hidden) decir(''); });
  const objetivo = campoPesos({ etiqueta: 'Monto objetivo (opcional)', valor: meta?.objetivo ?? null, id: 'm-obj', ayuda: 'Déjalo vacío para un ahorro libre: solo acumula lo que aportes, sin aporte sugerido.' });
  const mensual = campoPesos({ etiqueta: 'Monto mensual para presupuestar', valor: null, id: 'm-mensual', ayuda: 'Se asigna al ciclo actual y a los ciclos futuros ya creados; los próximos lo heredan al copiar el presupuesto.' });
  const chipFecha = h('button', { class: 'chip', type: 'button' });
  const quitarFecha = h('button', { class: 'chip', type: 'button', aria: { label: 'Quitar la fecha límite' } }, icono('x'), 'Quitar fecha');
  const chipIcono = h('button', { class: 'chip', type: 'button' });
  const zonaFecha = h('div', { class: 'field' });
  const zonaColor = h('div', { class: 'chip-row chip-row--wrap', role: 'radiogroup', aria: { label: 'Color de la meta' } });
  const zonaPresupuesto = h('div', { class: 'stack' });
  const sugeridoParaPresupuestar = () => {
    const obj = objetivo.valor();
    if (!obj || !est.fecha) return null;
    try { return progresoMeta(datos0, { id: '__nueva__', objetivo: obj, fechaLimite: est.fecha }, hoy).sugerido; } catch { return null; }
  };
  const pintarColor = () => poner(zonaColor, COLORES_META.map((k) => h('button', { class: 'chip', type: 'button', role: 'radio', aria: { checked: String(est.color === k), label: NOMBRE_COLOR[k] }, style: { minWidth: '44px', justifyContent: 'center', borderColor: est.color === k ? COLOR_DE_META[k] : undefined }, on: { click: () => { est.color = k; pintar(); } } },
    h('span', { style: { width: '20px', height: '20px', borderRadius: '50%', background: COLOR_DE_META[k], display: 'inline-block', boxShadow: est.color === k ? '0 0 0 3px var(--surface-1), 0 0 0 5px currentColor' : 'none' } }))));
  const pintarPresupuesto = () => {
    if (barraActual) {
      const ciclo = estadoCiclo(ctx.tienda.datos(), hoy).ciclo;
      const asignado = ctx.tienda.datos().presupuestos[ciclo]?.asignaciones[barraActual.id];
      poner(zonaPresupuesto, h('p', { class: 'field__hint' }, `Esta meta tiene su propia barra en Presupuesto (Ahorro › ${barraActual.nombre})${asignado !== undefined ? `: ${pesos(asignado)} este ciclo` : ''}. El monto se cambia allí.`));
      return;
    }
    poner(zonaPresupuesto,
      h('div', { class: 'item', style: { borderTop: 0, padding: 0 } }, h('div', { class: 'item__main' }, h('div', { class: 'item__title' }, 'Presupuestar un monto mensual para esta meta'), h('div', { class: 'item__sub' }, 'Crea una barra propia en Presupuesto, en el grupo Ahorro')), interruptor({ etiqueta: 'Presupuestar un monto mensual para esta meta', valor: est.presupuestar, alCambiar: (v) => { est.presupuestar = v; if (v && !mensual.valor()) { const s = sugeridoParaPresupuestar(); if (s) mensual.fijar(s); } pintarPresupuesto(); } })),
      est.presupuestar ? mensual.el : null);
  };
  const pintar = () => {
    chipFecha.replaceChildren(icono('calendar'), est.fecha ? `Fecha límite: ${diaMes(est.fecha)} ${est.fecha.slice(0, 4)}` : 'Elegir fecha límite');
    chipIcono.replaceChildren(icono(est.icono), `Ícono: ${nombreIcono(est.icono)}`);
    pintarColor();
    pintarFecha();
  };
  const pintarFecha = () => {
    const hayObjetivo = objetivo.valor() !== null;
    poner(zonaFecha, h('span', { class: 'field__label' }, 'Fecha límite (opcional)'),
      hayObjetivo ? h('div', { class: 'chip-row' }, chipFecha, est.fecha ? quitarFecha : null) : h('p', { class: 'field__hint' }, 'Escribe un monto objetivo para poder poner una fecha límite y ver el aporte sugerido.'),
      hayObjetivo && !est.fecha ? h('p', { class: 'field__hint' }, 'Con fecha, la app calcula cuánto aportar cada ciclo.') : null);
  };
  objetivo.input.addEventListener('input', () => { if (objetivo.valor() === null) est.fecha = ''; pintarFecha(); pintar(); });
  chipFecha.addEventListener('click', async () => { const v = await pedirFecha({ titulo: 'Fecha límite', valor: est.fecha || undefined, min: nueva ? hoy : undefined }); if (v) { est.fecha = v; pintar(); } });
  quitarFecha.addEventListener('click', () => { est.fecha = ''; pintar(); });
  chipIcono.addEventListener('click', async () => { const v = await abrirSelector({ titulo: 'Ícono de la meta', seleccionado: est.icono, opciones: CLAVES_ICONO_CATEGORIA.map((c) => ({ valor: c, titulo: nombreIcono(c), icono: c })) }); if (v) { est.icono = v; pintar(); } });
  pintar();
  pintarPresupuesto();

  const guardar = boton(nueva ? 'Crear meta de ahorro' : 'Guardar cambios', {
    icono: 'check', clase: 'btn--lg btn--block',
    onClick: unSoloEnvio(() => {
      const obj = objetivo.valor();
      const campos = { nombre: nombre.value, objetivo: obj, fechaLimite: obj === null || !est.fecha ? null : est.fecha, icono: est.icono, color: est.color };
      let presupuestoMensual;
      if (!barraActual && est.presupuestar) {
        presupuestoMensual = mensual.valor();
        if (!presupuestoMensual) { mostrarAviso('Escribe el monto mensual que quieres presupuestar o apaga esa opción', { tipo: 'warn' }); return false; }
      }
      const r = ctx.tienda.ejecutar(guardarMeta, { meta: nueva ? campos : { id: meta.id, ...campos }, presupuestoMensual });
      if (!r.ok) { decir(r.mensaje || 'No se pudo guardar.'); return false; }
      mostrarAviso(nueva ? `Meta "${nombre.value.trim()}" creada` : 'Meta actualizada', { tipo: 'ok' });
      hoja.cerrar();
      return true;
    }),
  });
  const archivar = nueva ? null : boton(meta.archivada ? 'Restaurar' : 'Archivar', { icono: meta.archivada ? 'restore' : 'trash', clase: 'btn--secondary btn--block', onClick: async () => {
    if (!meta.archivada) {
      const ok = await confirmar({ titulo: '¿Archivar esta meta?', mensaje: `Dejará de ofrecerse al aportar y de aparecer en la lista. Sus aportes se conservan en Movimientos y en los saldos${barraActual ? '; su barra de Presupuesto se archiva y deja de presupuestarse en los ciclos futuros' : ''}. Puedes restaurarla cuando quieras.`, confirmar: 'Archivar' });
      if (!ok) return;
    }
    const r = ejecutar(ctx, archivarMeta, { id: meta.id, archivada: !meta.archivada }, { exito: meta.archivada ? 'Meta restaurada' : 'Meta archivada' });
    if (r.ok) hoja.cerrar();
  } });
  const eliminar = nueva ? null : boton('Eliminar', { icono: 'trash', clase: 'btn--danger-ghost btn--block', onClick: () => eliminarMeta(ctx, meta, () => hoja.cerrar()) });
  const cuerpo = h('div', { class: 'sheet__body stack stack--lg' },
    h('div', { class: 'field' }, h('label', { class: 'field__label' }, 'Nombre'), nombre, errorNombre),
    h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Ícono'), h('div', { class: 'chip-row' }, chipIcono)),
    h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Color'), zonaColor),
    objetivo.el,
    zonaFecha,
    zonaPresupuesto,
    archivar, eliminar);
  const hoja = abrirHoja([cuerpo, h('div', { class: 'sheet__foot' }, guardar)], { titulo: nueva ? 'Nueva meta de ahorro' : `Editar ${meta.nombre}` });
  return hoja;
}

/**
 * Eliminar una meta. Sin aportes: confirmación y listo. Con aportes: nunca quedan huérfanos; se ofrece moverlos a otra meta o archivar la
 * meta (se conservan). Se guarda un respaldo automático antes de mover (no hay "Deshacer").
 */
export function eliminarMeta(ctx, meta, alTerminar) {
  const datos = ctx.tienda.datos();
  const u = usosDeMeta(datos, meta.id);
  if (u.movimientos === 0) {
    confirmar({ titulo: `¿Eliminar "${meta.nombre}"?`, mensaje: `No tiene aportes ni retiros.${u.barra ? ' Se elimina también su barra de Presupuesto del ciclo actual y de los siguientes (los ciclos cerrados no cambian).' : ''} Esta acción no se puede deshacer; si prefieres conservarla, archívala.`, confirmar: 'Eliminar', peligro: true }).then((ok) => {
      if (!ok) return;
      const r = ejecutar(ctx, borrarMeta, { id: meta.id }, { exito: 'Meta eliminada' });
      if (r.ok) alTerminar();
    });
    return;
  }
  const otras = datos.metas.filter((m) => m.id !== meta.id && !m.archivada);
  const cuerpo = h('div', { class: 'sheet__body stack stack--lg' },
    h('div', { class: 'callout callout--warn' }, icono('alert'), h('div', null, h('span', { class: 'callout__title' }, `"${meta.nombre}" tiene ${cantidad(u.movimientos, 'aporte o retiro', 'aportes y retiros')}`), h('br'), 'Para que no queden aportes sin meta, elige qué hacer con ellos antes de eliminarla.')));
  const hoja = abrirHoja([cuerpo], { titulo: 'Eliminar meta con aportes' });
  const mover = otras.length ? boton('Mover los aportes a otra meta y eliminar', { icono: 'swap', clase: 'btn--block', onClick: async () => {
    const hacia = await abrirSelector({ titulo: 'Mover los aportes a', opciones: otras.map((m) => ({ valor: m.id, titulo: m.nombre, sub: m.objetivo === null ? 'Ahorro libre' : `Objetivo ${pesos(m.objetivo)}`, icono: m.icono })) });
    if (!hacia) return;
    const destino = otras.find((m) => m.id === hacia);
    const ok = await confirmar({ titulo: `¿Mover a ${destino.nombre} y eliminar ${meta.nombre}?`, mensaje: `Sus ${cantidad(u.movimientos, 'aporte o retiro', 'aportes y retiros')} pasan a ${destino.nombre} y consumen su presupuesto de ahorro. ${meta.nombre} se elimina. No hay "Deshacer": antes se guarda un respaldo automático (14 días) que puedes restaurar en Ajustes › Datos.`, confirmar: 'Mover y eliminar', peligro: true });
    if (!ok) return;
    if (!(await respaldarAntesDe(ctx, 'antes-de-eliminar-meta'))) return;
    const r = ejecutar(ctx, borrarMeta, { id: meta.id, destinoId: hacia }, { exito: `Aportes movidos a ${destino.nombre}; meta eliminada` });
    if (r.ok) { hoja.cerrar(); alTerminar(); }
  } }) : null;
  const archivar = boton('Archivar en lugar de eliminar', { icono: 'restore', clase: 'btn--secondary btn--block', onClick: () => {
    const r = ejecutar(ctx, archivarMeta, { id: meta.id, archivada: true }, { exito: 'Meta archivada: sus aportes se conservan' });
    if (r.ok) { hoja.cerrar(); alTerminar(); }
  } });
  cuerpo.append(...[mover, archivar, otras.length ? null : h('p', { class: 'field__hint' }, 'No hay otra meta activa a la que mover los aportes: crea una primero o archiva esta.'), boton('Cancelar', { clase: 'btn--ghost btn--block', onClick: () => hoja.cerrar() })].filter(Boolean));
}

function tarjeta(ctx, datos, res, p, ritmo) {
  const m = p.meta;
  const color = colorDeMeta(m);
  const aportes = datos.movimientos.filter((x) => x.metaId === m.id).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : a.creadoEn < b.creadoEn ? 1 : -1)).slice(0, 3);
  const propia = barraDeMeta(datos, m.id);
  const lineaPropia = propia ? res.lineas.find((l) => l.categoria.id === propia.id) : null;
  const badge = p.libre ? h('span', { class: 'badge', style: { marginTop: '6px' } }, 'Ahorro libre')
    : p.estado === 'cumplida' ? h('span', { class: 'badge badge--ok', style: { marginTop: '6px' } }, 'Meta cumplida')
      : p.estado === 'vencida' ? h('span', { class: 'badge badge--danger', style: { marginTop: '6px' } }, 'Fecha vencida')
        : p.sugerido === null ? h('span', { class: 'badge', style: { marginTop: '6px' } }, 'Sin fecha límite')
          : h('span', { class: `badge ${ritmo ? 'badge--ok' : 'badge--warn'}`, style: { marginTop: '6px' } }, ritmo ? 'En ritmo' : 'Por debajo del ritmo');
  const describe = p.libre
    ? h('div', { class: 't-small muted num' }, `Ahorrado ${pesos(p.ahorrado)}`)
    : h('div', { class: 't-small muted num' }, `${pesos(p.ahorrado)} de ${pesos(m.objetivo)}`);
  const fechaTxt = m.fechaLimite ? h('div', { class: 't-small muted' }, `Meta: ${diaMes(m.fechaLimite)} ${m.fechaLimite.slice(0, 4)} (${m.fechaLimite.split('-').reverse().join('-')})${p.estado === 'en-curso' ? ` · ${cantidad(p.ciclosRestantes, 'ciclo', 'ciclos')}` : ''}`) : null;
  const cabeza = h('div', { class: 'goal' },
    p.libre
      ? h('span', { class: 'item__icon', style: { width: '64px', height: '64px', color, background: 'var(--surface-2)' }, aria: { hidden: 'true' } }, icono(m.icono, { tam: 'lg' }))
      : anillo({ tam: 96, trazo: 10, valor: p.fraccion, color, etiqueta: `${m.nombre}: ${porcentaje(p.fraccion)} de la meta`, centro: h('span', { class: 'ring__value num' }, porcentaje(p.fraccion)) }),
    h('div', { class: 'item__main' },
      p.libre ? null : h('span', { class: 'item__icon', style: { marginBottom: '6px', color, background: 'var(--surface-2)' } }, icono(m.icono)),
      h('h2', { class: 't-h', id: `m-${m.id}` }, m.nombre),
      describe, fechaTxt, badge));
  const sinFin = p.libre || p.estado === 'cumplida';
  const cifras = sinFin ? null : h('div', { class: 'grid-2', style: { marginTop: 'var(--sp-3)' } },
    p.sugerido === null
      ? h('div', { class: 'fact' }, h('span', { class: 'fact__l' }, 'Aporte sugerido'), h('span', { class: 'fact__v' }, 'Pon una fecha'))
      : h('div', { class: 'fact' }, h('span', { class: 'fact__l' }, p.estado === 'vencida' ? 'Falta por aportar' : 'Aporte sugerido por ciclo'), h('span', { class: 'fact__v' }, pesos(p.estado === 'vencida' ? p.faltante : p.sugerido))),
    p.sugerido === null
      ? h('div', { class: 'fact' }, h('span', { class: 'fact__l' }, 'Falta'), h('span', { class: 'fact__v' }, pesos(p.faltante)))
      : h('div', { class: 'fact' }, h('span', { class: 'fact__l' }, 'Pendiente este ciclo'), h('span', { class: 'fact__v' }, pesos(p.pendienteCiclo))));
  const faltan = sinFin ? null : h('p', { class: 't-small muted', style: { marginTop: 'var(--sp-2)' } }, `Faltan ${pesos(p.faltante)}${p.estado === 'en-curso' && p.ciclosRestantes !== null ? ` en ${cantidad(p.ciclosRestantes, 'ciclo', 'ciclos')}` : ''}.`);
  return h('section', { class: 'card', aria: { labelledby: `m-${m.id}` } },
    cabeza,
    cifras,
    faltan,
    // H-10: un aporte con fecha futura todavía no suma a lo ahorrado ni al ciclo: se muestra aparte para que las cifras cuadren.
    p.programado > 0 ? h('p', { class: 't-small', style: { marginTop: 'var(--sp-2)' } }, icono('calendar'), ` Programado con fecha futura: ${pesos(p.programado)} (aún no suma a lo ahorrado)`) : null,
    p.libre ? h('p', { class: 't-small muted', style: { marginTop: 'var(--sp-2)' } }, 'Ahorro libre: solo acumula lo que aportes; no tiene faltante ni aporte sugerido.') : null,
    lineaPropia ? h('p', { class: 't-small muted', style: { marginTop: 'var(--sp-2)' } }, `Presupuesto de esta meta este ciclo: ${pesos(lineaPropia.ejecutado)} de ${pesos(lineaPropia.asignado)} (Ahorro › ${propia.nombre}).`) : null,
    // R1F-04: un retiro no puede superar lo apartado; se avisa cuánto hay para que el mensaje de error no sorprenda.
    h('div', { class: 'grid-2', style: { marginTop: 'var(--sp-3)' } },
      h('button', { class: 'btn btn--sm', type: 'button', aria: { label: `Aportar a ${m.nombre}` }, on: { click: () => abrirFormulario(ctx, { tipo: 'aporteMeta', preset: { tipo: 'aporteMeta', metaId: m.id, monto: p.pendienteCiclo || 0 } }) } }, icono('plus'), 'Aportar'),
      h('button', { class: 'btn btn--secondary btn--sm', type: 'button', disabled: p.ahorrado <= 0, aria: { label: `Retirar de ${m.nombre}` }, on: { click: () => abrirFormulario(ctx, { tipo: 'retiroMeta', preset: { tipo: 'retiroMeta', metaId: m.id } }) } }, icono('arrow-up-right'), 'Retirar')),
    h('div', { class: 'cluster', style: { marginTop: 'var(--sp-2)', justifyContent: 'space-between' } },
      p.ahorrado > 0 ? h('span', { class: 't-caption muted' }, `Puedes retirar hasta ${pesos(p.ahorrado)}`) : h('span', { class: 't-caption muted' }, 'Aún sin aportes'),
      h('button', { class: 'btn btn--ghost btn--sm', type: 'button', aria: { label: `Editar ${m.nombre}` }, on: { click: () => abrirEditorMeta(ctx, m) } }, icono('pencil'), 'Editar')),
    aportes.length ? h('div', { style: { marginTop: 'var(--sp-3)' } }, h('span', { class: 't-label' }, 'Últimos movimientos'), h('div', { class: 'list' }, aportes.map((a) => h('button', { class: 'item', type: 'button', on: { click: () => abrirFormulario(ctx, { movimiento: a }) }, aria: { label: `Editar ${a.tipo === 'aporteMeta' ? 'aporte' : 'retiro'} del ${fechaCorta(a.fecha)}` } },
      h('span', { class: 'item__main' }, h('span', { class: 'item__title', style: { display: 'block' } }, a.tipo === 'aporteMeta' ? 'Aporte' : 'Retiro'), h('span', { class: 'item__sub', style: { display: 'block' } }, fechaCorta(a.fecha))),
      h('span', { class: `item__end money ${a.tipo === 'aporteMeta' ? 'money--pos' : ''}` }, `${a.tipo === 'aporteMeta' ? '+' : '−'}${pesos(a.monto)}`))))) : null);
}

function dibujar(ctx, estado, redibujar) {
  const datos = ctx.tienda.datos();
  const hoy = ctx.reloj.hoy();
  const est = estadoCiclo(datos, hoy);
  const res = resumenCiclo(datos, est.ciclo, hoy);
  const activas = datos.metas.filter((m) => !m.archivada).map((m) => progresoMeta(datos, m, hoy));
  const archivadas = datos.metas.filter((m) => m.archivada);
  const lineaGenerica = res.lineas.find((l) => l.categoria.vinculo === 'metas');
  const presupuestado = lineaGenerica?.asignado ?? 0;
  const sinBarra = activas.filter((p) => !barraDeMeta(datos, p.meta.id));
  const sugeridoGenerico = sinBarra.filter((p) => p.sugerido !== null && p.estado !== 'cumplida').reduce((s, p) => s + p.sugerido, 0);
  const ritmoDe = (p) => {
    const propia = barraDeMeta(datos, p.meta.id);
    if (propia) return (res.lineas.find((l) => l.categoria.id === propia.id)?.asignado ?? 0) >= (p.sugerido ?? 0);
    return presupuestado >= sugeridoGenerico;
  };
  // RU-11: UNA sola definición con Cuentas ("Apartado para metas"): aportes − retiros de TODAS las metas (también las archivadas, que conservan su dinero).
  const totalAhorrado = totalApartadoMetas(datos, hoy);
  const enArchivadas = archivadas.reduce((s, m) => s + progresoMeta(datos, m, hoy).ahorrado, 0);
  ctx.shell.titulo('Metas de ahorro', 'Tus ahorros y objetivos');
  ctx.shell.fab(false);
  const nodos = [];

  nodos.push(h('section', { class: 'card stack', aria: { labelledby: 'mt-t' } },
    h('div', { class: 'split' },
      h('div', null, h('span', { class: 't-label', id: 'mt-t' }, 'Total ahorrado en metas'), h('div', { class: 't-title num', style: { fontSize: 'var(--fs-xl)' } }, pesos(totalAhorrado)), h('span', { class: 't-caption' }, `${activas.length ? `${cantidad(activas.length, 'meta', 'metas')} activa${activas.length === 1 ? '' : 's'}` : 'Aún no tienes metas'}${enArchivadas !== 0 ? ` · incluye ${pesos(enArchivadas)} de ${cantidad(archivadas.length, 'meta archivada', 'metas archivadas')}` : ''}`)),
      h('span', { class: 'item__icon item__icon--accent' }, icono('target'))),
    boton('Nueva meta de ahorro', { icono: 'plus', clase: 'btn--lg btn--block', onClick: () => abrirEditorMeta(ctx, null) })));

  if (!activas.length) nodos.push(h('section', { class: 'card' }, estadoVacio({ icono: 'target', titulo: 'Aún no tienes metas de ahorro', texto: 'Crea la tuya: Viaje, Vehículo, Casa, Fondo de emergencia… Con un monto objetivo y una fecha, la app calcula cuánto aportar cada ciclo; sin objetivo es un ahorro libre que solo acumula.' })));
  for (const p of activas) nodos.push(tarjeta(ctx, datos, res, p, ritmoDe(p)));

  if (sinBarra.length === 1 && sinBarra[0].sugerido !== null && sinBarra[0].estado === 'en-curso') {
    const p = sinBarra[0];
    nodos.push(h('p', { class: 't-small muted' }, presupuestado === p.sugerido ? 'Tu aporte presupuestado (Ahorro y metas) cubre exactamente lo sugerido.' : presupuestado > p.sugerido ? `Tu presupuesto de Ahorro y metas (${pesos(presupuestado)}) supera lo sugerido.` : `Tu presupuesto de Ahorro y metas (${pesos(presupuestado)}) es menor que lo sugerido.`));
  }
  if (sinBarra.length > 1) nodos.push(h('div', { class: 'callout callout--accent' }, icono('info'), h('div', null, `Aporte sugerido total ${pesos(sugeridoGenerico)} por ciclo frente a ${pesos(presupuestado)} presupuestados en "Ahorro y metas" (${nombreCiclo(est.ciclo, est.historial).toLowerCase()}), para las metas que no tienen barra propia.`)));

  if (archivadas.length) {
    nodos.push(boton(estado.archivadas ? 'Ocultar metas archivadas' : `Ver metas archivadas (${archivadas.length})`, { icono: 'chevron-down', clase: 'btn--secondary btn--block', onClick: () => { estado.archivadas = !estado.archivadas; redibujar(); } }));
    if (estado.archivadas) nodos.push(h('section', { class: 'card card--tight' }, h('div', { class: 'list' }, archivadas.map((m) => {
      const p = progresoMeta(datos, m, hoy);
      return h('button', { class: 'item', type: 'button', on: { click: () => abrirEditorMeta(ctx, m) }, aria: { label: `Editar meta archivada ${m.nombre}` } },
        h('span', { class: 'item__icon', style: { color: colorDeMeta(m) } }, icono(m.icono)),
        h('span', { class: 'item__main' }, h('span', { class: 'item__title', style: { display: 'block' } }, m.nombre, ' ', h('span', { class: 'badge' }, 'Archivada')), h('span', { class: 'item__sub', style: { display: 'block' } }, m.objetivo === null ? 'Ahorro libre' : `Objetivo ${pesos(m.objetivo)}`)),
        h('span', { class: 'item__end money' }, pesos(p.ahorrado)));
    }))));
  }
  nodos.push(h('div', { class: 'callout' }, icono('info'), h('div', null, 'Con objetivo y fecha: aporte sugerido = lo que falta ÷ ciclos que quedan hasta la fecha (incluye el ciclo actual). Cada aporte consume una sola línea del presupuesto: la barra propia de la meta, si la creaste, o "Ahorro y metas".')));
  return nodos;
}
