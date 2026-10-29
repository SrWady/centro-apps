/*
 * calculos.js — volumen, Epley, récords, progresión, semanas y adherencia (PURO). Nada de esto se guarda.
 * Fórmulas de referencia: docs/ESQUEMA-GIMNASIO.md §8. Afinaciones documentadas en docs/hallazgos/dev-gimnasio.md.
 */
import { diasDeSemana, inicioSemana, sumarDias } from '../../shared/lib/fechas.js';
import { redondearA } from '../../shared/lib/numeros.js';
import { PERSONAS_IDS } from './esquema.js';
import { estadoDelDia, ejercicioEfectivo, serieValida } from './sesiones.js';

export const INCREMENTO_SEGUNDOS = 5;
export const EPLEY_MAX_REPS = 12;

/* ---------- volumen y series ---------- */

/** kg × reps × (por lado ? 2 : 1); solo medida 'reps', serie hecha y kg > 0. (kg por mancuerna, sin duplicar: V7/P3.) */
export function volumenSerie(ej, serie) {
  if (ej.medida !== 'reps' || !serie.ok || !(serie.kg > 0)) return 0;
  return serie.kg * serie.reps * (ej.porLado ? 2 : 1);
}

export function volumenEjercicio(ej) {
  return ej.series.reduce((t, s) => t + volumenSerie(ej, s), 0);
}

export function volumenSesion(ses) {
  if (!ses.ejercicios) return 0;
  return ses.ejercicios.reduce((t, e) => t + volumenEjercicio(e), 0);
}

export function seriesHechas(ses) {
  return ses.ejercicios ? ses.ejercicios.reduce((t, e) => t + e.series.filter((s) => s.ok).length, 0) : 0;
}

export function seriesTotales(ses) {
  return ses.ejercicios ? ses.ejercicios.reduce((t, e) => t + e.series.length, 0) : 0;
}

/* ---------- 1RM Epley ---------- */

/** kg × (1 + reps/30), solo con 1 a 12 repeticiones (1 → kg). Sin redondear. null si no aplica. */
export function epley(kg, reps) {
  if (!(kg > 0) || !Number.isInteger(reps) || reps < 1 || reps > EPLEY_MAX_REPS) return null;
  return reps === 1 ? kg : kg * (1 + reps / 30);
}

/**
 * Mejor serie hecha por peso (a igualdad de peso, más repeticiones). Solo ejercicios por repeticiones con kg > 0 y al menos
 * 1 repetición: una serie "hecha" con 0 repeticiones (intento fallido) no es una marca (R1-04).
 */
export function mejorSeriePorPeso(ej) {
  if (ej.medida !== 'reps') return null;
  let mejor = null;
  for (const s of ej.series) {
    if (!s.ok || !(s.kg > 0) || !(s.reps >= 1)) continue;
    if (!mejor || s.kg > mejor.kg || (s.kg === mejor.kg && s.reps > mejor.reps)) mejor = s;
  }
  return mejor;
}

/** Mejor 1RM estimado de las series hechas del ejercicio, o null. */
export function mejorEpley(ej) {
  let mejor = null;
  for (const s of ej.series) {
    if (!s.ok || ej.medida !== 'reps') continue;
    const v = epley(s.kg, s.reps);
    if (v !== null && (mejor === null || v > mejor)) mejor = v;
  }
  return mejor;
}

/* ---------- récords (PR) ---------- */

/** Mejor serie previa (kg, reps) de la persona en ese ejercicio en sesiones COMPLETADAS anteriores a `fecha`. */
export function mejorPrevia(datos, personaId, ejercicioId, fecha) {
  let mejor = null;
  for (const s of Object.values(datos.sesiones)) {
    if (s.personaId !== personaId || s.estado !== 'completada' || s.fecha >= fecha) continue;
    const e = s.ejercicios.find((x) => x.id === ejercicioId);
    const m = e && mejorSeriePorPeso(e);
    if (m && (!mejor || m.kg > mejor.kg || (m.kg === mejor.kg && m.reps > mejor.reps))) mejor = { kg: m.kg, reps: m.reps };
  }
  return mejor;
}

/**
 * Récords de peso de una sesión: por ejercicio, su mejor serie si supera el máximo kg histórico previo de esa persona
 * (sin historial previo NO es récord). Uno por ejercicio por sesión.
 * → [{ ejercicioId, nombre, kg, reps, orm, previoKg, previoReps }]
 */
export function recordsDeSesion(datos, ses) {
  const salida = [];
  for (const e of ses.ejercicios ?? []) {
    const m = mejorSeriePorPeso(e);
    if (!m) continue;
    const previa = mejorPrevia(datos, ses.personaId, e.id, ses.fecha);
    if (previa && m.kg > previa.kg) {
      salida.push({ ejercicioId: e.id, nombre: e.nombre, kg: m.kg, reps: m.reps, orm: epley(m.kg, m.reps), previoKg: previa.kg, previoReps: previa.reps });
    }
  }
  return salida;
}

