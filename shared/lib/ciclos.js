/*
 * ciclos.js — ciclos presupuestales pago a pago (PURO). Contrato: docs/UTILIDADES.md §12; reglas: ESQUEMA-FINANZAS §3.
 * Un ciclo se identifica con 'YYYY-MM' = mes en que EMPIEZA (el mes del día de pago). Su fin es el día anterior al inicio
 * del ciclo siguiente, así que nunca hay huecos ni solapes aunque cambie el día de pago.
 * `historial` = ajustes.diaPago = [{ desdeCiclo: 'YYYY-MM', dia: 1..31 }, ...].
 */
import { diferenciaDias, fechaConDia, formatearFecha, partes, sumarDias } from './fechas.js';

const PATRON_CICLO = /^(\d{4})-(0[1-9]|1[0-2])$/;

function leerCiclo(id) {
  if (typeof id !== 'string') throw new TypeError('El ciclo debe ser un texto YYYY-MM.');
  const m = PATRON_CICLO.exec(id);
  if (!m) throw new RangeError(`Ciclo con formato inválido: "${id}".`);
  return { anio: Number(m[1]), mes: Number(m[2]) };
}

function aCiclo(indice) {
  const anio = Math.floor(indice / 12);
  const mes = (((indice % 12) + 12) % 12) + 1;
  if (anio < 1 || anio > 9999) throw new RangeError('Ciclo fuera de rango.');
  return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}`;
}

function indiceDe(id) {
  const { anio, mes } = leerCiclo(id);
  return anio * 12 + (mes - 1);
}

export function cicloSiguiente(id) {
  return aCiclo(indiceDe(id) + 1);
}

export function cicloAnterior(id) {
  return aCiclo(indiceDe(id) - 1);
}

/** Meses de a a b (b − a): ('2026-11','2028-01') → 14. Negativo si b < a. Para contar ciclos inclusivos, sumar 1. */
export function ciclosEntre(a, b) {
  return indiceDe(b) - indiceDe(a);
}

/** Lista inclusiva de ids; [] si desde > hasta. */
export function listarCiclos(desde, hasta) {
  const ini = indiceDe(desde);
  const fin = indiceDe(hasta);
  const lista = [];
  for (let i = ini; i <= fin; i += 1) lista.push(aCiclo(i));
  return lista;
}

/** Día de pago vigente para el ciclo: el de la entrada con mayor desdeCiclo ≤ id; si no hay, el de la primera. */
export function diaPagoDe(id, historial) {
  leerCiclo(id);
  if (!Array.isArray(historial) || historial.length === 0) {
    throw new TypeError('El historial de día de pago debe ser un arreglo con al menos una entrada.');
  }
  let elegida = null;
  let primera = historial[0];
  for (const entrada of historial) {
    if (entrada.desdeCiclo < primera.desdeCiclo) primera = entrada;
    if (entrada.desdeCiclo <= id && (elegida === null || entrada.desdeCiclo > elegida.desdeCiclo)) elegida = entrada;
  }
  const dia = (elegida ?? primera).dia;
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) throw new RangeError(`Día de pago inválido: ${dia}.`);
  return dia;
}

/** Día `dia` del mes del ciclo (o el último día del mes si el mes es más corto). */
export function inicioCiclo(id, historial) {
  const { anio, mes } = leerCiclo(id);
  return fechaConDia(anio, mes, diaPagoDe(id, historial));
}

export function finCiclo(id, historial) {
  return sumarDias(inicioCiclo(cicloSiguiente(id), historial), -1);
}

export function rangoCiclo(id, historial) {
  const inicio = inicioCiclo(id, historial);
  const fin = finCiclo(id, historial);
  return { id, inicio, fin, dias: diferenciaDias(inicio, fin) + 1 };
}

/** Ciclo tal que inicio ≤ fecha < inicio(siguiente). Se prueba el mes de la fecha y, si aún no llegó el pago, el anterior. */
export function cicloDe(fecha, historial) {
  const { anio, mes } = partes(fecha);
  const delMes = `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}`;
  return fecha >= inicioCiclo(delMes, historial) ? delMes : cicloAnterior(delMes);
}

/** max(cicloDe(hoy), cicloInicial). Sin cicloInicial, cicloDe(hoy). */
export function cicloActual(hoy, historial, cicloInicial) {
  const de = cicloDe(hoy, historial);
  if (cicloInicial === undefined || cicloInicial === null) return de;
  leerCiclo(cicloInicial);
  return de >= cicloInicial ? de : cicloInicial;
}

/**
 * Días hasta el próximo día de pago. Antes del ciclo inicial: hasta su inicio. El día de pago mismo ya es día 0 del ciclo
 * nuevo, así que el próximo pago es el del mes siguiente (p. ej. 30 el 2026-11-01 con día 1).
 */
export function diasHastaProximoPago(hoy, historial, cicloInicial) {
  const de = cicloDe(hoy, historial);
  if (cicloInicial !== undefined && cicloInicial !== null && de < cicloInicial) {
    return diferenciaDias(hoy, inicioCiclo(cicloInicial, historial));
  }
  return diferenciaDias(hoy, inicioCiclo(cicloSiguiente(cicloActual(hoy, historial, cicloInicial)), historial));
}

/** '1 – 30 nov 2026' · '15 nov – 14 dic 2026' · '15 dic 2026 – 14 ene 2027'. */
export function etiquetaCiclo(rango) {
  const a = partes(rango.inicio);
  const b = partes(rango.fin);
  if (a.anio !== b.anio) {
    return `${formatearFecha(rango.inicio, 'dia-mes-anio')} – ${formatearFecha(rango.fin, 'dia-mes-anio')}`;
  }
  if (a.mes !== b.mes) {
    return `${formatearFecha(rango.inicio, 'dia-mes')} – ${formatearFecha(rango.fin, 'dia-mes-anio')}`;
  }
  return `${a.dia} – ${formatearFecha(rango.fin, 'dia-mes-anio')}`;
}
