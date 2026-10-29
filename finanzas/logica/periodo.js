/*
 * periodo.js — ciclo actual, días al pago y filtrado de movimientos por rango (PURO).
 * Envuelve shared/lib/ciclos.js con los ajustes de la app (historial de día de pago y ciclo inicial).
 */
import { cicloActual, cicloAnterior, cicloDe, cicloSiguiente, diasHastaProximoPago, etiquetaCiclo, listarCiclos, rangoCiclo } from '../../shared/lib/ciclos.js';
import { diferenciaDias, fechaLocalDe, formatearFecha, sumarDias } from '../../shared/lib/fechas.js';

/**
 * Estado del ciclo en la fecha `hoy`.
 * antesDeEmpezar: hoy es anterior al inicio del ciclo inicial (el 28-oct-2026 faltan 4 días para el ciclo '2026-11').
 */
export function estadoCiclo(datos, hoy) {
  const historial = datos.ajustes.diaPago;
  const cicloInicial = datos.ajustes.cicloInicial;
  const ciclo = cicloActual(hoy, historial, cicloInicial);
  const rango = rangoCiclo(ciclo, historial);
  const antesDeEmpezar = hoy < rango.inicio;
  const diasAlPago = diasHastaProximoPago(hoy, historial, cicloInicial);
  return {
    ciclo,
    rango,
    historial,
    cicloInicial,
    antesDeEmpezar,
    diasAlPago,
    diaDelCiclo: antesDeEmpezar ? 0 : diferenciaDias(rango.inicio, hoy) + 1,
    proximoPago: sumarDias(hoy, diasAlPago),
  };
}

/** Ciclo al que pertenece una fecha (no menor que el ciclo inicial). */
export function cicloDeFecha(datos, fecha) {
  const de = cicloDe(fecha, datos.ajustes.diaPago);
  return de >= datos.ajustes.cicloInicial ? de : datos.ajustes.cicloInicial;
}

/** Movimientos con inicio ≤ fecha ≤ fin. */
export function movimientosEnRango(datos, inicio, fin) {
  return datos.movimientos.filter((m) => m.fecha >= inicio && m.fecha <= fin);
}

/**
 * Fecha propuesta para un movimiento nuevo: hoy, pero nunca antes del inicio del ciclo inicial (antes de esa fecha no
 * existen saldos: el 28-oct-2026 se propone el 1-nov-2026).
 */
export function fechaPorDefecto(datos, hoy) {
  const inicio = rangoCiclo(datos.ajustes.cicloInicial, datos.ajustes.diaPago).inicio;
  return hoy < inicio ? inicio : hoy;
}

/**
 * Ciclo desde el que vale un cambio de día de pago pedido en `hoy` (V5, R1F-01 y R1F-02).
 *  - Nunca es el ciclo actual: el actual conserva sus fechas, y "hoy" no puede salir de él.
 *  - Es el primer ciclo k posterior al actual para el que, con el día nuevo, "hoy" sigue en el ciclo actual (equivale a
 *    exigir que el inicio de k sea posterior a hoy). Si el día nuevo ya pasó este mes (p. ej. 15 → 1 el 5-ene), el cambio se
 *    corre un ciclo más: el ciclo intermedio conserva el día vigente y no se pierde ni se duplica ningún día.
 *  - Antes de empezar el programa el "ciclo actual" es el inicial (que ya tiene sus saldos iniciales y su inicio fijo): el
 *    cambio vale desde el ciclo siguiente al inicial, así el primer ciclo no deja días sin ciclo (R1F-02).
 * Devuelve { desdeCiclo, historial, transicion } con el historial resultante (entradas anteriores a `desdeCiclo` + la nueva) y los
 * ciclos de transición INTERMEDIOS (R2F-04): los posteriores al actual y anteriores a `desdeCiclo`, que conservan el día vigente y
 * empiezan DESPUÉS de hoy, o sea en una fecha que el usuario acaba de dejar de usar como día de pago. [] en el caso normal.
 */
export function aplicarDiaPago(datos, dia, hoy) {
  const est = estadoCiclo(datos, hoy);
  let desdeCiclo = cicloSiguiente(est.ciclo);
  for (let i = 0; i < 24; i += 1) {
    const historial = [...datos.ajustes.diaPago.filter((e) => e.desdeCiclo < desdeCiclo), { desdeCiclo, dia }];
    if (cicloActual(hoy, historial, est.cicloInicial) === est.ciclo) return { desdeCiclo, historial, transicion: listarCiclos(cicloSiguiente(est.ciclo), cicloAnterior(desdeCiclo)) };
    desdeCiclo = cicloSiguiente(desdeCiclo);
  }
  throw new Error('No se pudo aplicar el día de pago.');
}

/** Fecha de calendario LOCAL (YYYY-MM-DD) de un instante ISO UTC guardado (p. ej. la fecha de un respaldo). R1F-20. R2F: vive en shared/lib/instantes.js; se re-exporta aquí. */
export { fechaLocalDeInstante } from '../../shared/lib/instantes.js';

/**
 * R2F-04: ¿se espera salario en este ciclo? No en un ciclo de transición sin fecha de pago real (`presupuestos[ciclo].sinSalario`,
 * lo marca `cambiarDiaPago`): su inicio es el día de pago que el usuario acaba de dejar, y el siguiente salario llega en el ciclo
 * que sigue. Así hay un salario esperado por fecha de pago real y no dos con 1 a 17 días de diferencia.
 */
export const cicloSinSalario = (datos, ciclo) => datos.presupuestos[ciclo]?.sinSalario === true;

/** Etiqueta del rango de un ciclo; un ciclo de 1 día no dice "31 – 31 dic 2026" sino "31 dic 2026" (R2F-04/R2F-16). */
export function etiquetaRango(rango) {
  return rango.inicio === rango.fin ? formatearFecha(rango.inicio, 'dia-mes-anio') : etiquetaCiclo(rango);
}
