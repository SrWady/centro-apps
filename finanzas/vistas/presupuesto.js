/*
 * presupuesto.js — presupuesto por ciclo: reparto 50/30/20, barras por categoría, sin asignar, edición de montos,
 * copia al ciclo siguiente y comparación con el ciclo anterior. Cálculos: logica/presupuesto.js (ESQUEMA §8).
 */
import { h, icono, crearVista, pesos, porcentaje, nombreCiclo, barra, estadoVacio, ejecutar, pedirMonto, abrirSelector, mostrarAviso, GRUPOS_TITULO, GRUPOS_COLOR } from './comun.js';
import { esCicloId } from '../../shared/lib/validacion.js';
import { cicloAnterior, cicloSiguiente } from '../../shared/lib/ciclos.js';
import { confirmar } from '../../shared/ui/hoja.js';
import { estadoCiclo, etiquetaRango } from '../logica/periodo.js';
import { resumenCiclo, compararConAnterior, ultimoCicloNavegable } from '../logica/presupuesto.js';
import { guardarAsignacion, guardarIngresoPlaneado, copiarPresupuesto, restablecerPagoDeudas } from '../logica/acciones.js';

const ORDEN = ['necesidades', 'gustos', 'ahorro'];

export function montar(raiz, ctx) {
  const estado = { ciclo: esCicloId(ctx.parametros.get('ciclo')) ? ctx.parametros.get('ciclo') : null };
  const vista = crearVista(raiz, () => dibujar(ctx, estado, () => vista.actualizar()));
  return vista;
}

function claseBarra(l) {
  if (l.alerta === 'exceso') return 'danger';
  if (l.completo) return 'ok';
  if (l.alerta === 'aviso') return 'warn';
  return '';
}

/** Texto de la línea "Pago de deudas": explica la MISMA cifra que se muestra (H-04). */
function textoPagoDeudas(pd, pesos) {
  const suma = pd.detalle.map((f) => `${f.deuda.nombre.toLowerCase()} ${pesos(f.monto)}`).join(' + ');
  const compras = 'Las compras con tarjeta consumen su categoría al comprar; el pago de la tarjeta consume esta.';
  if (pd.fijo) return `Fijado a mano en ${pesos(pd.guardado)}. Las cuotas vigentes suman ${pesos(pd.calculado)}${suma ? ` (${suma})` : ''}. ${compras}`;
  if (!pd.sigue) return `Calculado con las cuotas de ese ciclo: ${pesos(pd.guardado)}. ${compras}`;
  return pd.detalle.length ? `Suma de las cuotas: ${suma} = ${pesos(pd.calculado)}. ${compras}` : 'Sin deudas con saldo: no hay cuotas que pagar.';
}

/** N3-03: explica en la propia línea el interés de un abono extra que se contó en "Pago de deudas" (no en el abono). */
function notaInteres(l) {
  if (!(l.interesAbono > 0)) return null;
  if (l.categoria.vinculo === 'cuotas-deudas') {
    const sin = l.asignado > 0 ? ` sin ellos, ${Math.round(((l.ejecutado - l.interesAbono) / l.asignado) * 100)} %` : '';
    return `Incluye ${pesos(l.interesAbono)} de intereses del abono extra (consumo, no ahorro):${sin || ' son parte de lo ejecutado'}.`;
  }
  return `No incluye ${pesos(l.interesAbono)} de intereses del abono: van en Pago de deudas (consumo, no ahorro).`;
}

function estadoLinea(l) {
  if (l.ejecutado === 0) return 'Pendiente';
  if (l.completo) return 'Completo';
  if (l.restante < 0) return `Excedido ${pesos(-l.restante)}`;
  return `Quedan ${pesos(l.restante)}`;
}

