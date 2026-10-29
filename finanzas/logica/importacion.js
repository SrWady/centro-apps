/*
 * importacion.js — clasifica los avisos de la validación al importar una copia y traduce las rutas técnicas (PURO). R1F-21a, R2F N-09.
 * Antes todos salían como "Se descartaron N campos desconocidos", aunque algunos fueran íconos reemplazados o números de
 * tarjeta/cuenta ocultados. Cada aviso es { ruta, mensaje, codigo? } (shared/lib/validacion.js y esquema.js).
 */
import { formatearFecha } from '../../shared/lib/fechas.js';

const SUJETOS = { movimientos: 'movimiento', cuentas: 'cuenta', deudas: 'deuda', categorias: 'categoría', recurrentes: 'pago recurrente', metas: 'meta' };

/** Nombre en lenguaje claro de cada campo que puede aparecer al final de una ruta (con su sufijo si es anidado: 'frecuencia.dia'). */
const CAMPOS = {
  id: 'identificador', nombre: 'nombre', tipo: 'tipo', nota: 'nota', notas: 'notas', entidad: 'entidad', icono: 'ícono', orden: 'orden', archivada: 'archivada', grupo: 'grupo',
  vinculo: 'vínculo automático', monto: 'monto', fecha: 'fecha', interes: 'interés', origen: 'origen', ocurrencia: 'ocurrencia del pago programado',
  cuentaId: 'cuenta', cuentaDestinoId: 'cuenta de destino', categoriaId: 'categoría', deudaId: 'deuda', metaId: 'meta',
  saldoInicial: 'saldo inicial', fechaSaldoInicial: 'fecha del saldo inicial', cuota: 'cuota', diaPago: 'día de pago', tasa: 'tasa', 'tasa.porcentaje': 'porcentaje de la tasa',
  objetivo: 'objetivo', fechaLimite: 'fecha límite', creadoEn: 'fecha de creación', creadaEn: 'fecha de creación', actualizadoEn: 'fecha de actualización',
  rango: 'rango', frecuencia: 'frecuencia', 'frecuencia.tipo': 'frecuencia', 'frecuencia.dia': 'día del mes', 'frecuencia.diaSemana': 'día de la semana', desde: 'fecha de inicio', activo: 'activo',
  ingresoPlaneado: 'ingreso planeado', asignaciones: 'asignaciones', pagoDeudasFijo: 'pago de deudas fijado a mano', pagoDeudasCongelado: 'pago de deudas congelado', sinSalario: 'ciclo sin salario',
  montoMensual: 'monto mensual', variable: 'ingreso variable', avisoPct: 'porcentaje de aviso', excesoPct: 'porcentaje de exceso', desdeCiclo: 'ciclo desde el que rige', dia: 'día',
  cicloInicial: 'ciclo inicial', metaGrupos: 'reparto 50/30/20', alertas: 'alertas',
};
const RAIZ = {
  schemaVersion: 'versión del archivo', app: 'aplicación', rev: 'revisión', creadoEn: 'fecha de creación', actualizadoEn: 'fecha de actualización',
  presupuestos: 'presupuestos', categorias: 'categorías', '(montos)': 'montos', '(raíz)': '',
};

const campo = (c) => (c ? (CAMPOS[c] ?? c) : null);
const unir = (partes) => partes.filter(Boolean).join(', ');
/** '2026-11' → 'noviembre 2026'; un ciclo que no se entiende se deja tal cual. */
function nombreDeCiclo(ciclo) {
  try { return formatearFecha(`${ciclo}-01`, 'mes-anio'); } catch { return ciclo; }
}

/**
 * Ruta de un aviso o error en lenguaje claro: 'movimientos[2].nota' → 'movimiento 3, nota'; 'ajustes.ingreso.nombre' → 'ingreso, nombre';
 * 'presupuestos["2026-11"].asignaciones.cat-ropa' → 'presupuesto de noviembre 2026' (N3-07: el id interno de la categoría no se muestra; el mensaje del error ya nombra la categoría); 'ajustes.diaPago[1].desdeCiclo' →
 * 'día de pago 2, ciclo desde el que rige'. Una ruta que no se reconoce se devuelve tal cual (nunca lanza).
 */
