/*
 * ajustes.js — pantalla Ajustes (T2.6): nombres de las personas, persona por defecto en este celular, incremento de peso,
 * vibración y pantalla encendida, datos almacenados, pasar datos a otro celular (exportar/importar), restaurar la rutina
 * original y borrar todo (con confirmación). Sin recordatorios de respaldo: solo la opción discreta en "Datos".
 */
import { h, vaciar } from '../../shared/lib/dom.js';
import { formatearNumero } from '../../shared/lib/numeros.js';
import { formatearFecha, fechaLocalDe } from '../../shared/lib/fechas.js';
import { icono } from '../../shared/ui/icono.js';
import { confirmar } from '../../shared/ui/hoja.js';
import { mostrarAviso } from '../../shared/ui/aviso.js';
import { configurarHaptica, haptic } from '../../shared/ui/haptica.js';
import { guardarAjustes, restaurarRutina } from '../logica/acciones.js';
import { crearRutinaSemilla } from '../seed.js';
import { INCREMENTOS_KG } from '../logica/esquema.js';
import { segmentado, interruptor, ejecutar, fila, callout } from './comun.js';
import { exportarDatos, verCopiaComoTexto, elegirArchivo, pegarTexto, importarTexto, restaurarRespaldo, borrarTodo, motivoLegible, preguntarSinRespaldo, fechaDeRespaldo } from './datos.js';

const kb = (caracteres) => formatearNumero(Math.round(caracteres / 1000));

/**
 * N4-01: texto del respaldo "muy antiguo" (sinCaducar === 'salto-de-reloj'). El descarte exige anotar el día en `respaldo-visto`; con la cuota
 * llena esa nota no cabe y el respaldo NO se descarta. Ajustes no puede distinguir los dos casos sin escribir, así que el texto es veraz en ambos:
 * se descarta cuando haya espacio para registrar la fecha (no promete "la próxima vez que abra la app").
 */
export const TEXTO_RESPALDO_MUY_ANTIGUO = 'muy antiguo o la fecha del teléfono cambió: se descartará al abrir la app otro día, cuando haya espacio para registrar la fecha. Libere espacio exportando y borrando datos antiguos (o descártelo ya)';

