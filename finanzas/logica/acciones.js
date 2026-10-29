/*
 * acciones.js — mutaciones PURAS de los datos de Finanzas: (datos, payload, ctx) → datosNuevos.
 * Contrato: docs/ARQUITECTURA.md §5.3 y ESQUEMA-FINANZAS §14. Nunca mutan `datos` (las pruebas pasan objetos congelados).
 * Si la acción no aplica, lanzan Error con mensaje en español para el usuario.
 *
 * ctx = { hoy:'YYYY-MM-DD', ahora:'<ISO UTC>', generarId:(prefijo)=>string }
 * Las acciones de alto impacto estructural (cuentas, deudas, categorías, recurrentes, metas) revalidan el conjunto con
 * validar() antes de devolver; las de movimientos validan solo el movimiento (ruta caliente) y su unicidad de origen.
 */
import { cicloDe, cicloSiguiente, listarCiclos, rangoCiclo } from '../../shared/lib/ciclos.js';
import { esFechaISO, crearContexto, esPesosValido } from '../../shared/lib/validacion.js';
import { claveOrigen, COLORES_META, crearReferencias, esCicloRazonable, GRUPOS, MAX_PESOS, MENSAJE_CICLO_RANGO, mensajeNumeroSensible, mensajePesos, tieneNumeroLargo, validar, validarMovimiento } from './esquema.js';
import { cuotaPropuesta } from './deudas.js';
import { crearPresupuestoCopia, pagoDeudasCalculado } from './presupuesto.js';
import { clavesUsadas, indiceOrigenes, ocurrenciaExiste, ocurrenciaPendiente, ocurrenciasCuota, ocurrenciasRecurrente } from './recurrentes.js';
import { calcularSaldos } from './saldos.js';
import { barraDeMeta, categoriaDeMeta, categoriaParaAporte, maximoRetirable, saldoMinimoMeta } from './metas.js';
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
  // RONDA-USUARIO-A: un aporte o retiro consume UNA sola categoría: la barra propia de la meta o, si no tiene, "Ahorro y metas".
  if ((crudo.tipo === 'aporteMeta' || crudo.tipo === 'retiroMeta') && typeof crudo.metaId === 'string') {
    const categoriaId = categoriaParaAporte(datos, crudo.metaId, crudo.categoriaId);
    if (categoriaId) crudo = { ...crudo, categoriaId };
  }
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

/**
 * Ronda del usuario B: efecto de un movimiento en el saldo de UNA cuenta (no crédito); mismo criterio que `calcularSaldos` (saldos.js).
 */
function efectoEnCuenta(m, cuentaId) {
  switch (m.tipo) {
    case 'gasto': case 'pagoDeuda': return m.cuentaId === cuentaId ? -m.monto : 0;
    case 'ingreso': case 'ajusteCuenta': return m.cuentaId === cuentaId ? m.monto : 0;
    case 'transferencia': return (m.cuentaId === cuentaId ? -m.monto : 0) + (m.cuentaDestinoId === cuentaId ? m.monto : 0);
    case 'aporteMeta': case 'retiroMeta': return m.cuentaDestinoId ? (m.cuentaId === cuentaId ? -m.monto : 0) + (m.cuentaDestinoId === cuentaId ? m.monto : 0) : 0;
    default: return 0;
  }
}

/** Saldo de la cuenta al cierre de cada fecha en que algo lo cambia, más `extra`, en una pasada ordenada. → [{ fecha, saldo }] */
function saldosDeCuentaPorFecha(datos, movimientos, cuenta, extra = []) {
  const cambios = [];
  for (const m of movimientos) { const e = efectoEnCuenta(m, cuenta.id); if (e !== 0) cambios.push([m.fecha, e]); }
  for (const f of extra) cambios.push([f, 0]);
  cambios.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const inicioPrograma = rangoCiclo(datos.ajustes.cicloInicial, datos.ajustes.diaPago).inicio;
  const existe = (f) => f >= cuenta.fechaSaldoInicial || cuenta.fechaSaldoInicial <= inicioPrograma;
  const salida = [];
  let acumulado = 0;
  for (let i = 0; i < cambios.length; i += 1) {
    acumulado += cambios[i][1];
    if (i + 1 < cambios.length && cambios[i + 1][0] === cambios[i][0]) continue;
    salida.push({ fecha: cambios[i][0], saldo: (existe(cambios[i][0]) ? cuenta.saldoInicial : 0) + acumulado });
  }
  return salida;
}

/**
 * RU-03 / RU-04: AVISO (no bloqueo) de saldo. Antes de guardar, la vista pregunta qué cuentas quedarían en negativo por un cambio y pide
 * confirmación ("Esta cuenta quedará en −$ X (hoy tiene $ Y). ¿Continuar?"): la app no sabe lo que hay en el banco (con los datos reales las
 * cuentas parten en $ 0 hasta marcar el salario) y una cuenta en sobregiro también debe poder transferir. Las acciones NO rechazan por esto:
 * sirven para confirmar, deshacer y restaurar. Se siguen rechazando en la validación: misma cuenta de origen y destino, tarjetas como origen o
 * destino de una transferencia común (se paga con "Pagar tarjeta"), montos no válidos o sobre el tope.
 *
 * `cambio` = { agregar?: movimiento, editar?: movimiento con id, borrar?: id }. Se evalúan las cuentas (no crédito) cuyo saldo cambia por el
 * movimiento nuevo o por el anterior (origen y destino de una transferencia o de un aporte con destino, cuenta de un ingreso o de un pago).
 * Una cuenta se avisa solo si, entre la fecha del cambio y hoy (lo programado a futuro, a su propia fecha), su saldo más bajo queda bajo $ 0 Y
 * el cambio lo EMPEORA (datos que ya estaban en negativo no avisan por cambios ajenos). Es PURO.
 * @returns {Array<{cuenta:object, saldoHoy:number, queda:number, fecha:string}>} `saldoHoy` = saldo a hoy antes del cambio; `queda` = el saldo más
 *   bajo después del cambio y `fecha` el día en que ocurre.
 */
