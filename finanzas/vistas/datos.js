/*
 * datos.js — "Pasar datos a otro celular": exportar, importar (con validación y confirmación), restaurar el respaldo
 * automático y borrar todo. Reglas de shared/lib (docs/UTILIDADES.md, Errata 1 E-3):
 *  - importar/restaurar/borrar respaldan antes; si el respaldo no cabe (`sin-respaldo`) se ofrece EXPORTAR o
 *    "Continuar sin respaldo" (se vuelve a llamar con sinRespaldo:true) y se muestran los `avisos` con `codigo`.
 *  - "Borrar todo" = tienda.reemplazar(semilla, { motivo:'antes-de-borrar-todo' }): vuelve a los datos de EJEMPLO de la app (T5.8: la semilla pública).
 */
import { h, icono, boton, fechaCorta, fechaLarga, mostrarAviso, haptic } from './comun.js';
import { abrirHoja, confirmar } from '../../shared/ui/hoja.js';
import { crearArchivoExportacion, entregarArchivo, leerArchivo, analizarImportacion } from '../../shared/lib/exportacion.js';
import { VERSION, APP, migraciones, validar, resumir } from '../logica/esquema.js';
import { crearSemilla } from '../seed.js';
import { fechaLocalDeInstante } from '../../shared/lib/instantes.js';
import { DIAS_RESPALDO } from '../../shared/lib/repositorio.js';
import { unSoloEnvio } from '../../shared/lib/envio.js';
import { agruparAvisos, describirRuta, describirError, hayCuentasOcultas, textoDescartados, textoOcultados } from '../logica/importacion.js';
import { guardarVistos, leerVistos, resumirAvisosDeCarga } from '../logica/carga.js';

/** Exporta el JSON (hoja de compartir, descarga o texto para copiar). */
export async function exportar(ctx) {
  const datos = ctx.tienda.datos();
  const archivo = crearArchivoExportacion(datos, { app: APP, ahora: ctx.reloj.instanteISO(), hoy: ctx.reloj.hoy() });
  const r = await entregarArchivo(archivo);
  if (r === 'compartido') mostrarAviso('Copia compartida', { tipo: 'ok' });
  else if (r === 'descargado') {
    // En un iPhone con la app instalada la descarga puede no dar señal visible: se ofrece el texto como alternativa.
    mostrarAviso(`Copia descargada: ${archivo.nombre}`, { tipo: 'ok', accion: { etiqueta: '¿No apareció?', alPulsar: () => mostrarTexto(archivo.texto) } });
  } else if (r === 'mostrado') mostrarTexto(archivo.texto);
  return r;
}

function mostrarTexto(texto) {
  const area = h('textarea', { class: 'input', attrs: { readonly: '', 'aria-label': 'Copia de seguridad en texto', rows: 8 }, value: texto, style: { minHeight: '180px', fontFamily: 'var(--font-mono)', fontSize: '16px' } });
  abrirHoja([h('div', { class: 'sheet__body stack' }, h('p', { class: 'muted t-small' }, 'Copia el texto y pégalo en "Importar copia" en el otro celular.'), area), h('div', { class: 'sheet__foot' }, boton('Seleccionar todo', { icono: 'copy', clase: 'btn--lg btn--block', onClick: () => { area.focus(); area.select(); } }))], { titulo: 'Copia en texto' });
}

/** Sin espacio para el respaldo previo: ofrece Exportar, Continuar sin respaldo o Cancelar. → Promise<boolean> (true = continuar). */
export function pedirContinuarSinRespaldo(ctx, mensaje) {
  return new Promise((resolver) => {
    let seguir = false;
    const hoja = abrirHoja([
      h('div', { class: 'sheet__body stack' }, h('div', { class: 'callout callout--warn' }, icono('alert'), h('div', null, h('span', { class: 'callout__title' }, 'No hay espacio para un respaldo previo'), h('br'), mensaje)), h('p', { class: 'muted t-small' }, 'Lo más seguro es exportar tus datos a un archivo y luego continuar.')),
      h('div', { class: 'sheet__foot', style: { flexDirection: 'column' } },
        boton('Exportar una copia', { icono: 'download', clase: 'btn--secondary btn--block', onClick: () => exportar(ctx) }),
        boton('Continuar sin respaldo', { icono: 'alert', clase: 'btn--danger btn--block', onClick: () => { seguir = true; hoja.cerrar(); } }),
        boton('Cancelar', { clase: 'btn--ghost btn--block', onClick: () => hoja.cerrar() })),
    ], { titulo: 'Sin respaldo previo', alCerrar: () => resolver(seguir) });
  });
}

