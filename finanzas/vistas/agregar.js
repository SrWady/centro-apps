/*
 * agregar.js — hoja inferior "Agregar movimiento" con teclado numérico propio (registro en ≤ 5 s y ≤ 6 toques).
 * También edita movimientos existentes y registra pagos de deuda, aportes a metas, ajustes y "Marcar pagado".
 *
 * Uso: abrirFormulario(ctx, { movimiento?, tipo?, preset?, origen?, titulo? })
 *  - sin movimiento: crea (tipo 'gasto' por omisión). Con `origen` ({tipo,id,ocurrencia}) registra un pago programado
 *    con la acción marcarPagado (la fecha programada queda en origen.ocurrencia).
 *  - con movimiento: edita (y permite eliminar).
 */
import { h, icono, ejecutar, haptic, mostrarAviso, boton, abrirSelector, pedirMonto, pedirFecha, pedirTexto, pesos, fechaCorta, diaMes, segmentado, GRUPOS_TITULO, confirmarSaldoNegativo, confirmarRiesgo, frasesDeAvisoSaldo, teclaDeMonto, DIGITOS_TECLADO_MONTO, mensajeTopeMonto, pasaTopeMonto, cuentasPorTipo, TIPOS_CUENTA_INFO } from './comun.js';
import { abrirHoja, confirmar } from '../../shared/ui/hoja.js';
import { crearTeclado, formatoTecleado } from '../../shared/ui/teclado.js';
import { agregarMovimiento, editarMovimiento, borrarMovimiento, marcarPagado, avisosDeSaldo } from '../logica/acciones.js';
import { fechaPorDefecto } from '../logica/periodo.js';
import { ahorrado, categoriaParaAporte } from '../logica/metas.js';
import { calcularSaldos } from '../logica/saldos.js';
import { interesPeriodo } from '../logica/deudas.js';
import { tasaMensual } from '../logica/tasas.js';
import { sumarDias } from '../../shared/lib/fechas.js';

const TIPOS_BASICOS = ['gasto', 'ingreso', 'transferencia', 'aporteMeta'];
const TITULOS = {
  gasto: 'Agregar gasto', ingreso: 'Agregar ingreso', transferencia: 'Transferir', pagoDeuda: 'Registrar pago de deuda',
  aporteMeta: 'Aportar a una meta', retiroMeta: 'Retirar de una meta', ajusteCuenta: 'Ajustar saldo de cuenta', ajusteDeuda: 'Ajustar saldo de deuda',
};
const GUARDADO = {
  gasto: 'Gasto guardado', ingreso: 'Ingreso guardado', transferencia: 'Transferencia guardada', pagoDeuda: 'Pago registrado',
  aporteMeta: 'Aporte registrado', retiroMeta: 'Retiro registrado', ajusteCuenta: 'Ajuste guardado', ajusteDeuda: 'Ajuste guardado',
};

const noArchivada = (x) => !x.archivada;
const esCredito = (c) => c.tipo === 'credito';

/** RU-08: cuántas categorías nuevas (creadas por el usuario y todavía sin ningún movimiento) se ofrecen PRIMERO en la hoja "+": las 3 más recientes. */
export const MAX_CATEGORIAS_NUEVAS_PRIMERO = 3;
/** Cuántos chips de categoría se ven sin tocar "Más". */
export const CHIPS_CATEGORIA_VISIBLES = 6;

/**
 * Categorías del tipo dado (sin vínculo ni barra de meta, no archivadas) en el orden de la hoja "+":
 *  1. Las categorías NUEVAS sin uso van primero, pero solo hasta 3 (MAX_CATEGORIAS_NUEVAS_PRIMERO): las 3 más recientes (por `creadaEn` y, a igual
 *     fecha, la creada después). "Nueva sin uso" = la creó el usuario (tiene `creadaEn`) y todavía no tiene NINGÚN movimiento ni pago recurrente, de
 *     cualquier fecha: sin plazo en días (ya no se hunde a los 30 días tras "Más"); deja de ser nueva en cuanto se usa.
 *  2. El resto, por uso en los últimos 90 días (y luego sin pago recurrente activo, y por `orden`).
 * Con 6 chips visibles, las nuevas nunca desplazan a las 3 más usadas: ocupan a lo sumo 3 lugares y quedan al menos 3 por uso. Antes (ronda A),
 * TODAS las nuevas iban primero: crear 7 categorías escondía tras "Más" la más usada (RU-08).
 */
export function categoriasPorUso(datos, tipo, hoy) {
  const desde = sumarDias(hoy, -90);
  const usos = {};
  const usadas = new Set();
  for (const m of datos.movimientos) {
    if (m.categoriaId) usadas.add(m.categoriaId);
    if (m.tipo === tipo && m.fecha >= desde) usos[m.categoriaId] = (usos[m.categoriaId] ?? 0) + 1;
  }
  const conRecurrente = new Set(datos.recurrentes.filter((r) => r.activo).map((r) => r.categoriaId)); // sin historial de uso, primero las que NO tienen un recurrente activo (esos se marcan con "Pagado")
  const lista = datos.categorias.filter((c) => c.tipo === tipo && c.vinculo === null && !c.metaId && noArchivada(c));
  const nuevas = lista
    .filter((c) => c.creadaEn !== undefined && !usadas.has(c.id) && !conRecurrente.has(c.id))
    .sort((a, b) => (a.creadaEn < b.creadaEn ? 1 : a.creadaEn > b.creadaEn ? -1 : b.orden - a.orden))
    .slice(0, MAX_CATEGORIAS_NUEVAS_PRIMERO);
  const primeras = new Set(nuevas.map((c) => c.id));
  const resto = lista
    .filter((c) => !primeras.has(c.id))
    .sort((a, b) => (usos[b.id] ?? 0) - (usos[a.id] ?? 0) || Number(conRecurrente.has(a.id)) - Number(conRecurrente.has(b.id)) || a.orden - b.orden);
  return [...nuevas, ...resto];
}

