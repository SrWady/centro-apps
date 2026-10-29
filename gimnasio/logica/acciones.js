/*
 * acciones.js — mutaciones puras (datos, payload, ctx) → datosNuevos (docs/ESQUEMA-GIMNASIO.md §9).
 * NO mutan `datos` (comparten estructura con lo no modificado). Si la acción no aplica lanzan Error con mensaje en español.
 * ctx = { hoy, ahora, generarId } (lo construye la tienda).
 */
import { esNumero, esEntero, esFechaISO, esUno } from '../../shared/lib/validacion.js';
import { redondearA } from '../../shared/lib/numeros.js';
import { analizarIdSesion, idSesion, validarCierre, validarRutinaSuelta, errorDeSuperseries, INCREMENTOS_KG, PERSONAS_IDS, MAX_SERIES, LETRAS_SUPERSERIE } from './esquema.js';
import { sumarDias } from '../../shared/lib/fechas.js';
import { cerrarDiasPasados, congelarSesion, planDelDia, crearSesionSinIniciar } from './sesiones.js';

/* ---------- utilidades internas ---------- */

function conSesion(datos, sesion) {
  return { ...datos, sesiones: { ...datos.sesiones, [sesion.id]: sesion } };
}

function exigirSesionEnCurso(datos, sesionId) {
  const ses = datos.sesiones[sesionId];
  if (!ses || ses.estado === 'sin-iniciar') throw new Error('Esa sesión todavía no se ha iniciado.');
  if (ses.estado === 'completada') throw new Error('La sesión ya está completada y no se puede modificar.');
  return ses;
}

function exigirPersona(personaId) {
  if (!esUno(personaId, PERSONAS_IDS)) throw new Error('Persona desconocida.');
}

function exigirFecha(fecha) {
  if (!esFechaISO(fecha)) throw new Error('La fecha no es válida.');
}

function tocar(ses, ctx) {
  return { ...ses, ultimaActividadEn: ctx.ahora };
}

function mapEjercicio(ses, ejercicioId, fn) {
  let encontrado = false;
  const ejercicios = ses.ejercicios.map((e) => {
    if (e.id !== ejercicioId) return e;
    encontrado = true;
    return fn(e);
  });
  if (!encontrado) throw new Error('Ese ejercicio no está en la sesión.');
  return { ...ses, ejercicios };
}

/* ---------- ciclo de vida de la sesión ---------- */

/**
 * Quita los registros 'sin-iniciar' de hoy o del futuro y deja `generadoHasta` como máximo en ayer (R1-01, F-03).
 * Esos registros solo los crea el cierre de días con un reloj ADELANTADO que luego se corrigió: no contienen nada de la persona
 * (se vuelven a derivar de la rutina) y, mientras existan, hoy aparece "No realizado" sin botón Empezar. Nunca toca 'en-curso'
 * ni 'completada'. Sin cambios devuelve el mismo objeto.
 */
function limpiarFuturos(datos, hoy) {
  const ayer = sumarDias(hoy, -1);
  const futuros = Object.keys(datos.sesiones).filter((id) => datos.sesiones[id].estado === 'sin-iniciar' && datos.sesiones[id].fecha >= hoy);
  const previo = datos.control.generadoHasta;
  const bajar = previo !== null && previo > ayer;
  if (!futuros.length && !bajar) return datos;
  const sesiones = { ...datos.sesiones };
  for (const id of futuros) delete sesiones[id];
  return { ...datos, sesiones, control: { ...datos.control, generadoHasta: bajar ? ayer : previo } };
}

/**
 * Al abrir (y a medianoche, y tras importar o restaurar): limpia los 'sin-iniciar' de hoy o del futuro (reloj que estuvo
 * adelantado) y cierra los días pasados no iniciados (§5.2). Idempotente: sin cambios devuelve el mismo objeto.
 */
export function alAbrir(datos, _payload, ctx) {
  const limpio = limpiarFuturos(datos, ctx.hoy);
  const r = cerrarDiasPasados(limpio, ctx.hoy);
  if (!r) return limpio;
  return { ...limpio, sesiones: { ...limpio.sesiones, ...r.sesiones }, control: { ...limpio.control, generadoHasta: r.generadoHasta } };
}

