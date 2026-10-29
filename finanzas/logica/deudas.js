/*
 * deudas.js — amortización consciente de intereses, simulador de abono, avalancha vs. bola de nieve (PURO).
 * ESQUEMA-FINANZAS §6.3–§6.6.
 *
 * Convención de redondeo (documentada): el interés de un período es redondearPesos(saldo × tasaMensual) — al peso más
 * cercano, mitades lejos de cero — UNA vez por período y por deuda; nunca se acumulan fracciones. Todo lo demás es aritmética
 * entera. El último pago es más pequeño y deja el saldo exactamente en 0.
 */
import { fechaConDia, partes } from '../../shared/lib/fechas.js';
import { redondearPesos } from '../../shared/lib/dinero.js';
import { tasaMensual } from './tasas.js';

export const MAX_MESES = 600;

/** Interés de un período: redondearPesos(saldo × i). Sin tasa (null/0) → 0. */
export function interesPeriodo(saldo, i) {
  return i ? redondearPesos(saldo * i) : 0;
}

function fechaDeCuota(primeraFecha, diaPago, n) {
  const { anio, mes } = partes(primeraFecha);
  const indice = anio * 12 + (mes - 1) + (n - 1);
  return fechaConDia(Math.floor(indice / 12), (indice % 12) + 1, diaPago); // 31 → 28/29 → 31, sin "arrastre"
}

/**
 * Proyección mes a mes de una deuda.
 * @param {{saldo:number, cuota:number, tasaMensual:number|null, extraMensual?:number, abonoUnico?:number,
 *          primeraFecha?:string, diaPago?:number, maxMeses?:number}} p
 * @returns {{estado:'ok'|'saldada'|'no-amortiza'|'excede-limite', meses:number, totalIntereses:number, totalPagado:number,
 *            fechaFin:string|null, filas:Array}}
 */
export function proyectar({ saldo, cuota, tasaMensual: i = null, extraMensual = 0, abonoUnico = 0, primeraFecha, diaPago, maxMeses = MAX_MESES }) {
  for (const [nombre, v] of [['saldo', saldo], ['cuota', cuota], ['extraMensual', extraMensual], ['abonoUnico', abonoUnico]]) {
    if (!Number.isSafeInteger(v) || v < 0) throw new TypeError(`${nombre} debe ser un entero en pesos (0 o más).`);
  }
  const vacio = (estado) => ({ estado, meses: 0, totalIntereses: 0, totalPagado: 0, fechaFin: null, filas: [] });
  let s = saldo - Math.min(abonoUnico, saldo);
  if (s === 0) return vacio('saldada');
  const tasa = i ?? 0;
  const tope = cuota + extraMensual;
  const conFechas = typeof primeraFecha === 'string' && Number.isInteger(diaPago);
  const filas = [];
  let totalIntereses = 0;
  let totalPagado = 0;
  for (let n = 1; n <= maxMeses; n += 1) {
    const interes = interesPeriodo(s, tasa);
    if (tope <= interes) return vacio('no-amortiza'); // la cuota no cubre ni el interés: la deuda crece
    const pago = Math.min(tope, s + interes); // el último pago es más pequeño
    const capital = pago - interes;
    const saldoInicial = s;
    s -= capital; // llega exactamente a 0
    totalIntereses += interes;
    totalPagado += pago;
    filas.push({ n, fecha: conFechas ? fechaDeCuota(primeraFecha, diaPago, n) : null, saldoInicial, interes, capital, pago, saldoFinal: s });
    if (s === 0) return { estado: 'ok', meses: n, totalIntereses, totalPagado, fechaFin: filas[n - 1].fecha, filas };
  }
  return { estado: 'excede-limite', meses: maxMeses, totalIntereses, totalPagado, fechaFin: filas[filas.length - 1].fecha, filas };
}

/**
 * Compara proyectar sin abono vs. con abono. Si alguna proyección no es 'ok'/'saldada' el ahorro no es un número
 * (`comparable: false`): la vista muestra el estado.
 * @param {{saldo:number,cuota:number,tasa?:object|null,diaPago?:number}} deuda
 * @param {{extraMensual?:number, abonoUnico?:number}} abono
 * @param {{primeraFecha?:string}} [ctx]
 */
export function simularAbono(deuda, { extraMensual = 0, abonoUnico = 0 } = {}, ctx = {}) {
  const base = { saldo: deuda.saldo, cuota: deuda.cuota, tasaMensual: tasaMensual(deuda.tasa ?? null), primeraFecha: ctx.primeraFecha, diaPago: deuda.diaPago };
  const sin = proyectar(base);
  const con = proyectar({ ...base, extraMensual, abonoUnico });
  const bueno = (r) => r.estado === 'ok' || r.estado === 'saldada';
  const comparable = bueno(sin) && bueno(con);
  return {
    base: sin,
    conAbono: con,
    comparable,
    mesesAhorrados: comparable ? sin.meses - con.meses : null,
    interesesAhorrados: comparable ? sin.totalIntereses - con.totalIntereses : null,
  };
}