function estadoInicial(datos, hoy, prefs, o) {
  const m = o.movimiento;
  if (m) {
    return {
      tipo: m.tipo, monto: Math.abs(m.monto), signo: m.monto < 0 ? -1 : 1, categoriaId: m.categoriaId ?? null, cuentaId: m.cuentaId ?? null,
      cuentaDestinoId: m.cuentaDestinoId ?? null, fecha: m.fecha, nota: m.nota ?? '', deudaId: m.deudaId ?? null, metaId: m.metaId ?? null,
      interes: m.interes ?? 0, modo: m.tipo === 'pagoDeuda' ? (datos.categorias.find((c) => c.id === m.categoriaId)?.vinculo === 'abono-deudas' ? 'abono' : 'cuota') : null,
      origen: m.origen ?? null, interesManual: true,
    };
  }
  return {
    tipo: o.tipo ?? 'gasto', monto: 0, signo: 1, categoriaId: null, cuentaId: null, cuentaDestinoId: null, fecha: fechaPorDefecto(datos, hoy), nota: '',
    deudaId: null, metaId: null, interes: 0, modo: 'cuota', origen: null, interesManual: false, ...(o.preset ?? {}),
  };
}

/** Completa lo que falte según el tipo (cuenta/categoría recordadas, primeras opciones válidas). */
function completar(est, datos, hoy, prefs) {
  const cuentas = datos.cuentas.filter(noArchivada);
  const sinCredito = cuentas.filter((c) => !esCredito(c));
  const ing = datos.ajustes.ingreso;
  const valida = (id, lista) => lista.some((x) => x.id === id);
  const recordada = (lista) => (valida(prefs.ultimaCuentaId, lista) ? prefs.ultimaCuentaId : valida(ing.cuentaId, lista) ? ing.cuentaId : lista[0]?.id ?? null);
  if (est.tipo === 'gasto') {
    const cats = categoriasPorUso(datos, 'gasto', hoy);
    if (!valida(est.categoriaId, datos.categorias.filter((c) => c.tipo === 'gasto'))) est.categoriaId = valida(prefs.ultimaCategoriaId, cats) ? prefs.ultimaCategoriaId : cats[0]?.id ?? null;
    if (!valida(est.cuentaId, datos.cuentas)) est.cuentaId = recordada(cuentas);
  } else if (est.tipo === 'ingreso') {
    if (!valida(est.categoriaId, datos.categorias.filter((c) => c.tipo === 'ingreso'))) est.categoriaId = ing.categoriaId;
    if (!valida(est.cuentaId, sinCredito)) est.cuentaId = recordada(sinCredito);
  } else if (est.tipo === 'transferencia') {
    if (!valida(est.cuentaId, sinCredito)) est.cuentaId = recordada(sinCredito);
    if (!valida(est.cuentaDestinoId, sinCredito) || est.cuentaDestinoId === est.cuentaId) est.cuentaDestinoId = sinCredito.find((c) => c.id !== est.cuentaId)?.id ?? null;
  } else if (est.tipo === 'pagoDeuda') {
    const deudas = datos.deudas.filter(noArchivada);
    if (!valida(est.deudaId, datos.deudas)) est.deudaId = deudas[0]?.id ?? null;
    if (!valida(est.cuentaId, sinCredito)) est.cuentaId = recordada(sinCredito);
    const vinculo = est.modo === 'abono' ? 'abono-deudas' : 'cuotas-deudas';
    est.categoriaId = datos.categorias.find((c) => c.vinculo === vinculo)?.id ?? null;
  } else if (est.tipo === 'aporteMeta' || est.tipo === 'retiroMeta') {
    const metas = datos.metas.filter(noArchivada);
    if (!valida(est.metaId, datos.metas)) est.metaId = metas[0]?.id ?? null;
    if (!valida(est.cuentaId, sinCredito)) est.cuentaId = recordada(sinCredito);
    if (est.cuentaDestinoId && (!valida(est.cuentaDestinoId, sinCredito) || est.cuentaDestinoId === est.cuentaId)) est.cuentaDestinoId = null;
    est.categoriaId = categoriaParaAporte(datos, est.metaId, est.categoriaId); // la barra propia de la meta o "Ahorro y metas"
  } else if (est.tipo === 'ajusteCuenta') {
    if (!valida(est.cuentaId, sinCredito)) est.cuentaId = recordada(sinCredito);
  } else if (est.tipo === 'ajusteDeuda') {
    if (!valida(est.deudaId, datos.deudas)) est.deudaId = datos.deudas.filter(noArchivada)[0]?.id ?? null;
  }
  return est;
}