/** { fecha, personaId }: crea la sesión en curso con copia congelada del día de rutina ACTUAL. */
export function iniciarSesion(datos, { fecha, personaId }, ctx) {
  exigirFecha(fecha);
  exigirPersona(personaId);
  if (fecha > ctx.hoy) throw new Error('No se puede iniciar una sesión de un día futuro.');
  const actual = datos.sesiones[idSesion(fecha, personaId)];
  if (actual && actual.estado === 'en-curso') return datos;
  if (actual && actual.estado === 'completada') throw new Error('Esa sesión ya está completada.');
  return conSesion(datos, congelarSesion(datos, fecha, personaId, ctx));
}

function validarCampoSerie(e, p) {
  if (p.kg !== undefined && !esNumero(p.kg, { min: 0, max: 500, decimales: 2 })) throw new Error('El peso debe estar entre 0 y 500 kg.');
  if (p.reps !== undefined) {
    if (e.medida !== 'reps') throw new Error('Este ejercicio se mide en segundos, no en repeticiones.');
    if (!esEntero(p.reps, { min: 0, max: 999 })) throw new Error('Las repeticiones deben estar entre 0 y 999.');
  }
  if (p.seg !== undefined) {
    if (e.medida !== 'segundos') throw new Error('Este ejercicio se mide en repeticiones, no en segundos.');
    if (!esEntero(p.seg, { min: 0, max: 999 })) throw new Error('Los segundos deben estar entre 0 y 999.');
  }
  if (p.rir !== undefined && p.rir !== null && !esEntero(p.rir, { min: 0, max: 5 })) throw new Error('El RIR debe estar entre 0 y 5.');
  if (p.ok !== undefined && typeof p.ok !== 'boolean') throw new Error('El estado de la serie no es válido.');
}

/**
 * { sesionId, ejercicioId, indice, kg?, reps?, seg?, rir?, ok? }. Solo sesiones en curso. Si la sesión no existe y es de hoy,
 * se inicia implícitamente.
 */
export function actualizarSerie(datos, p, ctx) {
  const id = analizarIdSesion(p.sesionId);
  if (!id) throw new Error('Sesión no válida.');
  let ses = datos.sesiones[p.sesionId];
  if (!ses || ses.estado === 'sin-iniciar') {
    if (id.fecha !== ctx.hoy || !planDelDia(datos.rutina, id.fecha)) throw new Error('Esa sesión todavía no se ha iniciado.');
    ses = congelarSesion(datos, id.fecha, id.personaId, ctx);
  }
  if (ses.estado === 'completada') throw new Error('La sesión ya está completada y no se puede modificar.');
  const nueva = mapEjercicio(ses, p.ejercicioId, (e) => {
    if (!Number.isInteger(p.indice) || p.indice < 0 || p.indice >= e.series.length) throw new Error('Esa serie no existe.');
    validarCampoSerie(e, p);
    const anterior = e.series[p.indice];
    const serie = { ...anterior };
    for (const k of ['kg', 'reps', 'seg', 'rir', 'ok']) if (p[k] !== undefined) serie[k] = p[k];
    // propagar: las series SIGUIENTES sin hacer que conservaban el peso anterior (sugerido y sin tocar) adoptan el nuevo.
    const propaga = p.propagar === true && p.kg !== undefined && p.kg !== anterior.kg;
    return {
      ...e,
      series: e.series.map((s, i) => {
        if (i === p.indice) return serie;
        return propaga && i > p.indice && !s.ok && s.kg === anterior.kg ? { ...s, kg: p.kg } : s;
      }),
    };
  });
  return conSesion(datos, tocar(nueva, ctx));
}

/**
 * { sesionId, ejercicioId, kg?, seg? }: fija el peso (y los segundos) de TODAS las series sin hacer del ejercicio
 * (botón "Usar X kg" de la sugerencia de progresión).
 */
