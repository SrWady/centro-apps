/*
 * iconos.js — catálogo de íconos (trazo, 24x24, currentColor). Sin efectos al importar.
 *
 * Dos niveles:
 *  - ICONOS_UI: íconos de interfaz (más, check, flechas...). Solo los usa el código; NO se guardan en datos.
 *  - CATALOGO_ICONOS: íconos que el usuario puede asignar a una categoría o cuenta. En los datos se guarda
 *    SOLO la clave (texto, p. ej. "mercado"); aquí se traduce a SVG. Claves desconocidas -> "otro" (nunca se inserta texto del usuario).
 * Las claves del catálogo son estables: no se renombran ni se borran (datos ya guardados dependen de ellas).
 */
export const ICONOS_UI = {
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  x: ['M6 6l12 12M18 6L6 18'],
  'chevron-left': ['M15 5l-7 7 7 7'],
  'chevron-right': ['M9 5l7 7-7 7'],
  'chevron-down': ['M5 9l7 7 7-7'],
  'chevron-up': ['M5 15l7-7 7 7'],
  more: ['M5 12h.01M12 12h.01M19 12h.01'],
  home: ['M4 11l8-7 8 7M6 10v9h12v-9M10 19v-5h4v5'],
  list: ['M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01'],
  pie: ['M12 3a9 9 0 1 0 9 9h-9V3z', 'M15.5 3.6A9 9 0 0 1 20.4 8.5h-4.9V3.6z'],
  card: ['M3 6h18v12H3zM3 10h18M7 15h3'],
  target: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 12h.01'],
  wallet: ['M4 7a2 2 0 0 1 2-2h11v2M4 7v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H4zM16 13.5h.01'],
  bars: ['M5 20V10M12 20V4M19 20v-7'],
  trend: ['M3 17l6-6 4 4 8-8M15 7h6v6'],
  calendar: ['M4 6h16v14H4zM4 10h16M8 3v4M16 3v4'],
  dumbbell: ['M6 7v10M3 9.5v5M18 7v10M21 9.5v5M6 12h12'],
  clipboard: ['M9 4h6v3H9zM6 5.5H5v15h14v-15h-1M9 12h6M9 16h4'],
  sliders: ['M4 7h9M17 7h3M15 4v6M4 17h3M11 17h9M9 14v6'],
  trophy: ['M8 4h8v5a4 4 0 0 1-8 0zM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M8 20h8M9.5 17h5'],
  timer: ['M12 8v5l3 2M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM9 2h6'],
  alert: ['M12 4l9 16H3zM12 10v4M12 17h.01'],
  info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01'],
  download: ['M12 4v11M7 11l5 5 5-5M5 20h14'],
  upload: ['M12 16V5M7 9l5-5 5 5M5 20h14'],
  trash: ['M5 7h14M10 4h4M7 7l1 13h8l1-13M10 11v6M14 11v6'],
  pencil: ['M4 20l1-4L16 5l3 3L8 19zM14 7l3 3'],
  grip: ['M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01'],
  backspace: ['M9 5h11v14H9l-6-7zM12 9l5 6M17 9l-5 6'],
  'arrow-up-right': ['M7 17L17 7M8 7h9v9'],
  'arrow-down-left': ['M17 7L7 17M16 17H7V8'],
  swap: ['M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l4 4'],
  link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  copy: ['M8 8h11v12H8zM5 16V4h11'],
  activity: ['M3 12h4l3-8 4 16 3-8h4'],
  user: ['M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM5 20a7 7 0 0 1 14 0'],
  users: ['M9 5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM2.5 20a6.5 6.5 0 0 1 13 0M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14a6.5 6.5 0 0 1 3.5 6'],
  vibrate: ['M8 3h8v18H8zM11 18h2M4 9v6M20 9v6'],
  lock: ['M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  play: ['M8 5l11 7-11 7z'],
  skip: ['M5 5l9 7-9 7zM18 5v14'],
  filter: ['M4 5h16l-6 8v6l-4-2v-4z'],
  restore: ['M4 12a8 8 0 1 0 3-6.2M4 4v4h4'],
  note: ['M5 4h14v16H5zM8 9h8M8 13h8M8 17h5']
};

/** Catálogo asignable a categorías y cuentas: clave estable (texto guardado en datos) -> rutas SVG. */
export const CATALOGO_ICONOS = {
  hogar: ICONOS_UI.home,
  servicios: ['M13 3L5 14h6l-1 7 8-11h-6z'],
  celular: ['M8 3h8v18H8zM11 18h2'],
  mercado: ['M3 4h2l2.2 11h10.6L20 7H6.2M9 20h.01M17 20h.01'],
  transporte: ['M5 4h14v13H5zM5 11h14M8 17v3M16 17v3M8.5 14h.01M15.5 14h.01'],
  educacion: ['M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10'],
  comida: ['M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-3 5-3 8h3v10M17 3v8'],
  ocio: ['M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4'],
  compras: ['M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2'],
  suscripciones: ['M4 11V9a3 3 0 0 1 3-3h12l-3-3M20 13v2a3 3 0 0 1-3 3H5l3 3'],
  deporte: ICONOS_UI.dumbbell,
  salud: ['M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z'],
  viaje: ['M3 12l18-8-5 16-4-6-5-2zM12 14l4-6'],
  regalo: ['M4 9h16v4H4zM6 13v7h12v-7M12 9v11M12 9c-2 0-4-1-4-3s3-2 4 3c1-5 4-5 4-3s-2 3-4 3'],
  deuda: ICONOS_UI.card,
  tarjeta: ICONOS_UI.card,
  escudo: ['M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z'],
  banco: ['M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18'],
  efectivo: ICONOS_UI.wallet,
  ahorro: ICONOS_UI.target,
  ingreso: ICONOS_UI['arrow-down-left'],
  transferencia: ICONOS_UI.swap,
  otro: ['M3 12V4h8l10 10-8 8zM7.5 8h.01']
};
export const CLAVES_ICONO_CATEGORIA = ['hogar', 'servicios', 'celular', 'mercado', 'transporte', 'educacion', 'comida', 'ocio', 'compras', 'suscripciones', 'deporte', 'salud', 'viaje', 'regalo', 'deuda', 'ahorro', 'escudo', 'ingreso', 'otro'];
export const CLAVES_ICONO_CUENTA = ['banco', 'efectivo', 'tarjeta', 'ahorro', 'otro'];

/** ¿Es una clave válida del catálogo? (para validar datos importados) */
export function esClaveIcono(clave) {
  return typeof clave === 'string' && Object.prototype.hasOwnProperty.call(CATALOGO_ICONOS, clave);
}

/** Rutas por nombre: primero íconos de UI, luego catálogo; clave desconocida -> 'otro'. */
export function rutasDe(nombre) {
  if (Object.prototype.hasOwnProperty.call(ICONOS_UI, nombre)) return ICONOS_UI[nombre];
  if (esClaveIcono(nombre)) return CATALOGO_ICONOS[nombre];
  return CATALOGO_ICONOS.otro;
}
