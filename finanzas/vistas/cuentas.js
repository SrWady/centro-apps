/*
 * cuentas.js — saldos calculados desde el saldo inicial + movimientos, transferencias entre cuentas y patrimonio neto.
 * La tarjeta de crédito es UNA entidad (la deuda): aquí aparece como cuenta de crédito vinculada y su saldo es −saldo(deuda).
 */
import { h, icono, crearVista, pesos, fechaCorta, diaMes, ejecutar, boton, campoPesos, segmentado, pedirFecha, abrirSelector, mostrarAviso, recuperarFoco, unSoloEnvio } from './comun.js';
import { abrirHoja, confirmar } from '../../shared/ui/hoja.js';
import { abrirFormulario } from './agregar.js';
import { calcularSaldos, patrimonioNeto, totalApartadoMetas } from '../logica/saldos.js';
import { guardarCuenta, archivarCuenta, borrarCuenta, reasignarCuenta, usosDeCuenta, planSaldoReasignado } from '../logica/acciones.js';
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
  return crearVista(raiz, () => dibujar(ctx));
}

function abrirEditorCuenta(ctx, cuenta) {
  const nueva = !cuenta;
  const est = { tipo: cuenta?.tipo ?? 'banco', fecha: cuenta?.fechaSaldoInicial ?? fechaPorDefecto(ctx.tienda.datos(), ctx.reloj.hoy()) };
  const nombre = h('input', { class: 'input', type: 'text', value: cuenta?.nombre ?? '', attrs: { maxlength: 40, 'aria-label': 'Nombre de la cuenta', autocomplete: 'off', placeholder: 'Ej.: Cuenta de ahorros' } });
  // R1F-05: el saldo inicial admite signo (sobregiro) y se conserva al editar: solo se reenvía si el usuario lo cambió.
  const saldo = campoPesos({ etiqueta: 'Saldo inicial', valor: cuenta?.saldoInicial ?? 0, id: 'c-saldo', conSigno: true, textoPositivo: 'A favor', textoNegativo: 'Sobregiro (negativo)', ayuda: 'Lo que tenía la cuenta en la fecha de abajo; si debía dinero (sobregiro), elige "Sobregiro". Para cuadrar con el banco usa "Ajustar saldo".' });
  const zonaTipo = h('div');
  const chipFecha = h('button', { class: 'chip', type: 'button' });
  const pintar = () => {
    zonaTipo.replaceChildren(segmentado({ etiqueta: 'Tipo de cuenta', valor: est.tipo, opciones: [{ valor: 'banco', titulo: 'Banco' }, { valor: 'ahorro', titulo: 'Ahorro' }, { valor: 'efectivo', titulo: 'Efectivo' }], alCambiar: (v) => { est.tipo = v; pintar(); } }));
    chipFecha.replaceChildren(icono('calendar'), `Saldo al ${diaMes(est.fecha)} ${est.fecha.slice(0, 4)}`);
    recuperarFoco(); // el segmentado se reconstruye: sin esto el foco queda en <body> y Esc deja de cerrar la hoja
  };
  chipFecha.addEventListener('click', async () => { const v = await pedirFecha({ titulo: 'Fecha del saldo inicial', valor: est.fecha }); if (v) { est.fecha = v; pintar(); } });
  pintar();
  const guardar = boton(nueva ? 'Agregar cuenta' : 'Guardar cambios', {
    icono: 'check', clase: 'btn--lg btn--block',
    onClick: unSoloEnvio(() => {
      const campos = { nombre: nombre.value, tipo: est.tipo, saldoInicial: !nueva && !saldo.tocado() ? cuenta.saldoInicial : saldo.valor() ?? 0, fechaSaldoInicial: est.fecha, icono: est.tipo === 'efectivo' ? 'efectivo' : est.tipo === 'ahorro' ? 'ahorro' : 'banco' };
      const r = ejecutar(ctx, guardarCuenta, { cuenta: nueva ? campos : { id: cuenta.id, nombre: campos.nombre, tipo: campos.tipo, saldoInicial: campos.saldoInicial, fechaSaldoInicial: campos.fechaSaldoInicial } }, { exito: nueva ? 'Cuenta agregada' : 'Cuenta actualizada' });
      if (r.ok) hoja.cerrar();
      return r.ok;
    }),
  });
  // Q12: con historial la cuenta no se puede borrar; esto mueve TODO lo que la usa a otra cuenta (con confirmación) y la borra.
  async function reasignar() {
    const datos = ctx.tienda.datos();
    const destinos = datos.cuentas.filter((c) => c.id !== cuenta.id && !c.archivada && c.tipo !== 'credito');
    if (cuenta.tipo === 'credito' || !destinos.length) { mostrarAviso('No hay otra cuenta activa a la que mover los movimientos. Agrega una primero.', { tipo: 'warn' }); return; }
    const s = calcularSaldos(datos, ctx.reloj.hoy());
    const hacia = await abrirSelector({ titulo: 'Mover los movimientos a', opciones: destinos.map((c) => ({ valor: c.id, titulo: c.nombre, icono: c.icono, fin: pesos(s.cuentas[c.id]) })) });
    if (!hacia) return;
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
    if (!ok) return;
    if (!(await respaldarAntesDe(ctx, 'antes-de-reasignar-cuenta'))) return; // R2F-14: respaldo automático para poder volver atrás
    const r = ejecutar(ctx, reasignarCuenta, { desdeId: cuenta.id, haciaId: hacia }, { exito: 'Movimientos movidos y cuenta borrada' });
    if (r.ok) hoja.cerrar();
  }
  const usada = !nueva && (() => { const u = usosDeCuenta(ctx.tienda.datos(), cuenta.id); return u.movimientos > 0 || u.recurrentes > 0 || u.metas > 0 || u.ingreso; })();
  const acciones = nueva ? [] : [
    boton('Ajustar saldo', { icono: 'sliders', clase: 'btn--secondary', onClick: () => { hoja.cerrar(); abrirFormulario(ctx, { tipo: 'ajusteCuenta', preset: { tipo: 'ajusteCuenta', cuentaId: cuenta.id } }); } }),
    boton(cuenta.archivada ? 'Restaurar' : 'Archivar', { icono: cuenta.archivada ? 'restore' : 'trash', clase: 'btn--secondary', onClick: async () => {
      if (!cuenta.archivada) { const ok = await confirmar({ titulo: '¿Archivar esta cuenta?', mensaje: 'Dejará de ofrecerse al registrar movimientos, pero su historial y su saldo se conservan.', confirmar: 'Archivar' }); if (!ok) return; }
      const r = ejecutar(ctx, archivarCuenta, { id: cuenta.id, archivada: !cuenta.archivada }, { exito: cuenta.archivada ? 'Cuenta restaurada' : 'Cuenta archivada' });
      if (r.ok) hoja.cerrar();
    } }),
    usada && cuenta.tipo !== 'credito' ? boton('Mover movimientos a otra cuenta y borrar', { icono: 'swap', clase: 'btn--secondary', onClick: () => reasignar() }) : null,
    boton('Borrar', { icono: 'trash', clase: 'btn--danger-ghost', onClick: async () => {
      const ok = await confirmar({ titulo: '¿Borrar esta cuenta?', mensaje: 'Solo se puede borrar una cuenta sin movimientos ni usos. Si tiene historial, archívela o mueva sus movimientos a otra cuenta.', confirmar: 'Borrar', peligro: true });
      if (!ok) return;
      const r = ejecutar(ctx, borrarCuenta, { id: cuenta.id }, { exito: 'Cuenta borrada' });
      if (r.ok) hoja.cerrar();
    } }),
  ];
  const cuerpo = h('div', { class: 'sheet__body stack stack--lg' },
    h('div', { class: 'field' }, h('label', { class: 'field__label' }, 'Nombre'), nombre),
    zonaTipo, saldo.el, h('div', { class: 'chip-row' }, chipFecha),
    acciones.length ? h('div', { class: 'stack stack--sm' }, acciones) : null,
    h('p', { class: 'field__hint' }, 'La app no guarda números de tarjeta ni de cuenta.'));
  const hoja = abrirHoja([cuerpo, h('div', { class: 'sheet__foot' }, guardar)], { titulo: nueva ? 'Agregar cuenta' : `Editar ${cuenta.nombre}` });
}

