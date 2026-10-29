/*
 * movimientos.js — lista agrupada por día, búsqueda, filtros, edición y borrado (desde la hoja de edición).
 * Búsqueda: texto (nota, categoría, cuenta, deuda, meta o monto) sobre TODOS los ciclos; sin texto, el ciclo elegido.
 * Listas largas: se muestran de 60 en 60 días ("Ver más") para no crear miles de nodos.
 */
import { h, icono, pesos, fechaCorta, nombreCiclo, estadoVacio, abrirSelector, capitalizar, GRUPOS_COLOR } from './comun.js';
import { vaciar } from '../../shared/lib/dom.js';
import { esCicloId } from '../../shared/lib/validacion.js';
import { cicloAnterior, cicloSiguiente, rangoCiclo } from '../../shared/lib/ciclos.js';
import { abrirFormulario } from './agregar.js';
import { estadoCiclo, etiquetaRango } from '../logica/periodo.js';

const DIAS_POR_BLOQUE = 60;
const TIPOS_FILTRO = [['todos', 'Todos'], ['gasto', 'Gastos'], ['ingreso', 'Ingresos'], ['transferencia', 'Transferencias']];

const sinTildes = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function montar(raiz, ctx) {
  const params = ctx.parametros;
  const datos0 = ctx.tienda.datos();
  const estado = { texto: '', tipo: 'todos', categoriaId: null, cuentaId: null, ciclo: null, dias: DIAS_POR_BLOQUE };
  const cicloParam = params.get('ciclo');
  if (esCicloId(cicloParam) && cicloParam >= datos0.ajustes.cicloInicial) estado.ciclo = cicloParam;
  const catParam = params.get('cat');
  if (catParam && datos0.categorias.some((c) => c.id === catParam)) estado.categoriaId = catParam;

  const entrada = h('input', { type: 'search', placeholder: 'Buscar movimientos', attrs: { 'aria-label': 'Buscar movimientos', autocomplete: 'off' } });
  entrada.addEventListener('input', () => { estado.texto = entrada.value; estado.dias = DIAS_POR_BLOQUE; dibujar(); });
  const buscador = h('div', { class: 'searchbar' }, icono('search'), entrada);
  const zonaFiltros = h('div', { class: 'stack stack--sm' });
  const zonaLista = h('div', { class: 'stack', style: { gap: '0' } });
  vaciar(raiz);
  raiz.append(buscador, zonaFiltros, zonaLista);
  ctx.shell.titulo('Movimientos', '');
  ctx.shell.fab(true);

  function nombres(datos) {
    return {
      cuenta: new Map(datos.cuentas.map((c) => [c.id, c.nombre])),
      categoria: new Map(datos.categorias.map((c) => [c.id, c])),
      deuda: new Map(datos.deudas.map((d) => [d.id, d.nombre])),
      meta: new Map(datos.metas.map((m) => [m.id, m.nombre])),
    };
  }

  function descripcion(m, n) {
    const cat = n.categoria.get(m.categoriaId);
    const cuenta = n.cuenta.get(m.cuentaId);
    switch (m.tipo) {
      case 'gasto': return { icono: cat?.icono ?? 'otro', color: GRUPOS_COLOR[cat?.grupo] ?? 'var(--text-3)', titulo: m.nota || cat?.nombre || 'Gasto', sub: m.nota ? `${cat?.nombre ?? ''} · ${cuenta ?? ''}` : cuenta, monto: pesos(-m.monto), clase: 'money--neg' };
      case 'ingreso': return { icono: 'ingreso', color: 'var(--ok)', titulo: m.nota || cat?.nombre || 'Ingreso', sub: `${cat?.nombre ?? 'Ingreso'} · ${cuenta ?? ''}`, monto: `+${pesos(m.monto)}`, clase: 'money--pos' };
      case 'transferencia': return { icono: 'transferencia', color: 'var(--text-3)', titulo: m.nota || 'Transferencia', sub: `${cuenta} → ${n.cuenta.get(m.cuentaDestinoId)}`, monto: pesos(m.monto), clase: 'money--neg' };
      case 'pagoDeuda': return { icono: 'deuda', color: GRUPOS_COLOR[cat?.grupo] ?? 'var(--text-3)', titulo: m.nota || `Pago ${n.deuda.get(m.deudaId) ?? 'de deuda'}`, sub: `${cat?.nombre ?? 'Pago de deuda'} · ${cuenta} → ${n.deuda.get(m.deudaId)}${m.interes ? ` · intereses ${pesos(m.interes)}` : ''}`, monto: pesos(-m.monto), clase: 'money--neg' };
      case 'aporteMeta': return { icono: 'escudo', color: 'var(--cat-save)', titulo: m.nota || `Aporte a ${n.meta.get(m.metaId) ?? 'meta'}`, sub: `${cat?.nombre ?? 'Ahorro'} · ${cuenta}${m.cuentaDestinoId ? ` → ${n.cuenta.get(m.cuentaDestinoId)}` : ' (apartado)'}`, monto: pesos(-m.monto), clase: 'money--neg' };
      case 'retiroMeta': return { icono: 'escudo', color: 'var(--cat-save)', titulo: m.nota || `Retiro de ${n.meta.get(m.metaId) ?? 'meta'}`, sub: `${cat?.nombre ?? 'Ahorro'} · ${cuenta}${m.cuentaDestinoId ? ` → ${n.cuenta.get(m.cuentaDestinoId)}` : ''}`, monto: `+${pesos(m.monto)}`, clase: 'money--pos' };
      case 'ajusteCuenta': return { icono: 'sliders', color: 'var(--info)', titulo: m.nota, sub: `Ajuste de saldo · ${cuenta}`, monto: m.monto > 0 ? `+${pesos(m.monto)}` : pesos(m.monto), clase: m.monto > 0 ? 'money--pos' : 'money--neg' };
      default: return { icono: 'sliders', color: 'var(--info)', titulo: m.nota, sub: `Ajuste de deuda · ${n.deuda.get(m.deudaId)}`, monto: m.monto > 0 ? `+${pesos(m.monto)}` : pesos(m.monto), clase: 'money--neg' };
    }
  }

  function textoBusqueda(m, n, d) {
    const cat = n.categoria.get(m.categoriaId);
    return sinTildes([m.nota, cat?.nombre, n.cuenta.get(m.cuentaId), n.cuenta.get(m.cuentaDestinoId), n.deuda.get(m.deudaId), n.meta.get(m.metaId), d.titulo, String(Math.abs(m.monto)), pesos(Math.abs(m.monto)), m.tipo].filter(Boolean).join(' '));
  }

  function dibujar() {
    const datos = ctx.tienda.datos();
    const hoy = ctx.reloj.hoy();
    const est = estadoCiclo(datos, hoy);
    const ciclo = estado.ciclo && estado.ciclo <= est.ciclo ? estado.ciclo : est.ciclo;
    const rango = rangoCiclo(ciclo, est.historial);
    const n = nombres(datos);
    const buscando = estado.texto.trim().length > 0;
    const consulta = sinTildes(estado.texto.trim()).replace(/\./g, '');
    ctx.shell.titulo('Movimientos', `Ciclo ${nombreCiclo(ciclo, est.historial).toLowerCase()} · ${etiquetaRango(rango)}`);

    let lista = datos.movimientos.filter((m) => buscando || (m.fecha >= rango.inicio && m.fecha <= rango.fin));
    if (estado.tipo !== 'todos') lista = lista.filter((m) => m.tipo === estado.tipo);
    if (estado.categoriaId) lista = lista.filter((m) => m.categoriaId === estado.categoriaId);
    if (estado.cuentaId) lista = lista.filter((m) => m.cuentaId === estado.cuentaId || m.cuentaDestinoId === estado.cuentaId);
    const descritos = lista.map((m) => ({ m, d: descripcion(m, n) }));
    const filtrados = buscando ? descritos.filter(({ m, d }) => textoBusqueda(m, n, d).replace(/\./g, '').includes(consulta)) : descritos;
    filtrados.sort((a, b) => (a.m.fecha === b.m.fecha ? (a.m.creadoEn < b.m.creadoEn ? 1 : -1) : a.m.fecha < b.m.fecha ? 1 : -1));
    // N-01: "Gastado" usa el mismo corte que Presupuesto e Inicio (fecha ≤ hoy): lo programado a futuro no suma hasta su fecha.
    const gastado = filtrados.filter(({ m }) => m.tipo === 'gasto' && m.fecha <= hoy).reduce((s, { m }) => s + m.monto, 0);

    // --- Filtros ---
    const catSel = estado.categoriaId ? n.categoria.get(estado.categoriaId) : null;
    const ctaSel = estado.cuentaId ? n.cuenta.get(estado.cuentaId) : null;
    vaciar(zonaFiltros);
    zonaFiltros.append(
      h('div', { class: 'chip-row', role: 'group', aria: { label: 'Filtro por tipo' } },
        TIPOS_FILTRO.map(([valor, titulo]) => h('button', { class: 'chip', type: 'button', aria: { pressed: String(estado.tipo === valor) }, on: { click: () => { estado.tipo = valor; estado.dias = DIAS_POR_BLOQUE; dibujar(); } } }, titulo)),
        h('button', { class: 'chip', type: 'button', aria: { pressed: String(!!catSel) }, on: { click: async () => {
          const v = await abrirSelector({ titulo: 'Filtrar por categoría', seleccionado: estado.categoriaId ?? '', opciones: [{ valor: '', titulo: 'Todas las categorías' }, ...datos.categorias.filter((c) => !c.archivada || datos.movimientos.some((m) => m.categoriaId === c.id)).map((c) => ({ valor: c.id, titulo: c.nombre, icono: c.icono }))] });
          if (v !== undefined) { estado.categoriaId = v || null; dibujar(); }
        } } }, icono('otro'), catSel ? catSel.nombre : 'Categoría', icono('chevron-down')),
        h('button', { class: 'chip', type: 'button', aria: { pressed: String(!!ctaSel) }, on: { click: async () => {
          const v = await abrirSelector({ titulo: 'Filtrar por cuenta', seleccionado: estado.cuentaId ?? '', opciones: [{ valor: '', titulo: 'Todas las cuentas' }, ...datos.cuentas.map((c) => ({ valor: c.id, titulo: c.nombre, icono: c.icono }))] });
          if (v !== undefined) { estado.cuentaId = v || null; dibujar(); }
        } } }, icono('wallet'), ctaSel ? ctaSel : 'Cuenta', icono('chevron-down'))),
      h('div', { class: 'split' },
        buscando
          ? h('span', { class: 't-small muted' }, `${filtrados.length} ${filtrados.length === 1 ? 'resultado' : 'resultados'} en todos los ciclos`)
          : h('div', { class: 'cluster', style: { gap: '4px' } },
            h('button', { class: 'icon-btn', type: 'button', aria: { label: 'Ciclo anterior' }, disabled: ciclo <= datos.ajustes.cicloInicial, on: { click: () => { estado.ciclo = cicloAnterior(ciclo); estado.dias = DIAS_POR_BLOQUE; dibujar(); } } }, icono('chevron-left')),
            h('span', { class: 't-small muted' }, `${nombreCiclo(ciclo, est.historial)} · ${filtrados.length} ${filtrados.length === 1 ? 'movimiento' : 'movimientos'}`),
            h('button', { class: 'icon-btn', type: 'button', aria: { label: 'Ciclo siguiente' }, disabled: ciclo >= est.ciclo, on: { click: () => { estado.ciclo = cicloSiguiente(ciclo); estado.dias = DIAS_POR_BLOQUE; dibujar(); } } }, icono('chevron-right'))),
        h('span', { class: 't-small muted' }, 'Gastado ', h('b', { class: 'num' }, pesos(gastado)))));

    // --- Lista por día ---
    vaciar(zonaLista);
    if (!filtrados.length) {
      zonaLista.append(buscando || estado.tipo !== 'todos' || estado.categoriaId || estado.cuentaId
        ? estadoVacio({ icono: 'search', titulo: 'Sin resultados', texto: 'Prueba con otra búsqueda o quita los filtros.' })
        : estadoVacio({ icono: 'list', titulo: 'Aún no hay movimientos en este ciclo', texto: 'Registra tu primer gasto o ingreso con el botón +.' }));
      return;
    }
    const porDia = new Map();
    for (const x of filtrados) { if (!porDia.has(x.m.fecha)) porDia.set(x.m.fecha, []); porDia.get(x.m.fecha).push(x); }
    const dias = [...porDia.entries()];
    for (const [fecha, filas] of dias.slice(0, estado.dias)) {
      const totalDia = filas.filter(({ m }) => m.tipo === 'gasto').reduce((s, { m }) => s + m.monto, 0);
      const etiqueta = fecha === hoy ? `Hoy · ${fechaCorta(fecha)}` : capitalizar(fechaCorta(fecha));
      zonaLista.append(
        h('div', { class: 'txn-day' }, h('span', { class: 't-label' }, etiqueta, fecha > hoy ? ' · programado' : ''), totalDia ? h('span', { class: 't-small muted num' }, pesos(-totalDia)) : null),
        h('div', { class: 'card card--tight txn-list' }, filas.map(({ m, d }) => h('button', {
          class: 'txn', type: 'button', aria: { label: `Editar movimiento: ${d.titulo}, ${pesos(Math.abs(m.monto))}` }, on: { click: () => abrirFormulario(ctx, { movimiento: m }) },
        },
        h('span', { class: 'txn__icon', style: { '--sw': d.color } }, icono(d.icono)),
        h('span', { class: 'txn__main' }, h('span', { class: 'txn__title', style: { display: 'block' } }, d.titulo), h('span', { class: 'txn__sub', style: { display: 'block' } }, d.sub)),
        h('span', { class: `money ${d.clase}` }, d.monto)))));
    }
    if (dias.length > estado.dias) {
      zonaLista.append(h('button', { class: 'btn btn--secondary btn--block', style: { marginTop: 'var(--sp-4)' }, type: 'button', on: { click: () => { estado.dias += DIAS_POR_BLOQUE; dibujar(); } } }, `Ver más (${dias.length - estado.dias} días)`));
    }
  }

  dibujar();
  return { actualizar: dibujar, desmontar() { vaciar(raiz); } };
}
