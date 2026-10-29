/*
 * descansos.js — descansos entre series, UNO POR SESIÓN (y, por tanto, uno por persona) y sesiones activas (PURO: sin DOM; el
 * reloj entra como argumento). R2G-02: con un solo celular para las dos personas, que pueden entrenar a la vez, el descanso de
 * una no puede pisar ni borrar el de la otra, ni siquiera al cambiar de persona o de pantalla.
 */

export const SEIS_HORAS_MS = 6 * 3600 * 1000;
export const SEGUNDOS_AJUSTE = 15;
/** Sin actividad durante tanto tiempo la pantalla deja de mantenerse encendida (sesión olvidada sin terminar). */
export const TOPE_INACTIVIDAD_MS = 90 * 60 * 1000;
/** Mayor espera que admite setTimeout (2^31−1 ms ≈ 24,8 días): con más, el navegador lo dispara de inmediato (R3G-04). */
export const MAX_ESPERA_TEMPORIZADOR_MS = 2 ** 31 - 1;

/**
 * ¿La sesión está en curso y "viva" (de hoy o del futuro, o de un día anterior pero iniciada hace menos de 6 h: cruzó la
 * medianoche, R1-12)? Una sesión olvidada de hace días no cuenta: no debe mantener la pantalla encendida.
 */
export function sesionActiva(ses, hoy, ahoraMs) {
  if (!ses || ses.estado !== 'en-curso') return false;
  if (ses.fecha >= hoy) return true;
  const inicio = Date.parse(ses.iniciadaEn);
  return Number.isFinite(inicio) && ahoraMs - inicio < SEIS_HORAS_MS;
}

/** Sesiones activas de cualquiera de las dos personas. */
export function sesionesActivas(datos, hoy, ahoraMs) {
  if (!datos || !datos.sesiones) return [];
  return Object.values(datos.sesiones).filter((s) => sesionActiva(s, hoy, ahoraMs));
}

/** Instante (ms) de `ultimaActividadEn` de la sesión (o, si falta, de su inicio), o null si no se entiende. */
export function actividadRegistradaMs(ses) {
  const a = Date.parse(ses.ultimaActividadEn);
  const base = Number.isFinite(a) ? a : Date.parse(ses.iniciadaEn);
  return Number.isFinite(base) ? base : null;
}

/**
 * Instante (ms) de la última actividad de una sesión: lo más reciente entre `ultimaActividadEn` (que actualizan marcar una serie,
 * tocar un stepper —al guardarse—, usar la sugerencia, agregar o quitar series y registrar cardio) y el fin del descanso: un
 * descanso corriendo cuenta como actividad (fin en el futuro = ahora). `finDescansoMs`: fin del descanso de esa sesión, o null.
 * R3G-04: una actividad registrada en el FUTURO (el reloj del teléfono estuvo adelantado y luego se corrigió) cuenta como "ahora"
 * (nunca más lejos); con `anclaMs` (primer instante en que se vio así) cuenta desde ahí, para que el tope de 90 min siga corriendo
 * y la pantalla no quede encendida hasta que el reloj alcance esa fecha.
 */
export function ultimaActividadMs(ses, ahoraMs, finDescansoMs = null, anclaMs = null) {
  const base = actividadRegistradaMs(ses);
  let t = base ?? ahoraMs;
  if (t > ahoraMs) t = Number.isFinite(anclaMs) && anclaMs < ahoraMs ? anclaMs : ahoraMs;
  if (Number.isFinite(finDescansoMs)) t = Math.max(t, Math.min(finDescansoMs, ahoraMs));
  return t;
}

/**
 * Sesiones que justifican mantener la pantalla encendida: activas (sesionActiva) y con actividad en los últimos 90 minutos
 * (`topeMs`; a los 90 exactos todavía vale). `finDescanso(sesionId)` → fin (ms) del descanso de esa sesión o null;
 * `ancla(sesionId)` → primer instante (ms) en que se vio su actividad en el futuro, o null (R3G-04).
 */
export function sesionesConActividadReciente(datos, hoy, ahoraMs, { topeMs = TOPE_INACTIVIDAD_MS, finDescanso = () => null, ancla = () => null } = {}) {
  return sesionesActivas(datos, hoy, ahoraMs).filter((s) => ahoraMs - ultimaActividadMs(s, ahoraMs, finDescanso(s.id), ancla(s.id)) <= topeMs);
}

/** ¿Alguna de las personas tiene una sesión en curso? (condición para mantener la pantalla encendida). */
export function hayActividad(datos, hoy, ahoraMs) {
  return sesionesActivas(datos, hoy, ahoraMs).length > 0;
}

