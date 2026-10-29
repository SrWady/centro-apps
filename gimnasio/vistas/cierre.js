/*
 * cierre.js — hoja "Cerrar sesión": energía antes/después, calidad, dolor (con descripción) y notas.
 * Al guardar ejecuta finalizarSesion; desde ahí la sesión es de solo lectura (V6).
 */
import { h } from '../../shared/lib/dom.js';
import { formatearNumero } from '../../shared/lib/numeros.js';
import { abrirHoja } from '../../shared/ui/hoja.js';
import { haptic } from '../../shared/ui/haptica.js';
import { icono } from '../../shared/ui/icono.js';
import { finalizarSesion } from '../logica/acciones.js';
import { volumenSesion, seriesHechas, seriesTotales, recordsDeSesion } from '../logica/calculos.js';
import { textoVolumen, textoCardio } from '../logica/formato.js';
import { segmentado, interruptor, crearAmbito, ejecutar, fila, callout } from './comun.js';

const TRES_HORAS = 3 * 3600;
const ESCALA = [1, 2, 3, 4, 5].map((n) => ({ valor: n, texto: String(n) }));

/** Duración propuesta (seg): fin − inicio; si pasa de 3 h (sesión olvidada abierta) se usa la última actividad. */
export function duracionPropuesta(ses, ahoraMs) {
  const inicio = Date.parse(ses.iniciadaEn);
  const bruta = Math.max(0, Math.round((ahoraMs - inicio) / 1000));
  if (bruta <= TRES_HORAS) return { segundos: Math.min(bruta, 21600), olvidada: false };
  const hastaUltima = Math.max(0, Math.round((Date.parse(ses.ultimaActividadEn) - inicio) / 1000));
  return { segundos: Math.min(hastaUltima, 21600), olvidada: true };
}

function sesionAnteriorDelDia(datos, ses) {
  let mejor = null;
  for (const s of Object.values(datos.sesiones)) {
    if (s.personaId === ses.personaId && s.estado === 'completada' && s.diaRutinaId === ses.diaRutinaId && s.fecha < ses.fecha && (!mejor || s.fecha > mejor.fecha)) mejor = s;
  }
  return mejor;
}

const kpi = (valor, etiqueta) => h('div', { class: 'card card--flat card--tight' }, h('div', { class: 'kpi' }, h('span', { class: 'kpi__v num' }, valor), h('span', { class: 'kpi__l' }, etiqueta)));

