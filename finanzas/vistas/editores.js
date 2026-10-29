/*
 * editores.js — hojas de edición de categorías y pagos recurrentes (Ajustes).
 * Las categorías automáticas (Pago de deudas, Abono extra, Ahorro y metas) solo cambian de nombre e ícono.
 */
import { h, icono, poner, ejecutar, boton, campoPesos, segmentado, abrirSelector, mostrarAviso, interruptor, GRUPOS_TITULO, recuperarFoco, unSoloEnvio } from './comun.js';
import { respaldarAntesDe, TEXTO_RESPALDO_REASIGNAR } from './datos.js';
import { abrirHoja, confirmar } from '../../shared/ui/hoja.js';
import { CLAVES_ICONO_CATEGORIA } from '../../shared/ui/iconos.js';
import { guardarCategoria, archivarCategoria, guardarRecurrente, borrarRecurrente, reasignarCategoria, usosDeCategoria } from '../logica/acciones.js';

const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const nombreIcono = (c) => c.charAt(0).toUpperCase() + c.slice(1);

/** Lista de categorías agrupada, con alta, edición y archivado. */
export function abrirCategorias(ctx) {
  const cuerpo = h('div', { class: 'sheet__body stack' });
  const dibujar = () => {
    const datos = ctx.tienda.datos();
    const grupo = (titulo, cats) => cats.length ? [h('span', { class: 't-label' }, titulo), h('div', { class: 'list' }, cats.map((c) => h('button', { class: 'item', type: 'button', on: { click: () => abrirEditorCategoria(ctx, c, redibujar) }, aria: { label: `Editar categoría ${c.nombre}` } },
      h('span', { class: 'item__icon' }, icono(c.icono)),
      h('span', { class: 'item__main' }, h('span', { class: 'item__title', style: { display: 'block' } }, c.nombre, c.archivada ? [' ', h('span', { class: 'badge' }, 'Archivada')] : null, c.vinculo ? [' ', h('span', { class: 'badge badge--info' }, 'Automática')] : null)),
      icono('chevron-right'))))] : [];
    const ordenadas = [...datos.categorias].sort((a, b) => a.orden - b.orden);
    poner(cuerpo, 
      ...grupo('Necesidades', ordenadas.filter((c) => c.tipo === 'gasto' && c.grupo === 'necesidades')),
      ...grupo('Gustos', ordenadas.filter((c) => c.tipo === 'gasto' && c.grupo === 'gustos')),
      ...grupo('Ahorro', ordenadas.filter((c) => c.tipo === 'gasto' && c.grupo === 'ahorro')),
      ...grupo('Ingresos', ordenadas.filter((c) => c.tipo === 'ingreso')),
      boton('Agregar categoría', { icono: 'plus', clase: 'btn--secondary btn--block', onClick: () => abrirEditorCategoria(ctx, null, redibujar) }));
  };
  // La lista se reconstruye al guardar: el foco vuelve a la hoja (si no, Esc dejaría de funcionar con el teclado).
  const redibujar = () => { dibujar(); if (hoja.panel.isConnected) hoja.panel.focus({ preventScroll: true }); };
  dibujar();
  const hoja = abrirHoja([cuerpo], { titulo: 'Categorías' });
  return hoja;
}

