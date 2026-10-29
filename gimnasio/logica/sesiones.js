/*
 * sesiones.js — plan del día, congelado, estados, cierre de días pasados y orden de las series (PURO).
 * Hoy y el futuro se DERIVAN de la rutina; solo se guarda una sesión al iniciarla (copia congelada) o al cerrar
 * un día no iniciado. Ver docs/ESQUEMA-GIMNASIO.md §5–§6.
 */
import { diaSemana, sumarDias, diferenciaDias, rangoFechas } from '../../shared/lib/fechas.js';
import { idSesion, PERSONAS_IDS } from './esquema.js';

export { idSesion };

export const TOPE_DIAS_CIERRE = 370;

/** Día de rutina que cae en esa fecha (según el día de la semana) o null. */
export function planDelDia(rutina, fecha) {
  const dow = diaSemana(fecha);
  return rutina.dias.find((d) => d.diaSemana === dow) ?? null;
}

/** Ejercicio de la rutina con el ajuste de esa persona aplicado (series, reps, RIR, descanso, nota). */
export function ejercicioEfectivo(ej, personaId) {
  const a = (ej.ajustes && ej.ajustes[personaId]) || {};
  const min = a.min ?? ej.min;
  let max = a.max ?? ej.max;
  if (min > max) max = min;
  return {
    id: ej.id, nombre: ej.nombre, medida: ej.medida, porLado: ej.porLado, superserie: ej.superserie ?? null,
    series: a.series ?? ej.series, min, max,
    rir: a.rir ?? ej.rir ?? null,
    descansoSeg: a.descansoSeg ?? ej.descansoSeg,
    nota: a.nota ?? '',
    consejo: ej.consejo ?? '',
  };
}

/**
 * ¿La serie cuenta como hecha de verdad? Marcada Y con al menos 1 repetición (o 1 segundo): un intento fallido anotado con 0 no es
 * referencia para precargar la sesión siguiente ni para la progresión (R2G-04; ya no cuenta como récord desde R1-04).
 */
export function serieValida(ejercicio, serie) {
  const v = ejercicio.medida === 'segundos' ? serie.seg : serie.reps;
  return !!serie.ok && v >= 1;
}

/** Última sesión COMPLETADA de la persona, anterior a `fecha`, que contenga el ejercicio con alguna serie hecha. */
export function sesionAnterior(datos, personaId, ejercicioId, fecha) {
  let mejor = null;
  for (const s of Object.values(datos.sesiones)) {
    if (s.personaId !== personaId || s.estado !== 'completada' || s.fecha >= fecha) continue;
    const ejercicio = s.ejercicios.find((e) => e.id === ejercicioId);
    if (!ejercicio || !ejercicio.series.some((x) => serieValida(ejercicio, x))) continue;
    if (!mejor || s.fecha > mejor.sesion.fecha) mejor = { sesion: s, ejercicio };
  }
  return mejor;
}

/**
 * Valores de la serie n: la serie n hecha la vez anterior; si no, su última serie hecha; si no hay historial (o la medida
 * cambió), kg 0 y el TOPE del rango (decisión del orquestador Q4; el esquema decía el mínimo). Nunca NaN.
 */
export function valorSugerido(previa, ef, n) {
  const mismoTipo = previa && previa.ejercicio.medida === ef.medida;
  const campo = ef.medida === 'segundos' ? 'seg' : 'reps';
  if (!mismoTipo) return { kg: 0, valor: ef.max };
  const validas = previa.ejercicio.series.filter((s) => serieValida(previa.ejercicio, s)); // R2G-04: una serie de 0 repeticiones es como no hecha
  const igual = previa.ejercicio.series[n];
  const base = igual && serieValida(previa.ejercicio, igual) ? igual : validas[validas.length - 1];
  if (!base) return { kg: 0, valor: ef.max };
  return { kg: base.kg, valor: base[campo] };
}

function crearSerie(ef, sugerido) {
  return ef.medida === 'segundos'
    ? { kg: sugerido.kg, seg: sugerido.valor, rir: null, ok: false }
    : { kg: sugerido.kg, reps: sugerido.valor, rir: null, ok: false };
}

function copiarCardioPlan(c) {
  return c ? { ...c, velocidadKmH: c.velocidadKmH ? { ...c.velocidadKmH } : null, inclinacionPct: c.inclinacionPct ? { ...c.inclinacionPct } : null } : null;
}

/**
 * Sesión 'en-curso' con la copia CONGELADA del día de rutina actual, combinada con el ajuste de la persona y con las
 * series precargadas con los valores sugeridos (§6). Lanza Error si ese día no tiene rutina.
 */
