/*
 * tasas.js — tasas de interés (PURO). Contrato: docs/ESQUEMA-FINANZAS.md §6.1.
 *
 * Convención (supuesto documentado):
 *  - 'EA'  = efectiva anual. Tasa mensual equivalente = (1 + p/100)^(1/12) − 1. Nunca se divide una E.A. entre 12.
 *  - 'MV'  = mensual vencida (p. ej. 2,1 % al mes). Tasa mensual = p/100.
 *  - Si el extracto muestra una N.M.V. anual (nominal mes vencido), el usuario la divide entre 12 y la ingresa como M.V.
 *  - Sin tasa (null) los cálculos usan 0 % y la vista avisa que la proyección es optimista.
 * La tasa mensual es el único número no monetario que se usa en coma flotante; el dinero siempre se redondea al peso
 * una sola vez por período (ver deudas.js).
 */

export const TIPOS_TASA = Object.freeze(['EA', 'MV']);
export const LIMITE_EA = 100;
export const LIMITE_MV = 10;

/** ¿Es una tasa bien formada? ({tipo:'EA', 0 < porcentaje ≤ 100} | {tipo:'MV', 0 < porcentaje ≤ 10}) */
export function tasaValida(tasa) {
  if (tasa === null || typeof tasa !== 'object') return false;
  const { tipo, porcentaje } = tasa;
  if (!TIPOS_TASA.includes(tipo)) return false;
  if (typeof porcentaje !== 'number' || !Number.isFinite(porcentaje) || porcentaje <= 0) return false;
  return porcentaje <= (tipo === 'EA' ? LIMITE_EA : LIMITE_MV);
}

/** Tasa mensual como fracción (0,02 = 2 %). null → null. */
export function tasaMensual(tasa) {
  if (tasa === null || tasa === undefined) return null;
  if (!tasaValida(tasa)) throw new RangeError('Tasa inválida.');
  return tasa.tipo === 'EA' ? (1 + tasa.porcentaje / 100) ** (1 / 12) - 1 : tasa.porcentaje / 100;
}

/** Equivalente efectivo anual como fracción: MV → (1 + p/100)^12 − 1; EA → p/100. null → null. */
export function equivalenteEA(tasa) {
  if (tasa === null || tasa === undefined) return null;
  if (!tasaValida(tasa)) throw new RangeError('Tasa inválida.');
  return tasa.tipo === 'EA' ? tasa.porcentaje / 100 : (1 + tasa.porcentaje / 100) ** 12 - 1;
}
