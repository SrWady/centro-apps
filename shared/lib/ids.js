/*
 * ids.js — generadores de ID inyectables. Contrato: docs/UTILIDADES.md §6.
 * Formato: '<prefijo>-<tiempo base36><4 caracteres aleatorios base36>', compatible con esId() de validacion.js.
 */

const PATRON_PREFIJO = /^[a-z]{2,4}$/;
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

function exigirPrefijo(prefijo) {
  if (typeof prefijo !== 'string' || !PATRON_PREFIJO.test(prefijo)) {
    throw new TypeError(`El prefijo de ID debe cumplir /^[a-z]{2,4}$/ (recibido: ${String(prefijo)}).`);
  }
}

/**
 * Generador de producción. Además del azar, garantiza que dos IDs pedidos en el mismo milisegundo no se repitan.
 * @param {{ ahoraMs?: () => number, bytesAleatorios?: (n: number) => Uint8Array }} [opciones]
 * @returns {(prefijo: string) => string}
 */
export function crearGeneradorId({
  ahoraMs = () => Date.now(),
  bytesAleatorios = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
} = {}) {
  let msUltimo = -1;
  let usados = new Set();
  return function generarId(prefijo) {
    exigirPrefijo(prefijo);
    const ms = ahoraMs();
    if (ms !== msUltimo) {
      msUltimo = ms;
      usados = new Set();
    }
    const tiempo = Math.max(0, Math.floor(ms)).toString(36);
    for (let intento = 0; intento < 1000; intento += 1) {
      const azar = Array.from(bytesAleatorios(4), (b) => BASE36[b % 36]).join('');
      const id = `${prefijo}-${tiempo}${azar}`;
      if (!usados.has(id)) {
        usados.add(id);
        return id;
      }
    }
    throw new Error('No se pudo generar un ID único.');
  };
}

/** Para pruebas: 'mov-t1', 'cat-t2', … (un único contador por generador). `semilla` solo admite [a-z0-9-]. */
export function crearGeneradorIdDeterminista(semilla = 't') {
  if (typeof semilla !== 'string' || !/^[a-z0-9-]{1,20}$/.test(semilla)) {
    throw new TypeError('La semilla del generador determinista debe cumplir /^[a-z0-9-]{1,20}$/.');
  }
  let contador = 0;
  return function generarId(prefijo) {
    exigirPrefijo(prefijo);
    contador += 1;
    return `${prefijo}-${semilla}${contador}`;
  };
}
