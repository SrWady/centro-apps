/*
 * app.js — arranque de Finanzas (docs/ARQUITECTURA.md §5.7): reloj → almacén → repositorio → carga → tienda → alAbrir →
 * enrutador por hash → vigilante de cambio de día → evento 'storage' (otra pestaña) → persistencia.
 * Es el único archivo que arranca cosas; las vistas y la lógica no tienen efectos al importarse.
 * Los datos de Fase 5 (manifest, íconos, service worker) se agregan después sin tocar este flujo.
 */
import { crearReloj, vigilarCambioDeDia } from '../shared/lib/reloj.js';
import { crearAlmacen, esCambioDeDatos } from '../shared/lib/storage.js';
import { crearRepositorio } from '../shared/lib/repositorio.js';
import { crearTienda } from '../shared/lib/tienda.js';
import { crearGeneradorId } from '../shared/lib/ids.js';
import { solicitarPersistencia } from '../shared/lib/dispositivo.js';
import { h, vaciar } from '../shared/lib/dom.js';
import { icono } from '../shared/ui/icono.js';
import { abrirHoja, cerrarHojaSuperior } from '../shared/ui/hoja.js';
import { configurarHaptica } from '../shared/ui/haptica.js';
import { APP, VERSION, migraciones, validar } from './logica/esquema.js';
import * as acciones from './logica/acciones.js';
import { guardarVistos, leerVistos, resumirAvisosDeCarga } from './logica/carga.js';
import { crearPreferencias } from './logica/preferencias.js';
import { crearSemilla } from './seed.js';
import * as inicio from './vistas/inicio.js';
import * as movimientos from './vistas/movimientos.js';
import * as presupuesto from './vistas/presupuesto.js';
import * as deudas from './vistas/deudas.js';
import * as metas from './vistas/metas.js';
import * as cuentas from './vistas/cuentas.js';
import * as reportes from './vistas/reportes.js';
import * as ajustes from './vistas/ajustes.js';
import { abrirFormulario } from './vistas/agregar.js';
import { mostrarRecuperacion } from './vistas/recuperacion.js';
import { avisarRepositorio, boton, mostrarAviso } from './vistas/comun.js';
import { exportar } from './vistas/datos.js';
import { entregarArchivo } from '../shared/lib/exportacion.js';

const CLAVE_DATOS = 'cte.finanzas.datos';
const RUTAS = { inicio, movimientos, presupuesto, deudas, metas, cuentas, reportes, ajustes };
const RUTA_POR_DEFECTO = 'inicio';
const PESTANAS = [
  { ruta: 'inicio', titulo: 'Inicio', icono: 'home' },
  { ruta: 'movimientos', titulo: 'Movimientos', icono: 'list' },
  { ruta: 'presupuesto', titulo: 'Presupuesto', icono: 'pie' },
  { ruta: 'deudas', titulo: 'Deudas', icono: 'card' },
];
const EN_MAS = [
  { ruta: 'metas', titulo: 'Metas de ahorro', sub: 'Viaje, vehículo, fondo de emergencia…', icono: 'target' },
  { ruta: 'cuentas', titulo: 'Cuentas', sub: 'Saldos y patrimonio neto', icono: 'wallet' },
  { ruta: 'reportes', titulo: 'Reportes', sub: 'Categorías, tendencia y ahorro', icono: 'bars' },
  { ruta: 'ajustes', titulo: 'Ajustes', sub: 'Ingreso, día de pago y datos', icono: 'sliders' },
];

