/*
 * recurrentes.js — ocurrencias por ciclo y "Próximos pagos" (PURO). ESQUEMA-FINANZAS §10.
 *
 * Tres fuentes de pagos programados (sin duplicar datos):
 *  - recurrentes (lista guardada),
 *  - cuotas de deudas (derivadas de `deudas`: cuota, diaPago, saldo > 0),
 *  - salario (derivado de ajustes.ingreso, en el inicio de cada ciclo).
 * Un pago queda "hecho" cuando existe un movimiento con origen { tipo, id, ocurrencia } (combinación única).
 * R1F-03: además se identifica POR CICLO. Si se cambia el día de un recurrente o de una cuota después de pagarlo, la fecha
 * ocurrencia ya pagada deja de existir; el pago "huérfano" (con origen dentro del ciclo pero sin ocurrencia vigente) cubre,
 * de las ocurrencias pendientes del ciclo, las más tempranas. Así un pago hecho en el ciclo no vuelve a salir pendiente.
 * La gasolina NO es recurrente (V2): no está aquí.
 */
import { diaSemana, fechaConDia, partes, rangoFechas } from '../../shared/lib/fechas.js';
import { cicloDe, rangoCiclo, cicloSiguiente } from '../../shared/lib/ciclos.js';
import { claveOrigen } from './esquema.js';
import { cuotaPropuesta } from './deudas.js';
import { calcularSaldos } from './saldos.js';
import { cicloSinSalario, estadoCiclo } from './periodo.js';

function mesesDelRango(rango) {
  const a = partes(rango.inicio);
  const b = partes(rango.fin);
  const lista = [];
  for (let i = a.anio * 12 + a.mes - 1; i <= b.anio * 12 + b.mes - 1; i += 1) lista.push({ anio: Math.floor(i / 12), mes: (i % 12) + 1 });
  return lista;
}

/** Fechas mensuales (día d, o último día del mes) que caen dentro de [inicio, fin] y ≥ desde. */
export function ocurrenciasMensuales(dia, rango, desde = '0000-01-01') {
  return mesesDelRango(rango)
    .map(({ anio, mes }) => fechaConDia(anio, mes, dia))
    .filter((f) => f >= rango.inicio && f <= rango.fin && f >= desde);
}

/** Ocurrencias de un recurrente en el rango de un ciclo ({inicio, fin}). */
export function ocurrenciasRecurrente(recurrente, rango) {
  const f = recurrente.frecuencia;
  if (f.tipo === 'mensual') return ocurrenciasMensuales(f.dia, rango, recurrente.desde);
  return rangoFechas(rango.inicio, rango.fin).filter((x) => diaSemana(x) === f.diaSemana && x >= recurrente.desde);
}

/** Ocurrencias de la cuota de una deuda (diaPago) en el rango; nunca antes de su saldo inicial. */
export function ocurrenciasCuota(deuda, rango) {
  return ocurrenciasMensuales(deuda.diaPago, rango, deuda.fechaSaldoInicial);
}

export function clavesUsadas(datos) {
  const usadas = new Set();
  for (const m of datos.movimientos) if (m.origen) usadas.add(claveOrigen(m.origen));
  return usadas;
}

/** Índice (tipo|id) → fechas de ocurrencia ya registradas (de los movimientos con origen). */
export function indiceOrigenes(datos) {
  const indice = new Map();
  for (const m of datos.movimientos) {
    if (!m.origen) continue;
    const k = `${m.origen.tipo}|${m.origen.id}`;
    if (!indice.has(k)) indice.set(k, []);
    indice.get(k).push(m.origen.ocurrencia);
  }
  return indice;
}

/**
 * Ocurrencias de un pago programado que siguen pendientes en un ciclo (R1F-03).
 * @param {string[]} ocurrencias fechas vigentes del pago dentro de `rango` (ordenadas)
 * @param {string[]} hechas      ocurrencias registradas (cualquier ciclo) del mismo (tipo, id)
 */
export function pendientesEnCiclo(ocurrencias, hechas, rango) {
  const enCiclo = new Set(hechas.filter((f) => f >= rango.inicio && f <= rango.fin));
  const sinPagar = ocurrencias.filter((f) => !enCiclo.has(f));
  const huerfanos = enCiclo.size - (ocurrencias.length - sinPagar.length); // pagos del ciclo cuya fecha ya no es una ocurrencia
  return sinPagar.slice(Math.max(0, huerfanos));
}

