/*
 * entrenar.js — pantalla Entrenar (T2.2): selector de persona, franja semanal, tarjeta de sesión (anillo, tiempo, récords),
 * ejercicios con series (solo la serie activa se expande), descanso flotante con marcas de tiempo, superseries, PR con
 * confeti, sugerencia de progresión, cardio, cierre y Wake Lock.
 *
 * Reglas de producto: la sesión completada es de solo lectura y solo se entrena el mismo día de la rutina (V6).
 * Los temporizadores se calculan desde marcas de tiempo (iOS suspende setInterval) y mueren en desmontar().
 */
import { h, vaciar } from '../../shared/lib/dom.js';
import { diasDeSemana, inicioSemana, formatearFecha, sumarDias, partes } from '../../shared/lib/fechas.js';
import { formatearNumero, formatearKg } from '../../shared/lib/numeros.js';
import { icono } from '../../shared/ui/icono.js';
import { anillo } from '../../shared/ui/graficos.js';
import { haptic } from '../../shared/ui/haptica.js';
import { confeti } from '../../shared/ui/confeti.js';
import { mostrarAviso } from '../../shared/ui/aviso.js';
import { confirmar } from '../../shared/ui/hoja.js';
import {
  iniciarSesion, actualizarSerie, aplicarSugerencia, agregarSerie, quitarUltimaSerie, registrarCardio, descartarSesion,
} from '../logica/acciones.js';
import {
  estadoDelDia, ejercicioEfectivo, sesionAnterior, primerPendiente, siguienteFoco, descansoTrasSerie, planDelDia, grupoSuperserie, consejoDeEjercicio, serieValida,
} from '../logica/sesiones.js';
import { volumenSesion, seriesHechas, seriesTotales, recordsDeSesion, sugerirProgresion } from '../logica/calculos.js';
import { SEIS_HORAS_MS, SEGUNDOS_AJUSTE } from '../logica/descansos.js';
import {
  LETRAS_DIA, NOMBRES_DIA, textoDescanso, textoMetaEjercicio, textoSeries, textoSerie, textoCardio, textoVolumen, unidadPeso, textoObjetivo,
} from '../logica/formato.js';
import { segmentado, crearAmbito, ejecutar, nombreDe, callout, estadoVacio, redibujarConFoco } from './comun.js';
import { abrirCierre, textoCardioHecho } from './cierre.js';

/*
 * Los descansos en marcha, UNO POR SESIÓN (R2G-02), los guarda el gestor de la app (`ctx.descansos`, gimnasio/gestor-descansos.js):
 * sobreviven a cambiar de persona y de pestaña, el de una persona no pisa ni borra el de la otra, y es el gestor —no esta vista—
 * quien detecta el fin de cada descanso y vibra (N3-01). Aquí solo se dibujan.
 */

const COMMIT_MS = 300;
const RIR_OPCIONES = [0, 1, 2, 3, 4].map((n) => ({ valor: n, texto: n === 4 ? '4+' : String(n) }));

const textoTiempo = (seg) => (seg < 3600 ? `${Math.floor(seg / 60)} min` : `${Math.floor(seg / 3600)} h ${String(Math.floor((seg % 3600) / 60)).padStart(2, '0')} min`);
const mmss = (seg) => `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;
/** Cronómetro de la sesión en curso, con segundos (F-08): 5:07 · 1:06:05. */
const textoCronometro = (seg) => (seg < 3600 ? mmss(seg) : `${Math.floor(seg / 3600)}:${String(Math.floor((seg % 3600) / 60)).padStart(2, '0')}:${String(seg % 60).padStart(2, '0')}`);
/** Consejo técnico como línea bajo el ejercicio (F-01). */
const lineaConsejo = (texto) => (texto ? h('p', { class: 'exercise__tip', dataset: { consejo: '' } }, h('b', null, 'Técnica: '), texto) : null);
const fechaValida = (f) => (typeof f === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f) && (() => { try { partes(f); return true; } catch { return false; } })() ? f : null);
const hashEntrenar = (fecha, persona) => `#/entrenar?fecha=${fecha}&persona=${persona}`;

/** Agrupa los ejercicios en bloques sueltos y superseries consecutivas, con su numeración (1, 2… y A1, A2…). */
function agrupar(ejercicios) {
  const bloques = [];
  let n = 0;
  let i = 0;
  while (i < ejercicios.length) {
    const g = grupoSuperserie(ejercicios, i);
    if (!g) { n += 1; bloques.push({ tipo: 'solo', item: { ej: ejercicios[i], idx: i, numero: String(n) } }); i += 1; continue; }
    bloques.push({ tipo: 'grupo', letra: g.letra, items: ejercicios.slice(g.inicio, g.fin + 1).map((ej, k) => ({ ej, idx: g.inicio + k, numero: `${g.letra}${k + 1}` })) });
    i = g.fin + 1;
  }
  return bloques;
}

function textoProgresion(p, ej, incremento) {
  const kg = formatearKg(p.kg);
  const inc = formatearNumero(incremento, { maxDecimales: 2 });
  if (p.tipo === 'revisar') return 'Hubo molestia la última vez. Revisa la técnica o baja la carga antes de subir.';
  if (p.sinPeso) return p.alcanzoMaximo ? 'Llegaste al máximo de repeticiones en todas las series; agrega peso si el ejercicio lo permite.' : 'Sin peso anotado: sigue hasta llegar al máximo de repeticiones en todas las series.';
  if (ej.medida === 'segundos') {
    if (p.tipo === 'subir') return `Sube a ${p.seg} s (+5 s): llegaste al máximo en todas las series.`;
    if (p.tipo === 'bajar') return `Baja a ${p.seg} s (−5 s): varias series quedaron por debajo del mínimo.`;
    return `Mantén ${p.seg} s hasta llegar al máximo en todas las series.`;
  }
  if (p.tipo === 'subir') return `Sube a ${kg} (+${inc} kg): completaste todas las series en el máximo de repeticiones.`;
  if (p.tipo === 'bajar') return `Baja a ${kg} (−${inc} kg): la mitad de las series quedó por debajo del mínimo.`;
  return `Mantén ${kg}: sigue hasta llegar al máximo de repeticiones en todas las series.`;
}

