/*
 * datos.js — "Pasar datos a otro celular": exportar, importar (reemplaza todo, con respaldo y confirmación: V9),
 * restaurar respaldo y borrar todo. Lo usan Ajustes y la pantalla de recuperación.
 */
import { h } from '../../shared/lib/dom.js';
import { crearArchivoExportacion, entregarArchivo, leerArchivo, analizarImportacion } from '../../shared/lib/exportacion.js';
import { formatearFecha, fechaLocalDe } from '../../shared/lib/fechas.js';
import { formatearNumero } from '../../shared/lib/numeros.js';
import { abrirHoja, confirmar } from '../../shared/ui/hoja.js';
import { mostrarAviso } from '../../shared/ui/aviso.js';
import { haptic } from '../../shared/ui/haptica.js';
import { icono } from '../../shared/ui/icono.js';
import * as esquema from '../logica/esquema.js';
import { alAbrir } from '../logica/acciones.js';
import { crearSemilla } from '../seed.js';

function opcionesImportacion() {
  return { app: esquema.APP, version: esquema.VERSION, migraciones: esquema.migraciones, validar: esquema.validar, resumir: esquema.resumir };
}

/** Hoja con el texto en un cuadro de solo lectura (cuando el navegador no deja compartir ni descargar). */
function mostrarTexto(archivo) {
  const area = h('textarea', { class: 'input input--copia', readonly: true, rows: 8, aria: { label: 'Copia de seguridad' } });
  area.value = archivo.texto;
  const cuerpo = h('div', { class: 'sheet__body stack' },
    h('p', { class: 'muted' }, 'Este navegador no permite compartir ni descargar el archivo. Copie el texto completo y guárdelo en un lugar seguro.'), area);
  const pie = h('div', { class: 'sheet__foot' }, h('button', { class: 'btn', type: 'button', on: { click: () => { area.focus(); area.select(); } } }, 'Seleccionar todo'));
  abrirHoja([cuerpo, pie], { titulo: 'Copia de seguridad' });
}

/** Muestra el texto de la copia para copiarlo a mano (R0-28: en iPhone instalado a veces no aparece el archivo descargado). */
export function verCopiaComoTexto(ctx) {
  const archivo = crearArchivoExportacion(ctx.tienda.datos(), { app: esquema.APP, ahora: ctx.reloj.instanteISO(), hoy: ctx.reloj.hoy() });
  mostrarTexto(archivo);
}

/** Exporta lo que hay en la tienda (o, si se pasa, un texto crudo ilegible). */
export async function exportarDatos(ctx, textoCrudo = null) {
  const hoy = ctx.reloj.hoy();
  const archivo = textoCrudo !== null
    ? { nombre: `gimnasio-recuperado-${hoy}.json`, texto: textoCrudo }
    : crearArchivoExportacion(ctx.tienda.datos(), { app: esquema.APP, ahora: ctx.reloj.instanteISO(), hoy });
  const r = await entregarArchivo(archivo);
  if (r === 'compartido') mostrarAviso('Copia compartida', { tipo: 'ok' });
  else if (r === 'descargado') mostrarAviso(`Copia descargada: ${archivo.nombre}`, { tipo: 'ok' });
  else if (r === 'mostrado') mostrarTexto(archivo);
  return r;
}

/**
 * Sin espacio para el respaldo automático (error 'sin-respaldo'): ofrece exportar una copia a archivo, cancelar o
 * "Continuar sin respaldo" (el llamador repite la operación con sinRespaldo:true). → Promise<boolean> true = continuar sin respaldo.
 */
export function preguntarSinRespaldo(ctx, { accion = 'continuar' } = {}) {
  return new Promise((resolver) => {
    let resuelto = false;
    const cerrar = (v) => { if (resuelto) return; resuelto = true; resolver(v); hoja.cerrar(); };
    // R2G-09d: si ya hay un respaldo (p. ej. el de antes de importar), "continuar" lo borra para liberar espacio: se avisa antes.
    const previo = ctx.repositorio.infoRespaldo();
    const aviso = previo
      ? ` Ya hay un respaldo guardado${previo.motivo ? ` (antes de ${motivoLegible(previo.motivo)})` : ''}: si continúa, ese respaldo se BORRA para liberar espacio.`
      : '';
    const cuerpo = h('div', { class: 'sheet__body stack' },
      h('p', { class: 'muted' }, 'No hay espacio para guardar un respaldo automático antes de ' + accion + '. Exporte una copia de sus datos a un archivo, o continúe sin respaldo.' + aviso),
      h('button', { class: 'btn btn--secondary btn--block', type: 'button', dataset: { exportarAntes: '' }, on: { click: () => exportarDatos(ctx) } }, icono('download'), ' Exportar una copia primero'));
    const pie = h('div', { class: 'sheet__foot' },
      h('button', { class: 'btn btn--secondary', type: 'button', on: { click: () => cerrar(false) } }, 'Cancelar'),
      h('button', { class: 'btn btn--danger', type: 'button', dataset: { continuarSinRespaldo: '' }, on: { click: () => cerrar(true) } }, 'Continuar sin respaldo'));
    const hoja = abrirHoja([cuerpo, pie], { titulo: 'Sin espacio para el respaldo', alCerrar: () => { if (!resuelto) { resuelto = true; resolver(false); } } });
  });
}

