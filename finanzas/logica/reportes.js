/*
 * reportes.js — gasto por categoría, tendencia de ciclos, tasa de ahorro y patrimonio (PURO). ESQUEMA-FINANZAS §12.
 *
 * Definiciones:
 *  - Consumo del ciclo = Σ gasto.monto + Σ pagoDeuda.interes. El capital pagado a deudas y los aportes a metas NO son consumo.
 *  - Tasa de ahorro = (ingresoReal − consumo) / ingresoReal; null si no hay ingresos registrados. Como cuenta el capital de las
 *    deudas y lo aún no gastado, puede verse alta frente a la meta del 20 % (P6): por eso se muestra junto a
 *    "Ahorro y metas ejecutado" (aportes a metas + capital del abono extra, sin intereses, sobre el ingreso) y con su descomposición.
 *  - Los ajustes (ajusteCuenta/ajusteDeuda) no entran en consumo ni en tasa de ahorro; sí en patrimonio.
 *  - Corte de fechas (R1F-10): con `hasta` (hoy) los movimientos con fecha futura ("programados") no cuentan todavía.
 */
import { listarCiclos, rangoCiclo } from '../../shared/lib/ciclos.js';
import { calcularSaldos, patrimonioNeto } from './saldos.js';
import { estadoCiclo } from './periodo.js';
import { resumenCiclo } from './presupuesto.js';

/** Flujos del ciclo desde los movimientos (sin recortes por categoría). */
export function flujosDelCiclo(datos, rango, hasta) {
  const fin = hasta && hasta < rango.fin ? hasta : rango.fin;
  let ingreso = 0;
  let gastos = 0;
  let intereses = 0;
  let capital = 0;
  let aportes = 0;
  let pagosDeuda = 0;
  for (const m of datos.movimientos) {
    if (m.fecha < rango.inicio || m.fecha > fin) continue;
    if (m.tipo === 'ingreso') ingreso += m.monto;
    else if (m.tipo === 'gasto') gastos += m.monto;
    else if (m.tipo === 'pagoDeuda') {
      intereses += m.interes;
      capital += m.monto - m.interes;
      pagosDeuda += m.monto;
    } else if (m.tipo === 'aporteMeta') aportes += m.monto;
    else if (m.tipo === 'retiroMeta') aportes -= m.monto;
  }
  const consumo = gastos + intereses;
  const ejecutadoNeto = gastos + pagosDeuda + aportes;
  return { ingreso, gastos, intereses, consumo, capital, aportes, ejecutadoNeto };
}

/**
 * Tasa de ahorro y su descomposición exacta: ingreso − consumo = capital pagado a deudas + aportes a metas + lo no gastado.
 * @returns {{ingreso:number, consumo:number, ahorro:number, tasa:number|null, capital:number, aportes:number, sinGastar:number,
 *            ahorroEjecutado:number, interesAbono:number, ahorroEjecutadoPct:number|null, ahorroPlanPct:number|null}}
 */
export function tasaDeAhorro(datos, ciclo, hasta) {
  const rango = rangoCiclo(ciclo, datos.ajustes.diaPago);
  const f = flujosDelCiclo(datos, rango, hasta);
  const r = resumenCiclo(datos, ciclo, hasta);
  // R1F-14 / N-06: el ahorro ejecutado (aportes a metas + capital del abono extra) no incluye los intereses de un abono: esos son
  // consumo (ya entran en `consumo`) y no pueden contar a la vez como ahorro. Es la MISMA cifra que muestran Inicio y Presupuesto:
  // `resumenCiclo` ya deja los intereses del abono fuera del grupo ahorro (los suma a "Pago de deudas").
  const ahorroEjecutado = r.grupos.ahorro.ejecutado;
  const base = r.base.monto;
  return {
    ingreso: f.ingreso,
    consumo: f.consumo,
    ahorro: f.ingreso - f.consumo,
    tasa: f.ingreso > 0 ? (f.ingreso - f.consumo) / f.ingreso : null,
    capital: f.capital,
    aportes: f.aportes,
    sinGastar: f.ingreso - f.ejecutadoNeto,
    ahorroEjecutado,
    interesAbono: r.interesAbono,
    ahorroEjecutadoPct: base > 0 ? ahorroEjecutado / base : null,
    ahorroPlanPct: r.grupos.ahorro.asignadoPct,
  };
}

/**
 * Gasto por categoría sumando los ciclos dados (necesidades + gustos; el ahorro se reporta aparte), de mayor a menor.
 * @returns {{total:number, filas:Array<{categoria, monto:number, fraccion:number}>}}
 */
export function gastoPorCategoria(datos, ciclos, hasta) {
  const montos = {};
  for (const ciclo of ciclos) {
    const r = resumenCiclo(datos, ciclo, hasta);
    for (const l of r.lineas) if (l.categoria.grupo !== 'ahorro') montos[l.categoria.id] = (montos[l.categoria.id] ?? 0) + l.ejecutado;
  }
  const filas = datos.categorias
    .filter((c) => montos[c.id] > 0)
    .map((categoria) => ({ categoria, monto: montos[categoria.id] }))
    .sort((a, b) => b.monto - a.monto || a.categoria.orden - b.categoria.orden);
  const total = filas.reduce((s, f) => s + f.monto, 0);
  return { total, filas: filas.map((f) => ({ ...f, fraccion: total > 0 ? f.monto / total : 0 })) };
}

/** Últimos `n` ciclos (≥ ciclo inicial) hasta el actual, de más antiguo a más reciente. */
export function ciclosRecientes(datos, hoy, n = 6) {
  const est = estadoCiclo(datos, hoy);
  const todos = listarCiclos(est.cicloInicial, est.ciclo);
  return todos.slice(Math.max(0, todos.length - n));
}

/** Un ciclo con menos días que esto no es comparable con uno normal (R2F-04: ciclo de transición tras cambiar el día de pago). */
export const DIAS_CICLO_CORTO = 20;

/**
 * Tendencia por ciclo: ingreso real, gasto (necesidades+gustos ejecutado), consumo, ahorro y tasa, y patrimonio al fin
 * del ciclo (o hoy si el ciclo está en curso).
 * R2F-04: `transicion` = el ciclo no es comparable (sin salario esperado por cambio de día de pago, o de menos de
 * DIAS_CICLO_CORTO días): la vista lo rotula y no muestra su tasa de ahorro (un ciclo de 1 día daba 100 %).
 */
export function tendencia(datos, hoy, n = 6) {
  return ciclosRecientes(datos, hoy, n).map((ciclo) => {
    const rango = rangoCiclo(ciclo, datos.ajustes.diaPago);
    const f = flujosDelCiclo(datos, rango, hoy);
    const r = resumenCiclo(datos, ciclo, hoy);
    const corte = hoy < rango.fin ? hoy : rango.fin;
    return {
      ciclo,
      rango,
      dias: rango.dias,
      transicion: r.sinSalario || rango.dias < DIAS_CICLO_CORTO,
      ingreso: f.ingreso,
      gastado: r.grupos.necesidades.ejecutado + r.grupos.gustos.ejecutado,
      consumo: f.consumo,
      ahorro: f.ingreso - f.consumo,
      tasa: f.ingreso > 0 ? (f.ingreso - f.consumo) / f.ingreso : null,
      patrimonio: patrimonioNeto(datos, corte).patrimonio,
    };
  });
}

/** Patrimonio neto hoy y su composición (cuentas no crédito − todas las deudas). */
export function patrimonioHoy(datos, hoy) {
  const saldos = calcularSaldos(datos, hoy);
  return { ...patrimonioNeto(datos, hoy, saldos), saldos };
}

