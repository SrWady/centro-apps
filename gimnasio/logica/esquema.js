/*
 * esquema.js — versión, validación y resumen de los datos de Gimnasio (docs/ESQUEMA-GIMNASIO.md §10).
 * PURO: sin DOM, localStorage ni reloj. validar() devuelve una COPIA saneada (solo campos conocidos, textos recortados)
 * y acumula todos los errores con su ruta; los campos desconocidos se descartan con aviso.
 */
import {
  crearContexto, esObjetoPlano, esEntero, esNumero, esTexto, esFechaISO, esInstanteISO, esId, esUno, tomarCampos,
} from '../../shared/lib/validacion.js';

export const VERSION = 1;
export const APP = 'gimnasio';
export const migraciones = {};

export const PERSONAS_IDS = Object.freeze(['p1', 'p2']);
export const INCREMENTOS_KG = Object.freeze([1, 2, 2.5, 5]);
export const LETRAS_SUPERSERIE = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F']);
export const MEDIDAS = Object.freeze(['reps', 'segundos']);
export const ESTADOS_SESION = Object.freeze(['sin-iniciar', 'en-curso', 'completada']);
export const MAX_SERIES = 10;
export const MAX_EJERCICIOS_DIA = 20;

const PATRON_ID_SESION = /^ses-(\d{4}-\d{2}-\d{2})-(p[12])$/;

/** 'ses-2026-11-02-p1' → { fecha, personaId } | null */
export function analizarIdSesion(id) {
  const m = typeof id === 'string' ? PATRON_ID_SESION.exec(id) : null;
  return m && esFechaISO(m[1]) ? { fecha: m[1], personaId: m[2] } : null;
}

export function idSesion(fecha, personaId) {
  return `ses-${fecha}-${personaId}`;
}

/* ---------- piezas ---------- */

function leerTexto(ctx, ruta, v, { min = 0, max, nombre = 'El texto' }) {
  if (!esTexto(v, { min, max })) {
    ctx.error(ruta, min > 0 ? `${nombre} es obligatorio y admite hasta ${max} caracteres.` : `${nombre} admite hasta ${max} caracteres.`);
    return '';
  }
  return v.trim();
}

function leerEntero(ctx, ruta, v, { min, max, nombre }) {
  if (!esEntero(v, { min, max })) {
    ctx.error(ruta, `${nombre} debe ser un entero entre ${min} y ${max}.`);
    return min;
  }
  return v;
}

function leerRango(ctx, ruta, v, { min, max, decimales, nombre, nulo = false }) {
  if (v === null && nulo) return null;
  if (!esObjetoPlano(v)) {
    ctx.error(ruta, `${nombre} debe tener mínimo y máximo.`);
    return null;
  }
  const c = tomarCampos(v, ['min', 'max'], ctx, ruta);
  const opt = { min, max, decimales };
  if (!esNumero(c.min, opt) || !esNumero(c.max, opt)) {
    ctx.error(ruta, `${nombre}: valores entre ${min} y ${max}.`);
    return { min, max: min };
  }
  if (c.min > c.max) ctx.error(ruta, `${nombre}: el mínimo no puede superar el máximo.`);
  return { min: c.min, max: c.max };
}

/** Mensaje de error de superseries del día o null: los miembros de una letra deben ser consecutivos y ser ≥ 2. */
export function errorDeSuperseries(ejercicios) {
  const posiciones = new Map();
  ejercicios.forEach((e, i) => {
    if (e.superserie) {
      if (!posiciones.has(e.superserie)) posiciones.set(e.superserie, []);
      posiciones.get(e.superserie).push(i);
    }
  });
  for (const [letra, idx] of posiciones) {
    if (idx.length < 2) return `La superserie ${letra} necesita al menos 2 ejercicios seguidos.`;
    if (idx[idx.length - 1] - idx[0] + 1 !== idx.length) return `Los ejercicios de la superserie ${letra} deben estar seguidos.`;
  }
  return null;
}

/* ---------- rutina ---------- */

const CAMPOS_AJUSTE = ['series', 'min', 'max', 'rir', 'descansoSeg', 'nota'];
const CAMPOS_EJERCICIO = ['id', 'nombre', 'medida', 'series', 'min', 'max', 'porLado', 'rir', 'descansoSeg', 'superserie', 'consejo', 'ajustes'];