/**
 * Almacén de descansos en marcha, por `sesionId`. Cada descanso: { sesionId, fin (ms), total (s), etiqueta, listo }.
 * Vive fuera de las vistas (sobrevive a cambiar de persona y de pantalla) y se poda al ver que la sesión ya no está en curso.
 */
export function crearDescansos() {
  const mapa = new Map();

  const restanteSeg = (sesionId, ahora) => {
    const d = mapa.get(sesionId);
    // Con tope: si el reloj retrocede no se muestra un descanso más largo que el programado.
    return d ? Math.min(d.total, Math.max(0, Math.ceil((d.fin - ahora) / 1000))) : 0;
  };

  return {
    /** Arranca (o reemplaza SOLO el de esa sesión). */
    iniciar(sesionId, segundos, etiqueta, ahora) {
      const d = { sesionId, fin: ahora + segundos * 1000, total: segundos, etiqueta, listo: false };
      mapa.set(sesionId, d);
      return d;
    },
    de: (sesionId) => mapa.get(sesionId) ?? null,
    todos: () => [...mapa.values()],
    /** Los de las demás sesiones (para el aviso "Descanso de …"). */
    otros: (sesionId) => [...mapa.values()].filter((d) => d.sesionId !== sesionId),
    tiene: () => mapa.size > 0,
    restanteSeg,
    /** ¿Algún descanso sigue corriendo (no marcado como terminado)? */
    corriendo: () => [...mapa.values()].some((d) => !d.listo),
    /**
     * +15 / −15 s sobre el descanso de esa sesión. Si ya terminó, "+15" suma desde AHORA (R2G-07): antes sumaba a un fin que ya
     * estaba en el pasado y, pasados 15 s, no se veía nada.
     */
    ajustar(sesionId, deltaSeg, ahora) {
      const d = mapa.get(sesionId);
      if (!d) return null;
      if (deltaSeg > 0 && (d.listo || d.fin <= ahora)) {
        d.fin = ahora + deltaSeg * 1000;
        d.total = deltaSeg;
      } else {
        d.fin += deltaSeg * 1000;
        if (deltaSeg > 0) d.total += deltaSeg;
      }
      if (d.fin > ahora) d.listo = false;
      return d;
    },
    /** Marca como terminados los que ya llegaron a 0. → los que terminaron AHORA (para avisar una sola vez). */
    revisarTerminados(ahora) {
      const nuevos = [];
      for (const d of mapa.values()) {
        if (!d.listo && restanteSeg(d.sesionId, ahora) === 0) {
          d.listo = true;
          nuevos.push(d);
        }
      }
      return nuevos;
    },
    /** Borra solo el de esa sesión (terminar, cancelar, "Listo" o una serie sin descanso de esa misma persona). */
    quitar: (sesionId) => mapa.delete(sesionId),
    /**
     * Descarta los de sesiones que ya no están en curso (terminadas, canceladas o borradas). Con `{ hoy, ahora }` también los
     * TERMINADOS de sesiones que ya no están "vivas" (olvidadas de días atrás: R3G-01c) y devuelve los ids descartados.
     */
    podar(datos, { hoy = null, ahora = null } = {}) {
      const quitados = [];
      if (!datos || !datos.sesiones) return quitados;
      for (const id of [...mapa.keys()]) {
        const s = datos.sesiones[id];
        const d = mapa.get(id);
        const muerto = !s || s.estado !== 'en-curso' || (hoy !== null && ahora !== null && d.listo && !sesionActiva(s, hoy, ahora));
        if (muerto) { mapa.delete(id); quitados.push(id); }
      }
      return quitados;
    },
    /**
     * Descansos de OTRAS personas distintas de `personaId` (para el aviso "Descanso de …": nunca el propio, R3G-01a), el que termina
     * primero antes. `datos` da la persona de cada sesión.
     */
    deOtrasPersonas(personaId, datos) {
      const persona = (id) => datos?.sesiones?.[id]?.personaId ?? null;
      return [...mapa.values()].filter((d) => persona(d.sesionId) !== null && persona(d.sesionId) !== personaId).sort((a, b) => a.fin - b.fin);
    },
    /** Descansos PROPIOS de `personaId` (de cualquiera de sus sesiones). */
    dePersona(personaId, datos) {
      return [...mapa.values()].filter((d) => datos?.sesiones?.[d.sesionId]?.personaId === personaId);
    },
    /** Fin (ms) del descanso de esa sesión, o null. */
    finDe: (sesionId) => mapa.get(sesionId)?.fin ?? null,
    limpiar: () => mapa.clear(),
  };
}