/* ---------- progresión ---------- */

/**
 * Sugerencia para la próxima vez, a partir de un ejercicio de una sesión anterior (§8, con estas precisiones):
 *  - dolor en esa sesión → 'revisar'.
 *  - 'subir' si TODAS las series programadas se hicieron, todas alcanzaron el máximo y ninguna quedó por debajo del RIR mínimo
 *    (RIR no anotado se acepta): +incrementoKg (en segundos, +5 s).
 *  - 'bajar' si la mitad o más de las series hechas quedó por debajo del mínimo: −incrementoKg (mín. 0; en segundos, −5 s, mín. 5).
 *  - en otro caso 'mantener'. Sin series hechas → null. Una serie marcada con 0 repeticiones (o 0 s) no cuenta como hecha (R2G-04).
 * El peso de referencia es el mayor de las series hechas.
 *  - Ejercicio por repeticiones SIN peso anotado (kgBase = 0: abducciones o zancadas sin carga): nunca 'subir' ni 'bajar' (no hay
 *    carga de la que partir): 'mantener' con `sinPeso: true` (R1-05); `alcanzoMaximo` dice si llegó al tope en todas las series.
 * → { tipo, kg, seg|null, kgBase, sinPeso?, alcanzoMaximo? }
 */
export function sugerirProgresion(ej, { dolor = false, incrementoKg = 2.5 } = {}) {
  const hechas = ej.series.filter((s) => serieValida(ej, s)); // R2G-04: sin las series de 0 repeticiones (intentos fallidos)
  if (!hechas.length) return null;
  const porTiempo = ej.medida === 'segundos';
  const campo = porTiempo ? 'seg' : 'reps';
  const kgBase = Math.max(...hechas.map((s) => s.kg));
  const segBase = porTiempo ? Math.max(...hechas.map((s) => s.seg)) : null;
  const resultado = (tipo, kg, seg = null) => ({ tipo, kg, seg, kgBase });
  if (dolor) return resultado('revisar', kgBase, segBase);
  const completo = hechas.length === ej.series.length;
  const alcanzanMax = hechas.every((s) => s[campo] >= ej.max && (ej.rir === null || s.rir === null || s.rir >= ej.rir.min));
  if (!porTiempo && !(kgBase > 0)) return { ...resultado('mantener', 0), sinPeso: true, alcanzoMaximo: completo && alcanzanMax };
  if (completo && alcanzanMax) {
    return porTiempo ? resultado('subir', kgBase, segBase + INCREMENTO_SEGUNDOS) : resultado('subir', redondearA(kgBase + incrementoKg, 2));
  }
  const debajo = hechas.filter((s) => s[campo] < ej.min).length;
  if (debajo * 2 >= hechas.length) {
    return porTiempo
      ? resultado('bajar', kgBase, Math.max(5, segBase - INCREMENTO_SEGUNDOS))
      : resultado('bajar', Math.max(0, redondearA(kgBase - incrementoKg, 2)));
  }
  return resultado('mantener', kgBase, segBase);
}

/* ---------- semanas ---------- */

/** 'pasada' | 'actual' | 'futura' respecto de hoy. */
export function estadoSemana(lunes, hoy) {
  const actual = inicioSemana(hoy);
  return lunes < actual ? 'pasada' : lunes > actual ? 'futura' : 'actual';
}

const PROGRAMADOS = new Set(['pendiente', 'en-curso', 'completada', 'perdida']);

/** Resumen de un día para una persona (estado, series, cardio, volumen). */
export function resumenDia(datos, fecha, personaId, hoy) {
  const { estado, sesion, dia } = estadoDelDia(datos, fecha, personaId, hoy);
  const base = {
    fecha, personaId, estado, sesion, programada: PROGRAMADOS.has(estado), nombreDia: sesion?.nombreDia ?? dia?.nombre ?? '',
    seriesHechas: 0, seriesPlan: 0, cardioMin: 0, cardioPlanMin: 0, volumen: 0, duracionMin: null,
  };
  if (sesion && (estado === 'completada' || estado === 'en-curso')) {
    base.seriesHechas = seriesHechas(sesion);
    base.seriesPlan = seriesTotales(sesion);
    base.cardioMin = sesion.cardio && sesion.cardio.ok ? sesion.cardio.minutos : 0;
    base.cardioPlanMin = sesion.cardioPlan ? sesion.cardioPlan.minutos : 0;
    base.volumen = volumenSesion(sesion);
    base.duracionMin = sesion.cierre ? Math.round(sesion.cierre.duracionSeg / 60) : null;
  } else if (dia) {
    base.seriesPlan = dia.ejercicios.reduce((t, e) => t + ejercicioEfectivo(e, personaId).series, 0);
    base.cardioPlanMin = dia.cardio ? dia.cardio.minutos : 0;
  }
  return base;
}

