/*
 * acciones.js — mutaciones PURAS de los datos de Finanzas: (datos, payload, ctx) → datosNuevos.
 * Contrato: docs/ARQUITECTURA.md §5.3 y ESQUEMA-FINANZAS §14. Nunca mutan `datos` (las pruebas pasan objetos congelados).
 * Si la acción no aplica, lanzan Error con mensaje en español para el usuario.
 *
 * ctx = { hoy:'YYYY-MM-DD', ahora:'<ISO UTC>', generarId:(prefijo)=>string }
 * Las acciones de alto impacto estructural (cuentas, deudas, categorías, recurrentes, metas) revalidan el conjunto con
 * validar() antes de devolver; las de movimientos validan solo el movimiento (ruta caliente) y su unicidad de origen.
 */
import { cicloDe, listarCiclos, rangoCiclo } from '../../shared/lib/ciclos.js';
import { esFechaISO, crearContexto, esPesosValido } from '../../shared/lib/validacion.js';
import { claveOrigen, crearReferencias, esCicloRazonable, MAX_PESOS, MENSAJE_CICLO_RANGO, mensajeNumeroSensible, mensajePesos, tieneNumeroLargo, validar, validarMovimiento } from './esquema.js';
import { cuotaPropuesta } from './deudas.js';
import { crearPresupuestoCopia, pagoDeudasCalculado } from './presupuesto.js';
import { clavesUsadas, indiceOrigenes, ocurrenciaExiste, ocurrenciaPendiente, ocurrenciasCuota, ocurrenciasRecurrente } from './recurrentes.js';
import { calcularSaldos } from './saldos.js';
import { maximoRetirable, saldoMinimoMeta } from './metas.js';
import { formatearPesos } from '../../shared/lib/dinero.js';
import { formatearFecha } from '../../shared/lib/fechas.js';
import { aplicarDiaPago, estadoCiclo, fechaPorDefecto } from './periodo.js';

function falla(mensaje, codigo) {
  const e = new Error(mensaje);
  if (codigo) e.codigo = codigo;
  return e;
}

function primerError(errores) {
  return falla(errores[0] ? errores[0].mensaje : 'Los datos no son válidos.', 'invalido');
}

/** Revalida el conjunto completo y devuelve la copia saneada (misma `rev`). */
function validarOLanzar(datos) {
  const v = validar(datos);
  if (!v.ok) throw primerError(v.errores);
  return v.datos;
}

const siguienteOrden = (lista) => lista.reduce((m, x) => Math.max(m, x.orden), 0) + 1;
const reemplazarPorId = (lista, id, fn) => lista.map((x) => (x.id === id ? fn(x) : x));
const buscar = (lista, id, nombre) => {
  const x = lista.find((e) => e.id === id);
  if (!x) throw falla(`${nombre} no existe.`, 'no-existe');
  return x;
};

// --- Apertura -----------------------------------------------------------------------------------------------------

/**
 * Al cerrarse un ciclo, su "Pago de deudas" calculado (que seguía a las cuotas vigentes, H-04) queda guardado con el valor que
 * tenía: la historia no cambia si luego se edita una cuota. Un ciclo con el monto fijado a mano no se toca.
 * R2F-03: se deja la marca `pagoDeudasCongelado` para congelar UNA sola vez (si no, cada apertura lo recalcularía con las cuotas
 * de ese día) y para poder congelar también un ciclo cuyo siguiente ya existía (p. ej. por "Copiar al ciclo siguiente").
 */
function congelarPagoDeudas(datos, ciclo) {
  const p = ciclo === undefined ? undefined : datos.presupuestos[ciclo];
  const vinculo = datos.categorias.find((c) => c.vinculo === 'cuotas-deudas');
  if (!p || p.pagoDeudasFijo === true || p.pagoDeudasCongelado === true || !vinculo) return datos;
  const calculado = pagoDeudasCalculado(datos, ciclo);
  return { ...datos, presupuestos: { ...datos.presupuestos, [ciclo]: { ...p, pagoDeudasCongelado: true, asignaciones: { ...p.asignaciones, [vinculo.id]: calculado } } } };
}

/**
 * Crea, EN ORDEN, el presupuesto de cada ciclo faltante entre el ciclo inicial y el actual (copia las asignaciones del
 * ciclo anterior y recalcula "Pago de deudas"). R1F-17: también rellena huecos (p. ej. una copia importada con los ciclos
 * 2026-11 y 2027-06 recibe los intermedios) y funciona aunque ya exista un ciclo futuro. Nunca modifica un ciclo
 * existente. Si no hay nada que crear devuelve el MISMO objeto (la tienda no escribe).
 */
export function alAbrir(datos, _payload, ctx) {
  const est = estadoCiclo(datos, ctx.hoy);
  const faltantes = listarCiclos(est.cicloInicial, est.ciclo).filter((c) => datos.presupuestos[c] === undefined);
  let acumulado = datos;
  for (const ciclo of faltantes) {
    const previo = Object.keys(acumulado.presupuestos).filter((c) => c < ciclo).sort().pop(); // el existente más cercano hacia atrás
    acumulado = congelarPagoDeudas(acumulado, previo);
    const nuevo = crearPresupuestoCopia(acumulado, ciclo, previo, ctx.ahora);
    acumulado = { ...acumulado, presupuestos: { ...acumulado.presupuestos, [ciclo]: nuevo } };
  }
  // R2F-03: TODO ciclo ya cerrado congela su "Pago de deudas" (no solo el previo de uno que se crea: si el siguiente ya existía por
  // "Copiar al ciclo siguiente" o por una copia importada, antes el cerrado volvía a calcularse con las cuotas de hoy).
  for (const ciclo of Object.keys(acumulado.presupuestos).sort()) if (ciclo < est.ciclo) acumulado = congelarPagoDeudas(acumulado, ciclo);
  return acumulado;
}

/**
 * R2F-13: al cargar, `validar` ya enmascaró en memoria los números de tarjeta o de cuenta de textos guardados; esta acción devuelve una
 * COPIA para que la tienda guarde esa versión saneada (devolver los mismos datos no escribe nada). La usa `app.js` solo si la carga avisó.
 */
export function guardarSaneado(datos) {
  return { ...datos };
}

// --- Movimientos ---------------------------------------------------------------------------------------------------

function comprobarOrigenUnico(datos, movimiento, ignorarId) {
  const clave = claveOrigen(movimiento.origen);
  if (clave && datos.movimientos.some((m) => m.id !== ignorarId && claveOrigen(m.origen) === clave)) {
    throw falla('Ese pago programado ya está registrado.', 'duplicado');
  }
}