/**
 * Reemplaza todo con respaldo previo; maneja `sin-respaldo` y muestra los avisos. → Promise<boolean> (true = reemplazado).
 * Tras reemplazar ejecuta `alAbrir` (R1F-06): una copia o un respaldo de un ciclo anterior no trae el presupuesto del ciclo
 * actual y, sin él, cada gasto saldría en "exceso: sin presupuesto asignado" hasta reabrir la app.
 */
let reemplazoEnCurso = false;
export async function reemplazarConRespaldo(ctx, datos, motivo) {
  // R2F-01: defensa en profundidad. Dos reemplazos a la vez (doble toque, o importar mientras se restaura) harían que el segundo
  // respalde los datos YA reemplazados y pise el único respaldo de los originales. Mientras uno está en curso, el otro se ignora.
  if (reemplazoEnCurso) return false;
  reemplazoEnCurso = true;
  try {
    let r = ctx.tienda.reemplazar(datos, { motivo });
    if (!r.ok && r.error === 'sin-respaldo') {
      if (!(await pedirContinuarSinRespaldo(ctx, r.mensaje))) return false;
      r = ctx.tienda.reemplazar(datos, { motivo, sinRespaldo: true });
    }
    if (!r.ok) { haptic('error'); mostrarAviso(r.mensaje, { tipo: 'danger', duracion: 6000 }); return false; }
    ctx.tienda.ejecutar(ctx.acciones.alAbrir, {});
    return true;
  } finally {
    reemplazoEnCurso = false;
  }
}

/** Texto que cierra la confirmación de una reasignación: no hay "Deshacer", pero sí un respaldo del que volver (R2F-14). */
export const TEXTO_RESPALDO_REASIGNAR = 'Esta acción no se puede deshacer. Antes se guarda un respaldo automático (dura 14 días y reemplaza el anterior): para volver atrás, en Ajustes › Datos toca "Restaurar respaldo automático".';

/**
 * R2F-14: guarda un respaldo automático de los datos actuales ANTES de un cambio grande que la app no puede deshacer (reasignar
 * una cuenta o una categoría), con el mismo mecanismo y la misma caducidad que importar o "Borrar todo" (repositorio.respaldar).
 * Si no hay espacio, ofrece exportar, continuar sin respaldo o cancelar. → Promise<boolean> (true = seguir con el cambio).
 */
export async function respaldarAntesDe(ctx, motivo) {
  if (!ctx.repositorio || typeof ctx.repositorio.respaldar !== 'function') return true; // sin repositorio (pruebas con tienda falsa)
  const rb = ctx.repositorio.respaldar(ctx.tienda.datos(), motivo);
  if (rb.ok) return true;
  return pedirContinuarSinRespaldo(ctx, rb.mensaje || 'No se pudo guardar el respaldo.');
}

/** Avisos de la validación, separados por tipo (R1F-21a): campos descartados, números ocultados y valores ajustados. */
function avisosDeImportacion(avisos) {
  const g = agruparAvisos(avisos);
  const resumen = (rutas) => [h('br'), rutas.slice(0, 4).map(describirRuta).join(' · '), rutas.length > 4 ? ' …' : ''];
  const bloques = [];
  // N-04: concordancia en singular y plural ("Se descartó 1 campo desconocido" / "Se ocultó 1 número").
  if (g.descartados.length) bloques.push(h('div', { class: 'callout' }, icono('info'), h('div', null, h('span', { class: 'callout__title' }, textoDescartados(g.descartados.length)), resumen(g.descartados))));
  if (g.numeros.length) bloques.push(h('div', { class: 'callout callout--warn' }, icono('alert'), h('div', null, h('span', { class: 'callout__title' }, textoOcultados(g.numeros.length, { conCuentas: hayCuentasOcultas(avisos) })), h('br'), 'La app no guarda números de tarjeta ni de cuenta.', resumen(g.numeros))));
  for (const x of g.ajustes) bloques.push(h('div', { class: 'callout' }, icono('info'), h('div', null, h('span', { class: 'callout__title' }, `${x.mensaje.replace(/.$/, '')} (${x.rutas.length})`), resumen(x.rutas))));
  return bloques.length ? bloques : null;
}

