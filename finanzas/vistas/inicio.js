/*
 * inicio.js — disponible del ciclo, días al pago, dona 50/30/20 real vs. meta, alertas, próximos pagos y resumen.
 * Cifras: ESQUEMA-FINANZAS §8.1 (disponible = ingreso − ejecutado, V3) y §10.1 (próximos pagos: "Pagado" / "Recibido" crean el movimiento).
 */
import { h, icono, crearVista, pesos, porcentaje, diaMes, nombreCiclo, barra, estadoVacio, ejecutar, GRUPOS_TITULO, GRUPOS_COLOR, cantidad, haptic, mostrarAviso, boton } from './comun.js';
import { dona } from '../../shared/ui/graficos.js';
import { abrirFormulario } from './agregar.js';
import { estadoCiclo, etiquetaRango } from '../logica/periodo.js';
import { resumenCiclo, alertasDelCiclo } from '../logica/presupuesto.js';
import { proximosPagos, resumenCicloSiguiente } from '../logica/recurrentes.js';
import { marcarPagado, borrarMovimiento } from '../logica/acciones.js';
import { debeMostrarBienvenida, TEXTOS_BIENVENIDA } from '../logica/bienvenida.js';

const MAX_VISIBLES = 5;

export function montar(raiz, ctx) {
  let verTodos = false;
  const vista = crearVista(raiz, () => dibujar(ctx, { verTodos, alternar: () => { verTodos = !verTodos; vista.actualizar(); }, redibujar: () => vista.actualizar() }));
  return vista;
}

/**
 * T5.8: tarjeta de bienvenida mientras los datos sean los de ejemplo de la semilla genérica (logica/bienvenida.js). Desaparece sola al importar
 * los datos reales o al editar cualquier cosa; "Entendido" la oculta de forma persistente en las preferencias de este celular.
 */
