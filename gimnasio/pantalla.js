/*
 * pantalla.js — Wake Lock de la app (R2G-02b). La pantalla se mantiene encendida mientras CUALQUIERA de las dos personas tenga una
 * sesión en curso con actividad reciente, sin importar a quién se esté mirando ni en qué pantalla se esté: un solo celular lo
 * comparten las dos personas.
 * Tope de inactividad: si pasan más de 90 minutos sin actividad (ver `ultimaActividadMs`) se suelta, para que una sesión olvidada
 * sin terminar no deje el celular encendido durante horas; en cuanto hay actividad nueva (una serie marcada, un stepper guardado,
 * un descanso, cardio) se vuelve a pedir.
 * R3G-04: una actividad en el futuro (reloj adelantado y luego corregido) cuenta desde el primer instante en que se vio, y ninguna
 * espera de temporizador pasa de lo que admite setTimeout (2^31−1 ms): antes, con ≥ 25 días de diferencia, el navegador lo disparaba
 * de inmediato y `actualizar()` se repetía cada ~4 ms.
 * R3G-09: `estado()` sigue al bloqueo real (lo suelta el sistema al ocultar la app; se vuelve a pedir al volver y la insignia lo refleja).
 */
import { crearWakeLock } from '../shared/lib/dispositivo.js';
import { sesionesConActividadReciente, sesionesActivas, ultimaActividadMs, actividadRegistradaMs, TOPE_INACTIVIDAD_MS, MAX_ESPERA_TEMPORIZADOR_MS } from './logica/descansos.js';

/** Mínimo entre dos reintentos de pedir un bloqueo que el sistema rechazó o soltó (no se insiste en cada cambio). */
const REINTENTO_MS = 5000;

/**
 * @param {{ tienda: {datos():object|null}, reloj: {hoy():string, ahora():number}, prefs: {obtener():{pantalla:boolean}},
 *   finDescanso?: (sesionId:string)=>number|null }} o   finDescanso: fin (ms) del descanso de esa sesión (un descanso corriendo es actividad)
 * @param {{ crear?: Function, temporizador?: { poner(fn:Function, ms:number):any, quitar(id:any):void }, visible?: () => boolean }} [inyectado]
 *   fábricas para pruebas: Wake Lock falso, temporizador falso y visibilidad de la página
 */