export function avisosDeSaldo(datos, cambio, hoy) {
  const { agregar, editar, borrar } = cambio ?? {};
  const previo = borrar !== undefined ? buscar(datos.movimientos, borrar, 'El movimiento') : editar ? buscar(datos.movimientos, editar.id, 'El movimiento') : null;
  const nuevo = editar ?? agregar ?? null;
  const tocados = [previo, nuevo].filter(Boolean);
  if (!tocados.length) return [];
  const idNuevo = nuevo ? (nuevo.id ?? '__nuevo__') : null;
  const despues = [
    ...datos.movimientos.filter((m) => m.id !== (previo ? previo.id : null)),
    ...(nuevo ? [{ ...nuevo, id: idNuevo }] : []),
  ];
  const inicio = tocados.reduce((m, x) => (x.fecha < m ? x.fecha : m), tocados[0].fecha);
  const ultimo = tocados.reduce((m, x) => (x.fecha > m ? x.fecha : m), tocados[0].fecha);
  const fin = hoy !== undefined && hoy > ultimo ? hoy : ultimo;
  const ids = new Set();
  for (const m of tocados) for (const id of [m.cuentaId, m.cuentaDestinoId]) if (id && efectoEnCuenta(m, id) !== 0) ids.add(id);
  const saldos = hoy !== undefined ? calcularSaldos(datos, hoy) : null;
  const salida = [];
  for (const id of ids) {
    const cuenta = datos.cuentas.find((c) => c.id === id);
    if (!cuenta || cuenta.tipo === 'credito') continue;
    const serie = (lista) => saldosDeCuentaPorFecha(datos, lista.filter((x) => x.fecha <= fin), cuenta, [inicio, fin]).filter((s) => s.fecha >= inicio && s.fecha <= fin);
    const peor = (lista) => serie(lista).reduce((acc, s) => (s.saldo < acc.saldo ? s : acc), { fecha: inicio, saldo: Infinity });
    const d = peor(despues);
    if (d.saldo >= 0 || d.saldo >= peor(datos.movimientos).saldo) continue;
    salida.push({ cuenta, saldoHoy: saldos ? saldos.cuentas[id] : peor(datos.movimientos).saldo, queda: d.saldo, fecha: d.fecha });
  }
  return salida;
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
      ? { nombre: cuenta.nombre, icono: cuenta.icono, color: cuenta.color }
      : { nombre: cuenta.nombre, icono: cuenta.icono, tipo: cuenta.tipo, saldoInicial: cuenta.saldoInicial, fechaSaldoInicial: cuenta.fechaSaldoInicial, color: cuenta.color };
    for (const k of Object.keys(editable)) if (editable[k] === undefined) delete editable[k];
    if (editable.tipo === 'credito') throw falla('Una cuenta no se puede convertir en tarjeta de crédito: agrega la tarjeta en Deudas.');
    const quitarColor = editable.color === null; // color: null = quitar el color
    if (quitarColor) delete editable.color;
    return validarOLanzar({ ...datos, cuentas: reemplazarPorId(datos.cuentas, previa.id, (c) => { const n = { ...c, ...editable }; if (quitarColor) delete n.color; return n; }) });
  }
  if (cuenta.tipo === 'credito') throw falla('Las tarjetas de crédito no se crean como una cuenta más: usa "Agregar tarjeta de crédito" (Cuentas o Deudas) y se crea junto con su deuda.');
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
    ...(cuenta.color ? { color: cuenta.color } : {}),
  };
  return validarOLanzar({ ...datos, cuentas: [...datos.cuentas, nueva] });
}

export function archivarCuenta(datos, { id, archivada = true }) {
  const c = buscar(datos.cuentas, id, 'La cuenta');
  if (c.tipo === 'credito') throw falla('Una tarjeta se archiva desde Deudas, cuando está saldada.');
  if (archivada && datos.ajustes.ingreso.cuentaId === id) throw falla('Esta cuenta recibe el ingreso: cambie primero la cuenta del ingreso en Ajustes.');
  return validarOLanzar({ ...datos, cuentas: reemplazarPorId(datos.cuentas, id, (x) => ({ ...x, archivada })) });
}

/**
 * Ronda del usuario B: ¿quitar del todo esta cuenta o deuda cambiaría el patrimonio de un ciclo ya CERRADO? Pasa si tiene saldo inicial
 * (≠ 0) y existía al cierre de algún ciclo cerrado (saldos.js: una de apertura existe en todo corte; las demás, desde su fecha). Un
 * ciclo cerrado conserva su patrimonio (R2F-08), así que en ese caso no se borra: se archiva (el historial se conserva).
 * Sin ciclos cerrados (antes de empezar o durante el primer ciclo) borrar no reescribe nada.
 */
export function afectaCiclosCerrados(datos, entidad, hoy) {
  if (!entidad.saldoInicial || hoy === undefined) return false;
  const est = estadoCiclo(datos, hoy);
  if (est.ciclo <= est.cicloInicial) return false;
  const inicioPrograma = rangoCiclo(datos.ajustes.cicloInicial, datos.ajustes.diaPago).inicio;
  return entidad.fechaSaldoInicial <= inicioPrograma || entidad.fechaSaldoInicial < est.rango.inicio;
}

