/*
 * reloj.js — reloj inyectable. Contrato: docs/UTILIDADES.md §2.
 * ÚNICA fuente de "ahora" de las apps (junto con el valor por defecto de ids.js): ningún otro archivo debe llamar
 * Date.now() ni new Date() sin argumentos.
 */
import { fechaLocalDe, crearFecha } from './fechas.js';

/**
 * @param {{ ahoraMs?: () => number }} [opciones]
 * @returns {{ ahora(): number, hoy(): string, instanteISO(): string }}
 */
export function crearReloj({ ahoraMs = () => Date.now() } = {}) {
  return {
    ahora: () => ahoraMs(),
    /** 'YYYY-MM-DD' con componentes LOCALES (en Colombia, UTC−5, a las 20:00 sigue siendo el mismo día; toISOString daría el siguiente). */
    hoy: () => fechaLocalDe(ahoraMs()),
    /** Instante en UTC, p. ej. '2026-11-02T01:00:00.000Z'. */
    instanteISO: () => new Date(ahoraMs()).toISOString(),
  };
}

const PATRON_INICIO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** 'YYYY-MM-DDTHH:mm[:ss]' (hora LOCAL del equipo) → ms epoch. Independiente de la zona horaria de la máquina. */
function aMs(inicio) {
  if (typeof inicio === 'number') {
    if (!Number.isFinite(inicio)) throw new TypeError('El instante inicial debe ser un número finito.');
    return inicio;
  }
  if (typeof inicio !== 'string') throw new TypeError('El instante inicial debe ser texto local o ms.');
  const m = PATRON_INICIO.exec(inicio);
  if (!m) throw new RangeError(`Instante inicial con formato inválido: "${inicio}".`);
  const [anio, mes, dia, hora, minuto, segundo] = m.slice(1).map((x) => (x === undefined ? 0 : Number(x)));
  crearFecha(anio, mes, dia); // valida el calendario
  if (hora > 23 || minuto > 59 || segundo > 59) throw new RangeError(`Hora inválida en "${inicio}".`);
  return new Date(anio, mes - 1, dia, hora, minuto, segundo, 0).getTime();
}

/**
 * Reloj de pruebas: parte de un instante local y solo avanza con avanzar()/fijar().
 * @returns {ReturnType<typeof crearReloj> & { avanzar(ms: number): void, fijar(inicio: string|number): void }}
 */
export function crearRelojFijo(inicio) {
  let actual = aMs(inicio);
  const reloj = crearReloj({ ahoraMs: () => actual });
  return {
    ...reloj,
    avanzar(ms) {
      if (!Number.isFinite(ms)) throw new TypeError('ms debe ser un número finito.');
      actual += ms;
    },
    fijar(nuevoInicio) {
      actual = aMs(nuevoInicio);
    },
  };
}

/**
 * Avisa una vez cuando cambia el día local. Revisa en setInterval, en 'visibilitychange' (cuando queda visible) y en
 * 'focus' de la ventana. Devuelve detener().
 * @param {ReturnType<typeof crearReloj>} reloj
 * @param {(hoyNuevo: string, hoyAnterior: string) => void} alCambiar
 * @param {{ intervaloMs?: number, documento?: any }} [opciones]
 */
export function vigilarCambioDeDia(reloj, alCambiar, { intervaloMs = 60_000, documento = globalThis.document } = {}) {
  let anterior = reloj.hoy();
  let activo = true;

  const revisar = () => {
    if (!activo) return;
    const hoy = reloj.hoy();
    if (hoy !== anterior) {
      const previo = anterior;
      anterior = hoy;
      alCambiar(hoy, previo);
    }
  };
  const alCambiarVisibilidad = () => {
    if (!documento || documento.visibilityState === 'visible') revisar();
  };

  const ventana = documento && documento.defaultView ? documento.defaultView : null;
  const temporizador = globalThis.setInterval(revisar, intervaloMs);
  if (temporizador && typeof temporizador.unref === 'function') temporizador.unref(); // Node: no retener el proceso
  if (documento && typeof documento.addEventListener === 'function') {
    documento.addEventListener('visibilitychange', alCambiarVisibilidad);
  }
  if (ventana && typeof ventana.addEventListener === 'function') ventana.addEventListener('focus', revisar);

  return function detener() {
    if (!activo) return;
    activo = false;
    globalThis.clearInterval(temporizador);
    if (documento && typeof documento.removeEventListener === 'function') {
      documento.removeEventListener('visibilitychange', alCambiarVisibilidad);
    }
    if (ventana && typeof ventana.removeEventListener === 'function') ventana.removeEventListener('focus', revisar);
  };
}