function tarjetaBienvenida(ctx, datos, vistaEstado) {
  const prefs = ctx.preferencias?.leer?.() ?? {};
  if (!debeMostrarBienvenida(datos, prefs)) return null;
  const T = TEXTOS_BIENVENIDA;
  return h('section', { class: 'callout callout--accent', id: 'bienvenida', aria: { labelledby: 'bienvenida-t' } },
    icono('info'),
    h('div', { class: 'stack stack--sm' },
      h('span', { class: 'callout__title', id: 'bienvenida-t' }, T.titulo),
      h('p', null, T.cuerpo),
      h('p', { class: 't-caption' }, T.iphone),
      h('div', { style: { display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' } },
        boton(T.irAjustes, { icono: 'sliders', clase: 'btn--sm', onClick: () => ctx.navegar('ajustes') }),
        boton(T.entendido, { clase: 'btn--sm btn--ghost', onClick: () => { ctx.preferencias.guardar({ bienvenidaOculta: true }); vistaEstado.redibujar(); } }))));
}

/** Marca un pago: directo si el monto es fijo; con hoja si tiene rango (Servicios) o se quiere editar. */
function marcar(ctx, pago, { editar = false } = {}) {
  const origen = { tipo: pago.tipo, id: pago.id, ocurrencia: pago.ocurrencia };
  // Ingreso variable (R1F-11): el salario nunca se registra de un toque con el monto planeado; se abre la hoja para confirmar lo recibido.
  const salarioVariable = pago.tipo === 'salario' && ctx.tienda.datos().ajustes.ingreso.variable;
  if (editar || pago.rango || salarioVariable) {
    const preset = pago.tipo === 'cuota'
      ? { tipo: 'pagoDeuda', monto: pago.monto, interes: pago.interes, interesManual: true, deudaId: pago.deudaId, cuentaId: pago.cuentaId, modo: 'cuota' }
      : { tipo: pago.esIngreso ? 'ingreso' : 'gasto', monto: pago.monto, categoriaId: pago.categoriaId, cuentaId: pago.cuentaId };
    abrirFormulario(ctx, { tipo: preset.tipo, preset, origen, titulo: pago.esIngreso ? `Recibir ${pago.nombre}` : `Pagar ${pago.nombre}` });
    return;
  }
  const r = ejecutar(ctx, marcarPagado, { origen });
  if (r.ok) {
    haptic('success');
    const creado = ctx.tienda.datos().movimientos.find((m) => m.origen && m.origen.tipo === origen.tipo && m.origen.id === origen.id && m.origen.ocurrencia === origen.ocurrencia);
    mostrarAviso(pago.esIngreso ? 'Ingreso registrado' : 'Pago registrado', { tipo: 'ok', accion: creado ? { etiqueta: 'Deshacer', alPulsar: () => ejecutar(ctx, borrarMovimiento, { id: creado.id }, { exito: 'Pago desmarcado' }) } : undefined });
  }
}

function dibujar(ctx, vistaEstado) {
  const datos = ctx.tienda.datos();
  const hoy = ctx.reloj.hoy();
  const est = estadoCiclo(datos, hoy);
  const res = resumenCiclo(datos, est.ciclo, hoy);
  const variable = datos.ajustes.ingreso.variable; // R1F-11: con ingreso variable las cifras planeadas dicen "aprox."
  const pagos = proximosPagos(datos, hoy, est.ciclo);
  const catPorId = new Map(datos.categorias.map((c) => [c.id, c]));
  ctx.shell.titulo('Inicio', `Ciclo ${nombreCiclo(est.ciclo, est.historial).toLowerCase()} · ${etiquetaRango(est.rango)}`);
  ctx.shell.fab(true);

  const nodos = [];

  nodos.push(tarjetaBienvenida(ctx, datos, vistaEstado));

  if (est.antesDeEmpezar) {
    nodos.push(h('div', { class: 'callout callout--accent' }, icono('calendar'), h('div', null, h('span', { class: 'callout__title' }, `El primer ciclo empieza el ${diaMes(est.rango.inicio)}`), h('br'), `Faltan ${cantidad(est.diasAlPago, 'día', 'días')}. Puedes registrar movimientos desde esa fecha; los saldos iniciales son del ${diaMes(est.rango.inicio)}.`)));
  }

  // R2F-04: ciclo de transición tras cambiar el día de pago: sin salario esperado; se explica en vez de mostrar cifras que confunden.
  if (res.sinSalario) {
    nodos.push(h('div', { class: 'callout callout--accent' }, icono('info'), h('div', null, h('span', { class: 'callout__title' }, `Ciclo de transición de ${cantidad(est.rango.dias, 'día', 'días')}`), h('br'), `Por el cambio del día de pago, este ciclo no tiene salario esperado: el siguiente llega el ${diaMes(est.proximoPago)}. Su presupuesto es una copia del anterior: ajústalo a lo que vayas a gastar en estos días. Si de todos modos recibes un ingreso, regístralo con el botón +.`)));
  }

  // --- Hero ---
  const diasParaPorDia = est.antesDeEmpezar ? est.rango.dias : est.diasAlPago;
  // N-07: un ciclo de transición sin salario (res.sinSalario) tiene el presupuesto de un mes en pocos días: "≈ $ X por día" engañaría.
  const porDia = res.disponible > 0 && !res.sinSalario ? Math.round(res.disponible / Math.max(1, diasParaPorDia)) : null;
  // N3-08: en un ciclo de transición (sin salario esperado) el primer día no es "día de pago": se dice que es de transición.
  const badge = est.antesDeEmpezar
    ? `Empieza en ${cantidad(est.diasAlPago, 'día', 'días')} · ${diaMes(est.rango.inicio)}`
    : hoy === est.rango.inicio ? (res.sinSalario ? `Ciclo de transición · siguiente pago ${diaMes(est.proximoPago)}` : `Hoy es día de pago · siguiente ${diaMes(est.proximoPago)}`) : `${cantidad(est.diasAlPago, 'día', 'días')} para el pago · ${diaMes(est.proximoPago)}`;
  const avance = est.antesDeEmpezar ? 0 : est.diaDelCiclo / est.rango.dias;
  nodos.push(h('section', { class: 'card card--hero hero', aria: { labelledby: 'disp-t' } },
    h('span', { class: 't-label', id: 'disp-t' }, 'Disponible del ciclo'),
    h('div', { class: `hero__amount num${res.disponible < 0 ? ' danger' : ''}` }, pesos(res.disponible)),
    h('div', { class: 'hero__row' },
      h('span', { class: 'badge badge--accent' }, icono('calendar'), badge),
      porDia !== null ? h('span', { class: 't-small muted' }, '≈ ', h('b', { class: 'num' }, pesos(porDia)), ' por día') : null),
    h('div', { style: { marginTop: 'var(--sp-2)' } },
      barra({ fraccion: avance, etiqueta: 'Avance del ciclo' }),
      h('div', { class: 'progress-label', style: { marginTop: '6px' } },
        h('span', null, est.antesDeEmpezar ? 'Aún no empieza' : `Día ${est.diaDelCiclo} de ${est.rango.dias}`),
        h('span', null, est.antesDeEmpezar ? `Empieza el ${diaMes(est.rango.inicio)}` : `Faltan ${cantidad(est.diasAlPago, 'día', 'días')}`))),
    h('p', { class: 'hero__calc' }, `${res.base.origen === 'real' ? 'Ingreso' : res.sinSalario ? 'Presupuesto del ciclo (copia del anterior)' : 'Ingreso planeado'} ${res.base.origen !== 'real' && !res.sinSalario && variable ? 'aprox. ' : ''}${pesos(res.base.monto)}${res.ingresoOtros > 0 ? ` + otros ingresos ${pesos(res.ingresoOtros)}` : ''} − ejecutado ${pesos(res.totalEjecutado)} (incluye cuotas y aportes de ahorro)`)));

  // --- Alertas ---
  const alertas = [];
  // H-09: solo una cuota de deuda con fecha pasada es "vencida" (alerta roja). El salario por recibir y los recurrentes sin marcar
  // son pendientes de tono neutro y se resumen en una sola línea ("N pendientes"); el detalle está en Próximos pagos ("Ver todos").
  const irAProximos = () => { const t = document.getElementById('proximos'); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const vencidos = pagos.filter((p) => p.estado === 'vencida');
  if (vencidos.length) {
    const uno = vencidos.length === 1 ? vencidos[0] : null;
    alertas.push(h('button', { class: 'alert alert--danger', type: 'button', on: { click: irAProximos } },
      h('span', { class: 'alert__icon' }, icono('alert')),
      h('div', { class: 'alert__txt' }, h('b', null, uno ? `${uno.nombre}: pago vencido` : `${vencidos.length} cuotas vencidas`), uno ? `Programado el ${diaMes(uno.ocurrencia)}` : 'Márcalas como pagadas o revisa las fechas'),
      icono('chevron-right')));
  }
  const pendientes = pagos.filter((p) => p.estado === 'pendiente' || p.estado === 'por-recibir');
  if (pendientes.length) {
    const uno = pendientes.length === 1 ? pendientes[0] : null;
    const hayPorRecibir = pendientes.some((p) => p.estado === 'por-recibir');
    alertas.push(h('button', { class: 'alert alert--info', type: 'button', on: { click: irAProximos } },
      h('span', { class: 'alert__icon' }, icono('info')),
      h('div', { class: 'alert__txt' }, h('b', null, uno ? `${uno.nombre}: ${uno.estado === 'por-recibir' ? 'por recibir' : 'pendiente de marcar'}` : `${pendientes.length} pendientes de marcar`), uno ? `Programado el ${diaMes(uno.ocurrencia)}` : `${hayPorRecibir ? 'Incluye el salario por recibir. ' : ''}Márcalos cuando los pagues`),
      icono('chevron-right')));
  }
  const alertasCat = alertasDelCiclo(res);
  for (const l of alertasCat.slice(0, 3)) {
    const exceso = l.alerta === 'exceso';
    const pct = l.fraccion === Infinity ? null : Math.round(l.fraccion * 100);
    // N3-03: la explicación del interés del abono va en la propia alerta (antes solo estaba en la leyenda de la dona y en Presupuesto).
    const nota = l.interesAbono > 0
      ? (l.categoria.vinculo === 'cuotas-deudas' ? `incluye ${pesos(l.interesAbono)} de intereses del abono extra` : `sin contar ${pesos(l.interesAbono)} de intereses del abono, que van en Pago de deudas`)
      : '';
    alertas.push(h('a', { class: `alert alert--${exceso ? 'danger' : 'warn'}`, href: '#/presupuesto' },
      h('span', { class: 'alert__icon' }, icono(l.categoria.icono)),
      h('div', { class: 'alert__txt' },
        h('b', null, exceso ? (pct === null ? `${l.categoria.nombre}: sin presupuesto asignado` : `${l.categoria.nombre} excedida (${pct} %)`) : `${l.categoria.nombre} al ${pct} %`),
        exceso ? `Gastaste ${pesos(l.ejecutado)}${l.asignado ? ` de ${pesos(l.asignado)}` : ''}${nota ? ` (${nota})` : ''}` : `Quedan ${pesos(l.restante)} de ${pesos(l.asignado)}${nota ? ` (${nota})` : ''}`),
      icono('chevron-right')));
  }
  if (alertasCat.length > 3) alertas.push(h('a', { class: 'alert alert--warn', href: '#/presupuesto' }, h('span', { class: 'alert__icon' }, icono('more')), h('div', { class: 'alert__txt' }, h('b', null, `${alertasCat.length - 3} categorías más en alerta`), 'Míralas en el presupuesto'), icono('chevron-right')));
  if (res.sinAsignar > 0) {
    alertas.push(h('a', { class: 'alert alert--info', href: '#/presupuesto' }, h('span', { class: 'alert__icon' }, icono('info')), h('div', { class: 'alert__txt' }, h('b', null, `Sin asignar ${pesos(res.sinAsignar)}`), 'Asígnalos en el presupuesto del ciclo'), icono('chevron-right')));
  } else if (res.sinAsignar < 0) {
    alertas.push(h('a', { class: 'alert alert--warn', href: '#/presupuesto' }, h('span', { class: 'alert__icon' }, icono('alert')), h('div', { class: 'alert__txt' }, h('b', null, `Presupuesto sobreasignado por ${pesos(-res.sinAsignar)}`), 'Reasigna montos en el presupuesto'), icono('chevron-right')));
  }
  if (alertas.length) nodos.push(h('section', { class: 'stack stack--sm', aria: { label: 'Alertas' } }, alertas));

  // --- Dona 50/30/20 ---
  const base = res.base.monto;
  const g = res.grupos;
  const sinEjecutar = Math.max(0, base - res.totalEjecutado);
  const frac = (v) => (base > 0 ? v / base : 0);
  const filasLeyenda = ['necesidades', 'gustos', 'ahorro'].map((k) => h('div', { class: 'legend__row', role: 'listitem', style: { '--sw': GRUPOS_COLOR[k] } },
    h('span', { class: 'legend__swatch' }),
    h('span', { class: 'legend__name' }, GRUPOS_TITULO[k], h('span', { class: 'legend__meta' }, `meta ${g[k].meta} % · plan ${porcentaje(g[k].asignadoPct)}`)),
    h('span', { class: 'legend__pct' }, porcentaje(g[k].ejecutadoPct))));
  filasLeyenda.push(h('div', { class: 'legend__row', role: 'listitem', style: { '--sw': 'var(--cat-free)' } }, h('span', { class: 'legend__swatch' }), h('span', { class: 'legend__name' }, 'Sin ejecutar', h('span', { class: 'legend__meta' }, 'del ingreso del ciclo')), h('span', { class: 'legend__pct' }, base > 0 ? porcentaje(frac(sinEjecutar)) : '—')));
  const etiquetaDona = `Real sobre el ingreso: necesidades ${porcentaje(g.necesidades.ejecutadoPct)}, gustos ${porcentaje(g.gustos.ejecutadoPct)}, ahorro ${porcentaje(g.ahorro.ejecutadoPct)}, sin ejecutar ${base > 0 ? porcentaje(frac(sinEjecutar)) : '—'}. Meta: ${g.necesidades.meta} %, ${g.gustos.meta} %, ${g.ahorro.meta} %.`;
  const valores = (k) => Math.max(g[k].ejecutado, 0);
  nodos.push(h('section', { class: 'card', aria: { labelledby: 'dona-t' } },
    h('div', { class: 'card__head' }, h('div', null, h('span', { class: 't-label' }, `Regla ${datos.ajustes.metaGrupos.necesidades}/${datos.ajustes.metaGrupos.gustos}/${datos.ajustes.metaGrupos.ahorro}`), h('h2', { class: 't-h', id: 'dona-t' }, 'Ejecutado real vs. meta'))),
    h('div', { class: 'split-card' },
      dona({
        tam: 184, hueco: 3, etiqueta: etiquetaDona,
        centro: h('span', null, h('span', { class: 'ring__value num', style: { fontSize: 'var(--fs-sm)', display: 'block' } }, pesos(res.totalEjecutado)), h('span', { class: 'ring__label' }, 'ejecutado')),
        anillos: [
          { trazo: 22, segmentos: [{ valor: valores('necesidades'), color: GRUPOS_COLOR.necesidades, etiqueta: `Necesidades real ${porcentaje(g.necesidades.ejecutadoPct)}` }, { valor: valores('gustos'), color: GRUPOS_COLOR.gustos, etiqueta: `Gustos real ${porcentaje(g.gustos.ejecutadoPct)}` }, { valor: valores('ahorro'), color: GRUPOS_COLOR.ahorro, etiqueta: `Ahorro real ${porcentaje(g.ahorro.ejecutadoPct)}` }, { valor: Math.max(sinEjecutar, res.totalEjecutado === 0 ? 1 : 0), color: 'var(--cat-free)', etiqueta: 'Sin ejecutar' }] },
          { trazo: 9, segmentos: ['necesidades', 'gustos', 'ahorro'].map((k) => ({ valor: g[k].meta, color: GRUPOS_COLOR[k], etiqueta: `${GRUPOS_TITULO[k]} meta ${g[k].meta} %` })) },
        ],
      }),
      h('div', { class: 'legend', role: 'list' }, filasLeyenda)),
    h('p', { class: 't-caption', style: { marginTop: 'var(--sp-3)' } }, `Anillo exterior: lo ejecutado sobre el ingreso (${pesos(base)}). Anillo interior: meta ${datos.ajustes.metaGrupos.necesidades}/${datos.ajustes.metaGrupos.gustos}/${datos.ajustes.metaGrupos.ahorro}.${res.interesAbono > 0 ? ` Ahorro y metas ejecutado = aportes a metas + capital del abono extra: los ${pesos(res.interesAbono)} de intereses del abono cuentan como consumo (en Pago de deudas), no como ahorro.` : ''}`)));

  // --- Próximos pagos ---
  const visibles = vistaEstado.verTodos ? pagos : pagos.slice(0, MAX_VISIBLES);
  const iconoPago = (p) => (p.tipo === 'salario' ? 'ingreso' : p.tipo === 'cuota' ? 'deuda' : catPorId.get(p.categoriaId)?.icono ?? 'calendar');
  const filaPago = (p) => h('div', { class: 'item' },
    h('span', { class: 'item__icon' }, icono(iconoPago(p))),
    h('button', { class: 'item__main item__btn', type: 'button', on: { click: () => marcar(ctx, p, { editar: true }) }, aria: { label: `Editar ${p.nombre}` } },
      h('span', { class: 'item__title', style: { display: 'block' } }, p.nombre, p.estado === 'vencida' ? [' ', h('span', { class: 'badge badge--danger' }, 'Vencido')] : p.estado === 'por-recibir' ? [' ', h('span', { class: 'badge badge--ok' }, 'Por recibir')] : p.estado === 'pendiente' ? [' ', h('span', { class: 'badge' }, 'Pendiente')] : null, p.esIngreso && p.estado !== 'por-recibir' ? [' ', h('span', { class: 'badge badge--ok' }, 'Ingreso')] : null),
      h('span', { class: 'item__sub', style: { display: 'block' } }, `Programado ${diaMes(p.ocurrencia)} · ${p.tipo === 'salario' && variable ? 'aprox. ' : ''}`, h('span', { class: 'num' }, pesos(p.monto)), p.rango ? ` · rango ${pesos(p.rango.min)}–${pesos(p.rango.max)}` : '')),
    h('button', { class: 'btn btn--sm btn--secondary', type: 'button', on: { click: () => marcar(ctx, p) }, aria: { label: `${p.esIngreso ? 'Marcar recibido' : 'Marcar pagado'}: ${p.nombre}` } }, icono('check'), p.esIngreso ? 'Recibido' : 'Pagado'));
  const siguiente = resumenCicloSiguiente(datos, hoy);
  nodos.push(h('section', { class: 'card', id: 'proximos', aria: { labelledby: 'prox-t' } },
    h('div', { class: 'card__head' }, h('h2', { class: 't-h', id: 'prox-t' }, 'Próximos pagos'), pagos.length ? h('span', { class: 'badge' }, String(pagos.length)) : null),
    pagos.length
      ? h('div', { class: 'list' }, visibles.map(filaPago))
      : estadoVacio({ icono: 'check', titulo: 'Todo al día en este ciclo', texto: 'No quedan pagos programados pendientes.' }),
    pagos.length > MAX_VISIBLES ? h('button', { class: 'btn btn--ghost btn--block', type: 'button', on: { click: vistaEstado.alternar } }, vistaEstado.verTodos ? 'Ver menos' : `Ver los ${pagos.length - MAX_VISIBLES} restantes`) : null,
    siguiente ? h('div', { class: 'item', style: { borderTop: '1px solid var(--line)', marginTop: 'var(--sp-2)' } }, h('span', { class: 'item__icon' }, icono('calendar')), h('div', { class: 'item__main' }, h('div', { class: 'item__title' }, `${diaMes(siguiente.fecha)} · ${cantidad(siguiente.cantidad, 'pago programado', 'pagos programados')}`), h('div', { class: 'item__sub' }, 'Cuotas de deuda y recurrentes del próximo ciclo')), h('div', { class: 'item__end money' }, pesos(siguiente.total))) : null));

  // --- Resumen ---
  nodos.push(h('section', { class: 'grid-3', aria: { label: 'Resumen del ciclo' } },
    h('div', { class: 'card card--tight' }, h('div', { class: 'kpi' }, h('span', { class: 'kpi__v num ok' }, pesos(res.ingresoReal)), h('span', { class: 'kpi__l' }, 'Ingresos'))),
    h('div', { class: 'card card--tight' }, h('div', { class: 'kpi' }, h('span', { class: 'kpi__v num' }, pesos(g.necesidades.ejecutado + g.gustos.ejecutado)), h('span', { class: 'kpi__l' }, 'Gastado'))),
    h('div', { class: 'card card--tight' }, h('div', { class: 'kpi' }, h('span', { class: 'kpi__v num' }, pesos(g.ahorro.ejecutado)), h('span', { class: 'kpi__l' }, 'Ahorrado')))));
  return nodos;
}
