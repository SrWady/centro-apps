/*
 * storage.js — acceso seguro a localStorage. Contrato: docs/UTILIDADES.md §5.
 * Ninguna función de E/S lanza: devuelven { ok:true, ... } o { ok:false, error, mensaje }.
 * El almacén trabaja con CLAVES COMPLETAS ('cte.gimnasio.datos') y se niega a tocar las que no empiezan con su prefijo.
 */

export const LIMITE_ESTIMADO = 5_000_000;

/** Mensajes estándar al usuario, iguales en ambas apps (UTILIDADES §8). */
export const MENSAJES_ERROR = Object.freeze({
  'cuota-llena': 'No hay espacio para guardar. Exporte sus datos en Ajustes → Pasar datos a otro celular y libere espacio.',
  conflicto: 'Los datos cambiaron en otra ventana. Se recargaron; repita la última acción.',
  'no-disponible': 'Este navegador no permite guardar datos (¿modo privado?). Los cambios se perderán al cerrar.',
  'solo-lectura': 'Estos datos son de una versión más nueva de la app. Actualícela antes de editar.',
  desconocido: 'No se pudo guardar por un error inesperado. Intente de nuevo.',
});

export function esErrorDeCuota(e) {
  if (!e || (typeof e !== 'object' && typeof e !== 'function')) return false;
  return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014;
}

/**
 * Backend con la interfaz de Storage (getItem, setItem, removeItem, key, length) en memoria. Con `limiteCaracteres`
 * simula cuota llena: setItem lanza un error 'QuotaExceededError' si Σ(clave + valor) lo supera, sin tocar lo anterior.
 */
export function crearBackendMemoria({ limiteCaracteres = Infinity } = {}) {
  const mapa = new Map();
  const total = (sin, par) => {
    let t = 0;
    for (const [k, v] of mapa) if (k !== sin) t += k.length + v.length;
    return par ? t + par[0].length + par[1].length : t;
  };
  return {
    getItem(clave) {
      const k = String(clave);
      return mapa.has(k) ? mapa.get(k) : null;
    },
    setItem(clave, valor) {
      const k = String(clave);
      const v = String(valor);
      if (total(k, [k, v]) > limiteCaracteres) {
        const e = new Error('Se superó la cuota de almacenamiento.');
        e.name = 'QuotaExceededError';
        e.code = 22;
        throw e;
      }
      mapa.set(k, v);
    },
    removeItem(clave) {
      mapa.delete(String(clave));
    },
    key(indice) {
      const claves = [...mapa.keys()];
      return indice >= 0 && indice < claves.length ? claves[indice] : null;
    },
    clear() {
      mapa.clear();
    },
    get length() {
      return mapa.size;
    },
  };
}

/**
 * R0-25: ¿un evento 'storage' (de otra pestaña) cambió los datos de esta app? Solo si es de localStorage y su clave es
 * `clave` (o null: otra página hizo clear()). Ignora `<prefijo>__prueba`, `respaldo`, `corrupto` y claves ajenas.
 * Uso: addEventListener('storage', (e) => { if (esCambioDeDatos(e, 'cte.finanzas.datos')) tienda.recargar(); })
 */
export function esCambioDeDatos(evento, clave, { area } = {}) {
  if (!evento || typeof evento !== 'object') return false;
  let esperada = area;
  if (esperada === undefined) {
    try {
      esperada = globalThis.localStorage;
    } catch {
      esperada = undefined;
    }
  }
  if (esperada !== undefined && evento.storageArea !== undefined && evento.storageArea !== esperada) return false;
  return evento.key === clave || evento.key === null;
}

function falla(error, mensaje) {
  return { ok: false, error, mensaje: mensaje ?? MENSAJES_ERROR[error] };
}

function clasificar(e) {
  if (esErrorDeCuota(e)) return 'cuota-llena';
  if (e && (e.name === 'SecurityError' || e.name === 'InvalidAccessError' || e.name === 'NotSupportedError')) return 'no-disponible';
  return 'desconocido';
}