/**
 * Interés propuesto para un pago de deuda (editable). R2F-07: un ABONO EXTRA va 100 % a capital (como en el simulador, ESQUEMA §6.5):
 * se propone interés 0. Antes proponía el interés de un mes completo sobre el saldo y, si la cuota del mes ya había pagado ese
 * interés, el mes cobraba dos veces (y "Ahorro y metas ejecutado" bajaba). La CUOTA propone el interés del período sobre el saldo
 * A HOY (como `marcarPagado` y Próximos pagos), no sobre el saldo a fin de los tiempos.
 */
export function interesSugerido(est, datos, hoy) {
  if (est.modo === 'abono') return 0;
  const deuda = datos.deudas.find((d) => d.id === est.deudaId);
  if (!deuda) return 0;
  const saldo = calcularSaldos(datos, hoy).deudas[deuda.id];
  const i = tasaMensual(deuda.tasa ?? null);
  return Math.min(est.monto, interesPeriodo(Math.max(0, saldo), i));
}

function movimientoDesdeEstado(est, ctx) {
  const base = { tipo: est.tipo, fecha: est.fecha, nota: est.nota };
  const monto = est.monto;
  switch (est.tipo) {
    case 'gasto': case 'ingreso': return { ...base, monto, cuentaId: est.cuentaId, categoriaId: est.categoriaId };
    case 'transferencia': return { ...base, monto, cuentaId: est.cuentaId, cuentaDestinoId: est.cuentaDestinoId };
    case 'pagoDeuda': return { ...base, monto, cuentaId: est.cuentaId, deudaId: est.deudaId, categoriaId: est.categoriaId, interes: Math.min(est.interes, monto) };
    case 'aporteMeta': case 'retiroMeta': return { ...base, monto, metaId: est.metaId, cuentaId: est.cuentaId, cuentaDestinoId: est.cuentaDestinoId ?? null, categoriaId: est.categoriaId };
    case 'ajusteCuenta': return { ...base, monto: monto * est.signo, cuentaId: est.cuentaId };
    case 'ajusteDeuda': return { ...base, monto: monto * est.signo, deudaId: est.deudaId };
    default: return base;
  }
}

/**
 * Ronda del usuario B: una línea que dice qué pasa con el saldo según la cuenta elegida (cada cuenta es un método de pago).
 * Gasto con tarjeta de crédito: sube su deuda; gasto en otra cuenta: baja su saldo; ingreso: sube el saldo; transferencia: lo disponible en el origen.
 */
export function pistaDeCuenta(datos, est, hoy) {
  const cuenta = datos.cuentas.find((c) => c.id === est.cuentaId);
  if (!cuenta) return null;
  const s = calcularSaldos(datos, hoy);
  if (est.tipo === 'transferencia') return `${cuenta.nombre} tiene ${pesos(s.cuentas[cuenta.id])} disponibles para transferir.`;
  if (est.tipo === 'ingreso') return `Sube el saldo de ${cuenta.nombre} (hoy ${pesos(s.cuentas[cuenta.id])}).`;
  if (est.tipo !== 'gasto') return null;
  if (cuenta.tipo === 'credito') return `Compra con tarjeta: sube tu deuda (hoy ${pesos(s.deudas[cuenta.deudaId])}), no baja ninguna cuenta. Págala después con "Pagar tarjeta".`;
  return `Baja el saldo de ${cuenta.nombre} (hoy ${pesos(s.cuentas[cuenta.id])}).`;
}

