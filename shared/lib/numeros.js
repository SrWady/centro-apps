/*
 * numeros.js — números no monetarios (kg, km, %) con formato es-CO (PURO). Contrato: docs/UTILIDADES.md §3.2.
 * El formato es manual (punto de miles, coma decimal) y NO depende de Intl: en español, Intl no agrupa los números de
 * 4 dígitos ('1234,5') y aquí el contrato exige '1.234,5'.
 */

function exigirFinito(n, nombre = 'n') {
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new TypeError(`${nombre} debe ser un número finito.`);
}

function agrupar(digitos) {
  return digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** 2,5 → '2,5'; 1234,5 → '1.234,5'. Redondea a maxDecimales y muestra al menos minDecimales. */
export function formatearNumero(n, { maxDecimales = 2, minDecimales = 0 } = {}) {
  exigirFinito(n);
  if (!Number.isInteger(maxDecimales) || !Number.isInteger(minDecimales) || minDecimales < 0 || maxDecimales < minDecimales || maxDecimales > 20) {
    throw new RangeError('Decimales inválidos.');
  }
  const redondeado = redondearA(n, maxDecimales);
  let [entera, decimal = ''] = Math.abs(redondeado).toFixed(maxDecimales).split('.');
  while (decimal.length > minDecimales && decimal.endsWith('0')) decimal = decimal.slice(0, -1);
  const negativo = redondeado < 0 && /[1-9]/.test(entera + decimal);
  return `${negativo ? '-' : ''}${agrupar(entera)}${decimal ? ',' + decimal : ''}`;
}

export function formatearKg(n) {
  return `${formatearNumero(n, { maxDecimales: 2 })} kg`;
}

/** 0,375 → '37,5 %'; 0,2 → '20,0 %' (decimales fijos). null/undefined/NaN → '—'. */
export function formatearPorcentaje(fraccion, decimales = 1) {
  if (fraccion === null || fraccion === undefined || typeof fraccion !== 'number' || !Number.isFinite(fraccion)) return '—';
  return `${formatearNumero(fraccion * 100, { maxDecimales: decimales, minDecimales: decimales })} %`;
}

/** '2,5' | '2.5' → 2.5; '' | 'x' → null. Coma o punto decimal, SIN separador de miles ('1.234,5' → null). */
export function parsearDecimal(texto) {
  if (typeof texto !== 'string') return null;
  const t = texto.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Math.round((n + EPSILON) × 10^d) / 10^d. */
export function redondearA(n, decimales) {
  exigirFinito(n);
  if (!Number.isInteger(decimales) || decimales < 0 || decimales > 20) throw new RangeError('Decimales inválidos.');
  const f = 10 ** decimales;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Steppers: redondearA(valor + paso, 2) acotado a [min, max]. */
export function sumarPaso(valor, paso, { min = 0, max = 500 } = {}) {
  exigirFinito(valor, 'valor');
  exigirFinito(paso, 'paso');
  return Math.min(max, Math.max(min, redondearA(valor + paso, 2)));
}
