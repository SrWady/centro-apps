/*
 * agregar.js — hoja inferior "Agregar movimiento" con teclado numérico propio (registro en ≤ 5 s y ≤ 6 toques).
 * También edita movimientos existentes y registra pagos de deuda, aportes a metas, ajustes y "Marcar pagado".
 *
 * Uso: abrirFormulario(ctx, { movimiento?, tipo?, preset?, origen?, titulo? })
 *  - sin movimiento: crea (tipo 'gasto' por omisión). Con `origen` ({tipo,id,ocurrencia}) registra un pago programado
 *    con la acción marcarPagado (la fecha programada queda en origen.ocurrencia).
 *  - con movimiento: edita (y permite eliminar).
 */
import { h, icono, ejecutar, haptic, mostrarAviso, boton, abrirSelector, pedirMonto, pedirFecha, pedirTexto, pesos, fechaCorta, diaMes, segmentado, GRUPOS_TITULO, teclaDeMonto, DIGITOS_TECLADO_MONTO, mensajeTopeMonto, pasaTopeMonto } from './comun.js';
import { abrirHoja, confirmar } from '../../shared/ui/hoja.js';
import { crearTeclado, formatoTecleado } from '../../shared/ui/teclado.js';
import { agregarMovimiento, editarMovimiento, borrarMovimiento, marcarPagado } from '../logica/acciones.js';
import { fechaPorDefecto } from '../logica/periodo.js';
import { calcularSaldos } from '../logica/saldos.js';
import { interesPeriodo } from '../logica/deudas.js';
import { tasaMensual } from '../logica/tasas.js';
import { sumarDias } from '../../shared/lib/fechas.js';

const TIPOS_BASICOS = ['gasto', 'ingreso', 'transferencia'];
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

