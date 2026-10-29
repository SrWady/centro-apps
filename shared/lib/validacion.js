/*
 * validacion.js — piezas para los validadores de esquema de cada app (PURO). Contrato: docs/UTILIDADES.md §4.
 * Los predicados devuelven boolean y nunca lanzan. El contexto acumula errores y avisos con su ruta
 * ('movimientos[12].monto'); validar(obj) de cada app construye una copia nueva con solo los campos conocidos.
 */
import { diasEnMes } from './fechas.js';

export const CLAVES_PELIGROSAS = Object.freeze(['__proto__', 'constructor', 'prototype']);

/** Para JSON.parse(texto, reviverSeguro): elimina las claves que permiten contaminar prototipos. */
export function reviverSeguro(clave, valor) {
  return CLAVES_PELIGROSAS.includes(clave) ? undefined : valor;
}

/** Acumulador: errores y avisos son listas de { ruta, mensaje }. */
export function crearContexto() {
  const ctx = {
    errores: [],
    avisos: [],
    error(ruta, mensaje) {
      ctx.errores.push({ ruta, mensaje });
    },
    aviso(ruta, mensaje) {
      ctx.avisos.push({ ruta, mensaje });
    },
  };
  return ctx;
}

/** Objeto no nulo, no arreglo, con prototipo Object.prototype o null. */
export function esObjetoPlano(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function dentro(v, min, max) {
  return (min === undefined || v >= min) && (max === undefined || v <= max);
}

export function esEntero(v, { min, max } = {}) {
  return Number.isSafeInteger(v) && dentro(v, min, max);
}

/** Entero en pesos. Con permitirNegativo y sin `min`, el rango es [−max, max]. */
export function esPesosValido(v, { min, max = 1e12, permitirNegativo = false } = {}) {
  const piso = min !== undefined ? min : permitirNegativo ? -max : 0;
  return Number.isSafeInteger(v) && v >= piso && v <= max;
}

/** Número finito; `decimales` = máximo de decimales permitidos. */
export function esNumero(v, { min, max, decimales } = {}) {
  if (typeof v !== 'number' || !Number.isFinite(v) || !dentro(v, min, max)) return false;
  if (decimales === undefined) return true;
  const f = 10 ** decimales;
  return Math.abs(v * f - Math.round(v * f)) < 1e-7;
}

/** Espacios de relleno (inicio + final) que esTexto tolera por encima de `max` antes de rechazar el texto crudo (R0-09). */
export const MARGEN_ESPACIOS = 64;

/**
 * String cuya longitud, tras trim, está entre min y max (contrato §4). Con `max`, además el texto crudo no puede
 * superar max + MARGEN_ESPACIOS (evita "a" + 4 millones de espacios). Los validadores guardan `v.trim()`.
 */
export function esTexto(v, { min = 0, max } = {}) {
  if (typeof v !== 'string') return false;
  if (max !== undefined && v.length > max + MARGEN_ESPACIOS) return false;
  const largo = v.trim().length;
  return largo >= min && (max === undefined || largo <= max);
}

/** 'YYYY-MM-DD' y fecha real: rechaza '2027-02-29', acepta '2028-02-29'. */
export function esFechaISO(v) {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  return anio >= 1 && mes >= 1 && mes <= 12 && dia >= 1 && dia <= diasEnMes(anio, mes);
}

/** 'YYYY-MM-DDTHH:mm:ss.sssZ' con fecha y hora reales. */
export function esInstanteISO(v) {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{3}Z$/.exec(v);
  return !!m && esFechaISO(m[1]) && Number(m[2]) <= 23 && Number(m[3]) <= 59 && Number(m[4]) <= 59;
}

export function esCicloId(v) {
  return typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export function esId(v) {
  return typeof v === 'string' && /^[a-z]{2,4}-[a-z0-9-]{1,48}$/.test(v);
}

export function esUno(v, lista) {
  return Array.isArray(lista) && lista.includes(v);
}

/**
 * Copia solo `campos` presentes en `obj`; cada clave descartada genera un aviso en ctx. Si `obj` no es un objeto plano
 * registra un error y devuelve {}.
 */
export function tomarCampos(obj, campos, ctx, ruta = '') {
  const copia = {};
  if (!esObjetoPlano(obj)) {
    ctx.error(ruta || '(raíz)', 'Se esperaba un objeto.');
    return copia;
  }
  const permitidos = new Set(campos);
  for (const clave of Object.keys(obj)) {
    if (permitidos.has(clave) && !CLAVES_PELIGROSAS.includes(clave)) copia[clave] = obj[clave];
    else ctx.aviso(ruta ? `${ruta}.${clave}` : clave, 'Campo desconocido descartado.');
  }
  return copia;
}