function validarAjustePersona(ctx, ruta, a) {
  const c = tomarCampos(a, CAMPOS_AJUSTE, ctx, ruta);
  const salida = {};
  if (c.series !== undefined) salida.series = leerEntero(ctx, `${ruta}.series`, c.series, { min: 1, max: MAX_SERIES, nombre: 'Las series' });
  if (c.min !== undefined) salida.min = leerEntero(ctx, `${ruta}.min`, c.min, { min: 1, max: 999, nombre: 'El mínimo' });
  if (c.max !== undefined) salida.max = leerEntero(ctx, `${ruta}.max`, c.max, { min: 1, max: 999, nombre: 'El máximo' });
  if (salida.min !== undefined && salida.max !== undefined && salida.min > salida.max) ctx.error(ruta, 'El mínimo no puede superar el máximo.');
  if (c.rir !== undefined) salida.rir = leerRango(ctx, `${ruta}.rir`, c.rir, { min: 0, max: 5, decimales: 0, nombre: 'El RIR' });
  if (c.descansoSeg !== undefined) salida.descansoSeg = leerEntero(ctx, `${ruta}.descansoSeg`, c.descansoSeg, { min: 0, max: 600, nombre: 'El descanso' });
  if (c.nota !== undefined) salida.nota = leerTexto(ctx, `${ruta}.nota`, c.nota, { max: 300, nombre: 'La nota' });
  return salida;
}

export function validarEjercicioRutina(ctx, ruta, e) {
  const c = tomarCampos(e, CAMPOS_EJERCICIO, ctx, ruta);
  const salida = {};
  if (!esId(c.id)) ctx.error(`${ruta}.id`, 'El identificador del ejercicio no es válido.');
  salida.id = c.id;
  salida.nombre = leerTexto(ctx, `${ruta}.nombre`, c.nombre, { min: 1, max: 60, nombre: 'El nombre' });
  if (!esUno(c.medida, MEDIDAS)) ctx.error(`${ruta}.medida`, 'La medida debe ser repeticiones o segundos.');
  salida.medida = c.medida;
  salida.series = leerEntero(ctx, `${ruta}.series`, c.series, { min: 1, max: MAX_SERIES, nombre: 'Las series' });
  salida.min = leerEntero(ctx, `${ruta}.min`, c.min, { min: 1, max: 999, nombre: 'El mínimo' });
  salida.max = leerEntero(ctx, `${ruta}.max`, c.max, { min: 1, max: 999, nombre: 'El máximo' });
  if (salida.min > salida.max) ctx.error(ruta, 'El mínimo no puede superar el máximo.');
  if (typeof c.porLado !== 'boolean') ctx.error(`${ruta}.porLado`, 'porLado debe ser verdadero o falso.');
  salida.porLado = c.porLado === true;
  salida.rir = leerRango(ctx, `${ruta}.rir`, c.rir, { min: 0, max: 5, decimales: 0, nombre: 'El RIR', nulo: true });
  salida.descansoSeg = leerEntero(ctx, `${ruta}.descansoSeg`, c.descansoSeg, { min: 0, max: 600, nombre: 'El descanso' });
  if (c.superserie !== null && !esUno(c.superserie, LETRAS_SUPERSERIE)) ctx.error(`${ruta}.superserie`, 'La superserie debe ser una letra de la A a la F.');
  salida.superserie = c.superserie ?? null;
  salida.consejo = leerTexto(ctx, `${ruta}.consejo`, c.consejo ?? '', { max: 300, nombre: 'El consejo' });
  salida.ajustes = {};
  if (c.ajustes !== undefined) {
    if (!esObjetoPlano(c.ajustes)) ctx.error(`${ruta}.ajustes`, 'Los ajustes por persona deben ser un objeto.');
    else {
      for (const clave of Object.keys(c.ajustes)) {
        if (!esUno(clave, PERSONAS_IDS)) ctx.aviso(`${ruta}.ajustes.${clave}`, 'Persona desconocida descartada.');
        else salida.ajustes[clave] = validarAjustePersona(ctx, `${ruta}.ajustes.${clave}`, c.ajustes[clave]);
      }
    }
  }
  return salida;
}