function dibujar(ctx) {
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
    const sub = credito ? 'Crédito · saldo de la deuda' : c.tipo === 'efectivo' ? 'Efectivo · saldo calculado' : `${c.tipo === 'ahorro' ? 'Ahorro' : 'Banco'} · saldo calculado`;
    const contenido = [
      h('span', { class: 'item__icon' }, icono(c.icono)),
      h('span', { class: 'item__main' }, h('span', { class: 'item__title', style: { display: 'block' } }, c.nombre, c.archivada ? [' ', h('span', { class: 'badge' }, 'Archivada')] : null), h('span', { class: 'item__sub', style: { display: 'block' } }, sub), credito ? h('span', { class: 'badge badge--info', style: { marginTop: '4px' } }, icono('link'), 'Vinculada a Deudas') : null),
      h('span', { class: `item__end money ${credito || valor < 0 ? 'money--debt' : ''}` }, pesos(valor)),
    ];
    return credito
      ? h('a', { class: 'item', href: '#/deudas', aria: { label: `${c.nombre}: ${pesos(valor)}. Abrir Deudas` } }, contenido)
      : h('button', { class: 'item', type: 'button', on: { click: () => abrirEditorCuenta(ctx, c) }, aria: { label: `Editar ${c.nombre}: ${pesos(valor)}` } }, contenido);
  };
  const activas = datos.cuentas.filter((c) => !c.archivada).sort((a, b) => a.orden - b.orden);
  const archivadas = datos.cuentas.filter((c) => c.archivada).sort((a, b) => a.orden - b.orden);
  return [
    h('section', { class: 'card card--hero networth', aria: { labelledby: 'pn-t' } },
      h('span', { class: 't-label', id: 'pn-t' }, 'Patrimonio neto'),
      h('div', { class: `hero__amount num${p.patrimonio < 0 ? ' danger' : ''}` }, pesos(p.patrimonio)),
      h('p', { class: 't-small muted' }, `Cuentas ${pesos(p.activos)} − deudas ${pesos(p.pasivos)}`)),
    h('section', { class: 'acct-total', aria: { label: 'Totales' } },
      h('div', { class: 'card card--tight' }, h('div', { class: 'kpi' }, h('span', { class: 'kpi__v num' }, pesos(p.activos)), h('span', { class: 'kpi__l' }, 'En cuentas'))),
      h('div', { class: 'card card--tight' }, h('div', { class: 'kpi' }, h('span', { class: 'kpi__v num' }, pesos(apartado)), h('span', { class: 'kpi__l' }, 'Apartado para metas')))),
    h('section', { class: 'card', aria: { labelledby: 'ct-t' } },
      h('h2', { class: 't-h', id: 'ct-t', style: { marginBottom: 'var(--sp-1)' } }, 'Mis cuentas'),
      h('div', { class: 'list' }, activas.map(fila))),
    h('div', { class: 'grid-2' },
      h('button', { class: 'btn btn--sm', type: 'button', on: { click: () => { if (activas.filter((c) => c.tipo !== 'credito').length < 2) { mostrarAviso('Agrega otra cuenta para poder transferir entre cuentas', { tipo: 'warn' }); return; } abrirFormulario(ctx, { tipo: 'transferencia' }); } } }, icono('swap'), 'Transferir'),
      h('button', { class: 'btn btn--secondary btn--sm', type: 'button', on: { click: () => abrirEditorCuenta(ctx, null) } }, icono('plus'), 'Agregar cuenta')),
    archivadas.length ? h('section', { class: 'card' }, h('h2', { class: 't-h', style: { marginBottom: 'var(--sp-1)' } }, `Archivadas (${archivadas.length})`), h('div', { class: 'list' }, archivadas.map(fila))) : null,
    h('div', { class: 'callout' }, icono('info'), h('div', null, h('span', { class: 'callout__title' }, 'La tarjeta cuenta una sola vez'), h('br'), `Aparece aquí como cuenta de crédito, pero su saldo vive en Deudas; el patrimonio resta ${pesos(p.pasivos)} de deudas sin duplicar la tarjeta.`)),
    programados ? h('p', { class: 't-caption' }, `${programados} movimiento${programados === 1 ? '' : 's'} con fecha futura no suma${programados === 1 ? '' : 'n'} a los saldos hasta su fecha.`) : null,
    h('p', { class: 'note-legal' }, 'Los saldos se calculan desde el saldo inicial, los movimientos y las transferencias. La app no guarda números de tarjeta ni de cuenta.'),
  ];
}

