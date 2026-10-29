/*
 * semana.js — pantalla Semana (T2.3): navegación entre semanas, adherencia por persona en anillos, volumen total con
 * variación vs. la semana anterior, series, récords, cardio, barras de volumen por día comparando personas, lista de
 * entrenamientos con estado por persona (el toque abre el día) y notas/molestias.
 */
import { h, vaciar } from '../../shared/lib/dom.js';
import { inicioSemana, sumarDias, formatearFecha, partes } from '../../shared/lib/fechas.js';
import { etiquetaCiclo } from '../../shared/lib/ciclos.js';
import { formatearNumero, formatearPorcentaje } from '../../shared/lib/numeros.js';
import { icono } from '../../shared/ui/icono.js';
import { anillo } from '../../shared/ui/graficos.js';
import { resumenSemana, sumarPersonas, notasDeSemana } from '../logica/calculos.js';
import { CORTOS_DIA, LETRAS_DIA, NOMBRES_DIA, textoVolumen } from '../logica/formato.js';
import { segmentado, nombreDe, estadoVacio } from './comun.js';
import { barrasAgrupadas } from './graficos.js';

const SUBTITULO = { pasada: 'Semana pasada', actual: 'Semana actual', futura: 'Semana próxima' };
const ESTADO_TEXTO = { completada: 'Completa', 'en-curso': 'En curso', perdida: 'No realizado', pendiente: 'Pendiente' };

