/*
 * app.js — arranque de Gimnasio (docs/ARQUITECTURA.md §5.7): reloj → almacén → repositorio → tienda → alAbrir →
 * enrutador por hash → vigilante de cambio de día → evento 'storage'. La única fuente de "ahora" es el reloj.
 * El service worker y el manifest son de la Fase 5 (pwa-despliegue).
 */
import { h, vaciar } from '../shared/lib/dom.js';
import { crearReloj, vigilarCambioDeDia } from '../shared/lib/reloj.js';
import { crearAlmacen, esCambioDeDatos } from '../shared/lib/storage.js';
import { crearRepositorio } from '../shared/lib/repositorio.js';
import { crearTienda } from '../shared/lib/tienda.js';
import { crearGeneradorId } from '../shared/lib/ids.js';
import { solicitarPersistencia } from '../shared/lib/dispositivo.js';
import { icono } from '../shared/ui/icono.js';
import { mostrarAviso } from '../shared/ui/aviso.js';
import { configurarHaptica } from '../shared/ui/haptica.js';
import * as esquema from './logica/esquema.js';
import { alAbrir } from './logica/acciones.js';
import { crearSemilla } from './seed.js';
import { crearPreferencias } from './preferencias.js';
import { crearPantallaActiva } from './pantalla.js';
import { crearGestorDescansos } from './gestor-descansos.js';
import * as entrenar from './vistas/entrenar.js';
import * as semana from './vistas/semana.js';
import * as progreso from './vistas/progreso.js';
import * as rutina from './vistas/rutina.js';
import * as ajustes from './vistas/ajustes.js';
import { montarRecuperacion, montarVersionFutura } from './vistas/recuperacion.js';
import { exportarDatos } from './vistas/datos.js';
import { callout } from './vistas/comun.js';

const CLAVE_DATOS = 'cte.gimnasio.datos';

/** Reporta un error inesperado sin romper la app (queda en la consola como error no capturado). */
function informar(e) {
  if (typeof reportError === 'function') reportError(e);
}
const RUTAS = {
  entrenar: { vista: entrenar, texto: 'Entrenar', icono: 'dumbbell' },
  semana: { vista: semana, texto: 'Semana', icono: 'calendar' },
  progreso: { vista: progreso, texto: 'Progreso', icono: 'trend' },
  rutina: { vista: rutina, texto: 'Rutina', icono: 'clipboard' },
  ajustes: { vista: ajustes, texto: 'Ajustes', icono: 'sliders' },
};