/**
 * R2F-10: en un ciclo nunca hay más pagos con `origen` que ocurrencias del mismo pago programado (un salario por ciclo). Evita, p. ej.,
 * que el "Deshacer" de un pago borrado lo restaure cuando esa ocurrencia ya se volvió a marcar (quedarían dos pagos de Netflix en el
 * mismo ciclo). Si el pago programado ya no existe (recurrente borrado) no hay nada que duplicar y se acepta.
 */
function comprobarOrigenSinDuplicar(datos, movimiento) {
  const o = movimiento.origen;
  if (!o) return;
  const historial = datos.ajustes.diaPago;
  const rango = rangoCiclo(cicloDe(o.ocurrencia, historial), historial);
  const hechas = (indiceOrigenes(datos).get(`${o.tipo}|${o.id}`) ?? []).filter((f) => f >= rango.inicio && f <= rango.fin).length;
  let cupo = 1;
  if (o.tipo !== 'salario') {
    const fuente = o.tipo === 'cuota' ? datos.deudas.find((d) => d.id === o.id) : datos.recurrentes.find((r) => r.id === o.id);
    if (!fuente) return;
    cupo = (o.tipo === 'cuota' ? ocurrenciasCuota(fuente, rango) : ocurrenciasRecurrente(fuente, rango)).length;
  }
  if (hechas + 1 > cupo) throw falla('Ese pago ya tiene otro registro en este ciclo: no se duplica. Revisa Movimientos.', 'duplicado');
}

/** H-08 / R2F-13: el texto que escribe el usuario no puede incluir algo que parezca un número de tarjeta (13 a 19 dígitos) o de cuenta (10 a 12 con contexto). */
function rechazarNumerosLargos(...textos) {
  const sospechoso = textos.find(tieneNumeroLargo);
  if (sospechoso !== undefined) throw falla(mensajeNumeroSensible(sospechoso), 'numero-largo');
}

function construirMovimiento(datos, crudo) {
  rechazarNumerosLargos(crudo.nota);
  const c = crearContexto();
  const m = validarMovimiento(crudo, crearReferencias(datos), c, 'movimiento');
  if (c.errores.length || !m) throw primerError(c.errores);
  return m;
}

/**
 * R1F-07: un movimiento que viene de un pago programado debe seguir siendo coherente con su origen (cuota ↔ pagoDeuda de esa
 * deuda; salario ↔ ingreso; recurrente ↔ el tipo del recurrente). Devuelve el motivo (texto para el usuario) o null.
 * Se comprueba aquí y no en `validar` para no volver "corruptos" datos importados con un origen antiguo incoherente.
 */
function incoherenciaDeOrigen(datos, m) {
  const o = m.origen;
  if (!o) return null;
  const aviso = 'Este movimiento viene de un pago programado: no se puede cambiar su deuda ni su tipo. Elimínalo y regístralo de nuevo.';
  if (o.tipo === 'cuota') return m.tipo === 'pagoDeuda' && m.deudaId === o.id ? null : aviso;
  if (o.tipo === 'salario') return m.tipo === 'ingreso' ? null : aviso;
  if (o.tipo === 'recurrente') {
    const r = datos.recurrentes.find((x) => x.id === o.id);
    return !r || r.tipo === m.tipo ? null : aviso;
  }
  return null;
}

/**
 * R1F-04: lo ahorrado en una meta nunca baja de 0 en ninguna fecha (un retiro no puede superar lo apartado, y un aporte no
 * puede reducirse o borrarse si retiros posteriores dependen de él). Solo falla si el cambio EMPEORA el mínimo: los datos
 * importados que ya vengan en negativo no bloquean ediciones ajenas. `despues` es la lista completa de movimientos resultante.
 */
function exigirMetaNoNegativa(datos, despues, metaId, retiro = null) {
  if (!metaId) return;
  const antes = saldoMinimoMeta(datos.movimientos, metaId);
  const minimo = saldoMinimoMeta(despues, metaId);
  if (minimo >= 0 || minimo >= antes) return;
  if (retiro && retiro.metaId === metaId) {
    const maximo = maximoRetirable(despues.filter((x) => x.id !== retiro.id), metaId, retiro.fecha);
    throw falla(maximo > 0 ? `Solo hay ${formatearPesos(maximo)} apartados en esta meta.` : 'Esta meta no tiene dinero apartado para retirar a esa fecha.', 'meta-insuficiente');
  }
  throw falla('Ese cambio dejaría la meta con menos de $ 0 ahorrados: hay retiros que dependen de este aporte. Ajusta primero los retiros.', 'meta-insuficiente');
}

/**
 * R2F-02: saldo de la deuda al cierre de CADA fecha en que algo lo cambia (pagos, ajustes y compras con su tarjeta) más las fechas
 * `extra`, en UNA sola pasada ordenada por fecha: O(N log N) sobre los movimientos de la deuda. Da el mismo valor que
 * `calcularSaldos({...datos, movimientos}, fecha).deudas[id]` fecha por fecha (misma convención de `existe` de saldos.js: antes de
 * su `fechaSaldoInicial` la deuda vale 0, salvo las de apertura), pero sin recorrer todos los movimientos una vez por fecha.
 * @returns {Array<{fecha:string, saldo:number}>} ordenado por fecha
 */
function saldosDeDeudaPorFecha(datos, movimientos, deuda, extra = []) {
  const tarjetas = new Set(datos.cuentas.filter((c) => c.tipo === 'credito' && c.deudaId === deuda.id).map((c) => c.id));
  const cambios = [];
  for (const m of movimientos) {
    if ((m.tipo === 'pagoDeuda' || m.tipo === 'ajusteDeuda') && m.deudaId === deuda.id) cambios.push([m.fecha, m.tipo === 'pagoDeuda' ? -(m.monto - m.interes) : m.monto]);
    else if (m.tipo === 'gasto' && tarjetas.has(m.cuentaId)) cambios.push([m.fecha, m.monto]);
  }
  for (const f of extra) cambios.push([f, 0]);
  cambios.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const inicioPrograma = rangoCiclo(datos.ajustes.cicloInicial, datos.ajustes.diaPago).inicio;
  const existe = (f) => f >= deuda.fechaSaldoInicial || deuda.fechaSaldoInicial <= inicioPrograma;
  const salida = [];
  let acumulado = 0;
  for (let i = 0; i < cambios.length; i += 1) {
    acumulado += cambios[i][1];
    if (i + 1 < cambios.length && cambios[i + 1][0] === cambios[i][0]) continue; // el saldo de la fecha incluye todos sus movimientos
    salida.push({ fecha: cambios[i][0], saldo: (existe(cambios[i][0]) ? deuda.saldoInicial : 0) + acumulado });
  }
  return salida;
}

