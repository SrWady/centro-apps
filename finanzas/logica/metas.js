/*
 * metas.js — progreso y aporte sugerido de metas de ahorro (PURO). ESQUEMA-FINANZAS §11.
 *
 * Aporte sugerido por ciclo (se redondea HACIA ARRIBA al peso para no quedar corto):
 *   ciclosRestantes = ciclosEntre(cicloActual, cicloLimite) + 1      (incluye el actual)
 *   ahorradoInicio  = ahorrado(meta, inicio(cicloActual) − 1 día)     (estable durante el ciclo)
 *   restante        = max(0, objetivo − ahorradoInicio)
 *   sugerido        = restante === 0 ? 0 : ciclosRestantes ≥ 1 ? ceil(restante / ciclosRestantes) : restante
 */
import { cicloDe, ciclosEntre } from '../../shared/lib/ciclos.js';
import { dividirHaciaArriba } from '../../shared/lib/dinero.js';
import { sumarDias } from '../../shared/lib/fechas.js';
import { estadoCiclo } from './periodo.js';

/** Σ aporteMeta − Σ retiroMeta de la meta con fecha ≤ hasta. */
export function ahorrado(datos, metaId, hasta) {
  let total = 0;
  for (const m of datos.movimientos) {
    if (m.metaId !== metaId || m.fecha > hasta) continue;
    if (m.tipo === 'aporteMeta') total += m.monto;
    else if (m.tipo === 'retiroMeta') total -= m.monto;
  }
  return total;
}

/** Aportes netos de la meta dentro de un rango {inicio, fin}. */
export function aportadoEnRango(datos, metaId, rango) {
  let total = 0;
  for (const m of datos.movimientos) {
    if (m.metaId !== metaId || m.fecha < rango.inicio || m.fecha > rango.fin) continue;
    if (m.tipo === 'aporteMeta') total += m.monto;
    else if (m.tipo === 'retiroMeta') total -= m.monto;
  }
  return total;
}

/**
 * Saldo de la meta al cierre de cada fecha con movimientos (aportes − retiros acumulados), de la más antigua a la más reciente.
 * "movimientos" es cualquier lista (permite probar un cambio ANTES de aplicarlo).
 */
export function saldosPorFecha(movimientos, metaId) {
  const porFecha = new Map();
  for (const m of movimientos) {
    if (m.metaId !== metaId) continue;
    if (m.tipo === 'aporteMeta') porFecha.set(m.fecha, (porFecha.get(m.fecha) ?? 0) + m.monto);
    else if (m.tipo === 'retiroMeta') porFecha.set(m.fecha, (porFecha.get(m.fecha) ?? 0) - m.monto);
  }
  let acumulado = 0;
  return [...porFecha.keys()].sort().map((fecha) => { acumulado += porFecha.get(fecha); return { fecha, saldo: acumulado }; });
}

/** Menor saldo que alcanza la meta en cualquier fecha (0 si no tiene movimientos). Negativo = se retiró más de lo apartado. */
export function saldoMinimoMeta(movimientos, metaId) {
  return saldosPorFecha(movimientos, metaId).reduce((min, p) => Math.min(min, p.saldo), 0);
}

/**
 * Lo máximo que se puede retirar en "fecha" sin que la meta quede en negativo ni ese día ni después (descuenta retiros
 * posteriores ya registrados). "movimientos" NO debe incluir el retiro que se está probando.
 */
export function maximoRetirable(movimientos, metaId, fecha) {
  const puntos = saldosPorFecha(movimientos, metaId);
  let ahora = 0;
  for (const p of puntos) if (p.fecha <= fecha) ahora = p.saldo;
  let minimo = ahora;
  for (const p of puntos) if (p.fecha > fecha) minimo = Math.min(minimo, p.saldo);
  return Math.max(0, minimo);
}

/**
 * @returns {{meta, ahorrado:number, fraccion:number, estado:'cumplida'|'vencida'|'en-curso', cicloLimite:string,
 *            ciclosRestantes:number, ahorradoInicio:number, restante:number, faltante:number, sugerido:number, aportadoEnCiclo:number,
 *            pendienteCiclo:number, programado:number}}
 * `restante` (lo que falta al INICIO del ciclo) es la base del sugerido y no cambia durante el ciclo; `faltante` (objetivo − ahorrado
 * a hoy) es lo que muestra la tarjeta (H-05). `programado` = aportes netos con fecha futura, que aún no cuentan (H-10).
 */
export function progresoMeta(datos, meta, hoy) {
  const est = estadoCiclo(datos, hoy);
  const cicloLimite = cicloDe(meta.fechaLimite, est.historial);
  const ciclosRestantes = ciclosEntre(est.ciclo, cicloLimite) + 1;
  const total = ahorrado(datos, meta.id, hoy);
  // R1F-16: también con el mismo corte (≤ hoy): antes de empezar, "el día anterior al ciclo" es posterior a hoy y no debe contar lo que aún no llega.
  const diaAntes = sumarDias(est.rango.inicio, -1);
  const ahorradoInicio = ahorrado(datos, meta.id, diaAntes < hoy ? diaAntes : hoy);
  // R1F-04: un ahorrado negativo (solo llega por datos importados) no infla lo que falta: lo que falta nunca pasa del objetivo.
  const restante = Math.max(0, meta.objetivo - Math.max(0, ahorradoInicio));
  const cumplida = total >= meta.objetivo;
  const sugerido = cumplida || restante === 0 ? 0 : ciclosRestantes >= 1 ? dividirHaciaArriba(restante, ciclosRestantes) : restante;
  // R1F-16: mismo corte que `ahorrado` (fecha ≤ hoy); un aporte con fecha futura es "programado" y aún no cuenta.
  const aportadoEnCiclo = aportadoEnRango(datos, meta.id, { inicio: est.rango.inicio, fin: est.rango.fin < hoy ? est.rango.fin : hoy });
  const programado = aportadoEnRango(datos, meta.id, { inicio: sumarDias(hoy, 1), fin: '9999-12-31' });
  const estado = cumplida ? 'cumplida' : est.ciclo > cicloLimite ? 'vencida' : 'en-curso';
  return {
    meta,
    ahorrado: total,
    fraccion: Math.max(0, Math.min(1, total / meta.objetivo)),
    estado,
    cicloLimite,
    ciclosRestantes,
    ahorradoInicio,
    restante,
    faltante: Math.max(0, meta.objetivo - total),
    sugerido,
    aportadoEnCiclo,
    pendienteCiclo: Math.max(0, sugerido - aportadoEnCiclo),
    programado,
  };
}