function dibujar(ctx, estado, redibujar) {
  const datos = ctx.tienda.datos();
  const hoy = ctx.reloj.hoy();
  const est = estadoCiclo(datos, hoy);
  const ultimo = ultimoCicloNavegable(datos, est.ciclo); // R1F-17: ignora claves de ciclo extremas
  const ciclo = estado.ciclo && estado.ciclo >= datos.ajustes.cicloInicial && estado.ciclo <= ultimo ? estado.ciclo : est.ciclo;
  const res = resumenCiclo(datos, ciclo, hoy);
  const historial = est.historial;
  ctx.shell.titulo('Presupuesto', `Ciclo ${nombreCiclo(ciclo, historial).toLowerCase()} · ${etiquetaRango(res.rango)}`);
  ctx.shell.fab(true);
  const nodos = [];

  // Navegación entre ciclos
  nodos.push(h('div', { class: 'split' },
    h('button', { class: 'icon-btn icon-btn--filled', type: 'button', aria: { label: 'Ciclo anterior' }, disabled: ciclo <= datos.ajustes.cicloInicial, on: { click: () => { estado.ciclo = cicloAnterior(ciclo); redibujar(); } } }, icono('chevron-left')),
    h('div', { style: { textAlign: 'center' } }, h('div', { class: 't-h' }, nombreCiclo(ciclo, historial)), h('div', { class: 't-caption' }, ciclo === est.ciclo ? (est.antesDeEmpezar ? 'Próximo ciclo' : 'Ciclo actual') : ciclo < est.ciclo ? 'Ciclo cerrado' : 'Ciclo planeado')),
    h('button', { class: 'icon-btn icon-btn--filled', type: 'button', aria: { label: 'Ciclo siguiente' }, disabled: ciclo >= ultimo, on: { click: () => { estado.ciclo = cicloSiguiente(ciclo); redibujar(); } } }, icono('chevron-right'))));

  if (!res.existe) {
    const anterior = cicloAnterior(ciclo);
    nodos.push(h('section', { class: 'card' }, estadoVacio({ icono: 'pie', titulo: 'Este ciclo no tiene presupuesto', texto: datos.presupuestos[anterior] ? 'Puedes crearlo copiando el del ciclo anterior.' : 'Créalo desde otro ciclo con "Copiar al ciclo siguiente".', accion: datos.presupuestos[anterior] && ciclo >= est.ciclo ? h('button', { class: 'btn', type: 'button', on: { click: () => { ejecutar(ctx, copiarPresupuesto, { desde: anterior, hacia: ciclo }, { exito: 'Presupuesto creado' }); } } }, icono('copy'), 'Copiar el ciclo anterior') : null })));
    return nodos;
  }

  const editarMonto = async (categoria, inicial) => {
    const v = await pedirMonto({ titulo: categoria.nombre, mensaje: `Presupuesto de ${nombreCiclo(ciclo, historial).toLowerCase()}. ${categoria.vinculo === 'cuotas-deudas' ? 'Se calcula desde las cuotas vigentes de tus deudas; si lo ajustas queda "fijado a mano" y puedes volver a "calculado".' : ''}`.trim(), inicial });
    if (v !== null) ejecutar(ctx, guardarAsignacion, { ciclo, categoriaId: categoria.id, monto: v }, { exito: `${categoria.nombre}: ${pesos(v)}` });
  };
  const editarIngreso = async () => {
    const v = await pedirMonto({ titulo: 'Ingreso del ciclo', mensaje: res.base.origen === 'real' ? 'Ingreso planeado (ya recibiste ingreso este ciclo: el "sin asignar" y los porcentajes usan lo recibido; el planeado se usa mientras no haya ingreso real).' : 'Ingreso planeado: sobre él se calculan el "sin asignar" y los porcentajes del presupuesto hasta que recibas el ingreso.', inicial: res.ingresoPlaneado });
    if (v !== null) ejecutar(ctx, guardarIngresoPlaneado, { ciclo, monto: v }, { exito: 'Ingreso planeado actualizado' });
  };
  const asignarSobrante = async () => {
    const cats = datos.categorias.filter((c) => c.tipo === 'gasto' && !c.archivada);
    const v = await abrirSelector({ titulo: `Asignar ${pesos(res.sinAsignar)} a…`, opciones: cats.map((c) => ({ valor: c.id, titulo: c.nombre, sub: GRUPOS_TITULO[c.grupo], icono: c.icono, fin: pesos(res.asignaciones[c.id] ?? 0) })) });
    if (v === undefined) return;
    const c = datos.categorias.find((x) => x.id === v);
    const nuevo = (res.asignaciones[v] ?? 0) + res.sinAsignar;
    ejecutar(ctx, guardarAsignacion, { ciclo, categoriaId: v, monto: nuevo }, { exito: `${c.nombre}: ${pesos(nuevo)}` });
  };

  if (res.sinSalario) {
    nodos.push(h('div', { class: 'callout callout--accent' }, icono('info'), h('div', null, h('span', { class: 'callout__title' }, `Ciclo de transición de ${res.rango.dias === 1 ? '1 día' : `${res.rango.dias} días`}`), h('br'), 'Por el cambio del día de pago no se espera salario en este ciclo (el siguiente llega con el ciclo que sigue). Su presupuesto es una copia del anterior: ajústalo a lo que vayas a gastar en estos días.')));
  }

  // Resumen: ingreso y asignado
  // N-08: el ingreso del ciclo es el real recibido cuando existe (como en Inicio); si no, el planeado.
  const ing = res.base.monto;
  const esReal = res.base.origen === 'real';
  const ancho = (x) => (ing > 0 ? Math.max(0, Math.min(100, (x / ing) * 100)).toFixed(2) : '0');
  const g = res.grupos;
  nodos.push(h('section', { class: 'card', aria: { labelledby: 'pr-t' } },
    h('div', { class: 'split' },
      h('button', { class: 'item__btn', type: 'button', style: { minHeight: '44px', textAlign: 'left' }, on: { click: editarIngreso }, aria: { label: `Editar ingreso del ciclo, ${esReal ? 'recibido' : 'planeado'} ${pesos(ing)}` } }, h('span', { class: 't-label', id: 'pr-t' }, 'Ingreso del ciclo ', icono('pencil', { tam: 'sm' })), h('div', { class: 't-title num', style: { fontSize: 'var(--fs-xl)' } }, pesos(ing)), esReal ? h('span', { class: 't-caption' }, `recibido · planeado ${pesos(res.ingresoPlaneado)}`) : datos.ajustes.ingreso.variable ? h('span', { class: 't-caption' }, 'aprox. (ingreso variable)') : null, res.ingresoOtros > 0 ? h('span', { class: 't-caption', style: { display: 'block' } }, `+ ${pesos(res.ingresoOtros)} de otros ingresos (suman al disponible, no a este ingreso)`) : null),
      h('div', { style: { textAlign: 'right' } }, h('span', { class: 't-label' }, 'Asignado'), h('div', { class: 't-h num' }, pesos(res.totalAsignado)))),
    h('div', { role: 'img', aria: { label: `Reparto: necesidades ${porcentaje(g.necesidades.asignadoPct)}, gustos ${porcentaje(g.gustos.asignadoPct)}, ahorro ${porcentaje(g.ahorro.asignadoPct)}, sin asignar ${ing > 0 ? porcentaje(res.sinAsignar / ing) : '—'}` }, style: { display: 'flex', gap: '2px', height: '14px', margin: 'var(--sp-3) 0 var(--sp-2)', borderRadius: '99px', overflow: 'hidden' } },
      ORDEN.map((k) => h('span', { style: { width: `${ancho(g[k].asignado)}%`, background: GRUPOS_COLOR[k] } })), h('span', { style: { flex: '1', background: 'var(--cat-free)' } })),
    h('div', { class: 'cluster t-caption' }, ORDEN.flatMap((k, i) => [i ? h('span', null, '·') : null, h('span', null, `${GRUPOS_TITULO[k]} ${porcentaje(g[k].asignadoPct)}`)]))));

  if (res.sinAsignar > 0) {
    nodos.push(h('div', { class: 'callout callout--accent' }, icono('info'), h('div', null, h('span', { class: 'callout__title' }, `Sin asignar ${pesos(res.sinAsignar)}`), h('br'), `Es el ${porcentaje(ing > 0 ? res.sinAsignar / ing : 0)} del ingreso. Puedes sumarlo a una categoría.`), h('button', { class: 'btn btn--secondary btn--sm callout__action', type: 'button', on: { click: asignarSobrante } }, 'Asignar')));
  } else if (res.sinAsignar < 0) {
    nodos.push(h('div', { class: 'callout callout--warn' }, icono('alert'), h('div', null, h('span', { class: 'callout__title' }, `Sobreasignado por ${pesos(-res.sinAsignar)}`), h('br'), `Lo presupuestado supera el ingreso ${esReal ? 'recibido' : 'planeado'}. Baja algún monto.`)));
  } else {
    nodos.push(h('div', { class: 'callout callout--ok' }, icono('check'), h('div', null, h('span', { class: 'callout__title' }, 'Todo el ingreso está asignado'))));
  }

  // Cómo se leen las alertas (INI-12 / F2): aviso al pasar el primer porcentaje, exceso al pasar el segundo, "Completo" si es exacto.
  const alertasCfg = datos.ajustes.alertas;
  nodos.push(h('p', { class: 't-caption' }, `Alertas: aviso al pasar el ${alertasCfg.avisoPct} % de lo asignado y exceso al pasar el ${alertasCfg.excesoPct} %. Si lo ejecutado es exactamente igual a lo asignado, la línea queda en "Completo" y no genera alerta.`));

  // Pagos recurrentes de gasto activos que cuentan en cada línea (se muestran aunque aún no caigan en este ciclo).
  const recurrentesPorCategoria = new Map();
  for (const r of datos.recurrentes) {
    if (!r.activo || r.tipo !== 'gasto') continue;
    if (!recurrentesPorCategoria.has(r.categoriaId)) recurrentesPorCategoria.set(r.categoriaId, []);
    recurrentesPorCategoria.get(r.categoriaId).push(`${r.nombre} ${pesos(r.monto)} ${r.frecuencia.tipo === 'mensual' ? 'al mes' : 'por semana'}`);
  }

  // Grupos
  const pd = res.pagoDeudas;
  for (const k of ORDEN) {
    const lineas = res.lineas.filter((l) => l.categoria.grupo === k);
    const gr = g[k];
    const sobreMeta = gr.asignadoPct !== null && gr.asignadoPct * 100 > gr.meta + 0.05 && k !== 'ahorro';
    nodos.push(h('section', { class: 'card budget-group', aria: { labelledby: `g-${k}` } },
      h('div', { class: 'budget-group__head' },
        h('div', { class: 'budget-group__title', id: `g-${k}` }, h('span', { class: 'dot-cat', style: { '--sw': GRUPOS_COLOR[k] } }), GRUPOS_TITULO[k]),
        h('span', { class: `badge${sobreMeta ? ' badge--warn' : ''}` }, `${porcentaje(gr.asignadoPct)} · meta ${gr.meta} %`)),
      h('div', { class: 'grid-3', style: { marginBottom: 'var(--sp-2)' } },
        h('div', { class: 'fact' }, h('span', { class: 'fact__l' }, 'Presupuestado'), h('span', { class: 'fact__v' }, pesos(gr.asignado))),
        h('div', { class: 'fact' }, h('span', { class: 'fact__l' }, k === 'ahorro' ? 'Aportado' : 'Gastado'), h('span', { class: 'fact__v' }, pesos(gr.ejecutado))),
        h('div', { class: 'fact' }, h('span', { class: 'fact__l' }, 'Restante'), h('span', { class: 'fact__v' }, pesos(gr.restante)))),
      k === 'ahorro' && res.interesAbono > 0 ? h('p', { class: 't-caption', style: { marginBottom: 'var(--sp-2)' } }, `Aportado = aportes a metas + capital del abono extra. Los ${pesos(res.interesAbono)} de intereses del abono cuentan como consumo (en Pago de deudas), no como ahorro.`) : null,
      k === 'ahorro' && gr.consumoPropias > 0 ? h('p', { class: 't-caption', style: { marginBottom: 'var(--sp-2)' } }, `Además gastaste ${pesos(gr.consumoPropias)} en categorías de ahorro propias: cuenta como gasto (baja la tasa de ahorro) y no como ahorro aportado. Su barra muestra lo gastado de lo que le asignaste.`) : null,
      lineas.map((l) => {
        const c = l.categoria;
        const pctTexto = l.fraccion === Infinity ? '—' : `${Math.round(l.fraccion * 100)} %`;
        const esDeudas = c.vinculo === 'cuotas-deudas' && pd;
        const linea = h('button', { class: 'budget-line budget-line--btn', type: 'button', on: { click: () => editarMonto(c, l.asignado) }, aria: { label: `Editar presupuesto de ${c.nombre}: ${pesos(l.asignado)}` } },
          h('div', { class: 'budget-line__row' }, h('span', { class: 'budget-line__name' }, c.nombre, esDeudas ? [' ', h('span', { class: `badge ${pd.fijo ? 'badge--warn' : 'badge--info'}` }, pd.fijo ? 'fijado a mano' : 'calculado')] : null, c.archivada ? [' ', h('span', { class: 'badge' }, 'archivada')] : null), h('span', { class: 'budget-line__amt' }, h('b', null, pesos(l.ejecutado)), ` / ${pesos(l.asignado)}`)),
          esDeudas ? h('div', { class: 't-caption' }, textoPagoDeudas(pd, pesos)) : null,
          c.id === 'cat-transporte' ? h('div', { class: 't-caption' }, 'Incluye gasolina: gasto manual, cuando toque') : null,
          c.vinculo === 'abono-deudas' ? h('div', { class: 't-caption' }, 'Pagos extra a capital de tus deudas') : null,
          recurrentesPorCategoria.has(c.id) ? h('div', { class: 't-caption' }, `Recurrentes en esta línea: ${recurrentesPorCategoria.get(c.id).join(' · ')}`) : null,
          notaInteres(l) ? h('div', { class: 't-caption' }, notaInteres(l)) : null,
          barra({ fraccion: l.fraccion === Infinity ? 1 : l.fraccion, clase: claseBarra(l), etiqueta: c.nombre }),
          h('div', { class: 'progress-label' }, h('span', null, pctTexto), h('span', null, estadoLinea(l))));
        // "Volver a calculado": botón aparte (no puede ir dentro del botón de la línea).
        // R2F-15: en un ciclo cerrado no se ofrece "Volver a calculado" (usaría las cuotas de hoy, no las de ese ciclo).
        return esDeudas && pd.fijo && res.rango.fin >= hoy
          ? [linea, h('button', { class: 'btn btn--secondary btn--sm', type: 'button', style: { margin: '0 0 var(--sp-2)' }, on: { click: () => ejecutar(ctx, restablecerPagoDeudas, { ciclo }, { exito: `Pago de deudas: calculado (${pesos(pd.calculado)})` }) } }, icono('restore'), `Volver a calculado (${pesos(pd.calculado)})`)]
          : linea;
      })));
  }

  // Comparación con el ciclo anterior
  const anterior = ciclo > datos.ajustes.cicloInicial ? cicloAnterior(ciclo) : null;
  const cmp = compararConAnterior(datos, ciclo, anterior, hoy);
  nodos.push(h('section', { class: 'card', aria: { labelledby: 'cmp-t' } },
    h('h2', { class: 't-h', id: 'cmp-t', style: { marginBottom: 'var(--sp-2)' } }, 'Comparar ciclos'),
    cmp && cmp.filas.length
      ? [
        h('p', { class: 't-small muted', style: { marginBottom: 'var(--sp-2)' } }, `Ejecutado en ${nombreCiclo(ciclo, historial).toLowerCase()} frente a ${nombreCiclo(cmp.anterior, historial).toLowerCase()}.`),
        h('div', { class: 'list' }, cmp.filas.map((f) => h('div', { class: 'item' },
          h('span', { class: 'item__icon' }, icono(f.categoria.icono)),
          h('div', { class: 'item__main' }, h('div', { class: 'item__title' }, f.categoria.nombre), h('div', { class: 'item__sub num' }, `${pesos(f.previo)} → ${pesos(f.actual)}`)),
          h('div', { class: `item__end money ${f.delta > 0 ? 'danger' : f.delta < 0 ? 'ok' : ''}` }, f.delta === 0 ? '=' : `${f.delta > 0 ? '+' : '−'}${pesos(Math.abs(f.delta))}`)))),
        h('div', { class: 'split', style: { marginTop: 'var(--sp-2)' } }, h('span', { class: 't-small muted' }, 'Total'), h('span', { class: 'money' }, `${pesos(cmp.totalPrevio)} → ${pesos(cmp.totalActual)}`)),
      ]
      : estadoVacio({ icono: 'bars', titulo: 'Aún no hay un ciclo anterior', texto: ciclo === datos.ajustes.cicloInicial ? `La comparación aparece desde el ciclo de ${nombreCiclo(cicloSiguiente(ciclo), historial).toLowerCase()}.` : 'No hay movimientos para comparar.' })));

  // Copiar al siguiente
  const siguiente = cicloSiguiente(ciclo);
  // R3F-05: un ciclo cerrado no se reescribe: no se ofrece copiar sobre uno que ya cerró (la acción también lo rechaza).
  if (siguiente < est.ciclo) {
    nodos.push(h('p', { class: 't-caption' }, `${nombreCiclo(siguiente, historial)} ya está cerrado y conserva lo que mostraba: no se le puede copiar un presupuesto.`));
    return nodos;
  }
  nodos.push(h('button', { class: 'btn btn--secondary btn--block', type: 'button', on: { click: async () => {
    const d = ctx.tienda.datos();
    if (d.presupuestos[siguiente]) {
      const ok = await confirmar({ titulo: `¿Reemplazar ${nombreCiclo(siguiente, historial).toLowerCase()}?`, mensaje: 'Ese ciclo ya tiene presupuesto. Se reemplazará con una copia de este (Pago de deudas se recalcula).', confirmar: 'Reemplazar', peligro: true });
      if (!ok) return;
    }
    const r = ejecutar(ctx, copiarPresupuesto, { desde: ciclo, hacia: siguiente });
    if (r.ok) mostrarAviso(`Presupuesto copiado al ciclo de ${nombreCiclo(siguiente, historial).toLowerCase()}`, { tipo: 'ok' });
  } } }, icono('copy'), 'Copiar al ciclo siguiente'));
  return nodos;
}
