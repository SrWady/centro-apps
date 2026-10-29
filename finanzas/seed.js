/*
 * seed.js — ÚNICA semilla de datos de Finanzas (H8: aislada para poder cambiarla sin tocar nada más).
 *
 * POLÍTICA DE DATOS (T5.8, decisión del usuario 2026-10-28): el repositorio es PÚBLICO, así que esta semilla trae SOLO DATOS DE EJEMPLO,
 * claramente ficticios (ingreso de $ 2.000.000, saldos y cuotas redondos). Los datos reales del usuario viven en
 * privado/finanzas-datos-reales.privado.json (fuera del repositorio y de lo que se publica) y se cargan en el celular con
 * Ajustes → Datos → Importar copia. Mientras los datos sean esta semilla sin tocar, Inicio muestra una tarjeta de
 * bienvenida (logica/bienvenida.js). NUNCA pongas aquí cifras, nombres de banco ni notas reales.
 *
 * La ESTRUCTURA es contrato de las pruebas (docs/ESQUEMA-FINANZAS.md): IDs cta-*, cat-*, deu-*, rec-*, met-emergencia; ciclo inicial 2026-11;
 * día de pago 1; los 16 rubros y sus grupos; rec-servicios con rango; la gasolina NO es recurrente (se registra a mano y sale de Transporte).
 * Los valores de ejemplo son coherentes entre sí: presupuesto ≈ 50/30/20 con algo sin asignar; el aporte sugerido de la meta coincide con
 * la asignación de "Ahorro y metas"; "Pago de deudas" = Σ cuotas (calculado, no es un número fijo).
 *
 * Supuestos de estructura: los recurrentes, la cuota de cada deuda y las demás fechas de cobro se siembran el día 1; los saldos son al
 * 2026-11-01. Las deudas no traen tasa (opcional): el simulador avisa y calcula sin intereses. No hay campos para número de tarjeta ni de cuenta.
 *
 * crearSemilla(ctx) → objeto completo de datos (ESQUEMA-FINANZAS §2). Es puro: usa ctx.ahora para las marcas de tiempo.
 */
import { VERSION, APP } from './logica/esquema.js';

export const CICLO_INICIAL = '2026-11';
export const FECHA_SALDOS = '2026-11-01';

const cuentas = () => [
  { id: 'cta-principal', nombre: 'Cuenta principal', tipo: 'banco', saldoInicial: 0, fechaSaldoInicial: FECHA_SALDOS, deudaId: null, icono: 'banco', orden: 1, archivada: false },
  { id: 'cta-efectivo', nombre: 'Efectivo', tipo: 'efectivo', saldoInicial: 0, fechaSaldoInicial: FECHA_SALDOS, deudaId: null, icono: 'efectivo', orden: 2, archivada: false },
  { id: 'cta-tarjeta-bdb', nombre: 'Tarjeta de crédito Banco', tipo: 'credito', saldoInicial: null, fechaSaldoInicial: null, deudaId: 'deu-tarjeta-bdb', icono: 'tarjeta', orden: 3, archivada: false },
];

const deudas = () => [
  { id: 'deu-tarjeta-bdb', nombre: 'Tarjeta de crédito', entidad: 'Banco', tipo: 'tarjeta', saldoInicial: 1000000, fechaSaldoInicial: FECHA_SALDOS, cuota: 100000, diaPago: 1, tasa: null, cuentaId: 'cta-tarjeta-bdb', notas: 'Ejemplo: se paga el mínimo.', archivada: false },
  { id: 'deu-libre-bdb', nombre: 'Crédito de libre destino', entidad: 'Banco', tipo: 'credito', saldoInicial: 3000000, fechaSaldoInicial: FECHA_SALDOS, cuota: 200000, diaPago: 1, tasa: null, cuentaId: null, notas: '', archivada: false },
];

