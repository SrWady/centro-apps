/*
 * deudas.js — saldo, cuota y fecha estimada de pago total con amortización consciente de intereses; simulador de abono;
 * avalancha vs. bola de nieve; registro de pagos que reduce el saldo. Cálculos: logica/deudas.js (ESQUEMA §6).
 * "Herramienta personal de seguimiento; no constituye asesoría financiera."
 */
import { h, icono, poner, crearVista, pesos, porcentaje, fechaCorta, diaMes, estadoVacio, ejecutar, boton, campoPesos, segmentado, cantidad, capitalizar, mostrarAviso, recuperarFoco, unSoloEnvio } from './comun.js';
import { formatearNumero, parsearDecimal } from '../../shared/lib/numeros.js';
import { formatearFecha } from '../../shared/lib/fechas.js';
import { abrirHoja, confirmar } from '../../shared/ui/hoja.js';
import { abrirFormulario } from './agregar.js';
import { estadoCiclo } from '../logica/periodo.js';
import { calcularSaldos, estadoDeuda } from '../logica/saldos.js';
import { tasaMensual, equivalenteEA, LIMITE_EA, LIMITE_MV } from '../logica/tasas.js';
import { proyectar, simularAbono, compararEstrategias, interesPeriodo, cuotasSinInteres } from '../logica/deudas.js';
import { primeraCuotaPendiente, proximosPagos } from '../logica/recurrentes.js';
import { resumenCiclo } from '../logica/presupuesto.js';
import { guardarDeuda, archivarDeuda } from '../logica/acciones.js';

const mesAnio = (f) => capitalizar(formatearFecha(f, 'mes-anio'));

export function tasaTexto(tasa) {
  if (!tasa) return null;
  if (tasa.tipo === 'EA') return `${formatearNumero(tasa.porcentaje, { maxDecimales: 2 })} % E.A. (≈ ${formatearNumero(tasaMensual(tasa) * 100, { maxDecimales: 2, minDecimales: 2 })} % M.V.)`;
  return `${formatearNumero(tasa.porcentaje, { maxDecimales: 2 })} % M.V. (≈ ${formatearNumero(equivalenteEA(tasa) * 100, { maxDecimales: 1 })} % E.A.)`;
}

export function montar(raiz, ctx) {
  const sim = { deudaId: null, abono: 1000000, extra: 0, extraEstrategia: null };
  const vista = crearVista(raiz, () => dibujar(ctx, sim, () => vista.actualizar()));
  return vista;
}

function proyeccionDeuda(datos, deuda, saldo, hoy, usadas) {
  return proyectar({ saldo: Math.max(0, saldo), cuota: deuda.cuota, tasaMensual: tasaMensual(deuda.tasa), primeraFecha: primeraCuotaPendiente(datos, deuda, hoy, usadas), diaPago: deuda.diaPago });
}

function abrirAmortizacion(deuda, proy) {
  let visibles = 24;
  const cuerpo = h('div', { class: 'sheet__body' });
  const dibujar = () => {
    poner(cuerpo, 
      h('p', { class: 't-small muted', style: { marginBottom: 'var(--sp-3)' } }, deuda.tasa ? `Interés = saldo × tasa mensual (${formatearNumero(tasaMensual(deuda.tasa) * 100, { maxDecimales: 4 })} %), redondeado al peso una vez por mes.` : 'Sin tasa registrada: no se incluyen intereses (la proyección es optimista).'),
      h('div', { class: 'list' }, [
        h('div', { class: 'item', style: { minHeight: '36px' } }, h('span', { class: 'item__main t-label' }, 'Pago'), h('span', { class: 't-label', style: { width: '86px', textAlign: 'right' } }, 'Interés'), h('span', { class: 't-label', style: { width: '96px', textAlign: 'right' } }, 'Saldo')),
        ...proy.filas.slice(0, visibles).map((f) => h('div', { class: 'item', style: { minHeight: '52px' } },
          h('span', { class: 'item__main' }, h('span', { class: 'item__title num', style: { display: 'block' } }, pesos(f.pago)), h('span', { class: 'item__sub', style: { display: 'block' } }, `${f.n}. ${f.fecha ? diaMes(f.fecha) + ' ' + f.fecha.slice(0, 4) : ''}`)),
          h('span', { class: 'money t-small muted', style: { width: '86px', textAlign: 'right' } }, pesos(f.interes)),
          h('span', { class: 'money t-small', style: { width: '96px', textAlign: 'right' } }, pesos(f.saldoFinal)))),
      ]),
      proy.filas.length > visibles ? h('button', { class: 'btn btn--secondary btn--block', type: 'button', style: { marginTop: 'var(--sp-3)' }, on: { click: () => { visibles += 24; dibujar(); } } }, `Mostrar más (${proy.filas.length - visibles} meses)`) : null,
      h('p', { class: 'note-legal' }, 'Herramienta personal de seguimiento; no constituye asesoría financiera.'));
  };
  dibujar();
  abrirHoja([cuerpo], { titulo: `Amortización · ${deuda.nombre}` });
}