/** @param {{ctx:object, ses:object, alTerminar:()=>void}} o */
export function abrirCierre({ ctx, ses, alTerminar }) {
  const ambito = crearAmbito();
  const stepper = (o) => ambito.stepper(o);
  const datos = ctx.tienda.datos();
  const propuesta = duracionPropuesta(ses, ctx.reloj.ahora());
  const estado = { energiaAntes: 3, energiaDespues: 3, calidad: 3, dolor: false, descripcion: '', notas: '', minutos: Math.round(propuesta.segundos / 60) };
  const vol = volumenSesion(ses);
  const previa = sesionAnteriorDelDia(datos, ses);
  const volPrevio = previa ? volumenSesion(previa) : 0;
  const delta = volPrevio > 0 ? vol / volPrevio - 1 : null;
  const records = recordsDeSesion(datos, ses);
  const hechas = seriesHechas(ses);

  const duracionKpi = h('span', { class: 'kpi__v num' }, `${estado.minutos} min`);
  const volEtiqueta = h('span', { class: 'kpi__l' }, 'Volumen',
    delta === null ? null : [' · ', h('span', { class: ['delta', delta >= 0 ? 'delta--up' : 'delta--down'] }, `${delta >= 0 ? '+' : '−'}${formatearNumero(Math.abs(delta) * 100, { maxDecimales: 1, minDecimales: 1 })} %`), ' vs sesión anterior']);

  const descripcion = h('input', {
    class: 'input', type: 'text', maxLength: 200, autocomplete: 'off', placeholder: 'Qué molestia fue y dónde', aria: { label: 'Descripción del dolor o molestia' },
    on: { input: () => { estado.descripcion = descripcion.value; error.hidden = true; } },
  });
  const error = h('div', { class: 'field__hint danger', role: 'alert', hidden: true }, 'Describa el dolor o molestia (al menos 3 caracteres).');
  const campoDolor = h('div', { class: 'field', hidden: true }, descripcion, error);
  const notas = h('textarea', { class: 'input', id: 'nota-sesion', rows: 3, maxLength: 500, placeholder: 'Cómo te sentiste, qué subir la próxima vez…', on: { input: () => { estado.notas = notas.value; } } });

  const campos = [];
  if (propuesta.olvidada) {
    campos.push(callout({ tipo: 'warn', icon: 'alert', titulo: 'La sesión quedó abierta mucho tiempo', texto: 'Se propone la duración hasta la última serie registrada. Ajústela si no es correcta.' }));
    campos.push(stepper({ etiqueta: 'Duración (min)', valor: estado.minutos, min: 0, max: 360, paso: 5, sufijo: ' min', alCambiar: (v) => { estado.minutos = v; duracionKpi.textContent = `${v} min`; } }).el);
  }

  const cuerpo = h('div', { class: 'sheet__body stack stack--lg' },
    h('div', { class: 'grid-2' },
      h('div', { class: 'card card--flat card--tight' }, h('div', { class: 'kpi' }, duracionKpi, h('span', { class: 'kpi__l' }, 'Duración'))),
      kpi(`${hechas} de ${seriesTotales(ses)}`, 'Series completadas'),
      h('div', { class: 'card card--flat card--tight' }, h('div', { class: 'kpi' }, h('span', { class: 'kpi__v num' }, textoVolumen(vol)), volEtiqueta)),
      kpi(records.length === 1 ? '1 récord' : `${records.length} récords`, records.length ? `${records[0].nombre}${records.length > 1 ? ` y ${records.length - 1} más` : ''}` : 'de peso en esta sesión')),
    ses.cardio && ses.cardio.ok
      ? callout({ tipo: 'ok', icon: 'activity', titulo: 'Cardio registrado', texto: textoCardioHecho(ses) })
      : ses.cardioPlan ? callout({ tipo: 'warn', icon: 'activity', titulo: 'Cardio sin registrar', texto: `Plan: ${textoCardio(ses.cardioPlan)}` }) : null,
    ...campos,
    h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Energía antes (1–5)'), segmentado({ etiqueta: 'Energía antes', opciones: ESCALA, valor: estado.energiaAntes, alElegir: (v) => { estado.energiaAntes = v; } })),
    h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Energía después (1–5)'), segmentado({ etiqueta: 'Energía después', opciones: ESCALA, valor: estado.energiaDespues, alElegir: (v) => { estado.energiaDespues = v; } })),
    h('div', { class: 'field' }, h('span', { class: 'field__label' }, 'Calidad de la sesión (1–5)'), segmentado({ etiqueta: 'Calidad de la sesión', opciones: ESCALA, valor: estado.calidad, alElegir: (v) => { estado.calidad = v; } })),
    h('div', { class: 'list' },
      fila({
        icon: 'alert', titulo: '¿Dolor o molestia?', sub: 'Se usa para frenar subidas de peso',
        fin: interruptor({ etiqueta: 'Dolor o molestia', valor: false, alCambiar: (v) => { estado.dolor = v; campoDolor.hidden = !v; if (v) descripcion.focus(); } }),
      })),
    campoDolor,
    h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'nota-sesion' }, 'Nota de la sesión'), notas));

  const guardar = h('button', { class: 'btn', type: 'button', on: { click: () => {
    if (estado.dolor && estado.descripcion.trim().length < 3) { error.hidden = false; descripcion.focus(); haptic('error', guardar); return; }
    const r = ejecutar(ctx, finalizarSesion, {
      sesionId: ses.id,
      cierre: {
        duracionSeg: propuesta.olvidada ? estado.minutos * 60 : Math.min(21600, Math.round(propuesta.segundos)),
        energiaAntes: estado.energiaAntes, energiaDespues: estado.energiaDespues, calidad: estado.calidad,
        dolor: { hay: estado.dolor, descripcion: estado.dolor ? estado.descripcion : '' }, notas: estado.notas,
      },
    });
    if (!r.ok) return;
    haptic('success', guardar);
    hoja.cerrar();
    alTerminar();
  } } }, icono('check'), ' Guardar y cerrar');
  const pie = h('div', { class: 'sheet__foot' },
    h('button', { class: 'btn btn--secondary', type: 'button', on: { click: () => hoja.cerrar() } }, 'Seguir entrenando'), guardar);
  const hoja = abrirHoja([cuerpo, pie], { titulo: 'Cerrar sesión', alCerrar: () => ambito.liberar() });
  return hoja;
}

export function textoCardioHecho(ses) {
  const c = ses.cardio;
  const partes = [c.nombre, `${c.minutos} min`];
  if (c.velocidadKmH) partes.push(`${formatearNumero(c.velocidadKmH, { maxDecimales: 1 })} km/h`);
  if (c.inclinacionPct) partes.push(`inclinación ${formatearNumero(c.inclinacionPct, { maxDecimales: 1 })} %`);
  if (c.km) partes.push(`${formatearNumero(c.km, { maxDecimales: 2 })} km`);
  return partes.join(' · ');
}