export function aplicarSugerencia(datos, p, ctx) {
  const ses = exigirSesionEnCurso(datos, p.sesionId);
  const nueva = mapEjercicio(ses, p.ejercicioId, (e) => {
    validarCampoSerie(e, { kg: p.kg, seg: p.seg });
    return {
      ...e,
      series: e.series.map((s) => {
        if (s.ok) return s;
        const n = { ...s };
        if (p.kg !== undefined) n.kg = p.kg;
        if (p.seg !== undefined) n.seg = p.seg;
        return n;
      }),
    };
  });
  return conSesion(datos, tocar(nueva, ctx));
}

/** { sesionId, ejercicioId }: agrega una serie (copia la última, sin hacer). Máximo 10. */
export function agregarSerie(datos, p, ctx) {
  const ses = exigirSesionEnCurso(datos, p.sesionId);
  const nueva = mapEjercicio(ses, p.ejercicioId, (e) => {
    if (e.series.length >= MAX_SERIES) throw new Error(`Un ejercicio admite hasta ${MAX_SERIES} series.`);
    const ultima = e.series[e.series.length - 1];
    return { ...e, series: [...e.series, { ...ultima, rir: null, ok: false }] };
  });
  return conSesion(datos, tocar(nueva, ctx));
}

/** { sesionId, ejercicioId }: quita la última serie (mínimo 1). */
export function quitarUltimaSerie(datos, p, ctx) {
  const ses = exigirSesionEnCurso(datos, p.sesionId);
  const nueva = mapEjercicio(ses, p.ejercicioId, (e) => {
    if (e.series.length <= 1) throw new Error('Un ejercicio necesita al menos 1 serie.');
    return { ...e, series: e.series.slice(0, -1) };
  });
  return conSesion(datos, tocar(nueva, ctx));
}

/** { sesionId, minutos, km, velocidadKmH, inclinacionPct, ok } */
export function registrarCardio(datos, p, ctx) {
  const ses = exigirSesionEnCurso(datos, p.sesionId);
  if (!esEntero(p.minutos, { min: 0, max: 300 })) throw new Error('Los minutos de cardio deben estar entre 0 y 300.');
  const opcional = (v, max, nombre) => {
    if (v === null || v === undefined) return null;
    if (!esNumero(v, { min: 0, max, decimales: 2 })) throw new Error(`${nombre} debe estar entre 0 y ${max}.`);
    return v;
  };
  const cardio = {
    nombre: ses.cardioPlan ? ses.cardioPlan.nombre : 'Cardio',
    minutos: p.minutos,
    km: opcional(p.km, 100, 'La distancia'),
    velocidadKmH: opcional(p.velocidadKmH, 30, 'La velocidad'),
    inclinacionPct: opcional(p.inclinacionPct, 30, 'La inclinación'),
    ok: p.ok !== false,
  };
  return conSesion(datos, tocar({ ...ses, cardio }, ctx));
}

/** { sesionId, cierre }: pasa a 'completada' (solo lectura desde aquí). */
export function finalizarSesion(datos, p, ctx) {
  const ses = exigirSesionEnCurso(datos, p.sesionId);
  const v = validarCierre(p.cierre);
  if (!v.ok) throw new Error(v.errores[0].mensaje);
  return conSesion(datos, { ...ses, estado: 'completada', ultimaActividadEn: ses.ultimaActividadEn, finalizadaEn: ctx.ahora, cierre: v.cierre });
}

/** { sesionId }: descarta una sesión en curso sin ninguna serie hecha ni cardio (si es de un día pasado vuelve a 'sin-iniciar'). */
export function descartarSesion(datos, p, ctx) {
  const ses = exigirSesionEnCurso(datos, p.sesionId);
  const hayAvance = ses.ejercicios.some((e) => e.series.some((s) => s.ok)) || (ses.cardio && ses.cardio.ok);
  if (hayAvance) throw new Error('La sesión ya tiene series o cardio registrados: termínela en lugar de descartarla.');
  const { [ses.id]: _quitada, ...resto } = datos.sesiones;
  if (ses.fecha < ctx.hoy) {
    const dia = datos.rutina.dias.find((d) => d.id === ses.diaRutinaId) ?? { id: ses.diaRutinaId, nombre: ses.nombreDia };
    return { ...datos, sesiones: { ...resto, [ses.id]: crearSesionSinIniciar(ses.fecha, ses.personaId, dia) } };
  }
  return { ...datos, sesiones: resto };
}

