/*
 * tienda.js — estado en memoria con acciones puras y suscripción. Contrato: docs/UTILIDADES.md §8.
 * Lo que se ve siempre coincide con lo guardado: el estado en memoria solo cambia después de que el repositorio
 * confirma el guardado; si falla, queda el estado anterior (reversión) y se emite un evento 'error'.
 */
import { MENSAJES_ERROR } from './storage.js';
import { MENSAJE_SIN_RESPALDO } from './repositorio.js';

const MENSAJE_CORRUPTO =
  'Los datos guardados no se pueden leer. Restaure el respaldo, importe un archivo o empiece de cero desde la pantalla de recuperación.';

/** Copia profunda de datos JSON (los datos de las apps siempre lo son). */
function clonar(datos) {
  return typeof structuredClone === 'function' ? structuredClone(datos) : JSON.parse(JSON.stringify(datos));
}

/** ¿La acción mutó su copia y la devolvió? (solo se calcula cuando devuelve la misma referencia que recibió). */
function mutada(entrada, original) {
  try {
    return JSON.stringify(entrada) !== JSON.stringify(original);
  } catch {
    return true;
  }
}

function reportar(e) {
  if (typeof globalThis.reportError === 'function') {
    try {
      globalThis.reportError(e);
    } catch {
      /* nada */
    }
  }
}

/**
 * @param {object} o
 * @param {ReturnType<import('./repositorio.js').crearRepositorio>} o.repositorio
 * @param {{hoy():string,instanteISO():string}} o.reloj
 * @param {(prefijo:string)=>string} o.generarId
 * @param {{estado:string,datos:object|null}} o.carga  resultado de repositorio.cargar()
 */
