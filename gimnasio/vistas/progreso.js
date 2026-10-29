/*
 * progreso.js — pantalla Progreso (T2.4): filtro Ella/Él/Ambos; volumen de 8 semanas; línea de peso máximo y 1RM estimado
 * (Epley) por ejercicio; mejores marcas; peso corporal (registro + gráfico); minutos de cardio por semana.
 */
import { h, vaciar } from '../../shared/lib/dom.js';
import { inicioSemana, sumarDias, formatearFecha } from '../../shared/lib/fechas.js';
import { formatearNumero, formatearKg } from '../../shared/lib/numeros.js';
import { icono } from '../../shared/ui/icono.js';
import { barras, linea } from '../../shared/ui/graficos.js';
import { confirmar } from '../../shared/ui/hoja.js';
import { mostrarAviso } from '../../shared/ui/aviso.js';
import { haptic } from '../../shared/ui/haptica.js';
import { registrarPesoCorporal, borrarPesoCorporal } from '../logica/acciones.js';
import {
  volumenPorSemana, cardioPorSemana, ejerciciosConHistorial, evolucionEjercicio, mejoresMarcas, pesoCorporalPorSemana, lunesRecientes,
} from '../logica/calculos.js';
import { etiquetaSemanaCorta, textoVolumen } from '../logica/formato.js';
import { segmentado, nombreDe, ejecutar, pedirNumero, callout } from './comun.js';
import { barrasAgrupadas } from './graficos.js';

const SEMANAS = 8;
const MAX_MARCAS = 8;
const COLORES = ['var(--series-1)', 'var(--series-2)'];