function arrancar() {
  const reloj = crearReloj();
  const generarId = crearGeneradorId();
  const almacen = crearAlmacen({ prefijo: 'cte.finanzas.' });
  // R3F-01b: los datos YA guardados se validan en modo 'carga': solo se enmascara lo de alta confianza (tarjeta con Luhn y marca); lo dudoso se avisa y no se toca.
  const validarAlCargar = (obj) => validar(obj, { modo: 'carga' });
  const repositorio = crearRepositorio({ almacen, clave: CLAVE_DATOS, app: APP, version: VERSION, migraciones, validar: validarAlCargar, crearSemilla, reloj, generarId });
  const carga = repositorio.cargar();
  const preferencias = crearPreferencias(almacen);
  configurarHaptica({ activa: preferencias.leer().vibracion });
  const tienda = crearTienda({ repositorio, reloj, generarId, carga });

  const pantalla = document.getElementById('contenido');
  const tituloEl = document.getElementById('titulo-pantalla');
  const subEl = document.getElementById('subtitulo-pantalla');
  const zonaFlotante = document.getElementById('zona-flotante');
  const nav = document.getElementById('navegacion');
  const avisos = document.getElementById('avisos-globales');

  const shell = {
    titulo(titulo, sub) {
      tituloEl.textContent = titulo;
      subEl.textContent = sub || '';
      subEl.hidden = !sub;
      document.title = `${titulo} · Finanzas`;
    },
    fab(visible) {
      zonaFlotante.hidden = !visible;
      pantalla.classList.toggle('screen--float-pad', visible);
    },
  };
  const ctx = {
    tienda, reloj, almacen, repositorio, preferencias, acciones, shell, generarId,
    navegar(ruta, params) { location.hash = `#/${ruta}${params ? `?${new URLSearchParams(params)}` : ''}`; },
    parametros: new URLSearchParams(),
  };

  // --- Botón flotante "+" ---
  const fab = h('button', { class: 'fab', type: 'button', aria: { label: 'Agregar movimiento' }, on: { click: () => abrirFormulario(ctx, { tipo: 'gasto' }) } }, icono('plus'));
  zonaFlotante.append(fab);

  // --- Navegación inferior: 4 pestañas + "Más" ---
  const botonesNav = new Map();
  for (const p of PESTANAS) {
    const a = h('a', { class: 'nav__item', href: `#/${p.ruta}` }, icono(p.icono), h('span', null, p.titulo));
    botonesNav.set(p.ruta, a);
    nav.append(a);
  }
  const mas = h('button', { class: 'nav__item', type: 'button', aria: { haspopup: 'dialog' }, on: { click: abrirMas } }, icono('more'), h('span', null, 'Más'));
  nav.append(mas);
  function abrirMas() {
    const lista = h('div', { class: 'list' }, EN_MAS.map((m) => h('a', { class: 'item', href: `#/${m.ruta}`, on: { click: () => cerrarHojaSuperior() } },
      h('span', { class: 'item__icon item__icon--accent' }, icono(m.icono)),
      h('div', { class: 'item__main' }, h('div', { class: 'item__title' }, m.titulo), h('div', { class: 'item__sub' }, m.sub)),
      icono('chevron-right'))));
    abrirHoja([h('div', { class: 'sheet__body' }, lista)], { titulo: 'Más' });
  }
  function marcarNav(ruta) {
    for (const [r, a] of botonesNav) { if (r === ruta) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
    if (EN_MAS.some((m) => m.ruta === ruta)) mas.setAttribute('aria-current', 'page'); else mas.removeAttribute('aria-current');
  }

  // --- Avisos globales ---
  function pintarAvisos() {
    vaciar(avisos);
    const estado = tienda.estadoCarga();
    const aviso = (clase, titulo, texto) => avisos.append(h('div', { class: `callout callout--${clase}`, role: 'status' }, icono('alert'), h('div', null, h('span', { class: 'callout__title' }, titulo), h('br'), texto)));
    if (almacen.modo === 'memoria' || estado === 'sin-almacenamiento') aviso('warn', 'Los datos no se guardarán', 'Este navegador no permite guardar datos (¿modo privado?). Se perderán al cerrar.');
    if (estado === 'version-futura') aviso('danger', 'Solo lectura', 'Estos datos son de una versión más nueva de la app. Actualícela antes de editar.');
    if (carga.errorGuardado && estado !== 'sin-almacenamiento' && almacen.modo !== 'memoria') {
      // Migración o primer guardado sin espacio: los datos viven solo en memoria hasta que el usuario libere espacio.
      avisos.append(h('div', { class: 'callout callout--warn', role: 'status' }, icono('alert'), h('div', null, h('span', { class: 'callout__title' }, 'No se pudo guardar'), h('br'), carga.errorGuardado.mensaje), boton('Exportar', { clase: 'btn--secondary btn--sm callout__action', onClick: () => exportar(ctx) })));
    }
  }

  // --- Enrutador por hash ---
  let vista = null;
  function leerRuta() {
    const [nombre, consulta = ''] = location.hash.replace(/^#\/?/, '').split('?');
    return { nombre: Object.prototype.hasOwnProperty.call(RUTAS, nombre) ? nombre : RUTA_POR_DEFECTO, parametros: new URLSearchParams(consulta) };
  }
  function montarVista() {
    if (vista) { try { vista.desmontar(); } catch { /* una vista que falla al desmontar no debe bloquear la navegación */ } vista = null; }
    const { nombre, parametros } = leerRuta();
    if (location.hash === '' || !location.hash.startsWith(`#/${nombre}`)) history.replaceState(null, '', `#/${nombre}`);
    pantalla.scrollTop = 0;
    marcarNav(nombre);
    vista = RUTAS[nombre].montar(pantalla, { ...ctx, parametros });
  }
  function pantallaVersionFutura() {
    // Datos de una versión más nueva: no se dibujan con las vistas de esta versión (solo lectura).
    nav.hidden = true;
    shell.titulo('Actualice la app', '');
    shell.fab(false);
    vaciar(pantalla);
    pantalla.append(
      h('div', { class: 'callout callout--danger' }, icono('alert'), h('div', null, h('span', { class: 'callout__title' }, 'Estos datos son de una versión más nueva'), h('br'), 'Actualice la app (cierre y vuelva a abrirla con conexión) antes de editar. Mientras tanto no se guarda nada.')),
      boton('Exportar el texto guardado', { icono: 'download', clase: 'btn--secondary btn--block', onClick: async () => { const l = almacen.leer(CLAVE_DATOS); await entregarArchivo({ nombre: 'finanzas-datos.json', texto: l.ok && l.texto ? l.texto : '' }); } }));
  }
  // R2F-13: los números de tarjeta o de cuenta ocultados se avisan UNA vez (singular/plural), no uno por campo.
  // R3F-01c: lo dudoso (que NO se tocó) se avisa en un solo aviso aparte y solo la primera vez que se ve ese texto.
  function avisarCarga(avisos) {
    const vistos = leerVistos(almacen);
    const resumen = resumirAvisosDeCarga(avisos, { vistos });
    avisarRepositorio(resumen.otros);
    if (resumen.aviso) mostrarAviso(resumen.aviso.mensaje, { tipo: 'warn', duracion: 10000 });
    if (resumen.avisoDudosos) {
      mostrarAviso(resumen.avisoDudosos.mensaje, { tipo: 'warn', duracion: 12000 });
      guardarVistos(almacen, vistos, resumen.avisoDudosos.huellas);
    }
    return resumen;
  }
  function iniciar() {
    pintarAvisos();
    const avisosDeCarga = (carga.avisos ?? []).filter((a) => a.codigo && a.codigo !== 'no-disponible' && a.codigo !== 'cuota-llena');
    const resumenCarga = avisarCarga(avisosDeCarga);
    if (tienda.estadoCarga() === 'version-futura') { pantallaVersionFutura(); return; }
    // R2F-13: lo que se ocultó al cargar (solo tarjetas de alta confianza) queda guardado ya saneado; lo dudoso se deja intacto (R3F-01b).
    if (resumenCarga.numeros > 0) tienda.ejecutar(acciones.guardarSaneado, {});
    tienda.ejecutar(acciones.alAbrir, {});
    window.addEventListener('hashchange', montarVista);
    montarVista();
    tienda.suscribir((evento) => {
      if (evento.avisos) avisarCarga(evento.avisos); // avisos del repositorio (respaldo eliminado, etc.)
      if (vista && (evento.tipo === 'cambio' || evento.tipo === 'recarga')) vista.actualizar(evento);
    });
    vigilarCambioDeDia(reloj, () => { tienda.ejecutar(acciones.alAbrir, {}); if (vista) vista.actualizar({ tipo: 'dia' }); });
    window.addEventListener('storage', (e) => { if (esCambioDeDatos(e, CLAVE_DATOS)) tienda.recargar(); });
  }

  if (tienda.estadoCarga() === 'corrupto') {
    nav.hidden = true;
    avisarRepositorio((carga.avisos ?? []).filter((a) => a.codigo && a.codigo !== 'no-disponible'));
    mostrarRecuperacion(pantalla, ctx, carga, () => { nav.hidden = false; iniciar(); });
  } else {
    iniciar();
  }
  // Pedir almacenamiento persistente, sin bloquear ni mostrar errores (en iOS la protección real es instalar la app).
  solicitarPersistencia().catch(() => {});
  // Fase 5 (pwa-despliegue): registrar ./sw.js aquí, dentro de try/catch.
}

arrancar();