/** Abre la hoja. Devuelve el control de la hoja (cerrar()). */
export function abrirFormulario(ctx, opciones = {}) {
  const datos0 = ctx.tienda.datos();
  const hoy = ctx.reloj.hoy();
  const prefs = ctx.preferencias.leer();
  const editando = opciones.movimiento ?? null;
  const origenProgramado = opciones.origen ?? null; // pago programado (Marcar pagado)
  const est = completar(estadoInicial(datos0, hoy, prefs, opciones), datos0, hoy, prefs);
  if (origenProgramado) est.origen = origenProgramado;
  if (!editando && est.tipo === 'pagoDeuda' && !est.interesManual) est.interes = Math.min(est.interes, est.monto);
  // R1F-07: un movimiento que viene de un pago programado (origen) no cambia de tipo ni de deuda: se ocultan esos selectores.
  const tiposVisibles = origenProgramado ? null : editando ? (TIPOS_BASICOS.includes(est.tipo) && est.tipo !== 'aporteMeta' && !est.origen ? TIPOS_BASICOS : null) : opciones.tipo && !TIPOS_BASICOS.includes(opciones.tipo) ? null : TIPOS_BASICOS;

  const datos = () => ctx.tienda.datos();
  const cuentaNombre = (id) => datos().cuentas.find((c) => c.id === id)?.nombre ?? 'Elegir';
  const nombreDeuda = (id) => datos().deudas.find((d) => d.id === id)?.nombre ?? 'Elegir';
  const nombreMeta = (id) => datos().metas.find((m) => m.id === id)?.nombre ?? 'Elegir';

  // --- Zona de monto (persistente) ---
  const valorEl = h('span', { class: 'amount__value is-empty' }, '0');
  const pintarMonto = () => { valorEl.textContent = est.monto ? formatoTecleado(String(est.monto)) : '0'; valorEl.classList.toggle('is-empty', !est.monto); };
  const teclado = crearTeclado({
    maxDigitos: DIGITOS_TECLADO_MONTO, teclado: false, valor: est.monto ? String(est.monto) : '',
    alCambiar: (v) => {
      if (pasaTopeMonto(v)) { haptic('warning'); teclado.fijar(est.monto ? String(est.monto) : ''); mostrarAviso(mensajeTopeMonto(), { tipo: 'warn' }); return; } // R1F-19: nunca sobre el tope (p. ej. con la tecla "000"); N3-04: se rechaza entero y se dice el máximo
      est.monto = v ? Number(v) : 0;
      pintarMonto();
      if (est.tipo === 'pagoDeuda' && !est.interesManual) { est.interes = interesSugerido(est, datos(), hoy); pintarInteres(); }
    },
  });
  pintarMonto();

  const zonaTipo = h('div');
  const zonaCampos = h('div', { class: 'stack' });
  const cuerpo = h('div', { class: 'sheet__body stack' },
    zonaTipo,
    h('div', { class: 'amount', aria: { live: 'polite', label: 'Monto' } }, h('span', { class: 'amount__currency' }, '$'), valorEl),
    zonaCampos,
    h('div', { 'data-numpad': '' }, teclado.el));

  // N-03 / R2F-16: un ingreso programado (el salario) se "recibe", no se "paga".
  let textoGuardar = editando ? 'Guardar cambios' : origenProgramado ? (est.tipo === 'ingreso' ? 'Marcar recibido' : 'Marcar pagado') : opciones.guardarTexto ?? 'Guardar';
  const btnGuardar = boton('', { icono: 'check', clase: 'btn--lg btn--block', onClick: () => guardar() });
  const pintarBoton = () => { btnGuardar.replaceChildren(icono('check'), document.createTextNode(` ${editando || origenProgramado ? textoGuardar : `Guardar ${est.tipo === 'gasto' ? 'gasto' : est.tipo === 'ingreso' ? 'ingreso' : est.tipo === 'transferencia' ? 'transferencia' : est.tipo === 'aporteMeta' ? 'aporte' : ''}`.trim()}`)); };
  const btnEliminar = editando ? boton('Eliminar', { icono: 'trash', clase: 'btn--danger-ghost', onClick: () => eliminar() }) : null;
  const pie = h('div', { class: 'sheet__foot' }, btnEliminar, btnGuardar);
  const hoja = abrirHoja([cuerpo, pie], { titulo: opciones.titulo ?? (editando ? 'Editar movimiento' : TITULOS[est.tipo]), alCerrar: () => teclado.destruir() });

  // Teclado físico (solo si el foco no está en un campo de texto): sin esto, escribir en "Nota" alteraría el monto.
  const fisico = { coma: false };
  hoja.panel.addEventListener('keydown', (ev) => {
    const t = ev.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    // R1F-13/R1F-19: mismo tope que el teclado en pantalla. R2F-06: una coma empieza los decimales; los ceros que siguen se descartan
    // (antes "1234567,00" sumaba dos ceros y daba 123.456.700) y un dígito distinto de cero se rechaza (pesos enteros).
    const r = teclaDeMonto(fisico, est.monto, ev.key);
    if (r.aviso) mostrarAviso(r.aviso, { tipo: 'warn' });
    if (r.digitos !== null) teclado.fijar(r.digitos);
  });

  // --- Chips ---
  const chip = (texto, { icono: ic, onClick, presionado, etiqueta, fin } = {}) => h('button', {
    class: 'chip', type: 'button', aria: { pressed: presionado === undefined ? undefined : String(presionado), label: etiqueta }, on: onClick ? { click: onClick } : undefined, // H-02: un chip informativo (sin acción) no lleva manejador: h() lanza si no es función
  }, ic ? icono(ic) : null, texto, fin ? icono(fin) : null);
  const fila = (etiqueta, chips, envolver = false) => h('div', { class: `chip-row${envolver ? ' chip-row--wrap' : ''}`, role: 'group', aria: { label: etiqueta } }, chips);

  async function elegirCuenta(campo, { sinCredito = false, titulo = 'Cuenta', permitirNinguna = false } = {}) {
    const s = calcularSaldos(datos(), hoy);
    // Ronda del usuario B: cada cuenta es un método de pago; se muestran todas las activas agrupadas por tipo (Efectivo, Ahorros, Débito, Billetera, Tarjeta).
    const opciones = cuentasPorTipo(datos().cuentas.filter((c) => !c.archivada && (!sinCredito || !esCredito(c))))
      .map((c) => ({ valor: c.id, titulo: c.nombre, icono: c.icono, color: c.color, grupo: TIPOS_CUENTA_INFO[c.tipo]?.grupo, sub: esCredito(c) && est.tipo === 'gasto' ? 'La compra sube tu deuda' : undefined, fin: pesos(esCredito(c) ? -s.deudas[c.deudaId] : s.cuentas[c.id]) }));
    if (permitirNinguna) opciones.unshift({ valor: '', titulo: 'Misma cuenta (solo apartar)', sub: 'El dinero queda apartado sin moverse', icono: 'escudo' });
    const v = await abrirSelector({ titulo, opciones, seleccionado: est[campo] ?? '' });
    if (v === undefined) return;
    if (est.tipo === 'transferencia' && v !== '') {
      // Ronda del usuario B: en una transferencia el destino no puede ser el origen. Elegir el origen como destino se avisa (no se cambia nada
      // en silencio); elegir como origen la cuenta que era el destino las intercambia.
      if (campo === 'cuentaDestinoId' && v === est.cuentaId) { haptic('error'); mostrarAviso('La cuenta de destino debe ser distinta de la de origen. Elige otra o usa "Invertir".', { tipo: 'warn' }); return; }
      if (campo === 'cuentaId' && v === est.cuentaDestinoId) est.cuentaDestinoId = est.cuentaId;
    }
    est[campo] = v === '' ? null : v;
    if ((campo === 'cuentaId' || campo === 'cuentaDestinoId') && est.cuentaId && est.cuentaId === est.cuentaDestinoId) est.cuentaDestinoId = null;
    completar(est, datos(), hoy, prefs);
    dibujarCampos();
  }
  async function elegirCategoria() {
    const cats = datos().categorias.filter((c) => c.tipo === est.tipo && c.vinculo === null && !c.metaId && !c.archivada).sort((a, b) => a.orden - b.orden);
    const opciones = cats.map((c) => ({ valor: c.id, titulo: c.nombre, sub: c.grupo ? GRUPOS_TITULO[c.grupo] : undefined, icono: c.icono }));
    const v = await abrirSelector({ titulo: 'Categoría', opciones, seleccionado: est.categoriaId });
    if (v !== undefined) { est.categoriaId = v; dibujarCampos(); }
  }
  async function elegirFecha() {
    const d = datos();
    const minimo = d.cuentas.reduce((m, c) => (c.fechaSaldoInicial && (m === null || c.fechaSaldoInicial < m) ? c.fechaSaldoInicial : m), null);
    const v = await pedirFecha({ titulo: 'Fecha del movimiento', valor: est.fecha, min: minimo ?? undefined, atajos: [{ titulo: 'Hoy', valor: fechaPorDefecto(d, hoy) }, { titulo: 'Ayer', valor: sumarDias(fechaPorDefecto(d, hoy), -1) }] });
    if (v) { est.fecha = v; dibujarCampos(); }
  }
  async function elegirNota() {
    const v = await pedirTexto({ titulo: 'Nota', valor: est.nota, etiqueta: est.tipo.startsWith('ajuste') ? 'Motivo del ajuste (obligatorio)' : 'Nota (opcional)', placeholder: 'Ej.: D1 y fruver', obligatorio: est.tipo.startsWith('ajuste') });
    if (v !== null) { est.nota = v; dibujarCampos(); }
  }
  async function elegirDeuda() {
    const s = calcularSaldos(datos(), '9999-12-31');
    const v = await abrirSelector({ titulo: 'Deuda', opciones: datos().deudas.filter(noArchivada).map((d) => ({ valor: d.id, titulo: d.nombre, sub: d.entidad || undefined, icono: 'deuda', fin: pesos(s.deudas[d.id]) })), seleccionado: est.deudaId });
    if (v !== undefined) { est.deudaId = v; if (!est.interesManual) est.interes = interesSugerido(est, datos(), hoy); dibujarCampos(); }
  }
  async function elegirMeta() {
    const d = datos();
    const v = await abrirSelector({ titulo: 'Meta de ahorro', opciones: d.metas.filter(noArchivada).map((m) => ({ valor: m.id, titulo: m.nombre, sub: m.objetivo === null ? 'Ahorro libre' : `Objetivo ${pesos(m.objetivo)}`, icono: m.icono, fin: pesos(ahorrado(d, m.id, hoy)) })), seleccionado: est.metaId, vacio: 'Aún no tienes metas de ahorro.' });
    if (v !== undefined) { est.metaId = v; est.categoriaId = categoriaParaAporte(datos(), v, null); dibujarCampos(); }
  }
  async function elegirInteres() {
    const v = await pedirMonto({ titulo: 'Interés incluido en el pago', mensaje: 'Del extracto: la parte del pago que son intereses. El resto baja el saldo de la deuda.', inicial: est.interes, textoGuardar: 'Listo' });
    if (v !== null) { est.interes = Math.min(v, est.monto || v); est.interesManual = true; dibujarCampos(); }
  }

  const chipFecha = () => chip(est.fecha === hoy ? `Hoy, ${diaMes(est.fecha)}` : fechaCorta(est.fecha), { icono: 'calendar', onClick: elegirFecha, etiqueta: `Fecha: ${est.fecha}` });
  const chipNota = () => chip(est.nota ? (est.nota.length > 18 ? `${est.nota.slice(0, 18)}…` : est.nota) : 'Nota', { icono: 'note', onClick: elegirNota, etiqueta: 'Nota' });
  const chipCuenta = (campo, prefijo, opts) => { const c = datos().cuentas.find((x) => x.id === est[campo]); return chip(`${prefijo ? `${prefijo} ` : ''}${est[campo] ? cuentaNombre(est[campo]) : 'Ninguna'}`, { icono: c?.icono ?? 'banco', fin: 'chevron-down', onClick: () => elegirCuenta(campo, opts), etiqueta: `${prefijo || 'Cuenta'}: ${est[campo] ? cuentaNombre(est[campo]) : 'ninguna'}` }); };

  let interesChip = null;
  function pintarInteres() { if (interesChip) interesChip.replaceChildren(icono('trend'), document.createTextNode(`Interés ${pesos(est.interes)}`)); }

  // R1F-12 / F7: al elegir en una hoja anidada o pulsar un chip, el control con foco se reemplaza y el foco cae en <body>:
  // Esc dejaba de cerrar la hoja y los dígitos del teclado físico no llegaban al monto. Se devuelve a la hoja.
  function devolverFoco() {
    if (hoja.panel.isConnected && !hoja.panel.contains(document.activeElement)) hoja.panel.focus({ preventScroll: true });
  }

  function dibujarCampos() {
    zonaCampos.replaceChildren();
    const d = datos();
    const filas = [];
    if (est.tipo === 'gasto' || est.tipo === 'ingreso') {
      const todas = categoriasPorUso(d, est.tipo, hoy);
      const visibles = todas.slice(0, CHIPS_CATEGORIA_VISIBLES);
      if (est.categoriaId && !visibles.some((c) => c.id === est.categoriaId)) { const sel = d.categorias.find((c) => c.id === est.categoriaId); if (sel) visibles.unshift(sel); }
      filas.push(fila('Categoría', [
        ...visibles.map((c) => chip(c.nombre, { icono: c.icono, presionado: c.id === est.categoriaId, onClick: () => { est.categoriaId = c.id; dibujarCampos(); haptic('select'); } })),
        ...(todas.length > visibles.length ? [chip('Más', { icono: 'more', onClick: elegirCategoria, etiqueta: 'Más categorías' })] : []),
      ]));
      filas.push(fila('Cuenta, fecha y nota', [chipCuenta('cuentaId', '', { sinCredito: est.tipo === 'ingreso', titulo: est.tipo === 'gasto' ? '¿Con qué pagas?' : '¿En qué cuenta entra?' }), chipFecha(), chipNota()]));
      const pista = pistaDeCuenta(d, est, hoy);
      if (pista) filas.push(h('p', { class: 'field__hint' }, pista));
    } else if (est.tipo === 'transferencia') {
      filas.push(fila('Cuentas', [chipCuenta('cuentaId', 'De', { sinCredito: true, titulo: 'Cuenta de origen' }), chipCuenta('cuentaDestinoId', 'A', { sinCredito: true, titulo: 'Cuenta de destino' })], true));
      filas.push(fila('Fecha, nota e invertir', [chipFecha(), chipNota(), chip('Invertir', { icono: 'swap', onClick: () => { const o = est.cuentaId; est.cuentaId = est.cuentaDestinoId; est.cuentaDestinoId = o; dibujarCampos(); haptic('select'); }, etiqueta: 'Invertir origen y destino' })]));
      if (!est.cuentaDestinoId) filas.push(h('p', { class: 'field__hint' }, 'Para transferir necesitas al menos dos cuentas (sin contar tarjetas). Agrega otra en Cuentas.')); // R1F-21b
      else {
        const pista = pistaDeCuenta(d, est, hoy);
        if (pista) filas.push(h('p', { class: 'field__hint' }, pista));
        filas.push(h('p', { class: 'field__hint' }, '¿Quieres pagar una tarjeta de crédito? Usa "Pagar tarjeta" en Cuentas o en Deudas.'));
        filas.push(h('p', { class: 'field__hint' }, 'Si transfieres más de lo que la app tiene registrado en la cuenta de origen, te avisamos antes de guardar y puedes continuar.')); // RU-03
      }
    } else if (est.tipo === 'pagoDeuda') {
      if (!editando || origenProgramado) {
        filas.push(segmentado({ etiqueta: 'Tipo de pago', valor: est.modo, opciones: [{ valor: 'cuota', titulo: 'Cuota' }, { valor: 'abono', titulo: 'Abono extra' }], alCambiar: (v) => { est.modo = v; est.interesManual = false; est.interes = interesSugerido(est, datos(), hoy); completar(est, datos(), hoy, prefs); dibujarCampos(); } })); // R2F-07: al cambiar de cuota a abono el interés propuesto se recalcula (abono: 0)
      }
      interesChip = chip(`Interés ${pesos(est.interes)}`, { icono: 'trend', onClick: elegirInteres, etiqueta: 'Interés incluido' });
      filas.push(fila('Deuda y cuenta', [origenProgramado || est.origen ? chip(nombreDeuda(est.deudaId), { icono: 'deuda' }) : chip(nombreDeuda(est.deudaId), { icono: 'deuda', fin: 'chevron-down', onClick: elegirDeuda }), chipCuenta('cuentaId', 'Desde', { sinCredito: true })]));
      filas.push(fila('Interés, fecha y nota', [interesChip, chipFecha(), chipNota()]));
    } else if (est.tipo === 'aporteMeta' || est.tipo === 'retiroMeta') {
      const metaElegida = d.metas.find((m) => m.id === est.metaId);
      if (!d.metas.some(noArchivada)) {
        filas.push(h('div', { class: 'callout callout--accent' }, icono('info'), h('div', null, h('span', { class: 'callout__title' }, 'Aún no tienes metas de ahorro'), h('br'), 'Crea una (Viaje, Vehículo, Fondo de emergencia…) para poder aportarle.'), h('button', { class: 'btn btn--secondary btn--sm callout__action', type: 'button', on: { click: () => { hoja.cerrar(); location.hash = '#/metas'; } } }, 'Crear meta')));
      }
      filas.push(fila('Meta y cuentas', [chip(nombreMeta(est.metaId), { icono: metaElegida?.icono ?? 'escudo', fin: 'chevron-down', onClick: elegirMeta, etiqueta: `Meta: ${nombreMeta(est.metaId)}` }), chipCuenta('cuentaId', est.tipo === 'aporteMeta' ? 'Desde' : 'De', { sinCredito: true })]));
      filas.push(fila('Destino del dinero', [chip(est.cuentaDestinoId ? `Mover a ${cuentaNombre(est.cuentaDestinoId)}` : 'Solo apartar (misma cuenta)', { icono: 'swap', fin: 'chevron-down', onClick: () => elegirCuenta('cuentaDestinoId', { sinCredito: true, titulo: 'Mover el dinero a', permitirNinguna: true }) })]));
      filas.push(fila('Fecha y nota', [chipFecha(), chipNota()]));
    } else if (est.tipo === 'ajusteCuenta' || est.tipo === 'ajusteDeuda') {
      filas.push(segmentado({ etiqueta: 'Sentido del ajuste', valor: est.signo, opciones: est.tipo === 'ajusteCuenta' ? [{ valor: 1, titulo: 'Suma al saldo' }, { valor: -1, titulo: 'Resta al saldo' }] : [{ valor: 1, titulo: 'Sube la deuda' }, { valor: -1, titulo: 'Baja la deuda' }], alCambiar: (v) => { est.signo = v; dibujarCampos(); } }));
      filas.push(fila('Cuenta o deuda', [est.tipo === 'ajusteCuenta' ? chipCuenta('cuentaId', '', { sinCredito: true }) : chip(nombreDeuda(est.deudaId), { icono: 'deuda', fin: 'chevron-down', onClick: elegirDeuda })]));
      filas.push(fila('Fecha y motivo', [chipFecha(), chipNota()]));
    }
    zonaCampos.append(...filas);
    pintarBoton();
    devolverFoco();
  }

  function dibujarTipo() {
    zonaTipo.replaceChildren();
    if (!tiposVisibles) return;
    const nombres = { gasto: 'Gasto', ingreso: 'Ingreso', transferencia: 'Transferencia', aporteMeta: 'Ahorro' };
    zonaTipo.append(segmentado({ etiqueta: 'Tipo de movimiento', valor: est.tipo, opciones: tiposVisibles.map((t) => ({ valor: t, titulo: nombres[t] })), alCambiar: (t) => { est.tipo = t; est.categoriaId = null; completar(est, datos(), hoy, prefs); dibujarTipo(); dibujarCampos(); } }));
    devolverFoco();
  }

  // H-01: dos toques seguidos en "Guardar" creaban dos movimientos (la hoja tarda ~300 ms en cerrarse). Mientras se guarda el
  // botón queda deshabilitado y la función ignora llamadas repetidas; solo se rehabilita si el guardado FALLA.
  let guardando = false;
  async function guardar() {
    if (guardando) return;
    guardando = true;
    btnGuardar.disabled = true;
    let guardado = false;
    try {
      // RU-03 / RU-04: una transferencia, un aporte que mueve dinero o un pago de deuda que deja una cuenta en negativo NO se bloquea: se pregunta
      // antes de guardar ("Esta cuenta quedará en −$ X (hoy tiene $ Y). ¿Continuar?"). "Cancelar" vuelve a la hoja con todo como estaba.
      if (revisarCampos()) {
        const avisos = avisosPrevios();
        if (avisos.length && !(await confirmarSaldoNegativo(avisos, hoy))) return;
      }
      guardado = intentarGuardar();
    } finally { if (!guardado) { guardando = false; btnGuardar.disabled = false; } }
  }

  /** Tipos de movimiento cuyo guardado se revisa contra el saldo (los gastos no: la app permite registrar un gasto aunque el saldo no esté al día). */
  const TIPOS_CON_AVISO_DE_SALDO = ['transferencia', 'aporteMeta', 'retiroMeta', 'pagoDeuda'];

  /** Cuentas que quedarían en negativo con lo que está por guardarse (vacío si ninguna o si el tipo no se revisa). */
  function avisosPrevios() {
    try {
      const m = movimientoDesdeEstado(est, ctx);
      if (editando) {
        const revisa = TIPOS_CON_AVISO_DE_SALDO.includes(editando.tipo) || TIPOS_CON_AVISO_DE_SALDO.includes(est.tipo) || editando.tipo === 'ingreso' || editando.tipo === 'ajusteCuenta';
        return revisa ? avisosDeSaldo(datos(), { editar: { ...m, id: editando.id } }, hoy) : [];
      }
      return TIPOS_CON_AVISO_DE_SALDO.includes(est.tipo) ? avisosDeSaldo(datos(), { agregar: m }, hoy) : [];
    } catch { return []; } // si el cambio no es válido, lo dirá la acción al guardar
  }

  /** Revisa lo mínimo antes de guardar (monto y cuentas de una transferencia). Muestra el aviso y devuelve false si falta algo. */
  function revisarCampos() {
    if (!est.monto) { haptic('error', valorEl); mostrarAviso('Escribe un monto', { tipo: 'warn' }); return false; }
    if (est.tipo === 'transferencia' && (!est.cuentaId || !est.cuentaDestinoId)) { haptic('error'); mostrarAviso('Elige la cuenta de origen y la de destino (agrega otra cuenta si solo tienes una)', { tipo: 'warn' }); return false; } // R1F-21b: antes decía "La cuenta no existe"
    return true;
  }

  /** Devuelve true si el movimiento se guardó (la hoja se está cerrando). */
  function intentarGuardar() {
    if (!revisarCampos()) return false;
    let r;
    const usaOrigen = origenProgramado && est.origen && !(est.tipo === 'pagoDeuda' && est.modo === 'abono');
    if (usaOrigen) {
      r = ejecutar(ctx, marcarPagado, { origen: est.origen, monto: est.monto, fecha: est.fecha, cuentaId: est.cuentaId, interes: est.tipo === 'pagoDeuda' ? Math.min(est.interes, est.monto) : undefined, nota: est.nota });
      if (r.ok) { hoja.cerrar(); haptic('success'); const ultimo = ctx.tienda.datos().movimientos.find((m) => m.origen && m.origen.tipo === est.origen.tipo && m.origen.id === est.origen.id && m.origen.ocurrencia === est.origen.ocurrencia); mostrarAviso('Pago registrado', { tipo: 'ok', accion: ultimo ? { etiqueta: 'Deshacer', alPulsar: () => ejecutar(ctx, borrarMovimiento, { id: ultimo.id }, { exito: 'Pago desmarcado' }) } : undefined }); }
      return r.ok;
    }
    const movimiento = movimientoDesdeEstado(est, ctx);
    if (editando) {
      r = ejecutar(ctx, editarMovimiento, { movimiento: { ...movimiento, id: editando.id } });
      if (r.ok) { hoja.cerrar(); haptic('success'); mostrarAviso('Cambios guardados', { tipo: 'ok' }); }
      return r.ok;
    }
    const id = ctx.generarId('mov');
    r = ejecutar(ctx, agregarMovimiento, { movimiento: { ...movimiento, id, origen: est.tipo === 'pagoDeuda' && est.modo === 'cuota' ? est.origen ?? null : null } });
    if (r.ok) {
      ctx.preferencias.guardar({ ultimaCuentaId: est.cuentaId ?? undefined, ...(est.tipo === 'gasto' ? { ultimaCategoriaId: est.categoriaId } : {}) });
      hoja.cerrar();
      haptic('success');
      mostrarAviso(GUARDADO[est.tipo], { tipo: 'ok', accion: { etiqueta: 'Deshacer', alPulsar: () => ejecutar(ctx, borrarMovimiento, { id }, { exito: 'Movimiento eliminado' }) } });
    }
    return r.ok;
  }

  let eliminando = false;
  async function eliminar() {
    if (eliminando) return;
    eliminando = true;
    // RU-04: borrar el ingreso que financió una transferencia (o una transferencia que cubría una cuenta) puede dejar una cuenta en negativo: se avisa antes de confirmar.
    let avisoSaldo = [];
    try { avisoSaldo = avisosDeSaldo(datos(), { borrar: editando.id }, hoy); } catch { avisoSaldo = []; }
    const textoSaldo = avisoSaldo.length ? ` ${avisoSaldo.length === 1 ? 'Esta cuenta quedará en negativo' : 'Estas cuentas quedarán en negativo'}: ${frasesDeAvisoSaldo(avisoSaldo, hoy).join('; ')}.` : '';
    // R-FIN-01: si el borrado deja una cuenta en negativo es una confirmación de riesgo: "Eliminar" arranca deshabilitado un instante (un segundo toque lento sobre el botón no la confirma).
    const pregunta = { titulo: '¿Eliminar este movimiento?', mensaje: (editando.origen ? 'El pago programado volverá a aparecer como pendiente.' : 'Cambiará el saldo de sus cuentas y el presupuesto del ciclo.') + textoSaldo, confirmar: 'Eliminar', peligro: true };
    const ok = await (avisoSaldo.length ? confirmarRiesgo(pregunta) : confirmar(pregunta));
    if (!ok) { eliminando = false; return; }
    const previo = editando;
    const r = ejecutar(ctx, borrarMovimiento, { id: previo.id });
    if (!r.ok) eliminando = false;
    if (r.ok) {
      hoja.cerrar();
      mostrarAviso('Movimiento eliminado', { tipo: 'ok', accion: { etiqueta: 'Deshacer', alPulsar: () => ejecutar(ctx, agregarMovimiento, { movimiento: previo }, { exito: 'Movimiento restaurado' }) } });
    }
  }

  dibujarTipo();
  dibujarCampos();
  return hoja;
}