/** Categorías de gasto sin vínculo, ordenadas por uso en los últimos 90 días (y luego por orden). */
export function categoriasPorUso(datos, tipo, hoy) {
  const desde = sumarDias(hoy, -90);
  const usos = {};
  for (const m of datos.movimientos) if (m.tipo === tipo && m.fecha >= desde) usos[m.categoriaId] = (usos[m.categoriaId] ?? 0) + 1;
  // Sin historial de uso, primero las categorías que NO tienen un pago recurrente activo (esos se marcan con "Pagado").
  const conRecurrente = new Set(datos.recurrentes.filter((r) => r.activo).map((r) => r.categoriaId));
  return datos.categorias
    .filter((c) => c.tipo === tipo && c.vinculo === null && noArchivada(c))
    .sort((a, b) => (usos[b.id] ?? 0) - (usos[a.id] ?? 0) || Number(conRecurrente.has(a.id)) - Number(conRecurrente.has(b.id)) || a.orden - b.orden);
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
    est.categoriaId = datos.categorias.find((c) => c.vinculo === 'metas')?.id ?? null;
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
  const tiposVisibles = origenProgramado ? null : editando ? (TIPOS_BASICOS.includes(est.tipo) && !est.origen ? TIPOS_BASICOS : null) : opciones.tipo && !TIPOS_BASICOS.includes(opciones.tipo) ? null : TIPOS_BASICOS;

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
  const pintarBoton = () => { btnGuardar.replaceChildren(icono('check'), document.createTextNode(` ${editando || origenProgramado ? textoGuardar : `Guardar ${est.tipo === 'gasto' ? 'gasto' : est.tipo === 'ingreso' ? 'ingreso' : est.tipo === 'transferencia' ? 'transferencia' : ''}`.trim()}`)); };
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
    const opciones = datos().cuentas.filter((c) => !c.archivada && (!sinCredito || !esCredito(c)))
      .map((c) => ({ valor: c.id, titulo: c.nombre, icono: c.icono, fin: pesos(esCredito(c) ? -s.deudas[c.deudaId] : s.cuentas[c.id]) }));
    if (permitirNinguna) opciones.unshift({ valor: '', titulo: 'Misma cuenta (solo apartar)', sub: 'El dinero queda apartado sin moverse', icono: 'escudo' });
    const v = await abrirSelector({ titulo, opciones, seleccionado: est[campo] ?? '' });
    if (v === undefined) return;
    est[campo] = v === '' ? null : v;
    if ((campo === 'cuentaId' || campo === 'cuentaDestinoId') && est.cuentaId && est.cuentaId === est.cuentaDestinoId) est.cuentaDestinoId = null;
    completar(est, datos(), hoy, prefs);
    dibujarCampos();
  }
  async function elegirCategoria() {
    const cats = datos().categorias.filter((c) => c.tipo === est.tipo && c.vinculo === null && !c.archivada);
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
    const v = await abrirSelector({ titulo: 'Meta', opciones: datos().metas.filter(noArchivada).map((m) => ({ valor: m.id, titulo: m.nombre, icono: m.icono })), seleccionado: est.metaId });
    if (v !== undefined) { est.metaId = v; dibujarCampos(); }
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
      const visibles = todas.slice(0, 6);
      if (est.categoriaId && !visibles.some((c) => c.id === est.categoriaId)) { const sel = d.categorias.find((c) => c.id === est.categoriaId); if (sel) visibles.unshift(sel); }
      filas.push(fila('Categoría', [
        ...visibles.map((c) => chip(c.nombre, { icono: c.icono, presionado: c.id === est.categoriaId, onClick: () => { est.categoriaId = c.id; dibujarCampos(); haptic('select'); } })),
        ...(todas.length > visibles.length ? [chip('Más', { icono: 'more', onClick: elegirCategoria, etiqueta: 'Más categorías' })] : []),
      ]));
      filas.push(fila('Cuenta, fecha y nota', [chipCuenta('cuentaId', '', { sinCredito: est.tipo === 'ingreso' }), chipFecha(), chipNota()]));
    } else if (est.tipo === 'transferencia') {
      filas.push(fila('Cuentas', [chipCuenta('cuentaId', 'De', { sinCredito: true, titulo: 'Cuenta de origen' }), chipCuenta('cuentaDestinoId', 'A', { sinCredito: true, titulo: 'Cuenta de destino' })]));
      filas.push(fila('Fecha y nota', [chipFecha(), chipNota()]));
      if (!est.cuentaDestinoId) filas.push(h('p', { class: 'field__hint' }, 'Para transferir necesitas al menos dos cuentas (sin contar tarjetas). Agrega otra en Cuentas.')); // R1F-21b
    } else if (est.tipo === 'pagoDeuda') {
      if (!editando || origenProgramado) {
        filas.push(segmentado({ etiqueta: 'Tipo de pago', valor: est.modo, opciones: [{ valor: 'cuota', titulo: 'Cuota' }, { valor: 'abono', titulo: 'Abono extra' }], alCambiar: (v) => { est.modo = v; est.interesManual = false; est.interes = interesSugerido(est, datos(), hoy); completar(est, datos(), hoy, prefs); dibujarCampos(); } })); // R2F-07: al cambiar de cuota a abono el interés propuesto se recalcula (abono: 0)
      }
      interesChip = chip(`Interés ${pesos(est.interes)}`, { icono: 'trend', onClick: elegirInteres, etiqueta: 'Interés incluido' });
      filas.push(fila('Deuda y cuenta', [origenProgramado || est.origen ? chip(nombreDeuda(est.deudaId), { icono: 'deuda' }) : chip(nombreDeuda(est.deudaId), { icono: 'deuda', fin: 'chevron-down', onClick: elegirDeuda }), chipCuenta('cuentaId', 'Desde', { sinCredito: true })]));
      filas.push(fila('Interés, fecha y nota', [interesChip, chipFecha(), chipNota()]));
    } else if (est.tipo === 'aporteMeta' || est.tipo === 'retiroMeta') {
      filas.push(fila('Meta y cuentas', [chip(nombreMeta(est.metaId), { icono: 'escudo', fin: 'chevron-down', onClick: elegirMeta }), chipCuenta('cuentaId', est.tipo === 'aporteMeta' ? 'Desde' : 'De', { sinCredito: true })]));
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
    const nombres = { gasto: 'Gasto', ingreso: 'Ingreso', transferencia: 'Transferencia' };
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
    try { guardado = intentarGuardar(); } finally { if (!guardado) { guardando = false; btnGuardar.disabled = false; } }
  }

  /** Devuelve true si el movimiento se guardó (la hoja se está cerrando). */
  function intentarGuardar() {
    if (!est.monto) { haptic('error', valorEl); mostrarAviso('Escribe un monto', { tipo: 'warn' }); return false; }
    if (est.tipo === 'transferencia' && (!est.cuentaId || !est.cuentaDestinoId)) { haptic('error'); mostrarAviso('Elige la cuenta de origen y la de destino (agrega otra cuenta si solo tienes una)', { tipo: 'warn' }); return false; } // R1F-21b: antes decía "La cuenta no existe"
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
    const ok = await confirmar({ titulo: '¿Eliminar este movimiento?', mensaje: editando.origen ? 'El pago programado volverá a aparecer como pendiente.' : 'Cambiará el saldo de sus cuentas y el presupuesto del ciclo.', confirmar: 'Eliminar', peligro: true });
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