/** Volumen de una persona en la semana (sesiones en curso y completadas). */
export function volumenDeSemana(datos, personaId, lunes) {
  const fin = sumarDias(lunes, 6);
  let total = 0;
  for (const s of Object.values(datos.sesiones)) {
    if (s.personaId === personaId && s.estado !== 'sin-iniciar' && s.fecha >= lunes && s.fecha <= fin) total += volumenSesion(s);
  }
  return total;
}

/**
 * Resumen de una semana lun–dom por persona: adherencia (completadas / programadas), series, cardio, volumen con variación
 * vs. la semana anterior, récords y los 7 días con su estado.
 */
export function resumenSemana(datos, lunes, hoy) {
  const fechas = diasDeSemana(lunes);
  const dias = fechas.map((fecha) => ({ fecha, porPersona: Object.fromEntries(PERSONAS_IDS.map((p) => [p, resumenDia(datos, fecha, p, hoy)])) }));
  const porPersona = {};
  for (const p of PERSONAS_IDS) {
    const lista = dias.map((d) => d.porPersona[p]);
    const sumar = (campo) => lista.reduce((t, d) => t + d[campo], 0);
    const records = lista.reduce((t, d) => t + (d.sesion && d.sesion.estado !== 'sin-iniciar' ? recordsDeSesion(datos, d.sesion).length : 0), 0);
    const volumen = sumar('volumen');
    const volumenPrevio = volumenDeSemana(datos, p, sumarDias(lunes, -7));
    const programadas = lista.filter((d) => d.programada).length;
    const completadas = lista.filter((d) => d.estado === 'completada').length;
    porPersona[p] = {
      completadas, programadas, adherencia: programadas ? completadas / programadas : null,
      seriesHechas: sumar('seriesHechas'), seriesPlan: sumar('seriesPlan'),
      cardioMin: sumar('cardioMin'), cardioPlanMin: sumar('cardioPlanMin'),
      volumen, volumenPrevio, variacion: volumenPrevio > 0 ? volumen / volumenPrevio - 1 : null,
      records,
    };
  }
  return { lunes, domingo: sumarDias(lunes, 6), estado: estadoSemana(lunes, hoy), dias, porPersona };
}

/** Suma los resúmenes de varias personas (filtro "Ambos"). */
export function sumarPersonas(resumenes) {
  const total = { completadas: 0, programadas: 0, seriesHechas: 0, seriesPlan: 0, cardioMin: 0, cardioPlanMin: 0, volumen: 0, volumenPrevio: 0, records: 0 };
  for (const r of resumenes) for (const k of Object.keys(total)) total[k] += r[k];
  total.adherencia = total.programadas ? total.completadas / total.programadas : null;
  total.variacion = total.volumenPrevio > 0 ? total.volumen / total.volumenPrevio - 1 : null;
  return total;
}

/** Notas de cierre y molestias de las sesiones completadas de la semana. */
export function notasDeSemana(datos, lunes, personaIds = PERSONAS_IDS) {
  const fin = sumarDias(lunes, 6);
  return Object.values(datos.sesiones)
    .filter((s) => s.estado === 'completada' && personaIds.includes(s.personaId) && s.fecha >= lunes && s.fecha <= fin && (s.cierre.notas || s.cierre.dolor.hay))
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.personaId < b.personaId ? -1 : 1))
    .map((s) => ({ fecha: s.fecha, personaId: s.personaId, nombreDia: s.nombreDia, notas: s.cierre.notas, dolor: s.cierre.dolor.hay ? s.cierre.dolor.descripcion : '' }));
}

/* ---------- series de tiempo para Progreso ---------- */

function lunesDeCola(lunesFinal, n) {
  return Array.from({ length: n }, (_, i) => sumarDias(lunesFinal, -7 * (n - 1 - i)));
}

/** Volumen semanal (kg) de una persona en las últimas n semanas que terminan en `lunesFinal`. */
export function volumenPorSemana(datos, personaId, lunesFinal, n = 8) {
  const mapa = new Map();
  for (const s of Object.values(datos.sesiones)) {
    if (s.personaId !== personaId || s.estado === 'sin-iniciar') continue;
    const l = inicioSemana(s.fecha);
    mapa.set(l, (mapa.get(l) ?? 0) + volumenSesion(s));
  }
  return lunesDeCola(lunesFinal, n).map((lunes) => ({ lunes, volumen: mapa.get(lunes) ?? 0 }));
}