export function validarCardioPlan(ctx, ruta, c) {
  if (c === null) return null;
  const v = tomarCampos(c, ['nombre', 'minutos', 'velocidadKmH', 'inclinacionPct', 'nota'], ctx, ruta);
  return {
    nombre: leerTexto(ctx, `${ruta}.nombre`, v.nombre, { min: 1, max: 60, nombre: 'El nombre del cardio' }),
    minutos: leerEntero(ctx, `${ruta}.minutos`, v.minutos, { min: 1, max: 180, nombre: 'Los minutos' }),
    velocidadKmH: leerRango(ctx, `${ruta}.velocidadKmH`, v.velocidadKmH ?? null, { min: 0, max: 30, decimales: 2, nombre: 'La velocidad', nulo: true }),
    inclinacionPct: leerRango(ctx, `${ruta}.inclinacionPct`, v.inclinacionPct ?? null, { min: 0, max: 30, decimales: 2, nombre: 'La inclinación', nulo: true }),
    nota: leerTexto(ctx, `${ruta}.nota`, v.nota ?? '', { max: 300, nombre: 'La nota' }),
  };
}

export function validarDiaRutina(ctx, ruta, d) {
  const c = tomarCampos(d, ['id', 'diaSemana', 'nombre', 'calentamiento', 'ejercicios', 'cardio'], ctx, ruta);
  if (!esId(c.id)) ctx.error(`${ruta}.id`, 'El identificador del día no es válido.');
  const salida = {
    id: c.id,
    diaSemana: leerEntero(ctx, `${ruta}.diaSemana`, c.diaSemana, { min: 1, max: 7, nombre: 'El día de la semana' }),
    nombre: leerTexto(ctx, `${ruta}.nombre`, c.nombre, { min: 1, max: 60, nombre: 'El nombre del día' }),
    calentamiento: leerTexto(ctx, `${ruta}.calentamiento`, c.calentamiento ?? '', { max: 200, nombre: 'El calentamiento' }),
    ejercicios: [],
    cardio: validarCardioPlan(ctx, `${ruta}.cardio`, c.cardio ?? null),
  };
  if (!Array.isArray(c.ejercicios) || c.ejercicios.length < 1 || c.ejercicios.length > MAX_EJERCICIOS_DIA) {
    ctx.error(`${ruta}.ejercicios`, `Un día debe tener entre 1 y ${MAX_EJERCICIOS_DIA} ejercicios.`);
  } else {
    salida.ejercicios = c.ejercicios.map((e, i) => validarEjercicioRutina(ctx, `${ruta}.ejercicios[${i}]`, e));
    const errorSuper = errorDeSuperseries(salida.ejercicios);
    if (errorSuper) ctx.error(`${ruta}.ejercicios`, errorSuper);
  }
  return salida;
}

export function validarRutina(ctx, ruta, r) {
  const c = tomarCampos(r, ['version', 'dias'], ctx, ruta);
  const salida = { version: leerEntero(ctx, `${ruta}.version`, c.version, { min: 1, max: 1e9, nombre: 'La versión de la rutina' }), dias: [] };
  if (!Array.isArray(c.dias) || c.dias.length > 7) {
    ctx.error(`${ruta}.dias`, 'La rutina admite hasta 7 días.');
    return salida;
  }
  salida.dias = c.dias.map((d, i) => validarDiaRutina(ctx, `${ruta}.dias[${i}]`, d));
  const diasSemana = new Set();
  const idsDias = new Set();
  const idsEjercicios = new Set();
  salida.dias.forEach((d, i) => {
    if (diasSemana.has(d.diaSemana)) ctx.error(`${ruta}.dias[${i}].diaSemana`, 'Dos días de la rutina no pueden caer el mismo día de la semana.');
    diasSemana.add(d.diaSemana);
    if (idsDias.has(d.id)) ctx.error(`${ruta}.dias[${i}].id`, 'Hay dos días con el mismo identificador.');
    idsDias.add(d.id);
    d.ejercicios.forEach((e, j) => {
      if (idsEjercicios.has(e.id)) ctx.error(`${ruta}.dias[${i}].ejercicios[${j}].id`, 'Hay dos ejercicios con el mismo identificador.');
      idsEjercicios.add(e.id);
    });
  });
  return salida;
}

/** Valida una rutina suelta (acciones de edición). → { ok, rutina, errores } */
export function validarRutinaSuelta(rutina) {
  const ctx = crearContexto();
  const copia = validarRutina(ctx, 'rutina', rutina);
  return ctx.errores.length ? { ok: false, errores: ctx.errores } : { ok: true, rutina: copia };
}