/** ¿Se puede registrar esa ocurrencia (existe, no está pagada y no la cubre un pago ya hecho en su ciclo)? */
export function ocurrenciaPendiente(datos, origen) {
  if (!ocurrenciaExiste(datos, origen)) return false;
  if (origen.tipo === 'salario') return !clavesUsadas(datos).has(claveOrigen(origen));
  const historial = datos.ajustes.diaPago;
  const rango = rangoCiclo(cicloDe(origen.ocurrencia, historial), historial);
  const hechas = indiceOrigenes(datos).get(`${origen.tipo}|${origen.id}`) ?? [];
  const fuente = origen.tipo === 'cuota' ? datos.deudas.find((x) => x.id === origen.id) : datos.recurrentes.find((x) => x.id === origen.id);
  const vigentes = origen.tipo === 'cuota' ? ocurrenciasCuota(fuente, rango) : ocurrenciasRecurrente(fuente, rango);
  return pendientesEnCiclo(vigentes, hechas, rango).includes(origen.ocurrencia);
}

/**
 * Fecha de la próxima cuota de `deuda` no marcada como pagada (≥ inicio del ciclo actual), para la proyección. Mira ciclo
 * por ciclo (R1F-03): una cuota pagada este ciclo con otro día de pago no deja pendiente la del día nuevo.
 */
export function primeraCuotaPendiente(datos, deuda, hoy) {
  const estado = estadoCiclo(datos, hoy);
  const hechas = indiceOrigenes(datos).get(`cuota|${deuda.id}`) ?? [];
  let ciclo = estado.ciclo;
  for (let k = 0; k < 120; k += 1) {
    const rango = rangoCiclo(ciclo, estado.historial);
    const pendientes = pendientesEnCiclo(ocurrenciasCuota(deuda, rango), hechas, rango);
    if (pendientes.length) return pendientes[0];
    ciclo = cicloSiguiente(ciclo);
  }
  return estado.rango.inicio > deuda.fechaSaldoInicial ? estado.rango.inicio : deuda.fechaSaldoInicial;
}

const ORDEN_TIPO = { salario: 0, cuota: 1, recurrente: 2 };

/** Estado de presentación de un pago pendiente (H-09). */
export function estadoDePago(tipo, ocurrencia, hoy) {
  if (tipo === 'salario') return ocurrencia <= hoy ? 'por-recibir' : 'proximo';
  if (ocurrencia >= hoy) return 'proximo';
  return tipo === 'cuota' ? 'vencida' : 'pendiente';
}

/**
 * Pagos programados del ciclo `ciclo` (por defecto el actual) sin movimiento asociado, ordenados por fecha.
 * Cada elemento: { clave, tipo:'salario'|'cuota'|'recurrente', id, ocurrencia, nombre, monto, rango, esIngreso,
 *                  vencido, estado, cuentaId, categoriaId, deudaId?, interes? }.
 * `vencido` = su fecha ya pasó (dato crudo). `estado` es lo que muestra la UI (H-09): 'por-recibir' (el salario del ciclo, que
 * nunca es "vencido"), 'vencida' (solo una cuota de deuda con fecha pasada), 'pendiente' (recurrente con fecha pasada sin marcar:
 * tono neutro) o 'proximo' (fecha de hoy o futura).
 * Una cuota se omite si la deuda está saldada (saldo ≤ 0) o archivada.
 */
