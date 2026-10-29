/*
 * presupuesto.js — ejecución por categoría/grupo, sin asignar, disponible, alertas y copia de ciclo (PURO).
 * ESQUEMA-FINANZAS §8. Comparaciones de alerta en enteros (se multiplica, no se divide).
 *
 * Convención (V3/V4): "Disponible del ciclo" = ingreso (real o, si no hay, planeado) − ejecutado.
 * Una compra con tarjeta consume su categoría al comprar; el pago de la tarjeta consume "Pago de deudas".
 *
 * "Pago de deudas" (H-04): la línea vinculada `cuotas-deudas` es CALCULADA y sigue a las cuotas vigentes de las deudas mientras el
 * usuario no la edite a mano (`presupuesto.pagoDeudasFijo`): en el ciclo actual y los futuros (con `hasta`) el monto asignado es
 * siempre `pagoDeudasCalculado`; los ciclos cerrados conservan lo guardado (`alAbrir` lo congela al abrir el ciclo siguiente).
 *
 * Ahorro (N-06): "Ahorro y metas ejecutado" tiene UNA sola definición en Inicio, Presupuesto y Reportes: aportes a metas + capital del abono
 * extra a deudas (RU-02: un GASTO en una categoría de ahorro propia es consumo y no suma aquí; ver `grupos.ahorro.consumoPropias`). Los intereses de un abono NO son ahorro: se cuentan como consumo, o sea en la línea "Pago de deudas" (el efectivo
 * que sale del bolsillo no cambia: `totalEjecutado` y `disponible` siguen siendo de caja). Ver `ejecutadoPorCategoria`.
 *
 * Ingreso base (N-08, R3F-04): la base del ciclo es el SALARIO (o ingreso mensual) recibido: Presupuesto, Inicio y Reportes usan ese real
 * (`base`); mientras no se marque recibido, el planeado ("aprox."), y no hay "sobreasignado". Los demás ingresos (un reembolso, un ingreso
 * extra) NO redefinen la base: suman al disponible (`ingresoOtros`). Es salario el ingreso con origen `salario` (el de "Recibido") o con la
 * categoría de ingreso de Ajustes (el que se escribe a mano con "+").
 *
 * "Pago de deudas" y deudas nuevas (R2F-15b): una deuda creada a mitad de ciclo entra con su cuota en el calculado del ciclo en que nace
 * (si todavía le queda una cuota por venir en ese ciclo) y desde el siguiente con su saldo al inicio; al cerrar el ciclo se congela.
 *
 * Alertas y el abono con intereses (N3-03): el interés de un abono extra cuenta como consumo en "Pago de deudas" (N-06), pero no debe
 * volver "excedida" esa línea si lo único que la pasa del 100 % es ese interés: cada línea trae `interesAbono` y la alerta de "Pago de deudas"
 * se decide sin ese interés. La línea del abono conserva su alerta (queda en 94 % porque el interés no es capital: decisión N-06) pero la
 * vista la explica en la propia alerta.
 *
 * Corte de fechas (R1F-10): con `hasta` (normalmente hoy) solo cuentan los movimientos con fecha ≤ hasta; los de fecha futura son
 * "programados" y no suman al ejecutado, al ingreso real ni al disponible hasta que llegue su fecha (igual que en los saldos,
 * saldos.js). Sin `hasta` se cuenta todo el rango (ciclos cerrados y pruebas).
 */
const finDeCorte = (rango, hasta) => (hasta && hasta < rango.fin ? hasta : rango.fin);

import { rangoCiclo } from '../../shared/lib/ciclos.js';
import { sumarDias } from '../../shared/lib/fechas.js';
import { calcularSaldos } from './saldos.js';
import { ocurrenciasCuota } from './recurrentes.js';
import { GRUPOS, MAX_PESOS, esCicloRazonable } from './esquema.js';

/**
 * ¿La categoría de gasto cuenta como CONSUMO (aparece en "Gasto por categoría" y en la tendencia de gasto)? Sí: necesidades, gustos y las
 * categorías de ahorro que el usuario creó y a las que registra gastos. No: las que se llenan con ahorro (el vínculo 'metas', el abono
 * extra a deudas y la barra de una meta, que reciben aportes): eso se reporta aparte como ahorro (RONDA-USUARIO-A).
 */
export function esCategoriaDeConsumo(c) {
  return c.tipo === 'gasto' && (c.grupo !== 'ahorro' || (c.vinculo === null && !c.metaId));
}

