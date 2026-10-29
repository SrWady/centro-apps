/*
 * reportes.js — gasto por categoría, tendencia de 6 ciclos, tasa de ahorro (P6: junto a "ahorro y metas ejecutado") y patrimonio.
 * Definiciones: logica/reportes.js. "Herramienta personal de seguimiento; no constituye asesoría financiera."
 */
import { h, crearVista, pesos, porcentaje, nombreCiclo, estadoVacio, segmentado, cantidad } from './comun.js';
import { barras, anillo } from '../../shared/ui/graficos.js';
import { formatearPesosCorto } from '../../shared/lib/dinero.js';
import { formatearFecha } from '../../shared/lib/fechas.js';
import { estadoCiclo, etiquetaRango } from '../logica/periodo.js';
import { ciclosRecientes, gastoPorCategoria, tasaDeAhorro, tendencia, patrimonioHoy } from '../logica/reportes.js';

export function montar(raiz, ctx) {
  const estado = { n: 1 };
  const vista = crearVista(raiz, () => dibujar(ctx, estado, () => vista.actualizar()));
  return vista;
}

function dibujar(ctx, estado, redibujar) {
  const datos = ctx.tienda.datos();
  const hoy = ctx.reloj.hoy();
  const est = estadoCiclo(datos, hoy);
  ctx.shell.titulo('Reportes', `Ciclo ${nombreCiclo(est.ciclo, est.historial).toLowerCase()} · ${etiquetaRango(est.rango)}`);
  ctx.shell.fab(false);
  const ciclos = ciclosRecientes(datos, hoy, estado.n);
  const gasto = gastoPorCategoria(datos, ciclos, hoy);
  const filas = tendencia(datos, hoy, 6);
  const ahorro = tasaDeAhorro(datos, est.ciclo, hoy);
  const pat = patrimonioHoy(datos, hoy);
  const nodos = [];

  nodos.push(segmentado({ etiqueta: 'Periodo', valor: estado.n, opciones: [{ valor: 1, titulo: 'Este ciclo' }, { valor: 3, titulo: '3 ciclos' }, { valor: 6, titulo: '6 ciclos' }], alCambiar: (v) => { estado.n = v; redibujar(); } }));

  // Gasto por categoría
  nodos.push(h('section', { class: 'card', aria: { labelledby: 'rc-t' } },
    h('div', { class: 'card__head' },
      h('div', null, h('span', { class: 't-label' }, 'Gasto por categoría'), h('h2', { class: 't-h num', id: 'rc-t' }, pesos(gasto.total))),
      h('span', { class: 'badge' }, ciclos.length === 1 ? nombreCiclo(ciclos[0], est.historial).toLowerCase() : `últimos ${ciclos.length} ciclos`)),
    gasto.filas.length
      ? gasto.filas.map((f) => h('div', { class: 'cat-bar' },
        h('div', { class: 'budget-line__row' }, h('span', { class: 'budget-line__name' }, f.categoria.nombre), h('span', { class: 'budget-line__amt' }, h('b', null, pesos(f.monto)), ` · ${porcentaje(f.fraccion)}`)),
        h('div', { class: 'bar', role: 'img', aria: { label: `${f.categoria.nombre} ${porcentaje(f.fraccion)}` } }, h('div', { class: 'bar__fill', style: { '--p': `${(f.fraccion * 100).toFixed(1)}%` } }))))
      : estadoVacio({ icono: 'bars', titulo: 'Sin gastos todavía', texto: 'Cuando registres gastos verás aquí en qué se va el dinero.' }),
    h('p', { class: 't-caption', style: { marginTop: 'var(--sp-2)' } }, 'Incluye necesidades y gustos (también el pago de deudas). El ahorro y las metas se reportan aparte.')));

  // Tendencia
  const maxV = Math.max(1, ...filas.map((f) => f.gastado));
  const etiquetaMes = (c) => formatearFecha(`${c}-01`, 'mes-anio').split(' ')[0].slice(0, 3);
  nodos.push(h('section', { class: 'card', aria: { labelledby: 'tn-t' } },
    h('div', { class: 'card__head' }, h('div', null, h('span', { class: 't-label' }, 'Tendencia de gasto'), h('h2', { class: 't-h', id: 'tn-t' }, `Últimos ${filas.length} ${filas.length === 1 ? 'ciclo' : 'ciclos'}`))),
    h('div', { style: { maxWidth: `${Math.max(filas.length, 3) * 64}px` } }, barras({
      alto: 176, max: maxV * 1.15, color: 'var(--series-muted)', etiquetaAccesible: `Gasto por ciclo: ${filas.map((f) => `${etiquetaMes(f.ciclo)} ${pesos(f.gastado)}`).join(', ')}`,
      datos: filas.map((f, i) => ({ etiqueta: `${etiquetaMes(f.ciclo)}${f.transicion ? '†' : ''}${i === filas.length - 1 ? '*' : ''}`, valor: f.gastado, resaltar: i === filas.length - 1, etiquetaValor: f.gastado > 0 ? formatearPesosCorto(f.gastado) : '' })),
    })),
    h('p', { class: 't-caption', style: { marginTop: 'var(--sp-2)' } }, filas.length === 1 ? '*Ciclo en curso. La tendencia se arma a medida que pasan los ciclos: hoy solo existe el ciclo inicial.' : '*Ciclo en curso (necesidades + gustos ejecutados).'),
    filas.some((f) => f.transicion) ? h('p', { class: 't-caption', style: { marginTop: 'var(--sp-1)' } }, '† Ciclo de transición (cambio del día de pago, de pocos días o sin salario esperado): no es comparable con los demás y no se muestra su tasa de ahorro.') : null,
    filas.length > 1 ? h('div', { class: 'list', style: { marginTop: 'var(--sp-2)' } }, [...filas].reverse().map((f) => h('div', { class: 'item', style: { minHeight: '48px' } },
      h('span', { class: 'item__main' }, h('span', { class: 'item__title', style: { display: 'block' } }, nombreCiclo(f.ciclo, est.historial)), h('span', { class: 'item__sub', style: { display: 'block' } }, `${f.transicion ? `Transición de ${cantidad(f.dias, 'día', 'días')} · ` : ''}Ingresos ${pesos(f.ingreso)} · ahorro ${f.tasa === null || f.transicion ? '—' : porcentaje(f.tasa)}`)),
      h('span', { class: 'item__end money' }, pesos(f.gastado))))) : null));

  // Ahorro (P6)
  const anilloAhorro = (valor, etiqueta, texto) => anillo({ tam: 92, trazo: 10, valor, color: 'var(--cat-save)', etiqueta, centro: h('span', { class: 'ring__value num' }, texto) });
  nodos.push(h('section', { class: 'card', aria: { labelledby: 'ta-t' } },
    h('div', { class: 'card__head' }, h('div', null, h('span', { class: 't-label' }, 'Ahorro'), h('h2', { class: 't-h', id: 'ta-t' }, 'Tasa de ahorro y ahorro ejecutado'))),
    h('div', { class: 'grid-2', style: { textAlign: 'center' } },
      h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-2)' } }, anilloAhorro(Math.max(0, ahorro.tasa ?? 0), `Tasa de ahorro ${ahorro.tasa === null ? 'sin ingresos registrados' : porcentaje(ahorro.tasa)}`, ahorro.tasa === null ? '—' : porcentaje(ahorro.tasa)), h('span', { class: 't-small', style: { fontWeight: '600' } }, 'Tasa de ahorro')),
      h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--sp-2)' } }, anilloAhorro(Math.max(0, ahorro.ahorroEjecutadoPct ?? 0), `Ahorro y metas ejecutado ${porcentaje(ahorro.ahorroEjecutadoPct)} del ingreso`, porcentaje(ahorro.ahorroEjecutadoPct)), h('span', { class: 't-small', style: { fontWeight: '600' } }, 'Ahorro y metas ejecutado'))),
    ahorro.tasa === null
      ? h('p', { class: 't-caption', style: { marginTop: 'var(--sp-3)' } }, 'Sin ingresos registrados en este ciclo: la tasa de ahorro aparece cuando registres tu salario. "Ahorro y metas ejecutado" se mide sobre el ingreso planeado y es la misma cifra que muestran Inicio y Presupuesto.')
      : h('p', { class: 't-caption', style: { marginTop: 'var(--sp-3)' } }, h('b', null, 'Por qué difieren: '), `la tasa (ingreso − consumo) ÷ ingreso cuenta también como ahorro el capital que pagas a deudas (${pesos(ahorro.capital)}) y lo que aún no gastas (${pesos(ahorro.sinGastar)}), además de los aportes a metas (${pesos(ahorro.aportes)}). "Ahorro y metas ejecutado" mide el grupo de ahorro del presupuesto, es decir, los aportes a metas y el capital del abono extra a deudas: ${pesos(ahorro.ahorroEjecutado)} de ${pesos(ahorro.ingreso)}; su plan es ${porcentaje(ahorro.ahorroPlanPct)}. Es la misma cifra que muestran Inicio y Presupuesto. Los intereses del abono cuentan como consumo, no como ahorro.`),
    h('p', { class: 't-caption', style: { marginTop: 'var(--sp-2)' } }, `Consumo del ciclo (gastos + intereses): ${pesos(ahorro.consumo)}. El capital de deudas y los aportes a metas no son consumo.`)));

  // Patrimonio
  const previo = filas.length > 1 ? filas[filas.length - 2].patrimonio : null;
  nodos.push(h('section', { class: 'card', aria: { labelledby: 'pn2-t' }, style: { display: 'flex', flexDirection: 'column', gap: 'var(--sp-1)' } },
    h('span', { class: 't-label', id: 'pn2-t' }, 'Patrimonio neto'),
    h('div', { class: `t-title num${pat.patrimonio < 0 ? ' danger' : ''}`, style: { fontSize: 'var(--fs-xl)' } }, pesos(pat.patrimonio)),
    h('p', { class: 't-caption' }, `Cuentas ${pesos(pat.activos)} − deudas ${pesos(pat.pasivos)}`),
    previo !== null ? h('p', { class: 't-caption' }, `Frente al cierre del ciclo anterior: ${pat.patrimonio - previo >= 0 ? '+' : '−'}${pesos(Math.abs(pat.patrimonio - previo))}`) : null));

  nodos.push(h('p', { class: 'note-legal' }, 'Herramienta personal de seguimiento; no constituye asesoría financiera.'));
  return nodos;
}