export function proximosPagos(datos, hoy, ciclo, saldos) {
  const estado = estadoCiclo(datos, hoy);
  const idCiclo = ciclo ?? estado.ciclo;
  const rango = rangoCiclo(idCiclo, estado.historial);
  const usadas = clavesUsadas(datos);
  const indice = indiceOrigenes(datos);
  const s = saldos ?? calcularSaldos(datos, hoy);
  const items = [];
  const agregar = (tipo, id, ocurrencia, extra) => {
    const clave = claveOrigen({ tipo, id, ocurrencia });
    if (usadas.has(clave)) return;
    items.push({ clave, tipo, id, ocurrencia, vencido: ocurrencia < hoy, estado: estadoDePago(tipo, ocurrencia, hoy), rango: null, ...extra });
  };
  const pendientes = (tipo, id, ocurrencias) => pendientesEnCiclo(ocurrencias, indice.get(`${tipo}|${id}`) ?? [], rango);

  const ing = datos.ajustes.ingreso;
  if (ing.montoMensual > 0 && rango.inicio >= datos.ajustes.cicloInicial + '-01' && !cicloSinSalario(datos, idCiclo)) { // R2F-04: un ciclo de transición sin fecha de pago no espera salario
    agregar('salario', 'ingreso', rango.inicio, { nombre: ing.nombre, monto: ing.montoMensual, esIngreso: true, cuentaId: ing.cuentaId, categoriaId: ing.categoriaId });
  }
  for (const d of datos.deudas) {
    if (d.archivada || s.deudas[d.id] <= 0) continue;
    const p = cuotaPropuesta(d, s.deudas[d.id]);
    for (const f of pendientes('cuota', d.id, ocurrenciasCuota(d, rango))) {
      agregar('cuota', d.id, f, { nombre: `Cuota ${d.nombre.toLowerCase()}`, monto: p.monto, interes: p.interes, esIngreso: false, deudaId: d.id, cuentaId: datos.ajustes.ingreso.cuentaId, categoriaId: datos.categorias.find((c) => c.vinculo === 'cuotas-deudas').id });
    }
  }
  for (const r of datos.recurrentes) {
    if (!r.activo) continue;
    for (const f of pendientes('recurrente', r.id, ocurrenciasRecurrente(r, rango))) {
      agregar('recurrente', r.id, f, { nombre: r.nombre, monto: r.monto, rango: r.rango, esIngreso: r.tipo === 'ingreso', cuentaId: r.cuentaId, categoriaId: r.categoriaId });
    }
  }
  items.sort((a, b) => (a.ocurrencia < b.ocurrencia ? -1 : a.ocurrencia > b.ocurrencia ? 1 : ORDEN_TIPO[a.tipo] - ORDEN_TIPO[b.tipo] || a.nombre.localeCompare(b.nombre, 'es')));
  return items;
}

/** ¿Existe esa ocurrencia programada? (la usa marcarPagado para no aceptar pagos inventados) */
export function ocurrenciaExiste(datos, origen) {
  const historial = datos.ajustes.diaPago;
  const r = rangoCiclo(cicloDe(origen.ocurrencia, historial), historial);
  if (origen.tipo === 'salario') return origen.id === 'ingreso' && origen.ocurrencia === r.inicio && !cicloSinSalario(datos, cicloDe(origen.ocurrencia, historial));
  if (origen.tipo === 'cuota') {
    const d = datos.deudas.find((x) => x.id === origen.id);
    return !!d && ocurrenciasCuota(d, r).includes(origen.ocurrencia);
  }
  const rec = datos.recurrentes.find((x) => x.id === origen.id);
  return !!rec && rec.activo && ocurrenciasRecurrente(rec, r).includes(origen.ocurrencia);
}

/** Resumen del ciclo siguiente (cuántos pagos y cuánto): { fecha, cantidad, total } | null. Para el aviso "1 dic · 8 pagos". */
export function resumenCicloSiguiente(datos, hoy) {
  const estado = estadoCiclo(datos, hoy);
  const siguiente = cicloSiguiente(estado.ciclo);
  const rango = rangoCiclo(siguiente, estado.historial);
  const s = calcularSaldos(datos, hoy);
  let cantidad = 0;
  let total = 0;
  for (const d of datos.deudas) {
    if (d.archivada || s.deudas[d.id] <= 0) continue;
    const n = ocurrenciasCuota(d, rango).length;
    cantidad += n;
    total += n * Math.min(d.cuota, s.deudas[d.id]);
  }
  for (const r of datos.recurrentes) {
    if (!r.activo || r.tipo !== 'gasto') continue;
    const n = ocurrenciasRecurrente(r, rango).length;
    cantidad += n;
    total += n * r.monto;
  }
  return cantidad === 0 ? null : { fecha: rango.inicio, cantidad, total };
}

