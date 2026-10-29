/*
 * ajustes.js — ingreso, día de pago, metas 50/30/20 y alertas, categorías, recurrentes, preferencias, pasar datos a otro
 * celular (exportar/importar JSON con validación y confirmación; ver datos.js) y borrar todo (hoja de confirmación).
 * No hay recordatorios de respaldo: solo "Pasar datos a otro celular". Nunca se piden números de tarjeta ni de cuenta.
 */
import { h, icono, crearVista, pesos, nombreCiclo, cantidad, ejecutar, boton, campoPesos, stepperControl, interruptor, abrirSelector, mostrarAviso, barra, fechaLarga } from './comun.js';
import { configurarHaptica } from '../../shared/ui/haptica.js';
import { formatearNumero } from '../../shared/lib/numeros.js';
import { cicloSiguiente, rangoCiclo } from '../../shared/lib/ciclos.js';
import { aplicarDiaPago, estadoCiclo, etiquetaRango, fechaLocalDeInstante } from '../logica/periodo.js';
import { guardarAjustes, guardarIngresoPlaneado, cambiarDiaPago } from '../logica/acciones.js';
import { abrirCategorias, abrirEditorRecurrente } from './editores.js';
import { exportar, abrirImportar, restaurarRespaldo, descartarRespaldo, borrarTodo, TEXTO_RESPALDOS, TEXTOS_BORRAR_TODO } from './datos.js';

/** Espera sin cambios antes de guardar los steppers de metas y alertas (R1F-18: cada guardado revalida y serializa todo). */
export const ESPERA_GUARDADO_MS = 500;

export function montar(raiz, ctx) {
  // Los steppers no se reconstruyen mientras se guardan sus cambios (el que se está pulsando debe seguir vivo):
  // los cambios que origina esta misma pantalla no la redibujan.
  const estado = { steppers: [], suprimir: 0, pendientes: new Map(), temporizador: null };
  const sinRedibujar = (fn) => { estado.suprimir += 1; try { return fn(); } finally { estado.suprimir -= 1; } };
  const destruirSteppers = () => { for (const s of estado.steppers.splice(0)) s.ctrl.destruir(); };
  // Guardado con espera (R1F-18): mantener pulsado un stepper no escribe en cada paso, solo al quedar quieto ~0,5 s, al ocultar la
  // app (cambio de pestaña, bloqueo, cierre), antes de redibujar y al salir de la pantalla.
  estado.vaciar = () => {
    clearTimeout(estado.temporizador);
    estado.temporizador = null;
    const guardar = [...estado.pendientes.values()];
    estado.pendientes.clear();
    for (const fn of guardar) fn();
  };
  estado.conEspera = (clave, fn) => {
    estado.pendientes.set(clave, fn);
    clearTimeout(estado.temporizador);
    estado.temporizador = setTimeout(estado.vaciar, ESPERA_GUARDADO_MS);
  };
  const alCambiarVisibilidad = () => { if (document.visibilityState === 'hidden') estado.vaciar(); };
  document.addEventListener('visibilitychange', alCambiarVisibilidad);
  window.addEventListener('pagehide', estado.vaciar);
  const alDesmontar = () => {
    document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    window.removeEventListener('pagehide', estado.vaciar);
    estado.vaciar();
    destruirSteppers();
  };
  const vista = crearVista(raiz, () => { destruirSteppers(); return dibujar(ctx, estado, sinRedibujar, () => vista.actualizar()); }, { alDesmontar });
  const pintar = vista.actualizar;
  vista.actualizar = (evento) => { if (estado.suprimir > 0) return; estado.vaciar(); pintar(evento); };
  return vista;
}