export function crearPantallaActiva({ tienda, reloj, prefs, finDescanso = () => null }, {
  crear = crearWakeLock,
  temporizador = { poner: (fn, ms) => setTimeout(fn, ms), quitar: (id) => clearTimeout(id) },
  visible = () => !globalThis.document || globalThis.document.visibilityState !== 'hidden',
} = {}) {
  let wake = null;
  let estadoGuardado = 'inactivo'; // inactivo | pendiente | activo | no-soportado
  let vencimiento = null; // temporizador que suelta el bloqueo al cumplirse el tope
  let ultimoIntento = -Infinity; // reloj.ahora() del último reintento de pedir el bloqueo
  const anclas = new Map(); // sesionId → primer instante (ms) en que se vio su actividad en el futuro (R3G-04)
  const oyentes = new Set();
  const avisar = () => { for (const f of [...oyentes]) { try { f(estado()); } catch { /* un oyente defectuoso no rompe los demás */ } } };

  /** Estado real: con un bloqueo que informa `activo()`, lo que tiene el sistema ahora (no lo último que se pidió). */
  function estado() {
    if (!wake) return 'inactivo';
    if (!wake.soportado) return 'no-soportado';
    if (typeof wake.activo === 'function') {
      if (wake.activo()) return 'activo';
      return estadoGuardado === 'pendiente' ? 'pendiente' : 'no-soportado'; // soltado por el sistema o rechazado: la pantalla puede apagarse
    }
    return estadoGuardado;
  }

  const anclaDe = (sesionId) => anclas.get(sesionId) ?? null;

  /** Sesiones que piden la pantalla ahora (activas y con actividad en los últimos 90 min). */
  function pedidas() {
    const datos = tienda.datos();
    if (!datos || !prefs.obtener().pantalla) { anclas.clear(); return []; }
    const ahora = reloj.ahora();
    const hoy = reloj.hoy();
    // R3G-04: se anota cuándo se vio por primera vez cada actividad futura; las que dejan de serlo se olvidan.
    const vivas = new Set();
    for (const s of sesionesActivas(datos, hoy, ahora)) {
      const t = actividadRegistradaMs(s);
      if (t !== null && t > ahora) { vivas.add(s.id); if (!anclas.has(s.id)) anclas.set(s.id, ahora); }
    }
    for (const id of [...anclas.keys()]) if (!vivas.has(id)) anclas.delete(id);
    return sesionesConActividadReciente(datos, hoy, ahora, { finDescanso, ancla: anclaDe });
  }

  function programarVencimiento(sesiones) {
    if (vencimiento !== null) { temporizador.quitar(vencimiento); vencimiento = null; }
    if (!sesiones.length) return;
    const ahora = reloj.ahora();
    // La más reciente manda: cuando ella cumpla el tope, ya nadie pide la pantalla (se reevalúa al despertar).
    const ultima = Math.max(...sesiones.map((s) => ultimaActividadMs(s, ahora, finDescanso(s.id), anclaDe(s.id))));
    let falta = ultima + TOPE_INACTIVIDAD_MS - ahora + 1000;
    if (!Number.isFinite(falta)) falta = TOPE_INACTIVIDAD_MS + 1000;
    falta = Math.min(MAX_ESPERA_TEMPORIZADOR_MS, Math.max(1000, falta)); // nunca 0 (bucle) ni más de lo que admite setTimeout (R3G-04)
    vencimiento = temporizador.poner(() => { vencimiento = null; actualizar(); }, falta);
  }

  /** Pide el bloqueo y, al resolverse, avisa si cambió lo que ve la insignia. */
  function pedir(nuevo) {
    const antes = estado();
    estadoGuardado = 'pendiente';
    nuevo.activar().then((ok) => {
      if (wake !== nuevo) return; // ya se soltó mientras se pedía
      estadoGuardado = ok ? 'activo' : 'no-soportado';
      avisar();
    });
    if (antes !== estado()) avisar();
  }

  /** Reevalúa: pide el Wake Lock si hace falta y lo suelta cuando ya nadie entrena (o pasó el tope). Barato: se llama tras cada cambio. */
  function actualizar() {
    const sesiones = pedidas();
    const q = sesiones.length > 0;
    if (q && !wake) {
      const nuevo = crear();
      wake = nuevo;
      if (!nuevo.soportado) { estadoGuardado = 'no-soportado'; avisar(); programarVencimiento(sesiones); return; }
      ultimoIntento = reloj.ahora();
      pedir(nuevo);
    } else if (!q && wake) {
      wake.destruir();
      wake = null;
      estadoGuardado = 'inactivo';
      avisar();
    } else if (q && wake && wake.soportado && typeof wake.activo === 'function' && !wake.activo() && estadoGuardado !== 'pendiente') {
      // R3G-09: el sistema lo soltó (app oculta, ahorro de batería) o rechazó la petición: se vuelve a pedir, sin insistir en cada cambio.
      const ahora = reloj.ahora();
      if (visible() && ahora - ultimoIntento >= REINTENTO_MS) { ultimoIntento = ahora; pedir(wake); }
    }
    programarVencimiento(sesiones);
  }

  return {
    actualizar,
    estado,
    suscribir(fn) { oyentes.add(fn); return () => oyentes.delete(fn); },
    destruir() {
      if (vencimiento !== null) { temporizador.quitar(vencimiento); vencimiento = null; }
      if (wake) { wake.destruir(); wake = null; }
      estadoGuardado = 'inactivo';
      anclas.clear();
      oyentes.clear();
    },
  };
}