/**
 * H-03 / N3-01: el saldo de la deuda no puede quedar negativo en NINGUNA fecha ≤ hoy a partir de la fecha del pago (un pago con fecha
 * anterior a otro ya hecho también cuenta: el saldo se evalúa con la serie ordenada por fecha). Lo único aceptado es que un abono
 * PROGRAMADO a futuro (fecha > hoy) deje la deuda negativa en esa fecha futura (decisión del orquestador, R2F-11). Para un pago con fecha
 * futura solo cuenta el saldo a su propia fecha.
 * Ventana evaluada = [fecha del pago, máx(hoy, fecha del pago)] con los movimientos con fecha ≤ el fin de la ventana (los posteriores son
 * programados y no cuentan). El tope es el saldo pendiente más los intereses que incluya el pago (el interés no baja el capital: Q10).
 * Solo falla si el cambio EMPEORA el mínimo de la ventana (datos importados que ya vengan en negativo no bloquean ediciones ajenas).
 * "despues" es la lista completa de movimientos resultante. Una sola pasada por serie (R2F-02): dos series ordenadas por fecha, sin
 * recalcular todos los saldos por cada fecha.
 */
function exigirDeudaNoNegativa(datos, despues, pago, hoy) {
  const deuda = datos.deudas.find((d) => d.id === pago.deudaId);
  if (!deuda) return;
  const fin = hoy !== undefined && hoy > pago.fecha ? hoy : pago.fecha;
  const enVentana = (s) => s.fecha >= pago.fecha && s.fecha <= fin;
  const serie = (lista) => saldosDeDeudaPorFecha(datos, lista.filter((x) => x.fecha <= fin), deuda, [pago.fecha, fin]).filter(enVentana);
  const minimo = (lista) => Math.min(...serie(lista).map((s) => s.saldo));
  const minimoDespues = minimo(despues);
  if (minimoDespues >= 0 || minimoDespues >= minimo(datos.movimientos)) return;
  // Sin este pago: el saldo más bajo de la ventana (y la primera fecha donde ocurre) es lo que se puede pagar como máximo.
  const sinEste = serie(despues.filter((x) => x.id !== pago.id));
  const limite = sinEste.reduce((m, s) => (s.saldo < m.saldo ? s : m), sinEste[0]);
  const pendiente = Math.max(0, limite.saldo);
  const interes = pago.interes > 0 ? `, más los ${formatearPesos(pago.interes)} de interés que incluye este pago` : '';
  if (limite.fecha !== pago.fecha) {
    const maximo = pendiente + pago.interes;
    throw falla(pendiente > 0
      ? `El pago dejaría ${deuda.nombre.toLowerCase()} con saldo negativo el ${formatearFecha(limite.fecha, 'dia-mes')}: otros pagos ya registrados la dejan en ${formatearPesos(limite.saldo)} ese día. Con fecha ${formatearFecha(pago.fecha, 'dia-mes')} puedes pagar como máximo ${formatearPesos(maximo)}${pago.interes > 0 ? ` (incluye los ${formatearPesos(pago.interes)} de interés)` : ''}.`
      : `El pago dejaría ${deuda.nombre.toLowerCase()} con saldo negativo el ${formatearFecha(limite.fecha, 'dia-mes')}: otros pagos ya registrados la dejan en ${formatearPesos(limite.saldo)} ese día. Con fecha ${formatearFecha(pago.fecha, 'dia-mes')} no puedes pagar nada${pago.interes > 0 ? ' (un pago solo de intereses regístralo como gasto)' : ''}.`, 'deuda-saldada');
  }
  const aclaracion = hoy === undefined || pago.fecha >= hoy
    ? ` Es el saldo al ${formatearFecha(pago.fecha, 'dia-mes')}: los movimientos con fecha posterior no cuentan para este pago.`
    : ` Es el saldo al ${formatearFecha(pago.fecha, 'dia-mes')}; se revisó cada fecha hasta hoy y los movimientos programados a futuro no cuentan para este pago.`;
  throw falla(pendiente > 0
    ? `El pago supera lo que debes: el saldo pendiente de ${deuda.nombre.toLowerCase()} es ${formatearPesos(pendiente)}${interes}.${aclaracion}`
    : `${deuda.nombre} no tiene saldo pendiente a esa fecha: no hay nada que pagar.${pago.interes > 0 ? ' Si es un pago de intereses, regístralo como gasto.' : ''}${aclaracion}`, 'deuda-saldada');
}

/** payload { movimiento } sin id/creadoEn (se generan). Con `id` se acepta para restaurar ("Deshacer" de un borrado). */
export function agregarMovimiento(datos, { movimiento }, ctx) {
  if (!movimiento) throw falla('Falta el movimiento.');
  const id = movimiento.id ?? ctx.generarId('mov');
  if (datos.movimientos.some((m) => m.id === id)) throw falla('Ese movimiento ya existe.', 'duplicado');
  const m = construirMovimiento(datos, { nota: '', origen: null, actualizadoEn: null, ...movimiento, id, creadoEn: movimiento.creadoEn ?? ctx.ahora });
  comprobarOrigenUnico(datos, m, null);
  comprobarOrigenSinDuplicar(datos, m);
  const incoherencia = incoherenciaDeOrigen(datos, m);
  if (incoherencia) throw falla(incoherencia, 'origen-incoherente');
  const movimientos = [...datos.movimientos, m];
  if (m.metaId) exigirMetaNoNegativa(datos, movimientos, m.metaId, m.tipo === 'retiroMeta' ? m : null);
  if (m.tipo === 'pagoDeuda') exigirDeudaNoNegativa(datos, movimientos, m, ctx.hoy);
  return { ...datos, movimientos };
}