/* ---------- sesiones ---------- */

function validarSerie(ctx, ruta, s, medida) {
  const c = tomarCampos(s, ['kg', 'reps', 'seg', 'rir', 'ok'], ctx, ruta);
  const salida = {};
  if (!esNumero(c.kg, { min: 0, max: 500, decimales: 2 })) ctx.error(`${ruta}.kg`, 'El peso debe estar entre 0 y 500 kg (máx. 2 decimales).');
  salida.kg = c.kg;
  const campo = medida === 'segundos' ? 'seg' : 'reps';
  const otro = medida === 'segundos' ? 'reps' : 'seg';
  if (c[otro] !== undefined) ctx.error(`${ruta}.${otro}`, `En un ejercicio por ${medida === 'segundos' ? 'tiempo' : 'repeticiones'} solo va "${campo}".`);
  if (!esEntero(c[campo], { min: 0, max: 999 })) ctx.error(`${ruta}.${campo}`, 'Debe ser un entero entre 0 y 999.');
  salida[campo] = c[campo];
  if (c.rir !== null && !esEntero(c.rir, { min: 0, max: 5 })) ctx.error(`${ruta}.rir`, 'El RIR debe ser un entero de 0 a 5 o nulo.');
  salida.rir = c.rir ?? null;
  if (typeof c.ok !== 'boolean') ctx.error(`${ruta}.ok`, 'ok debe ser verdadero o falso.');
  salida.ok = c.ok === true;
  return salida;
}

function validarEjercicioSesion(ctx, ruta, e) {
  const c = tomarCampos(e, ['id', 'nombre', 'medida', 'min', 'max', 'porLado', 'rir', 'descansoSeg', 'superserie', 'nota', 'series'], ctx, ruta);
  const base = validarEjercicioRutina(ctx, ruta, {
    id: c.id, nombre: c.nombre, medida: c.medida, series: 1, min: c.min, max: c.max, porLado: c.porLado, rir: c.rir,
    descansoSeg: c.descansoSeg, superserie: c.superserie ?? null, consejo: '', ajustes: {},
  });
  const salida = {
    id: base.id, nombre: base.nombre, medida: base.medida, min: base.min, max: base.max, porLado: base.porLado, rir: base.rir,
    descansoSeg: base.descansoSeg, superserie: base.superserie, nota: leerTexto(ctx, `${ruta}.nota`, c.nota ?? '', { max: 300, nombre: 'La nota' }), series: [],
  };
  if (!Array.isArray(c.series) || c.series.length < 1 || c.series.length > MAX_SERIES) ctx.error(`${ruta}.series`, `Un ejercicio tiene entre 1 y ${MAX_SERIES} series.`);
  else salida.series = c.series.map((s, i) => validarSerie(ctx, `${ruta}.series[${i}]`, s, salida.medida));
  return salida;
}

function validarCardioRegistrado(ctx, ruta, c) {
  if (c === null) return null;
  const v = tomarCampos(c, ['nombre', 'minutos', 'km', 'velocidadKmH', 'inclinacionPct', 'ok'], ctx, ruta);
  const opcional = (clave, max, nombre) => {
    if (v[clave] === null || v[clave] === undefined) return null;
    if (!esNumero(v[clave], { min: 0, max, decimales: 2 })) ctx.error(`${ruta}.${clave}`, `${nombre} debe estar entre 0 y ${max}.`);
    return v[clave];
  };
  if (typeof v.ok !== 'boolean') ctx.error(`${ruta}.ok`, 'ok debe ser verdadero o falso.');
  return {
    nombre: leerTexto(ctx, `${ruta}.nombre`, v.nombre, { min: 1, max: 60, nombre: 'El nombre del cardio' }),
    minutos: leerEntero(ctx, `${ruta}.minutos`, v.minutos, { min: 0, max: 300, nombre: 'Los minutos' }),
    km: opcional('km', 100, 'La distancia'),
    velocidadKmH: opcional('velocidadKmH', 30, 'La velocidad'),
    inclinacionPct: opcional('inclinacionPct', 30, 'La inclinación'),
    ok: v.ok === true,
  };
}