export function montar(raiz, ctx) {
  const { tienda, prefs, almacen, repositorio, shell } = ctx;
  let montado = true;

  function campoNombre(etiqueta, personaId, valor) {
    const entrada = h('input', { class: 'input', id: `nombre-${personaId}`, type: 'text', maxLength: 30, autocomplete: 'off', dataset: { nombre: personaId } });
    entrada.value = valor;
    entrada.addEventListener('change', () => {
      const nombres = Object.fromEntries(tienda.datos().ajustes.personas.map((p) => [p.id, p.nombre]));
      nombres[personaId] = entrada.value;
      const r = ejecutar(ctx, guardarAjustes, { nombres });
      if (!r.ok) { entrada.value = valor; haptic('error'); } else haptic('success');
    });
    return h('div', { class: 'field' }, h('label', { class: 'field__label', for: `nombre-${personaId}` }, etiqueta), entrada);
  }

  function render() {
    if (!montado) return;
    const datos = tienda.datos();
    const personas = datos.ajustes.personas;
    const pref = prefs.obtener();
    const uso = almacen.uso();
    const respaldo = repositorio.infoRespaldo(); // solo el encabezado: no parsea la copia entera en cada redibujo (R2G-06)
    shell.titulo('Ajustes', 'Personas, rutina y datos');

    const personasSec = h('section', { class: 'card stack stack--lg', aria: { labelledby: 'aj-p' } },
      h('h2', { class: 't-h', id: 'aj-p' }, 'Personas'),
      campoNombre('Nombre 1', personas[0].id, personas[0].nombre),
      campoNombre('Nombre 2', personas[1].id, personas[1].nombre),
      h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Persona por defecto al abrir en este celular'),
        segmentado({
          etiqueta: 'Persona por defecto', valor: pref.personaPorDefecto,
          opciones: [...personas.map((p) => ({ valor: p.id, texto: p.nombre })), { valor: 'ultima', texto: 'La última' }],
          alElegir: (v) => { prefs.guardar({ personaPorDefecto: v }); },
        }),
        h('span', { class: 'field__hint' }, 'Solo afecta a este celular; no se pasa al exportar.')));

    const entrenamiento = h('section', { class: 'card stack stack--lg', aria: { labelledby: 'aj-e' } },
      h('h2', { class: 't-h', id: 'aj-e' }, 'Entrenamiento'),
      h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Incremento de peso sugerido'),
        segmentado({
          etiqueta: 'Incremento de peso', valor: datos.ajustes.incrementoKg,
          opciones: INCREMENTOS_KG.map((n) => ({ valor: n, texto: `${formatearNumero(n)} kg` })),
          alElegir: (v) => { ejecutar(ctx, guardarAjustes, { incrementoKg: v }); },
        }),
        h('span', { class: 'field__hint' }, 'Es el paso de los botones − y + del peso y de la sugerencia de progresión.')),
      h('div', { class: 'list' },
        fila({ icon: 'vibrate', titulo: 'Vibración', sub: 'En iPhone no existe: se usa un pulso visual', fin: interruptor({ etiqueta: 'Vibración', valor: pref.vibracion, alCambiar: (v) => { prefs.guardar({ vibracion: v }); configurarHaptica({ activa: v }); } }) }),
        fila({ icon: 'eye', titulo: 'Mantener pantalla encendida', sub: 'Durante la sesión (si el teléfono lo permite)', fin: interruptor({ etiqueta: 'Mantener pantalla encendida', valor: pref.pantalla, alCambiar: (v) => { prefs.guardar({ pantalla: v }); ctx.pantalla.actualizar(); } }) })));

    const fraccion = Math.min(1, uso.caracteresOrigen / uso.limiteEstimado);
    const datosSec = h('section', { class: 'card stack', aria: { labelledby: 'aj-d' } },
      h('h2', { class: 't-h', id: 'aj-d' }, 'Datos'),
      h('p', { class: 't-small muted' }, 'Todo vive solo en este dispositivo. Para pasarlo a otro teléfono: exporta aquí e importa allá.'),
      h('div', { class: 'medidor' },
        h('div', { class: 't-small' }, h('b', { class: 'num' }, `≈ ${kb(uso.caracteresApp)} KB`), ` de ~${kb(uso.limiteEstimado)} KB`,
          uso.caracteresOrigen > uso.caracteresApp ? h('span', { class: 'muted' }, ` (con otras apps del mismo sitio: ${kb(uso.caracteresOrigen)} KB)`) : null),
        h('div', { class: ['bar', fraccion >= 0.9 ? 'bar--danger' : fraccion >= 0.7 ? 'bar--warn' : ''], role: 'img', aria: { label: `Almacenamiento usado: ${Math.round(fraccion * 100)} %` } },
          h('div', { class: 'bar__fill', style: { '--p': `${Math.max(1, Math.round(fraccion * 100))}%` } }))),
      uso.fraccion >= 0.7 ? callout({ tipo: 'warn', icon: 'alert', texto: 'El espacio se está agotando. Exporta una copia y libera espacio.' }) : null,
      h('div', { class: 'stack' },
        h('button', { class: 'btn btn--secondary btn--block', type: 'button', dataset: { exportar: '' }, on: { click: () => exportarDatos(ctx) } }, icono('download'), ' Exportar copia (JSON)'),
        h('button', { class: 'btn btn--secondary btn--block', type: 'button', dataset: { importar: '' }, on: { click: async () => { const t = await elegirArchivo(); if (t !== null) await importarTexto(ctx, t); } } }, icono('upload'), ' Importar copia'),
        h('button', { class: 'btn btn--ghost btn--block', type: 'button', dataset: { importarTexto: '' }, on: { click: async () => { const t = await pegarTexto(); if (t !== null) await importarTexto(ctx, t, { origen: 'texto' }); } } }, icono('copy'), ' Importar pegando el texto')),
      h('button', { class: 'btn btn--ghost btn--block', type: 'button', dataset: { verTexto: '' }, on: { click: () => verCopiaComoTexto(ctx) } }, '¿No apareció el archivo? Ver el texto para copiar'),
      h('p', { class: 't-caption' }, 'Importar reemplaza TODOS los datos de este celular. Antes se guarda un respaldo automático.'),
      respaldo
        ? h('div', { class: 'stack' },
          h('div', { class: 'list' }, fila({ icon: 'restore', titulo: respaldo.danado ? 'Respaldo automático dañado' : respaldo.ilegible ? 'Respaldo automático ilegible' : 'Respaldo automático', sub: subRespaldo(respaldo) })),
          // R2G-03c: un respaldo que no se puede leer también se muestra, con su opción de descartarlo (si no, ocuparía espacio sin verse).
          h('div', { class: respaldo.ilegible ? 'stack' : 'grid-2' },
            respaldo.ilegible ? null : h('button', { class: 'btn btn--secondary btn--sm', type: 'button', dataset: { restaurarRespaldo: '' }, on: { click: () => restaurarRespaldo(ctx) } }, 'Restaurar'),
            h('button', { class: 'btn btn--danger-ghost btn--sm', type: 'button', dataset: { descartarRespaldo: '' }, on: { click: descartarRespaldo } }, 'Descartar respaldo')))
        : null);

    const aviso = callout({ tipo: 'warn', icon: 'alert', titulo: 'iPhone: instala primero', texto: 'En iPhone, Safari y la app instalada en la pantalla de inicio guardan los datos por separado. Instala la app antes de registrar datos.' });

    const delicada = h('section', { class: 'card stack', aria: { labelledby: 'aj-z' } },
      h('h2', { class: 't-h', id: 'aj-z' }, 'Zona delicada'),
      h('button', { class: 'btn btn--secondary btn--block', type: 'button', dataset: { restaurarRutina: '' }, on: { click: restaurar } }, icono('restore'), ' Restaurar rutina original'),
      h('button', { class: 'btn btn--danger-ghost btn--block', type: 'button', dataset: { borrarTodo: '' }, on: { click: () => borrarTodo(ctx) } }, icono('trash'), ' Borrar todos los datos'));

    const y = raiz.scrollTop;
    vaciar(raiz);
    raiz.append(personasSec, entrenamiento, datosSec, aviso, delicada, h('p', { class: 'note-legal' }, 'Centro de Entrenamiento · versión 1.0 · datos esquema 1'));
    raiz.scrollTop = y;
  }

  /**
   * Texto de la fila del respaldo (R1-03, R1-16, R2G-03): la fecha en hora local y cuándo se descarta solo. Con una fecha futura (el
   * reloj estuvo mal) los días cuentan desde que se vio por primera vez; con una antigüedad inverosímil (más de 60 días) se descarta al
   * abrir la app otro día, si hay espacio para anotarlo (R3G-05, N4-01); sin espacio para guardar la marca de caducidad no caduca (R3G-06); dañado (R3G-10).
   */
  function subRespaldo(r) {
    if (r.danado) return `Antes de ${motivoLegible(r.motivo)} · ${fechaDeRespaldo(r)} (hora local) · dañado: no se puede restaurar. Puede descartarlo.`;
    if (r.ilegible) return r.motivo ? `Antes de ${motivoLegible(r.motivo)} · no se puede leer la fecha ni restaurarlo. Puede descartarlo.` : 'No se puede leer. No se descarta solo: puede descartarlo para liberar espacio.';
    const base = `Antes de ${motivoLegible(r.motivo)} · ${r.fechaFutura ? 'fecha desconocida (¿reloj del teléfono mal puesto?)' : `${fechaDeRespaldo(r)} (hora local)`}`;
    if (r.sinCaducar === 'sin-marca') return `${base} · no hay espacio para programar su descarte: se conserva y no caduca. Descártelo si ya no lo necesita`;
    if (r.sinCaducar) return `${base} · ${TEXTO_RESPALDO_MUY_ANTIGUO}`;
    return `${base} · se descarta solo el ${formatearFecha(fechaLocalDe(r.caduca), 'dia-mes-anio')}`;
  }

  async function descartarRespaldo() {
    const previo = repositorio.infoRespaldo();
    const ok = await confirmar({
      titulo: '¿Descartar el respaldo automático?',
      mensaje: `Se borra la copia guardada${previo && previo.motivo ? ` antes de ${motivoLegible(previo.motivo)}` : ''}. Tus datos actuales no cambian, pero ya no podrás volver a ese estado. No se puede deshacer.`,
      confirmar: 'Descartar respaldo', peligro: true,
    });
    if (!ok) return;
    const r = repositorio.descartarRespaldo();
    if (r.ok) { haptic('success'); mostrarAviso('Respaldo descartado', { tipo: 'ok' }); render(); } else mostrarAviso(r.mensaje, { tipo: 'danger' });
  }

  /**
   * R1-14: usa la protección del respaldo (con la cuota justa el guardado ya no borra el respaldo recién escrito) y no pisa el
   * respaldo de otra operación (p. ej. el de antes de importar): si ya hay uno, se conserva y no se crea otro.
   */
  async function restaurar() {
    const previo = repositorio.infoRespaldo();
    const hayOtro = !!previo && previo.motivo !== 'antes-de-restaurar-rutina';
    const aviso = hayOtro
      ? `Ya hay un respaldo guardado (${previo.motivo ? `antes de ${motivoLegible(previo.motivo)}, ` : ''}${fechaDeRespaldo(previo) || 'fecha desconocida'}): se conserva y esta restauración no crea otro. Para poder volver a tu rutina actual, exporta una copia antes.`
      : 'Se guarda un respaldo antes.';
    const ok = await confirmar({
      titulo: '¿Restaurar la rutina original?',
      mensaje: `Vuelve a Lun, Mar, Jue y Vie con los ejercicios iniciales y se pierden tus cambios a la rutina. Las sesiones ya hechas y tu historial no se modifican. ${aviso}`,
      confirmar: 'Restaurar',
    });
    if (!ok) return;
    let conservar = true;
    if (!hayOtro) {
      const rb = repositorio.respaldar(tienda.datos(), 'antes-de-restaurar-rutina');
      if (!rb.ok) {
        if (!(await preguntarSinRespaldo(ctx, { accion: 'restaurar la rutina' }))) return;
        conservar = false;
      }
    }
    let r = ejecutar(ctx, restaurarRutina, { rutina: crearRutinaSemilla() }, { conservarRespaldo: conservar });
    if (!r.ok && r.error === 'cuota-llena' && conservar) {
      // R2G-09d: sin espacio para guardar la rutina junto al respaldo de otra operación, "continuar" lo borraría: la hoja lo dice.
      if (!(await preguntarSinRespaldo(ctx, { accion: 'restaurar la rutina' }))) return;
      r = ejecutar(ctx, restaurarRutina, { rutina: crearRutinaSemilla() }, { conservarRespaldo: false });
    }
    if (r.ok) { haptic('success'); mostrarAviso('Rutina original restaurada', { tipo: 'ok' }); }
  }

  const desuscribir = tienda.suscribir((ev) => { if (ev.tipo === 'cambio') render(); });
  render();
  return {
    actualizar() { render(); },
    desmontar() { montado = false; desuscribir(); },
  };
}