export function congelarSesion(datos, fecha, personaId, ctx) {
  const dia = planDelDia(datos.rutina, fecha);
  if (!dia) throw new Error('Ese día no tiene rutina programada.');
  const ejercicios = dia.ejercicios.map((e) => {
    const ef = ejercicioEfectivo(e, personaId);
    const previa = sesionAnterior(datos, personaId, ef.id, fecha);
    return {
      id: ef.id, nombre: ef.nombre, medida: ef.medida, min: ef.min, max: ef.max, porLado: ef.porLado,
      rir: ef.rir ? { ...ef.rir } : null, descansoSeg: ef.descansoSeg, superserie: ef.superserie, nota: ef.nota,
      series: Array.from({ length: ef.series }, (_, n) => crearSerie(ef, valorSugerido(previa, ef, n))),
    };
  });
  return {
    id: idSesion(fecha, personaId), fecha, personaId, estado: 'en-curso',
    diaRutinaId: dia.id, nombreDia: dia.nombre, rutinaVersion: datos.rutina.version,
    iniciadaEn: ctx.ahora, ultimaActividadEn: ctx.ahora, finalizadaEn: null,
    calentamiento: dia.calentamiento, ejercicios, cardioPlan: copiarCardioPlan(dia.cardio), cardio: null, cierre: null,
  };
}

/** Registro 'sin-iniciar' (deja fija la programación pasada). */
export function crearSesionSinIniciar(fecha, personaId, dia) {
  return { id: idSesion(fecha, personaId), fecha, personaId, estado: 'sin-iniciar', diaRutinaId: dia.id, nombreDia: dia.nombre };
}

/**
 * Estado derivado de un día para una persona.
 * → { estado: 'pendiente'|'en-curso'|'completada'|'perdida'|'descanso'|'previo', sesion, dia }
 *   (previo = antes de la fecha de inicio de uso; descanso = sin rutina ese día de la semana o día pasado sin registro).
 */
export function estadoDelDia(datos, fecha, personaId, hoy) {
  const registro = datos.sesiones[idSesion(fecha, personaId)] ?? null;
  // R1-01: un 'sin-iniciar' de hoy o del futuro (quedó de cuando el reloj estaba adelantado) no cuenta como registro: aún no pasó.
  const sesion = registro && registro.estado === 'sin-iniciar' && registro.fecha >= hoy ? null : registro;
  if (sesion) {
    if (sesion.estado === 'completada') return { estado: 'completada', sesion, dia: null };
    if (sesion.estado === 'en-curso') return { estado: 'en-curso', sesion, dia: null };
    return { estado: 'perdida', sesion, dia: datos.rutina.dias.find((d) => d.id === sesion.diaRutinaId) ?? null };
  }
  const dia = planDelDia(datos.rutina, fecha);
  if (fecha < datos.ajustes.fechaInicio) return { estado: 'previo', sesion: null, dia: null };
  if (!dia) return { estado: 'descanso', sesion: null, dia: null };
  // Un día PASADO sin registro no estaba programado cuando se cerró (la rutina cambió después): no se reescribe el historial.
  if (fecha < hoy) return { estado: 'descanso', sesion: null, dia: null };
  return { estado: 'pendiente', sesion: null, dia };
}

/**
 * Cierre de días pasados (§5.2). → { sesiones, generadoHasta } con las sesiones nuevas a agregar, o null si no hay cambio.
 * Idempotente. Tope de seguridad: 370 días hacia atrás.
 */
export function cerrarDiasPasados(datos, hoy) {
  const hasta = sumarDias(hoy, -1);
  const previo = datos.control.generadoHasta;
  if (previo !== null && previo >= hasta) return null;
  let desde = previo === null ? datos.ajustes.fechaInicio : sumarDias(previo, 1);
  if (desde < datos.ajustes.fechaInicio) desde = datos.ajustes.fechaInicio;
  if (diferenciaDias(desde, hasta) > TOPE_DIAS_CIERRE) desde = sumarDias(hasta, -TOPE_DIAS_CIERRE);
  const nuevas = {};
  if (desde <= hasta) {
    for (const fecha of rangoFechas(desde, hasta)) {
      const dia = planDelDia(datos.rutina, fecha);
      if (!dia) continue;
      for (const p of PERSONAS_IDS) {
        const id = idSesion(fecha, p);
        if (!datos.sesiones[id]) nuevas[id] = crearSesionSinIniciar(fecha, p, dia);
      }
    }
  }
  return { sesiones: nuevas, generadoHasta: hasta };
}