/** Abre el selector de archivos y devuelve su texto (o null). */
export function elegirArchivo() {
  return new Promise((resolver) => {
    const entrada = h('input', { type: 'file', accept: '.json,application/json,text/plain', style: { display: 'none' } });
    let listo = false;
    entrada.addEventListener('change', async () => {
      listo = true;
      const archivo = entrada.files && entrada.files[0];
      entrada.remove();
      if (!archivo) { resolver(null); return; }
      const r = await leerArchivo(archivo);
      if (!r.ok) { mostrarAviso(r.mensaje, { tipo: 'danger' }); resolver(null); return; }
      resolver(r.texto);
    });
    entrada.addEventListener('cancel', () => { if (!listo) { entrada.remove(); resolver(null); } });
    document.body.appendChild(entrada);
    entrada.click();
  });
}

/** Hoja para pegar el texto de una copia (alternativa al archivo). → Promise<string|null>  (null = cancelar; '' = cuadro vacío). */
export function pegarTexto() {
  return new Promise((resolver) => {
    let resuelto = false;
    const area = h('textarea', { class: 'input input--copia', rows: 8, placeholder: 'Pegue aquí el contenido del archivo', aria: { label: 'Contenido de la copia' } });
    const cerrar = (v) => { if (resuelto) return; resuelto = true; resolver(v); hoja.cerrar(); };
    const cuerpo = h('div', { class: 'sheet__body stack' }, h('p', { class: 'muted' }, 'Pegue el texto de una copia de seguridad de Gimnasio.'), area);
    const pie = h('div', { class: 'sheet__foot' },
      h('button', { class: 'btn btn--secondary', type: 'button', on: { click: () => cerrar(null) } }, 'Cancelar'),
      h('button', { class: 'btn', type: 'button', on: { click: () => cerrar(area.value.trim()) } }, 'Revisar'));
    const hoja = abrirHoja([cuerpo, pie], { titulo: 'Pegar copia', alCerrar: () => { if (!resuelto) { resuelto = true; resolver(null); } } });
  });
}

function textoRango(resumen) {
  if (!resumen.desde) return 'sin sesiones registradas';
  return resumen.desde === resumen.hasta ? formatearFecha(resumen.desde, 'dia-mes-anio') : `del ${formatearFecha(resumen.desde, 'dia-mes-anio')} al ${formatearFecha(resumen.hasta, 'dia-mes-anio')}`;
}

/**
 * Analiza el texto y, si es válido, pide confirmación (hoja inferior) antes de REEMPLAZAR todos los datos de este celular.
 * @returns {Promise<boolean>} true si se importó.
 */
export async function importarTexto(ctx, texto, { origen = 'archivo' } = {}) {
  if (typeof texto !== 'string' || texto.trim() === '') {
    // F-07: un archivo o un cuadro vacío no se queda sin respuesta.
    mostrarAviso(origen === 'texto' ? 'No hay texto para importar: el cuadro está vacío. Pegue el contenido de la copia.' : 'El archivo está vacío: no hay nada que importar.', { tipo: 'warn', duracion: 6000 });
    return false;
  }
  const a = analizarImportacion(texto, opcionesImportacion());
  if (!a.ok) {
    const detalle = (a.errores ?? []).map((e) => `${e.ruta ? e.ruta + ': ' : ''}${e.mensaje}`);
    mostrarAviso(detalle.length ? `${a.mensaje} ${detalle[0]}` : a.mensaje, { tipo: 'danger', duracion: 7000 });
    return false;
  }
  const r = a.resumen;
  const aceptar = await confirmar({
    titulo: 'Reemplazar todos los datos',
    mensaje: `Esto reemplaza TODOS los datos de este celular por la copia: ${r.nombres.join(' y ')}, ${formatearNumero(r.sesionesRegistradas)} sesiones registradas (${textoRango(r)}), ${r.diasRutina} días de rutina y ${r.registrosPeso} registros de peso.${a.avisos.length ? ` Se descartaron ${a.avisos.length} campos desconocidos.` : ''} Antes se guarda un respaldo automático.`,
    confirmar: 'Reemplazar',
    peligro: true,
  });
  if (!aceptar) return false;
  let res = ctx.tienda.reemplazar(a.datos, { motivo: 'antes-de-importar' });
  if (!res.ok && res.error === 'sin-respaldo') {
    if (!(await preguntarSinRespaldo(ctx, { accion: 'importar' }))) return false;
    res = ctx.tienda.reemplazar(a.datos, { motivo: 'antes-de-importar', sinRespaldo: true });
  }
  if (!res.ok) return false;
  cerrarDiasTrasReemplazo(ctx);
  haptic('success');
  mostrarAviso('Datos importados', { tipo: 'ok' });
  return true;
}