function dibujar(ctx, estado, sinRedibujar, redibujar) {
  const datos = ctx.tienda.datos();
  const hoy = ctx.reloj.hoy();
  const est = estadoCiclo(datos, hoy);
  const aj = datos.ajustes;
  const prefs = ctx.preferencias.leer();
  const stepper = (opciones) => { const s = stepperControl(opciones); estado.steppers.push(s); return s; };
  ctx.shell.titulo('Ajustes', 'Ingreso, ciclo y datos');
  ctx.shell.fab(false);
  const nodos = [];

  // Ingreso y ciclo
  const ingreso = campoPesos({ etiqueta: 'Ingreso mensual (salario)', valor: aj.ingreso.montoMensual, id: 'ingreso', ayuda: 'Se aplica al presupuesto del ciclo actual y a los próximos.' });
  ingreso.input.addEventListener('change', () => {
    const v = ingreso.valor() ?? 0;
    if (v === aj.ingreso.montoMensual) return;
    const r = ejecutar(ctx, guardarAjustes, { ingreso: { montoMensual: v } });
    if (!r.ok) { ingreso.fijar(aj.ingreso.montoMensual); return; }
    ejecutar(ctx, guardarIngresoPlaneado, { ciclo: est.ciclo, monto: v }, { exito: 'Ingreso actualizado' });
  });
  const pagoVigente = aj.diaPago[aj.diaPago.length - 1].dia;
  let diaNuevo = pagoVigente;
  // El cambio vale desde el primer ciclo en que "hoy" no sale del ciclo actual (R1F-01/02): el aviso dice cuál es y, R2F-04, las
  // fechas del ciclo de transición (sin salario esperado) si el día nuevo ya pasó este mes.
  const avisoCambio = (dia) => {
    let desde = null;
    try { desde = aplicarDiaPago(ctx.tienda.datos(), dia, ctx.reloj.hoy()); } catch { /* la acción informa el error */ }
    if (!desde) return 'aplica desde el ciclo siguiente';
    const transicion = desde.transicion.map((c) => { const r = rangoCiclo(c, desde.historial); return `${etiquetaRango(r)} (${cantidad(r.dias, 'día', 'días')})`; });
    // R2F-05: antes de empezar, el primer ciclo conserva su inicio y puede quedar largo (44 a 60 días con un solo presupuesto): se avisa.
    const primero = est.antesDeEmpezar ? rangoCiclo(est.ciclo, desde.historial) : null;
    const aviso = primero && primero.dias > 31 ? `. El primer ciclo durará ${cantidad(primero.dias, 'día', 'días')} (${etiquetaRango(primero)}) con un solo presupuesto` : '';
    return `aplica desde ${nombreCiclo(desde.desdeCiclo, desde.historial).toLowerCase()}${aviso}${transicion.length ? `. Habrá un ciclo de transición del ${transicion.join(' y ')}, sin salario esperado: el siguiente salario llega en el ciclo que sigue` : ''}`;
  };
  const vistaPrevia = h('p', { class: 'field__hint', aria: { live: 'polite' } });
  vistaPrevia.hidden = true;
  const aplicarDia = boton('Aplicar día de pago', { clase: 'btn--secondary btn--sm', icono: 'check', onClick: () => {
    const texto = avisoCambio(diaNuevo);
    const r = ejecutar(ctx, cambiarDiaPago, { dia: diaNuevo }, { exito: `Día de pago ${diaNuevo}: ${texto}` });
    if (r.ok) redibujar();
  } });
  aplicarDia.hidden = true;
  const diaPago = stepper({ etiqueta: 'Día de pago', valor: pagoVigente, min: 1, max: 31, paso: 1, alCambiar: (v) => { diaNuevo = v; aplicarDia.hidden = v === pagoVigente; vistaPrevia.hidden = v === pagoVigente; vistaPrevia.textContent = v === pagoVigente ? '' : `Día de pago ${v}: ${avisoCambio(v)}.`; } });
  const proximoCambio = aj.diaPago.find((e) => e.desdeCiclo > est.ciclo);
  const cuentaIngreso = datos.cuentas.find((c) => c.id === aj.ingreso.cuentaId);
  nodos.push(h('section', { class: 'card stack stack--lg', aria: { labelledby: 'aj-i' } },
    h('h2', { class: 't-h', id: 'aj-i' }, 'Ingreso y ciclo'),
    ingreso.el,
    h('div', { class: 'list' }, h('div', { class: 'item' }, h('div', { class: 'item__main' }, h('div', { class: 'item__title' }, 'Ingreso variable'), h('div', { class: 'item__sub' }, 'Al recibirlo confirmas el monto real; las cifras planeadas dicen "aprox."')), interruptor({ etiqueta: 'Ingreso variable', valor: aj.ingreso.variable, alCambiar: (v) => sinRedibujar(() => ejecutar(ctx, guardarAjustes, { ingreso: { variable: v } })) }))),
    h('div', { class: 'chip-row' }, h('button', { class: 'chip', type: 'button', on: { click: async () => {
      const v = await abrirSelector({ titulo: 'Cuenta donde recibes el ingreso', seleccionado: aj.ingreso.cuentaId, opciones: datos.cuentas.filter((c) => !c.archivada && c.tipo !== 'credito').map((c) => ({ valor: c.id, titulo: c.nombre, icono: c.icono })) });
      if (v) ejecutar(ctx, guardarAjustes, { ingreso: { cuentaId: v } }, { exito: 'Cuenta del ingreso actualizada' });
    } } }, icono(cuentaIngreso?.icono ?? 'banco'), `Recibo en: ${cuentaIngreso?.nombre ?? '—'}`, icono('chevron-down'))),
    diaPago.el,
    vistaPrevia,
    aplicarDia,
    h('p', { class: 'field__hint' }, `Si un mes no tiene ese día, el pago se toma el último día del mes. Ciclo actual: ${etiquetaRango(est.rango)} (${cantidad(est.rango.dias, 'día', 'días')}). Un cambio aplica desde el ciclo siguiente (${nombreCiclo(cicloSiguiente(est.ciclo), est.historial).toLowerCase()}) o desde el primero en que hoy siga dentro del ciclo actual; el ciclo de transición queda más largo o más corto, y si el día nuevo ya pasó este mes habrá un ciclo corto sin salario esperado (su salario llega en el ciclo que sigue).${est.antesDeEmpezar ? ' Como el programa aún no empieza, el primer ciclo conserva su inicio y el cambio vale desde el siguiente.' : ''} No se corre por fines de semana ni festivos.${proximoCambio ? ` Ya está programado el día ${proximoCambio.dia} desde ${nombreCiclo(proximoCambio.desdeCiclo, est.historial).toLowerCase()}.` : ''}`)));

  // Metas y alertas (se guardan al cambiar si son válidas)
  const g = { ...aj.metaGrupos };
  const al = { ...aj.alertas };
  const suma = h('p', { class: 'field__hint', aria: { live: 'polite' } });
  const guardado = { metaGrupos: { ...aj.metaGrupos }, alertas: { ...aj.alertas } };
  const pintarSuma = () => {
    const total = g.necesidades + g.gustos + g.ahorro;
    suma.textContent = total === 100 ? 'Suma 100 %.' : `Suman ${total} %: deben sumar 100 % para guardarse.`;
    suma.classList.toggle('danger', total !== 100);
    return total;
  };
  const aplicarMetas = () => {
    const total = pintarSuma();
    estado.pendientes.delete('metas'); // lo que valga al quedar quieto el stepper es lo único que se guarda
    if (total === 100 && (g.necesidades !== guardado.metaGrupos.necesidades || g.gustos !== guardado.metaGrupos.gustos || g.ahorro !== guardado.metaGrupos.ahorro)) {
      estado.conEspera('metas', () => {
        const nuevo = { ...g };
        const r = sinRedibujar(() => ejecutar(ctx, guardarAjustes, { metaGrupos: nuevo }, { exito: 'Meta de reparto actualizada' }));
        if (r.ok) guardado.metaGrupos = nuevo;
      });
    }
  };
  const aplicarAlertas = () => {
    estado.pendientes.delete('alertas');
    if (!(al.avisoPct < al.excesoPct)) { mostrarAviso('El aviso debe ser menor que el exceso', { tipo: 'warn' }); return; }
    if (al.avisoPct !== guardado.alertas.avisoPct || al.excesoPct !== guardado.alertas.excesoPct) {
      estado.conEspera('alertas', () => {
        const nuevo = { ...al };
        const r = sinRedibujar(() => ejecutar(ctx, guardarAjustes, { alertas: nuevo }, { exito: 'Alertas actualizadas' }));
        if (r.ok) guardado.alertas = nuevo;
      });
    }
  };
  const sNec = stepper({ etiqueta: 'Necesid.', valor: g.necesidades, min: 0, max: 100, paso: 5, sufijo: '%', alCambiar: (v) => { g.necesidades = v; aplicarMetas(); } });
  const sGus = stepper({ etiqueta: 'Gustos', valor: g.gustos, min: 0, max: 100, paso: 5, sufijo: '%', alCambiar: (v) => { g.gustos = v; aplicarMetas(); } });
  const sAho = stepper({ etiqueta: 'Ahorro', valor: g.ahorro, min: 0, max: 100, paso: 5, sufijo: '%', alCambiar: (v) => { g.ahorro = v; aplicarMetas(); } });
  const sAviso = stepper({ etiqueta: 'Avisar al', valor: al.avisoPct, min: 1, max: 199, paso: 5, sufijo: ' %', alCambiar: (v) => { al.avisoPct = v; aplicarAlertas(); } });
  const sExceso = stepper({ etiqueta: 'Exceso al', valor: al.excesoPct, min: 2, max: 200, paso: 5, sufijo: ' %', alCambiar: (v) => { al.excesoPct = v; aplicarAlertas(); } });
  pintarSuma();
  nodos.push(h('section', { class: 'card stack stack--lg', aria: { labelledby: 'aj-m' } },
    h('h2', { class: 't-h', id: 'aj-m' }, 'Metas y alertas'),
    h('div', { class: 'grid-steppers' }, sNec.el, sGus.el, sAho.el), suma,
    h('div', { class: 'grid-2' }, sAviso.el, sExceso.el),
    h('p', { class: 'field__hint' }, 'Las categorías avisan al pasar el primer porcentaje de su presupuesto y se marcan en exceso al pasar el segundo. Si lo ejecutado es exactamente igual a lo asignado, la categoría queda en "Completo" y no genera alerta.')));

  // Categorías y recurrentes
  const cuotas = datos.deudas.filter((d) => !d.archivada);
  const cuentaPorId = new Map(datos.cuentas.map((c) => [c.id, c]));
  const catPorId = new Map(datos.categorias.map((c) => [c.id, c]));
  const frecuenciaTexto = (r) => (r.frecuencia.tipo === 'mensual' ? `Cada mes · día ${r.frecuencia.dia}` : `Cada semana · ${['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'][r.frecuencia.diaSemana - 1]}`);
  const cats = datos.categorias.filter((c) => c.tipo === 'gasto' && !c.archivada);
  const presupuestoTransporte = datos.presupuestos[est.ciclo]?.asignaciones['cat-transporte'];
  nodos.push(h('section', { class: 'card', aria: { labelledby: 'aj-c' } },
    h('h2', { class: 't-h', id: 'aj-c', style: { marginBottom: 'var(--sp-1)' } }, 'Categorías y recurrentes'),
    h('div', { class: 'list' },
      h('button', { class: 'item', type: 'button', on: { click: () => abrirCategorias(ctx) } }, h('span', { class: 'item__icon' }, icono('otro')), h('span', { class: 'item__main' }, h('span', { class: 'item__title', style: { display: 'block' } }, 'Categorías'), h('span', { class: 'item__sub', style: { display: 'block' } }, `Necesidades ${cats.filter((c) => c.grupo === 'necesidades').length} · Gustos ${cats.filter((c) => c.grupo === 'gustos').length} · Ahorro ${cats.filter((c) => c.grupo === 'ahorro').length}`)), icono('chevron-right')),
      datos.recurrentes.map((r) => h('button', { class: 'item', type: 'button', on: { click: () => abrirEditorRecurrente(ctx, r, redibujar) }, aria: { label: `Editar recurrente ${r.nombre}` } },
        h('span', { class: 'item__icon' }, icono(catPorId.get(r.categoriaId)?.icono ?? 'otro')),
        h('span', { class: 'item__main' }, h('span', { class: 'item__title', style: { display: 'block' } }, r.nombre, r.activo ? null : [' ', h('span', { class: 'badge' }, 'Inactivo')], r.tipo === 'ingreso' ? [' ', h('span', { class: 'badge badge--ok' }, 'Ingreso')] : null), h('span', { class: 'item__sub', style: { display: 'block' } }, `${frecuenciaTexto(r)}${r.rango ? ` · ${pesos(r.rango.min)}–${pesos(r.rango.max)}` : ''} · ${cuentaPorId.get(r.cuentaId)?.nombre ?? ''}`)),
        h('span', { class: 'item__end money' }, pesos(r.monto)))),
      h('div', { class: 'item' }, h('span', { class: 'item__icon' }, icono('deuda')), h('div', { class: 'item__main' }, h('div', { class: 'item__title' }, 'Cuotas de deuda'), h('div', { class: 'item__sub' }, `Automáticas desde Deudas · ${cuotas.map((d) => `día ${d.diaPago}`).filter((x, i, a) => a.indexOf(x) === i).join(', ') || '—'}`)), h('div', { class: 'item__end money' }, pesos(cuotas.reduce((s, d) => s + d.cuota, 0))))),
    boton('Agregar recurrente', { icono: 'plus', clase: 'btn--secondary btn--block', onClick: () => abrirEditorRecurrente(ctx, null, redibujar) }),
    h('p', { class: 'field__hint', style: { marginTop: 'var(--sp-2)' } }, `Los días de cobro son un supuesto inicial (día 1): ajústalos. La gasolina no es recurrente: se registra a mano, cuando toque, y sale del presupuesto de Transporte${presupuestoTransporte === undefined ? '' : ` (${pesos(presupuestoTransporte)} este ciclo)`}.`)));

  // Preferencias
  nodos.push(h('section', { class: 'card', aria: { labelledby: 'aj-p' } },
    h('h2', { class: 't-h', id: 'aj-p', style: { marginBottom: 'var(--sp-1)' } }, 'Preferencias'),
    h('div', { class: 'list' }, h('div', { class: 'item' }, h('span', { class: 'item__icon' }, icono('vibrate')), h('div', { class: 'item__main' }, h('div', { class: 'item__title' }, 'Vibración al registrar'), h('div', { class: 'item__sub' }, 'En iPhone se usa un pulso visual')), interruptor({ etiqueta: 'Vibración al registrar', valor: prefs.vibracion, alCambiar: (v) => { ctx.preferencias.guardar({ vibracion: v }); configurarHaptica({ activa: v }); } })))));

  // Datos
  const uso = ctx.almacen.uso();
  const kb = (n) => formatearNumero(Math.round(n / 1000), { maxDecimales: 0 });
  const respaldo = ctx.repositorio.leerRespaldo();
  nodos.push(h('section', { class: 'card', aria: { labelledby: 'aj-d' } },
    h('h2', { class: 't-h', id: 'aj-d', style: { marginBottom: 'var(--sp-2)' } }, 'Datos'),
    h('p', { class: 't-small muted', style: { marginBottom: 'var(--sp-3)' } }, 'Tus datos viven solo en este dispositivo. Para pasarlos a otro teléfono: exporta aquí e importa allá.'),
    h('div', { class: 'stack' },
      boton('Pasar datos a otro celular (exportar)', { icono: 'download', clase: 'btn--secondary btn--block', onClick: () => exportar(ctx) }),
      boton('Importar copia', { icono: 'upload', clase: 'btn--secondary btn--block', onClick: () => abrirImportar(ctx, redibujar) }),
      respaldo ? boton('Restaurar respaldo automático', { icono: 'restore', clase: 'btn--secondary btn--block', onClick: () => restaurarRespaldo(ctx, respaldo, redibujar) }) : null,
      respaldo ? boton('Descartar respaldo', { icono: 'trash', clase: 'btn--danger-ghost btn--block', onClick: () => descartarRespaldo(ctx, redibujar) }) : null),
    respaldo ? h('p', { class: 't-caption', style: { marginTop: 'var(--sp-2)' } }, `Respaldo automático del ${fechaLarga(fechaLocalDeInstante(respaldo.fecha))}: ${respaldo.motivo.replace(/-/g, ' ')}.`) : null,
    h('p', { class: 't-caption', style: { marginTop: 'var(--sp-2)' } }, TEXTO_RESPALDOS),
    h('div', { style: { marginTop: 'var(--sp-3)' } },
      barra({ fraccion: uso.fraccion, clase: uso.fraccion >= 0.7 ? 'warn' : '', etiqueta: 'Espacio de almacenamiento usado' }),
      h('p', { class: 't-caption', style: { marginTop: '6px' } }, `≈ ${kb(uso.caracteresApp)} KB de esta app (${kb(uso.caracteresOrigen)} KB del sitio) de ~${kb(uso.limiteEstimado)} KB.`)),
    uso.fraccion >= 0.7 ? h('div', { class: 'callout callout--warn', style: { marginTop: 'var(--sp-2)' } }, icono('alert'), h('div', null, 'Queda poco espacio. Exporta tus datos y libera espacio antes de seguir registrando.')) : null));

  nodos.push(h('div', { class: 'callout callout--warn' }, icono('alert'), h('div', null, h('span', { class: 'callout__title' }, 'iPhone: instala primero'), h('br'), 'En iPhone, Safari y la app instalada en la pantalla de inicio guardan los datos por separado. Instala la app antes de cargar tus datos.')));
  nodos.push(h('p', { class: 't-caption', style: { marginBottom: '0' } }, TEXTOS_BORRAR_TODO.nota));
  nodos.push(h('button', { class: 'btn btn--danger-ghost btn--block', type: 'button', on: { click: () => borrarTodo(ctx) } }, icono('trash'), 'Borrar todos los datos'));
  nodos.push(h('p', { class: 'note-legal' }, 'Finanzas Personales · versión 1. No se guardan números de tarjeta ni de cuenta.'));
  return nodos;
}