/* ---------- rutina (no toca sesiones ya iniciadas ni el historial) ---------- */

/** Ejercicio nuevo por defecto (3 × 10–12, RIR 2, 90 s). */
export function crearEjercicioNuevo(ctx) {
  return {
    id: ctx.generarId('ej'), nombre: 'Nuevo ejercicio', medida: 'reps', series: 3, min: 10, max: 12, porLado: false,
    rir: { min: 2, max: 2 }, descansoSeg: 90, superserie: null, consejo: '', ajustes: {},
  };
}

function mensajeDeErrores(errores, dias) {
  const e = errores[0];
  const m = /dias\[(\d+)\](?:\.ejercicios\[(\d+)\])?/.exec(e.ruta);
  if (m) {
    const dia = dias[Number(m[1])];
    const ej = m[2] !== undefined && dia && Array.isArray(dia.ejercicios) ? dia.ejercicios[Number(m[2])] : null;
    if (ej && ej.nombre) return `${ej.nombre}: ${e.mensaje}`;
    if (dia && dia.nombre) return `${dia.nombre}: ${e.mensaje}`;
  }
  return e.mensaje;
}

function conRutina(datos, dias) {
  const ordenados = [...dias].sort((a, b) => a.diaSemana - b.diaSemana);
  const v = validarRutinaSuelta({ version: datos.rutina.version + 1, dias: ordenados });
  if (!v.ok) throw new Error(mensajeDeErrores(v.errores, ordenados));
  return { ...datos, rutina: v.rutina };
}

function exigirDia(datos, diaId) {
  const dia = datos.rutina.dias.find((d) => d.id === diaId);
  if (!dia) throw new Error('Ese día ya no existe en la rutina.');
  return dia;
}

function reemplazarDia(datos, dia) {
  return conRutina(datos, datos.rutina.dias.map((d) => (d.id === dia.id ? dia : d)));
}

const DESCANSO_SUELTO_SEG = 60;

/**
 * Quita la letra de las superseries que quedaron con menos de 2 miembros. En una superserie solo cuenta el descanso del último
 * (los demás van en 0): el que queda suelto hereda el descanso del compañero que se fue (o 60 s) para no quedarse sin
 * descanso entre series (R1-07).
 */
function limpiarHuerfanas(ejercicios, descansoHeredado = 0) {
  const cuenta = new Map();
  for (const e of ejercicios) if (e.superserie) cuenta.set(e.superserie, (cuenta.get(e.superserie) ?? 0) + 1);
  return ejercicios.map((e) => {
    if (!e.superserie || cuenta.get(e.superserie) >= 2) return e;
    return { ...e, superserie: null, descansoSeg: e.descansoSeg > 0 ? e.descansoSeg : descansoHeredado > 0 ? descansoHeredado : DESCANSO_SUELTO_SEG };
  });
}

/**
 * R2G-05: si al sacar o borrar un ejercicio una superserie queda partida en tramos (p. ej. A, —, A al quitar el miembro del medio
 * de un grupo de 3), cada tramo posterior toma una letra libre (o ninguna si no queda) en vez de dejar una letra con miembros
 * separados, que la validación rechaza. Los tramos de un solo ejercicio los limpia después `limpiarHuerfanas`.
 */