/** Hoja de confirmación con resumen; solo al confirmar se reemplaza todo (con respaldo previo). */
function confirmarImportacion(ctx, analisis, alTerminar) {
  const { resumen, avisos } = analisis;
  const rango = resumen.desde ? `${fechaCorta(resumen.desde)} ${resumen.desde.slice(0, 4)} – ${fechaCorta(resumen.hasta)} ${resumen.hasta.slice(0, 4)}` : 'sin movimientos';
  // R2F-01: la hoja tarda 300 ms en cerrarse y seguía recibiendo toques: el segundo "Reemplazar" respaldaba la copia ya importada y
  // pisaba el único respaldo de los datos originales. Un solo envío a la vez, con el botón bloqueado desde el primer toque;
  // solo se libera si NO se reemplazó (cancelaron o falló), para poder reintentar.
  const reemplazar = boton('Reemplazar', { icono: 'check', clase: 'btn--danger' });
  reemplazar.addEventListener('click', unSoloEnvio(async () => {
    reemplazar.disabled = true;
    const ok = await reemplazarConRespaldo(ctx, analisis.datos, 'antes-de-importar');
    if (!ok) { reemplazar.disabled = false; return false; }
    hoja.cerrar();
    if (alTerminar) alTerminar();
    haptic('success');
    mostrarAviso('Datos importados', { tipo: 'ok' });
    return true;
  }));
  const filas = [['Movimientos', String(resumen.movimientos)], ['Fechas', rango], ['Cuentas', String(resumen.cuentas)], ['Deudas', String(resumen.deudas)], ['Metas', String(resumen.metas)], ['Ciclos con presupuesto', String(resumen.ciclos)]];
  const cuerpo = h('div', { class: 'sheet__body stack' },
    h('div', { class: 'callout callout--warn' }, icono('alert'), h('div', null, 'Esto reemplaza ', h('b', null, 'todos'), ' los datos de este celular. Antes se guarda un respaldo automático que puedes restaurar desde Ajustes.')),
    h('div', { class: 'list' }, filas.map(([k, v]) => h('div', { class: 'item', style: { minHeight: '44px' } }, h('span', { class: 'item__main t-small muted' }, k), h('span', { class: 'item__end money' }, v)))),
    avisosDeImportacion(avisos));
  const hoja = abrirHoja([cuerpo, h('div', { class: 'sheet__foot' }, boton('Cancelar', { clase: 'btn--secondary', onClick: () => hoja.cerrar() }), reemplazar)], { titulo: 'Importar copia' });
}

/** Hoja para elegir un archivo o pegar el texto de la copia. */
export function abrirImportar(ctx, alTerminar) {
  const area = h('textarea', { class: 'input', attrs: { 'aria-label': 'Texto de la copia de seguridad', placeholder: 'O pega aquí el texto de la copia', rows: 5 }, style: { minHeight: '110px', fontFamily: 'var(--font-mono)', fontSize: '16px' } });
  const archivo = h('input', { type: 'file', class: 'sr-only', attrs: { accept: '.json,application/json,text/plain', 'aria-label': 'Elegir archivo de copia' } });
  const error = h('div', { aria: { live: 'polite' } });
  const analizar = (texto) => {
    error.replaceChildren();
    const r = analizarImportacion(texto, { app: APP, version: VERSION, migraciones, validar, resumir });
    if (!r.ok) {
      haptic('error');
      error.append(h('div', { class: 'callout callout--danger' }, icono('alert'), h('div', null, h('span', { class: 'callout__title' }, r.mensaje), r.errores ? [h('br'), r.errores.map(describirError).join(' · ')] : null))); // N-09: sin rutas técnicas ("Movimiento 1, monto: …")
      return;
    }
    hoja.cerrar();
    confirmarImportacion(ctx, r, alTerminar);
  };
  archivo.addEventListener('change', async () => {
    const f = archivo.files && archivo.files[0];
    if (!f) return;
    const l = await leerArchivo(f);
    if (!l.ok) { error.replaceChildren(h('div', { class: 'callout callout--danger' }, icono('alert'), h('div', null, l.mensaje))); return; }
    analizar(l.texto);
  });
  const cuerpo = h('div', { class: 'sheet__body stack' },
    h('p', { class: 'muted t-small' }, 'Elige el archivo .json que exportaste en el otro celular, o pega su texto. Antes de reemplazar nada verás un resumen.'),
    archivo,
    boton('Elegir archivo', { icono: 'upload', clase: 'btn--secondary btn--block', onClick: () => archivo.click() }),
    area, error);
  const hoja = abrirHoja([cuerpo, h('div', { class: 'sheet__foot' }, boton('Revisar texto pegado', { icono: 'check', clase: 'btn--lg btn--block', onClick: () => analizar(area.value) }))], { titulo: 'Importar copia' });
  return hoja;
}

