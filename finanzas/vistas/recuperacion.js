/*
 * recuperacion.js — pantalla que se muestra cuando los datos guardados no se pueden leer (estado 'corrupto').
 * La clave principal NO se ha tocado (el repositorio solo copió el texto a `cte.finanzas.corrupto`): se puede exportar el
 * texto crudo, restaurar el respaldo automático, importar un archivo o empezar de cero (con confirmación).
 */
import { h, icono, boton, mostrarAviso, fechaLarga } from './comun.js';
import { vaciar } from '../../shared/lib/dom.js';
import { confirmar } from '../../shared/ui/hoja.js';
import { entregarArchivo } from '../../shared/lib/exportacion.js';
import { validar } from '../logica/esquema.js';
import { crearSemilla } from '../seed.js';
import { fechaLocalDeInstante } from '../logica/periodo.js';

/**
 * Textos de "Empezar de cero" (N4-01): desde T5.8 "los datos iniciales" son los datos de EJEMPLO de la app. Aquí no se hace respaldo automático nuevo
 * (el texto ilegible ya quedó copiado aparte en este celular), por eso el aviso no menciona los 14 días.
 */
export const TEXTOS_EMPEZAR_DE_CERO = Object.freeze({
  titulo: '¿Empezar de cero?',
  mensaje: 'Se descartan los datos ilegibles: volverás a los datos de ejemplo de la app (tus datos se pierden de la vista; el texto ilegible queda guardado aparte en este celular): exporta el texto guardado antes si quieres conservarlo.',
  confirmar: 'Empezar de cero',
  listo: 'Listo: datos de ejemplo',
});

/** @param {{errores:any[], textoCrudo:string}} carga  @param {() => void} alRecuperar  vuelve a arrancar la app */
export function mostrarRecuperacion(raiz, ctx, carga, alRecuperar) {
  vaciar(raiz);
  ctx.shell.titulo('Datos ilegibles', '');
  ctx.shell.fab(false);
  const respaldo = ctx.repositorio.leerRespaldo();
  const respaldoValido = respaldo && validar(respaldo.datos).ok ? respaldo : null;
  const terminar = (mensaje) => { mostrarAviso(mensaje, { tipo: 'ok' }); alRecuperar(); };
  raiz.append(h('div', { class: 'recuperacion' },
    h('div', { class: 'callout callout--danger' }, icono('alert'), h('div', null, h('span', { class: 'callout__title' }, 'No se pudieron leer los datos guardados'), h('br'), 'No se borró nada: tus datos siguen guardados tal como estaban. Elige cómo continuar.', carga.errores && carga.errores[0] ? [h('br'), h('span', { class: 't-caption' }, carga.errores[0].mensaje)] : null)),
    boton('Exportar el texto guardado', { icono: 'download', clase: 'btn--secondary btn--block', onClick: async () => { const r = await entregarArchivo({ nombre: 'finanzas-datos-ilegibles.txt', texto: carga.textoCrudo ?? '' }); if (r === 'descargado') mostrarAviso('Texto descargado', { tipo: 'ok' }); else if (r === 'mostrado') mostrarAviso('Este navegador no permite guardar el archivo', { tipo: 'warn' }); } }),
    respaldoValido ? boton(`Restaurar el respaldo del ${fechaLarga(fechaLocalDeInstante(respaldoValido.fecha))}`, { icono: 'restore', clase: 'btn--block', onClick: async () => {
      const ok = await confirmar({ titulo: '¿Restaurar el respaldo?', mensaje: 'Los datos ilegibles se reemplazan por el respaldo automático (el texto original sigue copiado aparte).', confirmar: 'Restaurar' });
      if (!ok) return;
      const r = ctx.tienda.reemplazar(validar(respaldoValido.datos).datos, { motivo: 'antes-de-restaurar', sinRespaldo: true });
      if (r.ok) terminar('Respaldo restaurado'); else mostrarAviso(r.mensaje, { tipo: 'danger' });
    } }) : null,
    boton('Empezar de cero', { icono: 'trash', clase: 'btn--danger-ghost btn--block', onClick: async () => {
      const ok = await confirmar({ titulo: TEXTOS_EMPEZAR_DE_CERO.titulo, mensaje: TEXTOS_EMPEZAR_DE_CERO.mensaje, confirmar: TEXTOS_EMPEZAR_DE_CERO.confirmar, peligro: true });
      if (!ok) return;
      const r = ctx.tienda.reemplazar(validar(crearSemilla({ ahora: ctx.reloj.instanteISO() })).datos, { motivo: 'antes-de-empezar-de-cero', sinRespaldo: true });
      if (r.ok) terminar(TEXTOS_EMPEZAR_DE_CERO.listo); else mostrarAviso(r.mensaje, { tipo: 'danger' });
    } }),
    h('p', { class: 'note-legal' }, 'Si exportaste una copia de seguridad, también puedes importarla desde Ajustes después de empezar de cero.')));
}