// [id, nombre, grupo, vínculo, ícono, presupuesto del primer ciclo]  (null = se calcula)
const FILAS_CATEGORIAS = [
  ['cat-servicios', 'Servicios', 'necesidades', null, 'servicios', 100000],
  ['cat-internet-celular', 'Internet y celular', 'necesidades', null, 'celular', 50000],
  ['cat-mercado', 'Mercado', 'necesidades', null, 'mercado', 250000],
  ['cat-transporte', 'Transporte', 'necesidades', null, 'transporte', 100000],
  ['cat-salud', 'Salud', 'necesidades', null, 'salud', 50000],
  ['cat-educacion', 'Educación', 'necesidades', null, 'educacion', 150000],
  ['cat-pago-deudas', 'Pago de deudas', 'necesidades', 'cuotas-deudas', 'deuda', null],
  ['cat-restaurantes', 'Restaurantes', 'gustos', null, 'comida', 120000],
  ['cat-entretenimiento', 'Entretenimiento', 'gustos', null, 'ocio', 100000],
  ['cat-ropa', 'Ropa', 'gustos', null, 'compras', 80000],
  ['cat-suscripciones', 'Suscripciones', 'gustos', null, 'suscripciones', 40000],
  ['cat-gimnasio', 'Gimnasio', 'gustos', null, 'deporte', 60000],
  ['cat-regalos', 'Regalos', 'gustos', null, 'regalo', 40000],
  ['cat-otros', 'Otros', 'gustos', null, 'otro', 100000],
  ['cat-ahorro-metas', 'Ahorro y metas', 'ahorro', 'metas', 'escudo', 200000],
  ['cat-abono-extra', 'Abono extra a deudas', 'ahorro', 'abono-deudas', 'deuda', 200000],
];

const categorias = () => [
  ...FILAS_CATEGORIAS.map(([id, nombre, grupo, vinculo, icono], i) => ({ id, nombre, tipo: 'gasto', grupo, vinculo, icono, orden: i + 1, archivada: false })),
  { id: 'cat-salario', nombre: 'Salario', tipo: 'ingreso', grupo: null, vinculo: null, icono: 'ingreso', orden: 17, archivada: false },
  { id: 'cat-otros-ingresos', nombre: 'Otros ingresos', tipo: 'ingreso', grupo: null, vinculo: null, icono: 'ingreso', orden: 18, archivada: false },
];

const recurrente = (id, nombre, monto, categoriaId, rango = null) => ({
  id, nombre, tipo: 'gasto', monto, rango, categoriaId, cuentaId: 'cta-principal', frecuencia: { tipo: 'mensual', dia: 1 }, activo: true, desde: FECHA_SALDOS,
});

const recurrentes = () => [
  recurrente('rec-servicios', 'Servicios', 100000, 'cat-servicios', { min: 80000, max: 100000 }),
  recurrente('rec-celular', 'Celular', 50000, 'cat-internet-celular'),
  recurrente('rec-gimnasio', 'Gimnasio', 60000, 'cat-gimnasio'),
  recurrente('rec-educacion', 'Educación', 150000, 'cat-educacion'),
  recurrente('rec-netflix', 'Netflix', 20000, 'cat-suscripciones'),
  recurrente('rec-youtube', 'YouTube', 20000, 'cat-suscripciones'),
];

// Meta de ejemplo a una fecha lejana: ciclos 2026-11 … 2029-04 = 30 → 6.000.000 / 30 = 200.000 por ciclo (igual a lo asignado en "Ahorro y metas").
const metas = () => [
  { id: 'met-emergencia', nombre: 'Fondo de emergencia', objetivo: 6000000, fechaLimite: '2029-04-30', cuentaId: null, icono: 'escudo', creadaEn: '2026-10-28', archivada: false },
];

/** "Pago de deudas" del primer ciclo = Σ cuotas (H2): se calcula, no es un número fijo. */
function pagoDeudasInicial(ds) {
  return ds.reduce((suma, d) => suma + (d.saldoInicial > 0 ? Math.min(d.cuota, d.saldoInicial) : 0), 0);
}

/** @param {{ahora:string}} ctx */
export function crearSemilla(ctx) {
  const ds = deudas();
  const asignaciones = {};
  for (const [id, , , , , monto] of FILAS_CATEGORIAS) asignaciones[id] = monto === null ? pagoDeudasInicial(ds) : monto;
  return {
    schemaVersion: VERSION,
    app: APP,
    rev: 0,
    creadoEn: ctx.ahora,
    actualizadoEn: ctx.ahora,
    ajustes: {
      cicloInicial: CICLO_INICIAL,
      diaPago: [{ desdeCiclo: CICLO_INICIAL, dia: 1 }],
      ingreso: { nombre: 'Salario', montoMensual: 2000000, variable: true, cuentaId: 'cta-principal', categoriaId: 'cat-salario' },
      metaGrupos: { necesidades: 50, gustos: 30, ahorro: 20 },
      alertas: { avisoPct: 80, excesoPct: 100 },
    },
    cuentas: cuentas(),
    deudas: ds,
    categorias: categorias(),
    presupuestos: {
      [CICLO_INICIAL]: { ingresoPlaneado: 2000000, asignaciones, origen: 'semilla', creadoEn: ctx.ahora },
    },
    recurrentes: recurrentes(),
    metas: metas(),
    movimientos: [],
  };
}