/** Valida `cierre`. → { ok, cierre, errores:[{ruta,mensaje}] } (lo usa también la acción finalizarSesion). */
export function validarCierre(cierre) {
  const ctx = crearContexto();
  const salida = validarCierreInterno(ctx, 'cierre', cierre);
  return ctx.errores.length ? { ok: false, errores: ctx.errores } : { ok: true, cierre: salida };
}

function validarCierreInterno(ctx, ruta, c) {
  const v = tomarCampos(c, ['duracionSeg', 'energiaAntes', 'energiaDespues', 'calidad', 'dolor', 'notas'], ctx, ruta);
  const salida = {
    duracionSeg: leerEntero(ctx, `${ruta}.duracionSeg`, v.duracionSeg, { min: 0, max: 21600, nombre: 'La duración' }),
    energiaAntes: leerEntero(ctx, `${ruta}.energiaAntes`, v.energiaAntes, { min: 1, max: 5, nombre: 'La energía antes' }),
    energiaDespues: leerEntero(ctx, `${ruta}.energiaDespues`, v.energiaDespues, { min: 1, max: 5, nombre: 'La energía después' }),
    calidad: leerEntero(ctx, `${ruta}.calidad`, v.calidad, { min: 1, max: 5, nombre: 'La calidad' }),
    dolor: { hay: false, descripcion: '' },
    notas: leerTexto(ctx, `${ruta}.notas`, v.notas ?? '', { max: 500, nombre: 'Las notas' }),
  };
  const d = tomarCampos(v.dolor, ['hay', 'descripcion'], ctx, `${ruta}.dolor`);
  if (typeof d.hay !== 'boolean') ctx.error(`${ruta}.dolor.hay`, 'Indique si hubo dolor o molestia.');
  const descripcion = leerTexto(ctx, `${ruta}.dolor.descripcion`, d.descripcion ?? '', { max: 200, nombre: 'La descripción del dolor' });
  if (d.hay === true && descripcion.length < 3) ctx.error(`${ruta}.dolor.descripcion`, 'Describa el dolor o molestia (al menos 3 caracteres).');
  salida.dolor = { hay: d.hay === true, descripcion };
  return salida;
}

const CAMPOS_SESION = [
  'id', 'fecha', 'personaId', 'estado', 'diaRutinaId', 'nombreDia', 'rutinaVersion', 'iniciadaEn', 'ultimaActividadEn',
  'finalizadaEn', 'calentamiento', 'ejercicios', 'cardioPlan', 'cardio', 'cierre',
];