export function borrarCuenta(datos, { id }, ctx) {
  const c = buscar(datos.cuentas, id, 'La cuenta');
  if (c.tipo === 'credito') throw falla('Una tarjeta no se borra desde Cuentas: usa "Eliminar tarjeta" (quita la deuda y su cuenta juntas).', 'tarjeta');
  if (datos.movimientos.some((m) => m.cuentaId === id || m.cuentaDestinoId === id)) throw falla('La cuenta tiene movimientos: se puede archivar, no borrar. También puedes mover todo a otra cuenta con "Mover movimientos a otra cuenta y borrar".', 'en-uso'); // N-10: menciona la opción de mover
  if (datos.ajustes.ingreso.cuentaId === id || datos.recurrentes.some((r) => r.cuentaId === id) || datos.metas.some((m) => m.cuentaId === id)) {
    throw falla('La cuenta se usa en el ingreso, un pago recurrente o una meta: se puede archivar, no borrar. También puedes mover todo a otra cuenta con "Mover movimientos a otra cuenta y borrar".', 'en-uso');
  }
  if (afectaCiclosCerrados(datos, c, ctx && ctx.hoy)) {
    throw falla(`${c.nombre} tiene un saldo inicial que ya cuenta en el patrimonio de ciclos cerrados: borrarla lo cambiaría. Archívala (su historial se conserva) o, si ya no tiene dinero, ajusta su saldo a $ 0 y luego archívala.`, 'afecta-historial');
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

/** Tope de caracteres del nombre de una cuenta (esquema.js: cuentas[].nombre). */
export const NOMBRE_CUENTA_MAX = 40;

/**
 * RU-01: nombre de la cuenta de crédito vinculada = "nombre entidad". Cada campo admite 40 caracteres pero la cuenta solo 40 en total, así que si
 * no cabe se ACORTA SOLA (sin rechazar al usuario): se recorta la entidad con "…" hasta que quepa; si el nombre solo ya ocupa casi todo el
 * tope, la cuenta se llama como el nombre. La deuda conserva nombre y entidad completos.
 */
export function nombreTarjeta(d) {
  const nombre = String(d.nombre ?? '').trim().replace(/\s+/g, ' ');
  const entidad = String(d.entidad ?? '').trim().replace(/\s+/g, ' ');
  if (!entidad) return nombre;
  const completo = `${nombre} ${entidad}`;
  if (completo.length <= NOMBRE_CUENTA_MAX) return completo;
  const lugar = NOMBRE_CUENTA_MAX - nombre.length - 1; // espacio que queda para la entidad
  if (lugar < 4) return nombre; // ni 3 letras y los puntos suspensivos
  return `${nombre} ${entidad.slice(0, lugar - 1).trimEnd()}…`;
}

/** RU-09: el texto COMPUESTO (nombre + entidad) también se revisa: un número partido entre los dos campos no debe pasar. */
function rechazarNumeroPartido(nombre, entidad) {
  const compuesto = `${nombre ?? ''} ${entidad ?? ''}`;
  if (!tieneNumeroLargo(compuesto)) return;
  throw falla('Entre el nombre y el banco juntos aparece un número de tarjeta o de cuenta. La app no guarda esos números: quita los dígitos de uno de los dos campos y vuelve a guardar.', 'numero-largo');
}

/** Crea o actualiza. Una `tarjeta` nueva crea su cuenta de crédito vinculada en la misma acción (1 a 1). */
export function guardarDeuda(datos, { deuda }, ctx) {
  if (!deuda) throw falla('Falta la deuda.');
  rechazarNumerosLargos(deuda.nombre, deuda.entidad, deuda.notas);
  if (deuda.id) {
    const previa = buscar(datos.deudas, deuda.id, 'La deuda');
    rechazarNumeroPartido(deuda.nombre !== undefined ? deuda.nombre : previa.nombre, deuda.entidad !== undefined ? deuda.entidad : previa.entidad);
    const campos = ['nombre', 'entidad', 'saldoInicial', 'fechaSaldoInicial', 'cuota', 'diaPago', 'tasa', 'notas', 'cupo'];
    const cambios = {};
    for (const k of campos) if (deuda[k] !== undefined) cambios[k] = deuda[k];
    const actualizada = { ...previa, ...cambios };
    if (actualizada.cupo === null) delete actualizada.cupo; // cupo: null = quitar el cupo
    const cuentas = previa.tipo === 'tarjeta'
      ? datos.cuentas.map((c) => (c.id === previa.cuentaId ? { ...c, nombre: nombreTarjeta(actualizada) } : c))
      : datos.cuentas;
    return validarOLanzar({ ...datos, cuentas, deudas: reemplazarPorId(datos.deudas, previa.id, () => actualizada) });
  }
  rechazarNumeroPartido(deuda.nombre, deuda.entidad);
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
    ...(deuda.cupo ? { cupo: deuda.cupo } : {}),
  };
  if (base.tipo === 'tarjeta') {
    const cuentaId = ctx.generarId('cta');
    const cuenta = { id: cuentaId, nombre: nombreTarjeta(base), tipo: 'credito', saldoInicial: null, fechaSaldoInicial: null, deudaId: id, icono: 'tarjeta', orden: siguienteOrden(datos.cuentas), archivada: false };
    return validarOLanzar({ ...datos, cuentas: [...datos.cuentas, cuenta], deudas: [...datos.deudas, { ...base, cuentaId }] });
  }
  return validarOLanzar({ ...datos, deudas: [...datos.deudas, base] });
}

/**
 * Ronda del usuario B: qué usa una deuda (para el texto de confirmación y para decidir si se puede borrar). En una tarjeta cuentan
 * también las compras hechas con ella (gastos de su cuenta de crédito) y los pagos recurrentes que la usan como método de pago.
 * → { pagos, compras, ajustes, movimientos, recurrentes, saldo, programados } (RU-05: `saldo` = el de HOY cuando se pasa `hoy` —el que cierra
 * "Archivar y cerrar el saldo"—; sin `hoy`, el de fin de los tiempos. `programados` = movimientos de la deuda con fecha posterior a hoy.)
 */
export function usosDeDeuda(datos, id, hoy) {
  const d = buscar(datos.deudas, id, 'La deuda');
  let pagos = 0;
  let compras = 0;
  let ajustes = 0;
  let programados = 0;
  for (const m of datos.movimientos) {
    const propio = (m.tipo === 'pagoDeuda' || m.tipo === 'ajusteDeuda') && m.deudaId === id;
    if (m.tipo === 'pagoDeuda' && m.deudaId === id) pagos += 1;
    else if (m.tipo === 'ajusteDeuda' && m.deudaId === id) ajustes += 1;
    else if (m.tipo === 'gasto' && d.cuentaId && m.cuentaId === d.cuentaId) compras += 1;
    else continue;
    if (propio || m.tipo === 'gasto') if (hoy !== undefined && m.fecha > hoy) programados += 1;
  }
  return {
    pagos, compras, ajustes, movimientos: pagos + compras + ajustes, programados,
    recurrentes: d.cuentaId ? datos.recurrentes.filter((r) => r.cuentaId === d.cuentaId).length : 0,
    saldo: calcularSaldos(datos, hoy ?? '9999-12-31').deudas[id],
  };
}

/** Cuenta que hereda los pagos recurrentes de una tarjeta que se quita: la elegida o, por omisión, la del ingreso mensual. */
function moverRecurrentesDeTarjeta(datos, cuentaTarjetaId, haciaId) {
  if (!cuentaTarjetaId || !datos.recurrentes.some((r) => r.cuentaId === cuentaTarjetaId)) return datos.recurrentes;
  const destinoId = haciaId ?? datos.ajustes.ingreso.cuentaId;
  const destino = datos.cuentas.find((c) => c.id === destinoId);
  if (!destino || destino.id === cuentaTarjetaId || destino.archivada) throw falla('Elige una cuenta activa para los pagos recurrentes que usaban la tarjeta.');
  return datos.recurrentes.map((r) => (r.cuentaId === cuentaTarjetaId ? { ...r, cuentaId: destino.id } : r));
}

/** Antes de quitar o archivar: los ciclos ya cerrados guardan el "Pago de deudas" que mostraban (así no cambia con las deudas de hoy). */
const conCiclosCerradosCongelados = (datos, ctx) => (ctx && ctx.hoy && ctx.ahora ? alAbrir(datos, {}, ctx) : datos);

/** Notas de los dos ajustes que acompañan a archivar con cierre y a restaurar (RU-05): con ellas se sabe cuánto hay que devolver al restaurar. */
export const NOTA_CIERRE_DEUDA = 'Saldo cerrado al archivar';
export const NOTA_RESTAURA_DEUDA = 'Saldo restaurado al reactivar';

/** Lo que el cierre de la deuda quitó y aún no se devolvió: Σ ajustes de cierre + Σ ajustes de restauración (negativo = hay saldo por devolver). */
export function saldoCerradoPendiente(datos, id) {
  let neto = 0;
  for (const m of datos.movimientos) {
    if (m.tipo === 'ajusteDeuda' && m.deudaId === id && (m.nota === NOTA_CIERRE_DEUDA || m.nota === NOTA_RESTAURA_DEUDA)) neto += m.monto;
  }
  return neto;
}

/**
 * Archiva una deuda (y, si es tarjeta, su cuenta de crédito, como un solo conjunto) o la restaura.
 * Sin `cerrarSaldo`, solo una deuda saldada (saldo $ 0 A HOY). Con `cerrarSaldo: true` y saldo ≠ 0 se registra antes un `ajusteDeuda` de cierre
 * (fecha de hoy, nota "Saldo cerrado al archivar") que la deja en $ 0 HOY: el cierre usa el saldo con los movimientos de fecha ≤ hoy (RU-05: antes usaba
 * el de fin de los tiempos, que incluye abonos programados, y la tarjeta quedaba con saldo ≠ 0 aunque el mensaje decía $ 0). El historial y el patrimonio
 * de ciclos pasados no cambian (el ajuste es de hoy). Al RESTAURAR una deuda cerrada, se registra un ajuste de hoy que devuelve el saldo que el cierre
 * había quitado (también sin tocar ciclos cerrados). Los pagos recurrentes que usaban la tarjeta pasan a `recurrentesHaciaId` (por omisión, la cuenta del ingreso).
 */
export function archivarDeuda(datos, { id, archivada = true, cerrarSaldo = false, recurrentesHaciaId }, ctx) {
  const d = buscar(datos.deudas, id, 'La deuda');
  if (!archivada) {
    const pendiente = saldoCerradoPendiente(datos, id);
    let movimientos = datos.movimientos;
    if (pendiente !== 0) {
      if (!ctx) throw falla('No se pudo registrar el ajuste que devuelve el saldo de la deuda.');
      const fechaPropuesta = fechaPorDefecto(datos, ctx.hoy);
      const fecha = fechaPropuesta < d.fechaSaldoInicial ? d.fechaSaldoInicial : fechaPropuesta;
      movimientos = [...movimientos, { id: ctx.generarId('mov'), tipo: 'ajusteDeuda', fecha, monto: -pendiente, deudaId: id, nota: NOTA_RESTAURA_DEUDA, origen: null, creadoEn: ctx.ahora, actualizadoEn: null }];
    }
    return validarOLanzar({
      ...datos,
      movimientos,
      deudas: reemplazarPorId(datos.deudas, id, (x) => ({ ...x, archivada: false })),
      cuentas: datos.cuentas.map((c) => (d.cuentaId && c.id === d.cuentaId ? { ...c, archivada: false } : c)),
    });
  }
  // RU-05: el saldo que se cierra es el de la FECHA del ajuste (hoy; antes de empezar el programa, su primer día): lo programado a futuro no cuenta.
  const fechaPropuesta = ctx && ctx.hoy ? fechaPorDefecto(datos, ctx.hoy) : '9999-12-31';
  const fecha = fechaPropuesta < d.fechaSaldoInicial ? d.fechaSaldoInicial : fechaPropuesta;
  const saldo = calcularSaldos(datos, fecha).deudas[id];
  if (saldo !== 0 && !cerrarSaldo) throw falla('Solo se puede archivar una deuda saldada (saldo $ 0).', 'no-saldada');
  let base = conCiclosCerradosCongelados(datos, ctx);
  if (saldo !== 0) {
    if (!ctx) throw falla('No se pudo registrar el ajuste que cierra el saldo.');
    const cierre = { id: ctx.generarId('mov'), tipo: 'ajusteDeuda', fecha, monto: -saldo, deudaId: id, nota: NOTA_CIERRE_DEUDA, origen: null, creadoEn: ctx.ahora, actualizadoEn: null };
    base = { ...base, movimientos: [...base.movimientos, cierre] };
  }
  const recurrentes = moverRecurrentesDeTarjeta(base, d.cuentaId, recurrentesHaciaId);
  return validarOLanzar({
    ...base,
    recurrentes,
    deudas: reemplazarPorId(base.deudas, id, (x) => ({ ...x, archivada: true })),
    cuentas: base.cuentas.map((c) => (d.cuentaId && c.id === d.cuentaId ? { ...c, archivada: true } : c)),
  });
}

/**
 * Ronda del usuario B: borra una deuda (y, si es tarjeta, su cuenta de crédito vinculada, juntas) SOLO si nunca se usó: sin pagos, compras
 * con la tarjeta ni ajustes. Si tiene saldo inicial y ya hay ciclos cerrados que la incluyen, tampoco (cambiaría su patrimonio): se archiva.
 * Los ciclos cerrados conservan su "Pago de deudas" (se congela antes); el ciclo actual y los futuros siguen a las cuotas vigentes.
 */
export function borrarDeuda(datos, { id, recurrentesHaciaId }, ctx) {
  const d = buscar(datos.deudas, id, 'La deuda');
  const u = usosDeDeuda(datos, id);
  if (u.movimientos > 0) {
    throw falla(`${d.nombre} tiene ${u.movimientos} movimiento${u.movimientos === 1 ? '' : 's'} (pagos, compras con la tarjeta o ajustes): no se puede borrar sin perder el historial. Archívala (conserva el historial) o mueve sus movimientos a otra deuda.`, 'en-uso');
  }
  if (afectaCiclosCerrados(datos, d, ctx && ctx.hoy)) {
    throw falla(`${d.nombre} tiene un saldo inicial que ya cuenta en el patrimonio de ciclos cerrados: borrarla lo cambiaría. Archívala: se registra un ajuste que la deja en $ 0 hoy y el historial se conserva.`, 'afecta-historial');
  }
  const base = conCiclosCerradosCongelados(datos, ctx);
  const recurrentes = moverRecurrentesDeTarjeta(base, d.cuentaId, recurrentesHaciaId);
  return validarOLanzar({
    ...base,
    recurrentes,
    deudas: base.deudas.filter((x) => x.id !== id),
    cuentas: base.cuentas.filter((c) => !(d.cuentaId && c.id === d.cuentaId)),
  });
}

/**
 * Ronda del usuario B: mueve TODO el historial de una deuda (pagos, ajustes y, si es tarjeta, las compras hechas con ella y sus pagos recurrentes) a
 * otra deuda y borra la primera (y su cuenta de crédito) como un conjunto. Una tarjeta solo se mueve a otra tarjeta (las compras necesitan
 * una cuenta de crédito). Como en `reasignarCuenta` (R2F-08), el patrimonio de cualquier fecha no cambia: la deuda de destino conserva el saldo
 * inicial y la fecha de la MÁS ANTIGUA y el de la otra queda como un `ajusteDeuda` con su fecha original ("Saldo inicial de X"); si las dos
 * son de apertura se suman. Un pago que venía de una cuota programada de la deuda movida pierde ese `origen` (esa cuota deja de existir).
 */
export function reasignarDeuda(datos, { desdeId, haciaId }, ctx) {
  if (desdeId === haciaId) throw falla('Elige una deuda de destino distinta.');
  const desde = buscar(datos.deudas, desdeId, 'La deuda');
  const hacia = buscar(datos.deudas, haciaId, 'La deuda de destino');
  if (hacia.archivada) throw falla('La deuda de destino está archivada: elige una deuda activa.');
  if (desde.tipo === 'tarjeta' && hacia.tipo !== 'tarjeta') throw falla('Las compras con una tarjeta solo se pueden mover a otra tarjeta de crédito.');
  if (!ctx) throw falla('No se pudo registrar el saldo inicial de la deuda movida.');
  const base = conCiclosCerradosCongelados(datos, ctx);
  const plan = planSaldoReasignado(base, desde, hacia);
  const cuentaDesde = desde.cuentaId;
  const cuentaHacia = hacia.cuentaId;
  const movimientos = base.movimientos.map((m) => {
    if ((m.tipo === 'pagoDeuda' || m.tipo === 'ajusteDeuda') && m.deudaId === desdeId) return { ...m, deudaId: haciaId, origen: m.origen && m.origen.tipo === 'cuota' && m.origen.id === desdeId ? null : m.origen };
    if (m.tipo === 'gasto' && cuentaDesde && m.cuentaId === cuentaDesde) return { ...m, cuentaId: cuentaHacia };
    return m;
  });
  if (plan.ajuste) {
    movimientos.push({ id: ctx.generarId('mov'), tipo: 'ajusteDeuda', fecha: plan.ajuste.fecha, monto: plan.ajuste.monto, deudaId: haciaId, nota: plan.ajuste.nota.replace(' (cuenta movida)', ' (deuda movida)'), origen: null, creadoEn: ctx.ahora, actualizadoEn: null });
  }
  return validarOLanzar({
    ...base,
    movimientos,
    deudas: base.deudas.filter((d) => d.id !== desdeId).map((d) => (d.id === haciaId ? { ...d, saldoInicial: plan.saldoInicial, fechaSaldoInicial: plan.fechaSaldoInicial } : d)),
    cuentas: base.cuentas.filter((c) => c.id !== cuentaDesde),
    recurrentes: base.recurrentes.map((r) => (cuentaDesde && r.cuentaId === cuentaDesde ? { ...r, cuentaId: cuentaHacia } : r)),
  });
}

// --- Categorías ----------------------------------------------------------------------------------------------------

const NOMBRE_MAX = 40;
const claveNombre = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Nombre de categoría o de meta: obligatorio, hasta 40 caracteres y sin repetir otro (sin distinguir mayúsculas ni tildes). Devuelve el
 * nombre limpio. `omitirId` = la propia categoría al editar. Solo se llama al CREAR o al CAMBIAR el nombre: los datos anteriores con
 * nombres repetidos siguen siendo válidos.
 */
function nombreDeCategoriaValido(datos, nombre, omitirId = null) {
  const n = typeof nombre === 'string' ? nombre.trim().replace(/\s+/g, ' ') : '';
  if (!n) throw falla('Escribe el nombre de la categoría.', 'nombre-vacio');
  if (n.length > NOMBRE_MAX) throw falla(`El nombre es demasiado largo: máximo ${NOMBRE_MAX} caracteres (tiene ${n.length}).`, 'nombre-largo');
  const repetida = datos.categorias.find((c) => c.id !== omitirId && claveNombre(c.nombre) === claveNombre(n));
  if (repetida) throw falla(`Ya existe una categoría llamada "${repetida.nombre}"${repetida.archivada ? ' (está archivada: restáurala desde Categorías)' : ''}. Elige otro nombre.`, 'nombre-repetido');
  return n;
}

/**
 * Fija el monto de una categoría de gasto en el ciclo actual y en TODOS los presupuestos de ciclos futuros que ya existan (los que se
 * creen después la heredan al copiar). Los ciclos cerrados no se tocan. Devuelve los datos nuevos.
 */
function asignarDesdeCicloActual(datos, categoriaId, monto, ctx, desde = null) {
  if (!esPesosValido(monto, { min: 0, max: MAX_PESOS })) throw falla(mensajePesos(monto, 'El monto asignado debe ser un entero en pesos (0 o más).'));
  const actual = desde ?? estadoCiclo(datos, ctx.hoy).ciclo;
  const presupuestos = {};
  for (const [ciclo, p] of Object.entries(datos.presupuestos)) {
    presupuestos[ciclo] = ciclo >= actual ? { ...p, asignaciones: { ...p.asignaciones, [categoriaId]: monto }, origen: 'manual' } : p;
  }
  return { ...datos, presupuestos };
}

/** Quita la categoría de las asignaciones de los ciclos indicados (todos si no se indica `desdeCiclo`). */
function quitarAsignaciones(datos, categoriaId, desdeCiclo = null) {
  const presupuestos = {};
  for (const [ciclo, p] of Object.entries(datos.presupuestos)) {
    if ((desdeCiclo === null || ciclo >= desdeCiclo) && p.asignaciones[categoriaId] !== undefined) {
      const { [categoriaId]: _quitada, ...resto } = p.asignaciones;
      presupuestos[ciclo] = { ...p, asignaciones: resto };
    } else presupuestos[ciclo] = p;
  }
  return { ...datos, presupuestos };
}

/**
 * Crea o edita una categoría. Alta: { nombre, tipo, grupo (si es de gasto), icono?, asignacion? } — `asignacion` (pesos ≥ 0, solo de
 * gasto) es el monto del ciclo actual y de los futuros ya creados. Edición: { id, nombre?, grupo?, icono? }. Una categoría que es la
 * barra de una meta (`metaId`) se cambia desde Metas.
 */
export function guardarCategoria(datos, { categoria }, ctx) {
  if (!categoria) throw falla('Falta la categoría.');
  rechazarNumerosLargos(categoria.nombre);
  if (categoria.id) {
    const previa = buscar(datos.categorias, categoria.id, 'La categoría');
    if (previa.metaId) {
      const meta = datos.metas.find((m) => m.id === previa.metaId);
      throw falla(`Esta categoría es el presupuesto de la meta "${meta ? meta.nombre : 'de ahorro'}": cámbiala desde Metas.`, 'de-meta');
    }
    const permitidos = previa.vinculo ? ['nombre', 'icono'] : previa.tipo === 'gasto' ? ['nombre', 'icono', 'grupo'] : ['nombre', 'icono'];
    const cambios = {};
    for (const k of permitidos) if (categoria[k] !== undefined) cambios[k] = categoria[k];
    if (cambios.nombre !== undefined && claveNombre(cambios.nombre) !== claveNombre(previa.nombre)) cambios.nombre = nombreDeCategoriaValido(datos, cambios.nombre, previa.id);
    else if (cambios.nombre !== undefined) cambios.nombre = typeof cambios.nombre === 'string' && cambios.nombre.trim() ? cambios.nombre.trim().replace(/\s+/g, ' ') : nombreDeCategoriaValido(datos, cambios.nombre, previa.id);
    if (cambios.grupo !== undefined && !GRUPOS.includes(cambios.grupo)) throw falla('Elige el grupo de la categoría: necesidades, gustos o ahorro.');
    return validarOLanzar({ ...datos, categorias: reemplazarPorId(datos.categorias, previa.id, (c) => ({ ...c, ...cambios })) });
  }
  if (!['gasto', 'ingreso'].includes(categoria.tipo)) throw falla('Indique si la categoría es de gasto o de ingreso.');
  const nombre = nombreDeCategoriaValido(datos, categoria.nombre);
  if (categoria.tipo === 'gasto' && !GRUPOS.includes(categoria.grupo)) throw falla('Elige el grupo de la categoría: necesidades, gustos o ahorro.');
  const nueva = {
    id: ctx.generarId('cat'),
    nombre,
    tipo: categoria.tipo,
    grupo: categoria.tipo === 'gasto' ? categoria.grupo : null,
    vinculo: null,
    icono: categoria.icono ?? 'otro',
    orden: siguienteOrden(datos.categorias),
    archivada: false,
    creadaEn: ctx.hoy,
  };
  let resultado = { ...datos, categorias: [...datos.categorias, nueva] };
  if (categoria.asignacion !== undefined && categoria.asignacion !== null) {
    if (categoria.tipo !== 'gasto') throw falla('Solo las categorías de gasto tienen presupuesto.');
    if (categoria.asignacion > 0) resultado = asignarDesdeCicloActual(resultado, nueva.id, categoria.asignacion, ctx);
    else if (!esPesosValido(categoria.asignacion, { min: 0, max: MAX_PESOS })) throw falla(mensajePesos(categoria.asignacion, 'El monto asignado debe ser un entero en pesos (0 o más).'));
  }
  return validarOLanzar(resultado);
}

export function archivarCategoria(datos, { id, archivada = true }) {
  const c = buscar(datos.categorias, id, 'La categoría');
  if (c.vinculo) throw falla('Esta categoría es automática y no se puede archivar.', 'vinculada');
  if (c.metaId) throw falla('Esta categoría es el presupuesto de una meta de ahorro: archiva o restaura la meta desde Metas.', 'de-meta');
  if (archivada && datos.ajustes.ingreso.categoriaId === id) throw falla('Esta categoría es la del ingreso mensual: cámbiela primero en Ajustes.');
  return validarOLanzar({ ...datos, categorias: reemplazarPorId(datos.categorias, id, (x) => ({ ...x, archivada })) });
}

/**
 * RU-07: ciclos YA CERRADOS (anteriores al actual) en que la categoría tiene un monto asignado > 0. Eliminar la categoría los reescribiría (cambiaría
 * lo asignado, el "sin asignar" y las alertas de esos ciclos), y no se puede dejar una asignación a una categoría que ya no existe: en ese caso no
 * se elimina, se archiva. Sin `hoy` (sin contexto) no se puede saber qué ciclo cerró y devuelve [].
 */
function ciclosCerradosConMonto(datos, categoriaId, hoy) {
  if (!hoy) return [];
  const actual = estadoCiclo(datos, hoy).ciclo;
  return Object.keys(datos.presupuestos).filter((c) => c < actual && (datos.presupuestos[c].asignaciones[categoriaId] ?? 0) > 0).sort();
}

const textoCiclos = (ciclos) => (ciclos.length <= 2 ? ciclos.map((c) => formatearFecha(`${c}-01`, 'mes-anio')).join(' y ') : `${ciclos.length} ciclos cerrados`);

/**
 * Elimina una categoría que nunca se usó: sin movimientos, sin pagos recurrentes y que no sea la del ingreso mensual, automática ni la
 * barra de una meta. RU-07: la quita del ciclo actual y de los futuros; si tiene un monto asignado > 0 en un ciclo YA CERRADO no se elimina (reescribiría
 * ese ciclo: cambiaría su asignado, su "sin asignar" y sus alertas): se ofrece archivarla. Una clave en $ 0 de un ciclo cerrado no cambia ninguna cifra y se
 * retira para no dejar una referencia rota. Si ya tiene historia, el mensaje ofrece archivarla o reasignarla (Q12).
 */
export function borrarCategoria(datos, { id }, ctx) {
  const c = buscar(datos.categorias, id, 'La categoría');
  if (c.vinculo) throw falla('Esta categoría es automática y no se puede eliminar.', 'vinculada');
  if (c.metaId) throw falla('Esta categoría es el presupuesto de una meta de ahorro: se elimina junto con la meta, desde Metas.', 'de-meta');
  if (datos.ajustes.ingreso.categoriaId === id) throw falla('Esta categoría es la del ingreso mensual: cámbiela primero en Ajustes.', 'en-uso');
  const u = usosDeCategoria(datos, id);
  if (u.movimientos > 0) throw falla(`No se puede eliminar: tiene ${u.movimientos} movimiento${u.movimientos === 1 ? '' : 's'}. Puedes archivarla (se conserva el historial) o reasignarlos a otra categoría.`, 'con-movimientos');
  if (u.recurrentes > 0) throw falla(`No se puede eliminar: la usa${u.recurrentes === 1 ? ' 1 pago recurrente' : `n ${u.recurrentes} pagos recurrentes`}. Cámbialo${u.recurrentes === 1 ? '' : 's'} primero o archiva la categoría.`, 'en-uso');
  const cerrados = ciclosCerradosConMonto(datos, id, ctx && ctx.hoy);
  if (cerrados.length) throw falla(`No se puede eliminar: tiene un monto asignado en ${textoCiclos(cerrados)}, que ya cerró y conserva lo que mostraba. Archívala: deja de ofrecerse y el historial se conserva.`, 'afecta-historial');
  const sinAsignaciones = quitarAsignaciones(datos, id);
  return validarOLanzar({ ...sinAsignaciones, categorias: datos.categorias.filter((x) => x.id !== id) });
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
  if (desde.metaId || hacia.metaId) throw falla('La categoría de una meta de ahorro no se reasigna: usa Metas (mover los aportes a otra meta).', 'de-meta');
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

/** Valida un monto opcional (objetivo): vacío → null; si viene, entero en pesos mayor que cero y dentro del tope. */
function objetivoValido(v) {
  if (v === undefined || v === null) return null;
  if (!esPesosValido(v, { min: 1, max: MAX_PESOS })) throw falla(mensajePesos(v, 'El monto objetivo debe ser un entero en pesos mayor que cero (o déjalo vacío para un ahorro libre).'));
  return v;
}

function nombreDeMetaValido(datos, nombre, omitirId = null) {
  const n = typeof nombre === 'string' ? nombre.trim().replace(/\s+/g, ' ') : '';
  if (!n) throw falla('Escribe el nombre de la meta.', 'nombre-vacio');
  if (n.length > NOMBRE_MAX) throw falla(`El nombre es demasiado largo: máximo ${NOMBRE_MAX} caracteres (tiene ${n.length}).`, 'nombre-largo');
  const repetida = datos.metas.find((m) => m.id !== omitirId && claveNombre(m.nombre) === claveNombre(n));
  if (repetida) throw falla(`Ya tienes una meta llamada "${repetida.nombre}"${repetida.archivada ? ' (está archivada: restáurala)' : ''}. Elige otro nombre.`, 'nombre-repetido');
  return n;
}

/** Crea la categoría de Ahorro que es la "barra" de la meta en Presupuesto (campo `metaId`) y le asigna `monto` desde el ciclo actual. */
function crearBarraDeMeta(datos, meta, monto, ctx) {
  if (monto === undefined || monto === null) return datos;
  if (!esPesosValido(monto, { min: 1, max: MAX_PESOS })) throw falla(mensajePesos(monto, 'El monto mensual para presupuestar debe ser un entero en pesos mayor que cero.'));
  const nombre = nombreDeCategoriaValido(datos, meta.nombre);
  const barra = { id: ctx.generarId('cat'), nombre, tipo: 'gasto', grupo: 'ahorro', vinculo: null, icono: meta.icono, orden: siguienteOrden(datos.categorias), archivada: false, metaId: meta.id, creadaEn: ctx.hoy };
  return asignarDesdeCicloActual({ ...datos, categorias: [...datos.categorias, barra] }, barra.id, monto, ctx);
}

/**
 * Crea o edita una meta de ahorro. Alta: { nombre, icono?, color?, objetivo?, fechaLimite?, cuentaId? } y, aparte, `presupuestoMensual`
 * (pesos > 0): crea una categoría del grupo Ahorro con el nombre de la meta (campo `metaId`) y le asigna ese monto desde el ciclo actual,
 * para que la meta tenga su propia barra en Presupuesto; sus aportes consumen esa barra y no "Ahorro y metas" (una sola vez).
 * Sin `objetivo` es un ahorro libre (solo acumula); `fechaLimite` solo con objetivo. Al renombrarla o cambiarle el ícono se sincroniza su
 * barra; `presupuestoMensual` al editar solo crea la barra si todavía no la tiene.
 */
export function guardarMeta(datos, { meta, presupuestoMensual }, ctx) {
  if (!meta) throw falla('Falta la meta.');
  rechazarNumerosLargos(meta.nombre);
  if (meta.color !== undefined && meta.color !== null && !COLORES_META.includes(meta.color)) throw falla('Ese color no está disponible.');
  if (meta.id) {
    const previa = buscar(datos.metas, meta.id, 'La meta');
    const cambios = {};
    for (const k of ['nombre', 'objetivo', 'fechaLimite', 'icono', 'color', 'cuentaId']) if (meta[k] !== undefined) cambios[k] = meta[k];
    if (cambios.nombre !== undefined) cambios.nombre = nombreDeMetaValido(datos, cambios.nombre, previa.id);
    if (cambios.objetivo !== undefined) cambios.objetivo = objetivoValido(cambios.objetivo);
    const objetivo = cambios.objetivo !== undefined ? cambios.objetivo : previa.objetivo;
    if (objetivo === null) {
      if (cambios.fechaLimite !== undefined && cambios.fechaLimite !== null) throw falla('La fecha límite necesita un monto objetivo: escríbelo o quita la fecha.', 'fecha-sin-objetivo');
      cambios.fechaLimite = null; // al quedar libre, la fecha no tiene sentido
    } else if (cambios.fechaLimite !== undefined && cambios.fechaLimite !== null && !esFechaISO(cambios.fechaLimite)) throw falla('La fecha límite no es válida.');
    const nueva = { ...previa, ...cambios };
    let resultado = { ...datos, metas: reemplazarPorId(datos.metas, previa.id, () => nueva) };
    const barra = barraDeMeta(datos, previa.id);
    if (barra) {
      const nombre = nueva.nombre === barra.nombre ? barra.nombre : nombreDeCategoriaValido(datos, nueva.nombre, barra.id);
      resultado = { ...resultado, categorias: reemplazarPorId(resultado.categorias, barra.id, (c) => ({ ...c, nombre, icono: nueva.icono })) };
    } else resultado = crearBarraDeMeta(resultado, nueva, presupuestoMensual, ctx);
    return validarOLanzar(resultado);
  }
  const nombre = nombreDeMetaValido(datos, meta.nombre);
  const objetivo = objetivoValido(meta.objetivo);
  let fechaLimite = meta.fechaLimite ?? null;
  if (fechaLimite !== null) {
    if (objetivo === null) throw falla('La fecha límite necesita un monto objetivo: escríbelo o quita la fecha.', 'fecha-sin-objetivo');
    if (!esFechaISO(fechaLimite)) throw falla('La fecha límite no es válida.');
    if (fechaLimite < ctx.hoy) throw falla('La fecha límite no puede ser anterior a hoy.');
  }
  fechaLimite = objetivo === null ? null : fechaLimite;
  const nueva = {
    id: ctx.generarId('met'),
    nombre,
    objetivo,
    fechaLimite,
    cuentaId: meta.cuentaId ?? null,
    icono: meta.icono ?? 'escudo',
    creadaEn: ctx.hoy,
    archivada: false,
    ...(meta.color ? { color: meta.color } : {}),
  };
  return validarOLanzar(crearBarraDeMeta({ ...datos, metas: [...datos.metas, nueva] }, nueva, presupuestoMensual, ctx));
}

/**
 * Archiva o restaura una meta (y su barra de presupuesto). Archivada deja de ofrecerse y su monto mensual se quita de los ciclos FUTUROS (el
 * ciclo en curso conserva lo asignado, que ya tiene aportes); al restaurarla, el monto del último ciclo que lo tenía vuelve a los ciclos futuros.
 */
export function archivarMeta(datos, { id, archivada = true }, ctx) {
  buscar(datos.metas, id, 'La meta');
  const barra = barraDeMeta(datos, id);
  let resultado = { ...datos, metas: reemplazarPorId(datos.metas, id, (m) => ({ ...m, archivada })) };
  if (barra) {
    resultado = { ...resultado, categorias: reemplazarPorId(resultado.categorias, barra.id, (c) => ({ ...c, archivada })) };
    if (ctx) {
      const actual = estadoCiclo(datos, ctx.hoy).ciclo;
      const siguiente = cicloSiguiente(actual);
      if (archivada) resultado = quitarAsignaciones(resultado, barra.id, siguiente);
      else {
        const conMonto = Object.keys(datos.presupuestos).filter((c) => c <= actual && datos.presupuestos[c].asignaciones[barra.id] > 0).sort().pop();
        if (conMonto !== undefined) resultado = asignarDesdeCicloActual(resultado, barra.id, datos.presupuestos[conMonto].asignaciones[barra.id], ctx, siguiente);
      }
    }
  }
  return resultado;
}

/** Qué hay que decidir antes de eliminar una meta: aportes y retiros que tiene (para el texto de confirmación de la vista). */
export function usosDeMeta(datos, id) {
  const movs = datos.movimientos.filter((m) => m.metaId === id);
  return { movimientos: movs.length, aportes: movs.filter((m) => m.tipo === 'aporteMeta').length, retiros: movs.filter((m) => m.tipo === 'retiroMeta').length, barra: barraDeMeta(datos, id) !== null };
}

/**
 * Elimina una meta. Sin aportes ni retiros se borra tal cual (y su barra de presupuesto). Con ellos exige `destinoId` (otra meta activa):
 * los movimientos pasan a esa meta y consumen la categoría de la meta destino (nunca quedan huérfanos); si no hay destino se rechaza y el
 * mensaje ofrece archivar. RU-07: la barra eliminada se quita del ciclo actual y de los futuros. Si la meta tiene aportes o retiros de un ciclo YA
 * CERRADO, o su barra tiene un monto asignado en uno, no se elimina (moverlos o quitar la barra reescribiría lo que ese ciclo mostraba, p. ej. una
 * alerta nueva): se ofrece archivarla.
 */
export function borrarMeta(datos, { id, destinoId = null }, ctx) {
  buscar(datos.metas, id, 'La meta');
  const u = usosDeMeta(datos, id);
  if (ctx && ctx.hoy) {
    const est = estadoCiclo(datos, ctx.hoy);
    const barraMeta = barraDeMeta(datos, id);
    const cerrados = barraMeta ? ciclosCerradosConMonto(datos, barraMeta.id, ctx.hoy) : [];
    const aportesCerrados = datos.movimientos.some((m) => m.metaId === id && m.fecha < est.rango.inicio);
    if (cerrados.length || aportesCerrados) throw falla('Esta meta tiene aportes o presupuesto en ciclos que ya cerraron y conservan lo que mostraban: eliminarla los cambiaría. Archívala: deja de ofrecerse y se conserva todo.', 'afecta-historial');
  }
  let movimientos = datos.movimientos;
  if (u.movimientos > 0) {
    if (!destinoId) throw falla(`Esta meta tiene ${u.movimientos} aporte${u.movimientos === 1 ? '' : 's'} o retiro${u.movimientos === 1 ? '' : 's'}: elige otra meta para moverlos o archívala (se conservan).`, 'con-aportes');
    if (destinoId === id) throw falla('Elige una meta de destino distinta.');
    const destino = buscar(datos.metas, destinoId, 'La meta de destino');
    if (destino.archivada) throw falla('La meta de destino está archivada: elige una activa.');
    const categoriaId = categoriaDeMeta(datos, destinoId)?.id;
    if (!categoriaId) throw falla('No hay una categoría de ahorro para la meta de destino.');
    movimientos = datos.movimientos.map((m) => (m.metaId === id ? { ...m, metaId: destinoId, categoriaId } : m));
  }
  const barra = barraDeMeta(datos, id);
  let resultado = { ...datos, movimientos, metas: datos.metas.filter((m) => m.id !== id) };
  if (barra) resultado = { ...quitarAsignaciones(resultado, barra.id), categorias: datos.categorias.filter((c) => c.id !== barra.id) };
  return validarOLanzar(resultado);
}