/**
 * Obtiene el backend real y lo prueba escribiendo y borrando `prefijo + '__prueba'`. Devuelve null si no sirve
 * (no existe, lanza al accederlo, o no deja escribir). Una cuota llena NO descarta el backend (aún se puede leer),
 * salvo que esté vacío: eso es el modo privado antiguo de Safari (cuota 0).
 */
function backendUtilizable(candidato, prefijo) {
  let backend = null;
  try {
    backend = candidato ?? globalThis.localStorage ?? null;
    if (!backend) return null;
    backend.setItem(prefijo + '__prueba', '1');
    backend.removeItem(prefijo + '__prueba');
    return backend;
  } catch (e) {
    if (backend && esErrorDeCuota(e)) {
      try {
        return backend.length > 0 ? backend : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * @param {{ prefijo: string, backend?: Storage }} opciones  prefijo p. ej. 'cte.gimnasio.'
 */
export function crearAlmacen({ prefijo, backend } = {}) {
  // R0-24: el prefijo debe terminar en '.', así 'cte.gim' no se confunde con las claves 'cte.gimnasio2.*' de otro repo.
  if (typeof prefijo !== 'string' || !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.$/.test(prefijo)) {
    throw new TypeError("crearAlmacen requiere un prefijo en minúsculas que termine en '.', p. ej. 'cte.finanzas.'.");
  }
  let almacenamiento = backendUtilizable(backend, prefijo);
  const modo = almacenamiento ? 'local' : 'memoria';
  if (!almacenamiento) almacenamiento = crearBackendMemoria();

  const propia = (clave) => typeof clave === 'string' && clave.startsWith(prefijo);
  const ajena = (clave) => falla('desconocido', `La clave "${String(clave)}" no pertenece a este almacén (${prefijo}).`);

  function todasLasClaves() {
    const claves = [];
    for (let i = 0; i < almacenamiento.length; i += 1) {
      const k = almacenamiento.key(i);
      if (k !== null && k !== undefined) claves.push(k);
    }
    return claves;
  }

  return {
    modo,
    prefijo,

    leer(clave) {
      if (!propia(clave)) return ajena(clave);
      try {
        const texto = almacenamiento.getItem(clave);
        return { ok: true, texto: texto === undefined ? null : texto };
      } catch {
        return falla('no-disponible');
      }
    },

    escribir(clave, texto) {
      if (!propia(clave)) return ajena(clave);
      if (typeof texto !== 'string') throw new TypeError('escribir requiere texto.');
      try {
        almacenamiento.setItem(clave, texto);
        return { ok: true };
      } catch (e) {
        return falla(clasificar(e));
      }
    },

    borrar(clave) {
      if (!propia(clave)) return ajena(clave);
      try {
        almacenamiento.removeItem(clave);
        return { ok: true };
      } catch (e) {
        return falla(clasificar(e) === 'desconocido' ? 'no-disponible' : clasificar(e));
      }
    },

    /** Claves completas que empiezan con el prefijo. */
    claves() {
      try {
        return todasLasClaves().filter(propia);
      } catch {
        return [];
      }
    },

    /** Borra SOLO las claves del prefijo (nunca clear()). */
    borrarTodo() {
      try {
        const propias = todasLasClaves().filter(propia);
        for (const k of propias) almacenamiento.removeItem(k);
        return { ok: true, borradas: propias.length };
      } catch {
        return falla('no-disponible');
      }
    },

    /** Aproximación en caracteres (clave + valor); los navegadores miden distinto. La cuota es por origen. */
    uso() {
      let caracteresApp = 0;
      let caracteresOrigen = 0;
      try {
        for (const k of todasLasClaves()) {
          const v = almacenamiento.getItem(k) ?? '';
          const n = k.length + v.length;
          caracteresOrigen += n;
          if (propia(k)) caracteresApp += n;
        }
      } catch {
        /* sin datos de uso */
      }
      return { caracteresApp, caracteresOrigen, limiteEstimado: LIMITE_ESTIMADO, fraccion: caracteresOrigen / LIMITE_ESTIMADO };
    },
  };
}