function validarSesion(ctx, ruta, clave, s) {
  const c = tomarCampos(s, CAMPOS_SESION, ctx, ruta);
  if (!esUno(c.estado, ESTADOS_SESION)) ctx.error(`${ruta}.estado`, 'El estado de la sesión no es válido.');
  if (!esFechaISO(c.fecha)) ctx.error(`${ruta}.fecha`, 'La fecha de la sesión no es válida.');
  if (!esUno(c.personaId, PERSONAS_IDS)) ctx.error(`${ruta}.personaId`, 'La persona debe ser p1 o p2.');
  if (c.id !== clave || c.id !== idSesion(c.fecha, c.personaId)) ctx.error(`${ruta}.id`, 'El identificador de la sesión no coincide con su fecha y persona.');
  if (typeof c.diaRutinaId !== 'string' || c.diaRutinaId.length < 1 || c.diaRutinaId.length > 60) ctx.error(`${ruta}.diaRutinaId`, 'Falta la referencia al día de rutina.');
  const salida = {
    id: c.id, fecha: c.fecha, personaId: c.personaId, estado: c.estado,
    diaRutinaId: c.diaRutinaId, nombreDia: leerTexto(ctx, `${ruta}.nombreDia`, c.nombreDia, { min: 1, max: 60, nombre: 'El nombre del día' }),
  };
  if (c.estado === 'sin-iniciar') {
    for (const k of ['rutinaVersion', 'iniciadaEn', 'ejercicios', 'cierre']) if (c[k] !== undefined) ctx.error(`${ruta}.${k}`, 'Una sesión sin iniciar no lleva este campo.');
    return salida;
  }
  salida.rutinaVersion = leerEntero(ctx, `${ruta}.rutinaVersion`, c.rutinaVersion, { min: 1, max: 1e9, nombre: 'La versión de rutina' });
  if (!esInstanteISO(c.iniciadaEn)) ctx.error(`${ruta}.iniciadaEn`, 'La hora de inicio no es válida.');
  salida.iniciadaEn = c.iniciadaEn;
  if (!esInstanteISO(c.ultimaActividadEn)) ctx.error(`${ruta}.ultimaActividadEn`, 'La hora de última actividad no es válida.');
  salida.ultimaActividadEn = c.ultimaActividadEn;
  if (c.estado === 'completada') {
    if (!esInstanteISO(c.finalizadaEn)) ctx.error(`${ruta}.finalizadaEn`, 'La hora de cierre no es válida.');
  } else if (c.finalizadaEn !== null) ctx.error(`${ruta}.finalizadaEn`, 'Una sesión en curso no tiene hora de cierre.');
  salida.finalizadaEn = c.finalizadaEn ?? null;
  salida.calentamiento = leerTexto(ctx, `${ruta}.calentamiento`, c.calentamiento ?? '', { max: 200, nombre: 'El calentamiento' });
  if (!Array.isArray(c.ejercicios) || c.ejercicios.length < 1 || c.ejercicios.length > MAX_EJERCICIOS_DIA) {
    ctx.error(`${ruta}.ejercicios`, `Una sesión tiene entre 1 y ${MAX_EJERCICIOS_DIA} ejercicios.`);
    salida.ejercicios = [];
  } else {
    salida.ejercicios = c.ejercicios.map((e, i) => validarEjercicioSesion(ctx, `${ruta}.ejercicios[${i}]`, e));
    const repetidos = new Set();
    salida.ejercicios.forEach((e, i) => {
      if (repetidos.has(e.id)) ctx.error(`${ruta}.ejercicios[${i}].id`, 'Ejercicio repetido en la sesión.');
      repetidos.add(e.id);
    });
  }
  salida.cardioPlan = validarCardioPlan(ctx, `${ruta}.cardioPlan`, c.cardioPlan ?? null);
  salida.cardio = validarCardioRegistrado(ctx, `${ruta}.cardio`, c.cardio ?? null);
  if (c.estado === 'completada') salida.cierre = validarCierreInterno(ctx, `${ruta}.cierre`, c.cierre);
  else {
    if (c.cierre !== null && c.cierre !== undefined) ctx.error(`${ruta}.cierre`, 'Solo una sesión completada tiene cierre.');
    salida.cierre = null;
  }
  return salida;
}

/* ---------- raíz ---------- */

function validarAjustes(ctx, ruta, a) {
  const c = tomarCampos(a, ['personas', 'incrementoKg', 'fechaInicio'], ctx, ruta);
  const personas = [];
  if (!Array.isArray(c.personas) || c.personas.length !== 2) ctx.error(`${ruta}.personas`, 'Deben ser exactamente 2 personas.');
  else {
    c.personas.forEach((p, i) => {
      const v = tomarCampos(p, ['id', 'nombre'], ctx, `${ruta}.personas[${i}]`);
      if (v.id !== PERSONAS_IDS[i]) ctx.error(`${ruta}.personas[${i}].id`, `La persona ${i + 1} debe tener el identificador ${PERSONAS_IDS[i]}.`);
      personas.push({ id: v.id, nombre: leerTexto(ctx, `${ruta}.personas[${i}].nombre`, v.nombre, { min: 1, max: 30, nombre: 'El nombre' }) });
    });
  }
  if (!esUno(c.incrementoKg, INCREMENTOS_KG)) ctx.error(`${ruta}.incrementoKg`, 'El incremento debe ser 1, 2, 2,5 o 5 kg.');
  if (!esFechaISO(c.fechaInicio)) ctx.error(`${ruta}.fechaInicio`, 'La fecha de inicio no es válida.');
  return { personas, incrementoKg: c.incrementoKg, fechaInicio: c.fechaInicio };
}

