/*
 * cuentas.js — saldos calculados desde el saldo inicial + movimientos, transferencias entre cuentas y patrimonio neto.
 * La tarjeta de crédito es UNA entidad (la deuda): aquí aparece como cuenta de crédito vinculada y su saldo es −saldo(deuda).
 * Ronda del usuario B: cada cuenta es un método de pago. Se agregan, editan, archivan y eliminan desde aquí (efectivo, ahorros, corriente o
 * débito, billetera digital y tarjeta de crédito); "Transferir" y "Pagar tarjeta" están a la vista y en el detalle de cada cuenta.
 */
import { h, icono, crearVista, pesos, diaMes, ejecutar, boton, campoPesos, pedirFecha, abrirSelector, mostrarAviso, recuperarFoco, unSoloEnvio, poner, TIPOS_CUENTA_INFO, ORDEN_TIPOS_CUENTA, tipoCuentaTexto, tipoCuentaCorto, selectorDeIcono, selectorDeColor, estiloIconoColor, elegirOpcion, cuentasPorTipo, ICONOS_CUENTA } from './comun.js';
import { abrirHoja, confirmar } from '../../shared/ui/hoja.js';
import { abrirFormulario } from './agregar.js';
import { abrirEditorDeuda, abrirQuitarDeuda, pagarTarjeta, restaurarDeuda } from './deudas.js';
import { calcularSaldos, patrimonioNeto, totalApartadoMetas, cupoDisponible } from '../logica/saldos.js';
import { guardarCuenta, archivarCuenta, borrarCuenta, reasignarCuenta, usosDeCuenta, planSaldoReasignado, afectaCiclosCerrados } from '../logica/acciones.js';
import { respaldarAntesDe, TEXTO_RESPALDO_REASIGNAR } from './datos.js';
import { fechaPorDefecto } from '../logica/periodo.js';
import { formatearPesos } from '../../shared/lib/dinero.js';
import { formatearFecha } from '../../shared/lib/fechas.js';

/**
 * R3F-07: lo que pasa con los saldos iniciales al mover una cuenta a otra, dicho tal cual lo hace `reasignarCuenta` (R2F-08).
 * Sin ajuste, los saldos se suman. Con ajuste, el destino conserva el saldo y la fecha de la cuenta MÁS ANTIGUA y el de la más nueva se
 * registra como un ajuste con su fecha original: si la cuenta movida es la más antigua, el saldo inicial del destino se REEMPLAZA por el
 * de ella (y el del destino pasa a ser el ajuste); si es la más nueva, el destino conserva el suyo.
 * `plan` es el de `planSaldoReasignado(datos, desde, hacia)`. En ambos casos el patrimonio de hoy y el de ciclos pasados no cambian.
 */
export function textoSaldoReasignado(desde, hacia, plan) {
  const pes = formatearPesos;
  const fecha = (f) => formatearFecha(f, 'dia-mes-anio');
  if (!plan.ajuste) return `El saldo inicial de ${desde.nombre} (${pes(desde.saldoInicial)}) se suma al de ${hacia.nombre}, así que el patrimonio no cambia. ${hacia.nombre} queda con un saldo inicial de ${pes(plan.saldoInicial)}.`;
  const movidaEsLaNueva = plan.ajuste.fecha === desde.fechaSaldoInicial && plan.ajuste.monto === desde.saldoInicial; // con fechas iguales manda la de destino (planSaldoReasignado)
  const primera = movidaEsLaNueva
    ? `${hacia.nombre} conserva su saldo inicial (${pes(hacia.saldoInicial)}, ${fecha(hacia.fechaSaldoInicial)}).`
    : `${hacia.nombre} pasa a tener el saldo inicial de ${desde.nombre} (${pes(desde.saldoInicial)}, ${fecha(desde.fechaSaldoInicial)}) en lugar del suyo.`;
  return `${primera} Como los saldos iniciales son de fechas distintas, el de ${plan.ajuste.cuenta} (${pes(plan.ajuste.monto)}, del ${fecha(plan.ajuste.fecha)}) queda como un ajuste con su fecha original: el patrimonio de ciclos pasados tampoco cambia.`;
}