/* ---------- orden de ejecución, foco y descanso (§5.4) ---------- */

/** Orden real de las series: ejercicios en secuencia; una superserie alterna ronda a ronda (A1·1, A2·1, A1·2, A2·2…). */
export function ordenDeSeries(sesion) {
  const orden = [];
  const ejs = sesion.ejercicios;
  let i = 0;
  while (i < ejs.length) {
    const letra = ejs[i].superserie;
    if (!letra) {
      ejs[i].series.forEach((_, n) => orden.push({ ejercicioId: ejs[i].id, indice: n }));
      i += 1;
      continue;
    }
    let fin = i;
    while (fin + 1 < ejs.length && ejs[fin + 1].superserie === letra) fin += 1;
    const rondas = Math.max(...ejs.slice(i, fin + 1).map((e) => e.series.length));
    for (let r = 0; r < rondas; r += 1) {
      for (let m = i; m <= fin; m += 1) if (r < ejs[m].series.length) orden.push({ ejercicioId: ejs[m].id, indice: r });
    }
    i = fin + 1;
  }
  return orden;
}

function serieDe(sesion, ref) {
  const e = sesion.ejercicios.find((x) => x.id === ref.ejercicioId);
  return e ? e.series[ref.indice] : undefined;
}

/** Primera serie sin hacer en el orden de ejecución, o null si todo está hecho. */
export function primerPendiente(sesion) {
  return ordenDeSeries(sesion).find((ref) => !serieDe(sesion, ref)?.ok) ?? null;
}

/** Serie a enfocar después de (ejercicioId, indice): la siguiente sin hacer en el orden de ejecución (da la vuelta). */
export function siguienteFoco(sesion, ejercicioId, indice) {
  const orden = ordenDeSeries(sesion);
  const pos = orden.findIndex((r) => r.ejercicioId === ejercicioId && r.indice === indice);
  for (let k = 1; k <= orden.length; k += 1) {
    const ref = orden[(pos + k + orden.length) % orden.length];
    if (pos >= 0 && ref.ejercicioId === ejercicioId && ref.indice === indice) continue;
    if (!serieDe(sesion, ref)?.ok) return ref;
  }
  return null;
}

/** Miembros consecutivos de la superserie que contiene a `i`, o null. */
export function grupoSuperserie(ejercicios, i) {
  const letra = ejercicios[i]?.superserie;
  if (!letra) return null;
  let inicio = i;
  let fin = i;
  while (inicio > 0 && ejercicios[inicio - 1].superserie === letra) inicio -= 1;
  while (fin + 1 < ejercicios.length && ejercicios[fin + 1].superserie === letra) fin += 1;
  return { inicio, fin, letra };
}

/**
 * Segundos de descanso tras marcar una serie de `ejercicioId`: 0 si es un miembro de superserie que NO es el último
 * (se pasa directo al siguiente), o su propio descanso si no.
 * Con `indice` (R1-08, superserie desigual): si ningún miembro posterior tiene esa ronda (p. ej. A tiene 4 series y B solo 3),
 * la serie es la última de su ronda y descansa lo que descansa el último miembro del grupo.
 */
export function descansoTrasSerie(sesion, ejercicioId, indice) {
  const i = sesion.ejercicios.findIndex((e) => e.id === ejercicioId);
  if (i < 0) return 0;
  const g = grupoSuperserie(sesion.ejercicios, i);
  if (g && i < g.fin) {
    const hayDespues = indice === undefined || sesion.ejercicios.slice(i + 1, g.fin + 1).some((e) => e.series.length > indice);
    return hayDespues ? 0 : sesion.ejercicios[g.fin].descansoSeg;
  }
  return sesion.ejercicios[i].descansoSeg;
}

/**
 * Consejo técnico de un ejercicio de una sesión (F-01). La sesión congelada no lo copia (no es un dato de entrenamiento y
 * ocuparía espacio en cada sesión): se lee de la rutina actual por id, primero del día de la sesión. '' si ya no existe.
 */
export function consejoDeEjercicio(datos, sesion, ejercicioId) {
  const dias = datos.rutina.dias;
  const dia = dias.find((d) => d.id === sesion.diaRutinaId);
  const e = (dia ? dia.ejercicios : dias.flatMap((d) => d.ejercicios)).find((x) => x.id === ejercicioId);
  return e && typeof e.consejo === 'string' ? e.consejo : '';
}