export function describirRuta(ruta) {
  if (typeof ruta !== 'string') return '';
  const m = /^(movimientos|cuentas|deudas|categorias|recurrentes|metas)\[(\d+)\](?:\.(.+))?$/.exec(ruta);
  if (m) return unir([`${SUJETOS[m[1]] ?? m[1]} ${Number(m[2]) + 1}`, campo(m[3])]);
  const p = /^presupuestos\["([^"]+)"\](?:\.(.+))?$/.exec(ruta);
  if (p) {
    const a = p[2] ? /^asignaciones\.(.+)$/.exec(p[2]) : null;
    return unir([`presupuesto de ${nombreDeCiclo(p[1])}`, a ? null : campo(p[2])]);
  }
  const d = /^ajustes\.diaPago\[(\d+)\](?:\.(.+))?$/.exec(ruta);
  if (d) return unir([`día de pago ${Number(d[1]) + 1}`, campo(d[2])]);
  const i = /^ajustes\.ingreso\.(.+)$/.exec(ruta);
  if (i) return unir(['ingreso', campo(i[1])]);
  const a = /^ajustes\.(metaGrupos|alertas)(?:\.(.+))?$/.exec(ruta);
  if (a) return unir([campo(a[1]), a[2] ? (campo(a[2]) ?? a[2]) : null]);
  const aj = /^ajustes\.([A-Za-z]+)$/.exec(ruta);
  if (aj && CAMPOS[aj[1]]) return CAMPOS[aj[1]];
  if (Object.prototype.hasOwnProperty.call(RAIZ, ruta)) return RAIZ[ruta];
  return ruta;
}

/** Igual que `describirRuta` con la primera letra en mayúscula (para encabezar un mensaje de error). */
export function describirRutaTitulo(ruta) {
  const t = describirRuta(ruta);
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/**
 * N-09: un error de validación (`{ ruta, mensaje }`) en una línea para el usuario, sin rutas técnicas:
 * { ruta: 'movimientos[0].monto', mensaje: 'El valor no puede superar $ 10.000.000.000.' } → 'Movimiento 1, monto: El valor no puede superar $ 10.000.000.000.'
 */
export function describirError(e) {
  if (!e || typeof e !== 'object') return '';
  const donde = describirRutaTitulo(e.ruta);
  return `${donde ? `${donde}: ` : ''}${e.mensaje ?? ''}`.trim();
}

/** Concordancia (N-04): "Se descartó 1 campo desconocido" / "Se descartaron 3 campos desconocidos". */
export function textoDescartados(n) {
  return n === 1 ? 'Se descartó 1 campo desconocido' : `Se descartaron ${n} campos desconocidos`;
}

/** Concordancia (N-04): "Se ocultó 1 número de 13 a 19 dígitos" / "Se ocultaron 4 números de tarjeta o de cuenta" (si alguno es una cuenta de 10 a 12). */
export function textoOcultados(n, { conCuentas = false } = {}) {
  const de = conCuentas ? 'de tarjeta o de cuenta' : 'de 13 a 19 dígitos';
  return n === 1 ? `Se ocultó 1 número ${de}` : `Se ocultaron ${n} números ${de}`;
}

/** @returns {{descartados:string[], numeros:string[], ajustes:Array<{mensaje:string, rutas:string[]}>}} rutas por tipo de aviso */
export function agruparAvisos(avisos) {
  const descartados = [];
  const numeros = [];
  const porMensaje = new Map();
  for (const a of avisos ?? []) {
    if (a.codigo === 'numero-largo') numeros.push(a.ruta);
    else if (/desconocido descartado/i.test(a.mensaje)) descartados.push(a.ruta);
    else {
      if (!porMensaje.has(a.mensaje)) porMensaje.set(a.mensaje, []);
      porMensaje.get(a.mensaje).push(a.ruta);
    }
  }
  return { descartados, numeros, ajustes: [...porMensaje].map(([mensaje, rutas]) => ({ mensaje, rutas })) };
}

/** ¿Entre los avisos de números ocultados hay alguna cuenta bancaria (10 a 12 dígitos)? Decide el texto del título. */
export function hayCuentasOcultas(avisos) {
  return (avisos ?? []).some((a) => a.codigo === 'numero-largo' && a.tipo === 'cuenta');
}