function abrirEditorCategoria(ctx, categoria, alGuardar) {
  const nueva = !categoria;
  // H-07: al archivar, la hoja de confirmación y el editor se cierran con ~300 ms de diferencia y el último en cerrarse devuelve el
  // foco a un botón que ya no existe: Esc dejaba de cerrar la lista de categorías. Se reasigna el foco cuando ambas ya se fueron.
  const luego = () => { alGuardar(); setTimeout(recuperarFoco, 350); };
  const est = { tipo: categoria?.tipo ?? 'gasto', grupo: categoria?.grupo ?? 'gustos', icono: categoria?.icono ?? 'otro' };
  const nombre = h('input', { class: 'input', type: 'text', value: categoria?.nombre ?? '', attrs: { maxlength: 40, 'aria-label': 'Nombre de la categoría', autocomplete: 'off', placeholder: 'Ej.: Mascotas' } });
  const zona = h('div', { class: 'stack stack--lg' });
  const chipIcono = h('button', { class: 'chip', type: 'button' });
  chipIcono.addEventListener('click', async () => {
    const v = await abrirSelector({ titulo: 'Ícono', seleccionado: est.icono, opciones: CLAVES_ICONO_CATEGORIA.map((c) => ({ valor: c, titulo: nombreIcono(c), icono: c })) });
    if (v) { est.icono = v; pintar(); }
  });
  const pintar = () => {
    chipIcono.replaceChildren(icono(est.icono), 'Ícono');
    poner(zona, 
      nueva ? segmentado({ etiqueta: 'Tipo de categoría', valor: est.tipo, opciones: [{ valor: 'gasto', titulo: 'Gasto' }, { valor: 'ingreso', titulo: 'Ingreso' }], alCambiar: (v) => { est.tipo = v; pintar(); } }) : null,
      est.tipo === 'gasto' && !categoria?.vinculo
        ? h('div', { class: 'stack stack--sm' }, h('span', { class: 'field__label' }, 'Grupo del presupuesto'), segmentado({ etiqueta: 'Grupo', valor: est.grupo, opciones: ['necesidades', 'gustos', 'ahorro'].map((g) => ({ valor: g, titulo: GRUPOS_TITULO[g] })), alCambiar: (v) => { est.grupo = v; pintar(); } }), h('p', { class: 'field__hint' }, 'Cambiar el grupo afecta también los reportes de ciclos pasados.'))
        : null,
      h('div', { class: 'chip-row' }, chipIcono),
      categoria?.vinculo ? h('p', { class: 'field__hint' }, 'Es una categoría automática: solo puedes cambiar su nombre e ícono.') : null);
    recuperarFoco(); // el segmentado de grupo/tipo se reconstruye: el foco no puede quedar en <body>
  };
  pintar();
  const guardar = boton(nueva ? 'Agregar categoría' : 'Guardar cambios', {
    icono: 'check', clase: 'btn--lg btn--block',
    // R2F-09: un doble toque (la hoja tarda ~300 ms en cerrarse) creaba dos categorías iguales.
    onClick: unSoloEnvio(() => {
      const r = ejecutar(ctx, guardarCategoria, { categoria: nueva ? { nombre: nombre.value, tipo: est.tipo, grupo: est.grupo, icono: est.icono } : { id: categoria.id, nombre: nombre.value, grupo: est.grupo, icono: est.icono } }, { exito: nueva ? 'Categoría agregada' : 'Categoría actualizada' });
      if (r.ok) { hoja.cerrar(); luego(); }
      return r.ok;
    }),
  });
  const archivar = nueva || categoria.vinculo ? null : boton(categoria.archivada ? 'Restaurar' : 'Archivar', { icono: categoria.archivada ? 'restore' : 'trash', clase: 'btn--secondary', onClick: async () => {
    if (!categoria.archivada) { const ok = await confirmar({ titulo: '¿Archivar esta categoría?', mensaje: 'Dejará de ofrecerse al registrar movimientos y no se copiará a los próximos presupuestos. Sus movimientos se conservan.', confirmar: 'Archivar' }); if (!ok) return; }
    const r = ejecutar(ctx, archivarCategoria, { id: categoria.id, archivada: !categoria.archivada }, { exito: categoria.archivada ? 'Categoría restaurada' : 'Categoría archivada' });
    if (r.ok) { hoja.cerrar(); luego(); }
  } });
  // Q12: con movimientos, además de archivar se pueden REASIGNAR a otra categoría (con confirmación) y la de origen se archiva.
  async function reasignar() {
    const datos = ctx.tienda.datos();
    const destinos = datos.categorias.filter((c) => c.id !== categoria.id && c.tipo === categoria.tipo && c.vinculo === null && !c.archivada);
    if (!destinos.length) { mostrarAviso('No hay otra categoría activa del mismo tipo. Agrega una primero.', { tipo: 'warn' }); return; }
    const hacia = await abrirSelector({ titulo: 'Reasignar a la categoría', opciones: destinos.map((c) => ({ valor: c.id, titulo: c.nombre, sub: c.grupo ? GRUPOS_TITULO[c.grupo] : undefined, icono: c.icono })) });
    if (!hacia) return;
    const destino = destinos.find((c) => c.id === hacia);
    const u = usosDeCategoria(datos, categoria.id);
    const partes = [`${u.movimientos} movimiento${u.movimientos === 1 ? '' : 's'}`];
    if (u.recurrentes) partes.push(`${u.recurrentes} pago${u.recurrentes === 1 ? '' : 's'} recurrente${u.recurrentes === 1 ? '' : 's'}`);
    if (u.ciclosConPresupuesto) partes.push(`su presupuesto de ${u.ciclosConPresupuesto} ciclo${u.ciclosConPresupuesto === 1 ? '' : 's'} (se suma al de ${destino.nombre})`);
    if (u.ingreso) partes.push('el ingreso mensual');
    // N-05: el texto dice "ingresos" o "gastos" según el tipo de la categoría (antes decía siempre "esos gastos").
    const queSon = categoria.tipo === 'ingreso' ? 'esos ingresos' : 'esos gastos';
    const ok = await confirmar({ titulo: `¿Reasignar a ${destino.nombre} y archivar ${categoria.nombre}?`, mensaje: `Se mueven ${partes.join(', ')}. ${categoria.nombre} queda archivada. Los reportes de ciclos pasados mostrarán ${queSon} en ${destino.nombre}. ${TEXTO_RESPALDO_REASIGNAR}`, confirmar: 'Reasignar y archivar', peligro: true });
    if (!ok) return;
    if (!(await respaldarAntesDe(ctx, 'antes-de-reasignar-categoria'))) return; // R2F-14: respaldo automático para poder volver atrás
    const r = ejecutar(ctx, reasignarCategoria, { desdeId: categoria.id, haciaId: hacia }, { exito: 'Categoría reasignada y archivada' });
    if (r.ok) { hoja.cerrar(); luego(); }
  }
  const usada = !nueva && !categoria.vinculo && !categoria.archivada && (() => { const u = usosDeCategoria(ctx.tienda.datos(), categoria.id); return u.movimientos > 0 || u.recurrentes > 0 || u.ciclosConPresupuesto > 0 || u.ingreso; })();
  const reasignarBtn = usada ? boton('Reasignar movimientos a otra categoría', { icono: 'swap', clase: 'btn--secondary', onClick: () => reasignar() }) : null;
  const cuerpo = h('div', { class: 'sheet__body stack stack--lg' }, h('div', { class: 'field' }, h('label', { class: 'field__label' }, 'Nombre'), nombre), zona, reasignarBtn);
  const hoja = abrirHoja([cuerpo, h('div', { class: 'sheet__foot' }, archivar, guardar)], { titulo: nueva ? 'Agregar categoría' : `Editar ${categoria.nombre}` });
}

