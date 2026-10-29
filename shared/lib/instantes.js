/*
 * instantes.js — de un instante guardado (ISO UTC) a la fecha de calendario LOCAL (PURO).
 * Nació en finanzas/logica/periodo.js (R1F-20); R2F: se movió a shared/lib para no duplicar el envoltorio en cada app.
 */
import { fechaLocalDe } from './fechas.js';

/**
 * Fecha de calendario LOCAL (YYYY-MM-DD) de un instante ISO UTC guardado (p. ej. la fecha de un respaldo).
 * Un instante que no se entiende devuelve sus primeros 10 caracteres (nunca lanza).
 */
export function fechaLocalDeInstante(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? fechaLocalDe(ms) : String(iso).slice(0, 10);
}