function separarGruposPartidos(ejercicios) {
  const usadas = new Set(ejercicios.map((e) => e.superserie).filter(Boolean));
  const ultimo = new Map(); // letra original → índice del último miembro visto
  const letraDelTramo = new Map(); // letra original → letra del tramo actual (puede ser otra, o null)
  return ejercicios.map((e, i) => {
    const letra = e.superserie;
    if (!letra) return e;
    if (!ultimo.has(letra)) {
      letraDelTramo.set(letra, letra);
    } else if (ultimo.get(letra) !== i - 1) {
      const libre = LETRAS_SUPERSERIE.find((l) => !usadas.has(l)) ?? null;
      if (libre) usadas.add(libre);
      letraDelTramo.set(letra, libre);
    }
    ultimo.set(letra, i);
    const nueva = letraDelTramo.get(letra);
    return nueva === letra ? e : { ...e, superserie: nueva };
  });
}

/**
 * Descanso de una superserie (el del último miembro cuenta, los demás van en 0): el mayor de sus miembros. 0 si no hay grupo.
 */
function descansoDelGrupo(ejercicios, letra) {
  if (!letra) return 0;
  return Math.max(0, ...ejercicios.filter((e) => e.superserie === letra).map((e) => e.descansoSeg ?? 0));
}

/**
 * R3G-07 / N3-05 / N3-08: tras SACAR o BORRAR un ejercicio de una superserie, todos los que eran de ella conservan su descanso
 * previo (p. ej. 75 s) y ninguno queda en 0 s por haber dejado de ser "uno de los del medio":
 *  - los tramos que siguen siendo superserie (al sacar al último de un trío, la pareja que queda) toman el descanso en su nuevo último;
 *  - los que quedan sueltos (huérfanos) heredan el descanso, y también el que salió si venía en 0.
 * `miembros`: ids de la superserie original; `descansoPrevio`: su descanso antes del cambio (0 = nunca tuvo: no se inventa uno).
 */
function repararTrasSalir(ejercicios, miembros, descansoPrevio) {
  let lista = separarGruposPartidos(ejercicios);
  for (const letra of new Set(lista.map((e) => e.superserie).filter(Boolean))) {
    const idx = lista.map((e, i) => (e.superserie === letra ? i : -1)).filter((i) => i >= 0);
    if (idx.length < 2 || !idx.some((i) => miembros.has(lista[i].id))) continue;
    const ultimo = idx[idx.length - 1];
    if (lista[ultimo].descansoSeg > 0) continue;
    const mayor = Math.max(descansoPrevio, ...idx.map((i) => lista[i].descansoSeg));
    if (mayor > 0) lista = lista.map((e, i) => (i === ultimo ? { ...e, descansoSeg: mayor } : e));
  }
  return limpiarHuerfanas(lista, descansoPrevio);
}

/**
 * Si el último miembro de la superserie `letra` quedó sin descanso pero otro miembro tiene (p. ej. al formar el par "con el
 * anterior", el que tenía el descanso quedó primero), el último toma el mayor descanso del grupo: es el único que cuenta (R1-07).
 */
function asegurarDescansoDelUltimo(ejercicios, letra) {
  const idx = ejercicios.map((e, i) => (e.superserie === letra ? i : -1)).filter((i) => i >= 0);
  if (idx.length < 2) return ejercicios;
  const ultimo = idx[idx.length - 1];
  if (ejercicios[ultimo].descansoSeg > 0) return ejercicios;
  const mayor = Math.max(...idx.map((i) => ejercicios[i].descansoSeg));
  return mayor > 0 ? ejercicios.map((e, i) => (i === ultimo ? { ...e, descansoSeg: mayor } : e)) : ejercicios;
}

/**
 * { dia: { id?, diaSemana, nombre, calentamiento, cardio, ejercicios? } }: crea o actualiza el día. Un día nuevo sin
 * ejercicios recibe uno por defecto (un día necesita al menos uno).
 */