/**
 * Ejecutado neto por categoría de gasto en el rango (gasto + pagoDeuda + aporteMeta − retiroMeta), mostrado como máx(0, ·).
 * N-06: de un pago de deuda cuya categoría es del grupo ahorro (el abono extra) solo el CAPITAL cuenta en esa categoría; sus intereses
 * se suman a "Pago de deudas" (son consumo, no ahorro). El total no cambia: es el mismo dinero.
 */
export function ejecutadoPorCategoria(datos, rango, hasta) {
  const fin = finDeCorte(rango, hasta);
  const neto = {};
  for (const c of datos.categorias) if (c.tipo === 'gasto') neto[c.id] = 0;
  const enAhorro = new Set(datos.categorias.filter((c) => c.tipo === 'gasto' && c.grupo === 'ahorro').map((c) => c.id));
  const lineaDeudas = datos.categorias.find((c) => c.vinculo === 'cuotas-deudas');
  for (const m of datos.movimientos) {
    if (m.fecha < rango.inicio || m.fecha > fin) continue;
    if (m.tipo === 'pagoDeuda' && lineaDeudas && enAhorro.has(m.categoriaId)) {
      neto[m.categoriaId] = (neto[m.categoriaId] ?? 0) + m.monto - m.interes;
      neto[lineaDeudas.id] = (neto[lineaDeudas.id] ?? 0) + m.interes;
    } else if (m.tipo === 'gasto' || m.tipo === 'pagoDeuda' || m.tipo === 'aporteMeta') neto[m.categoriaId] = (neto[m.categoriaId] ?? 0) + m.monto;
    else if (m.tipo === 'retiroMeta') neto[m.categoriaId] = (neto[m.categoriaId] ?? 0) - m.monto;
  }
  for (const id of Object.keys(neto)) neto[id] = Math.max(0, neto[id]);
  return neto;
}

/**
 * Intereses de los pagos de deuda con categoría del grupo ahorro (el abono extra) en el rango, con corte: consumo, no ahorro (N-06).
 * @returns {{total:number, porCategoria:Record<string,number>}} porCategoria = lo que cada categoría de ahorro "movió" a Pago de deudas (N3-03)
 */
export function detalleInteresesDeAbono(datos, rango, hasta) {
  const fin = finDeCorte(rango, hasta);
  const enAhorro = new Set(datos.categorias.filter((c) => c.tipo === 'gasto' && c.grupo === 'ahorro').map((c) => c.id));
  const porCategoria = {};
  let total = 0;
  for (const m of datos.movimientos) {
    if (m.tipo === 'pagoDeuda' && m.fecha >= rango.inicio && m.fecha <= fin && enAhorro.has(m.categoriaId) && m.interes > 0) {
      total += m.interes;
      porCategoria[m.categoriaId] = (porCategoria[m.categoriaId] ?? 0) + m.interes;
    }
  }
  return { total, porCategoria };
}

/** Σ intereses de los pagos de deuda con categoría del grupo ahorro (el abono extra) en el rango, con corte: consumo, no ahorro (N-06). */
export function interesesDeAbono(datos, rango, hasta) {
  return detalleInteresesDeAbono(datos, rango, hasta).total;
}

/** Σ de los ingresos del ciclo que son el salario (origen `salario` o categoría de ingreso de Ajustes) y Σ del resto (R3F-04). */
export function ingresoPorTipo(datos, rango, hasta) {
  const fin = finDeCorte(rango, hasta);
  const categoriaSalario = datos.ajustes.ingreso.categoriaId;
  let salario = 0;
  let otros = 0;
  for (const m of datos.movimientos) {
    if (m.tipo !== 'ingreso' || m.fecha < rango.inicio || m.fecha > fin) continue;
    if ((m.origen && m.origen.tipo === 'salario') || m.categoriaId === categoriaSalario) salario += m.monto;
    else otros += m.monto;
  }
  return { salario, otros };
}

export function ingresoReal(datos, rango, hasta) {
  const fin = finDeCorte(rango, hasta);
  let total = 0;
  for (const m of datos.movimientos) if (m.tipo === 'ingreso' && m.fecha >= rango.inicio && m.fecha <= fin) total += m.monto;
  return total;
}

/**
 * Último ciclo al que se puede navegar en Presupuesto: el mayor entre el actual y los presupuestos guardados con una clave razonable
 * (R1F-17: una clave extrema, p. ej. '9999-12', se ignora para no romper "Ciclo siguiente").
 */
