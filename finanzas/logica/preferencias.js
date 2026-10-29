/*
 * preferencias.js — preferencias de ESTE dispositivo (no se exportan): clave `cte.finanzas.dispositivo`.
 * Guarda la última cuenta y categoría usadas (registro rápido en ≤ 6 toques), el ajuste de vibración y si ya se descartó la tarjeta de
 * bienvenida de los datos de ejemplo (`bienvenidaOculta`, T5.8: es por celular y no se exporta, así que al importar datos nuevos no cambia).
 * Recibe el almacén por inyección (storage.js): todo acceso es seguro y nunca lanza.
 */
import { esId, esObjetoPlano, reviverSeguro } from '../../shared/lib/validacion.js';

export const CLAVE_DISPOSITIVO = 'cte.finanzas.dispositivo';
export const PREFERENCIAS_POR_DEFECTO = Object.freeze({ ultimaCuentaId: null, ultimaCategoriaId: null, vibracion: true, bienvenidaOculta: false });

/** Sanea un objeto leído del almacén (campos desconocidos o de tipo equivocado se ignoran). */
export function sanearPreferencias(crudo) {
  const p = { ...PREFERENCIAS_POR_DEFECTO };
  if (!esObjetoPlano(crudo)) return p;
  if (esId(crudo.ultimaCuentaId)) p.ultimaCuentaId = crudo.ultimaCuentaId;
  if (esId(crudo.ultimaCategoriaId)) p.ultimaCategoriaId = crudo.ultimaCategoriaId;
  if (typeof crudo.vibracion === 'boolean') p.vibracion = crudo.vibracion;
  if (typeof crudo.bienvenidaOculta === 'boolean') p.bienvenidaOculta = crudo.bienvenidaOculta;
  return p;
}

/** @param {{leer(clave:string):any, escribir(clave:string, texto:string):any}} almacen */
export function crearPreferencias(almacen) {
  let actual = null;
  function leer() {
    if (actual) return { ...actual };
    let crudo = null;
    const r = almacen.leer(CLAVE_DISPOSITIVO);
    if (r.ok && r.texto !== null) {
      try {
        crudo = JSON.parse(r.texto, reviverSeguro);
      } catch {
        crudo = null;
      }
    }
    actual = sanearPreferencias(crudo);
    return { ...actual };
  }
  function guardar(parcial) {
    actual = sanearPreferencias({ ...leer(), ...parcial });
    const r = almacen.escribir(CLAVE_DISPOSITIVO, JSON.stringify(actual)); // si falla, la preferencia vive en memoria
    return r.ok;
  }
  return { leer, guardar };
}