function simularEstrategia(vivas, presupuestoMes, orden, maxMeses) {
  const d = vivas.map((x) => ({ ...x, s: x.saldo }));
  const porId = new Map(d.map((x) => [x.id, x]));
  const finPorDeuda = {};
  let totalIntereses = 0;
  let meses = 0;
  while (d.some((x) => x.s > 0)) {
    if (meses >= maxMeses) return { estado: 'excede-limite', meses, totalIntereses, orden, finPorDeuda };
    meses += 1;
    let interesesMes = 0;
    for (const x of d) {
      if (x.s <= 0) continue;
      const interes = interesPeriodo(x.s, x.i);
      x.s += interes;
      interesesMes += interes;
    }
    if (presupuestoMes <= interesesMes) return { estado: 'no-amortiza', meses: 0, totalIntereses: 0, orden, finPorDeuda: {} };
    totalIntereses += interesesMes;
    let restante = presupuestoMes;
    for (const x of d) { // pago mínimo a cada deuda viva
      if (x.s <= 0) continue;
      const pago = Math.min(x.cuota, x.s);
      x.s -= pago;
      restante -= pago;
    }
    for (const id of orden) { // el resto, a la primera viva del orden; el sobrante pasa a la siguiente en el mismo mes
      if (restante <= 0) break;
      const x = porId.get(id);
      if (x.s <= 0) continue;
      const pago = Math.min(restante, x.s);
      x.s -= pago;
      restante -= pago;
    }
    for (const x of d) if (x.s === 0 && finPorDeuda[x.id] === undefined) finPorDeuda[x.id] = meses;
  }
  return { estado: 'ok', meses, totalIntereses, orden, finPorDeuda };
}

/**
 * Avalancha (mayor tasa primero) vs. bola de nieve (menor saldo primero) con presupuesto mensual CONSTANTE
 * (Σ cuotas iniciales + extra): las cuotas de las deudas saldadas se liberan hacia la siguiente.
 * Además calcula `soloCuotas` (cada deuda paga solo su cuota, sin liberar nada), para comparar.
 * @param {Array<{id:string, nombre?:string, saldo:number, cuota:number, tasaMensual:number|null}>} deudas
 */
export function compararEstrategias(deudas, extraMensual = 0, { maxMeses = MAX_MESES } = {}) {
  const vivas = deudas.filter((d) => d.saldo > 0).map((d) => ({ id: d.id, nombre: d.nombre ?? d.id, saldo: d.saldo, cuota: d.cuota, i: d.tasaMensual ?? 0, sinTasa: !d.tasaMensual }));
  const advertencias = vivas.filter((d) => d.sinTasa).map((d) => `${d.nombre} sin tasa: avalancha aproximada`);
  const todasSinTasa = vivas.length > 0 && vivas.every((d) => d.sinTasa);
  if (todasSinTasa) advertencias.push('Ninguna deuda tiene tasa: avalancha y bola de nieve coinciden y no se estiman intereses.');
  const presupuestoMes = vivas.reduce((s, d) => s + d.cuota, 0) + extraMensual;
  const ordenAvalancha = [...vivas].sort((a, b) => b.i - a.i || a.saldo - b.saldo || (a.id < b.id ? -1 : 1)).map((d) => d.id);
  const ordenBola = [...vivas].sort((a, b) => a.saldo - b.saldo || b.i - a.i || (a.id < b.id ? -1 : 1)).map((d) => d.id);

  const unicas = vivas.map((d) => proyectar({ saldo: d.saldo, cuota: d.cuota, tasaMensual: d.i, maxMeses }));
  const soloCuotas = unicas.some((r) => r.estado === 'no-amortiza')
    ? { estado: 'no-amortiza', meses: 0, totalIntereses: 0 }
    : unicas.some((r) => r.estado === 'excede-limite')
      ? { estado: 'excede-limite', meses: maxMeses, totalIntereses: unicas.reduce((s, r) => s + r.totalIntereses, 0) }
      : { estado: 'ok', meses: Math.max(0, ...unicas.map((r) => r.meses)), totalIntereses: unicas.reduce((s, r) => s + r.totalIntereses, 0) };

  return {
    avalancha: simularEstrategia(vivas, presupuestoMes, ordenAvalancha, maxMeses),
    bolaDeNieve: simularEstrategia(vivas, presupuestoMes, ordenBola, maxMeses),
    soloCuotas,
    presupuestoMes,
    todasSinTasa,
    advertencias,
  };
}

/**
 * Pago propuesto para una cuota: min(cuota, saldo + interés del período); interés = min(monto, interesPeriodo(saldo, i)).
 * El usuario puede corregirlo con el dato del extracto.
 */
export function cuotaPropuesta(deuda, saldo) {
  const i = tasaMensual(deuda.tasa ?? null);
  const interesDelPeriodo = interesPeriodo(Math.max(0, saldo), i);
  const monto = Math.min(deuda.cuota, Math.max(0, saldo) + interesDelPeriodo);
  return { monto, interes: Math.min(monto, interesDelPeriodo) };
}

/** Cuotas que faltan sin intereses (saldo/cuota, hacia arriba) y último pago. Para deudas sin tasa. */
export function cuotasSinInteres(saldo, cuota) {
  if (saldo <= 0) return { meses: 0, ultimoPago: 0 };
  const meses = Math.floor((saldo + cuota - 1) / cuota);
  return { meses, ultimoPago: saldo - (meses - 1) * cuota };
}
