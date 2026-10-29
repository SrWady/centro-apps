/*
 * preferencias.js — preferencias de ESTE celular en `cte.gimnasio.dispositivo` (no se exportan: al pasar los datos al
 * celular de la otra persona no le cambian su selección). Todo acceso va por el almacén (con try/catch).
 */
import { reviverSeguro, esObjetoPlano } from '../shared/lib/validacion.js';

export const CLAVE_DISPOSITIVO = 'cte.gimnasio.dispositivo';

const POR_DEFECTO = Object.freeze({ personaPorDefecto: 'p1', ultimaPersona: 'p1', vibracion: true, pantalla: true });

/** N-02: récords ya celebrados ('<idSesion>:<idEjercicio>'), para no repetir confeti ni aviso tras recargar. Solo los últimos. */
export const MAX_CELEBRADOS = 100;
const CLAVE_CELEBRADO = /^[A-Za-z0-9_.-]{1,80}:[A-Za-z0-9_.-]{1,80}$/;

function sanear(o) {
  const persona = (v) => (v === 'p1' || v === 'p2' ? v : null);
  return {
    personaPorDefecto: persona(o.personaPorDefecto) ?? (o.personaPorDefecto === 'ultima' ? 'ultima' : POR_DEFECTO.personaPorDefecto),
    ultimaPersona: persona(o.ultimaPersona) ?? POR_DEFECTO.ultimaPersona,
    vibracion: typeof o.vibracion === 'boolean' ? o.vibracion : POR_DEFECTO.vibracion,
    pantalla: typeof o.pantalla === 'boolean' ? o.pantalla : POR_DEFECTO.pantalla,
    celebrados: Array.isArray(o.celebrados) ? [...new Set(o.celebrados.filter((c) => typeof c === 'string' && CLAVE_CELEBRADO.test(c)))].slice(-MAX_CELEBRADOS) : [],
  };
}

/** @param {{leer(clave:string):any, escribir(clave:string, texto:string):any}} almacen */
export function crearPreferencias(almacen) {
  function leer() {
    try {
      const r = almacen.leer(CLAVE_DISPOSITIVO);
      if (r.ok && r.texto) {
        const o = JSON.parse(r.texto, reviverSeguro);
        if (esObjetoPlano(o)) return sanear(o);
      }
    } catch {
      /* se usan los valores por defecto */
    }
    return sanear({});
  }
  let actual = leer();
  return {
    obtener: () => { const { celebrados: _c, ...resto } = actual; return resto; },
    guardar(parcial) {
      actual = sanear({ ...actual, ...parcial });
      almacen.escribir(CLAVE_DISPOSITIVO, JSON.stringify(actual));
      const { celebrados: _c, ...resto } = actual;
      return resto;
    },
    /** N-02: ¿ya se celebró este récord (sesión:ejercicio)? Persiste entre recargas. */
    yaCelebrado: (clave) => actual.celebrados.includes(clave),
    /** N-02: anota un récord celebrado (se guarda al instante; se conservan las últimas 100). */
    marcarCelebrado(clave) {
      if (typeof clave !== 'string' || !CLAVE_CELEBRADO.test(clave) || actual.celebrados.includes(clave)) return;
      actual = sanear({ ...actual, celebrados: [...actual.celebrados, clave] });
      almacen.escribir(CLAVE_DISPOSITIVO, JSON.stringify(actual));
    },
    /** Persona con la que abre este celular: la fija o la última usada. */
    personaInicial() {
      return actual.personaPorDefecto === 'ultima' ? actual.ultimaPersona : actual.personaPorDefecto;
    },
  };
}