/** payload { movimiento } con `id`: REEMPLAZA el movimiento (conserva creadoEn y, si no se indica, el origen). */
export function editarMovimiento(datos, { movimiento }, ctx) {
  const previo = buscar(datos.movimientos, movimiento && movimiento.id, 'El movimiento');
  const m = construirMovimiento(datos, {
    nota: '',
    ...movimiento,
    origen: movimiento.origen !== undefined ? movimiento.origen : previo.origen,
    id: previo.id,
    creadoEn: previo.creadoEn,
    actualizadoEn: ctx.ahora,
  });
  comprobarOrigenUnico(datos, m, previo.id);
  // R1F-07: solo se rechaza si la edición ROMPE la coherencia (un origen antiguo ya incoherente no bloquea cambiar la nota).
  const incoherencia = incoherenciaDeOrigen(datos, m);
  if (incoherencia && !incoherenciaDeOrigen(datos, previo)) throw falla(incoherencia, 'origen-incoherente');
  const movimientos = datos.movimientos.map((x) => (x.id === previo.id ? m : x));
  for (const metaId of new Set([previo.metaId, m.metaId])) exigirMetaNoNegativa(datos, movimientos, metaId, m.tipo === 'retiroMeta' ? m : null);
  if (m.tipo === 'pagoDeuda') exigirDeudaNoNegativa(datos, movimientos, m, ctx.hoy);
  return { ...datos, movimientos };
}

export function borrarMovimiento(datos, { id }) {
  const previo = buscar(datos.movimientos, id, 'El movimiento');
  const movimientos = datos.movimientos.filter((m) => m.id !== id);
  if (previo.metaId) exigirMetaNoNegativa(datos, movimientos, previo.metaId);
  return { ...datos, movimientos };
}

/**
 * "Marcar pagado": crea el movimiento de un pago programado (§10.1).
 * payload { origen:{tipo,id,ocurrencia}, monto?, fecha?, cuentaId?, interes?, nota? }. Por omisión: monto programado,
 * fecha = hoy (nunca antes del inicio del programa), cuenta programada, interés propuesto (cuotas).
 */
export function marcarPagado(datos, { origen, monto, fecha, cuentaId, interes, nota = '' }, ctx) {
  if (!origen) throw falla('Falta el pago programado.');
  if (!ocurrenciaExiste(datos, origen)) throw falla('Ese pago no está programado.', 'no-programado');
  if (clavesUsadas(datos).has(claveOrigen(origen)) || !ocurrenciaPendiente(datos, origen)) throw falla('Ese pago ya está registrado.', 'duplicado');
  const fechaMov = fecha ?? fechaPorDefecto(datos, ctx.hoy);
  const ing = datos.ajustes.ingreso;
  let movimiento;
  let titulo; // nota por omisión: el nombre del pago (así Movimientos muestra "Netflix" y no solo la categoría)
  if (origen.tipo === 'salario') {
    titulo = ing.nombre;
    movimiento = { tipo: 'ingreso', monto: monto ?? ing.montoMensual, cuentaId: cuentaId ?? ing.cuentaId, categoriaId: ing.categoriaId };
  } else if (origen.tipo === 'cuota') {
    const deuda = buscar(datos.deudas, origen.id, 'La deuda');
    titulo = `Cuota ${deuda.nombre.toLowerCase()}`;
    // R1F-08: mismo corte (hoy) que la cuota que muestra "Próximos pagos"; con el saldo a fin de los tiempos, un abono
    // programado a futuro cambiaba el monto que el botón "Pagado" registraba.
    const propuesta = cuotaPropuesta(deuda, calcularSaldos(datos, ctx.hoy).deudas[deuda.id]);
    const categoria = datos.categorias.find((c) => c.vinculo === 'cuotas-deudas');
    const montoPago = monto ?? propuesta.monto;
    movimiento = {
      tipo: 'pagoDeuda',
      monto: montoPago,
      cuentaId: cuentaId ?? ing.cuentaId,
      deudaId: deuda.id,
      categoriaId: categoria.id,
      interes: interes ?? Math.min(montoPago, propuesta.interes),
    };
  } else {
    const rec = buscar(datos.recurrentes, origen.id, 'El pago recurrente');
    titulo = rec.nombre;
    movimiento = { tipo: rec.tipo, monto: monto ?? rec.monto, cuentaId: cuentaId ?? rec.cuentaId, categoriaId: rec.categoriaId };
  }
  return agregarMovimiento(datos, { movimiento: { ...movimiento, fecha: fechaMov, nota: nota && nota.trim() ? nota : titulo, origen: { tipo: origen.tipo, id: origen.id, ocurrencia: origen.ocurrencia } } }, ctx);
}

// --- Cuentas -------------------------------------------------------------------------------------------------------

export function guardarCuenta(datos, { cuenta }, ctx) {
  if (!cuenta) throw falla('Falta la cuenta.');
  rechazarNumerosLargos(cuenta.nombre);
  if (cuenta.id) {
    const previa = buscar(datos.cuentas, cuenta.id, 'La cuenta');
    const editable = previa.tipo === 'credito'
      ? { nombre: cuenta.nombre, icono: cuenta.icono }
      : { nombre: cuenta.nombre, icono: cuenta.icono, tipo: cuenta.tipo, saldoInicial: cuenta.saldoInicial, fechaSaldoInicial: cuenta.fechaSaldoInicial };
    for (const k of Object.keys(editable)) if (editable[k] === undefined) delete editable[k];
    if (editable.tipo === 'credito') throw falla('Una cuenta no se puede convertir en tarjeta de crédito: cree la deuda.');
    return validarOLanzar({ ...datos, cuentas: reemplazarPorId(datos.cuentas, previa.id, (c) => ({ ...c, ...editable })) });
  }
  if (cuenta.tipo === 'credito') throw falla('Las tarjetas de crédito se crean desde Deudas.');
  const nueva = {
    id: ctx.generarId('cta'),
    nombre: cuenta.nombre,
    tipo: cuenta.tipo,
    saldoInicial: cuenta.saldoInicial ?? 0,
    fechaSaldoInicial: cuenta.fechaSaldoInicial ?? fechaPorDefecto(datos, ctx.hoy),
    deudaId: null,
    icono: cuenta.icono ?? 'banco',
    orden: siguienteOrden(datos.cuentas),
    archivada: false,
  };
  return validarOLanzar({ ...datos, cuentas: [...datos.cuentas, nueva] });
}

export function archivarCuenta(datos, { id, archivada = true }) {
  const c = buscar(datos.cuentas, id, 'La cuenta');
  if (c.tipo === 'credito') throw falla('Una tarjeta se archiva desde Deudas, cuando está saldada.');
  if (archivada && datos.ajustes.ingreso.cuentaId === id) throw falla('Esta cuenta recibe el ingreso: cambie primero la cuenta del ingreso en Ajustes.');
  return validarOLanzar({ ...datos, cuentas: reemplazarPorId(datos.cuentas, id, (x) => ({ ...x, archivada })) });
}