function leerHash() {
  const crudo = location.hash.replace(/^#\/?/, '');
  const [ruta, consulta = ''] = crudo.split('?');
  return { ruta: Object.prototype.hasOwnProperty.call(RUTAS, ruta) ? ruta : 'entrenar', params: new URLSearchParams(consulta) };
}

function arrancar() {
  const reloj = crearReloj();
  const generarId = crearGeneradorId();
  const almacen = crearAlmacen({ prefijo: 'cte.gimnasio.' });
  const repositorio = crearRepositorio({
    almacen, clave: CLAVE_DATOS, app: esquema.APP, version: esquema.VERSION, migraciones: esquema.migraciones,
    validar: esquema.validar, crearSemilla, reloj, generarId,
  });
  const carga = repositorio.cargar();
  // R1-03: el respaldo automático caduca a los 14 días (nunca si es la única copia útil: datos ilegibles, versión futura…).
  const respaldoVencido = repositorio.descartarRespaldoVencido();
  const tienda = crearTienda({ repositorio, reloj, generarId, carga });
  const prefs = crearPreferencias(almacen);
  // Gestor de descansos de la app (N3-01): detecta el fin de cada descanso y vibra desde cualquier pantalla; un descanso nuevo o ajustado
  // reevalúa la pantalla encendida (N3-02).
  let pantalla = null;
  const descansos = crearGestorDescansos({ reloj, tienda, alCambiar: () => { if (pantalla) pantalla.actualizar(); } });
  pantalla = crearPantallaActiva({ tienda, reloj, prefs, finDescanso: descansos.finDe }); // Wake Lock mientras cualquiera de las dos personas entrene (R2G-02b)
  configurarHaptica({ activa: prefs.obtener().vibracion });

  /* ---------- armazón ---------- */
  const raizApp = document.getElementById('app');
  vaciar(raizApp);
  const titulo = h('h1', { class: 'topbar__title' }, 'Entrenar');
  const sub = h('p', { class: 'topbar__sub' }, 'Centro de Entrenamiento');
  const acciones = h('div', { class: 'topbar__actions' });
  const avisos = h('div', { class: 'avisos', role: 'region', aria: { label: 'Avisos' } });
  const principal = h('main', { class: 'screen', id: 'contenido', tabIndex: -1 });
  const flotante = h('div', { class: 'float-zone' });
  // N-04: tocar "Entrenar" estando ya en `#/entrenar` no cambia la dirección (no hay `hashchange`): se vuelve a montar para que salte a hoy
  // (p. ej. tras terminar una sesión que cruzó la medianoche). Sin sesión en curso de otro día, sigue mostrando lo mismo.
  const alTocarNav = (clave) => () => { if (clave === 'entrenar' && location.hash === '#/entrenar') montarRuta(); };
  const botonesNav = Object.entries(RUTAS).map(([clave, r]) => h('a', { class: 'nav__item', href: `#/${clave}`, dataset: { ruta: clave }, on: { click: alTocarNav(clave) } }, icono(r.icono), h('span', null, r.texto)));
  const nav = h('nav', { class: 'nav', aria: { label: 'Navegación principal' } }, botonesNav);
  raizApp.append(h('header', { class: 'topbar' }, h('div', { class: 'topbar__titles' }, titulo, sub), acciones), avisos, principal, flotante, nav);

  const shell = {
    flotante,
    titulo(t, s) { titulo.textContent = t; sub.textContent = s ?? ''; sub.hidden = !s; },
    acciones(nodos) { vaciar(acciones); for (const n of nodos ?? []) acciones.appendChild(n); },
    relleno(on) { principal.classList.toggle('screen--float-pad', !!on); },
  };

  /* ---------- avisos permanentes ---------- */
  // Avisos del repositorio al cargar (E-4/E-5): migración sin guardar, respaldo fallido, texto ilegible no preservado.
  const CODIGOS_CARGA = new Set(['respaldo-fallido', 'migrado-sin-guardar', 'corrupto-no-preservado', 'cuota-llena']);
  const avisosCarga = (carga.avisos ?? []).filter((a) => a && CODIGOS_CARGA.has(a.codigo));
  function pintarAvisos() {
    vaciar(avisos);
    const estado = tienda.estadoCarga();
    if (avisosCarga.length) {
      avisos.append(callout({
        tipo: 'warn', icon: 'alert', titulo: 'Aviso de almacenamiento', texto: [...new Set(avisosCarga.map((a) => a.mensaje))].join(' '),
        hijos: [h('br'), h('button', { class: 'btn btn--secondary btn--sm', type: 'button', style: { marginTop: 'var(--sp-2)' }, on: { click: () => exportarDatos(ctxVista) } }, icono('download'), ' Exportar copia')],
      }));
    }
    if (almacen.modo === 'memoria' || estado === 'sin-almacenamiento') {
      avisos.append(callout({ tipo: 'danger', icon: 'alert', titulo: 'Los datos no se guardarán', texto: 'Este navegador no permite guardar datos (¿modo privado?). Se perderán al cerrar.' }));
    }
    if (estado === 'version-futura') {
      avisos.append(callout({ tipo: 'warn', icon: 'lock', titulo: 'Solo lectura', texto: 'Estos datos son de una versión más nueva de la app. Actualícela antes de editar.' }));
    }
    const uso = almacen.uso();
    if (uso.fraccion >= 0.7) {
      avisos.append(callout({ tipo: 'warn', icon: 'alert', titulo: 'Almacenamiento casi lleno', texto: `Se usa el ${Math.round(uso.fraccion * 100)} % del espacio disponible. Exporte sus datos en Ajustes y libere espacio.` }));
    }
  }

  /* ---------- persona activa en este celular ---------- */
  let personaActual = prefs.personaInicial();
  const persona = {
    actual: () => personaActual,
    fijar(id) {
      if (id !== 'p1' && id !== 'p2') return;
      personaActual = id;
      prefs.guardar({ ultimaPersona: id });
    },
  };

  /* ---------- enrutador ---------- */
  let vistaActual = null;
  let ctxVista = null;

  function navegar(ruta, params = {}, { reemplazar = false } = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) q.set(k, String(v));
    const consulta = q.toString();
    const hash = `#/${ruta}${consulta ? `?${consulta}` : ''}`;
    if (reemplazar) { history.replaceState(null, '', hash); montarRuta(); } else if (location.hash === hash) montarRuta();
    else location.hash = hash;
  }

  function montarRuta() {
    if (vistaActual) { try { vistaActual.desmontar(); } catch (e) { informar(e); } vistaActual = null; }
    vaciar(principal);
    shell.acciones([]);
    shell.relleno(false);
    const { ruta, params } = leerHash();
    for (const a of botonesNav) {
      if (a.dataset.ruta === ruta) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    pintarAvisos();
    try {
      vistaActual = RUTAS[ruta].vista.montar(principal, { ...ctxVista, parametros: params, ruta });
    } catch (e) {
      principal.append(callout({ tipo: 'danger', icon: 'alert', titulo: 'No se pudo mostrar esta pantalla', texto: 'Vuelva a abrir la app. Sus datos no se perdieron.' }));
      informar(e);
    }
    principal.scrollTop = 0;
  }

  ctxVista = { tienda, reloj, almacen, repositorio, prefs, persona, pantalla, descansos, navegar, shell, esquema };

  // Avisos con codigo que traen los eventos 'cambio' y 'recarga' (p. ej. 'respaldo-eliminado' al liberar espacio).
  const avisarCodigos = (lista) => {
    const vistos = new Set();
    for (const a of lista ?? []) {
      if (!a || !a.codigo || vistos.has(a.codigo)) continue;
      vistos.add(a.codigo);
      mostrarAviso(a.mensaje, { tipo: 'warn', duracion: 7000 });
    }
  };
  // Pantallas dedicadas (datos ilegibles o de una versión más nueva): hay que volver a arrancar cuando cambia el estado.
  const estadoEspecial = () => {
    const e = tienda.estadoCarga();
    return e === 'corrupto' || e === 'version-futura' ? e : null;
  };
  const arranqueEspecial = estadoEspecial() !== null;
  let silenciarConflicto = false; // R1-19: el cierre de días a medianoche no avisa de un conflicto con otra pestaña
  tienda.suscribir((ev) => {
    if (ev.tipo === 'error') {
      if (silenciarConflicto && ev.error === 'conflicto') return;
      mostrarAviso(ev.mensaje, { tipo: 'danger', duracion: 6000 });
      return;
    }
    avisarCodigos(ev.avisos);
    pantalla.actualizar(); // alguien empezó o terminó una sesión (aunque la vista no se redibuje)
    if (ev.tipo === 'recarga') {
      // R1-11: si el cambio (de otra pestaña) deja datos ilegibles o de versión futura, o los arregla, se arranca de nuevo para
      // mostrar la pantalla que corresponde en vez de dibujar datos que esta versión no entiende.
      if (arranqueEspecial || estadoEspecial() !== null) { location.reload(); return; }
      montarRuta();
    }
  });
  // El tope de 90 min sin actividad se reevalúa también al volver a la app (iOS suspende los temporizadores en segundo plano).
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { descansos.revisar(); pantalla.actualizar(); } });
  window.addEventListener('storage', (ev) => {
    if (esCambioDeDatos(ev, CLAVE_DATOS)) tienda.recargar();
  });

  /* ---------- recuperación (datos ilegibles) ---------- */
  if (tienda.estadoCarga() === 'corrupto') {
    shell.titulo('Recuperar datos', 'No se pudo leer lo guardado');
    nav.hidden = true; // sin datos legibles no hay pantallas a las que ir
    montarRecuperacion(principal, { ...ctxVista }, carga, () => location.reload());
    return;
  }

  /* ---------- datos de una versión más nueva: no se dibujan ni se guardan ---------- */
  if (tienda.estadoCarga() === 'version-futura') {
    shell.titulo('Actualice la app', 'Datos de una versión más nueva');
    nav.hidden = true;
    const crudo = almacen.leer(CLAVE_DATOS);
    montarVersionFutura(principal, ctxVista, crudo.ok ? crudo.texto : null);
    return;
  }

  /* ---------- abrir: limpiar registros futuros y cerrar días pasados ---------- */
  tienda.ejecutar(alAbrir, {}, { pura: true });

  window.addEventListener('hashchange', montarRuta);
  vigilarCambioDeDia(reloj, () => {
    if (estadoEspecial() !== null) return;
    silenciarConflicto = true;
    try { tienda.ejecutar(alAbrir, {}, { pura: true }); } finally { silenciarConflicto = false; }
    pantalla.actualizar();
    montarRuta();
  });

  montarRuta();
  pantalla.actualizar(); // una sesión en curso de antes de recargar mantiene la pantalla encendida desde cualquier pantalla
  if (respaldoVencido.descartado) mostrarAviso('Se descartó el respaldo automático de hace más de 14 días.');
  solicitarPersistencia();
}

try {
  arrancar();
} catch (e) {
  const raiz = document.getElementById('app');
  if (raiz) {
    vaciar(raiz);
    raiz.append(h('main', { class: 'screen' }, callout({ tipo: 'danger', icon: 'alert', titulo: 'La app no pudo iniciar', texto: 'Cierre y vuelva a abrir la app. Si el problema sigue, sus datos están a salvo en este dispositivo.' })));
  }
  informar(e);
}
