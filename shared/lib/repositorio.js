/*
 * repositorio.js — cargar → migrar → validar → guardar, con respaldo y detección de conflicto entre pestañas.
 * Contrato: docs/UTILIDADES.md §7 (y su Errata). Una sola clave por app = escritura atómica.
 *
 * Avisos: lista de { ruta, mensaje } (los de validar) o { ruta:'', codigo, mensaje } (los propios del repositorio).
 * cargar() nunca lanza: un `validar`/`crearSemilla` que lanza o devuelve basura se trata como datos ilegibles
 * (estado 'corrupto', con pantalla de recuperación) y se reporta con reportError si existe.
 */
import { MENSAJES_ERROR } from './storage.js';
import { esObjetoPlano, reviverSeguro } from './validacion.js';

const PATRON_REV = /^\{"schemaVersion":\d+,"app":"[a-z]+","rev":(\d+)/;

/** Número `rev` leído por expresión regular del inicio del texto guardado, o null (puro). */
export function leerRev(texto) {
  if (typeof texto !== 'string') return null;
  const m = PATRON_REV.exec(texto);
  return m ? Number(m[1]) : null;
}

/**
 * rev del texto guardado: primero por expresión regular (rápido); si no coincide, por JSON.parse (texto válido con otro
 * orden de claves, R0-26). null si no hay texto o es ilegible (no hay nada con qué comparar).
 */
function revGuardada(texto) {
  if (typeof texto !== 'string') return null;
  const rapida = leerRev(texto);
  if (rapida !== null) return rapida;
  try {
    const o = JSON.parse(texto, reviverSeguro);
    return esObjetoPlano(o) && Number.isSafeInteger(o.rev) && o.rev >= 0 ? o.rev : null;
  } catch {
    return null;
  }
}

/**
 * Aplica migraciones[n] para n = datos.schemaVersion … version−1 (puro). Cada migración devuelve la versión n+1 con
 * schemaVersion: n+1. Lanza Error si falta una migración o devuelve algo inconsistente.
 */
export function migrar(datos, version, migraciones = {}) {
  if (!esObjetoPlano(datos) || !Number.isInteger(datos.schemaVersion)) throw new TypeError('migrar requiere datos con schemaVersion entero.');
  if (datos.schemaVersion > version) throw new RangeError('Los datos son de una versión más nueva que la app.');
  let actual = datos;
  for (let n = datos.schemaVersion; n < version; n += 1) {
    const paso = migraciones[n];
    if (typeof paso !== 'function') throw new Error(`Falta la migración de la versión ${n} a la ${n + 1}.`);
    const siguiente = paso(actual);
    if (!esObjetoPlano(siguiente) || siguiente.schemaVersion !== n + 1) {
      throw new Error(`La migración ${n}→${n + 1} debe devolver un objeto con schemaVersion ${n + 1}.`);
    }
    actual = siguiente;
  }
  return actual;
}

const ERROR_FORMA = Object.freeze({ ruta: '', mensaje: 'Los datos no tienen la forma esperada.' });

/**
 * Llama al `validar` de la app sin dejar escapar excepciones ni resultados mal formados (R0-03). Nunca lanza.
 * → { ok:true, datos, avisos } | { ok:false, errores, avisos }
 */
export function validarSeguro(validar, obj) {
  let v;
  try {
    v = validar(obj);
  } catch {
    return { ok: false, errores: [{ ...ERROR_FORMA }], avisos: [] };
  }
  const avisos = v && Array.isArray(v.avisos) ? v.avisos : [];
  if (!v || typeof v !== 'object') return { ok: false, errores: [{ ...ERROR_FORMA }], avisos };
  if (v.ok === true && esObjetoPlano(v.datos)) return { ok: true, datos: v.datos, avisos };
  const errores = Array.isArray(v.errores) && v.errores.length ? v.errores : [{ ...ERROR_FORMA }];
  return { ok: false, errores, avisos };
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

function fallaConMensaje(error, mensaje) {
  return { ok: false, error, mensaje: mensaje ?? MENSAJES_ERROR[error] ?? MENSAJES_ERROR.desconocido };
}

function resultadoAviso(codigo, mensaje) {
  return { ruta: '', codigo, mensaje };
}

/** Días que dura un respaldo automático antes de caducar (R1-03). */
export const DIAS_RESPALDO = 14;
const MS_DIA = 86_400_000;
/** Con una edad mayor que esto (o 4 × `dias`, lo que sea más) el respaldo no se descarta solo: puede ser un reloj mal puesto (R2G-03). */
export const DIAS_SALTO_RELOJ = 60;
// respaldar() escribe { "motivo", "fecha", "datos" } en ese orden: motivo y fecha se leen del inicio sin parsear toda la copia.
const PATRON_ENCABEZADO_RESPALDO = /^\{"motivo":"((?:[^"\\]|\\.)*)","fecha":"([^"]+)"/;
// R3G-10: la copia completa tiene "datos":{ justo tras el encabezado y termina en "}}"; se comprueba sin parsear (barato).
const PATRON_INICIO_DATOS_RESPALDO = /^\{"motivo":"(?:[^"\\]|\\.)*","fecha":"[^"]+","datos":\{/;

/** Mensaje estándar del error 'sin-respaldo' (UTILIDADES, Errata E-3). */
export const MENSAJE_SIN_RESPALDO =
  'No hay espacio para un respaldo previo. Exporte sus datos a un archivo o confirme que desea continuar sin respaldo.';

/** rev entero ≥ 0 del objeto, o null. */
const revDe = (o) => (o && Number.isSafeInteger(o.rev) && o.rev >= 0 ? o.rev : null);

/**
 * @param {object} o
 * @param {object} o.almacen    de crearAlmacen (expone prefijo, modo, leer, escribir, borrar)
 * @param {string} o.clave      clave completa de los datos, p. ej. 'cte.gimnasio.datos'
 * @param {string} o.app        'gimnasio' | 'finanzas'
 * @param {number} o.version    schemaVersion actual
 * @param {object} o.migraciones
 * @param {(obj:any)=>{ok:boolean,datos?:any,errores?:any[],avisos?:any[]}} o.validar
 * @param {(ctx:{hoy:string,ahora:string,generarId:Function})=>object} o.crearSemilla
 * @param {{hoy():string,instanteISO():string}} o.reloj
 * @param {Function} [o.generarId]
 */
export function crearRepositorio({ almacen, clave, app, version, migraciones = {}, validar, crearSemilla, reloj, generarId }) {
  const claveRespaldo = almacen.prefijo + 'respaldo';
  const claveCorrupto = almacen.prefijo + 'corrupto';
  // R2G-01: instante desde el que cuentan los días de caducidad del respaldo (la última vez que fue la única copia útil, o la
  // primera vez que se vio un respaldo con fecha futura). Persistente: la protección en memoria se pierde con la recarga.
  const claveDesde = almacen.prefijo + 'respaldo-desde';
  // R3G-05: día ('AAAA-MM-DD|fecha del respaldo') en que se vio por primera vez un respaldo inverosímilmente antiguo; solo se descarta
  // en un arranque de otro día posterior, para que un reloj mal puesto no borre una copia reciente y, a la vez, no quede para siempre.
  const claveVisto = almacen.prefijo + 'respaldo-visto';
  let modoActual = almacen.modo === 'memoria' ? 'memoria' : 'normal';
  // true cuando la última carga dejó el respaldo como única copia útil (datos ilegibles, versión futura o migración sin guardar).
  let respaldoProtegido = false;
  // R3G-06: true si el último arranque no pudo escribir la marca de caducidad (cuota llena): sin marca persistida no se caduca nada.
  let marcaFallida = false;
  // R3G-10: respaldo ('fecha|largo') que se intentó leer entero y resultó dañado (solo memoria; infoRespaldo lo informa como dañado).
  let respaldoDanado = null;

  function respaldar(datos, motivo) {
    let texto;
    try {
      texto = JSON.stringify({ motivo, fecha: reloj.instanteISO(), datos });
    } catch {
      return fallaConMensaje('desconocido');
    }
    const r = almacen.escribir(claveRespaldo, texto);
    if (r.ok) { olvidarDesde(); marcaFallida = false; respaldoDanado = null; } // copia nueva: su propia fecha manda
    return r.ok ? { ok: true } : fallaConMensaje(r.error, r.mensaje);
  }

  /** Instante (ms) guardado en la marca `respaldo-desde`, o null (no existe o no se entiende). */
  function leerDesde() {
    const r = almacen.leer(claveDesde);
    if (!r.ok || typeof r.texto !== 'string') return null;
    const ms = Date.parse(r.texto);
    return Number.isFinite(ms) ? ms : null;
  }

  /** Escribe la marca. → true si quedó persistida (R3G-06: sin marca persistida no se caduca nada); false si no cupo. */
  function marcarDesde(ms) {
    return almacen.escribir(claveDesde, new Date(ms).toISOString()).ok === true;
  }

  /** Día ('AAAA-MM-DD') anotado en `respaldo-visto` para ESTE respaldo (misma fecha), o null (no hay, es de otra copia o no se entiende). */
  function leerVisto(fechaRespaldo) {
    const r = almacen.leer(claveVisto);
    if (!r.ok || typeof r.texto !== 'string') return null;
    const m = /^(\d{4}-\d{2}-\d{2})\|(.*)$/s.exec(r.texto);
    return m && m[2] === fechaRespaldo ? m[1] : null;
  }

  function marcarVisto(hoy, fechaRespaldo) {
    return almacen.escribir(claveVisto, `${hoy}|${fechaRespaldo}`).ok === true;
  }

  function olvidarVisto() {
    const r = almacen.leer(claveVisto);
    if (r.ok && r.texto !== null) almacen.borrar(claveVisto);
  }

  function olvidarDesde() {
    const r = almacen.leer(claveDesde);
    if (r.ok && r.texto !== null) almacen.borrar(claveDesde);
  }

  function hayRespaldo() {
    const r = almacen.leer(claveRespaldo);
    return r.ok && r.texto !== null;
  }

  function leerRespaldo() {
    const r = almacen.leer(claveRespaldo);
    if (!r.ok || r.texto === null) return null;
    let o = null;
    try {
      o = JSON.parse(r.texto, reviverSeguro);
    } catch {
      /* dañado: se anota más abajo */
    }
    if (esObjetoPlano(o) && typeof o.motivo === 'string' && typeof o.fecha === 'string' && esObjetoPlano(o.datos)) {
      return { motivo: o.motivo, fecha: o.fecha, datos: o.datos };
    }
    const m = PATRON_ENCABEZADO_RESPALDO.exec(r.texto);
    if (m) respaldoDanado = `${m[2]}|${r.texto.length}`; // R3G-10: desde ahora infoRespaldo lo informa como dañado
    return null;
  }

  /**
   * Lo que se sabe del respaldo SIN parsearlo entero: { motivo, fecha, completo } (completo: lleva `"datos":{` tras el encabezado y
   * termina en `}}`, o ya se comprobó que se puede leer; R3G-10); null si no hay; { motivo:null, fecha:null, completo:false } si no se lee.
   */
  function inspeccionarRespaldo() {
    const r = almacen.leer(claveRespaldo);
    if (!r.ok || r.texto === null) return null;
    const m = PATRON_ENCABEZADO_RESPALDO.exec(r.texto);
    if (m) {
      const completo = PATRON_INICIO_DATOS_RESPALDO.test(r.texto) && r.texto.endsWith('}}') && respaldoDanado !== `${m[2]}|${r.texto.length}`;
      return { motivo: m[1], fecha: m[2], completo };
    }
    try {
      const o = JSON.parse(r.texto, reviverSeguro);
      if (esObjetoPlano(o) && typeof o.motivo === 'string' && typeof o.fecha === 'string') return { motivo: o.motivo, fecha: o.fecha, completo: esObjetoPlano(o.datos) };
    } catch {
      /* ilegible */
    }
    return { motivo: null, fecha: null, completo: false };
  }

  /** { motivo, fecha } del respaldo leyendo solo su encabezado (barato); null si no hay; { motivo:null, fecha:null } si no se lee. */
  function encabezadoRespaldo() {
    const info = inspeccionarRespaldo();
    return info ? { motivo: info.motivo, fecha: info.fecha } : null;
  }

  /**
   * Estado del respaldo según el reloj (puro: no escribe). Los días cuentan desde `inicio`:
   *  - la marca `respaldo-desde` si existe: la última vez que el respaldo fue la única copia útil (R2G-01), o la primera vez que se
   *    vio con fecha futura (R2G-03b);
   *  - sin marca (copia normal, o la marca no se entiende): la fecha del respaldo, y `marcar` pide escribirla (R3G-06: sin marca
   *    persistida no se caduca nada; si no cupiera, descartarRespaldoVencido conserva el respaldo y Ajustes lo avisa).
   * → { estado: 'sin-respaldo'|'ilegible'|'danado'|'vigente'|'vencido'|'salto-de-reloj', motivo, fecha, fechaFutura, inicio, caduca, marcar }
   *   (`marcar`: instante que debería guardarse en la marca; solo lo aplica descartarRespaldoVencido).
   */
  function evaluarRespaldo(dias) {
    const info = inspeccionarRespaldo();
    if (!info) return { estado: 'sin-respaldo' };
    const base = { motivo: info.motivo, fecha: info.fecha };
    if (info.motivo === null) return { estado: 'ilegible', ...base };
    const creado = Date.parse(info.fecha ?? '');
    const ahora = Date.parse(reloj.instanteISO());
    if (!Number.isFinite(creado) || !Number.isFinite(ahora)) return { estado: 'ilegible', ...base };
    if (!info.completo) return { estado: 'danado', ...base }; // R3G-10: encabezado bueno, cuerpo truncado o dañado
    let desde = leerDesde();
    const sinMarca = desde === null;
    let marcar = null;
    if (desde !== null && desde > ahora) { desde = ahora; marcar = ahora; } // marca del futuro: se vuelve a contar desde ahora
    const fechaFutura = creado > ahora;
    if (fechaFutura && desde === null) { desde = ahora; marcar = ahora; } // fecha desconocida: cuenta desde que se vio
    else if (sinMarca) marcar = creado; // R3G-06: la marca se escribe al verlo
    const inicio = desde ?? creado; // la marca manda: es posterior a la fecha, o la fecha no es fiable
    const edad = ahora - inicio;
    const caduca = inicio + dias * MS_DIA;
    const salto = Math.max(DIAS_SALTO_RELOJ, dias * 4) * MS_DIA;
    const estado = edad > salto ? 'salto-de-reloj' : edad > dias * MS_DIA ? 'vencido' : 'vigente';
    return { estado, ...base, fechaFutura, inicio, caduca: estado === 'salto-de-reloj' ? null : caduca, marcar };
  }

  /**
   * Descarta el respaldo automático si tiene más de `dias` días (R1-03). Se llama al abrir la app. NUNCA descarta:
   *  - si la última carga lo dejó como única copia útil (datos ilegibles, versión futura, migración sin guardar): 'protegido'
   *    (y deja la marca `respaldo-desde`: los 14 días empiezan cuando deje de serlo, aunque la app se recargue: R2G-01);
   *  - si no se puede leer su fecha o está dañado: 'ilegible' | 'danado' (no se borra lo que no se entiende; Ajustes lo muestra con "Descartar");
   *  - si no se pudo persistir la marca de caducidad (cuota llena): 'sin-marca' (R3G-06: sin marca persistida no se caduca nada);
   *  - si su fecha está en el futuro (el reloj estuvo mal): 'vigente', contando desde la primera vez que se vio (R2G-03);
   *  - si es inverosímilmente antiguo (más de 60 días: un reloj adelantado lo "envejecería", o no se abrió la app en meses): 'salto-de-reloj'
   *    en el primer arranque en que se ve así; se descarta en el primer arranque de OTRO día posterior en que siga igual de antiguo
   *    (R3G-05; marca `respaldo-visto`: si el reloj se corrige entre ambos, la cuenta se reinicia).
   * → { descartado:boolean, razon?:string, fecha?:string, motivo?:string }. No lanza.
   */
  function descartarRespaldoVencido({ dias = DIAS_RESPALDO } = {}) {
    if (respaldoProtegido) {
      if (hayRespaldo()) marcaFallida = !marcarDesde(Date.parse(reloj.instanteISO()));
      return { descartado: false, razon: 'protegido' };
    }
    const ev = evaluarRespaldo(dias);
    if (ev.estado === 'sin-respaldo') {
      olvidarDesde();
      olvidarVisto();
      marcaFallida = false;
      return { descartado: false, razon: 'sin-respaldo' };
    }
    if (ev.estado === 'ilegible' || ev.estado === 'danado') return { descartado: false, razon: ev.estado };
    if (ev.marcar !== null) {
      marcaFallida = !marcarDesde(ev.marcar);
      if (marcaFallida) return { descartado: false, razon: 'sin-marca' };
    } else marcaFallida = false;
    if (ev.estado === 'vigente') {
      olvidarVisto();
      return { descartado: false, razon: 'vigente' };
    }
    if (ev.estado === 'salto-de-reloj') {
      const hoy = reloj.hoy();
      const visto = leerVisto(ev.fecha);
      if (visto === null || visto > hoy) { // primera vez (o el reloj retrocedió): se anota el día y no se descarta
        if (!marcarVisto(hoy, ev.fecha)) { marcaFallida = true; return { descartado: false, razon: 'sin-marca' }; }
        return { descartado: false, razon: 'salto-de-reloj' };
      }
      if (visto === hoy) return { descartado: false, razon: 'salto-de-reloj' }; // mismo día: otra recarga no basta
    }
    const b = almacen.borrar(claveRespaldo);
    if (!b.ok) return { descartado: false, razon: 'error' };
    olvidarDesde();
    olvidarVisto();
    return { descartado: true, fecha: ev.fecha, motivo: ev.motivo };
  }

  /**
   * Lo que Ajustes necesita saber del respaldo sin parsearlo entero (R2G-06) y sin escribir (R2G-03c). null si no hay.
   * → { motivo, fecha, ilegible, fechaFutura, caduca: ms|null, sinCaducar: 'salto-de-reloj'|'sin-marca'|null, danado?: true }
   *   ilegible: la clave existe pero no se entiende su encabezado o su fecha (motivo null = ni siquiera el motivo), o está dañada
   *   (`danado: true`: encabezado bueno pero cuerpo truncado o que no se pudo leer al restaurar; R3G-10).
   *   sinCaducar 'sin-marca': no se pudo guardar la marca de caducidad (sin espacio): se conserva y no caduca (R3G-06).
   */
  function infoRespaldo({ dias = DIAS_RESPALDO } = {}) {
    const ev = evaluarRespaldo(dias);
    if (ev.estado === 'sin-respaldo') return null;
    if (ev.estado === 'ilegible') return { motivo: ev.motivo, fecha: ev.fecha, ilegible: true, fechaFutura: false, caduca: null, sinCaducar: null };
    if (ev.estado === 'danado') return { motivo: ev.motivo, fecha: ev.fecha, ilegible: true, danado: true, fechaFutura: false, caduca: null, sinCaducar: null };
    const sinMarca = marcaFallida && ev.marcar !== null;
    return {
      motivo: ev.motivo, fecha: ev.fecha, ilegible: false, fechaFutura: ev.fechaFutura,
      caduca: sinMarca ? null : ev.caduca, sinCaducar: sinMarca ? 'sin-marca' : ev.estado === 'salto-de-reloj' ? 'salto-de-reloj' : null,
    };
  }

  /** Borra el respaldo automático a petición de la persona (con confirmación en la vista). */
  function descartarRespaldo() {
    const b = almacen.borrar(claveRespaldo);
    if (b.ok) { olvidarDesde(); olvidarVisto(); marcaFallida = false; respaldoDanado = null; }
    return b.ok ? { ok: true } : fallaConMensaje(b.error, b.mensaje);
  }

  /** rev actualmente guardado (o null si no hay texto o no se puede leer la rev). Para reemplazar sobre datos corruptos. */
  function revActual() {
    const r = almacen.leer(clave);
    return r.ok ? revGuardada(r.texto) : null;
  }

  /**
   * @param {object} datos
   * @param {number} revBase
   * @param {{ conservarRespaldo?: boolean }} [opciones]  conservarRespaldo:true → con cuota llena NO borra la ranura
   *   `respaldo` para reintentar y devuelve 'cuota-llena' (R0-01). Por defecto false: comportamiento de §7.2 paso 5.
   */
  function guardar(datos, revBase, { conservarRespaldo = false } = {}) {
    if (modoActual === 'solo-lectura') return fallaConMensaje('solo-lectura');
    if (!esObjetoPlano(datos)) throw new TypeError('guardar requiere un objeto de datos.');
    if (!Number.isInteger(revBase) || revBase < 0) throw new TypeError('revBase debe ser un entero ≥ 0.');

    const previo = almacen.leer(clave);
    if (!previo.ok) return fallaConMensaje(previo.error, previo.mensaje);
    const revPrevia = revGuardada(previo.texto);
    if (revPrevia !== null && revPrevia !== revBase) return fallaConMensaje('conflicto');

    const { schemaVersion: _v, app: _a, rev: _r, ...resto } = datos;
    const nuevo = { schemaVersion: version, app, rev: revBase + 1, ...resto, actualizadoEn: reloj.instanteISO() };
    let texto;
    try {
      texto = JSON.stringify(nuevo);
    } catch {
      return fallaConMensaje('desconocido');
    }

    let r = almacen.escribir(clave, texto);
    const avisos = [];
    if (!r.ok && r.error === 'cuota-llena' && !conservarRespaldo) {
      const respaldo = almacen.leer(claveRespaldo);
      if (respaldo.ok && respaldo.texto !== null) {
        const borrado = almacen.borrar(claveRespaldo);
        if (borrado.ok) {
          olvidarDesde();
          avisos.push(resultadoAviso('respaldo-eliminado', 'Se eliminó el respaldo automático para liberar espacio.'));
          r = almacen.escribir(clave, texto);
        }
      }
    }
    if (!r.ok) return { ...fallaConMensaje(r.error, r.mensaje), ...(avisos.length ? { avisos } : {}) };
    // R2G-01: si el respaldo era la única copia útil, guardar datos nuevos (empezar de cero, importar, restaurar) deja de hacerlo
    // protegido: desde ESTE instante cuentan sus días. Persistente, porque la app se recarga justo después.
    if (respaldoProtegido) {
      if (hayRespaldo()) marcaFallida = !marcarDesde(Date.parse(reloj.instanteISO())); // R3G-06: si no cupo, el próximo arranque no caduca nada
      respaldoProtegido = false; // con la marca puesta, la cuenta de días ya no depende de la memoria
    }
    return { ok: true, datos: nuevo, ...(avisos.length ? { avisos } : {}) };
  }

  /** Copia el texto ilegible a <prefijo>corrupto si es distinto del que ya hay (R0-08). → aviso si no cupo, o null. */
  function preservarCorrupto(texto) {
    if (typeof texto !== 'string') return null;
    const actual = almacen.leer(claveCorrupto);
    if (actual.ok && actual.texto === texto) return null;
    const r = almacen.escribir(claveCorrupto, texto);
    return r.ok
      ? null
      : resultadoAviso('corrupto-no-preservado', 'No hay espacio para guardar una copia de los datos ilegibles. Expórtelos antes de empezar de cero.');
  }

  function corrupto(texto, errores, avisos) {
    const aviso = preservarCorrupto(texto);
    if (aviso) avisos.push(aviso);
    return { estado: 'corrupto', datos: null, avisos, errores, textoCrudo: texto };
  }

  /** Datos validados con `rev` entero: si el `validar` de la app lo omitió, se toma de la fuente (R0-07). */
  function conRev(datos, fuente) {
    if (revDe(datos) !== null) return datos;
    return { ...datos, rev: revDe(fuente) ?? 0 };
  }

  function cargar() {
    const avisos = [];
    const visto = { texto: null };
    let resultado;
    try {
      resultado = cargarSinProteger(avisos, visto);
    } catch (e) {
      // Error de programación de la app (semilla inválida, migración o validador defectuoso…): no tumba el arranque.
      reportar(e);
      const detalle = e && e.message ? e.message : String(e);
      resultado = corrupto(visto.texto, [{ ruta: '', mensaje: `Error inesperado al cargar los datos: ${detalle}` }], avisos);
    }
    respaldoProtegido = resultado.estado === 'corrupto' || resultado.estado === 'version-futura' || !!resultado.errorGuardado;
    return resultado;
  }

  function cargarSinProteger(avisos, visto) {
    const lectura = almacen.leer(clave);
    if (!lectura.ok) {
      modoActual = 'memoria';
      avisos.push(resultadoAviso(lectura.error, lectura.mensaje));
      return { estado: 'sin-almacenamiento', datos: semilla(), avisos };
    }
    modoActual = almacen.modo === 'memoria' ? 'memoria' : 'normal';
    const sinAlmacenamiento = almacen.modo === 'memoria';
    const texto = lectura.texto;
    visto.texto = texto;

    // Paso 2: clave vacía → semilla
    if (texto === null) {
      const inicial = semilla();
      const r = guardar(inicial, inicial.rev);
      if (!r.ok) {
        avisos.push(resultadoAviso(r.error, r.mensaje));
        return { estado: sinAlmacenamiento ? 'sin-almacenamiento' : 'nuevo', datos: inicial, avisos, errorGuardado: { error: r.error, mensaje: r.mensaje } };
      }
      if (r.avisos) avisos.push(...r.avisos);
      return { estado: sinAlmacenamiento ? 'sin-almacenamiento' : 'nuevo', datos: r.datos, avisos };
    }

    // Paso 3: ilegible, de otra app o sin versión entera
    let parseado;
    try {
      parseado = JSON.parse(texto, reviverSeguro);
    } catch {
      return corrupto(texto, [{ ruta: '', mensaje: 'El texto guardado no es JSON válido.' }], avisos);
    }
    if (!esObjetoPlano(parseado) || parseado.app !== app || !Number.isInteger(parseado.schemaVersion) || parseado.schemaVersion < 1) {
      return corrupto(texto, [{ ruta: '', mensaje: 'Los datos guardados no pertenecen a esta app o no tienen versión.' }], avisos);
    }

    // Paso 4: versión futura → solo lectura
    if (parseado.schemaVersion > version) {
      modoActual = 'solo-lectura';
      return { estado: 'version-futura', datos: parseado, avisos };
    }

    // Paso 5: migrar
    let estado = 'ok';
    let aValidar = parseado;
    let respaldoEscrito = false;
    if (parseado.schemaVersion < version) {
      estado = 'migrado';
      const rb = respaldar(parseado, `antes-de-migrar-v${parseado.schemaVersion}`);
      respaldoEscrito = rb.ok;
      if (!rb.ok) avisos.push(resultadoAviso('respaldo-fallido', 'No se pudo guardar un respaldo antes de migrar: ' + rb.mensaje));
      try {
        aValidar = migrar(parseado, version, migraciones);
      } catch (e) {
        return corrupto(texto, [{ ruta: '', mensaje: `No se pudo migrar los datos: ${e.message}` }], avisos);
      }
    }

    // Pasos 6–7: validar (protegido: R0-03)
    const v = validarSeguro(validar, aValidar);
    if (v.avisos.length) avisos.push(...v.avisos);
    if (!v.ok) return corrupto(texto, v.errores, avisos);
    const datos = conRev(v.datos, parseado);

    if (estado === 'migrado') {
      // Sin respaldo no se pisa el texto original al arrancar: se migra solo en memoria y la vista lo avisa (R0-02).
      if (!respaldoEscrito) {
        return { estado: 'migrado', datos, avisos, errorGuardado: { error: 'sin-respaldo', mensaje: MENSAJE_SIN_RESPALDO } };
      }
      // Con respaldo: guardar SIN borrarlo; si no cabe todo, también queda solo en memoria (R0-01/R0-02).
      const r = guardar(datos, datos.rev, { conservarRespaldo: true });
      if (r.avisos) avisos.push(...r.avisos);
      if (!r.ok) {
        avisos.push(
          r.error === 'cuota-llena'
            ? resultadoAviso('migrado-sin-guardar', 'Los datos se actualizaron solo en esta sesión: no hay espacio para guardarlos junto con el respaldo. Exporte sus datos en Ajustes.')
            : resultadoAviso(r.error, r.mensaje),
        );
        return { estado: 'migrado', datos, avisos, errorGuardado: { error: r.error, mensaje: r.mensaje } };
      }
      return { estado: 'migrado', datos: r.datos, avisos };
    }
    return { estado: sinAlmacenamiento ? 'sin-almacenamiento' : 'ok', datos, avisos };
  }

  /** Semilla validada. Si no valida es un error de programación de la app: lanza (cargar() lo convierte en 'corrupto'). */
  function semilla() {
    const bruta = crearSemilla({ hoy: reloj.hoy(), ahora: reloj.instanteISO(), generarId });
    const v = validarSeguro(validar, bruta);
    if (!v.ok) {
      const detalle = (v.errores ?? []).slice(0, 3).map((e) => `${e.ruta}: ${e.mensaje}`).join('; ');
      throw new Error(`La semilla de ${app} no pasa la validación (${detalle}).`);
    }
    return conRev(v.datos, bruta);
  }

  return {
    cargar,
    guardar,
    respaldar,
    leerRespaldo,
    encabezadoRespaldo,
    infoRespaldo,
    descartarRespaldoVencido,
    descartarRespaldo,
    revActual,
    modo: () => modoActual,
  };
}