export function borrarCuenta(datos, { id }) {
  const c = buscar(datos.cuentas, id, 'La cuenta');
  if (c.tipo === 'credito') throw falla('Una tarjeta no se borra desde Cuentas.');
  if (datos.movimientos.some((m) => m.cuentaId === id || m.cuentaDestinoId === id)) throw falla('La cuenta tiene movimientos: se puede archivar, no borrar. También puedes mover todo a otra cuenta con "Mover movimientos a otra cuenta y borrar".', 'en-uso'); // N-10: menciona la opción de mover
  if (datos.ajustes.ingreso.cuentaId === id || datos.recurrentes.some((r) => r.cuentaId === id) || datos.metas.some((m) => m.cuentaId === id)) {
    throw falla('La cuenta se usa en el ingreso, un pago recurrente o una meta: se puede archivar, no borrar. También puedes mover todo a otra cuenta con "Mover movimientos a otra cuenta y borrar".', 'en-uso');
  }
  return validarOLanzar({ ...datos, cuentas: datos.cuentas.filter((x) => x.id !== id) });
}

/**
 * Qué se mueve (y qué se elimina) al reasignar una cuenta a otra (para el texto de confirmación de la vista).
 * `transferenciasEntre`: transferencias entre ambas cuentas; al juntarlas quedarían de una cuenta a sí misma y se eliminan
 * (no cambian el saldo combinado). `movimientos` cuenta TODOS los que tocan la cuenta, incluidas esas transferencias.
 */
export function usosDeCuenta(datos, id, haciaId = null) {
  let movimientos = 0;
  let transferenciasEntre = 0;
  for (const m of datos.movimientos) {
    if (m.cuentaId !== id && m.cuentaDestinoId !== id) continue;
    movimientos += 1;
    if (haciaId && m.tipo === 'transferencia' && ((m.cuentaId === id && m.cuentaDestinoId === haciaId) || (m.cuentaId === haciaId && m.cuentaDestinoId === id))) transferenciasEntre += 1;
  }
  return {
    movimientos,
    transferenciasEntre,
    recurrentes: datos.recurrentes.filter((r) => r.cuentaId === id).length,
    metas: datos.metas.filter((m) => m.cuentaId === id).length,
    ingreso: datos.ajustes.ingreso.cuentaId === id,
  };
}

/**
 * R2F-08: saldo y fecha con los que queda la cuenta de destino al reasignar, y el ajuste (si hace falta) que conserva el saldo
 * inicial de la otra con su fecha original. → { saldoInicial, fechaSaldoInicial, ajuste: null | { fecha, monto, nota } }.
 * Una cuenta de apertura (fecha ≤ inicio del programa) existe en todo corte (saldos.js); las demás, desde su fecha.
 */
export function planSaldoReasignado(datos, desde, hacia) {
  const inicio = rangoCiclo(datos.ajustes.cicloInicial, datos.ajustes.diaPago).inicio;
  const apertura = (c) => c.fechaSaldoInicial <= inicio;
  if (apertura(desde) && apertura(hacia)) {
    return { saldoInicial: hacia.saldoInicial + desde.saldoInicial, fechaSaldoInicial: desde.fechaSaldoInicial < hacia.fechaSaldoInicial ? desde.fechaSaldoInicial : hacia.fechaSaldoInicial, ajuste: null };
  }
  const clave = (c) => (apertura(c) ? '' : c.fechaSaldoInicial);
  const desdeEsAntigua = clave(desde) < clave(hacia); // con fechas iguales manda la de destino
  const base = desdeEsAntigua ? desde : hacia;
  const otra = desdeEsAntigua ? hacia : desde;
  return {
    saldoInicial: base.saldoInicial,
    fechaSaldoInicial: base.fechaSaldoInicial,
    ajuste: otra.saldoInicial === 0 ? null : { cuenta: otra.nombre, fecha: otra.fechaSaldoInicial, monto: otra.saldoInicial, nota: `Saldo inicial de ${otra.nombre}${otra === desde ? ' (cuenta movida)' : ''}` },
  };
}

/**
 * Q12: reasigna TODO lo que usa la cuenta `desdeId` (movimientos, ingreso mensual, recurrentes, metas) a `haciaId` y borra la
 * primera, sin dejar huérfanos. Las transferencias entre las dos cuentas se eliminan. Una tarjeta de crédito no se reasigna
 * (vive en Deudas).
 *
 * R2F-08 / N-02: el patrimonio de CUALQUIER fecha (también el de ciclos pasados) no cambia. Una cuenta "existe" desde su
 * `fechaSaldoInicial` (saldos.js, R1F-15), así que sumar el saldo inicial de la más nueva al de la más antigua lo adelantaba y
 * reescribía la historia. Ahora la cuenta de destino conserva el saldo y la fecha de la MÁS ANTIGUA (una cuenta de apertura, con
 * fecha ≤ inicio del programa, cuenta como la más antigua) y el saldo inicial de la otra queda como un `ajusteCuenta` con SU fecha
 * original (nota "Saldo inicial de X"; los ajustes no cuentan en el consumo). Si las dos son de apertura no hace falta ajuste:
 * se suman (las dos existen siempre) con la fecha más antigua. Los ajustes necesitan `ctx` (id y fecha de creación).
 */