/** Minutos de cardio hechos por semana. */
export function cardioPorSemana(datos, personaId, lunesFinal, n = 8) {
  const mapa = new Map();
  for (const s of Object.values(datos.sesiones)) {
    if (s.personaId !== personaId || s.estado === 'sin-iniciar' || !s.cardio || !s.cardio.ok) continue;
    const l = inicioSemana(s.fecha);
    mapa.set(l, (mapa.get(l) ?? 0) + s.cardio.minutos);
  }
  return lunesDeCola(lunesFinal, n).map((lunes) => ({ lunes, minutos: mapa.get(lunes) ?? 0 }));
}

/** Ejercicios con alguna serie hecha en sesiones completadas, del más reciente al más antiguo. */
export function ejerciciosConHistorial(datos, personaIds = PERSONAS_IDS) {
  const mapa = new Map();
  for (const s of Object.values(datos.sesiones)) {
    if (s.estado !== 'completada' || !personaIds.includes(s.personaId)) continue;
    for (const e of s.ejercicios) {
      if (!e.series.some((x) => x.ok)) continue;
      const prev = mapa.get(e.id);
      if (!prev) mapa.set(e.id, { id: e.id, nombre: e.nombre, medida: e.medida, ultima: s.fecha, sesiones: 1 });
      else {
        prev.sesiones += 1;
        if (s.fecha >= prev.ultima) { prev.ultima = s.fecha; prev.nombre = e.nombre; }
      }
    }
  }
  return [...mapa.values()].sort((a, b) => (a.ultima < b.ultima ? 1 : a.ultima > b.ultima ? -1 : a.nombre < b.nombre ? -1 : 1));
}

/** Peso máximo y 1RM estimado por semana de un ejercicio (null donde no hubo series hechas). */
export function evolucionEjercicio(datos, personaId, ejercicioId, lunesFinal, n = 8) {
  const mapa = new Map();
  for (const s of Object.values(datos.sesiones)) {
    if (s.personaId !== personaId || s.estado !== 'completada') continue;
    const e = s.ejercicios.find((x) => x.id === ejercicioId);
    if (!e) continue;
    const l = inicioSemana(s.fecha);
    const acum = mapa.get(l) ?? { kg: null, orm: null };
    for (const x of e.series) {
      if (!x.ok) continue;
      if (e.medida === 'reps' && x.kg > 0 && x.reps >= 1 && (acum.kg === null || x.kg > acum.kg)) acum.kg = x.kg;
      const o = e.medida === 'reps' ? epley(x.kg, x.reps) : null;
      if (o !== null && (acum.orm === null || o > acum.orm)) acum.orm = o;
    }
    mapa.set(l, acum);
  }
  return lunesDeCola(lunesFinal, n).map((lunes) => ({ lunes, kg: mapa.get(lunes)?.kg ?? null, orm: mapa.get(lunes)?.orm ?? null }));
}

/** Mejor marca por peso de cada ejercicio de la persona (sesiones completadas), la más reciente primero. */
export function mejoresMarcas(datos, personaId) {
  const mapa = new Map();
  for (const s of Object.values(datos.sesiones)) {
    if (s.personaId !== personaId || s.estado !== 'completada') continue;
    for (const e of s.ejercicios) {
      const m = mejorSeriePorPeso(e);
      if (!m) continue;
      const actual = mapa.get(e.id);
      const mejora = !actual || m.kg > actual.kg || (m.kg === actual.kg && (m.reps > actual.reps || (m.reps === actual.reps && s.fecha > actual.fecha)));
      if (mejora) mapa.set(e.id, { ejercicioId: e.id, nombre: e.nombre, personaId, kg: m.kg, reps: m.reps, fecha: s.fecha, orm: epley(m.kg, m.reps) });
    }
  }
  return [...mapa.values()].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : a.nombre < b.nombre ? -1 : 1));
}

/** Último peso corporal registrado en cada una de las últimas n semanas (null si no hubo). */
export function pesoCorporalPorSemana(datos, personaId, lunesFinal, n = 8) {
  const mapa = new Map();
  for (const p of datos.pesoCorporal) {
    if (p.personaId !== personaId) continue;
    const l = inicioSemana(p.fecha);
    const previo = mapa.get(l);
    if (!previo || p.fecha >= previo.fecha) mapa.set(l, p);
  }
  return lunesDeCola(lunesFinal, n).map((lunes) => ({ lunes, kg: mapa.get(lunes)?.kg ?? null }));
}

/** Lunes de las últimas n semanas (etiquetas de los ejes). */
export function lunesRecientes(lunesFinal, n = 8) {
  return lunesDeCola(lunesFinal, n);
}