/** Editor de un pago recurrente (crear o editar). alGuardar() redibuja la lista de Ajustes. */
export function abrirEditorRecurrente(ctx, rec, alGuardar) {
  const nueva = !rec;
  const datos0 = ctx.tienda.datos();
  const est = {
    tipo: rec?.tipo ?? 'gasto', categoriaId: rec?.categoriaId ?? null, cuentaId: rec?.cuentaId ?? datos0.ajustes.ingreso.cuentaId,
    frecuencia: rec?.frecuencia.tipo ?? 'mensual', dia: rec?.frecuencia.dia ?? 1, diaSemana: rec?.frecuencia.diaSemana ?? 1, activo: rec?.activo ?? true,
  };
  const nombre = h('input', { class: 'input', type: 'text', value: rec?.nombre ?? '', attrs: { maxlength: 40, 'aria-label': 'Nombre del pago', autocomplete: 'off', placeholder: 'Ej.: Arriendo' } });
  const monto = campoPesos({ etiqueta: 'Monto', valor: rec?.monto ?? null, id: 'r-monto' });
  const min = campoPesos({ etiqueta: 'Rango: mínimo (opcional)', valor: rec?.rango?.min ?? null, id: 'r-min' });
  const max = campoPesos({ etiqueta: 'Rango: máximo (opcional)', valor: rec?.rango?.max ?? null, id: 'r-max' });
  const dia = h('input', { class: 'input num', type: 'number', value: est.dia, attrs: { min: 1, max: 31, inputmode: 'numeric', 'aria-label': 'Día del mes' } });
  const zona = h('div', { class: 'stack stack--lg' });
  const pintar = () => {
    const d = ctx.tienda.datos();
    const cat = d.categorias.find((c) => c.id === est.categoriaId);
    const cta = d.cuentas.find((c) => c.id === est.cuentaId);
    if (!cat || cat.tipo !== est.tipo) est.categoriaId = d.categorias.find((c) => c.tipo === est.tipo && c.vinculo === null && !c.archivada)?.id ?? null;
    const cat2 = d.categorias.find((c) => c.id === est.categoriaId);
    poner(zona, 
      nueva ? segmentado({ etiqueta: 'Tipo', valor: est.tipo, opciones: [{ valor: 'gasto', titulo: 'Gasto' }, { valor: 'ingreso', titulo: 'Ingreso' }], alCambiar: (v) => { est.tipo = v; est.categoriaId = null; pintar(); } }) : null,
      h('div', { class: 'chip-row', role: 'group', aria: { label: 'Categoría y cuenta' } },
        h('button', { class: 'chip', type: 'button', on: { click: async () => { const v = await abrirSelector({ titulo: 'Categoría', seleccionado: est.categoriaId, opciones: d.categorias.filter((c) => c.tipo === est.tipo && c.vinculo === null && !c.archivada).map((c) => ({ valor: c.id, titulo: c.nombre, icono: c.icono })) }); if (v) { est.categoriaId = v; pintar(); } } } }, icono(cat2?.icono ?? 'otro'), cat2?.nombre ?? 'Categoría', icono('chevron-down')),
        h('button', { class: 'chip', type: 'button', on: { click: async () => { const v = await abrirSelector({ titulo: 'Cuenta', seleccionado: est.cuentaId, opciones: d.cuentas.filter((c) => !c.archivada && (est.tipo === 'gasto' || c.tipo !== 'credito')).map((c) => ({ valor: c.id, titulo: c.nombre, icono: c.icono })) }); if (v) { est.cuentaId = v; pintar(); } } } }, icono(cta?.icono ?? 'banco'), cta?.nombre ?? 'Cuenta', icono('chevron-down'))),
      segmentado({ etiqueta: 'Frecuencia', valor: est.frecuencia, opciones: [{ valor: 'mensual', titulo: 'Cada mes' }, { valor: 'semanal', titulo: 'Cada semana' }], alCambiar: (v) => { est.frecuencia = v; pintar(); } }),
      est.frecuencia === 'mensual'
        ? h('div', { class: 'field' }, h('label', { class: 'field__label' }, 'Día del mes (1–31)'), dia, h('span', { class: 'field__hint' }, 'Si el mes no tiene ese día, se toma el último día del mes.'))
        : h('div', { class: 'stack stack--sm' }, h('span', { class: 'field__label' }, 'Día de la semana'), h('div', { class: 'chip-row chip-row--wrap' }, DIAS_SEMANA.map((n, i) => h('button', { class: 'chip', type: 'button', aria: { pressed: String(est.diaSemana === i + 1) }, on: { click: () => { est.diaSemana = i + 1; pintar(); } } }, n.slice(0, 3))))),
      h('div', { class: 'item', style: { borderTop: 0 } }, h('div', { class: 'item__main' }, h('div', { class: 'item__title' }, 'Activo'), h('div', { class: 'item__sub' }, 'Si lo apagas deja de aparecer en Próximos pagos')), interruptor({ etiqueta: 'Activo', valor: est.activo, alCambiar: (v) => { est.activo = v; } })));
  };
  pintar();
  const guardar = boton(nueva ? 'Agregar recurrente' : 'Guardar cambios', {
    icono: 'check', clase: 'btn--lg btn--block',
    // R2F-09: un doble toque creaba dos recurrentes iguales (y los dos se podían marcar como pagados).
    onClick: unSoloEnvio(() => {
      const m = monto.valor();
      if (!m) { mostrarAviso('Escribe el monto', { tipo: 'warn' }); return false; }
      const lo = min.valor();
      const hi = max.valor();
      if ((lo === null) !== (hi === null)) { mostrarAviso('Para usar un rango escribe el mínimo y el máximo', { tipo: 'warn' }); return false; }
      const frecuencia = est.frecuencia === 'mensual' ? { tipo: 'mensual', dia: Number(dia.value) } : { tipo: 'semanal', diaSemana: est.diaSemana };
      const campos = { nombre: nombre.value, tipo: est.tipo, monto: m, rango: lo === null ? null : { min: lo, max: hi }, categoriaId: est.categoriaId, cuentaId: est.cuentaId, frecuencia, activo: est.activo };
      const r = ejecutar(ctx, guardarRecurrente, { recurrente: nueva ? campos : { id: rec.id, ...campos } }, { exito: nueva ? 'Recurrente agregado' : 'Recurrente actualizado' });
      if (r.ok) { hoja.cerrar(); alGuardar(); }
      return r.ok;
    }),
  });
  const borrar = nueva ? null : boton('Borrar', { icono: 'trash', clase: 'btn--danger-ghost', onClick: async () => {
    const ok = await confirmar({ titulo: '¿Borrar este pago recurrente?', mensaje: 'Los movimientos que ya creaste con él se conservan.', confirmar: 'Borrar', peligro: true });
    if (!ok) return;
    const r = ejecutar(ctx, borrarRecurrente, { id: rec.id }, { exito: 'Recurrente borrado' });
    if (r.ok) { hoja.cerrar(); alGuardar(); }
  } });
  const cuerpo = h('div', { class: 'sheet__body stack stack--lg' },
    h('div', { class: 'field' }, h('label', { class: 'field__label' }, 'Nombre'), nombre), monto.el,
    h('div', { class: 'grid-2' }, min.el, max.el), h('p', { class: 'field__hint' }, 'Con rango (p. ej. unos servicios que cambian cada mes) "Marcar pagado" te deja editar el monto.'),
    zona);
  const hoja = abrirHoja([cuerpo, h('div', { class: 'sheet__foot' }, borrar, guardar)], { titulo: nueva ? 'Agregar recurrente' : `Editar ${rec.nombre}` });
}