export function montar(raiz, ctx) {
  const { tienda, reloj, shell, prefs, descansos } = ctx;
  const ambito = crearAmbito(); // steppers de esta vista: se liberan al redibujar y al desmontar
  const stepper = (o) => ambito.stepper(o);
  const hoy = () => reloj.hoy();
  const paramPersona = ctx.parametros.get('persona');
  const personaId = paramPersona === 'p1' || paramPersona === 'p2' ? paramPersona : ctx.persona.actual();
  if (personaId !== ctx.persona.actual()) ctx.persona.fijar(personaId);
  // R1-12: sin fecha en la dirección, si la persona tiene una sesión en curso de un día anterior iniciada hace menos de 6 h
  // (cruzó la medianoche), se sigue mostrando esa sesión en vez de saltar al día nuevo.
  const enCursoReciente = Object.values(tienda.datos().sesiones).find((x) => x.personaId === personaId && x.estado === 'en-curso' && x.fecha < hoy() && reloj.ahora() - Date.parse(x.iniciadaEn) < SEIS_HORAS_MS);
  const fechaEnDireccion = fechaValida(ctx.parametros.get('fecha')); // solo lo que la persona eligió (franja, enlace); no la que se dedujo
  const hoyElegido = ctx.parametros.get('hoy') === '1'; // la dirección lleva la fecha de HOY (se tocó el día de hoy en la franja): sigue siendo "hoy" al cambiar de persona tras la medianoche (N3-07)
  const fecha = fechaEnDireccion ?? enCursoReciente?.fecha ?? hoy();

  let foco = null; // { ejercicioId, indice }
  const borradores = new Map(); // `${ejercicioId}:${indice}` → { kg?, valor?, rir? }
  const temporizadores = new Map(); // clave → id de setTimeout
  let cardioBorrador = null; // { sesionId, minutos, km, vel, incl }
  let cardioTimer = null;
  let cardioPendiente = null; // guarda el cardio cambiado cuyo temporizador aún no venció (R1-13)
  let omitirRender = 0;
  let tiempoEl = null;
  let barraEl = null; // { raiz, tiempo, label, anillo, listo, sesionId }
  const chips = { otro: null, propio: null }; // avisos sobre la barra: descanso de la otra persona / volver a mi sesión (R3G-01): { raiz, txt, firma, texto, sesionId }
  let enRender = false;
  let anuncio = null; // región para lectores de pantalla: solo anuncia el fin del descanso de la otra persona (R3G-02)
  let intervalo = null;
  let montado = true;

  const personaNombre = () => nombreDe(tienda.datos(), personaId);
  const idSesion = `ses-${fecha}-${personaId}`;

  /* ---------- utilidades de estado ---------- */

  function sesionActual() {
    const d = tienda.datos(); // null un instante cuando otra pestaña dejó los datos ilegibles (N-01): la app se recarga enseguida
    const s = d ? d.sesiones[idSesion] : null;
    return s && s.estado !== 'sin-iniciar' ? s : null;
  }

  function claveSerie(ejercicioId, indice) { return `${ejercicioId}:${indice}`; }

  function normalizarFoco(ses) {
    if (!ses || ses.estado !== 'en-curso') { foco = null; return; }
    const e = foco && ses.ejercicios.find((x) => x.id === foco.ejercicioId);
    if (!e || foco.indice >= e.series.length) foco = primerPendiente(ses);
  }

  /* ---------- borradores de series (los steppers no escriben en cada toque) ---------- */

  function comprometer(ejercicioId, indice) {
    const clave = claveSerie(ejercicioId, indice);
    clearTimeout(temporizadores.get(clave));
    temporizadores.delete(clave);
    const b = borradores.get(clave);
    borradores.delete(clave);
    const ses = sesionActual();
    if (!ses || ses.estado !== 'en-curso') return null;
    const e = ses.ejercicios.find((x) => x.id === ejercicioId);
    if (!e || !e.series[indice]) return null;
    const payload = { sesionId: ses.id, ejercicioId, indice };
    if (b) {
      if (b.kg !== undefined) payload.kg = b.kg;
      if (b.valor !== undefined) payload[e.medida === 'segundos' ? 'seg' : 'reps'] = b.valor;
      if (b.rir !== undefined) payload.rir = b.rir;
    }
    if (Object.keys(payload).length <= 3) return null; // nada que guardar
    omitirRender += 1;
    try { return ejecutar(ctx, actualizarSerie, payload); } finally { omitirRender -= 1; }
  }

  function cambiarBorrador(ejercicioId, indice, parcial) {
    const clave = claveSerie(ejercicioId, indice);
    borradores.set(clave, { ...(borradores.get(clave) ?? {}), ...parcial });
    clearTimeout(temporizadores.get(clave));
    temporizadores.set(clave, setTimeout(() => {
      const ses = sesionActual();
      const hecha = !!(ses && ses.ejercicios.find((x) => x.id === ejercicioId)?.series[indice]?.ok);
      comprometer(ejercicioId, indice);
      if (montado && hecha) render(); // una serie ya hecha cambia el volumen
    }, COMMIT_MS));
  }

  function vaciarBorradores() {
    for (const clave of [...temporizadores.keys()]) {
      const [ejercicioId, indice] = [clave.slice(0, clave.lastIndexOf(':')), Number(clave.slice(clave.lastIndexOf(':') + 1))];
      comprometer(ejercicioId, indice);
    }
  }

  /** Guarda ya el cardio cambiado que esperaba su temporizador (R1-13): al salir de la pantalla y al ocultar la app. */
  function vaciarCardio() {
    if (cardioTimer === null) return;
    clearTimeout(cardioTimer);
    cardioTimer = null;
    const guardar = cardioPendiente;
    cardioPendiente = null;
    if (!guardar) return;
    omitirRender += 1;
    try { guardar(); } finally { omitirRender -= 1; }
  }

  /** Todo lo que los steppers dejaron sin guardar (peso, repeticiones, RIR y cardio). */
  function guardarPendientes() {
    vaciarBorradores();
    vaciarCardio();
  }

  /* ---------- acciones de la sesión ---------- */

  function empezar() {
    const r = ejecutar(ctx, iniciarSesion, { fecha, personaId });
    if (r.ok) haptic('success');
  }

  function enfocar(ejercicioId, indice) {
    vaciarBorradores();
    foco = { ejercicioId, indice };
    render();
  }

  function enfocarEjercicio(ses, e) {
    const i = e.series.findIndex((s) => !s.ok);
    enfocar(e.id, i < 0 ? 0 : i);
  }

  function completarSerie(ses, e, i, boton) {
    const fresca = sesionActual() ?? ses; // los borradores pueden haber cambiado la sesión sin redibujar
    const eraHecha = !!fresca.ejercicios.find((x) => x.id === e.id)?.series[i]?.ok; // "Guardar cambios" de una serie ya hecha
    const antes = new Set(recordsDeSesion(tienda.datos(), fresca).map((r) => r.ejercicioId));
    const rect = boton ? boton.getBoundingClientRect() : null;
    omitirRender += 1;
    let r;
    try {
      const b = borradores.get(claveSerie(e.id, i));
      clearTimeout(temporizadores.get(claveSerie(e.id, i)));
      temporizadores.delete(claveSerie(e.id, i));
      borradores.delete(claveSerie(e.id, i));
      const payload = { sesionId: ses.id, ejercicioId: e.id, indice: i, ok: true, propagar: true };
      if (b) {
        if (b.kg !== undefined) payload.kg = b.kg;
        if (b.valor !== undefined) payload[e.medida === 'segundos' ? 'seg' : 'reps'] = b.valor;
        if (b.rir !== undefined) payload.rir = b.rir;
      }
      r = ejecutar(ctx, actualizarSerie, payload);
    } finally { omitirRender -= 1; }
    if (!r.ok) { render(); return; }
    const ses2 = sesionActual();
    if (eraHecha) {
      // R1-09b: corregir una serie ya hecha no reinicia el descanso en marcha ni celebra: vuelve a la serie pendiente.
      foco = null; // render() elige la primera serie pendiente
      render();
      haptic('select');
      enfocarCompletar();
      return;
    }
    const nuevos = recordsDeSesion(tienda.datos(), ses2).filter((x) => !antes.has(x.ejercicioId) && !prefs.yaCelebrado(`${ses2.id}:${x.ejercicioId}`));
    for (const x of nuevos) prefs.marcarCelebrado(`${ses2.id}:${x.ejercicioId}`); // R1-09a / N-02: una vez por ejercicio y sesión, también tras recargar
    foco = siguienteFoco(ses2, e.id, i);
    const descanso = descansoTrasSerie(ses2, e.id, i);
    if (descanso > 0 && foco) iniciarDescanso(descanso, `Descanso · ${e.nombre} (${textoDescanso(descanso)})`, ses2.id);
    else descansos.quitar(ses2.id); // solo el de ESTA persona (R2G-02)
    render();
    enfocarCompletar();
    if (nuevos.length) {
      const rec = nuevos[0];
      haptic('pr');
      confeti(rect ? { x: rect.left + rect.width / 2, y: rect.top } : {});
      mostrarAviso(`¡Nuevo récord de peso! ${rec.nombre} · ${formatearKg(rec.kg)} × ${rec.reps}`, { tipo: 'ok', duracion: 5000 });
    } else haptic('serie');
  }

  /** R1-17b: tras redibujar, el foco del teclado y del lector de pantalla pasa al botón de la serie activa (no al inicio de la página). */
  function enfocarCompletar() {
    const b = raiz.querySelector('[data-completar-serie]');
    if (b) b.focus({ preventScroll: true });
  }

  function reabrirSerie(ses, e, i) {
    vaciarBorradores();
    const r = ejecutar(ctx, actualizarSerie, { sesionId: ses.id, ejercicioId: e.id, indice: i, ok: false });
    if (r.ok) { foco = { ejercicioId: e.id, indice: i }; render(); }
  }

  function aplicarPeso(ses, e, prog) {
    vaciarBorradores();
    const payload = { sesionId: ses.id, ejercicioId: e.id, kg: prog.kg };
    if (e.medida === 'segundos' && prog.seg !== null) payload.seg = prog.seg;
    if (ejecutar(ctx, aplicarSugerencia, payload).ok) { haptic('select'); mostrarAviso(e.medida === 'segundos' ? `Series pendientes a ${prog.seg} s` : `Series pendientes a ${formatearKg(prog.kg)}`, { tipo: 'ok' }); }
  }

  async function descartar(ses) {
    const ok = await confirmar({ titulo: '¿Cancelar esta sesión?', mensaje: 'Todavía no hay series ni cardio registrados: se descarta y podrá empezar de nuevo.', confirmar: 'Cancelar sesión', peligro: true });
    if (!ok) return;
    vaciarBorradores();
    descansos.quitar(ses.id);
    ejecutar(ctx, descartarSesion, { sesionId: ses.id });
  }

  /* ---------- descanso (marcas de tiempo) ---------- */

  function iniciarDescanso(segundos, etiqueta, sesionId) {
    descansos.iniciar(sesionId, segundos, etiqueta);
    if (barraEl) { barraEl.raiz.remove(); barraEl = null; }
  }

  /** Descanso de la sesión que se está viendo (null si no hay). */
  function descansoVisible() {
    const ses = sesionActual();
    return ses ? descansos.de(ses.id) : null;
  }

  function ajustarDescanso(deltaSeg) {
    const d = descansoVisible();
    if (!d) return;
    descansos.ajustar(d.sesionId, deltaSeg); // el gestor reevalúa la pantalla encendida: un "+15" tras el tope vuelve a pedirla (N3-02)
    haptic('tap');
    pintarFlotante(true);
  }

  function terminarDescanso() {
    const d = descansoVisible();
    if (d) descansos.quitar(d.sesionId);
    pintarFlotante(true);
  }

  /**
   * Chip sobre la barra de descanso (un solo celular, dos personas). Dos clases (R3G-01):
   *  - 'otro': el descanso de la OTRA persona; tocarlo cambia a ella. Nunca el de la persona que se está viendo.
   *  - 'propio': la persona vista tiene un descanso en marcha pero está mirando otro día que no es el de esa sesión; tocarlo la lleva a su sesión.
   * El texto cambia cada segundo pero NO es una región en vivo (R3G-02): el lector de pantalla solo oye el fin, desde `anuncio`.
   */
  function pintarChip(clave, d, hacer) {
    const actual = chips[clave];
    if (!d) {
      if (actual) { actual.raiz.remove(); chips[clave] = null; }
      return;
    }
    const firma = `${d.sesionId}|${d.listo}`;
    if (actual && actual.firma !== firma) { actual.raiz.remove(); chips[clave] = null; }
    const datos = tienda.datos();
    const ses = datos ? datos.sesiones[d.sesionId] : null;
    if (!ses) return;
    const r = hacer(d, ses, nombreDe(datos, ses.personaId));
    if (!chips[clave]) {
      const txt = h('span', { class: 'rest-otro__txt', aria: { hidden: 'true' } }, r.texto());
      const raizChip = h('button', {
        class: ['rest-otro', d.listo ? 'rest-otro--listo' : ''], type: 'button', dataset: r.dataset, aria: { label: r.etiqueta(d.listo) },
        on: { click: r.alPulsar },
      }, txt);
      shell.flotante.prepend(raizChip);
      chips[clave] = { raiz: raizChip, txt, firma, texto: r.texto, sesionId: d.sesionId };
    } else if (!d.listo) {
      chips[clave].txt.textContent = r.texto();
    }
  }

  function pintarAvisos(datos, ses) {
    const otro = descansos.deOtrasPersonas(personaId)[0] ?? null;
    pintarChip('otro', otro, (d, sesO, nombre) => ({
      dataset: { descansoOtro: sesO.personaId },
      texto: () => (d.listo ? `Descanso de ${nombre} terminado` : `Descanso de ${nombre}: ${mmss(descansos.restanteSeg(d.sesionId))}`),
      etiqueta: (listo) => `Descanso de ${nombre}${listo ? ' terminado' : ' en curso'}. Tocar para ver a ${nombre}`,
      alPulsar: () => cambiarPersona(sesO.personaId),
    }));
    // R3G-01: la persona vista tiene su descanso en una sesión que no es la que está mirando: el aviso la lleva de vuelta a ella.
    const propio = descansos.dePersona(personaId).find((x) => !ses || x.sesionId !== ses.id) ?? null;
    pintarChip('propio', propio, (d, sesP) => ({
      dataset: { volverSesion: '' },
      texto: () => (d.listo ? 'Volver a tu sesión · descanso terminado' : `Volver a tu sesión · descanso ${mmss(descansos.restanteSeg(d.sesionId))}`),
      etiqueta: (listo) => `Volver a tu sesión del ${formatearFecha(sesP.fecha, 'dia-mes')}: descanso ${listo ? 'terminado' : 'en curso'}`,
      alPulsar: () => { vaciarBorradores(); ctx.navegar('entrenar', { fecha: sesP.fecha, persona: personaId }); },
    }));
    const n = (chips.otro ? 1 : 0) + (chips.propio ? 1 : 0);
    if (n > 0) document.body.classList.add('con-descanso'); // los avisos (toast) suben para no tapar los chips
    document.body.classList.toggle('con-descanso-otro', n > 0);
    document.body.classList.toggle('con-descanso-doble', n > 1);
  }

  function pintarFlotante(reconstruir = false) {
    const cont = shell.flotante;
    const datos = tienda.datos();
    if (!datos) return;
    const ahora = reloj.ahora();
    const ses = sesionActual();
    const d = ses ? descansos.de(ses.id) : null;
    pintarAvisos(datos, ses);
    if (!d) {
      if (barraEl) { barraEl.raiz.remove(); barraEl = null; }
      if (!chips.otro && !chips.propio) document.body.classList.remove('con-descanso');
      return;
    }
    const falta = descansos.restanteSeg(d.sesionId);
    if (barraEl && (reconstruir || barraEl.listo !== d.listo || barraEl.sesionId !== d.sesionId)) { barraEl.raiz.remove(); barraEl = null; }
    if (!barraEl) {
      const listo = d.listo;
      const ring = anillo({ tam: 52, trazo: 6, valor: listo ? 0 : 1, etiqueta: 'Progreso del descanso' });
      const tiempo = h('div', { class: 'rest__time num' }, listo ? '¡Ya!' : mmss(falta));
      const label = h('div', { class: 'rest__label', aria: { live: 'polite' } }, listo ? 'Descanso terminado' : d.etiqueta);
      const raizBarra = h('div', { class: ['rest', listo ? 'rest--listo' : ''], role: 'timer', aria: { label: 'Descanso' } },
        ring,
        h('div', { class: 'rest__txt' }, label, tiempo),
        listo ? null : h('button', { class: 'btn btn--secondary btn--sm', type: 'button', aria: { label: `Restar ${SEGUNDOS_AJUSTE} segundos` }, on: { click: () => ajustarDescanso(-SEGUNDOS_AJUSTE) } }, `−${SEGUNDOS_AJUSTE}`),
        h('button', { class: 'btn btn--secondary btn--sm', type: 'button', aria: { label: `Sumar ${SEGUNDOS_AJUSTE} segundos` }, on: { click: () => ajustarDescanso(SEGUNDOS_AJUSTE) } }, `+${SEGUNDOS_AJUSTE}`),
        h('button', { class: 'btn btn--sm', type: 'button', dataset: { descansoListo: '' }, on: { click: terminarDescanso } }, 'Listo')); // F-09: "Listo" durante todo el descanso
      cont.appendChild(raizBarra);
      barraEl = { raiz: raizBarra, tiempo, label, anillo: ring, listo, sesionId: d.sesionId };
      document.body.classList.add('con-descanso'); // los avisos (toast) suben para no tapar los botones del descanso
    }
    if (!d.listo) {
      barraEl.tiempo.textContent = mmss(falta);
      barraEl.anillo.actualizar(Math.min(1, (d.fin - ahora) / 1000 / d.total));
    }
  }

  function tick() {
    if (!tienda.datos()) return;
    descansos.revisar(); // idempotente: el gestor ya vibró si terminó (N3-01); aquí solo se mantiene el dibujo al día
    const ses = sesionActual();
    if (tiempoEl && ses && ses.estado === 'en-curso') tiempoEl.textContent = textoCronometro(Math.max(0, Math.floor((reloj.ahora() - Date.parse(ses.iniciadaEn)) / 1000)));
    pintarFlotante(false);
    // R3G-01c: sin sesión en curso a la vista y sin descansos (los viejos los limpia el gestor) el reloj de 250 ms ya no hace falta.
    if (intervalo && !descansos.tiene() && !(ses && ses.estado === 'en-curso')) { clearInterval(intervalo); intervalo = null; }
  }

  /* ---------- Wake Lock: lo gestiona app.js (ctx.pantalla) para las dos personas, no solo para la que se mira (R2G-02b) ---------- */

  function pintarBadgePantalla() {
    const b = raiz.querySelector('[data-badge-pantalla]');
    if (!b || !montado) return;
    const activo = ctx.pantalla.estado() === 'activo';
    b.className = `badge ${activo ? 'badge--accent' : 'badge--warn'}`;
    vaciar(b);
    b.append(icono('eye'), activo ? ' Pantalla activa durante la sesión' : ' La pantalla puede apagarse durante el entrenamiento');
  }

  /* ---------- piezas visuales ---------- */

  function selectorPersona(datos) {
    return segmentado({
      etiqueta: 'Persona', clase: 'seg--persona',
      opciones: datos.ajustes.personas.map((p) => ({ valor: p.id, texto: p.nombre })), valor: personaId,
      alElegir: (id) => cambiarPersona(id),
    });
  }

  /**
   * Cambia a la otra persona. La fecha solo se lleva si venía en la dirección (se eligió un día a propósito): si se dedujo de una
   * sesión que cruzó la medianoche (R1-12) se recalcula para la otra persona, que va a "hoy" (R2G-02c).
   */
  function cambiarPersona(id) {
    if (id === personaId) return;
    vaciarBorradores();
    ctx.persona.fijar(id);
    ctx.navegar('entrenar', { fecha: fechaEnDireccion && !hoyElegido && fechaEnDireccion !== hoy() ? fechaEnDireccion : null, persona: id }, { reemplazar: true });
  }

  const ETIQUETA_ESTADO = { pendiente: 'pendiente', 'en-curso': 'en curso', completada: 'completada', perdida: 'no realizado', descanso: 'descanso', previo: 'antes de empezar' };

  function franja(datos) {
    const dias = diasDeSemana(inicioSemana(fecha));
    const hoyF = hoy();
    return h('nav', { class: 'week', aria: { label: `Semana del ${formatearFecha(dias[0], 'dia-mes')} al ${formatearFecha(dias[6], 'dia-mes-anio')}` } },
      dias.map((f, k) => {
        const { estado } = estadoDelDia(datos, f, personaId, hoyF);
        const programado = estado === 'pendiente' || estado === 'en-curso' || estado === 'completada' || estado === 'perdida';
        const clase = ['day', programado ? 'day--train' : 'day--rest', estado === 'completada' ? 'day--done' : '', estado === 'en-curso' ? 'day--active' : '',
          estado === 'perdida' ? 'day--missed' : '', f === hoyF ? 'day--today' : '', f === fecha ? 'day--selected' : ''];
        return h('a', {
          class: clase, href: hashEntrenar(f, personaId) + (f === hoyF ? '&hoy=1' : ''), aria: { current: f === fecha ? 'date' : null, label: `${NOMBRES_DIA[k + 1]} ${partes(f).dia}${f === hoyF ? ', hoy' : ''}: ${ETIQUETA_ESTADO[estado]}` },
        },
        h('span', { class: 'day__l' }, LETRAS_DIA[k + 1]),
        h('span', { class: 'day__n' }, String(partes(f).dia)),
        h('span', { class: 'day__s' }, icono(estado === 'perdida' ? 'x' : 'check')));
      }));
  }

  function fragmentoCentro(texto, etiqueta) {
    const f = document.createDocumentFragment();
    f.append(h('span', { class: 'ring__value num' }, texto), h('span', { class: 'ring__label' }, etiqueta));
    return f;
  }

  function kpi(valor, etiqueta, clase = '') {
    return h('div', { class: 'kpi' }, h('span', { class: ['kpi__v', clase] }, valor), h('span', { class: 'kpi__l' }, etiqueta));
  }

  function tarjetaSesion({ nombreDia, hechas, total, kpis, extra }) {
    return h('section', { class: 'card card--hero', aria: { labelledby: 'sesion-titulo' } },
      h('div', { class: 'session' },
        anillo({ tam: 96, trazo: 10, valor: total ? hechas / total : 0, centro: fragmentoCentro(`${hechas}/${total}`, 'series'), etiqueta: `Progreso de la sesión: ${hechas} de ${total} series` }),
        h('div', { class: 'session__meta' },
          h('span', { class: 't-label' }, formatearFecha(fecha, 'larga')),
          h('h2', { class: 't-title', id: 'sesion-titulo', style: { fontSize: 'var(--fs-xl)' } }, nombreDia),
          h('div', { class: 'session__kpis' }, kpis))),
      extra ?? null);
  }

  function pistaUltimaVez(prev) {
    if (!prev) return null;
    const t = textoSeries(prev.ejercicio, prev.ejercicio.series.filter((s) => serieValida(prev.ejercicio, s))); // N3-04: sin los intentos de 0 repeticiones
    return t ? h('span', null, `Última vez (${formatearFecha(prev.sesion.fecha, 'dia-mes')}): `, h('span', { class: 'num' }, t)) : null;
  }

  function cabecera({ numero, letra, nombre, meta, estado, insignia, alPulsar }) {
    const contenido = [
      h('span', { class: ['exercise__num', letra ? 'exercise__letter' : ''] }, numero),
      h('span', { class: 'exercise__titles' }, h('span', { class: 'exercise__name', style: { display: 'block' } }, nombre), h('span', { class: 'exercise__meta', style: { display: 'block' } }, meta)),
      insignia ?? null,
    ];
    return alPulsar
      ? h('button', { class: 'exercise__head exercise__head--btn', type: 'button', aria: { label: `${nombre}, ${meta}` }, on: { click: alPulsar } }, contenido)
      : h('div', { class: 'exercise__head' }, contenido);
  }

  /** Vista previa (sin iniciar) o resumen (completada) de un ejercicio. */
  function bloqueSimple({ datos, e, numero, letra, modo, ses }) {
    const prev = sesionAnterior(datos, personaId, e.id, fecha);
    const conSeries = Array.isArray(e.series); // sesión (series registradas) o plan (número de series)
    const hechas = conSeries ? e.series.filter((s) => s.ok).length : 0;
    const total = conSeries ? e.series.length : e.series;
    const meta = `${textoMetaEjercicio({ ...e, series: total })} · ${unidadPeso(e)}`;
    const pistas = [];
    if (e.nota) pistas.push(h('span', { class: 'badge badge--accent' }, 'Ajuste'), h('span', null, e.nota));
    let filas = null;
    if (modo === 'lectura') {
      const rec = recordsDeSesion(datos, ses).find((r) => r.ejercicioId === e.id);
      if (rec) pistas.push(h('span', { class: 'badge badge--warn' }, icono('trophy'), ' PR'));
      filas = h('ol', { class: 'sets' }, e.series.map((s, i) => h('li', { class: ['set', s.ok ? 'set--done' : 'set--pending'] },
        h('span', { class: 'set__n' }, String(i + 1)),
        h('span', { class: 'set__sum' }, s.ok ? [h('b', null, textoSerie(e, s)), s.rir !== null ? h('span', { class: 'badge' }, `RIR ${s.rir === 4 ? '4+' : s.rir}`) : null] : h('span', { class: 'set__target' }, 'No realizada')),
        h('span', { class: 'set__check', 'aria-hidden': 'true' }, icono('check')))));
    } else {
      const ult = pistaUltimaVez(prev);
      if (ult) pistas.push(ult);
      const prog = prev ? sugerirProgresion(prev.ejercicio, { dolor: prev.sesion.cierre.dolor.hay, incrementoKg: datos.ajustes.incrementoKg }) : null;
      if (prog) pistas.push(h('span', { class: ['badge', prog.tipo === 'revisar' || prog.tipo === 'bajar' ? 'badge--warn' : 'badge--info'] }, icono('arrow-up-right'), ' Progresión'), h('span', null, textoProgresion(prog, e, datos.ajustes.incrementoKg)));
    }
    return h('article', { class: ['exercise', modo === 'lectura' && hechas === total ? 'exercise--done' : 'exercise--pending'] },
      cabecera({
        numero, letra, nombre: e.nombre, meta,
        insignia: modo === 'lectura' ? h('span', { class: ['badge', hechas === total ? 'badge--ok' : ''] }, `${hechas}/${total}`) : null,
      }),
      pistas.length ? h('p', { class: 'exercise__hint' }, pistas) : null,
      modo === 'plan' ? lineaConsejo(e.consejo) : null, // el plan del día trae el consejo de la rutina (F-01)
      filas);
  }

  /** Ejercicio de una sesión en curso. */
  function bloqueEnCurso({ datos, ses, e, numero, letra }) {
    const esFoco = !!foco && foco.ejercicioId === e.id;
    const hechas = e.series.filter((s) => s.ok).length;
    const completo = hechas === e.series.length;
    const prev = sesionAnterior(datos, personaId, e.id, ses.fecha);
    const estado = esFoco ? 'active' : completo ? 'done' : 'pending';
    const meta = `${textoMetaEjercicio({ ...e, series: e.series.length })} · ${unidadPeso(e)}`;
    const pistas = [];
    if (e.nota) pistas.push(h('span', { class: 'badge badge--accent' }, 'Ajuste'), h('span', null, e.nota));
    const rec = recordsDeSesion(datos, ses).find((r) => r.ejercicioId === e.id);
    if (rec) pistas.push(h('span', { class: 'badge badge--warn' }, icono('trophy'), ' PR'));
    if (completo && !esFoco) pistas.push(h('span', { class: 'num' }, textoSeries(e, e.series)));
    let botonSugerencia = null;
    if (!completo) {
      const ult = pistaUltimaVez(prev);
      if (ult) pistas.push(ult);
      const prog = prev ? sugerirProgresion(prev.ejercicio, { dolor: prev.sesion.cierre.dolor.hay, incrementoKg: datos.ajustes.incrementoKg }) : null;
      if (prog) {
        pistas.push(h('span', { class: ['badge', prog.tipo === 'revisar' || prog.tipo === 'bajar' ? 'badge--warn' : 'badge--info'] }, icono('arrow-up-right'), ' Progresión'), h('span', null, textoProgresion(prog, e, datos.ajustes.incrementoKg)));
        const actual = e.series.find((s) => !s.ok);
        const cambia = prog.tipo === 'subir' || prog.tipo === 'bajar' ? (e.medida === 'segundos' ? actual?.seg !== prog.seg : actual?.kg !== prog.kg) : false;
        if (cambia) {
          botonSugerencia = h('button', { class: 'btn btn--secondary btn--sm', type: 'button', on: { click: () => aplicarPeso(ses, e, prog) } },
            e.medida === 'segundos' ? `Usar ${prog.seg} s` : `Usar ${formatearKg(prog.kg)}`);
        }
      }
    }
    const filas = esFoco ? h('ol', { class: 'sets' }, e.series.map((s, i) => fila(datos, ses, e, i, s))) : null;
    const acciones = esFoco
      ? h('div', { class: 'cluster', style: { padding: '0 var(--sp-3) var(--sp-3)' } },
        e.series.length < 10 ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button', on: { click: () => { vaciarBorradores(); ejecutar(ctx, agregarSerie, { sesionId: ses.id, ejercicioId: e.id }); } } }, icono('plus'), ' Agregar serie') : null,
        e.series.length > 1 && !e.series[e.series.length - 1].ok ? h('button', { class: 'btn btn--ghost btn--sm', type: 'button', on: { click: () => {
          vaciarBorradores();
          if (foco && foco.ejercicioId === e.id && foco.indice >= e.series.length - 1) foco = { ejercicioId: e.id, indice: Math.max(0, e.series.length - 2) };
          ejecutar(ctx, quitarUltimaSerie, { sesionId: ses.id, ejercicioId: e.id });
        } } }, icono('minus'), ' Quitar última') : null)
      : null;
    return h('article', { class: ['exercise', `exercise--${estado}`] },
      cabecera({
        numero, letra, nombre: e.nombre, meta,
        insignia: h('span', { class: ['badge', completo ? 'badge--ok' : ''] }, `${hechas}/${e.series.length}`),
        alPulsar: esFoco ? null : () => enfocarEjercicio(ses, e),
      }),
      pistas.length ? h('p', { class: 'exercise__hint' }, pistas) : null,
      completo && !esFoco ? null : lineaConsejo(consejoDeEjercicio(datos, ses, e.id)), // F-01: el ejercicio activo y los pendientes
      botonSugerencia ? h('div', { class: 'cluster', style: { padding: '0 var(--sp-4) var(--sp-2)' } }, botonSugerencia) : null,
      filas, acciones);
  }

  function fila(datos, ses, e, i, s) {
    const esActiva = !!foco && foco.ejercicioId === e.id && foco.indice === i;
    if (esActiva) return serieActiva(datos, ses, e, i, s);
    const objetivo = `objetivo ${textoObjetivo(e)}${e.medida === 'reps' ? ' reps' : ''}`;
    const resumen = s.ok
      ? [h('b', null, textoSerie(e, s)), s.rir !== null ? h('span', { class: 'badge' }, `RIR ${s.rir === 4 ? '4+' : s.rir}`) : null]
      : [h('span', { class: 'num' }, textoSerie(e, s)), h('span', { class: 'set__target' }, `· ${objetivo}`)];
    return h('li', { class: ['set', s.ok ? 'set--done' : 'set--pending'] },
      h('span', { class: 'set__n' }, String(i + 1)),
      h('button', { class: 'set__sum', type: 'button', aria: { label: `Serie ${i + 1}: ${s.ok ? 'hecha, ' : ''}${textoSerie(e, s)}. Tocar para editar` }, on: { click: () => enfocar(e.id, i) } }, resumen),
      h('button', {
        class: 'set__check', type: 'button', aria: { label: s.ok ? `Serie ${i + 1} completada; tocar para reabrirla` : `Completar serie ${i + 1}` },
        on: { click: (ev) => (s.ok ? reabrirSerie(ses, e, i) : completarSerie(ses, e, i, ev.currentTarget)) },
      }, icono('check')));
  }

  function serieActiva(datos, ses, e, i, s) {
    const b = borradores.get(claveSerie(e.id, i)) ?? {};
    const campo = e.medida === 'segundos' ? 'seg' : 'reps';
    const kgInicial = b.kg ?? s.kg;
    const valorInicial = b.valor ?? s[campo];
    const rirInicial = b.rir !== undefined ? b.rir : s.rir;
    const pasoKg = datos.ajustes.incrementoKg;
    const pesoStep = stepper({ etiqueta: 'Peso', valor: kgInicial, min: 0, max: 500, paso: pasoKg, decimales: 2, sufijo: ' kg', alCambiar: (v) => cambiarBorrador(e.id, i, { kg: v }) });
    const valorStep = e.medida === 'segundos'
      ? stepper({ etiqueta: 'Segundos', valor: valorInicial, min: 0, max: 999, paso: 5, sufijo: ' s', alCambiar: (v) => cambiarBorrador(e.id, i, { valor: v }) })
      : stepper({ etiqueta: 'Reps', valor: valorInicial, min: 0, max: 999, paso: 1, alCambiar: (v) => cambiarBorrador(e.id, i, { valor: v }) });
    const boton = h('button', { class: 'btn btn--block btn--lg', type: 'button', dataset: { completarSerie: '' }, on: { click: () => completarSerie(ses, e, i, boton) } }, icono('check'), s.ok ? ' Guardar cambios' : ' Completar serie');
    const rir = e.rir
      ? h('div', { class: 'rir-row' },
        h('div', { class: 'stepper-label' }, h('span', null, 'RIR · repeticiones en reserva'), h('span', { class: 'faint' }, `objetivo ${e.rir.min === e.rir.max ? e.rir.min : `${e.rir.min}–${e.rir.max}`}`)),
        segmentado({ etiqueta: 'RIR', clase: 'seg--rir', opciones: RIR_OPCIONES, valor: rirInicial === null || rirInicial === undefined ? null : Math.min(4, rirInicial), permitirNinguno: true, alElegir: (v) => cambiarBorrador(e.id, i, { rir: v }) }))
      : null;
    return h('li', { class: 'set set--active', aria: { label: `Serie ${i + 1} activa` } },
      h('div', { class: 'set__top' },
        h('span', { class: 'set__title' }, `Serie ${i + 1} `, h('span', { class: 'muted' }, `· objetivo ${textoObjetivo(e)}${e.medida === 'reps' ? ' reps' : ''}`)),
        h('span', { class: 'badge badge--accent' }, s.ok ? 'Editando' : 'Activa')),
      h('div', { class: 'set__edit' }, pesoStep.el, valorStep.el),
      rir, boton);
  }

  /* ---------- cardio ---------- */

  function tarjetaCardio(ses, interactivo) {
    const plan = ses.cardioPlan;
    if (!plan) return null;
    const c = ses.cardio;
    if (!interactivo) {
      return h('section', { class: 'card', aria: { labelledby: 'cardio-t' } },
        h('div', { class: 'split' },
          h('div', { class: 'item__main' }, h('span', { class: 't-label' }, 'Cardio'), h('h3', { class: 't-h', id: 'cardio-t' }, plan.nombre),
            h('p', { class: 't-small muted' }, c && c.ok ? `Hecho: ${textoCardioHecho(ses)}` : `Plan: ${textoCardio(plan)}${ses.estado === 'completada' ? ' · sin registrar' : ''}`)),
          h('span', { class: 'item__icon item__icon--accent' }, icono('activity'))));
    }
    const medio = (r) => (r ? Math.round(((r.min + r.max) / 2) * 10) / 10 : 0);
    if (!cardioBorrador || cardioBorrador.sesionId !== ses.id) {
      cardioBorrador = { sesionId: ses.id, minutos: c ? c.minutos : plan.minutos, km: c?.km ?? 0, vel: c?.velocidadKmH ?? medio(plan.velocidadKmH), incl: c?.inclinacionPct ?? medio(plan.inclinacionPct) };
    }
    const cb = cardioBorrador;
    const guardar = (ok) => {
      const r = ejecutar(ctx, registrarCardio, { sesionId: ses.id, minutos: cb.minutos, km: cb.km > 0 ? cb.km : null, velocidadKmH: cb.vel > 0 ? cb.vel : null, inclinacionPct: cb.incl > 0 ? cb.incl : null, ok });
      return r.ok;
    };
    const cancelarPendiente = () => { clearTimeout(cardioTimer); cardioTimer = null; cardioPendiente = null; };
    const cambio = (parcial) => {
      Object.assign(cb, parcial);
      if (!(ses.cardio && ses.cardio.ok)) return;
      clearTimeout(cardioTimer);
      cardioPendiente = () => guardar(true);
      cardioTimer = setTimeout(vaciarCardio, COMMIT_MS);
    };
    return h('section', { class: 'card', aria: { labelledby: 'cardio-t' } },
      h('div', { class: 'split' },
        h('div', { class: 'item__main' }, h('span', { class: 't-label' }, 'Cardio'), h('h3', { class: 't-h', id: 'cardio-t' }, plan.nombre), h('p', { class: 't-small muted' }, `Plan: ${textoCardio(plan)}`)),
        h('span', { class: ['item__icon', 'item__icon--accent'] }, icono(c && c.ok ? 'check' : 'activity'))),
      h('div', { class: 'cardio__fields' },
        stepper({ etiqueta: 'Duración', valor: cb.minutos, min: 0, max: 300, paso: 1, sufijo: ' min', alCambiar: (v) => cambio({ minutos: v }) }).el,
        stepper({ etiqueta: 'Distancia', valor: cb.km, min: 0, max: 100, paso: 0.1, decimales: 1, sufijo: ' km', alCambiar: (v) => cambio({ km: v }) }).el,
        stepper({ etiqueta: 'Velocidad', valor: cb.vel, min: 0, max: 30, paso: 0.1, decimales: 1, sufijo: ' km/h', alCambiar: (v) => cambio({ vel: v }) }).el,
        stepper({ etiqueta: 'Inclinación', valor: cb.incl, min: 0, max: 30, paso: 1, decimales: 1, sufijo: ' %', alCambiar: (v) => cambio({ incl: v }) }).el),
      c && c.ok
        ? h('div', { class: 'stack', style: { marginTop: 'var(--sp-3)' } },
          callout({ tipo: 'ok', icon: 'check', titulo: 'Cardio registrado', texto: textoCardioHecho(ses) }),
          h('button', { class: 'btn btn--ghost btn--sm', type: 'button', on: { click: () => { cancelarPendiente(); guardar(false); } } }, 'Deshacer registro'))
        : h('button', { class: 'btn btn--secondary btn--block', type: 'button', style: { marginTop: 'var(--sp-3)' }, on: { click: () => { if (guardar(true)) { haptic('success'); mostrarAviso('Cardio registrado', { tipo: 'ok' }); } } } }, icono('check'), ' Registrar cardio'));
  }

  /* ---------- vistas por estado ---------- */

  function vistaEnCurso(datos, ses) {
    normalizarFoco(ses);
    const hechas = seriesHechas(ses);
    const total = seriesTotales(ses);
    const records = recordsDeSesion(datos, ses);
    tiempoEl = h('span', { class: 'kpi__v' }, textoCronometro(Math.max(0, Math.floor((reloj.ahora() - Date.parse(ses.iniciadaEn)) / 1000))));
    const nodos = [];
    if (ses.fecha < hoy()) {
      nodos.push(callout({ tipo: 'warn', icon: 'alert', titulo: `Sesión sin terminar del ${formatearFecha(ses.fecha, 'dia-mes')}`, texto: 'Puede finalizarla ahora; queda registrada con su fecha original.' }));
    }
    const pantalla = prefs.obtener().pantalla
      ? h('div', { class: 'cluster', style: { marginTop: 'var(--sp-3)' } }, h('span', { class: 'badge badge--warn', dataset: { badgePantalla: '' } }, icono('eye'), ' Pantalla activa durante la sesión'))
      : null;
    nodos.push(tarjetaSesion({
      nombreDia: ses.nombreDia, hechas, total,
      kpis: [kpi(textoVolumen(volumenSesion(ses)), 'Volumen'), h('div', { class: 'kpi' }, tiempoEl, h('span', { class: 'kpi__l' }, 'Tiempo')), kpi(String(records.length), records.length === 1 ? 'Récord' : 'Récords', records.length ? 'ok' : '')],
      extra: pantalla,
    }));
    if (ses.calentamiento) nodos.push(callout({ tipo: 'ok', icon: 'activity', titulo: 'Calentamiento', texto: ses.calentamiento }));
    for (const r of records) {
      nodos.push(h('div', { class: 'pr', role: 'status' }, h('span', { class: 'pr__icon' }, icono('trophy')),
        h('div', null, h('div', { class: 'pr__title' }, 'Nuevo récord de peso'),
          h('div', { class: 't-small muted' }, `${r.nombre} · ${formatearKg(r.kg)} × ${r.reps}${r.orm ? ` · 1RM est. ${formatearNumero(r.orm, { maxDecimales: 1 })} kg` : ''}`, h('br'), `Antes: ${formatearKg(r.previoKg)} × ${r.previoReps}`))));
    }
    for (const bloque of agrupar(ses.ejercicios)) {
      if (bloque.tipo === 'solo') nodos.push(bloqueEnCurso({ datos, ses, e: bloque.item.ej, numero: bloque.item.numero, letra: false }));
      else {
        const ultimo = bloque.items[bloque.items.length - 1].ej;
        nodos.push(h('section', { class: 'superset', aria: { label: `Superserie ${bloque.letra}: ${bloque.items.map((x) => x.ej.nombre).join(' y ')}` } },
          h('div', { class: 'superset__label' }, h('span', { class: 'badge badge--accent' }, `Superserie ${bloque.letra}`), h('span', { class: 't-caption' }, `Alterna ${bloque.items.map((x) => x.numero).join(' y ')} · descanso ${textoDescanso(ultimo.descansoSeg)}`)),
          bloque.items.map((x) => bloqueEnCurso({ datos, ses, e: x.ej, numero: x.numero, letra: true }))));
      }
    }
    const card = tarjetaCardio(ses, true);
    if (card) nodos.push(card);
    if (hechas === total && total > 0) nodos.push(callout({ tipo: 'ok', icon: 'trophy', titulo: '¡Todas las series hechas!', texto: 'Registre el cardio y termine la sesión.' }));
    nodos.push(h('button', { class: 'btn btn--block btn--lg', type: 'button', dataset: { terminarSesion: '' }, on: { click: () => { vaciarBorradores(); const sesCierre = sesionActual(); abrirCierre({ ctx, ses: sesCierre, alTerminar: () => { descansos.quitar(sesCierre.id); haptic('success'); render(); raiz.scrollTop = 0; } }); } } }, icono('check'), ' Terminar sesión'));
    if (hechas === 0 && !(ses.cardio && ses.cardio.ok)) nodos.push(h('button', { class: 'btn btn--ghost btn--block', type: 'button', on: { click: () => descartar(ses) } }, 'Cancelar sesión (sin registros)'));
    return nodos;
  }

  function planDe(datos, dia) {
    return dia.ejercicios.map((e) => ejercicioEfectivo(e, personaId));
  }

  function vistaPlan(datos, info) {
    const nodos = [];
    const dia = info.dia;
    const ejercicios = planDe(datos, dia);
    const total = ejercicios.reduce((t, e) => t + e.series, 0);
    const esHoy = fecha === hoy();
    nodos.push(tarjetaSesion({
      nombreDia: dia.nombre, hechas: 0, total,
      kpis: [kpi(String(total), 'Series'), kpi(String(ejercicios.length), 'Ejercicios'), kpi(dia.cardio ? `${dia.cardio.minutos} min` : '—', 'Cardio')],
    }));
    if (info.estado === 'perdida') nodos.push(callout({ tipo: 'warn', icon: 'alert', titulo: 'Entrenamiento no realizado', texto: 'Este día pasó sin entrenar y queda así en el historial. No se puede entrenar fuera de su día.' }));
    else if (!esHoy) nodos.push(callout({ icon: 'calendar', titulo: `Programado para el ${formatearFecha(fecha, 'corta')}`, texto: 'Podrá empezarlo ese día.' }));
    if (dia.calentamiento) nodos.push(callout({ tipo: 'ok', icon: 'activity', titulo: 'Calentamiento', texto: dia.calentamiento }));
    if (info.estado === 'pendiente' && esHoy) {
      nodos.push(h('button', { class: 'btn btn--block btn--lg', type: 'button', dataset: { empezarSesion: '' }, on: { click: empezar } }, icono('play'), ' Empezar sesión'));
    }
    agrupar(ejercicios).forEach((bloque) => {
      if (bloque.tipo === 'solo') nodos.push(bloqueSimple({ datos, e: { ...bloque.item.ej, series: bloque.item.ej.series }, numero: bloque.item.numero, letra: false, modo: 'plan' }));
      else {
        const ultimo = bloque.items[bloque.items.length - 1].ej;
        nodos.push(h('section', { class: 'superset', aria: { label: `Superserie ${bloque.letra}` } },
          h('div', { class: 'superset__label' }, h('span', { class: 'badge badge--accent' }, `Superserie ${bloque.letra}`), h('span', { class: 't-caption' }, `Alterna ${bloque.items.map((x) => x.numero).join(' y ')} · descanso ${textoDescanso(ultimo.descansoSeg)}`)),
          bloque.items.map((x) => bloqueSimple({ datos, e: x.ej, numero: x.numero, letra: true, modo: 'plan' }))));
      }
    });
    if (dia.cardio) {
      nodos.push(h('section', { class: 'card' }, h('div', { class: 'split' },
        h('div', { class: 'item__main' }, h('span', { class: 't-label' }, 'Cardio'), h('h3', { class: 't-h' }, dia.cardio.nombre), h('p', { class: 't-small muted' }, `Plan: ${textoCardio(dia.cardio)}`)),
        h('span', { class: 'item__icon item__icon--accent' }, icono('activity')))));
    }
    return nodos;
  }

  function vistaCompletada(datos, ses) {
    const nodos = [];
    const records = recordsDeSesion(datos, ses);
    const c = ses.cierre;
    nodos.push(tarjetaSesion({
      nombreDia: ses.nombreDia, hechas: seriesHechas(ses), total: seriesTotales(ses),
      kpis: [kpi(textoVolumen(volumenSesion(ses)), 'Volumen'), kpi(textoTiempo(c.duracionSeg), 'Duración'), kpi(String(records.length), records.length === 1 ? 'Récord' : 'Récords', records.length ? 'ok' : '')],
    }));
    nodos.push(callout({ tipo: 'ok', icon: 'check', titulo: 'Sesión completada', texto: 'Queda guardada en el historial y es de solo lectura.' }));
    for (const r of records) {
      nodos.push(h('div', { class: 'pr', role: 'status' }, h('span', { class: 'pr__icon' }, icono('trophy')),
        h('div', null, h('div', { class: 'pr__title' }, 'Nuevo récord de peso'),
          h('div', { class: 't-small muted' }, `${r.nombre} · ${formatearKg(r.kg)} × ${r.reps}${r.orm ? ` · 1RM est. ${formatearNumero(r.orm, { maxDecimales: 1 })} kg` : ''}`, h('br'), `Antes: ${formatearKg(r.previoKg)} × ${r.previoReps}`))));
    }
    for (const bloque of agrupar(ses.ejercicios)) {
      if (bloque.tipo === 'solo') nodos.push(bloqueSimple({ datos, e: bloque.item.ej, numero: bloque.item.numero, letra: false, modo: 'lectura', ses }));
      else nodos.push(h('section', { class: 'superset', aria: { label: `Superserie ${bloque.letra}` } },
        h('div', { class: 'superset__label' }, h('span', { class: 'badge badge--accent' }, `Superserie ${bloque.letra}`)),
        bloque.items.map((x) => bloqueSimple({ datos, e: x.ej, numero: x.numero, letra: true, modo: 'lectura', ses }))));
    }
    const card = tarjetaCardio(ses, false);
    if (card) nodos.push(card);
    const dolor = c.dolor.hay ? h('div', { class: 'callout callout--warn' }, icono('alert'), h('div', null, h('span', { class: 'callout__title' }, 'Dolor o molestia'), h('br'), c.dolor.descripcion)) : null;
    nodos.push(h('section', { class: 'card stack', aria: { labelledby: 'cierre-t' } },
      h('h3', { class: 't-h', id: 'cierre-t' }, 'Cierre'),
      h('div', { class: 'grid-3' }, kpi(`${c.energiaAntes} → ${c.energiaDespues}`, 'Energía antes → después'), kpi(`${c.calidad} / 5`, 'Calidad'), kpi(textoTiempo(c.duracionSeg), 'Duración')),
      dolor,
      c.notas ? h('p', { class: 't-small' }, h('span', { class: 'muted' }, 'Nota: '), c.notas) : null));
    return nodos;
  }

  function vistaDescanso(datos, info) {
    let siguiente = null;
    for (let k = 1; k <= 7 && !siguiente; k += 1) {
      const f = sumarDias(fecha, k);
      const dia = planDelDia(datos.rutina, f);
      if (dia && f >= datos.ajustes.fechaInicio) siguiente = { f, dia };
    }
    return [estadoVacio({
      icon: 'calendar', titulo: info.estado === 'previo' ? 'Antes de empezar a usar la app' : 'Día de descanso',
      texto: info.estado === 'previo' ? 'Este día es anterior a la fecha en que se empezó a registrar.' : 'Hoy no hay rutina programada: recupera.',
      accion: siguiente
        ? h('a', { class: 'btn btn--secondary', href: hashEntrenar(siguiente.f, personaId) }, `Próximo: ${formatearFecha(siguiente.f, 'corta')} · ${siguiente.dia.nombre}`)
        : null,
    })];
  }

  /* ---------- render ---------- */

  function render() {
    if (!montado) return;
    ambito.liberar(); // los steppers de la pantalla anterior (antes de crear los nuevos)
    const datos = tienda.datos();
    if (!datos) return; // N-01: otra pestaña dejó los datos ilegibles; app.js recarga la página y muestra la recuperación
    const info = estadoDelDia(datos, fecha, personaId, hoy());
    shell.titulo('Entrenar', 'Centro de Entrenamiento');
    shell.relleno(info.estado === 'en-curso');
    tiempoEl = null;
    let contenido;
    if (info.estado === 'en-curso') contenido = vistaEnCurso(datos, info.sesion);
    else if (info.estado === 'completada') contenido = vistaCompletada(datos, info.sesion);
    else if (info.estado === 'pendiente' || (info.estado === 'perdida' && info.dia)) contenido = vistaPlan(datos, info);
    else if (info.estado === 'perdida') contenido = [callout({ tipo: 'warn', icon: 'alert', titulo: 'Entrenamiento no realizado', texto: `${info.sesion?.nombreDia ?? 'Entrenamiento'}: este día pasó sin entrenar.` })];
    else contenido = vistaDescanso(datos, info);
    // Sesión de un día anterior que quedó abierta (cruzó la medianoche): avisar desde el día de hoy.
    const pendiente = fecha === hoy() ? Object.values(datos.sesiones).find((s) => s.personaId === personaId && s.estado === 'en-curso' && s.fecha < hoy()) : null;
    const aviso = pendiente
      ? callout({ tipo: 'warn', icon: 'alert', titulo: `Tienes una sesión sin terminar del ${formatearFecha(pendiente.fecha, 'corta')}`, hijos: [h('br'), h('a', { class: 'btn btn--secondary btn--sm', style: { marginTop: 'var(--sp-2)' }, href: hashEntrenar(pendiente.fecha, personaId) }, 'Abrirla')] })
      : null;
    // R1-17b: conserva el scroll y el foco del teclado al redibujar (antes el foco volvía al inicio de la página).
    redibujarConFoco(raiz, () => { vaciar(raiz); raiz.append(selectorPersona(datos), franja(datos), ...(aviso ? [aviso] : []), ...contenido); });
    ctx.pantalla.actualizar();
    if (info.estado === 'en-curso') pintarBadgePantalla();
    enRender = true;
    try { descansos.revisar(); pintarFlotante(false); } finally { enRender = false; }
    // El reloj corre mientras se mira una sesión en curso o mientras haya algún descanso (el de la otra persona también).
    const necesitaReloj = info.estado === 'en-curso' || descansos.tiene();
    if (necesitaReloj && !intervalo) intervalo = setInterval(tick, 250);
    if (!necesitaReloj && intervalo) { clearInterval(intervalo); intervalo = null; }
  }

  // R1-13 / F-04: al ocultar la app o cerrar la página se guarda lo que los steppers y el cardio tenían pendiente (iOS suspende los
  // temporizadores y puede descartar la página sin darles tiempo).
  const alVisible = () => { if (document.visibilityState === 'visible') tick(); else guardarPendientes(); };
  const desuscribirPantalla = ctx.pantalla.suscribir(() => pintarBadgePantalla());
  // N3-01: el gestor de la app detecta el fin del descanso y vibra; esta vista solo se redibuja, le dice a qué elemento aplicar el pulso
  // visual (si no hay, el gestor hace un destello de pantalla) y anuncia a los lectores de pantalla el fin del descanso de la otra persona.
  anuncio = h('div', { class: 'sr-only', role: 'status', aria: { live: 'polite', atomic: 'true' } });
  shell.flotante.append(anuncio);
  const quitarPulso = descansos.fijarPulso((sesionId) => (barraEl && barraEl.sesionId === sesionId ? barraEl.raiz : chips.otro && chips.otro.sesionId === sesionId ? chips.otro.raiz : chips.propio && chips.propio.sesionId === sesionId ? chips.propio.raiz : null));
  const desuscribirDescansos = descansos.suscribir((ev) => {
    if (!montado) return;
    const datos = tienda.datos();
    for (const d of ev.descansos ?? []) {
      const ses = datos ? datos.sesiones[d.sesionId] : null;
      if (ses && ses.personaId !== personaId) anuncio.textContent = `Descanso de ${nombreDe(datos, ses.personaId)} terminado`;
    }
    if (!enRender) pintarFlotante(true);
  });
  const alOcultarPagina = () => guardarPendientes();
  document.addEventListener('visibilitychange', alVisible);
  window.addEventListener('pagehide', alOcultarPagina);
  const desuscribir = tienda.suscribir((ev) => {
    if (ev.tipo === 'error') return;
    if (omitirRender > 0 && ev.tipo === 'cambio') return;
    render();
  });
  render();

  return {
    actualizar() { render(); },
    desmontar() {
      guardarPendientes(); // R1-13: el cardio pendiente se guarda en vez de descartarse
      ambito.liberar();
      montado = false;
      desuscribir();
      document.removeEventListener('visibilitychange', alVisible);
      window.removeEventListener('pagehide', alOcultarPagina);
      clearInterval(intervalo);
      for (const t of temporizadores.values()) clearTimeout(t);
      desuscribirPantalla();
      desuscribirDescansos();
      quitarPulso();
      if (barraEl) { barraEl.raiz.remove(); barraEl = null; }
      for (const clave of Object.keys(chips)) if (chips[clave]) { chips[clave].raiz.remove(); chips[clave] = null; }
      if (anuncio) { anuncio.remove(); anuncio = null; }
      document.body.classList.remove('con-descanso', 'con-descanso-otro', 'con-descanso-doble');
      shell.relleno(false);
    },
  };
}