export function ultimoCicloNavegable(datos, cicloActual) {
  const existentes = Object.keys(datos.presupuestos).filter(esCicloRazonable).sort();
  return [cicloActual, existentes[existentes.length - 1] ?? cicloActual].sort().at(-1);
}

/** Alerta de una categoría: 'exceso' | 'aviso' | null. Con asignado 0 y gasto > 0 es 'exceso'. */
export function alertaCategoria(asignado, ejecutado, { avisoPct, excesoPct }) {
  if (asignado === 0) return ejecutado > 0 ? 'exceso' : null;
  if (ejecutado * 100 > asignado * excesoPct) return 'exceso';
  if (ejecutado * 100 > asignado * avisoPct) return 'aviso';
  return null;
}

/**
 * Detalle del "Pago de deudas" calculado de un ciclo (H2): una fila por deuda no archivada con saldo > 0 al inicio del ciclo,
 * con min(cuota, saldo). Es la fuente tanto de la cifra como del texto que la explica (H-04: deben coincidir).
 * RU-06: una deuda ARCHIVADA sigue en el calculado del ciclo en que ya se le hizo un pago (la cuota pagada —categoría «Pago de deudas»— cuenta: si no, al archivar la tarjeta
 * con la cuota del ciclo ya pagada, lo asignado bajaba y "Pago de deudas" quedaba en "exceso" sin razón); en el ciclo siguiente, sin pagos, deja de
 * presupuestarse.
 * @returns {Array<{deuda:object, monto:number}>}
 */
export function detallePagoDeudas(datos, ciclo) {
  const rango = rangoCiclo(ciclo, datos.ajustes.diaPago);
  const saldos = calcularSaldos(datos, sumarDias(rango.inicio, -1));
  const saldosNacidos = new Map(); // saldos al cierre de cada fecha de saldo inicial: solo se calculan si hay una deuda nacida en este ciclo
  const filas = [];
  let archivadasConPago = null; // Set de ids de deudas archivadas con un pago en el ciclo (se calcula solo si hay archivadas)
  for (const d of datos.deudas) {
    if (d.archivada) {
      if (archivadasConPago === null) {
        const archivadas = new Set(datos.deudas.filter((x) => x.archivada).map((x) => x.id));
        archivadasConPago = new Set();
        const lineaCuotas = datos.categorias.find((c) => c.vinculo === 'cuotas-deudas');
        for (const m of datos.movimientos) if (m.tipo === 'pagoDeuda' && lineaCuotas && m.categoriaId === lineaCuotas.id && archivadas.has(m.deudaId) && m.fecha >= rango.inicio && m.fecha <= rango.fin) archivadasConPago.add(m.deudaId);
      }
      const sa = saldos.deudas[d.id];
      if (archivadasConPago.has(d.id) && sa > 0) filas.push({ deuda: d, monto: Math.min(d.cuota, sa) });
      continue;
    }
    const s = saldos.deudas[d.id];
    if (s > 0) filas.push({ deuda: d, monto: Math.min(d.cuota, s) });
    else if (d.fechaSaldoInicial >= rango.inicio && d.fechaSaldoInicial <= rango.fin && ocurrenciasCuota(d, rango).length > 0) {
      // R2F-15b: deuda creada a mitad de este ciclo (su saldo antes de nacer vale 0) con una cuota por venir (≥ su fecha de saldo inicial).
      if (!saldosNacidos.has(d.fechaSaldoInicial)) saldosNacidos.set(d.fechaSaldoInicial, calcularSaldos(datos, d.fechaSaldoInicial));
      const inicial = saldosNacidos.get(d.fechaSaldoInicial).deudas[d.id];
      if (inicial > 0) filas.push({ deuda: d, monto: Math.min(d.cuota, inicial) });
    }
  }
  return filas;
}

/** Σ min(cuota, saldo al inicio del ciclo) de las deudas no archivadas con saldo > 0 (H2: el presupuesto de deudas se calcula). */
export function pagoDeudasCalculado(datos, ciclo) {
  return Math.min(MAX_PESOS, detallePagoDeudas(datos, ciclo).reduce((s, f) => s + f.monto, 0)); // R2F-12: nunca más que el tope de `validar`
}

/**
 * Resumen completo de un ciclo para las vistas.
 * @returns {{ciclo, rango, existe, origen, pagoDeudas:null|{categoriaId,fijo,sigue,calculado,detalle,guardado}, ingresoPlaneado, ingresoReal, ingresoSalario, ingresoOtros, base:{monto,origen}, asignaciones, totalAsignado, sinAsignar,
 *   ejecutado:Record<string,number>, totalEjecutado, disponible, grupos:Record<string,object>, lineas:Array}}
 */