export function montar(raiz, ctx) {
  const estado = { archivadas: false };
  const vista = crearVista(raiz, () => dibujar(ctx, estado, () => vista.actualizar()));
  return vista;
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/** Cuentas activas (no crédito) a las que se puede transferir o pagar. */
const cuentasDeDinero = (datos) => datos.cuentas.filter((c) => !c.archivada && c.tipo !== 'credito');

/** Abre "Transferir" con origen y destino preseleccionables (si no hay al menos dos cuentas, explica qué falta). */
export function abrirTransferencia(ctx, preset = {}) {
  if (cuentasDeDinero(ctx.tienda.datos()).length < 2) { mostrarAviso('Agrega otra cuenta para poder transferir entre cuentas', { tipo: 'warn' }); return null; }
  return abrirFormulario(ctx, { tipo: 'transferencia', preset: { tipo: 'transferencia', ...preset } });
}

/** Hoja para agregar o editar una cuenta (que no sea tarjeta de crédito: esas se editan en Deudas). */
function abrirEditorCuenta(ctx, cuenta, { tipoInicial = 'banco' } = {}) {
  const nueva = !cuenta;
  const datos0 = ctx.tienda.datos();
  const hoy = ctx.reloj.hoy();
  const est = {
    tipo: cuenta?.tipo ?? tipoInicial,
    fecha: cuenta?.fechaSaldoInicial ?? fechaPorDefecto(datos0, hoy),
    icono: cuenta?.icono ?? TIPOS_CUENTA_INFO[tipoInicial].icono,
    color: cuenta?.color ?? null,
  };
  const nombre = h('input', { class: 'input', type: 'text', value: cuenta?.nombre ?? '', attrs: { maxlength: 40, 'aria-label': 'Nombre de la cuenta', autocomplete: 'off', placeholder: TIPOS_CUENTA_INFO[est.tipo]?.ejemplo ?? 'Ej.: Cuenta de ahorros' } });
  // R1F-05: el saldo inicial admite signo (sobregiro) y se conserva al editar: solo se reenvía si el usuario lo cambió.
  const saldo = campoPesos({ etiqueta: 'Saldo inicial', valor: cuenta?.saldoInicial ?? 0, id: 'c-saldo', conSigno: true, textoPositivo: 'A favor', textoNegativo: 'Sobregiro (negativo)', ayuda: 'Lo que tenía la cuenta en la fecha de abajo; si debía dinero (sobregiro), elige "Sobregiro". Para cuadrar con el banco usa "Ajustar saldo".' });
  const zonaTipo = h('div', { class: 'stack stack--sm' });
  const zonaIconos = h('div', { class: 'stack stack--sm' });
  const chipFecha = h('button', { class: 'chip', type: 'button' });
  const tiposElegibles = nueva ? ORDEN_TIPOS_CUENTA : ORDEN_TIPOS_CUENTA.filter((t) => t !== 'credito');
  const pintar = () => {
    poner(zonaTipo,
      h('span', { class: 'field__label' }, nueva ? '¿Qué tipo de cuenta es?' : 'Tipo de cuenta'),
      h('div', { class: 'chip-row chip-row--wrap', role: 'radiogroup', aria: { label: 'Tipo de cuenta' } }, tiposElegibles.map((t) => h('button', { class: 'chip', type: 'button', role: 'radio', aria: { checked: String(t === est.tipo), pressed: String(t === est.tipo) }, on: { click: () => {
        if (t === 'credito') { hoja.cerrar(); abrirEditorDeuda(ctx, null, { presetInicial: 'tarjeta' }); return; } // la tarjeta crea su deuda y su cuenta juntas
        if (est.icono === TIPOS_CUENTA_INFO[est.tipo].icono) est.icono = TIPOS_CUENTA_INFO[t].icono; // el ícono por omisión sigue al tipo mientras no se elija otro
        est.tipo = t;
        nombre.setAttribute('placeholder', TIPOS_CUENTA_INFO[t].ejemplo);
        pintar();
      } } }, icono(TIPOS_CUENTA_INFO[t].icono), TIPOS_CUENTA_INFO[t].titulo))),
      h('p', { class: 'field__hint' }, nueva ? `${TIPOS_CUENTA_INFO[est.tipo].ayuda} Para una tarjeta de crédito elige "Tarjeta de crédito": se crea junto con su deuda.` : TIPOS_CUENTA_INFO[est.tipo].ayuda));
    poner(zonaIconos,
      h('span', { class: 'field__label' }, 'Ícono'),
      selectorDeIcono({ valor: est.icono, claves: ICONOS_CUENTA, alCambiar: (k) => { est.icono = k; pintar(); }, nombres: { banco: 'Banco', efectivo: 'Efectivo', ahorro: 'Ahorro', celular: 'Billetera', escudo: 'Escudo', hogar: 'Hogar', viaje: 'Viaje', compras: 'Compras', regalo: 'Regalo', otro: 'Otro' } }),
      h('span', { class: 'field__label' }, 'Color (opcional)'),
      selectorDeColor({ valor: est.color, alCambiar: (k) => { est.color = k; pintar(); } }));
    chipFecha.replaceChildren(icono('calendar'), `Saldo al ${diaMes(est.fecha)} ${est.fecha.slice(0, 4)}`);
    recuperarFoco(); // los selectores se reconstruyen: sin esto el foco queda en <body> y Esc deja de cerrar la hoja
  };
  chipFecha.addEventListener('click', async () => { const v = await pedirFecha({ titulo: 'Fecha del saldo inicial', valor: est.fecha }); if (v) { est.fecha = v; pintar(); } });
  pintar();
  const guardar = boton(nueva ? 'Agregar cuenta' : 'Guardar cambios', {
    icono: 'check', clase: 'btn--lg btn--block',
    onClick: unSoloEnvio(() => {
      const saldoV = !nueva && !saldo.tocado() ? cuenta.saldoInicial : saldo.valor() ?? 0;
      const color = est.color ?? (cuenta?.color ? null : undefined); // null = quitar el color que tenía
      const r = ejecutar(ctx, guardarCuenta, {
        cuenta: nueva
          ? { nombre: nombre.value, tipo: est.tipo, saldoInicial: saldoV, fechaSaldoInicial: est.fecha, icono: est.icono, color: est.color ?? undefined }
          : { id: cuenta.id, nombre: nombre.value, tipo: est.tipo, saldoInicial: saldoV, fechaSaldoInicial: est.fecha, icono: est.icono, color },
      }, { exito: nueva ? 'Cuenta agregada' : 'Cuenta actualizada' });
      if (r.ok) hoja.cerrar();
      return r.ok;
    }),
  });

  // Q12: con historial la cuenta no se puede borrar; esto mueve TODO lo que la usa a otra cuenta (con confirmación) y la borra.
  async function reasignar() {
    const datos = ctx.tienda.datos();
    const destinos = cuentasDeDinero(datos).filter((c) => c.id !== cuenta.id);
    if (cuenta.tipo === 'credito' || !destinos.length) { mostrarAviso('No hay otra cuenta activa a la que mover los movimientos. Agrega una primero.', { tipo: 'warn' }); return false; }
    const s = calcularSaldos(datos, ctx.reloj.hoy());
    const hacia = await abrirSelector({ titulo: 'Mover los movimientos a', opciones: cuentasPorTipo(destinos).map((c) => ({ valor: c.id, titulo: c.nombre, icono: c.icono, color: c.color, grupo: TIPOS_CUENTA_INFO[c.tipo].grupo, fin: pesos(s.cuentas[c.id]) })) });
    if (!hacia) return false;
    const destino = destinos.find((c) => c.id === hacia);
    const u = usosDeCuenta(datos, cuenta.id, hacia);
    const partes = [`${u.movimientos - u.transferenciasEntre} movimiento${u.movimientos - u.transferenciasEntre === 1 ? '' : 's'}`];
    if (u.recurrentes) partes.push(`${u.recurrentes} pago${u.recurrentes === 1 ? '' : 's'} recurrente${u.recurrentes === 1 ? '' : 's'}`);
    if (u.metas) partes.push(`${u.metas} meta${u.metas === 1 ? '' : 's'}`);
    if (u.ingreso) partes.push('el ingreso mensual');
    // R2F-08: si las fechas de los saldos iniciales son distintas, el de la cuenta más nueva queda como un ajuste con SU fecha: la historia no cambia.
    const plan = planSaldoReasignado(datos, cuenta, destino);
    const ok = await confirmar({
      titulo: `¿Mover todo a ${destino.nombre} y borrar ${cuenta.nombre}?`,
      mensaje: `Se mueven ${partes.join(', ')}. ${textoSaldoReasignado(cuenta, destino, plan)}${u.transferenciasEntre ? ` Las ${u.transferenciasEntre} transferencia${u.transferenciasEntre === 1 ? '' : 's'} entre las dos cuentas se eliminan (no cambian el saldo combinado).` : ''} ${TEXTO_RESPALDO_REASIGNAR}`,
      confirmar: 'Mover y borrar', peligro: true,
    });
    if (!ok) return false;
    if (!(await respaldarAntesDe(ctx, 'antes-de-reasignar-cuenta'))) return false; // R2F-14: respaldo automático para poder volver atrás
    const r = ejecutar(ctx, reasignarCuenta, { desdeId: cuenta.id, haciaId: hacia }, { exito: 'Movimientos movidos y cuenta borrada' });
    if (r.ok) hoja.cerrar();
    return r.ok;
  }

  async function archivar({ confirmado = false } = {}) {
    if (!cuenta.archivada && !confirmado) { // desde "Eliminar cuenta" la persona ya eligió archivar: no se pregunta dos veces
      const saldoHoy = calcularSaldos(ctx.tienda.datos(), hoy).cuentas[cuenta.id];
      const ok = await confirmar({ titulo: '¿Archivar esta cuenta?', mensaje: `Dejará de ofrecerse al registrar movimientos, pero su historial y su saldo se conservan.${saldoHoy ? ` Hoy tiene ${pesos(saldoHoy)}: mientras esté archivada seguirá sumando al patrimonio. Si ya no tiene dinero, transfiérelo o ajusta su saldo a $ 0 antes.` : ''} Puedes restaurarla en "Mostrar archivadas".`, confirmar: 'Archivar' });
      if (!ok) return;
    }
    const r = ejecutar(ctx, archivarCuenta, { id: cuenta.id, archivada: !cuenta.archivada }, { exito: cuenta.archivada ? 'Cuenta restaurada' : 'Cuenta archivada' });
    if (r.ok) hoja.cerrar();
  }

  /**
   * "Eliminar cuenta": sin historial se borra con confirmación. Con movimientos (o usos: ingreso, recurrentes, metas) o con un saldo
   * inicial que ya cuenta en ciclos cerrados no se borra: se ofrece archivarla (conserva el historial) o mover todo a otra cuenta.
   */
  async function eliminar() {
    const datos = ctx.tienda.datos();
    const u = usosDeCuenta(datos, cuenta.id);
    const enUso = u.movimientos > 0 || u.recurrentes > 0 || u.metas > 0 || u.ingreso;
    const afecta = afectaCiclosCerrados(datos, cuenta, hoy);
    if (!enUso && !afecta) {
      const ok = await confirmar({ titulo: `¿Eliminar ${cuenta.nombre}?`, mensaje: `No tiene movimientos: se elimina del todo.${cuenta.saldoInicial ? ` Su saldo inicial de ${pesos(cuenta.saldoInicial)} deja de contar en el patrimonio.` : ''} Los ciclos pasados no cambian.`, confirmar: 'Eliminar', peligro: true });
      if (!ok) return;
      const r = ejecutar(ctx, borrarCuenta, { id: cuenta.id }, { exito: 'Cuenta eliminada' });
      if (r.ok) hoja.cerrar();
      return;
    }
    const partes = [];
    if (u.movimientos) partes.push(plural(u.movimientos, 'movimiento', 'movimientos'));
    if (u.recurrentes) partes.push(plural(u.recurrentes, 'pago recurrente', 'pagos recurrentes'));
    if (u.metas) partes.push(plural(u.metas, 'meta', 'metas'));
    if (u.ingreso) partes.push('el ingreso mensual');
    const razon = partes.length ? `${cuenta.nombre} tiene ${partes.join(', ')}: borrarla haría desaparecer ese historial.` : `${cuenta.nombre} tiene un saldo inicial que ya cuenta en el patrimonio de ciclos cerrados: borrarla lo cambiaría.`;
    const destinos = cuentasDeDinero(datos).filter((c) => c.id !== cuenta.id);
    const opciones = [];
    if (!u.ingreso) opciones.push({ valor: 'archivar', texto: 'Archivar conservando el historial', icono: 'restore', clase: 'btn--secondary' });
    if (destinos.length) opciones.push({ valor: 'mover', texto: 'Mover movimientos a otra cuenta y borrar', icono: 'swap', clase: 'btn--secondary' });
    const v = await elegirOpcion({
      titulo: `Eliminar ${cuenta.nombre}`,
      mensaje: [
        `${razon} Por eso no se borra directamente.`,
        'Archivar: deja de ofrecerse al registrar movimientos y su historial se conserva. Si le queda dinero, seguirá sumando al patrimonio: transfiérelo antes si quieres.',
        destinos.length ? 'Mover: pasa todo lo que la usa a otra cuenta y la borra, sin cambiar el patrimonio de hoy ni el de ciclos pasados.' : 'Mover: agrega otra cuenta primero para poder mover sus movimientos.',
        u.ingreso ? 'Esta cuenta recibe el ingreso mensual: cambia primero la cuenta del ingreso en Ajustes, o muévela a otra cuenta.' : null,
      ].filter(Boolean),
      opciones,
    });
    if (v === 'archivar') await archivar({ confirmado: true });
    else if (v === 'mover') await reasignar();
  }

  const usada = !nueva && (() => { const u = usosDeCuenta(ctx.tienda.datos(), cuenta.id); return u.movimientos > 0 || u.recurrentes > 0 || u.metas > 0 || u.ingreso; })();
  const hayTarjetas = !nueva && ctx.tienda.datos().deudas.some((d) => d.tipo === 'tarjeta' && !d.archivada);
  const rapidas = nueva ? null : h('div', { class: 'grid-2' },
    boton('Transferir', { icono: 'swap', clase: 'btn--sm', aria: { label: `Transferir desde ${cuenta.nombre}` }, onClick: () => { const f = abrirTransferencia(ctx, { cuentaId: cuenta.id }); if (f) hoja.cerrar(); } }),
    boton('Ver movimientos', { icono: 'list', clase: 'btn--secondary btn--sm', onClick: () => { hoja.cerrar(); if (ctx.navegar) ctx.navegar('movimientos', { cuenta: cuenta.id }); } }),
    hayTarjetas ? boton('Pagar tarjeta', { icono: 'card', clase: 'btn--secondary btn--sm', onClick: async () => { const f = await pagarTarjeta(ctx, { cuentaId: cuenta.id }); if (f) hoja.cerrar(); } }) : null);
  const acciones = nueva ? [] : [
    boton('Ajustar saldo', { icono: 'sliders', clase: 'btn--secondary', onClick: () => { hoja.cerrar(); abrirFormulario(ctx, { tipo: 'ajusteCuenta', preset: { tipo: 'ajusteCuenta', cuentaId: cuenta.id } }); } }),
    boton(cuenta.archivada ? 'Restaurar' : 'Archivar', { icono: cuenta.archivada ? 'restore' : 'trash', clase: 'btn--secondary', onClick: () => archivar() }),
    usada ? boton('Mover movimientos a otra cuenta y borrar', { icono: 'swap', clase: 'btn--secondary', onClick: () => reasignar() }) : null,
    boton('Eliminar cuenta', { icono: 'trash', clase: 'btn--danger-ghost', onClick: () => eliminar() }),
  ];
  const cuerpo = h('div', { class: 'sheet__body stack stack--lg' },
    nueva ? null : h('p', { class: 't-small muted' }, `${tipoCuentaTexto(cuenta.tipo)} · saldo hoy `, h('b', { class: 'num' }, pesos(calcularSaldos(datos0, hoy).cuentas[cuenta.id])), cuenta.archivada ? ' · archivada' : ''),
    rapidas,
    h('div', { class: 'field' }, h('label', { class: 'field__label' }, 'Nombre'), nombre),
    zonaTipo, zonaIconos, saldo.el, h('div', { class: 'chip-row' }, chipFecha),
    acciones.filter(Boolean).length ? h('div', { class: 'stack stack--sm' }, acciones) : null,
    h('p', { class: 'field__hint' }, 'La app no guarda números de tarjeta ni de cuenta.'));
  const hoja = abrirHoja([cuerpo, h('div', { class: 'sheet__foot' }, guardar)], { titulo: nueva ? 'Agregar cuenta' : `Editar ${cuenta.nombre}` });
  return hoja;
}

/** Detalle de una tarjeta de crédito (cuenta vinculada): pagar, ver movimientos, editar, ajustar el saldo, eliminar o archivar. */
function abrirDetalleTarjeta(ctx, cuenta) {
  const datos = ctx.tienda.datos();
  const deuda = datos.deudas.find((d) => d.id === cuenta.deudaId);
  if (!deuda) return null;
  const saldo = calcularSaldos(datos, ctx.reloj.hoy()).deudas[deuda.id];
  const disponible = cupoDisponible(deuda, saldo);
  const acciones = [
    boton(cuenta.archivada ? 'Restaurar tarjeta' : 'Pagar tarjeta', cuenta.archivada
      ? { icono: 'restore', clase: 'btn--sm', onClick: () => { const r = restaurarDeuda(ctx, deuda, 'Tarjeta restaurada'); if (r.ok) hoja.cerrar(); } }
      : { icono: 'card', clase: 'btn--sm', onClick: async () => { const f = await pagarTarjeta(ctx); if (f) hoja.cerrar(); } }),
    boton('Ver movimientos', { icono: 'list', clase: 'btn--secondary btn--sm', onClick: () => { hoja.cerrar(); if (ctx.navegar) ctx.navegar('movimientos', { cuenta: cuenta.id }); } }),
    boton('Editar tarjeta', { icono: 'pencil', clase: 'btn--secondary btn--sm', onClick: () => { hoja.cerrar(); abrirEditorDeuda(ctx, deuda); } }),
    boton('Ajustar saldo', { icono: 'sliders', clase: 'btn--secondary btn--sm', onClick: () => { hoja.cerrar(); abrirFormulario(ctx, { tipo: 'ajusteDeuda', preset: { tipo: 'ajusteDeuda', deudaId: deuda.id } }); } }),
  ];
  const cuerpo = h('div', { class: 'sheet__body stack stack--lg' },
    h('p', { class: 't-small muted' }, 'Tarjeta de crédito · debes ', h('b', { class: 'num' }, pesos(saldo)), disponible !== null ? ` · cupo disponible ${pesos(disponible)}` : '', cuenta.archivada ? ' · archivada' : ''),
    h('div', { class: 'grid-2' }, acciones),
    h('p', { class: 'field__hint' }, 'La tarjeta es una sola entidad: su deuda y esta cuenta se editan, se archivan y se eliminan juntas. Las compras con ella suben la deuda; pagarla baja la deuda y el saldo de la cuenta de origen.'),
    boton('Eliminar o archivar tarjeta', { icono: 'trash', clase: 'btn--danger-ghost', onClick: async () => { const hecho = await abrirQuitarDeuda(ctx, deuda); if (hecho) hoja.cerrar(); } }),
    h('a', { class: 'btn btn--ghost btn--block', href: '#/deudas', on: { click: () => hoja.cerrar() } }, icono('card'), 'Ver en Deudas'));
  const hoja = abrirHoja([cuerpo], { titulo: cuenta.nombre });
  return hoja;
}

function dibujar(ctx, estado, redibujar) {
  const datos = ctx.tienda.datos();
  const hoy = ctx.reloj.hoy();
  const saldos = calcularSaldos(datos, hoy);
  const p = patrimonioNeto(datos, hoy, saldos);
  const apartado = totalApartadoMetas(datos, hoy);
  const programados = datos.movimientos.filter((m) => m.fecha > hoy).length;
  ctx.shell.titulo('Cuentas', 'Saldos y patrimonio');
  ctx.shell.fab(false);
  const fila = (c) => {
    const credito = c.tipo === 'credito';
    const valor = credito ? -saldos.deudas[c.deudaId] : saldos.cuentas[c.id];
    const deuda = credito ? datos.deudas.find((d) => d.id === c.deudaId) : null;
    const disponible = deuda ? cupoDisponible(deuda, saldos.deudas[deuda.id]) : null;
    const sub = credito ? (disponible !== null ? `Crédito · saldo de la deuda · cupo disponible ${pesos(disponible)}` : 'Crédito · saldo de la deuda') : `${tipoCuentaCorto(c.tipo)} · saldo calculado`;
    const contenido = [
      h('span', { class: 'item__icon', style: estiloIconoColor(c.color) }, icono(c.icono)),
      h('span', { class: 'item__main' }, h('span', { class: 'item__title', style: { display: 'block' } }, c.nombre, c.archivada ? [' ', h('span', { class: 'badge' }, 'Archivada')] : null), h('span', { class: 'item__sub', style: { display: 'block' } }, sub), credito ? h('span', { class: 'badge badge--info', style: { marginTop: '4px' } }, icono('link'), 'Vinculada a Deudas') : null),
      h('span', { class: `item__end money ${credito || valor < 0 ? 'money--debt' : ''}` }, pesos(valor)),
    ];
    return credito
      ? h('button', { class: 'item', type: 'button', on: { click: () => abrirDetalleTarjeta(ctx, c) }, aria: { label: `${c.nombre}: ${pesos(valor)}. Abrir tarjeta` } }, contenido)
      : h('button', { class: 'item', type: 'button', on: { click: () => abrirEditorCuenta(ctx, c) }, aria: { label: `Editar ${c.nombre}: ${pesos(valor)}` } }, contenido);
  };
  const activas = cuentasPorTipo(datos.cuentas.filter((c) => !c.archivada));
  const archivadas = cuentasPorTipo(datos.cuentas.filter((c) => c.archivada));
  // Las cuentas se agrupan por tipo (cada una es un método de pago); los grupos vacíos no se muestran.
  const grupos = ORDEN_TIPOS_CUENTA.map((tipo) => ({ tipo, cuentas: activas.filter((c) => c.tipo === tipo) })).filter((g) => g.cuentas.length);
  const hayTarjetas = datos.deudas.some((d) => d.tipo === 'tarjeta' && !d.archivada);
  return [
    h('section', { class: 'card card--hero networth', aria: { labelledby: 'pn-t' } },
      h('span', { class: 't-label', id: 'pn-t' }, 'Patrimonio neto'),
      h('div', { class: `hero__amount num${p.patrimonio < 0 ? ' danger' : ''}` }, pesos(p.patrimonio)),
      h('p', { class: 't-small muted' }, `Cuentas ${pesos(p.activos)} − deudas ${pesos(p.pasivos)}`)),
    h('section', { class: 'acct-total', aria: { label: 'Totales' } },
      h('div', { class: 'card card--tight' }, h('div', { class: 'kpi' }, h('span', { class: 'kpi__v num' }, pesos(p.activos)), h('span', { class: 'kpi__l' }, 'En cuentas'))),
      h('div', { class: 'card card--tight' }, h('div', { class: 'kpi' }, h('span', { class: 'kpi__v num' }, pesos(apartado)), h('span', { class: 'kpi__l' }, 'Apartado para metas')))),
    // Acciones a la vista: agregar cuentas y tarjetas, transferir y pagar una tarjeta.
    h('div', { class: 'grid-2' },
      h('button', { class: 'btn btn--sm', type: 'button', on: { click: () => abrirTransferencia(ctx) } }, icono('swap'), 'Transferir'),
      h('button', { class: 'btn btn--secondary btn--sm', type: 'button', on: { click: () => abrirEditorCuenta(ctx, null) } }, icono('plus'), 'Agregar cuenta')),
    h('div', { class: 'grid-2' },
      h('button', { class: 'btn btn--secondary btn--sm', type: 'button', aria: { label: 'Agregar tarjeta de crédito' }, on: { click: () => abrirEditorDeuda(ctx, null, { presetInicial: 'tarjeta' }) } }, icono('plus'), 'Agregar tarjeta'),
      hayTarjetas ? h('button', { class: 'btn btn--secondary btn--sm', type: 'button', on: { click: () => pagarTarjeta(ctx) } }, icono('card'), 'Pagar tarjeta') : null),
    grupos.length
      ? h('section', { class: 'card', aria: { labelledby: 'ct-t' } },
        h('h2', { class: 't-h', id: 'ct-t', style: { marginBottom: 'var(--sp-1)' } }, 'Mis cuentas'),
        h('p', { class: 't-caption' }, 'Cada cuenta es un método de pago: la eliges al registrar un gasto o un ingreso.'),
        grupos.map((g) => [h('div', { class: 't-label list-title' }, TIPOS_CUENTA_INFO[g.tipo].grupo), h('div', { class: 'list' }, g.cuentas.map(fila))]))
      : h('section', { class: 'card', aria: { labelledby: 'ct-t' } }, h('h2', { class: 't-h', id: 'ct-t' }, 'Mis cuentas'), h('p', { class: 't-small muted' }, 'No tienes cuentas activas. Agrega una con "Agregar cuenta".')),
    archivadas.length ? h('button', { class: 'btn btn--ghost btn--block', type: 'button', aria: { expanded: String(estado.archivadas) }, on: { click: () => { estado.archivadas = !estado.archivadas; redibujar(); } } }, icono(estado.archivadas ? 'chevron-up' : 'chevron-down'), estado.archivadas ? 'Ocultar archivadas' : `Mostrar archivadas (${archivadas.length})`) : null,
    archivadas.length && estado.archivadas ? h('section', { class: 'card' }, h('h2', { class: 't-h', style: { marginBottom: 'var(--sp-1)' } }, `Archivadas (${archivadas.length})`), h('p', { class: 't-caption' }, 'No aparecen al registrar movimientos, pero su historial y su saldo siguen en los reportes. Toca una para restaurarla.'), h('div', { class: 'list' }, archivadas.map(fila))) : null,
    h('div', { class: 'callout' }, icono('info'), h('div', null, h('span', { class: 'callout__title' }, 'La tarjeta cuenta una sola vez'), h('br'), `Aparece aquí como cuenta de crédito, pero su saldo vive en Deudas; el patrimonio resta ${pesos(p.pasivos)} de deudas sin duplicar la tarjeta.`)),
    programados ? h('p', { class: 't-caption' }, `${programados} movimiento${programados === 1 ? '' : 's'} con fecha futura no suma${programados === 1 ? '' : 'n'} a los saldos hasta su fecha.`) : null,
    h('p', { class: 'note-legal' }, 'Los saldos se calculan desde el saldo inicial, los movimientos y las transferencias. La app no guarda números de tarjeta ni de cuenta.'),
  ];
}