export function guardarDiaRutina(datos, { dia }, ctx) {
  const existente = dia.id ? datos.rutina.dias.find((d) => d.id === dia.id) : null;
  const nuevo = {
    id: existente ? existente.id : dia.id ?? ctx.generarId('dia'),
    diaSemana: dia.diaSemana,
    nombre: dia.nombre,
    calentamiento: dia.calentamiento ?? '',
    cardio: dia.cardio === undefined ? existente?.cardio ?? null : dia.cardio,
    ejercicios: dia.ejercicios ?? existente?.ejercicios ?? [crearEjercicioNuevo(ctx)],
  };
  const choque = datos.rutina.dias.find((d) => d.diaSemana === nuevo.diaSemana && d.id !== nuevo.id);
  if (choque) throw new Error(`Ese día de la semana ya tiene rutina ("${choque.nombre}").`);
  return conRutina(datos, existente ? datos.rutina.dias.map((d) => (d.id === nuevo.id ? nuevo : d)) : [...datos.rutina.dias, nuevo]);
}

/** { diaId } */
export function borrarDiaRutina(datos, { diaId }) {
  exigirDia(datos, diaId);
  return conRutina(datos, datos.rutina.dias.filter((d) => d.id !== diaId));
}

/**
 * { diaId, ejercicio, companeroId? }: agrega o reemplaza un ejercicio (por id; sin id se crea uno). Con `companeroId` y una letra
 * de superserie, el compañero adopta la misma letra (así se crea una superserie de una sola vez).
 */
export function guardarEjercicio(datos, { diaId, ejercicio, companeroId }, ctx) {
  const dia = exigirDia(datos, diaId);
  const id = ejercicio.id ?? ctx.generarId('ej');
  let nuevo = { ...ejercicio, id };
  let ejercicios = [...dia.ejercicios];
  const i = ejercicios.findIndex((e) => e.id === id);
  // R3G-07 / N3-05: si sale de su superserie, el descanso que ella tenía se conserva (él y los que quedan no se quedan en 0 s).
  const letraAntes = i >= 0 ? dia.ejercicios[i].superserie : null;
  const salida = !!letraAntes && nuevo.superserie !== letraAntes;
  const descansoPrevio = salida ? descansoDelGrupo(dia.ejercicios, letraAntes) : 0;
  const miembros = new Set(salida ? dia.ejercicios.filter((e) => e.superserie === letraAntes).map((e) => e.id) : []);
  if (salida && !nuevo.superserie && !(nuevo.descansoSeg > 0) && descansoPrevio > 0) nuevo = { ...nuevo, descansoSeg: descansoPrevio };
  if (i >= 0) ejercicios[i] = nuevo;
  else ejercicios.push(nuevo);
  if (companeroId && nuevo.superserie) {
    ejercicios = ejercicios.map((e) => (e.id === companeroId ? { ...e, superserie: nuevo.superserie } : e));
    // R1-06: el compañero que tenía antes (otra letra) puede haber quedado solo: se le quita la letra en vez de fallar.
    ejercicios = asegurarDescansoDelUltimo(limpiarHuerfanas(separarGruposPartidos(ejercicios)), nuevo.superserie);
  } else if (!nuevo.superserie) {
    ejercicios = salida ? repararTrasSalir(ejercicios, miembros, descansoPrevio) : limpiarHuerfanas(separarGruposPartidos(ejercicios), nuevo.descansoSeg);
  }
  return reemplazarDia(datos, { ...dia, ejercicios });
}

/** { diaId, ejercicioId }: quita el ejercicio (el historial y los récords de ese id se conservan en las sesiones). */
export function borrarEjercicio(datos, { diaId, ejercicioId }) {
  const dia = exigirDia(datos, diaId);
  if (!dia.ejercicios.some((e) => e.id === ejercicioId)) throw new Error('Ese ejercicio ya no existe.');
  if (dia.ejercicios.length <= 1) throw new Error('Un día necesita al menos un ejercicio. Borre el día completo si ya no lo usa.');
  const quitado = dia.ejercicios.find((e) => e.id === ejercicioId);
  // R3G-07 / N3-08: si era de una superserie, los que quedan conservan el descanso de ella (el último de un trío es el único que lo tiene).
  const descansoPrevio = Math.max(quitado.descansoSeg ?? 0, descansoDelGrupo(dia.ejercicios, quitado.superserie));
  const miembros = new Set(quitado.superserie ? dia.ejercicios.filter((e) => e.superserie === quitado.superserie).map((e) => e.id) : []);
  const resto = dia.ejercicios.filter((e) => e.id !== ejercicioId);
  return reemplazarDia(datos, { ...dia, ejercicios: quitado.superserie ? repararTrasSalir(resto, miembros, descansoPrevio) : limpiarHuerfanas(separarGruposPartidos(resto), quitado.descansoSeg) });
}

