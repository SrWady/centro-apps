/*
 * fechas.js — fechas de calendario 'YYYY-MM-DD' (PURO). Contrato: docs/UTILIDADES.md §11.
 * La aritmética usa Date.UTC / getUTC* (sin zona ni horario de verano). Nunca se usa new Date('YYYY-MM-DD').
 * Las únicas excepciones son errores de programación: TypeError (tipo equivocado) y RangeError (fecha imposible).
 */

const MS_DIA = 86_400_000;
const PATRON_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Milisegundos UTC de medianoche del día dado (acepta años < 100 sin la corrección de 1900 de Date.UTC). */
function msUTC(anio, mes, dia) {
  const d = new Date(0);
  d.setUTCFullYear(anio, mes - 1, dia);
  return d.getTime();
}

function aFecha(ms) {
  const d = new Date(ms);
  return crearFecha(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function exigirEntero(valor, nombre) {
  if (!Number.isInteger(valor)) throw new TypeError(`${nombre} debe ser un entero.`);
}

export function esBisiesto(anio) {
  exigirEntero(anio, 'anio');
  return (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;
}

export function diasEnMes(anio, mes) {
  exigirEntero(mes, 'mes');
  if (mes < 1 || mes > 12) throw new RangeError(`Mes fuera de rango: ${mes}.`);
  if (mes === 2) return esBisiesto(anio) ? 29 : 28;
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}

/** Valida y formatea con ceros: (2026, 11, 2) → '2026-11-02'. Fecha inexistente → RangeError. */
export function crearFecha(anio, mes, dia) {
  exigirEntero(anio, 'anio');
  exigirEntero(mes, 'mes');
  exigirEntero(dia, 'dia');
  if (anio < 1 || anio > 9999) throw new RangeError(`Año fuera de rango: ${anio}.`);
  if (mes < 1 || mes > 12 || dia < 1 || dia > diasEnMes(anio, mes)) {
    throw new RangeError(`Fecha inexistente: ${anio}-${mes}-${dia}.`);
  }
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** '2026-11-02' → { anio: 2026, mes: 11, dia: 2 }. Formato inválido o fecha inexistente → RangeError. */
export function partes(fecha) {
  if (typeof fecha !== 'string') throw new TypeError('La fecha debe ser un texto YYYY-MM-DD.');
  const m = PATRON_FECHA.exec(fecha);
  if (!m) throw new RangeError(`Fecha con formato inválido: "${fecha}".`);
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  crearFecha(anio, mes, dia); // valida existencia
  return { anio, mes, dia };
}

/** Si `dia` excede los días del mes se usa el último: (2027, 2, 31) → '2027-02-28'. */
export function fechaConDia(anio, mes, dia) {
  exigirEntero(dia, 'dia');
  if (dia < 1) throw new RangeError(`Día fuera de rango: ${dia}.`);
  return crearFecha(anio, mes, Math.min(dia, diasEnMes(anio, mes)));
}

export function sumarDias(fecha, n) {
  exigirEntero(n, 'n');
  const { anio, mes, dia } = partes(fecha);
  return aFecha(msUTC(anio, mes, dia) + n * MS_DIA);
}

/** Conserva el día original con tope: ('2027-01-31', 1) → '2027-02-28'. No encadenar para series de cuotas. */
export function sumarMeses(fecha, n) {
  exigirEntero(n, 'n');
  const { anio, mes, dia } = partes(fecha);
  const indice = anio * 12 + (mes - 1) + n;
  const anioNuevo = Math.floor(indice / 12);
  const mesNuevo = (((indice % 12) + 12) % 12) + 1;
  return fechaConDia(anioNuevo, mesNuevo, dia);
}

/** hasta − desde, en días enteros. */
export function diferenciaDias(desde, hasta) {
  const a = partes(desde);
  const b = partes(hasta);
  return Math.round((msUTC(b.anio, b.mes, b.dia) - msUTC(a.anio, a.mes, a.dia)) / MS_DIA);
}

/** −1 | 0 | 1 por orden lexicográfico ISO (válido porque todas las fechas tienen ancho fijo). */
export function compararFechas(a, b) {
  partes(a);
  partes(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 1 = lunes … 7 = domingo. */
export function diaSemana(fecha) {
  const { anio, mes, dia } = partes(fecha);
  const dow = new Date(msUTC(anio, mes, dia)).getUTCDay(); // 0 = domingo
  return dow === 0 ? 7 : dow;
}

export function inicioSemana(fecha) {
  return sumarDias(fecha, -(diaSemana(fecha) - 1));
}

export function finSemana(fecha) {
  return sumarDias(fecha, 7 - diaSemana(fecha));
}

/** 7 fechas lun…dom de la semana que contiene `lunes` (normalmente un lunes). */
export function diasDeSemana(lunes) {
  const inicio = inicioSemana(lunes);
  return Array.from({ length: 7 }, (_, i) => sumarDias(inicio, i));
}

/** Lista inclusiva. `desde > hasta` → []. Más de 3.700 elementos → RangeError. */
export function rangoFechas(desde, hasta) {
  const total = diferenciaDias(desde, hasta) + 1;
  if (total <= 0) return [];
  if (total > 3700) throw new RangeError('El rango de fechas es demasiado largo (máx. 3.700 días).');
  return Array.from({ length: total }, (_, i) => sumarDias(desde, i));
}

/** Instante (ms epoch) → fecha de calendario LOCAL del dispositivo (no UTC). */
export function fechaLocalDe(ms) {
  if (!Number.isFinite(ms)) throw new TypeError('ms debe ser un número finito.');
  const d = new Date(ms);
  return crearFecha(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

// --- Formato ---------------------------------------------------------------------------------------------------
// Se usa Intl.DateTimeFormat('es-CO', { timeZone: 'UTC' }) pero solo para obtener los NOMBRES (formatToParts) y se
// compone el texto a mano: así el resultado no depende de la versión de ICU ('lun, 2 de nov' vs 'lun 2 nov').

const formateadores = new Map();

function formateador(clave, opciones) {
  let f = formateadores.get(clave);
  if (!f) {
    f = new Intl.DateTimeFormat('es-CO', { ...opciones, timeZone: 'UTC' });
    formateadores.set(clave, f);
  }
  return f;
}

function nombre(ms, tipo, opciones) {
  const partesIntl = formateador(tipo + JSON.stringify(opciones), opciones).formatToParts(ms);
  const p = partesIntl.find((x) => x.type === tipo);
  return p ? p.value.replace(/\./g, '').toLowerCase() : '';
}

/**
 * estilo: 'corta' ('lun 2 nov') | 'larga' ('lunes, 2 de noviembre de 2026') | 'dia-semana' ('lun') |
 *         'mes-anio' ('noviembre 2026'). Extras para etiquetas de ciclo: 'dia-mes' ('2 nov'), 'dia-mes-anio' ('2 nov 2026').
 */
export function formatearFecha(fecha, estilo) {
  const { anio, mes, dia } = partes(fecha);
  const ms = msUTC(anio, mes, dia);
  const diaCorto = () => nombre(ms, 'weekday', { weekday: 'short' });
  const mesCorto = () => nombre(ms, 'month', { month: 'short' });
  switch (estilo) {
    case 'corta':
      return `${diaCorto()} ${dia} ${mesCorto()}`;
    case 'larga':
      return `${nombre(ms, 'weekday', { weekday: 'long' })}, ${dia} de ${nombre(ms, 'month', { month: 'long' })} de ${anio}`;
    case 'dia-semana':
      return diaCorto();
    case 'mes-anio':
      return `${nombre(ms, 'month', { month: 'long' })} ${anio}`;
    case 'dia-mes':
      return `${dia} ${mesCorto()}`;
    case 'dia-mes-anio':
      return `${dia} ${mesCorto()} ${anio}`;
    default:
      throw new RangeError(`Estilo de fecha desconocido: "${estilo}".`);
  }
}

/** 75 → '1:15'; 4380 → '1:13:00'. Se trunca a segundos enteros; valores negativos se toman como 0. */
export function formatearDuracion(segundos) {
  if (!Number.isFinite(segundos)) throw new TypeError('segundos debe ser un número finito.');
  const total = Math.max(0, Math.floor(segundos));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