/** Editor de deuda (crear o editar). `enfocarTasa` abre listo para escribir la tasa. */
export function abrirEditorDeuda(ctx, deuda, { enfocarTasa = false } = {}) {
  const nueva = !deuda;
  const est = {
    tipo: deuda?.tipo ?? 'credito', tasaTipo: deuda?.tasa?.tipo ?? (enfocarTasa ? 'MV' : 'ninguna'),
  };
  const nombre = h('input', { class: 'input', type: 'text', value: deuda?.nombre ?? '', attrs: { maxlength: 40, 'aria-label': 'Nombre de la deuda', autocomplete: 'off', placeholder: 'Ej.: Crédito de libre destino' } });
  const entidad = h('input', { class: 'input', type: 'text', value: deuda?.entidad ?? '', attrs: { maxlength: 40, 'aria-label': 'Entidad', autocomplete: 'off', placeholder: 'Ej.: Mi banco' } });
  const saldo = campoPesos({ etiqueta: nueva ? 'Saldo actual' : 'Saldo inicial (al registrar)', valor: deuda?.saldoInicial ?? null, id: 'd-saldo', ayuda: nueva ? undefined : 'Para cuadrar con el extracto usa "Ajustar saldo"; esto cambia el punto de partida.' });
  const cuota = campoPesos({ etiqueta: 'Cuota mensual', valor: deuda?.cuota ?? null, id: 'd-cuota', ayuda: 'En una tarjeta, el pago que planeas hacer (hoy, el mínimo).' });
  const dia = h('input', { class: 'input num', type: 'number', value: deuda?.diaPago ?? 1, attrs: { min: 1, max: 31, inputmode: 'numeric', 'aria-label': 'Día de pago' } });
  const porcentajeEntrada = h('input', { class: 'input num', type: 'text', value: deuda?.tasa ? formatearNumero(deuda.tasa.porcentaje, { maxDecimales: 6 }) : '', attrs: { inputmode: 'decimal', 'aria-label': 'Porcentaje de la tasa', autocomplete: 'off', placeholder: 'Ej.: 24 o 1,95' } });
  const notas = h('input', { class: 'input', type: 'text', value: deuda?.notas ?? '', attrs: { maxlength: 200, 'aria-label': 'Notas', autocomplete: 'off' } });
  const zonaTipo = h('div');
  const zonaTasa = h('div', { class: 'stack stack--sm' });
  const dibujarTipo = () => { poner(zonaTipo, nueva ? segmentado({ etiqueta: 'Tipo de deuda', valor: est.tipo, opciones: [{ valor: 'tarjeta', titulo: 'Tarjeta' }, { valor: 'credito', titulo: 'Crédito' }, { valor: 'otro', titulo: 'Otra' }], alCambiar: (v) => { est.tipo = v; dibujarTipo(); } }) : h('span', { class: 'badge' }, { tarjeta: 'Tarjeta de crédito', credito: 'Crédito', otro: 'Otra deuda' }[est.tipo])); recuperarFoco(); };
  const dibujarTasa = () => {
    poner(zonaTasa, 
      segmentado({ etiqueta: 'Tipo de tasa', valor: est.tasaTipo, opciones: [{ valor: 'ninguna', titulo: 'Sin tasa' }, { valor: 'EA', titulo: 'E.A.' }, { valor: 'MV', titulo: 'M.V.' }], alCambiar: (v) => { est.tasaTipo = v; dibujarTasa(); } }),
      est.tasaTipo === 'ninguna'
        ? h('p', { class: 'field__hint' }, 'Sin tasa, la proyección no incluye intereses y será optimista.')
        : [h('div', { class: 'field' }, h('label', { class: 'field__label' }, est.tasaTipo === 'EA' ? 'Tasa efectiva anual (% E.A.)' : 'Tasa mensual vencida (% M.V.)'), porcentajeEntrada),
          h('p', { class: 'field__hint' }, est.tasaTipo === 'EA' ? `Hasta ${LIMITE_EA} %. Se convierte a mensual como (1 + E.A.)^(1/12) − 1; nunca se divide entre 12.` : `Hasta ${LIMITE_MV} %. Si su extracto muestra una tasa N.M.V. anual (nominal mes vencido), divídala entre 12.`)]);
    recuperarFoco(); // el segmentado se reconstruye al elegirlo: el foco no puede quedar en <body> (Esc dejaría de cerrar la hoja)
  };
  dibujarTipo();
  dibujarTasa();
  const guardar = boton(nueva ? 'Agregar deuda' : 'Guardar cambios', {
    icono: 'check', clase: 'btn--lg btn--block',
    onClick: unSoloEnvio(() => {
      let tasa = null;
      if (est.tasaTipo !== 'ninguna') {
        const p = parsearDecimal(porcentajeEntrada.value);
        if (p === null) { mostrarAviso('Escribe el porcentaje de la tasa o elige "Sin tasa"', { tipo: 'warn' }); return false; }
        tasa = { tipo: est.tasaTipo, porcentaje: p };
      }
      const saldoV = saldo.valor();
      const cuotaV = cuota.valor();
      if (saldoV === null) { mostrarAviso('Escribe el saldo', { tipo: 'warn' }); return false; }
      if (cuotaV === null || cuotaV === 0) { mostrarAviso('Escribe la cuota mensual', { tipo: 'warn' }); return false; }
      const campos = { nombre: nombre.value, entidad: entidad.value, saldoInicial: saldoV, cuota: cuotaV, diaPago: Number(dia.value), tasa, notas: notas.value };
      const r = ejecutar(ctx, guardarDeuda, { deuda: nueva ? { ...campos, tipo: est.tipo } : { id: deuda.id, ...campos } }, { exito: nueva ? 'Deuda agregada' : 'Deuda actualizada' });
      if (r.ok) hoja.cerrar();
      return r.ok;
    }),
  });
  const cuerpo = h('div', { class: 'sheet__body stack stack--lg' },
    zonaTipo,
    h('div', { class: 'field' }, h('label', { class: 'field__label' }, 'Nombre'), nombre),
    h('div', { class: 'field' }, h('label', { class: 'field__label' }, 'Entidad'), entidad),
    saldo.el, cuota.el,
    h('div', { class: 'field' }, h('label', { class: 'field__label' }, 'Día de pago de cada mes (1–31)'), dia, h('span', { class: 'field__hint' }, 'Si el mes no tiene ese día, se toma el último día del mes.')),
    zonaTasa,
    h('div', { class: 'field' }, h('label', { class: 'field__label' }, 'Notas (opcional)'), notas));
  const pie = h('div', { class: 'sheet__foot' }, guardar);
  const hoja = abrirHoja([cuerpo, pie], { titulo: nueva ? 'Agregar deuda' : `Editar ${deuda.nombre}` });
  if (enfocarTasa) setTimeout(() => porcentajeEntrada.focus(), 350);
  return hoja;
}