export function reasignarCuenta(datos, { desdeId, haciaId }, ctx) {
  if (desdeId === haciaId) throw falla('Elige una cuenta de destino distinta.');
  const desde = buscar(datos.cuentas, desdeId, 'La cuenta');
  const hacia = buscar(datos.cuentas, haciaId, 'La cuenta de destino');
  if (desde.tipo === 'credito' || hacia.tipo === 'credito') throw falla('Las tarjetas de crédito no se reasignan: viven en Deudas.');
  if (hacia.archivada) throw falla('La cuenta de destino está archivada: elige una cuenta activa.');
  const plan = planSaldoReasignado(datos, desde, hacia);
  const mover = (id) => (id === desdeId ? haciaId : id);
  const movimientos = [];
  for (const m of datos.movimientos) {
    if (m.cuentaId !== desdeId && m.cuentaDestinoId !== desdeId) { movimientos.push(m); continue; }
    const cuentaId = mover(m.cuentaId);
    if (m.tipo === 'transferencia') {
      if (cuentaId === mover(m.cuentaDestinoId)) continue; // entre las dos cuentas: neta cero, se elimina
      movimientos.push({ ...m, cuentaId, cuentaDestinoId: mover(m.cuentaDestinoId) });
    } else if (m.cuentaDestinoId) {
      const destino = mover(m.cuentaDestinoId);
      movimientos.push({ ...m, cuentaId, cuentaDestinoId: destino === cuentaId ? null : destino }); // aporte/retiro de meta: "solo apartar"
    } else movimientos.push({ ...m, cuentaId });
  }
  const cuentas = datos.cuentas.filter((c) => c.id !== desdeId).map((c) => (c.id === haciaId
    ? { ...c, saldoInicial: plan.saldoInicial, fechaSaldoInicial: plan.fechaSaldoInicial }
    : c));
  if (plan.ajuste) {
    if (!ctx) throw falla('No se pudo registrar el saldo inicial de la cuenta movida.');
    movimientos.push({ id: ctx.generarId('mov'), tipo: 'ajusteCuenta', fecha: plan.ajuste.fecha, monto: plan.ajuste.monto, cuentaId: haciaId, nota: plan.ajuste.nota, origen: null, creadoEn: ctx.ahora, actualizadoEn: null });
  }
  return validarOLanzar({
    ...datos,
    cuentas,
    movimientos,
    recurrentes: datos.recurrentes.map((r) => (r.cuentaId === desdeId ? { ...r, cuentaId: haciaId } : r)),
    metas: datos.metas.map((m) => (m.cuentaId === desdeId ? { ...m, cuentaId: haciaId } : m)),
    ajustes: { ...datos.ajustes, ingreso: { ...datos.ajustes.ingreso, cuentaId: mover(datos.ajustes.ingreso.cuentaId) } },
  });
}

// --- Deudas --------------------------------------------------------------------------------------------------------

const nombreTarjeta = (d) => `${d.nombre} ${d.entidad ?? ''}`.trim();

/** Crea o actualiza. Una `tarjeta` nueva crea su cuenta de crédito vinculada en la misma acción (1 a 1). */
export function guardarDeuda(datos, { deuda }, ctx) {
  if (!deuda) throw falla('Falta la deuda.');
  rechazarNumerosLargos(deuda.nombre, deuda.entidad, deuda.notas);
  if (deuda.id) {
    const previa = buscar(datos.deudas, deuda.id, 'La deuda');
    const campos = ['nombre', 'entidad', 'saldoInicial', 'fechaSaldoInicial', 'cuota', 'diaPago', 'tasa', 'notas'];
    const cambios = {};
    for (const k of campos) if (deuda[k] !== undefined) cambios[k] = deuda[k];
    const actualizada = { ...previa, ...cambios };
    const cuentas = previa.tipo === 'tarjeta'
      ? datos.cuentas.map((c) => (c.id === previa.cuentaId ? { ...c, nombre: nombreTarjeta(actualizada) } : c))
      : datos.cuentas;
    return validarOLanzar({ ...datos, cuentas, deudas: reemplazarPorId(datos.deudas, previa.id, () => actualizada) });
  }
  const id = ctx.generarId('deu');
  const base = {
    id,
    nombre: deuda.nombre,
    entidad: deuda.entidad ?? '',
    tipo: deuda.tipo ?? 'credito',
    saldoInicial: deuda.saldoInicial,
    fechaSaldoInicial: deuda.fechaSaldoInicial ?? fechaPorDefecto(datos, ctx.hoy),
    cuota: deuda.cuota,
    diaPago: deuda.diaPago ?? 1,
    tasa: deuda.tasa ?? null,
    cuentaId: null,
    notas: deuda.notas ?? '',
    archivada: false,
  };
  if (base.tipo === 'tarjeta') {
    const cuentaId = ctx.generarId('cta');
    const cuenta = { id: cuentaId, nombre: nombreTarjeta(base), tipo: 'credito', saldoInicial: null, fechaSaldoInicial: null, deudaId: id, icono: 'tarjeta', orden: siguienteOrden(datos.cuentas), archivada: false };
    return validarOLanzar({ ...datos, cuentas: [...datos.cuentas, cuenta], deudas: [...datos.deudas, { ...base, cuentaId }] });
  }
  return validarOLanzar({ ...datos, deudas: [...datos.deudas, base] });
}

/** Solo se archiva una deuda saldada (saldo 0); su cuenta de crédito se archiva con ella. */
export function archivarDeuda(datos, { id, archivada = true }) {
  const d = buscar(datos.deudas, id, 'La deuda');
  if (archivada && calcularSaldos(datos, '9999-12-31').deudas[id] !== 0) throw falla('Solo se puede archivar una deuda saldada (saldo $ 0).', 'no-saldada');
  return validarOLanzar({
    ...datos,
    deudas: reemplazarPorId(datos.deudas, id, (x) => ({ ...x, archivada })),
    cuentas: datos.cuentas.map((c) => (d.cuentaId && c.id === d.cuentaId ? { ...c, archivada } : c)),
  });
}

// --- Categorías ----------------------------------------------------------------------------------------------------

export function guardarCategoria(datos, { categoria }, ctx) {
  if (!categoria) throw falla('Falta la categoría.');
  rechazarNumerosLargos(categoria.nombre);
  if (categoria.id) {
    const previa = buscar(datos.categorias, categoria.id, 'La categoría');
    const permitidos = previa.vinculo ? ['nombre', 'icono'] : previa.tipo === 'gasto' ? ['nombre', 'icono', 'grupo'] : ['nombre', 'icono'];
    const cambios = {};
    for (const k of permitidos) if (categoria[k] !== undefined) cambios[k] = categoria[k];
    return validarOLanzar({ ...datos, categorias: reemplazarPorId(datos.categorias, previa.id, (c) => ({ ...c, ...cambios })) });
  }
  if (!['gasto', 'ingreso'].includes(categoria.tipo)) throw falla('Indique si la categoría es de gasto o de ingreso.');
  const nueva = {
    id: ctx.generarId('cat'),
    nombre: categoria.nombre,
    tipo: categoria.tipo,
    grupo: categoria.tipo === 'gasto' ? categoria.grupo : null,
    vinculo: null,
    icono: categoria.icono ?? 'otro',
    orden: siguienteOrden(datos.categorias),
    archivada: false,
  };
  return validarOLanzar({ ...datos, categorias: [...datos.categorias, nueva] });
}