/** { diaId, ejercicioId, haciaIndice } */
export function moverEjercicio(datos, { diaId, ejercicioId, haciaIndice }) {
  const dia = exigirDia(datos, diaId);
  const desde = dia.ejercicios.findIndex((e) => e.id === ejercicioId);
  if (desde < 0) throw new Error('Ese ejercicio ya no existe.');
  if (!Number.isInteger(haciaIndice) || haciaIndice < 0 || haciaIndice >= dia.ejercicios.length) throw new Error('Esa posición no existe.');
  if (desde === haciaIndice) return datos;
  const ejercicios = [...dia.ejercicios];
  const [movido] = ejercicios.splice(desde, 1);
  ejercicios.splice(haciaIndice, 0, movido);
  const error = errorDeSuperseries(ejercicios);
  if (error) throw new Error(`No se puede mover ahí: ${error[0].toLowerCase()}${error.slice(1)}`);
  return reemplazarDia(datos, { ...dia, ejercicios });
}

/** { rutina }: reemplaza la rutina completa (restaurar la original). version = anterior + 1. */
export function restaurarRutina(datos, { rutina }) {
  return conRutina(datos, rutina.dias);
}

/* ---------- peso corporal y ajustes ---------- */

/** { personaId, fecha, kg }: upsert por (persona, fecha). */
export function registrarPesoCorporal(datos, { personaId, fecha, kg }, ctx) {
  exigirPersona(personaId);
  exigirFecha(fecha);
  if (fecha > ctx.hoy) throw new Error('No se puede registrar el peso de un día futuro.');
  if (typeof kg !== 'number' || !Number.isFinite(kg)) throw new Error('Escriba el peso corporal.');
  const valor = redondearA(kg, 1);
  if (!esNumero(valor, { min: 20, max: 300 })) throw new Error('El peso corporal debe estar entre 20 y 300 kg.');
  const existente = datos.pesoCorporal.find((p) => p.personaId === personaId && p.fecha === fecha);
  const registro = { id: existente ? existente.id : ctx.generarId('pc'), personaId, fecha, kg: valor };
  const lista = existente ? datos.pesoCorporal.map((p) => (p === existente ? registro : p)) : [...datos.pesoCorporal, registro];
  return { ...datos, pesoCorporal: lista.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.personaId < b.personaId ? -1 : 1)) };
}

/** { id } */
export function borrarPesoCorporal(datos, { id }) {
  if (!datos.pesoCorporal.some((p) => p.id === id)) throw new Error('Ese registro ya no existe.');
  return { ...datos, pesoCorporal: datos.pesoCorporal.filter((p) => p.id !== id) };
}

/** { nombres?: { p1, p2 }, incrementoKg? } */
export function guardarAjustes(datos, { nombres, incrementoKg }) {
  let personas = datos.ajustes.personas;
  if (nombres !== undefined) {
    personas = datos.ajustes.personas.map((p) => {
      const nombre = typeof nombres[p.id] === 'string' ? nombres[p.id].trim() : p.nombre;
      if (nombre.length < 1 || nombre.length > 30) throw new Error('El nombre debe tener entre 1 y 30 caracteres.');
      return { ...p, nombre };
    });
    if (personas[0].nombre.toLowerCase() === personas[1].nombre.toLowerCase()) throw new Error('Los dos nombres deben ser distintos.');
  }
  let incremento = datos.ajustes.incrementoKg;
  if (incrementoKg !== undefined) {
    if (!esUno(incrementoKg, INCREMENTOS_KG)) throw new Error('El incremento debe ser 1, 2, 2,5 o 5 kg.');
    incremento = incrementoKg;
  }
  return { ...datos, ajustes: { ...datos.ajustes, personas, incrementoKg: incremento } };
}
