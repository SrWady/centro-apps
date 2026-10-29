/*
 * recuperacion.js — pantalla cuando lo guardado no se puede leer (estado 'corrupto'). Nunca se pierde nada sin avisar:
 * la clave original queda intacta hasta que la persona elige restaurar, importar o empezar de cero (con confirmación).
 */
import { h, vaciar } from '../../shared/lib/dom.js';
import { icono } from '../../shared/ui/icono.js';
import { confirmar } from '../../shared/ui/hoja.js';
import { mostrarAviso } from '../../shared/ui/aviso.js';
import { callout } from './comun.js';
import { exportarDatos, elegirArchivo, pegarTexto, importarTexto, restaurarRespaldo, crearDatosDeFabrica, motivoLegible, fechaDeRespaldo, preguntarSinRespaldo } from './datos.js';

/** @param {object} carga resultado de repositorio.cargar() ({ textoCrudo, errores }) */
export function montarRecuperacion(raiz, ctx, carga, alTerminar) {
  vaciar(raiz);
  const respaldo = ctx.repositorio.leerRespaldo();
  const errores = (carga.errores ?? []).slice(0, 3).map((e) => `${e.ruta ? e.ruta + ': ' : ''}${e.mensaje}`);
  const terminar = (ok) => { if (ok) alTerminar(); };
  raiz.append(
    callout({ tipo: 'danger', icon: 'alert', titulo: 'No se pudieron leer los datos guardados', texto: 'No se borró nada: lo guardado sigue intacto en este dispositivo. Elija cómo recuperarse.' }),
    errores.length ? h('ul', { class: 't-small muted' }, errores.map((t) => h('li', null, t))) : null,
    h('section', { class: 'card stack' },
      h('h2', { class: 't-h' }, 'Opciones'),
      carga.textoCrudo ? h('button', { class: 'btn btn--secondary btn--block', type: 'button', on: { click: () => exportarDatos(ctx, carga.textoCrudo) } }, icono('download'), ' Exportar el texto guardado') : null,
      respaldo ? h('button', { class: 'btn btn--secondary btn--block', type: 'button', on: { click: async () => terminar(await restaurarRespaldo(ctx)) } }, icono('restore'), ` Restaurar respaldo (${motivoLegible(respaldo.motivo)}, ${fechaDeRespaldo(respaldo)})`) : null,
      h('button', { class: 'btn btn--secondary btn--block', type: 'button', on: { click: async () => { const t = await elegirArchivo(); if (t !== null) terminar(await importarTexto(ctx, t)); } } }, icono('upload'), ' Importar una copia (archivo)'),
      h('button', { class: 'btn btn--secondary btn--block', type: 'button', on: { click: async () => { const t = await pegarTexto(); if (t !== null) terminar(await importarTexto(ctx, t, { origen: 'texto' })); } } }, icono('copy'), ' Importar pegando el texto')),
    h('section', { class: 'card stack' },
      h('h2', { class: 't-h' }, 'Empezar de cero'),
      h('p', { class: 't-small muted' }, 'Crea datos nuevos con la rutina original. Exporte antes el texto guardado si quiere intentar recuperarlo.'),
      h('button', {
        class: 'btn btn--danger-ghost btn--block', type: 'button',
        on: { click: async () => {
          const ok = await confirmar({ titulo: '¿Empezar de cero?', mensaje: `Los datos ilegibles se reemplazan por datos nuevos con la rutina original.${respaldo ? ' El respaldo automático se conserva 14 días más (Ajustes → Datos) por si lo necesita.' : ''}`, confirmar: 'Empezar de cero', peligro: true });
          if (!ok) return;
          // R1-15: sin `sinRespaldo` el guardado conserva el respaldo (la última copia legible) aunque falte espacio.
          let r = ctx.tienda.reemplazar(crearDatosDeFabrica(ctx), { motivo: 'antes-de-empezar-de-cero' });
          if (!r.ok && r.error === 'sin-respaldo') {
            if (!(await preguntarSinRespaldo(ctx, { accion: 'empezar de cero' }))) return;
            r = ctx.tienda.reemplazar(crearDatosDeFabrica(ctx), { motivo: 'antes-de-empezar-de-cero', sinRespaldo: true });
          }
          if (r.ok) { mostrarAviso('Datos nuevos creados', { tipo: 'ok' }); terminar(true); }
        } },
      }, icono('trash'), ' Empezar de cero')));
}

/**
 * Los datos guardados son de una versión MÁS NUEVA de la app (otro celular o una pestaña ya actualizada). No se dibujan con una
 * vista de esta versión (R0-12) ni se guarda nada: solo se avisa y se permite exportar el texto tal como está.
 */
export function montarVersionFutura(raiz, ctx, textoCrudo) {
  vaciar(raiz);
  raiz.append(
    callout({ tipo: 'warn', icon: 'lock', titulo: 'Actualice la app', texto: 'Estos datos se guardaron con una versión más nueva de la app. Para no dañarlos, esta versión no los muestra ni los modifica. Actualice la app (cierre y vuelva a abrir con conexión) y siga desde ahí.' }),
    h('section', { class: 'card stack' },
      h('h2', { class: 't-h' }, 'Mientras tanto'),
      h('p', { class: 't-small muted' }, 'Puede guardar una copia de los datos tal como están.'),
      textoCrudo ? h('button', { class: 'btn btn--secondary btn--block', type: 'button', on: { click: () => exportarDatos(ctx, textoCrudo) } }, icono('download'), ' Exportar copia de los datos') : null));
}