export function archivarCategoria(datos, { id, archivada = true }) {
  const c = buscar(datos.categorias, id, 'La categoría');
  if (c.vinculo) throw falla('Esta categoría es automática y no se puede archivar.', 'vinculada');
  if (archivada && datos.ajustes.ingreso.categoriaId === id) throw falla('Esta categoría es la del ingreso mensual: cámbiela primero en Ajustes.');
  return validarOLanzar({ ...datos, categorias: reemplazarPorId(datos.categorias, id, (x) => ({ ...x, archivada })) });
}

/** Qué se mueve al reasignar una categoría a otra (para el texto de confirmación de la vista). */
export function usosDeCategoria(datos, id) {
  return {
    movimientos: datos.movimientos.filter((m) => m.categoriaId === id).length,
    recurrentes: datos.recurrentes.filter((r) => r.categoriaId === id).length,
    ciclosConPresupuesto: Object.values(datos.presupuestos).filter((p) => p.asignaciones[id] !== undefined).length,
    ingreso: datos.ajustes.ingreso.categoriaId === id,
  };
}

/**
 * Q12: reasigna los movimientos, los pagos recurrentes, el ingreso mensual y las asignaciones de presupuesto (SUMADAS a las
 * de la categoría de destino, ciclo por ciclo) de `desdeId` a `haciaId`, y ARCHIVA la de origen (las categorías no se
 * borran). Solo entre categorías del mismo tipo, sin vínculo automático, y el destino debe estar activo.
 */
export function reasignarCategoria(datos, { desdeId, haciaId }) {
  if (desdeId === haciaId) throw falla('Elige una categoría de destino distinta.');
  const desde = buscar(datos.categorias, desdeId, 'La categoría');
  const hacia = buscar(datos.categorias, haciaId, 'La categoría de destino');
  if (desde.vinculo || hacia.vinculo) throw falla('Las categorías automáticas no se reasignan.', 'vinculada');
  if (desde.tipo !== hacia.tipo) throw falla('Elige una categoría del mismo tipo (gasto o ingreso).');
  if (hacia.archivada) throw falla('La categoría de destino está archivada: elige una categoría activa.');
  const mover = (id) => (id === desdeId ? haciaId : id);
  const presupuestos = {};
  for (const [ciclo, p] of Object.entries(datos.presupuestos)) {
    if (p.asignaciones[desdeId] === undefined) { presupuestos[ciclo] = p; continue; }
    const { [desdeId]: montoDesde, ...resto } = p.asignaciones;
    presupuestos[ciclo] = { ...p, asignaciones: { ...resto, [haciaId]: (resto[haciaId] ?? 0) + montoDesde } };
  }
  return validarOLanzar({
    ...datos,
    categorias: reemplazarPorId(datos.categorias, desdeId, (c) => ({ ...c, archivada: true })),
    movimientos: datos.movimientos.map((m) => (m.categoriaId === desdeId ? { ...m, categoriaId: haciaId } : m)),
    recurrentes: datos.recurrentes.map((r) => (r.categoriaId === desdeId ? { ...r, categoriaId: haciaId } : r)),
    presupuestos,
    ajustes: { ...datos.ajustes, ingreso: { ...datos.ajustes.ingreso, categoriaId: mover(datos.ajustes.ingreso.categoriaId) } },
  });
}

// --- Presupuesto ---------------------------------------------------------------------------------------------------

function exigirPresupuesto(datos, ciclo) {
  const p = datos.presupuestos[ciclo];
  if (!p) throw falla('Ese ciclo todavía no tiene presupuesto.', 'sin-presupuesto');
  return p;
}

export function guardarAsignacion(datos, { ciclo, categoriaId, monto }) {
  const p = exigirPresupuesto(datos, ciclo);
  const c = buscar(datos.categorias, categoriaId, 'La categoría');
  if (c.tipo !== 'gasto') throw falla('Solo las categorías de gasto tienen presupuesto.');
  if (!esPesosValido(monto, { min: 0, max: MAX_PESOS })) throw falla(mensajePesos(monto, 'El monto debe ser un entero en pesos (0 o más).'));
  // Editar a mano "Pago de deudas" lo deja fijado (H-04): deja de seguir a las cuotas hasta `restablecerPagoDeudas`.
  const fijar = c.vinculo === 'cuotas-deudas' ? { pagoDeudasFijo: true } : {};
  return { ...datos, presupuestos: { ...datos.presupuestos, [ciclo]: { ...p, ...fijar, asignaciones: { ...p.asignaciones, [categoriaId]: monto }, origen: 'manual' } } };
}

/**
 * Vuelve "Pago de deudas" de un ciclo a CALCULADO (suma de las cuotas vigentes) y lo vuelve a hacer seguir a las cuotas.
 * R2F-15: no en un ciclo cerrado (recalcularía con las cuotas de hoy y no con las de ese ciclo: reescribiría la historia).
 */
export function restablecerPagoDeudas(datos, { ciclo }, ctx) {
  const p = exigirPresupuesto(datos, ciclo);
  if (ctx && rangoCiclo(ciclo, datos.ajustes.diaPago).fin < ctx.hoy) throw falla('Un ciclo cerrado conserva lo que mostraba: "Volver a calculado" usaría las cuotas de hoy y no las de ese ciclo.', 'ciclo-cerrado');
  const c = datos.categorias.find((x) => x.vinculo === 'cuotas-deudas');
  if (!c) throw falla('No hay una categoría de pago de deudas.');
  const { pagoDeudasFijo: _fijo, ...resto } = p;
  return { ...datos, presupuestos: { ...datos.presupuestos, [ciclo]: { ...resto, asignaciones: { ...p.asignaciones, [c.id]: pagoDeudasCalculado(datos, ciclo) } } } };
}

export function guardarIngresoPlaneado(datos, { ciclo, monto }) {
  const p = exigirPresupuesto(datos, ciclo);
  if (!esPesosValido(monto, { min: 0, max: MAX_PESOS })) throw falla(mensajePesos(monto, 'El ingreso debe ser un entero en pesos (0 o más).'));
  return { ...datos, presupuestos: { ...datos.presupuestos, [ciclo]: { ...p, ingresoPlaneado: monto, origen: 'manual' } } };
}

/**
 * Crea (o reemplaza) el presupuesto de `hacia` copiando el de `desde`; "Pago de deudas" se recalcula.
 * R3F-05: un ciclo ya cerrado no se toca (se reescribiría con las cuotas de hoy y perdería `pagoDeudasCongelado`): se rechaza.
 */
