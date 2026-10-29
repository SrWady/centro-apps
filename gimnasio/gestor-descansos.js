/*
 * gestor-descansos.js — gestor de descansos de la APP (N3-01, R3G-01). Envuelve el almacén puro de `logica/descansos.js` (un descanso
 * por sesión, es decir por persona) y es dueño de lo que NO depende de qué pantalla se esté viendo:
 *  - el reloj que detecta cuándo termina cada descanso (un temporizador hasta el fin más próximo, más una revisión al volver a la app);
 *  - la vibración y el pulso visual del fin del descanso, UNA sola vez por descanso, también en Semana, Progreso, Rutina y Ajustes;
 *  - la limpieza de lo viejo (descansos terminados de sesiones olvidadas o de otro día).
 * Entrenar solo lo dibuja: se suscribe para redibujar y le indica a qué elemento aplicar el pulso (si no hay, destello de pantalla).
 * Se crea en `app.js` y llega a las vistas por `ctx.descansos`.
 */
import { haptic as hapticReal } from '../shared/ui/haptica.js';
import { crearDescansos, sesionActiva, MAX_ESPERA_TEMPORIZADOR_MS } from './logica/descansos.js';

/** Aunque falte más, se revisa al menos así de seguido (cambios de reloj del teléfono); y nunca se pasa del máximo de setTimeout. */
const REVISION_MAXIMA_MS = 30_000;

/**
 * @param {{ reloj: {hoy():string, ahora():number}, tienda: {datos():object|null},
 *   haptic?: (tipo:string, objetivo?:Element|null)=>any,
 *   temporizador?: { poner(fn:Function, ms:number):any, quitar(id:any):void },
 *   alCambiar?: () => void }} o   alCambiar: se llama tras iniciar, ajustar, quitar o terminar un descanso (p. ej. para reevaluar el Wake Lock)
 */
export function crearGestorDescansos({
  reloj, tienda, haptic = hapticReal, alCambiar = () => {},
  temporizador = { poner: (fn, ms) => setTimeout(fn, ms), quitar: (id) => clearTimeout(id) },
}) {
  const almacen = crearDescansos();
  const oyentes = new Set();
  let pulso = () => null; // (sesionId) → elemento al que aplicar el pulso visual, lo fija la pantalla Entrenar mientras está montada
  let espera = null; // temporizador hasta el fin más próximo

  const emitir = (ev) => { for (const f of [...oyentes]) { try { f(ev); } catch { /* un oyente defectuoso no rompe los demás */ } } };
  const cambio = () => { programar(); try { alCambiar(); } catch { /* no debe romper el descanso */ } };

  function programar() {
    if (espera !== null) { temporizador.quitar(espera); espera = null; }
    const pendientes = almacen.todos().filter((d) => !d.listo);
    if (!pendientes.length) return;
    const ahora = reloj.ahora();
    const falta = Math.min(...pendientes.map((d) => d.fin)) - ahora + 30;
    const ms = Number.isFinite(falta) ? Math.min(REVISION_MAXIMA_MS, MAX_ESPERA_TEMPORIZADOR_MS, Math.max(30, falta)) : REVISION_MAXIMA_MS;
    espera = temporizador.poner(() => { espera = null; revisar(); }, ms);
  }

  /**
   * Revisa los descansos: limpia lo viejo y marca los que ya llegaron a 0; por cada uno que termina AHORA avisa a las pantallas y
   * vibra una sola vez (el indicador `listo` del descanso impide repetirlo). Idempotente y barato: lo llaman el temporizador, el
   * reloj de Entrenar y el regreso a la app. → los descansos que terminaron ahora.
   */
  function revisar() {
    const datos = tienda.datos();
    if (!datos) { programar(); return []; } // N-01: otra pestaña dejó los datos ilegibles un instante; no se descarta nada
    const ahora = reloj.ahora();
    const hoy = reloj.hoy();
    const quitados = almacen.podar(datos, { hoy, ahora });
    const nuevos = almacen.revisarTerminados(ahora);
    const vivos = [];
    for (const d of nuevos) {
      const ses = datos.sesiones ? datos.sesiones[d.sesionId] : null;
      if (ses && sesionActiva(ses, hoy, ahora)) vivos.push(d);
      else { almacen.quitar(d.sesionId); quitados.push(d.sesionId); } // sesión olvidada: se limpia sin avisar
    }
    if (quitados.length || vivos.length) {
      emitir({ tipo: vivos.length ? 'terminado' : 'podado', descansos: vivos, quitados });
      for (const d of vivos) {
        let objetivo = null;
        try { objetivo = pulso(d.sesionId) ?? null; } catch { objetivo = null; }
        haptic('descanso', objetivo);
      }
    }
    if (quitados.length || vivos.length) cambio(); else programar();
    return vivos;
  }

  return {
    iniciar(sesionId, segundos, etiqueta) {
      const d = almacen.iniciar(sesionId, segundos, etiqueta, reloj.ahora());
      cambio();
      return d;
    },
    quitar(sesionId) {
      const habia = almacen.quitar(sesionId);
      if (habia) cambio();
      return habia;
    },
    ajustar(sesionId, deltaSeg) {
      const d = almacen.ajustar(sesionId, deltaSeg, reloj.ahora());
      if (d) cambio();
      return d;
    },
    revisar,
    de: (sesionId) => almacen.de(sesionId),
    todos: () => almacen.todos(),
    tiene: () => almacen.tiene(),
    corriendo: () => almacen.corriendo(),
    restanteSeg: (sesionId) => almacen.restanteSeg(sesionId, reloj.ahora()),
    finDe: (sesionId) => almacen.finDe(sesionId),
    /** Descansos de las demás personas (nunca el propio), para el aviso "Descanso de …". */
    deOtrasPersonas: (personaId) => almacen.deOtrasPersonas(personaId, tienda.datos()),
    /** Descansos propios de la persona (de cualquiera de sus sesiones). */
    dePersona: (personaId) => almacen.dePersona(personaId, tienda.datos()),
    limpiar() { almacen.limpiar(); cambio(); },
    /** Eventos: { tipo:'terminado'|'podado', descansos, quitados }. → función para dejar de escuchar. */
    suscribir(fn) { oyentes.add(fn); return () => oyentes.delete(fn); },
    /** Entrenar indica a qué elemento aplicar el pulso visual de cada descanso (o null). → función que lo quita. */
    fijarPulso(fn) { pulso = fn; return () => { if (pulso === fn) pulso = () => null; }; },
    destruir() {
      if (espera !== null) { temporizador.quitar(espera); espera = null; }
      oyentes.clear();
      almacen.limpiar();
    },
  };
}
