/*
 * envio.js — protección contra el doble toque en acciones de "guardar" (PURO: sin DOM ni temporizadores).
 * Nació en finanzas/vistas/comun.js (H-01); R2F: se movió a shared/lib para que cualquier app lo use.
 */

/**
 * Envuelve el manejador de un botón "Guardar" para ignorar los toques repetidos mientras la hoja tarda en cerrarse.
 * `fn` devuelve `true` si guardó (la hoja se está cerrando: no se vuelve a permitir) y cualquier otra cosa si falló o faltó un
 * dato (se vuelve a permitir). Si lanza, también se vuelve a permitir y la excepción se propaga.
 * R2F-01: `fn` puede ser ASÍNCRONA (devuelve una promesa de `true`/otra cosa): el bloqueo dura hasta que la promesa se
 * resuelve y solo se levanta si no devolvió `true` o fue rechazada. Mientras esté en curso, las llamadas repetidas devuelven
 * `undefined` sin ejecutar `fn`.
 * Compatibilidad: con una `fn` síncrona se comporta igual que antes (el valor devuelto es el de `fn`).
 */
export function unSoloEnvio(fn) {
  if (typeof fn !== 'function') throw new TypeError('unSoloEnvio requiere una función.');
  let enCurso = false;
  return (...args) => {
    if (enCurso) return undefined;
    enCurso = true;
    let resultado;
    try {
      resultado = fn(...args);
    } catch (e) {
      enCurso = false;
      throw e;
    }
    if (resultado !== null && typeof resultado === 'object' && typeof resultado.then === 'function') {
      return resultado.then(
        (valor) => { if (valor !== true) enCurso = false; return valor; },
        (error) => { enCurso = false; throw error; },
      );
    }
    if (resultado !== true) enCurso = false;
    return resultado;
  };
}