export function resumenCiclo(datos, ciclo, hasta) {
  const rango = rangoCiclo(ciclo, datos.ajustes.diaPago);
  const presupuesto = datos.presupuestos[ciclo] ?? null;
  let asignaciones = presupuesto ? presupuesto.asignaciones : {};
  const vinculoDeudas = datos.categorias.find((c) => c.vinculo === 'cuotas-deudas');
  let pagoDeudas = null;
  if (presupuesto && vinculoDeudas) {
    const detalle = detallePagoDeudas(datos, ciclo);
    const calculado = Math.min(MAX_PESOS, detalle.reduce((s, f) => s + f.monto, 0));
    const fijo = presupuesto.pagoDeudasFijo === true;
    const sigue = !fijo && hasta !== undefined && hasta !== null && rango.fin >= hasta;
    if (sigue) asignaciones = { ...asignaciones, [vinculoDeudas.id]: calculado };
    pagoDeudas = { categoriaId: vinculoDeudas.id, fijo, sigue, calculado, detalle, guardado: presupuesto.asignaciones[vinculoDeudas.id] ?? 0 };
  }
  const ingresoPlaneado = presupuesto ? presupuesto.ingresoPlaneado : 0;
  const real = ingresoReal(datos, rango, hasta);
  const { salario: ingresoSalario, otros: ingresoOtros } = ingresoPorTipo(datos, rango, hasta);
  // R3F-04: la base real es la del salario recibido; con el salario pendiente la base es el planeado y los otros ingresos solo suman al disponible.
  const base = ingresoSalario > 0 ? { monto: ingresoSalario, origen: 'real' } : { monto: ingresoPlaneado, origen: 'planeado' };
  const ejecutado = ejecutadoPorCategoria(datos, rango, hasta);
  const totalAsignado = Object.values(asignaciones).reduce((s, v) => s + v, 0);
  const totalEjecutado = Object.values(ejecutado).reduce((s, v) => s + v, 0);

  const gastado = datos.categorias.filter(esCategoriaDeConsumo).reduce((s, c) => s + (ejecutado[c.id] ?? 0), 0);
  const grupos = {};
  for (const g of GRUPOS) {
    const cats = datos.categorias.filter((c) => c.tipo === 'gasto' && c.grupo === g);
    const asignado = cats.reduce((s, c) => s + (asignaciones[c.id] ?? 0), 0);
    // RU-02: un gasto cargado a una categoría de Ahorro PROPIA (p. ej. "Vacaciones") es CONSUMO (reduce la tasa de ahorro) y NO suma al "ahorro y
    // metas ejecutado": ese grupo solo cuenta aportes a metas y capital del abono extra. Su barra de categoría sigue mostrando lo gastado de su monto
    // asignado, y el grupo lo muestra aparte (`consumoPropias`); `restante` descuenta ambos.
    const consumoPropias = g === 'ahorro' ? cats.filter(esCategoriaDeConsumo).reduce((s, c) => s + (ejecutado[c.id] ?? 0), 0) : 0;
    const ejec = cats.reduce((s, c) => s + (ejecutado[c.id] ?? 0), 0) - consumoPropias;
    grupos[g] = {
      asignado,
      ejecutado: ejec,
      consumoPropias,
      restante: asignado - ejec - consumoPropias,
      asignadoPct: base.monto > 0 ? asignado / base.monto : null,
      ejecutadoPct: base.monto > 0 ? ejec / base.monto : null,
      meta: datos.ajustes.metaGrupos[g],
    };
  }

  const detalleInteres = detalleInteresesDeAbono(datos, rango, hasta);
  const lineas = datos.categorias
    .filter((c) => c.tipo === 'gasto' && (!c.archivada || (asignaciones[c.id] ?? 0) > 0 || (ejecutado[c.id] ?? 0) > 0))
    .sort((a, b) => a.orden - b.orden)
    .map((c) => {
      const asignado = asignaciones[c.id] ?? 0;
      const ejec = ejecutado[c.id] ?? 0;
      // Ejecutado exactamente igual a lo asignado = 'Completo' (como en el mockup aprobado): no genera alerta de aviso aunque
      // supere el umbral. R1F-09: pero NUNCA oculta un 'exceso' real: si el usuario fijó excesoPct < 100, el 100 % ya es exceso
      // y la línea no es 'Completo'. Con los umbrales por omisión (80/100) el comportamiento no cambia.
      // N3-03: el interés de un abono se suma a "Pago de deudas" (N-06), pero solo por eso esa línea no está "excedida": su alerta se decide
      // sin ese interés. Las cifras mostradas (ejecutado, restante, fracción) no cambian; la línea del abono conserva su alerta.
      const interesAbono = c.vinculo === 'cuotas-deudas' ? detalleInteres.total : detalleInteres.porCategoria[c.id] ?? 0;
      const paraAlerta = c.vinculo === 'cuotas-deudas' ? Math.max(0, ejec - interesAbono) : ejec;
      const bruta = alertaCategoria(asignado, paraAlerta, datos.ajustes.alertas);
      const completo = asignado > 0 && paraAlerta === asignado && bruta !== 'exceso';
      return { categoria: c, asignado, ejecutado: ejec, restante: asignado - ejec, completo, fraccion: asignado > 0 ? ejec / asignado : ejec > 0 ? Infinity : 0, alerta: completo ? null : bruta, interesAbono };
    });

  return {
    ciclo,
    rango,
    existe: presupuesto !== null,
    origen: presupuesto ? presupuesto.origen : null,
    pagoDeudas,
    ingresoPlaneado,
    ingresoReal: real,
    ingresoSalario,
    ingresoOtros,
    base,
    asignaciones,
    totalAsignado,
    sinAsignar: base.monto - totalAsignado,
    interesAbono: interesesDeAbono(datos, rango, hasta),
    sinSalario: presupuesto !== null && presupuesto.sinSalario === true,
    ejecutado,
    totalEjecutado,
    gastado,
    disponible: base.monto + ingresoOtros - totalEjecutado, // R3F-04: los otros ingresos suman al disponible sin redefinir la base
    grupos,
    lineas,
  };
}

