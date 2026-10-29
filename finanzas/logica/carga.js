/*
 * carga.js — avisos al cargar datos ya guardados (PURO). R2F-13 (parte de carga) y R3F-01.
 *
 * Al cargar, la app valida con `validar(obj, { modo: 'carga' })` (esquema.js): solo se enmascaran, en memoria, las TARJETAS DE ALTA
 * CONFIANZA de textos ya guardados (13 a 19 dígitos con Luhn válido y marca conocida) y se devuelve un aviso `numero-largo` por campo.
 * Todo lo demás que el detector marcaría al escribir (posibles cuentas de 10 a 12 dígitos, variantes dudosas) se deja INTACTO y solo
 * genera un aviso `numero-dudoso` (con la huella del texto): la app no reescribe en silencio lo que una versión anterior aceptó.
 *
 * `app.js` usa este resumen para (1) mostrar UN solo aviso claro de lo enmascarado y OTRO de lo dudoso, con concordancia
 * singular/plural, en lugar de uno por campo; (2) guardar los datos ya saneados (acción `guardarSaneado`) solo si se enmascaró algo; y
 * (3) no repetir el aviso de lo dudoso en cada apertura: las huellas de los textos ya avisados se recuerdan en este dispositivo
 * (clave `numeros-avisados`, que no se exporta). Si el texto cambia, su huella cambia y vuelve a avisar.
 */
import { describirRuta, hayCuentasOcultas, textoOcultados } from './importacion.js';

/** Clave (dentro del almacén `cte.finanzas.`) con las huellas de los textos dudosos que ya se avisaron. */
export const CLAVE_NUMEROS_AVISADOS = 'cte.finanzas.numeros-avisados';
const MAX_HUELLAS = 300;

/** Huellas ya avisadas. Nunca lanza: sin almacenamiento o con texto dañado devuelve un conjunto vacío. */
export function leerVistos(almacen) {
  try {
    const r = almacen.leer(CLAVE_NUMEROS_AVISADOS);
    if (!r.ok || r.texto === null) return new Set();
    const lista = JSON.parse(r.texto);
    return new Set(Array.isArray(lista) ? lista.filter((x) => typeof x === 'string' && /^[0-9a-f]{8}$/.test(x)) : []);
  } catch {
    return new Set();
  }
}

/** Agrega huellas a las ya avisadas (se conservan las últimas MAX_HUELLAS). Devuelve true si se pudo guardar. */
export function guardarVistos(almacen, vistos, nuevas) {
  try {
    const todas = [...new Set([...vistos, ...nuevas])].slice(-MAX_HUELLAS);
    return almacen.escribir(CLAVE_NUMEROS_AVISADOS, JSON.stringify(todas)).ok === true;
  } catch {
    return false;
  }
}

/** Concordancia: "Hay 1 texto guardado que parece…" / "Hay 3 textos guardados que parecen…". `rutas` ya vienen descritas. */
export function textoDudosos(n, rutas = []) {
  const donde = rutas.length ? ` (${rutas.slice(0, 3).join(' · ')}${n > rutas.length || rutas.length > 3 ? ' …' : ''})` : '';
  return n === 1
    ? `Hay 1 texto guardado que parece incluir un número de tarjeta o de cuenta${donde}. La app no lo cambió: revísalo y quita el número si lo es.`
    : `Hay ${n} textos guardados que parecen incluir números de tarjeta o de cuenta${donde}. La app no los cambió: revísalos y quita los números si lo son.`;
}

/**
 * @param {Array<{codigo?:string, mensaje?:string, ruta?:string, tipo?:string, huella?:string}>} avisos avisos de la carga del repositorio
 * @param {{vistos?: Set<string>}} [opciones] huellas de textos dudosos que ya se avisaron (no se vuelven a avisar)
 * @returns {{otros:Array, numeros:number, aviso:null|{codigo:string, mensaje:string}, dudosos:number, avisoDudosos:null|{codigo:string, mensaje:string, huellas:string[]}}}
 *   `otros`: los avisos que no son de números (se muestran como siempre); `numeros`: cuántos campos se enmascararon (alta confianza);
 *   `aviso`: el aviso único de números ocultados (null si no hubo); `dudosos`: cuántos textos dudosos NUEVOS hay;
 *   `avisoDudosos`: el aviso único de lo dudoso, con las huellas que hay que marcar como vistas una vez mostrado.
 */
export function resumirAvisosDeCarga(avisos, { vistos = new Set() } = {}) {
  const lista = (avisos ?? []).filter((a) => a && a.codigo);
  const numeros = lista.filter((a) => a.codigo === 'numero-largo');
  const dudosos = lista.filter((a) => a.codigo === 'numero-dudoso' && !vistos.has(a.huella));
  const otros = lista.filter((a) => a.codigo !== 'numero-largo' && a.codigo !== 'numero-dudoso');
  let aviso = null;
  if (numeros.length) {
    const unico = numeros.length === 1;
    const mensaje = `${textoOcultados(numeros.length, { conCuentas: hayCuentasOcultas(numeros) })} en tus notas o nombres guardados: la app no guarda números de tarjeta ni de cuenta. ${unico ? 'Ya quedó oculto' : 'Ya quedaron ocultos'}.`;
    aviso = { codigo: 'numero-largo', mensaje };
  }
  let avisoDudosos = null;
  if (dudosos.length) {
    avisoDudosos = { codigo: 'numero-dudoso', mensaje: textoDudosos(dudosos.length, dudosos.map((a) => describirRuta(a.ruta)).filter(Boolean)), huellas: dudosos.map((a) => a.huella).filter(Boolean) };
  }
  return { otros, numeros: numeros.length, aviso, dudosos: dudosos.length, avisoDudosos };
}