export async function restaurarRespaldo(ctx, respaldo, alTerminar) {
  // R3F-01b: un respaldo son datos que la app ya guardó: como al abrir la app, solo se enmascara lo de alta confianza (tarjeta con Luhn y marca) y lo dudoso se avisa sin tocarlo.
  const v = validar(respaldo.datos, { modo: 'carga' });
  if (!v.ok) { mostrarAviso('El respaldo no es válido y no se puede restaurar', { tipo: 'danger' }); return; }
  const ok = await confirmar({ titulo: '¿Restaurar el respaldo?', mensaje: `Se reemplazan los datos actuales por el respaldo guardado el ${fechaLarga(fechaLocalDeInstante(respaldo.fecha))} (${respaldo.motivo.replace(/-/g, ' ')}). Lo actual se guarda como nuevo respaldo.`, confirmar: 'Restaurar', peligro: true });
  if (!ok) return;
  if (!(await reemplazarConRespaldo(ctx, v.datos, 'antes-de-restaurar'))) return;
  if (alTerminar) alTerminar();
  mostrarAviso('Respaldo restaurado', { tipo: 'ok' });
  const vistos = leerVistos(ctx.almacen);
  const resumen = resumirAvisosDeCarga(v.avisos, { vistos });
  if (resumen.aviso) mostrarAviso(resumen.aviso.mensaje, { tipo: 'warn', duracion: 10000 });
  if (resumen.avisoDudosos) { mostrarAviso(resumen.avisoDudosos.mensaje, { tipo: 'warn', duracion: 12000 }); guardarVistos(ctx.almacen, vistos, resumen.avisoDudosos.huellas); }
}

/**
 * R3F-03: el respaldo automático es una copia EXACTA de los datos (por diseño: sirve para volver atrás), así que si en ese momento
 * había una nota con un número de tarjeta, el respaldo lo conserva hasta que caduque. Ajustes lo dice con esta línea y ofrece "Descartar respaldo".
 */
export const TEXTO_RESPALDOS = `Los respaldos automáticos conservan una copia exacta de tus datos hasta que caducan (${DIAS_RESPALDO} días): descártalos si guardaste algo que no querías.`;

/** Descarta el respaldo automático (con confirmación en hoja inferior). → Promise<boolean> (true = descartado). */
export async function descartarRespaldo(ctx, alTerminar) {
  const ok = await confirmar({ titulo: '¿Descartar el respaldo automático?', mensaje: 'Se borra la copia guardada. Tus datos actuales no cambian, pero ya no podrás volver a ese estado. Esta acción no se puede deshacer.', confirmar: 'Descartar respaldo', peligro: true });
  if (!ok) return false;
  const r = ctx.repositorio.descartarRespaldo();
  if (!r.ok) { haptic('error'); mostrarAviso(r.mensaje, { tipo: 'danger' }); return false; }
  haptic('success');
  mostrarAviso('Respaldo descartado', { tipo: 'ok' });
  if (alTerminar) alTerminar();
  return true;
}

/**
 * Textos de "Borrar todo" (N4-01). Desde T5.8 la semilla son datos de EJEMPLO, no los datos de la persona: decirlo claro, avisar que sus datos
 * dejan de verse (siguen 14 días en el respaldo automático) y pedir que exporte antes. Un solo lugar: la hoja y la nota de Ajustes.
 */
export const TEXTOS_BORRAR_TODO = Object.freeze({
  titulo: '¿Borrar todos los datos?',
  mensaje: `Se eliminan los movimientos y todos los cambios hechos: volverás a los datos de ejemplo de la app (tus datos se pierden de la vista; queda un respaldo automático ${DIAS_RESPALDO} días que puedes restaurar desde Ajustes): exporta una copia antes si quieres conservarla.`,
  confirmar: 'Borrar todo',
  nota: `«Borrar todos los datos» te devuelve a los datos de ejemplo de la app: tus datos se pierden de la vista y queda un respaldo automático ${DIAS_RESPALDO} días. Exporta una copia antes.`,
});

/** Borrar todo = volver a los datos de ejemplo de la app (con respaldo previo y confirmación en hoja inferior). */
export async function borrarTodo(ctx) {
  const ok = await confirmar({ titulo: TEXTOS_BORRAR_TODO.titulo, mensaje: TEXTOS_BORRAR_TODO.mensaje, confirmar: TEXTOS_BORRAR_TODO.confirmar, peligro: true });
  if (!ok) return;
  const nueva = validar(crearSemilla({ ahora: ctx.reloj.instanteISO() }));
  if (!(await reemplazarConRespaldo(ctx, nueva.datos, 'antes-de-borrar-todo'))) return; // ya ejecuta alAbrir
  haptic('success');
  mostrarAviso('Datos borrados', { tipo: 'ok' });
}

