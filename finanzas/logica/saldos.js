/*
 * saldos.js — saldos de cuentas y deudas, patrimonio neto (PURO). ESQUEMA-FINANZAS §5, §6.2, §9.4.
 *
 * Todo en pesos enteros, calculado desde el saldo inicial + movimientos con fecha ≤ `hasta` (los de fecha futura son
 * "programados" y no suman). La tarjeta de crédito es UNA entidad (la deuda): su cuenta `credito` solo muestra −saldo(deuda)
 * y nunca entra en la suma de activos ni de pasivos del patrimonio (H4/D7).
 *
 * Historia estable (R1F-15): una cuenta o deuda no existe antes de su `fechaSaldoInicial`: en un corte anterior a esa fecha su
 * saldo es 0 (no suma su saldo inicial), así crear hoy una cuenta o deuda no reescribe el patrimonio de ciclos pasados.
 * Excepción: las de apertura (fecha ≤ inicio del programa, p. ej. la semilla del 1-nov-2026) se ven también en la vista previa
 * anterior al inicio (el 28-oct-2026 se muestran los saldos iniciales).
 */
import { rangoCiclo } from '../../shared/lib/ciclos.js';

/**
 * Calcula de una sola pasada los saldos de todas las cuentas (no crédito) y deudas.
 * @returns {{cuentas: Record<string,number>, deudas: Record<string,number>}}
 */
export function calcularSaldos(datos, hasta) {
  const cuentas = {};
  const deudas = {};
  const cuentaCredito = new Map();
  const inicioPrograma = rangoCiclo(datos.ajustes.cicloInicial, datos.ajustes.diaPago).inicio;
  const existe = (fechaInicial) => hasta >= fechaInicial || fechaInicial <= inicioPrograma;
  for (const c of datos.cuentas) {
    if (c.tipo === 'credito') cuentaCredito.set(c.id, c.deudaId);
    else cuentas[c.id] = existe(c.fechaSaldoInicial) ? c.saldoInicial : 0;
  }
  for (const d of datos.deudas) deudas[d.id] = existe(d.fechaSaldoInicial) ? d.saldoInicial : 0;

  const sumar = (mapa, id, delta) => {
    if (id in mapa) mapa[id] += delta;
  };
  for (const m of datos.movimientos) {
    if (m.fecha > hasta) continue;
    switch (m.tipo) {
      case 'gasto':
        if (cuentaCredito.has(m.cuentaId)) sumar(deudas, cuentaCredito.get(m.cuentaId), m.monto);
        else sumar(cuentas, m.cuentaId, -m.monto);
        break;
      case 'ingreso':
        sumar(cuentas, m.cuentaId, m.monto);
        break;
      case 'transferencia':
        sumar(cuentas, m.cuentaId, -m.monto);
        sumar(cuentas, m.cuentaDestinoId, m.monto);
        break;
      case 'pagoDeuda':
        sumar(cuentas, m.cuentaId, -m.monto);
        sumar(deudas, m.deudaId, -(m.monto - m.interes));
        break;
      case 'aporteMeta':
      case 'retiroMeta': {
        // Con destino: el dinero se mueve de cuenta (aporte: origen → destino; retiro: igual, "origen" es donde estaba apartado).
        if (m.cuentaDestinoId) {
          sumar(cuentas, m.cuentaId, -m.monto);
          sumar(cuentas, m.cuentaDestinoId, m.monto);
        }
        break;
      }
      case 'ajusteCuenta':
        sumar(cuentas, m.cuentaId, m.monto);
        break;
      case 'ajusteDeuda':
        sumar(deudas, m.deudaId, m.monto);
        break;
      default:
    }
  }
  return { cuentas, deudas };
}

export function saldoDeuda(datos, deudaId, hasta) {
  return calcularSaldos(datos, hasta).deudas[deudaId];
}

/** Saldo de una cuenta; en una cuenta de crédito es −saldo(deuda vinculada). */
export function saldoCuenta(datos, cuentaId, hasta) {
  const cuenta = datos.cuentas.find((c) => c.id === cuentaId);
  if (!cuenta) return undefined;
  const s = calcularSaldos(datos, hasta);
  return cuenta.tipo === 'credito' ? -s.deudas[cuenta.deudaId] : s.cuentas[cuentaId];
}

/** Patrimonio neto = Σ saldo de cuentas NO crédito − Σ saldo de TODAS las deudas. */
export function patrimonioNeto(datos, hasta, saldos = calcularSaldos(datos, hasta)) {
  const activos = Object.values(saldos.cuentas).reduce((s, v) => s + v, 0);
  const pasivos = Object.values(saldos.deudas).reduce((s, v) => s + v, 0);
  return { activos, pasivos, patrimonio: activos - pasivos };
}

/** Estado derivado de una deuda: 'saldada' (saldo 0), 'a-favor' (saldo < 0) o 'activa'. */
export function estadoDeuda(saldo) {
  return saldo === 0 ? 'saldada' : saldo < 0 ? 'a-favor' : 'activa';
}

/** Dinero apartado para metas a `hasta` = Σ aportes − Σ retiros (todas las metas). */
export function totalApartadoMetas(datos, hasta) {
  let total = 0;
  for (const m of datos.movimientos) {
    if (m.fecha > hasta) continue;
    if (m.tipo === 'aporteMeta') total += m.monto;
    else if (m.tipo === 'retiroMeta') total -= m.monto;
  }
  return total;
}