export function copiarPresupuesto(datos, { desde, hacia }, ctx) {
  exigirPresupuesto(datos, desde);
  if (ctx && esCicloRazonable(hacia) && rangoCiclo(hacia, datos.ajustes.diaPago).fin < ctx.hoy) throw falla('Un ciclo cerrado conserva lo que mostraba: copiarle un presupuesto lo reescribiría con las cuotas de hoy. Solo se puede copiar al ciclo actual o a uno futuro.', 'ciclo-cerrado');
  if (hacia < datos.ajustes.cicloInicial) throw falla('No hay presupuestos anteriores al ciclo inicial.');
  if (!esCicloRazonable(hacia)) throw falla(MENSAJE_CICLO_RANGO, 'ciclo-fuera-de-rango'); // R2F-12: nunca se guarda una clave que `validar` rechazaría
  const sinSalario = datos.presupuestos[hacia]?.sinSalario === true; // R2F-04: reemplazar el presupuesto no quita la marca de transición
  const nuevo = { ...crearPresupuestoCopia(datos, hacia, desde, ctx.ahora), ...(sinSalario ? { sinSalario: true } : {}) };
  return { ...datos, presupuestos: { ...datos.presupuestos, [hacia]: nuevo } };
}

/**
 * Cambia el día de pago (V5): vale desde el ciclo SIGUIENTE al actual, o desde uno posterior si el día nuevo ya pasó este mes
 * (el ciclo actual conserva sus fechas y "hoy" nunca sale de él: R1F-01). Antes de empezar el programa también vale desde el
 * ciclo siguiente al inicial (el primer ciclo no queda con huecos: R1F-02). Ver `aplicarDiaPago` (periodo.js).
 * Garantiza que el ciclo actual tenga presupuesto (ejecuta `alAbrir`).
 */
export function cambiarDiaPago(datos, { dia }, ctx) {
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) throw falla('El día de pago debe estar entre 1 y 31.');
  const { historial, transicion } = aplicarDiaPago(datos, dia, ctx.hoy);
  const nuevos = validarOLanzar({ ...datos, ajustes: { ...datos.ajustes, diaPago: historial } });
  return alAbrir(marcarCiclosSinSalario(nuevos, estadoCiclo(datos, ctx.hoy).ciclo, transicion, ctx), {}, ctx);
}

/**
 * R2F-04: los ciclos de transición intermedios (posteriores a hoy, que conservan el día anterior) empiezan en una fecha que ya no es
 * día de pago: se crea su presupuesto (copia del anterior) marcado `sinSalario`, y no se espera salario en ellos (el siguiente llega
 * en el ciclo que sigue). Antes se quita la marca de todo ciclo futuro: un cambio nuevo recalcula cuáles son de transición.
 */
function marcarCiclosSinSalario(datos, cicloActual, transicion, ctx) {
  const presupuestos = {};
  for (const [ciclo, p] of Object.entries(datos.presupuestos)) {
    if (ciclo > cicloActual && p.sinSalario === true) { const { sinSalario: _marca, ...resto } = p; presupuestos[ciclo] = resto; } else presupuestos[ciclo] = p;
  }
  let acumulado = { ...datos, presupuestos };
  for (const ciclo of transicion) {
    const previo = Object.keys(acumulado.presupuestos).filter((c) => c < ciclo).sort().pop();
    const base = acumulado.presupuestos[ciclo] ?? crearPresupuestoCopia(acumulado, ciclo, previo, ctx.ahora);
    acumulado = { ...acumulado, presupuestos: { ...acumulado.presupuestos, [ciclo]: { ...base, sinSalario: true } } };
  }
  return acumulado;
}

export function guardarAjustes(datos, { ingreso, metaGrupos, alertas }) {
  if (ingreso && ingreso.nombre !== undefined) rechazarNumerosLargos(ingreso.nombre); // H-08 (el nombre del ingreso es texto libre)
  const ajustes = {
    ...datos.ajustes,
    ...(ingreso ? { ingreso: { ...datos.ajustes.ingreso, ...ingreso } } : {}),
    ...(metaGrupos ? { metaGrupos: { ...datos.ajustes.metaGrupos, ...metaGrupos } } : {}),
    ...(alertas ? { alertas: { ...datos.ajustes.alertas, ...alertas } } : {}),
  };
  return validarOLanzar({ ...datos, ajustes });
}

// --- Recurrentes ---------------------------------------------------------------------------------------------------

export function guardarRecurrente(datos, { recurrente }, ctx) {
  if (!recurrente) throw falla('Falta el pago recurrente.');
  rechazarNumerosLargos(recurrente.nombre); // H-08: el nombre es texto libre y nunca debe guardar un número de tarjeta o de cuenta
  if (recurrente.id) {
    const previo = buscar(datos.recurrentes, recurrente.id, 'El pago recurrente');
    const { id: _id, ...cambios } = recurrente;
    return validarOLanzar({ ...datos, recurrentes: reemplazarPorId(datos.recurrentes, previo.id, (r) => ({ ...r, ...cambios })) });
  }
  const nuevo = { rango: null, activo: true, desde: ctx.hoy, ...recurrente, id: ctx.generarId('rec') };
  if (!esFechaISO(nuevo.desde)) throw falla('La fecha de inicio no es válida.');
  return validarOLanzar({ ...datos, recurrentes: [...datos.recurrentes, nuevo] });
}

/** Borrar no toca los movimientos ya creados. */
export function borrarRecurrente(datos, { id }) {
  buscar(datos.recurrentes, id, 'El pago recurrente');
  return { ...datos, recurrentes: datos.recurrentes.filter((r) => r.id !== id) };
}

// --- Metas ---------------------------------------------------------------------------------------------------------

export function guardarMeta(datos, { meta }, ctx) {
  if (!meta) throw falla('Falta la meta.');
  rechazarNumerosLargos(meta.nombre);
  if (meta.id) {
    const previa = buscar(datos.metas, meta.id, 'La meta');
    const { id: _id, creadaEn: _c, ...cambios } = meta;
    return validarOLanzar({ ...datos, metas: reemplazarPorId(datos.metas, previa.id, (m) => ({ ...m, ...cambios })) });
  }
  const nueva = { cuentaId: null, icono: 'escudo', archivada: false, ...meta, id: ctx.generarId('met'), creadaEn: ctx.hoy };
  return validarOLanzar({ ...datos, metas: [...datos.metas, nueva] });
}

export function archivarMeta(datos, { id, archivada = true }) {
  buscar(datos.metas, id, 'La meta');
  return { ...datos, metas: reemplazarPorId(datos.metas, id, (m) => ({ ...m, archivada })) };
}

