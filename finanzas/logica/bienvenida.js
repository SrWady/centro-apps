/*
 * bienvenida.js — ¿los datos siguen siendo los de EJEMPLO de la semilla genérica? (PURO). T5.8.
 *
 * El repositorio es público: finanzas/seed.js solo trae datos de ejemplo y los reales se importan desde un archivo privado
 * (Ajustes → Datos → Importar copia). Mientras los datos sean la semilla SIN TOCAR, Inicio muestra una tarjeta de
 * bienvenida que lo explica. Criterio (simple y sin estado extra): los datos son "de ejemplo" si
 *   1. no hay ningún movimiento, y
 *   2. el núcleo (ajustes, cuentas, deudas, categorías, recurrentes y metas) y el presupuesto del ciclo inicial (ingreso planeado,
 *      asignaciones y origen) son idénticos a los de `crearSemilla`, y
 *   3. ningún otro ciclo tiene un presupuesto editado a mano (`origen: 'manual'`).
 * Se ignoran marcas de tiempo, `rev` y los presupuestos de los ciclos que `alAbrir` copia solo (origen 'copia'): abrir la app
 * en otro mes no cuenta como editar. Importar el archivo real, registrar un movimiento o cambiar cualquier valor lo vuelve falso y la
 * tarjeta desaparece sola. "Borrar todo" vuelve a la semilla (y la tarjeta reaparece salvo que se haya pulsado "Entendido").
 * No hay campo nuevo en el esquema: no cambia lo que se exporta ni lo que valida `validar`.
 */
import { crearSemilla } from '../seed.js';

const NUCLEO = ['ajustes', 'cuentas', 'deudas', 'categorias', 'recurrentes', 'metas'];

/** JSON canónico: claves ordenadas, para comparar sin depender del orden con que cada validador las escribe. */
function canonico(valor) {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  if (valor && typeof valor === 'object') return `{${Object.keys(valor).sort().map((k) => `${JSON.stringify(k)}:${canonico(valor[k])}`).join(',')}}`;
  return JSON.stringify(valor === undefined ? null : valor);
}

function firma(datos) {
  const ciclo = datos.ajustes?.cicloInicial;
  const p = datos.presupuestos?.[ciclo];
  return canonico({
    nucleo: NUCLEO.map((k) => datos[k]),
    presupuesto: p ? { ingresoPlaneado: p.ingresoPlaneado, asignaciones: p.asignaciones, origen: p.origen } : null,
  });
}

/** @param {object} datos datos de la tienda @returns {boolean} true = siguen siendo la semilla genérica sin tocar */
export function sonDatosDeEjemplo(datos) {
  try {
    if (!datos || typeof datos !== 'object' || !Array.isArray(datos.movimientos) || datos.movimientos.length > 0) return false;
    const presupuestos = datos.presupuestos ?? {};
    if (Object.entries(presupuestos).some(([ciclo, p]) => ciclo !== datos.ajustes?.cicloInicial && p && p.origen === 'manual')) return false;
    return firma(datos) === firma(crearSemilla({ ahora: datos.creadoEn }));
  } catch {
    return false;
  }
}

/**
 * ¿Mostrar la tarjeta de bienvenida en Inicio?
 * @param {object} datos
 * @param {{bienvenidaOculta?: boolean}} [preferencias] preferencias de ESTE dispositivo (no se exportan): "Entendido" la oculta para siempre
 */
export function debeMostrarBienvenida(datos, preferencias = {}) {
  return preferencias?.bienvenidaOculta !== true && sonDatosDeEjemplo(datos);
}

/** Textos de la tarjeta (en un solo lugar: Inicio los pinta y las pruebas los comprueban). */
export const TEXTOS_BIENVENIDA = Object.freeze({
  titulo: 'Estos son datos de ejemplo',
  cuerpo: 'Carga tu archivo en Ajustes → Datos → Importar copia, o edita los valores en Ajustes.',
  iphone: 'En iPhone, instala primero la app en la pantalla de inicio y después carga tus datos (los datos de Safari y los de la app instalada son distintos).',
  irAjustes: 'Ir a Ajustes',
  entendido: 'Entendido',
});