function fechaValida(f) {
  if (typeof f !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return null;
  try { partes(f); return f; } catch { return null; }
}

export function montar(raiz, ctx) {
  const { tienda, reloj, shell } = ctx;
  const hoy = reloj.hoy();
  const lunes = inicioSemana(fechaValida(ctx.parametros.get('lunes')) ?? hoy);
  const p = ctx.parametros.get('persona');
  const filtro = p === 'p1' || p === 'p2' || p === 'ambos' ? p : 'ambos';
  let montado = true;

  const ir = (nuevoLunes, nuevoFiltro = filtro) => ctx.navegar('semana', { lunes: nuevoLunes === inicioSemana(hoy) ? null : nuevoLunes, persona: nuevoFiltro === 'ambos' ? null : nuevoFiltro }, { reemplazar: true });

  function render() {
    if (!montado) return;
    const datos = tienda.datos();
    const personas = datos.ajustes.personas;
    const ids = filtro === 'ambos' ? personas.map((x) => x.id) : [filtro];
    const r = resumenSemana(datos, lunes, hoy);
    const total = sumarPersonas(ids.map((id) => r.porPersona[id]));
    const rango = etiquetaCiclo({ inicio: r.lunes, fin: r.domingo });
    shell.titulo('Semana', 'Resumen y notas');

    const selector = segmentado({
      etiqueta: 'Persona', clase: 'seg--persona',
      opciones: [{ valor: 'ambos', texto: 'Ambos' }, ...personas.map((x) => ({ valor: x.id, texto: x.nombre }))], valor: filtro,
      alElegir: (v) => ir(lunes, v),
    });

    const navegacion = h('div', { class: 'weeknav' },
      h('button', { class: 'icon-btn icon-btn--filled', type: 'button', aria: { label: 'Semana anterior' }, on: { click: () => ir(sumarDias(lunes, -7)) } }, icono('chevron-left')),
      h('div', { class: 'weeknav__title', aria: { live: 'polite' } }, h('div', { class: 't-h' }, rango), h('div', { class: 't-caption' }, SUBTITULO[r.estado])),
      h('button', { class: 'icon-btn icon-btn--filled', type: 'button', aria: { label: 'Semana siguiente' }, on: { click: () => ir(sumarDias(lunes, 7)) } }, icono('chevron-right')));
    const irHoy = lunes !== inicioSemana(hoy)
      ? h('div', { class: 'cluster', style: { justifyContent: 'center' } }, h('button', { class: 'chip', type: 'button', on: { click: () => ir(inicioSemana(hoy)) } }, icono('calendar'), ' Ir a esta semana'))
      : null;

    /* Adherencia por persona (siempre las dos) */
    const adherencia = h('section', { class: 'grid-2', aria: { label: 'Adherencia de la semana' } },
      personas.map((pe) => {
        const x = r.porPersona[pe.id];
        const fraccion = x.adherencia ?? 0;
        const completo = x.programadas > 0 && x.completadas === x.programadas;
        return h('div', { class: 'card stat-ring' },
          anillo({ tam: 84, trazo: 9, valor: fraccion, color: completo ? 'var(--ok)' : 'var(--accent)', centro: centroAnillo(x.programadas ? `${x.completadas}/${x.programadas}` : '—', 'sesiones'), etiqueta: `${pe.nombre}: ${x.completadas} de ${x.programadas} sesiones` }),
          h('span', { class: 't-small' }, h('b', null, pe.nombre), x.adherencia === null ? '' : ` · ${formatearPorcentaje(x.adherencia, 0)}`));
      }));

    /* Resumen (filtrado) */
    const delta = total.variacion === null
      ? h('span', { class: 'badge' }, 'Sin semana previa')
      : h('span', { class: ['delta', 'badge', total.variacion >= 0 ? 'badge--ok' : r.estado === 'actual' ? '' : 'badge--warn'] }, icono(total.variacion >= 0 ? 'arrow-up-right' : 'arrow-down-left'), ` ${total.variacion >= 0 ? '+' : '−'}${formatearNumero(Math.abs(total.variacion) * 100, { maxDecimales: 1, minDecimales: 1 })} %`);
    const resumen = h('section', { class: 'card', aria: { labelledby: 'vol-t' } },
      h('div', { class: 'card__head' }, h('div', null, h('span', { class: 't-label' }, 'Volumen'), h('h2', { class: 't-h', id: 'vol-t' }, 'Esta semana vs. la anterior'))),
      h('div', { class: 'split', style: { alignItems: 'flex-end', marginBottom: 'var(--sp-3)' } },
        h('div', null, h('div', { class: 't-title num' }, textoVolumen(total.volumen)), h('div', { class: 't-caption' }, `Semana previa: ${textoVolumen(total.volumenPrevio)}${r.estado === 'actual' ? ' · esta semana aún no termina' : ''}`)), delta),
      h('div', { class: 'grid-2' },
        kpi(`${total.seriesHechas} de ${total.seriesPlan}`, 'Series'),
        kpi(String(total.records), total.records === 1 ? 'Récord de peso' : 'Récords de peso'),
        kpi(`${total.cardioMin} de ${total.cardioPlanMin} min`, 'Cardio'),
        kpi(`${total.completadas} de ${total.programadas}`, 'Sesiones')));

    /* Barras por día */
    const idsBarras = ids;
    const series = idsBarras.map((id, j) => ({ nombre: nombreDe(datos, id), color: personas.findIndex((x) => x.id === id) === 0 ? 'var(--series-1)' : 'var(--series-2)', valores: r.dias.map((d) => d.porPersona[id].volumen) }));
    const etiquetaGraf = `Volumen por día en kilogramos. ${r.dias.map((d, k) => `${NOMBRES_DIA[k + 1]}: ${series.map((s) => `${s.nombre} ${formatearNumero(Math.round(s.valores[k]))}`).join(', ')}`).join('; ')}`;
    const hayVolumen = series.some((s) => s.valores.some((v) => v > 0));
    const barras = h('section', { class: 'card', aria: { labelledby: 'dia-t' } },
      h('h2', { class: 't-h', id: 'dia-t', style: { marginBottom: 'var(--sp-2)' } }, 'Volumen por día'),
      h('div', { class: 't-caption', style: { marginBottom: 'var(--sp-2)' } }, 'kg; en ejercicios por lado se cuenta cada lado'),
      series.length > 1
        ? h('div', { class: 'chart-legend', style: { marginBottom: 'var(--sp-2)' } }, series.map((s) => h('span', null, h('span', { class: 'legend__swatch', style: { '--sw': s.color } }), s.nombre)))
        : null,
      hayVolumen
        ? barrasAgrupadas({ etiquetas: LETRAS_DIA.slice(1), series, alto: 168, etiquetaAccesible: etiquetaGraf, resaltar: r.dias.findIndex((d) => d.fecha === hoy) })
        : h('p', { class: 't-small muted' }, 'Todavía no hay series registradas esta semana.'));

    /* Lista de entrenamientos con estado por persona */
    const filas = [];
    r.dias.forEach((d, k) => {
      const activos = ids.filter((id) => d.porPersona[id].programada);
      if (!activos.length) return;
      const nombreDia = d.porPersona[activos[0]].nombreDia;
      filas.push(h('div', { class: 'daylog' },
        h('div', { class: 'daylog__d' }, h('span', { class: 't-label' }, CORTOS_DIA[k + 1]), h('b', { class: 'num' }, String(partes(d.fecha).dia))),
        h('div', { class: 'item__main' }, h('div', { class: 'item__title' }, nombreDia),
          activos.map((id) => filaPersona(datos, d, id)))));
    });
    const lista = h('section', { class: 'card', aria: { labelledby: 'ses-t' } },
      h('h2', { class: 't-h', id: 'ses-t', style: { marginBottom: 'var(--sp-3)' } }, 'Entrenamientos'),
      filas.length ? h('div', { class: 'stack stack--lg' }, filas) : estadoVacio({ icon: 'calendar', titulo: 'Sin entrenamientos programados', texto: 'Esta semana no hay días de rutina para este filtro.' }));

    /* Notas y molestias */
    const notas = notasDeSemana(datos, lunes, ids);
    const bloqueNotas = h('section', { class: 'card', aria: { labelledby: 'not-t' } },
      h('h2', { class: 't-h', id: 'not-t', style: { marginBottom: 'var(--sp-3)' } }, 'Notas y molestias'),
      notas.length
        ? h('div', { class: 'stack' }, notas.map((n) => h('div', { class: 'stack stack--sm' },
          h('div', { class: 't-small' }, h('b', null, nombreDe(datos, n.personaId)), ` · ${formatearFecha(n.fecha, 'corta')} · ${n.nombreDia}`),
          n.dolor ? h('div', { class: 'callout callout--warn' }, icono('alert'), h('div', null, h('span', { class: 'callout__title' }, 'Molestia'), h('br'), n.dolor)) : null,
          n.notas ? h('p', { class: 't-small' }, n.notas) : null)))
        : h('p', { class: 't-small muted' }, 'Sin notas ni molestias registradas esta semana.'));

    const y = raiz.scrollTop;
    vaciar(raiz);
    raiz.append(selector, navegacion, ...(irHoy ? [irHoy] : []), adherencia, resumen, barras, lista, bloqueNotas);
    raiz.scrollTop = y;
  }

  function filaPersona(datos, d, id) {
    const x = d.porPersona[id];
    const parcial = x.estado === 'completada' && x.seriesHechas < x.seriesPlan;
    const clase = x.estado === 'completada' ? (parcial ? 'badge--warn' : 'badge--ok') : x.estado === 'en-curso' ? 'badge--accent' : x.estado === 'perdida' ? 'badge--danger' : '';
    const detalle = x.estado === 'completada' || x.estado === 'en-curso'
      ? [x.duracionMin !== null ? `${x.duracionMin} min` : null, `${x.seriesHechas}/${x.seriesPlan} series`, textoVolumen(x.volumen), x.cardioPlanMin ? `cardio ${x.cardioMin}/${x.cardioPlanMin} min` : null].filter(Boolean).join(' · ')
      : x.estado === 'pendiente' ? `${x.seriesPlan} series${x.cardioPlanMin ? ` · cardio ${x.cardioPlanMin} min` : ''}` : 'No se entrenó este día';
    return h('a', { class: 'daylog-fila', href: `#/entrenar?fecha=${d.fecha}&persona=${id}`, aria: { label: `${nombreDe(datos, id)}, ${formatearFecha(d.fecha, 'corta')}: ${parcial ? 'parcial' : ESTADO_TEXTO[x.estado]}. Abrir el día` } },
      h('div', { class: 'item__main' },
        h('div', { class: 'split' }, h('span', { class: 'item__title' }, nombreDe(datos, id)), h('span', { class: ['badge', clase] }, parcial ? 'Parcial' : ESTADO_TEXTO[x.estado])),
        h('div', { class: 'item__sub' }, detalle)),
      icono('chevron-right'));
  }

  function centroAnillo(texto, etiqueta) {
    const f = document.createDocumentFragment();
    f.append(h('span', { class: 'ring__value num' }, texto), h('span', { class: 'ring__label' }, etiqueta));
    return f;
  }

  function kpi(valor, etiqueta) {
    return h('div', { class: 'card card--flat card--tight' }, h('div', { class: 'kpi' }, h('span', { class: 'kpi__v num' }, valor), h('span', { class: 'kpi__l' }, etiqueta)));
  }

  const desuscribir = tienda.suscribir((ev) => { if (ev.tipo === 'cambio') render(); });
  render();
  return {
    actualizar() { render(); },
    desmontar() { montado = false; desuscribir(); },
  };
}