export function montar(raiz, ctx) {
  const { tienda, reloj, shell } = ctx;
  const hoy = reloj.hoy();
  const lunesActual = inicioSemana(hoy);
  const p = ctx.parametros.get('persona');
  const filtro = p === 'p1' || p === 'p2' || p === 'ambos' ? p : ctx.persona.actual();
  let ejercicioSel = null;
  let metrica = 'peso'; // con "Ambos": 'peso' | 'orm'
  let verTodasMarcas = false;
  let montado = true;

  const colorDe = (datos, id) => COLORES[datos.ajustes.personas.findIndex((x) => x.id === id)] ?? COLORES[0];
  const k1 = (n) => formatearNumero(n, { maxDecimales: 1 });

  function render() {
    if (!montado) return;
    const datos = tienda.datos();
    const personas = datos.ajustes.personas;
    const ids = filtro === 'ambos' ? personas.map((x) => x.id) : [filtro];
    const etiquetas = lunesRecientes(lunesActual, SEMANAS).map(etiquetaSemanaCorta);
    shell.titulo('Progreso', `Últimas ${SEMANAS} semanas`);

    const selector = segmentado({
      etiqueta: 'Persona', clase: 'seg--persona',
      opciones: [{ valor: 'ambos', texto: 'Ambos' }, ...personas.map((x) => ({ valor: x.id, texto: x.nombre }))], valor: filtro,
      alElegir: (v) => ctx.navegar('progreso', { persona: v }, { reemplazar: true }),
    });
    const nota = callout({ icon: 'info', texto: `Se muestran las últimas ${SEMANAS} semanas, incluida la actual. 1RM estimado con la fórmula de Epley: peso × (1 + reps ÷ 30), solo con 1 a 12 repeticiones.` });

    /* ---- Volumen semanal ---- */
    const volumenes = ids.map((id) => volumenPorSemana(datos, id, lunesActual, SEMANAS));
    const ultimo = volumenes.map((v) => v[SEMANAS - 1].volumen).reduce((a, b) => a + b, 0);
    const previo = volumenes.map((v) => v[SEMANAS - 2].volumen).reduce((a, b) => a + b, 0);
    const delta = previo > 0 ? ultimo / previo - 1 : null;
    const hayVolumen = volumenes.some((v) => v.some((x) => x.volumen > 0));
    const etiquetaVol = `Volumen semanal de las últimas ${SEMANAS} semanas en kilogramos. ${etiquetas.map((e, i) => `${e}: ${ids.map((id, j) => `${nombreDe(datos, id)} ${formatearNumero(Math.round(volumenes[j][i].volumen))}`).join(', ')}`).join('; ')}`;
    let graficoVol = null;
    if (hayVolumen) {
      graficoVol = ids.length === 1
        ? barras({ alto: 170, etiquetaAccesible: etiquetaVol, datos: volumenes[0].map((v, i) => ({ etiqueta: etiquetas[i], valor: v.volumen, resaltar: i === SEMANAS - 1, etiquetaValor: i === SEMANAS - 1 && v.volumen > 0 ? `${k1(v.volumen / 1000)}k` : undefined })) })
        : barrasAgrupadas({ etiquetas, series: ids.map((id, j) => ({ nombre: nombreDe(datos, id), color: colorDe(datos, id), valores: volumenes[j].map((x) => x.volumen) })), alto: 170, etiquetaAccesible: etiquetaVol, resaltar: SEMANAS - 1 });
    }
    const seccionVolumen = h('section', { class: 'card', aria: { labelledby: 'pv-t' } },
      h('div', { class: 'card__head' },
        h('div', null, h('span', { class: 't-label' }, 'Volumen semanal'), h('h2', { class: 't-h', id: 'pv-t' }, textoVolumen(ultimo)), h('div', { class: 't-caption' }, 'Semana actual (aún no termina) vs. la anterior')),
        delta === null ? h('span', { class: 'badge' }, 'Esta semana') : h('span', { class: ['badge', delta >= 0 ? 'badge--ok' : ''] }, icono(delta >= 0 ? 'arrow-up-right' : 'arrow-down-left'), ` ${delta >= 0 ? '+' : '−'}${formatearNumero(Math.abs(delta) * 100, { maxDecimales: 1, minDecimales: 1 })} %`)),
      ids.length > 1 ? leyenda(datos, ids) : null,
      graficoVol ?? h('p', { class: 't-small muted' }, 'Aún no hay series registradas. El volumen aparece al completar tu primera sesión.'));

    /* ---- Ejercicio: peso máximo y 1RM ---- */
    const historial = ejerciciosConHistorial(datos, ids);
    if (!ejercicioSel || !historial.some((x) => x.id === ejercicioSel)) ejercicioSel = historial.length ? historial[0].id : null;
    let seccionEjercicio;
    if (!historial.length) {
      seccionEjercicio = h('section', { class: 'card' }, h('span', { class: 't-label' }, 'Ejercicio'), h('h2', { class: 't-h' }, 'Peso máximo y 1RM'),
        h('p', { class: 't-small muted', style: { marginTop: 'var(--sp-2)' } }, 'Cuando completes sesiones podrás ver cómo suben tus cargas ejercicio por ejercicio.'));
    } else {
      const actual = historial.find((x) => x.id === ejercicioSel);
      const evo = ids.map((id) => evolucionEjercicio(datos, id, ejercicioSel, lunesActual, SEMANAS));
      const porTiempo = actual.medida === 'segundos';
      const series = [];
      if (ids.length === 1) {
        series.push({ nombre: 'Peso máx.', color: 'var(--series-1)', puntos: evo[0].map((x) => x.kg) });
        series.push({ nombre: '1RM est.', color: 'var(--series-2)', puntos: evo[0].map((x) => (x.orm === null ? null : Math.round(x.orm * 10) / 10)), discontinua: true });
      } else {
        ids.forEach((id, j) => series.push({ nombre: `${nombreDe(datos, id)} · ${metrica === 'peso' ? 'peso máx.' : '1RM est.'}`, color: colorDe(datos, id), puntos: evo[j].map((x) => (metrica === 'peso' ? x.kg : x.orm === null ? null : Math.round(x.orm * 10) / 10)) }));
      }
      const hayPuntos = series.some((s) => s.puntos.some((v) => v !== null));
      const etiquetaLinea = `${actual.nombre}: ${series.map((s) => `${s.nombre} ${s.puntos.map((v, i) => (v === null ? null : `${etiquetas[i]} ${k1(v)} kg`)).filter(Boolean).join(', ') || 'sin datos'}`).join('. ')}`;
      seccionEjercicio = h('section', { class: 'card', aria: { labelledby: 'pe-t' } },
        h('div', { class: 'card__head' }, h('div', null, h('span', { class: 't-label' }, 'Ejercicio'), h('h2', { class: 't-h', id: 'pe-t' }, actual.nombre))),
        h('div', { class: 'chip-row', role: 'group', aria: { label: 'Elegir ejercicio' } }, historial.slice(0, 24).map((x) => h('button', {
          class: 'chip', type: 'button', aria: { pressed: String(x.id === ejercicioSel) },
          on: { click: () => { ejercicioSel = x.id; conservar(); } },
        }, x.nombre))),
        ids.length > 1
          ? h('div', { style: { margin: 'var(--sp-2) 0' } }, segmentado({ etiqueta: 'Métrica', opciones: [{ valor: 'peso', texto: 'Peso máx.' }, { valor: 'orm', texto: '1RM est.' }], valor: metrica, alElegir: (v) => { metrica = v; conservar(); } }))
          : null,
        h('div', { class: 'chart-legend', style: { margin: 'var(--sp-2) 0' } }, series.map((s) => h('span', null, h('span', { class: 'legend__swatch', style: { '--sw': s.color } }), s.nombre, s.discontinua ? ' (línea punteada)' : ''))),
        porTiempo
          ? h('p', { class: 't-small muted' }, 'Este ejercicio se mide en segundos: no tiene peso máximo ni 1RM. Mira el detalle de cada sesión en Semana.')
          : hayPuntos
            ? linea({ alto: 190, etiquetas, series: series.map((s) => ({ nombre: s.nombre, color: s.color, puntos: s.puntos, discontinua: s.discontinua })), etiquetaAccesible: etiquetaLinea, formato: (v) => `${k1(v)} kg` })
            : h('p', { class: 't-small muted' }, 'No hay series con peso de este ejercicio en las últimas semanas.'));
    }

    /* ---- Mejores marcas ---- */
    const marcas = ids.flatMap((id) => mejoresMarcas(datos, id)).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : a.nombre < b.nombre ? -1 : 1));
    const visibles = verTodasMarcas ? marcas : marcas.slice(0, MAX_MARCAS);
    const seccionMarcas = h('section', { class: 'card', aria: { labelledby: 'mm-t' } },
      h('h2', { class: 't-h', id: 'mm-t', style: { marginBottom: 'var(--sp-2)' } }, 'Mejores marcas'),
      marcas.length
        ? [visibles.map((m) => filaMarca(datos, m, ids.length > 1)),
          marcas.length > MAX_MARCAS ? h('button', { class: 'btn btn--ghost btn--block', type: 'button', on: { click: () => { verTodasMarcas = !verTodasMarcas; conservar(); } } }, verTodasMarcas ? 'Ver menos' : `Ver las ${marcas.length} marcas`) : null]
        : h('p', { class: 't-small muted' }, 'Todavía no hay marcas. Se registran con las series de peso de tus sesiones completadas.'));

    /* ---- Peso corporal ---- */
    const pesos = ids.map((id) => pesoCorporalPorSemana(datos, id, lunesActual, SEMANAS));
    const todosPesos = datos.pesoCorporal.filter((x) => ids.includes(x.personaId));
    const ultimoPeso = (id) => [...datos.pesoCorporal].filter((x) => x.personaId === id).sort((a, b) => (a.fecha < b.fecha ? 1 : -1))[0] ?? null;
    const cabeza = ids.length === 1 && ultimoPeso(ids[0]) ? `${k1(ultimoPeso(ids[0]).kg)} kg` : 'Registro';
    let cambio = null;
    if (ids.length === 1) {
      const pts = pesos[0].filter((x) => x.kg !== null);
      if (pts.length >= 2) {
        const d = Math.round((pts[pts.length - 1].kg - pts[0].kg) * 10) / 10;
        cambio = h('span', { class: 'badge badge--info' }, `${d > 0 ? '+' : d < 0 ? '−' : ''}${k1(Math.abs(d))} kg en ${SEMANAS} semanas`);
      }
    }
    const hayPeso = pesos.some((s) => s.some((x) => x.kg !== null));
    const recientes = [...todosPesos].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0)).slice(0, 4);
    const seccionPeso = h('section', { class: 'card stack', aria: { labelledby: 'bw-t' } },
      h('div', { class: 'card__head', style: { marginBottom: 0 } }, h('div', null, h('span', { class: 't-label' }, 'Peso corporal'), h('h2', { class: 't-h', id: 'bw-t' }, cabeza)), cambio),
      ids.length > 1 ? leyenda(datos, ids) : null,
      hayPeso
        ? linea({
          alto: 140, etiquetas, area: ids.length === 1,
          series: ids.map((id, j) => ({ nombre: nombreDe(datos, id), color: ids.length === 1 ? 'var(--series-3)' : colorDe(datos, id), puntos: pesos[j].map((x) => x.kg) })),
          etiquetaAccesible: `Peso corporal por semana: ${ids.map((id, j) => `${nombreDe(datos, id)} ${pesos[j].filter((x) => x.kg !== null).map((x) => `${etiquetaSemanaCorta(x.lunes)} ${k1(x.kg)} kg`).join(', ') || 'sin datos'}`).join('. ')}`,
          formato: (v) => `${k1(v)} kg`,
        })
        : h('p', { class: 't-small muted' }, 'Aún no hay registros de peso corporal.'),
      h('div', { class: 'stack stack--sm' }, ids.map((id) => h('button', { class: 'btn btn--secondary btn--block', type: 'button', dataset: { registrarPeso: id }, on: { click: () => registrarPeso(datos, id) } }, icono('plus'), ids.length === 1 ? ' Registrar peso de hoy' : ` Registrar peso de ${nombreDe(datos, id)}`))),
      recientes.length ? h('div', { class: 'list' }, recientes.map((x) => h('div', { class: 'item' },
        h('div', { class: 'item__main' }, h('div', { class: 'item__title num' }, `${k1(x.kg)} kg`), h('div', { class: 'item__sub' }, `${ids.length > 1 ? `${nombreDe(datos, x.personaId)} · ` : ''}${formatearFecha(x.fecha, 'corta')}`)),
        h('button', { class: 'icon-btn', type: 'button', aria: { label: `Borrar el registro de ${k1(x.kg)} kg del ${formatearFecha(x.fecha, 'corta')}` }, on: { click: () => borrarPeso(x) } }, icono('trash'))))) : null);

    /* ---- Cardio ---- */
    const cardio = ids.map((id) => cardioPorSemana(datos, id, lunesActual, SEMANAS));
    const planMin = planCardioSemanal(datos);
    const hayCardio = cardio.some((s) => s.some((x) => x.minutos > 0));
    const etiquetaCardio = `Minutos de cardio por semana. ${etiquetas.map((e, i) => `${e}: ${ids.map((id, j) => `${nombreDe(datos, id)} ${cardio[j][i].minutos}`).join(', ')}`).join('; ')}`;
    const seccionCardio = h('section', { class: 'card', aria: { labelledby: 'ca-t' } },
      h('div', { class: 'card__head' }, h('div', null, h('span', { class: 't-label' }, 'Cardio'), h('h2', { class: 't-h', id: 'ca-t' }, 'Minutos por semana')), h('span', { class: 'badge' }, `Plan ${planMin} min`)),
      ids.length > 1 ? leyenda(datos, ids) : null,
      hayCardio
        ? (ids.length === 1
          ? barras({ alto: 150, max: Math.max(planMin, ...cardio[0].map((x) => x.minutos)), color: 'var(--series-2)', etiquetaAccesible: etiquetaCardio, datos: cardio[0].map((x, i) => ({ etiqueta: etiquetas[i], valor: x.minutos, etiquetaValor: x.minutos ? String(x.minutos) : undefined, resaltar: false })) })
          : barrasAgrupadas({ etiquetas, series: ids.map((id, j) => ({ nombre: nombreDe(datos, id), color: colorDe(datos, id), valores: cardio[j].map((x) => x.minutos) })), alto: 150, unidad: 'min', etiquetaAccesible: etiquetaCardio, resaltar: SEMANAS - 1 }))
        : h('p', { class: 't-small muted' }, 'Aún no hay cardio registrado.'));

    const y = raiz.scrollTop;
    vaciar(raiz);
    raiz.append(selector, nota, seccionVolumen, seccionEjercicio, seccionMarcas, seccionPeso, seccionCardio);
    raiz.scrollTop = y;
  }

  function conservar() { render(); }

  function leyenda(datos, ids) {
    return h('div', { class: 'chart-legend', style: { margin: 'var(--sp-2) 0' } }, ids.map((id) => h('span', null, h('span', { class: 'legend__swatch', style: { '--sw': colorDe(datos, id) } }), nombreDe(datos, id))));
  }

  function filaMarca(datos, m, conPersona) {
    const nuevo = m.fecha >= sumarDias(hoy, -7);
    return h('div', { class: 'pr-row' },
      h('span', { class: ['item__icon', nuevo ? 'item__icon--accent' : ''] }, icono('trophy')),
      h('div', { class: 'item__main' },
        h('div', { class: 'item__title' }, m.nombre, nuevo ? [' ', h('span', { class: 'badge badge--warn' }, 'Nuevo')] : null, conPersona ? [' ', h('span', { class: 'badge' }, nombreDe(datos, m.personaId))] : null),
        h('div', { class: 'item__sub' }, formatearFecha(m.fecha, 'dia-mes-anio'))),
      h('div', { class: 'item__end' },
        h('div', { class: 'num', style: { fontWeight: 700 } }, `${formatearKg(m.kg)} × ${m.reps}`),
        m.orm ? h('div', { class: 't-caption' }, `1RM est. ${k1(m.orm)} kg`) : null));
  }

  function planCardioSemanal(datos) {
    return datos.rutina.dias.reduce((t, d) => t + (d.cardio ? d.cardio.minutos : 0), 0);
  }

  async function registrarPeso(datos, id) {
    const previo = [...datos.pesoCorporal].filter((x) => x.personaId === id).sort((a, b) => (a.fecha < b.fecha ? 1 : -1))[0];
    const v = await pedirNumero({ titulo: `Peso de ${nombreDe(datos, id)}`, valorActual: previo ? previo.kg : 0, unidad: 'kg', decimal: true, max: 300, maxDigitos: 4, maxDecimales: 1 });
    if (v === null) return;
    const r = ejecutar(ctx, registrarPesoCorporal, { personaId: id, fecha: hoy, kg: v });
    if (r.ok) { haptic('success'); mostrarAviso('Peso guardado', { tipo: 'ok' }); }
  }

  async function borrarPeso(x) {
    const ok = await confirmar({ titulo: '¿Borrar este registro?', mensaje: `${formatearKg(x.kg)} del ${formatearFecha(x.fecha, 'dia-mes-anio')}.`, confirmar: 'Borrar', peligro: true });
    if (ok) ejecutar(ctx, borrarPesoCorporal, { id: x.id });
  }

  const desuscribir = tienda.suscribir((ev) => { if (ev.tipo === 'cambio') render(); });
  render();
  return {
    actualizar() { render(); },
    desmontar() { montado = false; desuscribir(); },
  };
}