function dibujar(ctx, sim, redibujar) {
  const datos = ctx.tienda.datos();
  const hoy = ctx.reloj.hoy();
  const est = estadoCiclo(datos, hoy);
  const res = resumenCiclo(datos, est.ciclo, hoy);
  const saldos = calcularSaldos(datos, hoy);
  const usadas = new Set(datos.movimientos.filter((m) => m.origen).map((m) => `${m.origen.tipo}|${m.origen.id}|${m.origen.ocurrencia}`));
  const activas = datos.deudas.filter((d) => !d.archivada);
  const vivas = activas.filter((d) => saldos.deudas[d.id] > 0);
  const pagosProgramados = proximosPagos(datos, hoy, est.ciclo, saldos);
  ctx.shell.titulo('Deudas', 'Seguimiento y simuladores');
  ctx.shell.fab(false);
  const nodos = [];

  const total = activas.reduce((s, d) => s + saldos.deudas[d.id], 0);
  const iniciales = activas.reduce((s, d) => s + d.saldoInicial, 0);
  const cuotasCiclo = vivas.reduce((s, d) => s + d.cuota, 0);
  nodos.push(h('section', { class: 'card card--hero', aria: { labelledby: 'dt-t' } },
    h('span', { class: 't-label', id: 'dt-t' }, 'Deuda total'),
    h('div', { class: 'hero__amount num' }, pesos(total)),
    h('div', { class: 'hero__row' }, h('span', { class: 'badge badge--accent' }, `Cuotas del ciclo ${pesos(cuotasCiclo)}`), res.base.monto > 0 ? h('span', { class: 't-small muted' }, `${porcentaje(cuotasCiclo / res.base.monto)} del ingreso`) : null),
    h('p', { class: 'hero__calc' }, `Saldo inicial: ${pesos(iniciales)}. Baja con los pagos de capital y sube con las compras de la tarjeta.`)));

  const sinTasa = vivas.filter((d) => !d.tasa);
  if (!activas.length) {
    nodos.push(h('section', { class: 'card' }, estadoVacio({ icono: 'card', titulo: 'No tienes deudas registradas', texto: 'Agrega una para ver su fecha de pago total y simular abonos.' })));
  } else if (sinTasa.length) {
    nodos.push(h('div', { class: 'callout callout--warn' }, icono('alert'), h('div', null, h('span', { class: 'callout__title' }, sinTasa.length === vivas.length ? 'Faltan las tasas' : `Falta la tasa de ${sinTasa.map((d) => d.nombre.toLowerCase()).join(' y ')}`), h('br'), 'Sin tasa, las proyecciones se calculan sin intereses y son optimistas. Agrega la tasa (E.A. o M.V.) de cada deuda.')));
  }

  // --- Una tarjeta por deuda ---
  for (const d of activas) {
    const saldo = saldos.deudas[d.id];
    const estadoD = estadoDeuda(saldo);
    const proy = proyeccionDeuda(datos, d, saldo, hoy, usadas);
    const i = tasaMensual(d.tasa);
    const pendiente = pagosProgramados.find((p) => p.tipo === 'cuota' && p.id === d.id);
    let proyTexto;
    if (estadoD === 'saldada') proyTexto = h('p', { class: 't-small ok' }, 'Deuda saldada.');
    else if (estadoD === 'a-favor') proyTexto = h('p', { class: 't-small' }, `Tienes un saldo a favor de ${pesos(-saldo)}.`);
    else if (proy.estado === 'no-amortiza') proyTexto = h('div', { class: 'callout callout--danger', style: { marginTop: 'var(--sp-3)' } }, icono('alert'), h('div', null, `La cuota (${pesos(d.cuota)}) no cubre el interés del mes (≈ ${pesos(interesPeriodo(saldo, i))}): la deuda crece. Sube la cuota o revisa la tasa.`));
    else if (proy.estado === 'excede-limite') proyTexto = h('p', { class: 't-small muted' }, 'Con esta cuota tardarías más de 50 años en pagarla.');
    else if (d.tasa) proyTexto = h('p', { class: 't-small muted' }, 'Solo con la cuota: te libras en ', h('b', null, cantidad(proy.meses, 'mes', 'meses')), ` (${mesAnio(proy.fechaFin)}), pagando ≈ ${pesos(proy.totalIntereses)} en intereses.`);
    else { const s = cuotasSinInteres(saldo, d.cuota); proyTexto = h('p', { class: 't-small muted' }, 'Solo con la cuota: ≈ ', h('b', null, cantidad(s.meses, 'mes', 'meses')), ` (${mesAnio(proy.fechaFin)}) sin contar intereses (no hay tasa registrada). Último pago ${pesos(s.ultimoPago)}.`); }

    nodos.push(h('section', { class: 'card debt', aria: { label: d.nombre } },
      h('div', { class: 'debt__top' },
        h('div', null, h('span', { class: 't-label' }, d.nombre), h('div', { class: 't-title num', style: { fontSize: 'var(--fs-xl)' } }, pesos(saldo)), h('div', { class: 't-caption' }, `${d.entidad ? `${d.entidad} · ` : ''}Saldo inicial ${diaMes(d.fechaSaldoInicial)}: ${pesos(d.saldoInicial)}`)),
        h('span', { class: `badge ${estadoD === 'saldada' ? 'badge--ok' : 'badge--info'}` }, estadoD === 'saldada' ? 'Saldada' : [icono('calendar'), `Día ${d.diaPago} de cada mes`])),
      h('div', { class: 'debt__facts' },
        h('div', { class: 'fact' }, h('span', { class: 'fact__l' }, 'Cuota mensual'), h('span', { class: 'fact__v' }, pesos(d.cuota))),
        h('div', { class: 'fact' }, h('span', { class: 'fact__l' }, 'Tasa'), h('span', { class: 'fact__v', style: { fontSize: 'var(--fs-sm)' } }, d.tasa ? tasaTexto(d.tasa) : h('span', { class: 'badge badge--warn' }, 'Sin tasa'))),
        h('div', { class: 'fact' }, h('span', { class: 'fact__l' }, 'Interés del mes'), h('span', { class: 'fact__v' }, d.tasa && saldo > 0 ? `≈ ${pesos(interesPeriodo(saldo, i))}` : '—'))),
      h('div', { style: { marginTop: 'var(--sp-3)' } }, proyTexto),
      d.notas ? h('p', { class: 't-caption', style: { marginTop: 'var(--sp-2)' } }, d.notas) : null,
      h('div', { class: 'grid-2', style: { marginTop: 'var(--sp-3)' } },
        estadoD === 'saldada' ? h('button', { class: 'btn btn--sm btn--secondary', type: 'button', on: { click: async () => { const ok = await confirmar({ titulo: '¿Archivar esta deuda?', mensaje: `${d.nombre} está saldada. Dejará de aparecer aquí; su historial se conserva.`, confirmar: 'Archivar' }); if (ok) ejecutar(ctx, archivarDeuda, { id: d.id }, { exito: 'Deuda archivada' }); } } }, icono('check'), 'Archivar')
          : h('button', { class: 'btn btn--sm', type: 'button', on: { click: () => abrirFormulario(ctx, pendiente
            ? { tipo: 'pagoDeuda', origen: { tipo: 'cuota', id: d.id, ocurrencia: pendiente.ocurrencia }, preset: { tipo: 'pagoDeuda', deudaId: d.id, monto: pendiente.monto, interes: pendiente.interes, interesManual: true, modo: 'cuota', cuentaId: pendiente.cuentaId }, titulo: `Pagar ${d.nombre.toLowerCase()}` }
            : { tipo: 'pagoDeuda', preset: { tipo: 'pagoDeuda', deudaId: d.id, modo: 'abono' }, titulo: `Abonar a ${d.nombre.toLowerCase()}` }) } }, icono('check'), pendiente ? 'Registrar pago' : 'Abonar'),
        d.tasa ? h('button', { class: 'btn btn--secondary btn--sm', type: 'button', on: { click: () => { sim.deudaId = d.id; redibujar(); setTimeout(() => document.getElementById('sim-t')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); } } }, icono('trend'), 'Simular abono')
          : h('button', { class: 'btn btn--secondary btn--sm', type: 'button', on: { click: () => abrirEditorDeuda(ctx, d, { enfocarTasa: true }) } }, icono('plus'), 'Agregar tasa')),
      h('div', { class: 'cluster', style: { marginTop: 'var(--sp-2)', gap: '4px' } },
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', on: { click: () => abrirEditorDeuda(ctx, d) } }, icono('pencil'), 'Editar'),
        proy.filas.length ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button', on: { click: () => abrirAmortizacion(d, proy) } }, icono('list'), 'Amortización') : null,
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', on: { click: () => abrirFormulario(ctx, { tipo: 'ajusteDeuda', preset: { tipo: 'ajusteDeuda', deudaId: d.id } }) } }, icono('sliders'), 'Ajustar saldo'))));
  }

  // --- Simulador de abono ---
  if (vivas.length) {
    if (!vivas.some((d) => d.id === sim.deudaId)) sim.deudaId = [...vivas].sort((a, b) => saldos.deudas[b.id] - saldos.deudas[a.id])[0].id;
    const dSim = vivas.find((d) => d.id === sim.deudaId);
    const resultado = h('div');
    const calcular = () => {
      const saldoSim = saldos.deudas[dSim.id];
      const r = simularAbono({ saldo: saldoSim, cuota: dSim.cuota, tasa: dSim.tasa, diaPago: dSim.diaPago }, { abonoUnico: Math.min(sim.abono, saldoSim), extraMensual: sim.extra }, { primeraFecha: primeraCuotaPendiente(datos, dSim, hoy, usadas) });
      resultado.replaceChildren();
      if (!r.comparable) {
        resultado.append(h('div', { class: 'callout callout--danger' }, icono('alert'), h('div', null, r.base.estado === 'no-amortiza' ? `Con la cuota actual la deuda no baja: el interés del mes (≈ ${pesos(interesPeriodo(saldoSim, tasaMensual(dSim.tasa)))}) es mayor que la cuota. Un abono extra mensual puede cambiarlo.` : 'No se puede estimar el ahorro con estos datos.')));
        return;
      }
      const meses = (p) => (p.estado === 'saldada' ? 'Saldada' : cantidad(p.meses, 'mes', 'meses'));
      poner(resultado, 
        h('div', { class: 'compare' },
          h('div', { class: 'compare__col' }, h('div', { class: 't-caption' }, 'Sin abono'), h('div', { class: 't-h' }, meses(r.base)), h('div', { class: 't-small muted num' }, dSim.tasa ? `Intereses ${pesos(r.base.totalIntereses)}` : 'sin intereses'), r.base.fechaFin ? h('div', { class: 't-caption' }, mesAnio(r.base.fechaFin)) : null),
          h('div', { class: 'compare__col compare__col--best' }, h('div', { class: 't-caption' }, 'Con abono'), h('div', { class: 't-h' }, meses(r.conAbono)), h('div', { class: 't-small num' }, dSim.tasa ? `Intereses ${pesos(r.conAbono.totalIntereses)}` : 'sin intereses'), r.conAbono.fechaFin ? h('div', { class: 't-caption' }, mesAnio(r.conAbono.fechaFin)) : null)),
        dSim.tasa
          ? h('p', { class: 't-small', style: { marginTop: 'var(--sp-3)' } }, 'Ahorras ≈ ', h('b', { class: 'ok num' }, pesos(r.interesesAhorrados)), ' en intereses y terminas ', h('b', { class: 'ok' }, cantidad(r.mesesAhorrados, 'mes', 'meses')), ' antes.')
          : h('p', { class: 't-small muted', style: { marginTop: 'var(--sp-3)' } }, `Terminas ${cantidad(r.mesesAhorrados, 'mes', 'meses')} antes. Sin tasa registrada no se puede estimar cuánto ahorras en intereses.`));
    };
    const abono = campoPesos({ etiqueta: 'Abono único ahora', valor: sim.abono, id: 'sim-abono', alCambiar: (v) => { sim.abono = v ?? 0; calcular(); } });
    const extra = campoPesos({ etiqueta: 'Abono extra cada mes', valor: sim.extra || null, id: 'sim-extra', ayuda: 'Se suma a la cuota todos los meses.', alCambiar: (v) => { sim.extra = v ?? 0; calcular(); } });
    nodos.push(h('section', { class: 'card stack', aria: { labelledby: 'sim-t' } },
      h('div', { class: 'card__head', style: { marginBottom: 0 } }, h('div', null, h('span', { class: 't-label' }, 'Simulador de abono'), h('h2', { class: 't-h', id: 'sim-t' }, `Abono a ${dSim.nombre.toLowerCase()}`)), h('span', { class: 'item__icon item__icon--accent' }, icono('trend'))),
      vivas.length > 1 ? h('div', { class: 'chip-row', role: 'group', aria: { label: 'Deuda a simular' } }, vivas.map((d) => h('button', { class: 'chip', type: 'button', aria: { pressed: String(d.id === sim.deudaId) }, on: { click: () => { sim.deudaId = d.id; redibujar(); } } }, d.nombre))) : null,
      h('div', { class: 'grid-2' }, abono.el, extra.el),
      resultado));
    calcular();

    // --- Avalancha vs. bola de nieve ---
    const abonoPresupuesto = res.lineas.find((l) => l.categoria.vinculo === 'abono-deudas')?.asignado ?? 0;
    if (sim.extraEstrategia === null) sim.extraEstrategia = abonoPresupuesto;
    const cuadro = h('div');
    const comparar = () => {
      const entrada = vivas.map((d) => ({ id: d.id, nombre: d.nombre, saldo: saldos.deudas[d.id], cuota: d.cuota, tasaMensual: tasaMensual(d.tasa) }));
      const r = compararEstrategias(entrada, sim.extraEstrategia);
      cuadro.replaceChildren();
      const nombre = (id) => vivas.find((d) => d.id === id)?.nombre.toLowerCase() ?? id;
      const col = (titulo, sub, x, mejor) => h('div', { class: `compare__col${mejor ? ' compare__col--best' : ''}` }, h('div', { class: 't-label' }, titulo), h('div', { class: 't-caption' }, sub), x.estado === 'ok' ? [h('div', { class: 't-h', style: { marginTop: '6px' } }, cantidad(x.meses, 'mes', 'meses')), h('div', { class: 't-small num' }, r.todasSinTasa ? 'Intereses: sin tasa' : `Intereses ${pesos(x.totalIntereses)}`)] : h('div', { class: 't-small danger', style: { marginTop: '6px' } }, x.estado === 'no-amortiza' ? 'No amortiza: el presupuesto no cubre los intereses' : 'Más de 50 años'));
      const ok = r.avalancha.estado === 'ok' && r.bolaDeNieve.estado === 'ok';
      const mejorAva = ok && !r.todasSinTasa && r.avalancha.totalIntereses <= r.bolaDeNieve.totalIntereses;
      const mejorBola = ok && !r.todasSinTasa && !mejorAva;
      poner(cuadro, 
        h('div', { class: 'compare' },
          col('Avalancha', `Mayor tasa primero (${nombre(r.avalancha.orden[0] ?? '')})`, r.avalancha, mejorAva || (ok && r.todasSinTasa)),
          col('Bola de nieve', `Menor saldo primero (${nombre(r.bolaDeNieve.orden[0] ?? '')})`, r.bolaDeNieve, mejorBola || (ok && r.todasSinTasa))),
        r.todasSinTasa
          ? h('div', { class: 'callout callout--warn', style: { marginTop: 'var(--sp-3)' } }, icono('alert'), h('div', null, 'Sin tasas, las dos estrategias dan lo mismo. Agrega la tasa de cada deuda (E.A. o M.V.) para ver la diferencia.'))
          : r.advertencias.length ? h('div', { class: 'callout callout--warn', style: { marginTop: 'var(--sp-3)' } }, icono('alert'), h('div', null, r.advertencias.join('. '))) : null,
        r.soloCuotas.estado === 'ok' && ok ? h('p', { class: 't-caption', style: { marginTop: 'var(--sp-3)' } }, `Solo con las cuotas: ${cantidad(r.soloCuotas.meses, 'mes', 'meses')}${r.todasSinTasa ? '' : ` y ≈ ${pesos(r.soloCuotas.totalIntereses)} en intereses. Con ${mejorBola ? 'bola de nieve' : 'avalancha'} ahorras ≈ ${pesos(r.soloCuotas.totalIntereses - Math.min(r.avalancha.totalIntereses, r.bolaDeNieve.totalIntereses))}`}.`) : null);
    };
    const extraEst = campoPesos({ etiqueta: 'Abono extra mensual', valor: sim.extraEstrategia || null, id: 'est-extra', ayuda: `Por omisión, el presupuesto de "Abono extra a deudas" del ciclo (${pesos(abonoPresupuesto)}).`, alCambiar: (v) => { sim.extraEstrategia = v ?? 0; comparar(); } });
    nodos.push(h('section', { class: 'card stack', aria: { labelledby: 'est-t' } },
      h('div', { class: 'card__head', style: { marginBottom: 0 } }, h('div', null, h('span', { class: 't-label' }, 'Estrategia'), h('h2', { class: 't-h', id: 'est-t' }, 'Avalancha vs. bola de nieve'))),
      h('p', { class: 't-small muted' }, 'Con el abono extra sobre las cuotas, reutilizando la cuota de la deuda que se termina.'),
      extraEst.el, cuadro));
    comparar();
  }

  // --- Pagos del ciclo ---
  const pagos = datos.movimientos.filter((m) => m.tipo === 'pagoDeuda' && m.fecha >= est.rango.inicio && m.fecha <= est.rango.fin).sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const nombreDeuda = new Map(datos.deudas.map((d) => [d.id, d.nombre]));
  const abonoLinea = res.lineas.find((l) => l.categoria.vinculo === 'abono-deudas');
  nodos.push(h('section', { class: 'card', aria: { labelledby: 'pg-t' } },
    h('h2', { class: 't-h', id: 'pg-t', style: { marginBottom: 'var(--sp-2)' } }, 'Pagos del ciclo'),
    pagos.length
      ? h('div', { class: 'list' }, pagos.map((m) => h('button', { class: 'item', type: 'button', on: { click: () => abrirFormulario(ctx, { movimiento: m }) }, aria: { label: `Editar pago de ${nombreDeuda.get(m.deudaId)}` } },
        h('span', { class: 'item__icon' }, icono('check')),
        h('span', { class: 'item__main' }, h('span', { class: 'item__title', style: { display: 'block' } }, `${m.nota || (nombreDeuda.get(m.deudaId) ?? 'Pago')}`), h('span', { class: 'item__sub', style: { display: 'block' } }, `${fechaCorta(m.fecha)}${m.interes ? ` · intereses ${pesos(m.interes)}` : ''}`)),
        h('span', { class: 'item__end money' }, pesos(m.monto)))))
      : h('p', { class: 't-small muted' }, 'Aún no registras pagos de deuda en este ciclo.'),
    abonoLinea ? h('p', { class: 't-caption', style: { marginTop: 'var(--sp-2)' } }, `Abono extra del ciclo (${pesos(abonoLinea.asignado)}): ${abonoLinea.ejecutado === 0 ? 'pendiente' : `ejecutado ${pesos(abonoLinea.ejecutado)}`}.`) : null));

  nodos.push(h('button', { class: 'btn btn--secondary btn--block', type: 'button', on: { click: () => abrirEditorDeuda(ctx, null) } }, icono('plus'), 'Agregar deuda'));
  nodos.push(h('p', { class: 'note-legal' }, 'Herramienta personal de seguimiento; no constituye asesoría financiera.'));
  return nodos;
}
