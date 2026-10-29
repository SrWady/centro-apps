/*
 * dispositivo.js — háptica, Wake Lock y persistencia de almacenamiento, con degradación sin errores.
 * Contrato: docs/UTILIDADES.md §13. Todo acepta `navegador` / `documento` inyectables; con `{}` nada lanza.
 * shared/ui/haptica.js llama vibrar(patron) sin segundo argumento y espera true/false.
 * No se usa console.error: los fallos esperables (NotAllowedError, iOS sin soporte) devuelven false.
 */

export function puedeVibrar({ navegador = globalThis.navigator } = {}) {
  return !!navegador && typeof navegador.vibrate === 'function';
}

/** true si se pidió la vibración; false si no hay soporte (iOS Safari), el patrón no es válido o el sistema la rechazó. */
export function vibrar(patron, { navegador = globalThis.navigator } = {}) {
  if (!puedeVibrar({ navegador })) return false;
  const valido = Array.isArray(patron) ? patron.every((n) => Number.isFinite(n) && n >= 0) : Number.isFinite(patron) && patron >= 0;
  if (!valido) return false;
  try {
    return navegador.vibrate(patron) === true;
  } catch {
    return false;
  }
}

/**
 * Mantiene la pantalla encendida mientras el usuario lo quiere. El sistema libera el bloqueo al pasar a segundo plano:
 * al volver a primer plano se pide de nuevo una sola vez.
 * @returns {{ soportado: boolean, activo(): boolean, activar(): Promise<boolean>, liberar(): Promise<void>, destruir(): void }}
 */
export function crearWakeLock({ navegador = globalThis.navigator, documento = globalThis.document } = {}) {
  const soportado = !!navegador && !!navegador.wakeLock && typeof navegador.wakeLock.request === 'function';
  let centinela = null;
  let quiere = false;
  let destruido = false;
  let pidiendo = null;

  async function pedir() {
    if (!soportado || destruido) return false;
    if (centinela) return true;
    if (pidiendo) return pidiendo;
    pidiendo = (async () => {
      try {
        const nuevo = await navegador.wakeLock.request('screen');
        if (!quiere || destruido) {
          try {
            await nuevo.release();
          } catch {
            /* nada */
          }
          return false;
        }
        centinela = nuevo;
        if (typeof nuevo.addEventListener === 'function') {
          nuevo.addEventListener('release', () => {
            if (centinela === nuevo) centinela = null;
          });
        }
        return true;
      } catch {
        return false; // NotAllowedError (batería baja, página oculta), etc.
      } finally {
        pidiendo = null;
      }
    })();
    return pidiendo;
  }

  const alCambiarVisibilidad = () => {
    if (documento && documento.visibilityState === 'visible' && quiere && !centinela) pedir();
  };
  if (soportado && documento && typeof documento.addEventListener === 'function') {
    documento.addEventListener('visibilitychange', alCambiarVisibilidad);
  }

  return {
    soportado,
    activo: () => centinela !== null,
    async activar() {
      if (destruido) return false;
      quiere = true;
      return pedir();
    },
    async liberar() {
      quiere = false;
      const actual = centinela;
      centinela = null;
      if (actual) {
        try {
          await actual.release();
        } catch {
          /* nada */
        }
      }
    },
    destruir() {
      if (destruido) return;
      destruido = true;
      quiere = false;
      if (documento && typeof documento.removeEventListener === 'function') {
        documento.removeEventListener('visibilitychange', alCambiarVisibilidad);
      }
      const actual = centinela;
      centinela = null;
      if (actual) {
        try {
          Promise.resolve(actual.release()).catch(() => {});
        } catch {
          /* nada */
        }
      }
    },
  };
}

/** navigator.storage.persist(): reduce el riesgo de que Chrome/Android borre los datos. */
export async function solicitarPersistencia({ navegador = globalThis.navigator } = {}) {
  const almacenamiento = navegador && navegador.storage;
  if (!almacenamiento || typeof almacenamiento.persist !== 'function') return 'no-soportada';
  try {
    return (await almacenamiento.persist()) ? 'concedida' : 'denegada';
  } catch {
    return 'denegada';
  }
}

/** { uso, cuota } en bytes (informativo) o null. */
export async function estimarAlmacenamiento({ navegador = globalThis.navigator } = {}) {
  const almacenamiento = navegador && navegador.storage;
  if (!almacenamiento || typeof almacenamiento.estimate !== 'function') return null;
  try {
    const e = await almacenamiento.estimate();
    return e && Number.isFinite(e.usage) && Number.isFinite(e.quota) ? { uso: e.usage, cuota: e.quota } : null;
  } catch {
    return null;
  }
}