/**
 * R1-10: tras importar o restaurar, los datos pueden traer `generadoHasta` viejo (u otro reloj): se cierran de inmediato los días
 * pasados y se limpian los registros futuros, en vez de esperar al próximo arranque o cambio de día.
 */
function cerrarDiasTrasReemplazo(ctx) {
  ctx.tienda.ejecutar(alAbrir, {}, { pura: true });
}

/** Fecha LOCAL (no UTC) en la que se creó el respaldo, como '2 nov 2026' (R1-16). */
export function fechaDeRespaldo(respaldo) {
  const ms = Date.parse(respaldo.fecha);
  return Number.isFinite(ms) ? formatearFecha(fechaLocalDe(ms), 'dia-mes-anio') : '';
}

/** Restaura el respaldo automático (si existe y valida), con confirmación. */
export async function restaurarRespaldo(ctx) {
  const respaldo = ctx.repositorio.leerRespaldo();
  if (!respaldo) {
    // R3G-10 / N3-03: "no hay" y "está dañado" son cosas distintas (la copia puede existir y no leerse: cuerpo truncado).
    if (ctx.repositorio.infoRespaldo()) mostrarAviso('El respaldo automático está dañado y no se puede leer. Puede descartarlo en Ajustes → Datos.', { tipo: 'danger', duracion: 7000 });
    else mostrarAviso('No hay respaldo automático guardado.', { tipo: 'warn' });
    return false;
  }
  const v = esquema.validar(respaldo.datos);
  if (!v.ok) { mostrarAviso('El respaldo guardado no se puede leer.', { tipo: 'danger' }); return false; }
  const ok = await confirmar({ titulo: 'Restaurar el respaldo', mensaje: `Vuelve al estado guardado antes de «${motivoLegible(respaldo.motivo)}». Lo que hay ahora se reemplaza.`, confirmar: 'Restaurar', peligro: true });
  if (!ok) return false;
  let r = ctx.tienda.reemplazar(v.datos, { motivo: 'antes-de-restaurar-respaldo' });
  if (!r.ok && r.error === 'sin-respaldo') {
    if (!(await preguntarSinRespaldo(ctx, { accion: 'restaurar' }))) return false;
    r = ctx.tienda.reemplazar(v.datos, { motivo: 'antes-de-restaurar-respaldo', sinRespaldo: true });
  }
  if (r.ok) { cerrarDiasTrasReemplazo(ctx); mostrarAviso('Respaldo restaurado', { tipo: 'ok' }); }
  return r.ok === true;
}

export function motivoLegible(motivo) {
  if (motivo === 'antes-de-importar') return 'importar una copia';
  if (motivo === 'antes-de-borrar' || motivo === 'antes-de-borrar-todo') return 'borrar todos los datos';
  if (motivo === 'antes-de-restaurar-rutina') return 'restaurar la rutina original';
  if (motivo === 'antes-de-restaurar-respaldo') return 'restaurar un respaldo';
  if (motivo.startsWith('antes-de-migrar')) return 'actualizar el formato de los datos';
  return motivo;
}

/** Datos nuevos de fábrica (rutina original, sin historial). */
export function crearDatosDeFabrica(ctx) {
  const v = esquema.validar(crearSemilla({ hoy: ctx.reloj.hoy(), ahora: ctx.reloj.instanteISO() }));
  if (!v.ok) throw new Error('La semilla no es válida.');
  return v.datos;
}

/** "Borrar todo" con confirmación que nombra lo que se pierde. Reemplaza por datos de fábrica (con respaldo). */
export async function borrarTodo(ctx) {
  const d = ctx.tienda.datos();
  const registradas = d ? Object.values(d.sesiones).filter((s) => s.estado !== 'sin-iniciar').length : 0;
  const ok = await confirmar({
    titulo: '¿Borrar todos los datos?',
    mensaje: `Se eliminan ${formatearNumero(registradas)} sesiones, los récords, el peso corporal, los nombres y la rutina de este dispositivo, y se vuelve a la rutina original. Se guarda un respaldo automático por si se arrepiente, pero conviene exportar una copia antes.`,
    confirmar: 'Borrar todo',
    peligro: true,
  });
  if (!ok) return false;
  let r = ctx.tienda.reemplazar(crearDatosDeFabrica(ctx), { motivo: 'antes-de-borrar-todo' });
  if (!r.ok && r.error === 'sin-respaldo') {
    if (!(await preguntarSinRespaldo(ctx, { accion: 'borrar' }))) return false;
    r = ctx.tienda.reemplazar(crearDatosDeFabrica(ctx), { motivo: 'antes-de-borrar-todo', sinRespaldo: true });
  }
  if (r.ok) mostrarAviso('Datos borrados', { tipo: 'ok' });
  return r.ok === true;
}

/** Ícono + texto de botón (atajo). */
export function botonConIcono(nombreIcono, texto, { clase = 'btn btn--secondary btn--block', alPulsar } = {}) {
  return h('button', { class: clase, type: 'button', on: { click: alPulsar } }, icono(nombreIcono), ` ${texto}`);
}