function validarPesoCorporal(ctx, ruta, lista) {
  if (!Array.isArray(lista)) {
    ctx.error(ruta, 'El peso corporal debe ser una lista.');
    return [];
  }
  const vistos = new Set();
  const ids = new Set();
  return lista.map((p, i) => {
    const r = `${ruta}[${i}]`;
    const c = tomarCampos(p, ['id', 'personaId', 'fecha', 'kg'], ctx, r);
    if (!esId(c.id)) ctx.error(`${r}.id`, 'El identificador no es válido.');
    if (ids.has(c.id)) ctx.error(`${r}.id`, 'Identificador repetido.');
    ids.add(c.id);
    if (!esUno(c.personaId, PERSONAS_IDS)) ctx.error(`${r}.personaId`, 'La persona debe ser p1 o p2.');
    if (!esFechaISO(c.fecha)) ctx.error(`${r}.fecha`, 'La fecha no es válida.');
    if (!esNumero(c.kg, { min: 20, max: 300, decimales: 1 })) ctx.error(`${r}.kg`, 'El peso corporal debe estar entre 20 y 300 kg (1 decimal).');
    const llave = `${c.personaId}|${c.fecha}`;
    if (vistos.has(llave)) ctx.error(r, 'Hay dos registros de peso de la misma persona el mismo día.');
    vistos.add(llave);
    return { id: c.id, personaId: c.personaId, fecha: c.fecha, kg: c.kg };
  });
}

/**
 * Valida y sanea. → { ok:true, datos, avisos } | { ok:false, errores:[{ruta,mensaje}], avisos }
 * `datos` conserva schemaVersion, app, rev, creadoEn y actualizadoEn (el repositorio los reordena y estampa al guardar).
 */
export function validar(obj) {
  const ctx = crearContexto();
  if (!esObjetoPlano(obj)) {
    ctx.error('', 'Se esperaba un objeto.');
    return { ok: false, errores: ctx.errores, avisos: ctx.avisos };
  }
  const c = tomarCampos(obj, ['schemaVersion', 'app', 'rev', 'creadoEn', 'actualizadoEn', 'ajustes', 'rutina', 'sesiones', 'pesoCorporal', 'control'], ctx, '');
  if (c.schemaVersion !== VERSION) ctx.error('schemaVersion', `La versión de los datos debe ser ${VERSION}.`);
  if (c.app !== APP) ctx.error('app', 'Estos datos no son de Gimnasio.');
  if (!esEntero(c.rev, { min: 0 })) ctx.error('rev', 'La revisión debe ser un entero mayor o igual a 0.');
  if (!esInstanteISO(c.creadoEn)) ctx.error('creadoEn', 'La fecha de creación no es válida.');
  if (!esInstanteISO(c.actualizadoEn)) ctx.error('actualizadoEn', 'La fecha de actualización no es válida.');

  const ajustes = validarAjustes(ctx, 'ajustes', c.ajustes);
  const rutina = validarRutina(ctx, 'rutina', c.rutina);
  const sesiones = {};
  if (!esObjetoPlano(c.sesiones)) ctx.error('sesiones', 'Las sesiones deben ser un objeto indexado por identificador.');
  else for (const clave of Object.keys(c.sesiones)) sesiones[clave] = validarSesion(ctx, `sesiones["${clave}"]`, clave, c.sesiones[clave]);
  const pesoCorporal = validarPesoCorporal(ctx, 'pesoCorporal', c.pesoCorporal);
  const control = tomarCampos(c.control, ['generadoHasta'], ctx, 'control');
  if (control.generadoHasta !== null && !esFechaISO(control.generadoHasta)) ctx.error('control.generadoHasta', 'La fecha de cierre de días no es válida.');

  if (ctx.errores.length) return { ok: false, errores: ctx.errores, avisos: ctx.avisos };
  return {
    ok: true,
    avisos: ctx.avisos,
    datos: {
      schemaVersion: VERSION, app: APP, rev: c.rev, creadoEn: c.creadoEn, actualizadoEn: c.actualizadoEn,
      ajustes, rutina, sesiones, pesoCorporal, control: { generadoHasta: control.generadoHasta ?? null },
    },
  };
}

/** Objeto plano para la hoja de confirmación de importación (no revela nada sensible). */
export function resumir(datos) {
  const sesiones = Object.values(datos.sesiones);
  const registradas = sesiones.filter((s) => s.estado !== 'sin-iniciar');
  const fechas = registradas.map((s) => s.fecha).sort();
  return {
    nombres: datos.ajustes.personas.map((p) => p.nombre),
    sesionesTotales: sesiones.length,
    sesionesRegistradas: registradas.length,
    sesionesCompletadas: sesiones.filter((s) => s.estado === 'completada').length,
    desde: fechas[0] ?? null,
    hasta: fechas[fechas.length - 1] ?? null,
    diasRutina: datos.rutina.dias.length,
    registrosPeso: datos.pesoCorporal.length,
  };
}