export function crearTienda({ repositorio, reloj, generarId, carga }) {
  let actual = carga.datos;
  let estado = carga.estado;
  const suscriptores = new Set();

  function emitir(evento) {
    for (const fn of [...suscriptores]) {
      try {
        fn(evento);
      } catch (e) {
        // Un suscriptor defectuoso no debe romper la tienda ni a los demás; se reporta sin lanzar.
        if (typeof globalThis.reportError === 'function') globalThis.reportError(e);
      }
    }
  }

  function fallar(error, mensaje, extra = {}) {
    const resultado = { ok: false, error, mensaje: mensaje ?? MENSAJES_ERROR[error] ?? MENSAJES_ERROR.desconocido, ...extra };
    emitir({ tipo: 'error', error: resultado.error, mensaje: resultado.mensaje });
    return resultado;
  }

  function guardarSeguro(datos, revBase, opciones) {
    try {
      return repositorio.guardar(datos, revBase, opciones);
    } catch (e) {
      reportar(e); // R0-07: un error de programación no se oculta (pero la vista recibe un mensaje estándar)
      return { ok: false, error: 'desconocido', mensaje: MENSAJES_ERROR.desconocido };
    }
  }

  /** rev base para guardar: el de la memoria si es entero; si no, el guardado (o 0). */
  function revBaseActual() {
    if (actual !== null && Number.isSafeInteger(actual.rev) && actual.rev >= 0) return actual.rev;
    return repositorio.revActual() ?? 0;
  }

  function recargar() {
    let c;
    try {
      c = repositorio.cargar();
    } catch (e) {
      reportar(e);
      c = { estado: 'corrupto', datos: null };
    }
    actual = c.datos;
    estado = c.estado;
    emitir({ tipo: 'recarga' });
  }

  /**
   * @param {Function} accion  (datos, payload, ctx) → datos nuevos
   * @param {*} payload
   * @param {{ pura?: boolean, conservarRespaldo?: boolean }} [opciones]  OPCIONAL: sin ella todo se comporta como siempre.
   *   pura:true → la acción DECLARA que no muta su entrada (devuelve objetos nuevos y comparte lo que no cambia), así que se le
   *     pasa `actual` sin la copia profunda de R0-06 (R1-02: con 2 años de historial esa copia costaba ≈ 50 ms por guardado).
   *     Una acción que mute su entrada con pura:true corrompería lo que se ve: úsese solo con acciones probadas con datos congelados.
   *   conservarRespaldo:true → con cuota llena el guardado NO borra el respaldo automático y devuelve 'cuota-llena' (R1-14).
   */
  function ejecutar(accion, payload, { pura = false, conservarRespaldo = false } = {}) {
    if (actual === null || estado === 'corrupto') return fallar('corrupto', MENSAJE_CORRUPTO);
    if (repositorio.modo() === 'solo-lectura') return fallar('solo-lectura');

    const ctx = { hoy: reloj.hoy(), ahora: reloj.instanteISO(), generarId };
    // R0-06: la acción trabaja sobre una copia; si muta su entrada, `actual` (lo que se ve) no cambia hasta guardar.
    // Con pura:true se confía en la declaración de la acción y se omite la copia.
    const entrada = pura ? actual : clonar(actual);
    let nuevo;
    try {
      nuevo = accion(entrada, payload, ctx);
    } catch (e) {
      return { ok: false, error: 'accion', mensaje: e && e.message ? e.message : String(e) };
    }
    if (nuevo === actual) return { ok: true, cambio: false };
    if (nuevo === entrada && !mutada(entrada, actual)) return { ok: true, cambio: false };
    if (nuevo === null || typeof nuevo !== 'object') return { ok: false, error: 'accion', mensaje: 'La acción no devolvió datos.' };

    const r = guardarSeguro(nuevo, revBaseActual(), conservarRespaldo ? { conservarRespaldo: true } : undefined);
    if (!r.ok) {
      const resultado = fallar(r.error, r.mensaje);
      if (r.error === 'conflicto') recargar();
      return resultado;
    }
    actual = r.datos;
    emitir({ tipo: 'cambio', ...(r.avisos ? { avisos: r.avisos } : {}) });
    return { ok: true, cambio: true, ...(r.avisos ? { avisos: r.avisos } : {}) };
  }

  /**
   * Importar, borrar todo o restaurar: respalda lo actual y guarda `datosValidados`.
   * Si el respaldo no cabe —solo o junto con los datos nuevos— no sigue: 'sin-respaldo' (R0-01). Con `sinRespaldo: true`
   * ("Continuar sin respaldo" confirmado por el usuario) sigue y el guardado puede eliminar el respaldo viejo para
   * liberar espacio: en ese caso el resultado trae `avisos` (respaldo-eliminado).
   */
  function reemplazar(datosValidados, { motivo, sinRespaldo = false } = {}) {
    if (repositorio.modo() === 'solo-lectura') return fallar('solo-lectura');
    if (actual !== null && !sinRespaldo) {
      const rb = repositorio.respaldar(actual, motivo ?? 'reemplazo');
      if (!rb.ok) return fallar('sin-respaldo', MENSAJE_SIN_RESPALDO);
    }
    const r = guardarSeguro(datosValidados, revBaseActual(), { conservarRespaldo: !sinRespaldo });
    if (!r.ok) {
      const resultado = !sinRespaldo && r.error === 'cuota-llena' ? fallar('sin-respaldo', MENSAJE_SIN_RESPALDO) : fallar(r.error, r.mensaje);
      if (r.error === 'conflicto') recargar();
      return resultado;
    }
    actual = r.datos;
    estado = repositorio.modo() === 'memoria' ? 'sin-almacenamiento' : 'ok'; // R0-13
    emitir({ tipo: 'recarga', ...(r.avisos ? { avisos: r.avisos } : {}) });
    return { ok: true, ...(r.avisos ? { avisos: r.avisos } : {}) };
  }

  function suscribir(fn) {
    if (typeof fn !== 'function') throw new TypeError('suscribir requiere una función.');
    suscriptores.add(fn);
    return () => suscriptores.delete(fn);
  }

  return {
    datos: () => actual,
    estadoCarga: () => estado,
    ejecutar,
    reemplazar,
    recargar,
    suscribir,
  };
}