/** Alertas del ciclo: categorías en 'exceso' primero y luego en 'aviso', de mayor a menor consumo. */
export function alertasDelCiclo(resumen) {
  const peso = (l) => (l.fraccion === Infinity ? 1e9 : l.fraccion);
  return resumen.lineas
    .filter((l) => l.alerta)
    .sort((a, b) => (a.alerta === b.alerta ? peso(b) - peso(a) : a.alerta === 'exceso' ? -1 : 1));
}

/**
 * Presupuesto nuevo para `ciclo` copiando las asignaciones de `origen` (categorías no archivadas); Pago de deudas se
 * RECALCULA; ingresoPlaneado = ajustes.ingreso.montoMensual. No modifica `datos`.
 */
export function crearPresupuestoCopia(datos, ciclo, cicloOrigen, ahora) {
  const base = datos.presupuestos[cicloOrigen];
  const asignaciones = {};
  const vinculoDeudas = datos.categorias.find((c) => c.vinculo === 'cuotas-deudas');
  for (const c of datos.categorias) {
    if (c.tipo !== 'gasto' || c.archivada) continue;
    if (base && base.asignaciones[c.id] !== undefined) asignaciones[c.id] = base.asignaciones[c.id];
  }
  if (vinculoDeudas) asignaciones[vinculoDeudas.id] = pagoDeudasCalculado(datos, ciclo);
  return { ingresoPlaneado: datos.ajustes.ingreso.montoMensual, asignaciones, origen: 'copia', creadoEn: ahora };
}

/**
 * Comparación de `ciclo` con el ciclo anterior existente: por categoría, ejecutado de ambos y diferencia.
 * @returns {null | {anterior:string, filas:Array<{categoria, actual:number, previo:number, delta:number}>, totalActual:number, totalPrevio:number}}
 */
export function compararConAnterior(datos, ciclo, anterior, hasta) {
  if (!anterior || !datos.presupuestos[anterior]) return null;
  const a = resumenCiclo(datos, ciclo, hasta);
  const b = resumenCiclo(datos, anterior, hasta);
  const filas = datos.categorias
    .filter((c) => c.tipo === 'gasto' && !c.archivada)
    .sort((x, y) => x.orden - y.orden)
    .map((c) => ({ categoria: c, actual: a.ejecutado[c.id] ?? 0, previo: b.ejecutado[c.id] ?? 0, delta: (a.ejecutado[c.id] ?? 0) - (b.ejecutado[c.id] ?? 0) }))
    .filter((f) => f.actual > 0 || f.previo > 0);
  return { anterior, filas, totalActual: a.totalEjecutado, totalPrevio: b.totalEjecutado };
}
