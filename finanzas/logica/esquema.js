/*
 * esquema.js — versión, validación, migraciones y resumen de los datos de Finanzas (PURO).
 * Contrato: docs/ESQUEMA-FINANZAS.md (§1–§16) y docs/ARQUITECTURA.md §5.2.
 *
 * validar(obj) → { ok:true, datos, avisos } | { ok:false, errores:[{ruta,mensaje}], avisos }
 *  - Devuelve una COPIA nueva con solo los campos conocidos (los desconocidos generan un aviso y se descartan: así un
 *    campo como "numeroTarjeta" nunca entra por importación).
 *  - Acumula todos los errores (no se detiene en el primero).
 * Dependencia tolerada: shared/ui/iconos.js (datos puros) solo para validar la clave de ícono (DISENO.md §5).
 */
import {
  crearContexto, esCicloId, esEntero, esFechaISO, esId, esInstanteISO, esNumero, esObjetoPlano, esPesosValido, esTexto, esUno,
} from '../../shared/lib/validacion.js';
import { esClaveIcono } from '../../shared/ui/iconos.js';
import { tasaValida } from './tasas.js';
import { formatearPesos } from '../../shared/lib/dinero.js';

export const VERSION = 1;
export const APP = 'finanzas';
export const migraciones = {};

export const TIPOS_CUENTA = Object.freeze(['banco', 'ahorro', 'efectivo', 'credito']);
export const TIPOS_DEUDA = Object.freeze(['tarjeta', 'credito', 'otro']);
export const GRUPOS = Object.freeze(['necesidades', 'gustos', 'ahorro']);
export const VINCULOS = Object.freeze(['cuotas-deudas', 'abono-deudas', 'metas']);
export const ORIGENES_PRESUPUESTO = Object.freeze(['semilla', 'copia', 'manual']);
export const TIPOS_ORIGEN = Object.freeze(['recurrente', 'cuota', 'salario']);
export const TIPOS_MOVIMIENTO = Object.freeze(['gasto', 'ingreso', 'transferencia', 'pagoDeuda', 'aporteMeta', 'retiroMeta', 'ajusteCuenta', 'ajusteDeuda']);
export const MAX_ELEMENTOS = 200_000;
/**
 * Tope por monto (R1F-19): 10^10 pesos (10.000 millones). Con hasta MAX_ELEMENTOS movimientos, la suma de montos (más intereses)
 * no puede pasar de 4·10^15 < 2^53 ≈ 9,007·10^15: las sumas de la app son siempre enteros exactos. Además, `validar` rechaza una
 * copia cuya suma total de montos pase de MAX_SUMA_PESOS (un archivo hostil o basura).
 */
export const MAX_PESOS = 10_000_000_000;
export const MAX_SUMA_PESOS = 1_000_000_000_000_000;
export const MENSAJE_TOPE_PESOS = `El valor no puede superar ${formatearPesos(MAX_PESOS)}.`;
/** Mensaje de un monto inválido: si es un entero válido pero sobre el tope, dice cuál es el máximo; si no, el mensaje base. */
export function mensajePesos(v, base) {
  return Number.isSafeInteger(v) && Math.abs(v) > MAX_PESOS ? MENSAJE_TOPE_PESOS : base;
}

/** Ciclos razonables (R1F-17): una clave extrema como '9999-12' rompe la navegación y no es un dato real. */
export const CICLO_MIN = '2000-01';
export const CICLO_MAX = '2100-12';
export const MENSAJE_CICLO_RANGO = `El ciclo debe estar entre ${CICLO_MIN} y ${CICLO_MAX}.`;
export function esCicloRazonable(v) {
  return esCicloId(v) && v >= CICLO_MIN && v <= CICLO_MAX;
}

const CAMPOS_RAIZ = ['schemaVersion', 'app', 'rev', 'creadoEn', 'actualizadoEn', 'ajustes', 'cuentas', 'deudas', 'categorias', 'presupuestos', 'recurrentes', 'metas', 'movimientos'];
const CAMPOS_BASE_MOV = ['id', 'tipo', 'fecha', 'monto', 'nota', 'origen', 'creadoEn', 'actualizadoEn'];
const CAMPOS_POR_TIPO = {
  gasto: ['cuentaId', 'categoriaId'],
  ingreso: ['cuentaId', 'categoriaId'],
  transferencia: ['cuentaId', 'cuentaDestinoId'],
  pagoDeuda: ['cuentaId', 'deudaId', 'categoriaId', 'interes'],
  aporteMeta: ['metaId', 'cuentaId', 'cuentaDestinoId', 'categoriaId'],
  retiroMeta: ['metaId', 'cuentaId', 'cuentaDestinoId', 'categoriaId'],
  ajusteCuenta: ['cuentaId'],
  ajusteDeuda: ['deudaId'],
};
const TODOS_CAMPOS_ESPECIFICOS = new Set(Object.values(CAMPOS_POR_TIPO).flat());

// --- Ayudas de lectura ------------------------------------------------------------------------------------------

function soloDefinidos(obj) {
  const copia = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) copia[k] = v;
  return copia;
}

/** Copia solo los campos conocidos; los demás → aviso. */
function tomar(obj, campos, ctx, ruta) {
  const copia = {};
  if (!esObjetoPlano(obj)) {
    ctx.error(ruta, 'Se esperaba un objeto.');
    return copia;
  }
  const permitidos = new Set(campos);
  for (const [clave, valor] of Object.entries(obj)) {
    if (valor === undefined) continue;
    if (permitidos.has(clave)) copia[clave] = valor;
    else ctx.aviso(ruta ? `${ruta}.${clave}` : clave, 'Campo desconocido descartado.');
  }
  return copia;
}

/**
 * H-08 / R2F-13 / R3F-01 / R3F-02: la app nunca guarda números de tarjeta ni de cuenta bancaria. En un texto libre (nota, nombre,
 * entidad) se detectan:
 *
 * NORMALIZACIÓN (R3F-02): antes de buscar se pasa el texto a una forma comparable SIN cambiar su largo (así las posiciones sirven para
 * enmascarar el original): ancho completo → ASCII (dígitos, letras y signos), dígitos árabes → ASCII, espacios raros (NBSP, ideográfico,
 * de ancho cero) → espacio, rayas largas → "-", y las fechas (2026-11-02, 25/10/2026) se anulan para que no se unan a un número vecino.
 * Un "número" es una cadena de grupos de dígitos separados por 1 a 3 caracteres de [espacio . - / _] (4111  1111, 4111 - 1111,
 * 4111/1111, 4111_1111, dígitos de a uno, 4-6-4, 8-8…); un punto pegado a una palabra ("No.4111…", "cta.123…") no cuenta como parte del número.
 * Dentro de esa cadena se prueban todas las ventanas de grupos contiguos (la mejor evidencia primero) y no se unen montos con miles
 * ("1.234.567.890", un punto entre un grupo de ≤ 3 dígitos y uno de 3).
 *
 * TARJETAS (13 a 19 dígitos). Evidencia, de mayor a menor: (1) pasa la verificación de Luhn Y empieza como una marca conocida (Visa 4,
 * Mastercard 51–55 / 2221–2720, Amex 34/37, Diners, Discover) con la longitud que le toca → se marca con cualquier agrupamiento, aunque
 * diga "ref" o "factura" (es la ÚNICA que la carga de datos ya guardados enmascara sola: "alta confianza"); (2) diseño de tarjeta (seguido,
 * 4-4-4-x o 4-6-5 con un solo espacio, guion o punto) → una palabra de tarjeta o cuenta cerca (tarjeta, TC, visa, cuenta, cta…) lo marca;
 * si no, una referencia o monto cerca (ref, factura, PSE, CUS, pedido, orden, guía, recibo, radicado, "$", total, saldo…; letras
 * pegadas al número como "FE2026…"; potencias de diez) lo deja pasar y en cualquier otro caso se marca (privacidad primero); (3) otro
 * agrupamiento (doble espacio, " - ", "/", "_", 4-8-4, 8-8, dígitos de a uno) → solo con palabra de tarjeta o cuenta cerca.
 *
 * CUENTAS BANCARIAS (10 a 12 dígitos, juntos o agrupados, p. ej. 123-456789-01, 0570 0000 1234): SOLO si cerca hay una palabra de cuenta
 * (cuenta, cta, ahorros, corriente, nequi, daviplata, iban, obligación, transfiya) o de tarjeta. R3F-01: "cuenta", "cuentas" y "cta" solas
 * NO bastan si entre el número anterior (o el inicio) y este hay una palabra de referencia o de servicio (cuenta contrato, cuenta de cobro, cuenta de
 * servicios, factura, referencia, PSE, radicado, pedido, NIT, cédula/CC, Enel, Codensa, Vanti, agua, gas, celular…): no son cuentas
 * bancarias. "ahorros", "corriente", "nequi"… y las palabras de tarjeta siguen marcando. Un celular colombiano (10 dígitos que
 * empiezan por 3) NO se marca salvo junto a nequi, daviplata o transfiya (que son el número del celular).
 *
 * NO se marcan: montos con puntos de miles, fechas, cédulas y NIT (hasta 11 dígitos sin contexto de cuenta), teléfonos, números cortos
 * ("12 de 24 cuotas") ni facturas o referencias con su palabra delante.
 * LIMITACIONES (documentadas, no se pueden resolver sin adivinar): "cerca" son las 4 palabras anteriores o las 2 siguientes (la
 * anulación por palabra de servicio mira solo las 3 palabras entre el número anterior —o el inicio del texto— y este); una cuenta de 10 a 12 dígitos escrita sin ninguna palabra de contexto
 * no se detecta; un número de factura de 13 o más dígitos escrito SIN palabra delante sí se marca; una referencia que además cumple
 * Luhn y empieza como Visa/Mastercard se marca aunque diga "ref"; separadores con coma ("4111,1111,…"), dígitos escritos con palabras
 * o letras intercaladas ("4111 abc 1111…") y un IBAN con letras (solo se ve por sus dígitos junto a "iban") no se detectan. Es una
 * ayuda, no una garantía: la nota sigue siendo texto libre del usuario.
 */
export const TEXTO_NUMERO_OCULTO = '[número omitido]';
export const MENSAJE_NUMERO_LARGO = 'El texto parece incluir un número de tarjeta o de cuenta (13 a 19 dígitos). La app no guarda esos números: quítalo y vuelve a guardar.';
export const MENSAJE_NUMERO_CUENTA = 'El texto parece incluir un número de cuenta bancaria (10 a 12 dígitos junto a una palabra como cuenta, ahorros o nequi). La app no guarda esos números: quítalo y vuelve a guardar.';

const sinTildes = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const PALABRAS_TARJETA = new Set(['tc', 'tdc', 'visa', 'mastercard', 'master', 'amex', 'diners', 'credito', 'debito', 'card']);
const PALABRAS_CUENTA = new Set(['cuenta', 'cuentas', 'cta', 'ctas', 'ahorro', 'ahorros', 'corriente', 'nequi', 'daviplata', 'iban', 'obligacion', 'transfiya']);
const PALABRAS_CUENTA_DEBILES = new Set(['cuenta', 'cuentas', 'cta', 'ctas']); // R3F-01: las únicas que una palabra de servicio anula
const PALABRAS_BILLETERA = new Set(['nequi', 'daviplata', 'transfiya']);
const PALABRAS_REFERENCIA = new Set(['ref', 'refs', 'referencia', 'factura', 'facturas', 'fact', 'fra', 'pse', 'cus', 'pedido', 'orden', 'guia', 'recibo', 'comprobante', 'transaccion', 'aprobacion', 'radicado', 'cufe', 'contrato', 'poliza', 'matricula', 'placa', 'serial', 'codigo', 'cod', 'cedula', 'cc', 'nit', 'tel', 'telefono', 'cel', 'celular', 'whatsapp', 'wsp', 'fijo', 'ticket', 'boleta']);
/** R3F-01: palabras que dicen que "cuenta" NO es una cuenta bancaria sino un dato de un servicio o un documento (se suman a las de referencia). */
const PALABRAS_NO_CUENTA = new Set([...PALABRAS_REFERENCIA, 'cobro', 'cobros', 'servicio', 'servicios', 'cliente', 'suscriptor', 'nic', 'predial', 'administracion']);
/** R3F-01: empresas y servicios públicos o de telefonía: junto a "cuenta" o "cta" (sin palabra de ahorros, corriente…) el número es de un contrato de servicio, no de un banco. */
const PALABRAS_SERVICIO = new Set(['enel', 'codensa', 'vanti', 'acueducto', 'eaab', 'etb', 'claro', 'movistar', 'tigo', 'wom', 'directv', 'agua', 'gas', 'luz', 'energia', 'internet', 'hogar']);
const PALABRAS_MONTO = new Set(['monto', 'valor', 'total', 'saldo', 'precio', 'cuota', 'costo', 'pague', 'abono', 'vale', 'suma', 'pesos', 'cop']);
const esDeTarjeta = (w) => PALABRAS_TARJETA.has(w) || w.startsWith('tarjeta');
const esDeCuenta = (w) => PALABRAS_CUENTA.has(w) || w.startsWith('cuenta');
const esCuentaDebil = (w) => PALABRAS_CUENTA_DEBILES.has(w) || w.startsWith('cuenta');

/** Verificación de Luhn (módulo 10) de una cadena de dígitos. */
export function cumpleLuhn(digitos) {
  if (!/^\d{2,}$/.test(digitos)) return false;
  let suma = 0;
  let doble = false;
  for (let k = digitos.length - 1; k >= 0; k -= 1) {
    let d = Number(digitos[k]);
    if (doble) { d *= 2; if (d > 9) d -= 9; }
    suma += d;
    doble = !doble;
  }
  return suma % 10 === 0;
}

/** ¿Empieza como una marca de tarjeta conocida y tiene la longitud que le corresponde? */
function marcaConocida(d) {
  const n = d.length;
  if (d[0] === '4') return n === 13 || n === 16 || n === 19; // Visa
  if (n === 16 && (/^5[1-5]/.test(d) || /^(222[1-9]|22[3-9]\d|2[3-6]\d\d|27[01]\d|2720)/.test(d))) return true; // Mastercard
  if (n === 15 && /^3[47]/.test(d)) return true; // American Express
  if (n === 14 && /^(36|38|30[0-5])/.test(d)) return true; // Diners
  if (n === 16 && /^(6011|65|64[4-9])/.test(d)) return true; // Discover
  return false;
}

/**
 * R3F-02: forma comparable del texto, del MISMO largo (cada carácter se cambia por uno): ancho completo → ASCII, dígitos árabes →
 * ASCII, espacios raros y de ancho cero → " ", rayas largas y el signo menos → "-". Las posiciones de la forma normalizada valen para el original.
 */
function normalizar(t) {
  let s = '';
  for (const ch of t) {
    const c = ch.codePointAt(0);
    if (c >= 0xFF01 && c <= 0xFF5E) s += String.fromCharCode(c - 0xFEE0);
    else if (c >= 0x0660 && c <= 0x0669) s += String.fromCharCode(48 + c - 0x0660);
    else if (c >= 0x06F0 && c <= 0x06F9) s += String.fromCharCode(48 + c - 0x06F0);
    else if (c === 0x09 || c === 0x3000 || c === 0xA0 || c === 0x202F || c === 0x2007 || c === 0xAD || (c >= 0x2002 && c <= 0x200F) || c === 0x2060 || c === 0xFEFF) s += ' ';
    else if ((c >= 0x2010 && c <= 0x2015) || c === 0x2212) s += '-';
    else s += ch;
  }
  return s;
}

const FECHAS = /(?<!\d)(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})(?!\d)/g;
const CADENA = /\d+(?:[ .\-/_]{1,3}\d+)*/g;
const MAX_GRUPOS = 60;

/** ¿4-4-4-(1 a 7) o 4-6-5 dígitos con UN solo espacio, guion o punto entre grupos? (el diseño típico de una tarjeta) */
function esDisenoTarjeta(grupos, seps) {
  if (!seps.every((s) => s.length === 1 && ' .-'.includes(s))) return false;
  const l = grupos.map((g) => g.d.length);
  return (l.length === 4 && l[0] === 4 && l[1] === 4 && l[2] === 4 && l[3] >= 1 && l[3] <= 7) || (l.length === 3 && l[0] === 4 && l[1] === 6 && l[2] === 5);
}

/** Palabras vecinas de un número: las anteriores (hasta 4) y las 2 siguientes, sin tildes. */
function palabrasAntes(antes) {
  const recorte = sinTildes(antes.slice(-60)).split(/[.;!?\n]\s/).pop();
  return recorte.match(/[a-zñ]+/g) ?? [];
}
function palabrasDespues(despues) {
  return (sinTildes(despues.slice(0, 28)).match(/^[\s:#.\-/_,()]*([a-zñ]+)(?:[\s:#.\-/_,()]+([a-zñ]+))?/) ?? []).slice(1).filter(Boolean);
}

/**
 * Evalúa una ventana de grupos contiguos. → null | { tipo: 'tarjeta' | 'cuenta', alta: boolean, nivel: 0 | 1 | 2 | 3 } (nivel = fuerza de la evidencia: 0 la mayor).
 * `previas`/`posteriores`: palabras vecinas; `antes`: texto anterior (para "$" y letras pegadas); `cerca`: palabras entre el número anterior y esta cadena de dígitos.
 */
function evaluarVentana(grupos, seps, previas, posteriores, antes, cerca) {
  const d = grupos.map((g) => g.d).join('');
  const n = d.length;
  const contiguo = grupos.length === 1;
  const vecinas = [...previas.slice(-4), ...posteriores];
  const conTarjeta = vecinas.some(esDeTarjeta);
  const fuerte = vecinas.some((w) => esDeCuenta(w) && !esCuentaDebil(w));
  const anula = cerca.slice(-3).some((w) => PALABRAS_NO_CUENTA.has(w) || PALABRAS_SERVICIO.has(w)); // R3F-01: solo las palabras que siguen al número anterior ("cobro 5768 cta 4671…": el "cobro" es del otro número)
  const conCuenta = fuerte || (vecinas.some(esCuentaDebil) && !anula);
  if (n >= 13) {
    if (n <= 19 && cumpleLuhn(d) && marcaConocida(d)) return { tipo: 'tarjeta', alta: true, nivel: 0 };
    const montoCerca = /\$\s*$/.test(antes) || previas.slice(-3).some((w) => PALABRAS_MONTO.has(w));
    if (contiguo || esDisenoTarjeta(grupos, seps)) {
      if (conTarjeta || conCuenta) return { tipo: 'tarjeta', alta: false, nivel: 1 };
      const referenciaCerca = previas.slice(-3).some((w) => PALABRAS_REFERENCIA.has(w)) || /[A-Za-zÁÉÍÓÚáéíóúÑñ][-_#./]?$/.test(antes);
      if (montoCerca || referenciaCerca || /^[1-9]0{9,}$/.test(d)) return null;
      return { tipo: 'tarjeta', alta: false, nivel: 1 };
    }
    if (n <= 19 && !montoCerca && (conTarjeta || conCuenta)) return { tipo: 'tarjeta', alta: false, nivel: 2 };
    return null;
  }
  if (n >= 10) {
    if (n === 10 && d[0] === '3' && !vecinas.some((w) => PALABRAS_BILLETERA.has(w))) return null; // celular colombiano
    if (grupos.length === 2 && grupos[0].d.length === 9 && grupos[1].d.length === 1 && seps[0] === '-' && !fuerte) return null; // NIT con dígito de verificación (900123456-7)
    return conCuenta || conTarjeta ? { tipo: 'cuenta', alta: false, nivel: 3 } : null;
  }
  return null;
}

/**
 * Posiciones de los números sensibles de un texto: [{ inicio, fin, tipo: 'tarjeta' | 'cuenta', alta }]. `alta` = tarjeta de 13 a 19
 * dígitos con Luhn válido y marca conocida (la única que se enmascara sola al cargar datos ya guardados).
 */
export function detectarNumerosSensibles(t) {
  if (typeof t !== 'string' || t.length < 10) return [];
  let cuantos = 0;
  for (let k = 0; k < t.length; k += 1) { const c = t.charCodeAt(k); if ((c >= 48 && c <= 57) || (c >= 0xFF10 && c <= 0xFF19) || (c >= 0x660 && c <= 0x669) || (c >= 0x6F0 && c <= 0x6F9)) cuantos += 1; }
  if (cuantos < 10) return [];
  const n = normalizar(t);
  const base = n.replace(FECHAS, (m) => 'x'.repeat(m.length));
  const encontrados = [];
  for (const cadena of base.matchAll(CADENA)) {
    const grupos = [...cadena[0].matchAll(/\d+/g)].slice(0, MAX_GRUPOS).map((m) => ({ d: m[0], ini: cadena.index + m.index, fin: cadena.index + m.index + m[0].length }));
    const seps = grupos.slice(1).map((g, k) => base.slice(grupos[k].fin, g.ini)); // seps[k] = lo que hay entre grupos[k] y grupos[k+1]
    const antesDe = new Map();
    const despuesDe = new Map();
    const cerca = palabrasAntes(n.slice(0, cadena.index).replace(/^[\s\S]*\d/, ''));
    for (let i = 0; i < grupos.length; i += 1) {
      if (i > 0 && seps[i - 1] === '.') continue; // "1.4111…": un punto pegado a un dígito es decimal o de miles, no el inicio de un número
      const pegadoALetra = grupos[i].d.length <= 2 && /[A-Za-zÁÉÍÓÚáéíóúÑñ_]/.test(n[grupos[i].ini - 1] ?? ''); // "D1 3470593060": el "1" es parte de una sigla, no de un número vecino
      let total = 0;
      for (let j = i; j < grupos.length; j += 1) {
        total += grupos[j].d.length;
        if (j > i && (pegadoALetra || total > 19 || (seps[j - 1] === '.' && grupos[j - 1].d.length <= 3 && grupos[j].d.length === 3))) break; // monto con miles, o demasiado largo
        if (total < 10) continue;
        if (seps[j] === '.' && grupos[j].d.length <= 3 && grupos[j + 1] && grupos[j + 1].d.length === 3) continue; // no cortar un monto con miles ("708.312")
        const ventana = grupos.slice(i, j + 1);
        if (!antesDe.has(i)) { const a = n.slice(0, grupos[i].ini); antesDe.set(i, { a, p: palabrasAntes(a) }); }
        if (!despuesDe.has(j)) despuesDe.set(j, palabrasDespues(n.slice(grupos[j].fin)));
        const { a, p } = antesDe.get(i);
        const r = evaluarVentana(ventana, seps.slice(i, j), p, despuesDe.get(j), a, cerca);
        if (r) encontrados.push({ inicio: grupos[i].ini, fin: grupos[j].fin, tipo: r.tipo, alta: r.alta, nivel: r.nivel, digitos: total });
      }
    }
  }
  // La mejor evidencia primero; a igual evidencia, el más largo; sin solaparse.
  encontrados.sort((x, y) => x.nivel - y.nivel || y.digitos - x.digitos || x.inicio - y.inicio);
  const elegidos = [];
  for (const e of encontrados) if (!elegidos.some((o) => e.inicio < o.fin && o.inicio < e.fin)) elegidos.push(e);
  return elegidos.sort((x, y) => x.inicio - y.inicio).map(({ inicio, fin, tipo, alta }) => ({ inicio, fin, tipo, alta }));
}

/** ¿El texto contiene algo que parece un número de tarjeta o de cuenta bancaria? */
export function tieneNumeroLargo(t) {
  return detectarNumerosSensibles(t).length > 0;
}

/** Mensaje para el usuario según lo que se detectó (tarjeta: 13 a 19 dígitos; cuenta: 10 a 12 junto a una palabra de contexto). */
export function mensajeNumeroSensible(t) {
  const hallados = detectarNumerosSensibles(t);
  return hallados.length && hallados.every((x) => x.tipo === 'cuenta') ? MENSAJE_NUMERO_CUENTA : MENSAJE_NUMERO_LARGO;
}

/** Reemplaza cada número sensible por "[número omitido]". `soloAlta`: solo las tarjetas de alta confianza (Luhn + marca); lo demás queda tal cual. */
export function ocultarNumerosLargos(t, { soloAlta = false } = {}) {
  if (typeof t !== 'string') return t;
  let salida = t;
  for (const { inicio, fin, alta } of detectarNumerosSensibles(t).reverse()) {
    if (soloAlta && !alta) continue;
    salida = salida.slice(0, inicio) + TEXTO_NUMERO_OCULTO + salida.slice(fin);
  }
  return salida;
}

/** Huella corta (FNV-1a de 32 bits, en hexadecimal) de un texto: identifica "este mismo texto" sin guardarlo (avisos ya vistos al cargar, R3F-01c). */
export function huellaTexto(t) {
  let h = 0x811c9dc5;
  const s = String(t);
  for (let k = 0; k < s.length; k += 1) { h ^= s.charCodeAt(k); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function texto(ctx, ruta, v, { min = 0, max, defecto = '' } = {}) {
  if (v === undefined && min === 0) return defecto;
  if (!esTexto(v, { min, max })) {
    ctx.error(ruta, min > 0 ? `Debe ser un texto de ${min} a ${max} caracteres.` : `Debe ser un texto de hasta ${max} caracteres.`);
    return defecto;
  }
  const limpio = v.trim();
  const hallados = detectarNumerosSensibles(limpio);
  if (hallados.length === 0) return limpio;
  if (ctx.modoCarga) {
    // R3F-01b: datos YA guardados. Solo se enmascara lo de alta confianza (tarjeta con Luhn y marca); lo demás (posibles cuentas,
    // variantes dudosas) se deja como está y se avisa: la app no reescribe en silencio lo que una versión anterior aceptó.
    const altas = hallados.filter((x) => x.alta);
    const salida = altas.length ? ocultarNumerosLargos(limpio, { soloAlta: true }) : limpio;
    if (altas.length) ctx.avisos.push({ ruta, mensaje: 'Se ocultó un número de tarjeta (la app no guarda números de tarjeta ni de cuenta).', codigo: 'numero-largo', tipo: 'tarjeta' });
    const dudosos = hallados.filter((x) => !x.alta);
    if (dudosos.length) ctx.avisos.push({ ruta, mensaje: 'Parece un número de tarjeta o de cuenta: se dejó como estaba.', codigo: 'numero-dudoso', tipo: dudosos.every((x) => x.tipo === 'cuenta') ? 'cuenta' : 'tarjeta', huella: huellaTexto(salida) });
    return salida;
  }
  // No se rechaza el conjunto (una copia o un respaldo no deben fallar por una nota): se enmascara y se avisa. Las acciones que
  // reciben texto del usuario sí lo rechazan con mensaje (acciones.js: rechazarNumerosLargos).
  const soloCuentas = hallados.every((x) => x.tipo === 'cuenta');
  ctx.avisos.push({ ruta, mensaje: soloCuentas ? 'Se ocultó un número de cuenta bancaria (la app no guarda números de tarjeta ni de cuenta).' : 'Se ocultó un número de 13 a 19 dígitos (la app no guarda números de tarjeta ni de cuenta).', codigo: 'numero-largo', tipo: soloCuentas ? 'cuenta' : 'tarjeta' });
  return ocultarNumerosLargos(limpio);
}

function booleano(ctx, ruta, v, defecto) {
  if (v === undefined) return defecto;
  if (typeof v !== 'boolean') {
    ctx.error(ruta, 'Debe ser verdadero o falso.');
    return defecto;
  }
  return v;
}

function icono(ctx, ruta, v) {
  if (v === undefined) return 'otro';
  if (esClaveIcono(v)) return v;
  ctx.aviso(ruta, 'Ícono desconocido; se usó el genérico.');
  return 'otro';
}

function orden(ctx, ruta, v, defecto) {
  if (v === undefined) return defecto;
  if (!esEntero(v, { min: 0, max: 100000 })) {
    ctx.error(ruta, 'El orden debe ser un entero.');
    return defecto;
  }
  return v;
}

function id(ctx, ruta, v, vistos) {
  if (!esId(v)) {
    ctx.error(ruta, 'Identificador inválido.');
    return null;
  }
  if (vistos.has(v)) ctx.error(ruta, `Identificador repetido: ${v}.`);
  vistos.add(v);
  return v;
}

function lista(ctx, ruta, v) {
  if (!Array.isArray(v)) {
    ctx.error(ruta, 'Se esperaba una lista.');
    return [];
  }
  if (v.length > MAX_ELEMENTOS) {
    ctx.error(ruta, 'Demasiados elementos.');
    return [];
  }
  return v;
}

// --- Entidades --------------------------------------------------------------------------------------------------

function validarTasa(ctx, ruta, v, nombreDeuda) {
  if (v === undefined || v === null) return null;
  const t = tomar(v, ['tipo', 'porcentaje'], ctx, ruta);
  if (!tasaValida(t) || !esNumero(t.porcentaje, { decimales: 6 })) {
    ctx.error(ruta, `La tasa de la deuda '${nombreDeuda}' debe tener tipo (efectiva anual o mensual vencida) y un porcentaje mayor que 0. El máximo es 100 % si es E.A. y 10 % si es M.V.`); // N3-07: sin llaves ni símbolos técnicos
    return null;
  }
  return { tipo: t.tipo, porcentaje: t.porcentaje };
}

function validarCuenta(raw, i, ctx, vistos) {
  const ruta = `cuentas[${i}]`;
  const c = tomar(raw, ['id', 'nombre', 'tipo', 'saldoInicial', 'fechaSaldoInicial', 'deudaId', 'icono', 'orden', 'archivada'], ctx, ruta);
  const out = { id: id(ctx, `${ruta}.id`, c.id, vistos) };
  out.nombre = texto(ctx, `${ruta}.nombre`, c.nombre, { min: 1, max: 40 });
  if (!esUno(c.tipo, TIPOS_CUENTA)) ctx.error(`${ruta}.tipo`, 'Tipo de cuenta inválido.');
  out.tipo = c.tipo;
  if (c.tipo === 'credito') {
    if (c.saldoInicial !== undefined && c.saldoInicial !== null) ctx.error(`${ruta}.saldoInicial`, 'Una cuenta de crédito no tiene saldo propio: vive en su deuda.');
    if (c.fechaSaldoInicial !== undefined && c.fechaSaldoInicial !== null) ctx.error(`${ruta}.fechaSaldoInicial`, 'Una cuenta de crédito no tiene fecha de saldo inicial.');
    if (!esId(c.deudaId)) ctx.error(`${ruta}.deudaId`, 'Una cuenta de crédito debe estar vinculada a una deuda.');
    out.saldoInicial = null;
    out.fechaSaldoInicial = null;
    out.deudaId = c.deudaId ?? null;
  } else {
    if (!esPesosValido(c.saldoInicial, { permitirNegativo: true, max: MAX_PESOS })) ctx.error(`${ruta}.saldoInicial`, mensajePesos(c.saldoInicial, 'El saldo inicial debe ser un entero en pesos.'));
    if (!esFechaISO(c.fechaSaldoInicial)) ctx.error(`${ruta}.fechaSaldoInicial`, 'La fecha del saldo inicial no es válida.');
    if (c.deudaId !== undefined && c.deudaId !== null) ctx.error(`${ruta}.deudaId`, 'Solo las cuentas de crédito se vinculan a una deuda.');
    out.saldoInicial = c.saldoInicial;
    out.fechaSaldoInicial = c.fechaSaldoInicial;
    out.deudaId = null;
  }
  out.icono = icono(ctx, `${ruta}.icono`, c.icono);
  out.orden = orden(ctx, `${ruta}.orden`, c.orden, i + 1);
  out.archivada = booleano(ctx, `${ruta}.archivada`, c.archivada, false);
  return out;
}

function validarDeuda(raw, i, ctx, vistos) {
  const ruta = `deudas[${i}]`;
  const d = tomar(raw, ['id', 'nombre', 'entidad', 'tipo', 'saldoInicial', 'fechaSaldoInicial', 'cuota', 'diaPago', 'tasa', 'cuentaId', 'notas', 'archivada'], ctx, ruta);
  const out = { id: id(ctx, `${ruta}.id`, d.id, vistos) };
  out.nombre = texto(ctx, `${ruta}.nombre`, d.nombre, { min: 1, max: 40 });
  out.entidad = texto(ctx, `${ruta}.entidad`, d.entidad, { max: 40 });
  if (!esUno(d.tipo, TIPOS_DEUDA)) ctx.error(`${ruta}.tipo`, 'Tipo de deuda inválido.');
  out.tipo = d.tipo;
  if (!esPesosValido(d.saldoInicial, { min: 0, max: MAX_PESOS })) ctx.error(`${ruta}.saldoInicial`, mensajePesos(d.saldoInicial, 'El saldo inicial debe ser un entero en pesos (0 o más).'));
  out.saldoInicial = d.saldoInicial;
  if (!esFechaISO(d.fechaSaldoInicial)) ctx.error(`${ruta}.fechaSaldoInicial`, 'La fecha del saldo inicial no es válida.');
  out.fechaSaldoInicial = d.fechaSaldoInicial;
  if (!esPesosValido(d.cuota, { min: 1, max: MAX_PESOS })) ctx.error(`${ruta}.cuota`, mensajePesos(d.cuota, 'La cuota debe ser un entero en pesos mayor que cero.'));
  out.cuota = d.cuota;
  if (!esEntero(d.diaPago, { min: 1, max: 31 })) ctx.error(`${ruta}.diaPago`, 'El día de pago debe estar entre 1 y 31.');
  out.diaPago = d.diaPago;
  out.tasa = validarTasa(ctx, `${ruta}.tasa`, d.tasa, out.nombre);
  if (d.cuentaId !== undefined && d.cuentaId !== null && !esId(d.cuentaId)) ctx.error(`${ruta}.cuentaId`, 'Cuenta vinculada inválida.');
  out.cuentaId = d.cuentaId ?? null;
  out.notas = texto(ctx, `${ruta}.notas`, d.notas, { max: 200 });
  out.archivada = booleano(ctx, `${ruta}.archivada`, d.archivada, false);
  return out;
}

function validarCategoria(raw, i, ctx, vistos) {
  const ruta = `categorias[${i}]`;
  const c = tomar(raw, ['id', 'nombre', 'tipo', 'grupo', 'vinculo', 'icono', 'orden', 'archivada'], ctx, ruta);
  const out = { id: id(ctx, `${ruta}.id`, c.id, vistos) };
  out.nombre = texto(ctx, `${ruta}.nombre`, c.nombre, { min: 1, max: 40 });
  if (!esUno(c.tipo, ['gasto', 'ingreso'])) ctx.error(`${ruta}.tipo`, 'El tipo de categoría debe ser gasto o ingreso.');
  out.tipo = c.tipo;
  if (c.tipo === 'gasto') {
    if (!esUno(c.grupo, GRUPOS)) ctx.error(`${ruta}.grupo`, 'El grupo debe ser necesidades, gustos o ahorro.');
    out.grupo = c.grupo;
    if (c.vinculo !== undefined && c.vinculo !== null && !esUno(c.vinculo, VINCULOS)) ctx.error(`${ruta}.vinculo`, 'Vínculo de categoría inválido.');
    out.vinculo = c.vinculo ?? null;
  } else {
    if (c.grupo !== undefined && c.grupo !== null) ctx.error(`${ruta}.grupo`, 'Las categorías de ingreso no tienen grupo.');
    if (c.vinculo !== undefined && c.vinculo !== null) ctx.error(`${ruta}.vinculo`, 'Las categorías de ingreso no tienen vínculo.');
    out.grupo = null;
    out.vinculo = null;
  }
  out.icono = icono(ctx, `${ruta}.icono`, c.icono);
  out.orden = orden(ctx, `${ruta}.orden`, c.orden, i + 1);
  out.archivada = booleano(ctx, `${ruta}.archivada`, c.archivada, false);
  return out;
}

function validarRecurrente(raw, i, ctx, vistos) {
  const ruta = `recurrentes[${i}]`;
  const r = tomar(raw, ['id', 'nombre', 'tipo', 'monto', 'rango', 'categoriaId', 'cuentaId', 'frecuencia', 'activo', 'desde'], ctx, ruta);
  const out = { id: id(ctx, `${ruta}.id`, r.id, vistos) };
  out.nombre = texto(ctx, `${ruta}.nombre`, r.nombre, { min: 1, max: 40 });
  if (!esUno(r.tipo, ['gasto', 'ingreso'])) ctx.error(`${ruta}.tipo`, 'El tipo debe ser gasto o ingreso.');
  out.tipo = r.tipo;
  if (!esPesosValido(r.monto, { min: 1, max: MAX_PESOS })) ctx.error(`${ruta}.monto`, mensajePesos(r.monto, 'El monto debe ser un entero en pesos mayor que cero.'));
  out.monto = r.monto;
  if (r.rango === undefined || r.rango === null) out.rango = null;
  else {
    const g = tomar(r.rango, ['min', 'max'], ctx, `${ruta}.rango`);
    if (!esPesosValido(g.min, { min: 1, max: MAX_PESOS }) || !esPesosValido(g.max, { min: 1, max: MAX_PESOS }) || g.min > g.max || r.monto < g.min || r.monto > g.max) {
      ctx.error(`${ruta}.rango`, [g.min, g.max, r.monto].some((x) => mensajePesos(x, null) !== null) ? MENSAJE_TOPE_PESOS : 'El rango debe cumplir mínimo ≤ monto ≤ máximo.');
    }
    out.rango = { min: g.min, max: g.max };
  }
  if (!esId(r.categoriaId)) ctx.error(`${ruta}.categoriaId`, 'Categoría inválida.');
  out.categoriaId = r.categoriaId;
  if (!esId(r.cuentaId)) ctx.error(`${ruta}.cuentaId`, 'Cuenta inválida.');
  out.cuentaId = r.cuentaId;
  const f = tomar(r.frecuencia, ['tipo', 'dia', 'diaSemana'], ctx, `${ruta}.frecuencia`);
  if (f.tipo === 'mensual') {
    if (!esEntero(f.dia, { min: 1, max: 31 })) ctx.error(`${ruta}.frecuencia.dia`, 'El día debe estar entre 1 y 31.');
    out.frecuencia = { tipo: 'mensual', dia: f.dia };
  } else if (f.tipo === 'semanal') {
    if (!esEntero(f.diaSemana, { min: 1, max: 7 })) ctx.error(`${ruta}.frecuencia.diaSemana`, 'El día de la semana debe estar entre 1 (lunes) y 7 (domingo).');
    out.frecuencia = { tipo: 'semanal', diaSemana: f.diaSemana };
  } else {
    ctx.error(`${ruta}.frecuencia.tipo`, 'La frecuencia debe ser mensual o semanal.');
    out.frecuencia = { tipo: 'mensual', dia: 1 };
  }
  out.activo = booleano(ctx, `${ruta}.activo`, r.activo, true);
  if (!esFechaISO(r.desde)) ctx.error(`${ruta}.desde`, 'La fecha de inicio no es válida.');
  out.desde = r.desde;
  return out;
}

function validarMeta(raw, i, ctx, vistos) {
  const ruta = `metas[${i}]`;
  const m = tomar(raw, ['id', 'nombre', 'objetivo', 'fechaLimite', 'cuentaId', 'icono', 'creadaEn', 'archivada'], ctx, ruta);
  const out = { id: id(ctx, `${ruta}.id`, m.id, vistos) };
  out.nombre = texto(ctx, `${ruta}.nombre`, m.nombre, { min: 1, max: 40 });
  if (!esPesosValido(m.objetivo, { min: 1, max: MAX_PESOS })) ctx.error(`${ruta}.objetivo`, mensajePesos(m.objetivo, 'El objetivo debe ser un entero en pesos mayor que cero.'));
  out.objetivo = m.objetivo;
  if (!esFechaISO(m.fechaLimite)) ctx.error(`${ruta}.fechaLimite`, 'La fecha límite no es válida.');
  out.fechaLimite = m.fechaLimite;
  if (m.cuentaId !== undefined && m.cuentaId !== null && !esId(m.cuentaId)) ctx.error(`${ruta}.cuentaId`, 'Cuenta inválida.');
  out.cuentaId = m.cuentaId ?? null;
  out.icono = icono(ctx, `${ruta}.icono`, m.icono ?? 'escudo');
  if (!esFechaISO(m.creadaEn)) ctx.error(`${ruta}.creadaEn`, 'La fecha de creación no es válida.');
  out.creadaEn = m.creadaEn;
  out.archivada = booleano(ctx, `${ruta}.archivada`, m.archivada, false);
  return out;
}

// --- Movimientos (también se usa desde las acciones) --------------------------------------------------------------

/** Mapas de consulta por id sobre colecciones ya validadas. */
export function crearReferencias(datos) {
  return {
    cuentas: new Map(datos.cuentas.map((c) => [c.id, c])),
    deudas: new Map(datos.deudas.map((d) => [d.id, d])),
    categorias: new Map(datos.categorias.map((c) => [c.id, c])),
    metas: new Map(datos.metas.map((m) => [m.id, m])),
  };
}

export function claveOrigen(origen) {
  return origen ? `${origen.tipo}|${origen.id}|${origen.ocurrencia}` : null;
}

function validarOrigen(ctx, ruta, v) {
  if (v === undefined || v === null) return null;
  const o = tomar(v, ['tipo', 'id', 'ocurrencia'], ctx, ruta);
  if (!esUno(o.tipo, TIPOS_ORIGEN)) ctx.error(`${ruta}.tipo`, 'Origen de pago programado inválido.');
  if (typeof o.id !== 'string' || o.id.length === 0 || o.id.length > 60) ctx.error(`${ruta}.id`, 'Origen de pago programado inválido.');
  if (!esFechaISO(o.ocurrencia)) ctx.error(`${ruta}.ocurrencia`, 'La fecha programada no es válida.');
  return { tipo: o.tipo, id: o.id, ocurrencia: o.ocurrencia };
}

/**
 * Valida UN movimiento contra sus referencias y devuelve su copia saneada (con campos en orden canónico).
 * Reglas: ESQUEMA-FINANZAS §9. Un campo que pertenece a otro tipo es ERROR; un campo desconocido es solo aviso.
 */
export function validarMovimiento(raw, refs, ctx, ruta = 'movimiento') {
  if (!esObjetoPlano(raw)) {
    ctx.error(ruta, 'Se esperaba un objeto.');
    return null;
  }
  const entrada = soloDefinidos(raw);
  const tipo = entrada.tipo;
  if (!esUno(tipo, TIPOS_MOVIMIENTO)) {
    ctx.error(`${ruta}.tipo`, 'Tipo de movimiento inválido.');
    return null;
  }
  const permitidos = new Set([...CAMPOS_BASE_MOV, ...CAMPOS_POR_TIPO[tipo]]);
  for (const clave of Object.keys(entrada)) {
    if (permitidos.has(clave)) continue;
    if (TODOS_CAMPOS_ESPECIFICOS.has(clave)) ctx.error(`${ruta}.${clave}`, `El campo "${clave}" no corresponde a un movimiento de tipo ${tipo}.`);
    else ctx.aviso(`${ruta}.${clave}`, 'Campo desconocido descartado.');
  }

  const out = { id: entrada.id, tipo };
  if (!esId(entrada.id)) ctx.error(`${ruta}.id`, 'Identificador inválido.');
  if (!esFechaISO(entrada.fecha)) ctx.error(`${ruta}.fecha`, 'La fecha no es válida.');
  out.fecha = entrada.fecha;
  const conSigno = tipo === 'ajusteCuenta' || tipo === 'ajusteDeuda';
  if (conSigno) {
    if (!esPesosValido(entrada.monto, { permitirNegativo: true, max: MAX_PESOS }) || entrada.monto === 0) ctx.error(`${ruta}.monto`, mensajePesos(entrada.monto, 'El ajuste debe ser un entero en pesos distinto de cero.'));
  } else if (!esPesosValido(entrada.monto, { min: 1, max: MAX_PESOS })) {
    ctx.error(`${ruta}.monto`, mensajePesos(entrada.monto, 'El monto debe ser un número entero de pesos mayor que cero.'));
  }
  out.monto = entrada.monto;

  const cuenta = (campo, { credito = false, nulo = false } = {}) => {
    const v = entrada[campo];
    if (nulo && (v === undefined || v === null)) return null;
    const c = typeof v === 'string' ? refs.cuentas.get(v) : undefined;
    if (!c) {
      ctx.error(`${ruta}.${campo}`, 'La cuenta no existe.');
      return null;
    }
    if (c.tipo === 'credito' && !credito) {
      ctx.error(`${ruta}.${campo}`, 'Esa operación no se puede hacer con una tarjeta de crédito.');
      return null;
    }
    return c;
  };
  const categoria = (tipoCat, vinculos) => {
    const c = typeof entrada.categoriaId === 'string' ? refs.categorias.get(entrada.categoriaId) : undefined;
    if (!c) {
      ctx.error(`${ruta}.categoriaId`, 'La categoría no existe.');
      return null;
    }
    if (c.tipo !== tipoCat) ctx.error(`${ruta}.categoriaId`, `La categoría debe ser de ${tipoCat}.`);
    else if (vinculos === null ? c.vinculo !== null : !vinculos.includes(c.vinculo)) {
      ctx.error(`${ruta}.categoriaId`, vinculos === null ? 'Esa categoría es automática y no admite gastos manuales.' : 'La categoría no corresponde a este tipo de movimiento.');
    }
    return c;
  };
  const deuda = (campo) => {
    const d = typeof entrada[campo] === 'string' ? refs.deudas.get(entrada[campo]) : undefined;
    if (!d) ctx.error(`${ruta}.${campo}`, 'La deuda no existe.');
    return d ?? null;
  };
  const fechaMin = (fechaMinima, nombre) => {
    if (fechaMinima && esFechaISO(entrada.fecha) && entrada.fecha < fechaMinima) {
      ctx.error(`${ruta}.fecha`, `La fecha no puede ser anterior al saldo inicial de ${nombre} (${fechaMinima}).`);
    }
  };

  switch (tipo) {
    case 'gasto': {
      const c = cuenta('cuentaId', { credito: true });
      categoria('gasto', null);
      if (c) {
        if (c.tipo === 'credito') {
          const d = refs.deudas.get(c.deudaId);
          if (d) fechaMin(d.fechaSaldoInicial, d.nombre);
        } else fechaMin(c.fechaSaldoInicial, c.nombre);
      }
      out.cuentaId = entrada.cuentaId;
      out.categoriaId = entrada.categoriaId;
      break;
    }
    case 'ingreso': {
      const c = cuenta('cuentaId');
      categoria('ingreso', null);
      if (c) fechaMin(c.fechaSaldoInicial, c.nombre);
      out.cuentaId = entrada.cuentaId;
      out.categoriaId = entrada.categoriaId;
      break;
    }
    case 'transferencia': {
      const a = cuenta('cuentaId');
      const b = cuenta('cuentaDestinoId');
      if (entrada.cuentaId !== undefined && entrada.cuentaId === entrada.cuentaDestinoId) ctx.error(`${ruta}.cuentaDestinoId`, 'La cuenta de origen y la de destino deben ser distintas.');
      if (a) fechaMin(a.fechaSaldoInicial, a.nombre);
      if (b) fechaMin(b.fechaSaldoInicial, b.nombre);
      out.cuentaId = entrada.cuentaId;
      out.cuentaDestinoId = entrada.cuentaDestinoId;
      break;
    }
    case 'pagoDeuda': {
      const c = cuenta('cuentaId');
      const d = deuda('deudaId');
      categoria('gasto', ['cuotas-deudas', 'abono-deudas']);
      const interes = entrada.interes === undefined ? 0 : entrada.interes;
      if (!esEntero(interes, { min: 0 }) || (esPesosValido(entrada.monto, { min: 1 }) && interes > entrada.monto)) ctx.error(`${ruta}.interes`, 'El interés debe ser un entero entre 0 y el monto del pago.');
      if (c) fechaMin(c.fechaSaldoInicial, c.nombre);
      if (d) fechaMin(d.fechaSaldoInicial, d.nombre);
      out.cuentaId = entrada.cuentaId;
      out.deudaId = entrada.deudaId;
      out.categoriaId = entrada.categoriaId;
      out.interes = interes;
      break;
    }
    case 'aporteMeta':
    case 'retiroMeta': {
      const m = typeof entrada.metaId === 'string' ? refs.metas.get(entrada.metaId) : undefined;
      if (!m) ctx.error(`${ruta}.metaId`, 'La meta no existe.');
      const a = cuenta('cuentaId');
      const b = cuenta('cuentaDestinoId', { nulo: true });
      if (entrada.cuentaDestinoId && entrada.cuentaDestinoId === entrada.cuentaId) ctx.error(`${ruta}.cuentaDestinoId`, 'La cuenta de origen y la de destino deben ser distintas.');
      categoria('gasto', ['metas']);
      if (a) fechaMin(a.fechaSaldoInicial, a.nombre);
      if (b) fechaMin(b.fechaSaldoInicial, b.nombre);
      out.metaId = entrada.metaId;
      out.cuentaId = entrada.cuentaId;
      out.cuentaDestinoId = entrada.cuentaDestinoId ?? null;
      out.categoriaId = entrada.categoriaId;
      break;
    }
    case 'ajusteCuenta': {
      const c = cuenta('cuentaId');
      if (c) fechaMin(c.fechaSaldoInicial, c.nombre);
      out.cuentaId = entrada.cuentaId;
      break;
    }
    case 'ajusteDeuda': {
      const d = deuda('deudaId');
      if (d) fechaMin(d.fechaSaldoInicial, d.nombre);
      out.deudaId = entrada.deudaId;
      break;
    }
    default:
  }

  out.nota = texto(ctx, `${ruta}.nota`, entrada.nota, { min: conSigno ? 1 : 0, max: 200 });
  out.origen = validarOrigen(ctx, `${ruta}.origen`, entrada.origen);
  if (out.origen && (tipo === 'transferencia' || conSigno || tipo === 'aporteMeta' || tipo === 'retiroMeta')) ctx.error(`${ruta}.origen`, 'Este tipo de movimiento no puede venir de un pago programado.');
  if (!esInstanteISO(entrada.creadoEn)) ctx.error(`${ruta}.creadoEn`, 'La fecha de creación no es válida.');
  out.creadoEn = entrada.creadoEn;
  if (entrada.actualizadoEn !== undefined && entrada.actualizadoEn !== null && !esInstanteISO(entrada.actualizadoEn)) ctx.error(`${ruta}.actualizadoEn`, 'La fecha de actualización no es válida.');
  out.actualizadoEn = entrada.actualizadoEn ?? null;
  return out;
}

// --- Raíz -------------------------------------------------------------------------------------------------------

function validarAjustes(raw, refs, ctx) {
  const ruta = 'ajustes';
  const a = tomar(raw, ['cicloInicial', 'diaPago', 'ingreso', 'metaGrupos', 'alertas'], ctx, ruta);
  if (!esCicloId(a.cicloInicial)) ctx.error(`${ruta}.cicloInicial`, 'El ciclo inicial no es válido (AAAA-MM).');
  else if (!esCicloRazonable(a.cicloInicial)) ctx.error(`${ruta}.cicloInicial`, MENSAJE_CICLO_RANGO);
  const out = { cicloInicial: a.cicloInicial };

  const historial = [];
  if (!Array.isArray(a.diaPago) || a.diaPago.length === 0) ctx.error(`${ruta}.diaPago`, 'Debe haber al menos un día de pago.');
  else {
    a.diaPago.forEach((e, i) => {
      const p = tomar(e, ['desdeCiclo', 'dia'], ctx, `${ruta}.diaPago[${i}]`);
      if (!esCicloId(p.desdeCiclo)) ctx.error(`${ruta}.diaPago[${i}].desdeCiclo`, 'Ciclo inválido.');
      else if (!esCicloRazonable(p.desdeCiclo)) ctx.error(`${ruta}.diaPago[${i}].desdeCiclo`, MENSAJE_CICLO_RANGO);
      if (!esEntero(p.dia, { min: 1, max: 31 })) ctx.error(`${ruta}.diaPago[${i}].dia`, 'El día de pago debe estar entre 1 y 31.');
      historial.push({ desdeCiclo: p.desdeCiclo, dia: p.dia });
    });
    if (historial[0] && historial[0].desdeCiclo !== a.cicloInicial) ctx.error(`${ruta}.diaPago[0].desdeCiclo`, 'La primera entrada debe empezar en el ciclo inicial.');
    for (let i = 1; i < historial.length; i += 1) {
      if (!(historial[i].desdeCiclo > historial[i - 1].desdeCiclo)) ctx.error(`${ruta}.diaPago[${i}].desdeCiclo`, 'Los ciclos del historial deben ser únicos y crecientes.');
    }
  }
  out.diaPago = historial;

  const ing = tomar(a.ingreso, ['nombre', 'montoMensual', 'variable', 'cuentaId', 'categoriaId'], ctx, `${ruta}.ingreso`);
  const nombre = texto(ctx, `${ruta}.ingreso.nombre`, ing.nombre, { min: 1, max: 40 });
  if (!esPesosValido(ing.montoMensual, { min: 0, max: MAX_PESOS })) ctx.error(`${ruta}.ingreso.montoMensual`, mensajePesos(ing.montoMensual, 'El ingreso mensual debe ser un entero en pesos (0 o más).'));
  const cta = typeof ing.cuentaId === 'string' ? refs.cuentas.get(ing.cuentaId) : undefined;
  if (!cta || cta.tipo === 'credito') ctx.error(`${ruta}.ingreso.cuentaId`, 'La cuenta del ingreso debe existir y no ser de crédito.');
  const cat = typeof ing.categoriaId === 'string' ? refs.categorias.get(ing.categoriaId) : undefined;
  if (!cat || cat.tipo !== 'ingreso') ctx.error(`${ruta}.ingreso.categoriaId`, 'La categoría del ingreso debe existir y ser de ingreso.');
  out.ingreso = { nombre, montoMensual: ing.montoMensual, variable: booleano(ctx, `${ruta}.ingreso.variable`, ing.variable, false), cuentaId: ing.cuentaId, categoriaId: ing.categoriaId };

  const g = tomar(a.metaGrupos, ['necesidades', 'gustos', 'ahorro'], ctx, `${ruta}.metaGrupos`);
  for (const k of GRUPOS) if (!esEntero(g[k], { min: 0, max: 100 })) ctx.error(`${ruta}.metaGrupos.${k}`, 'Debe ser un entero entre 0 y 100.');
  if (GRUPOS.every((k) => esEntero(g[k])) && g.necesidades + g.gustos + g.ahorro !== 100) ctx.error(`${ruta}.metaGrupos`, 'La meta de reparto debe sumar 100 %.');
  out.metaGrupos = { necesidades: g.necesidades, gustos: g.gustos, ahorro: g.ahorro };

  const al = tomar(a.alertas, ['avisoPct', 'excesoPct'], ctx, `${ruta}.alertas`);
  if (!esEntero(al.avisoPct, { min: 1 }) || !esEntero(al.excesoPct, { max: 200 }) || !(al.avisoPct < al.excesoPct)) {
    ctx.error(`${ruta}.alertas`, 'Las alertas deben cumplir 0 < aviso < exceso ≤ 200.');
  }
  out.alertas = { avisoPct: al.avisoPct, excesoPct: al.excesoPct };
  return out;
}

function validarPresupuestos(raw, cicloInicial, refs, ctx) {
  const salida = {};
  if (!esObjetoPlano(raw)) {
    ctx.error('presupuestos', 'Se esperaba un objeto.');
    return salida;
  }
  for (const [ciclo, bruto] of Object.entries(raw)) {
    const ruta = `presupuestos["${ciclo}"]`;
    if (!esCicloId(ciclo)) {
      ctx.error(ruta, 'La clave debe ser un ciclo AAAA-MM.');
      continue;
    }
    if (!esCicloRazonable(ciclo)) {
      ctx.error(ruta, MENSAJE_CICLO_RANGO);
      continue;
    }
    if (esCicloId(cicloInicial) && ciclo < cicloInicial) ctx.error(ruta, 'No puede haber presupuestos anteriores al ciclo inicial.');
    const p = tomar(bruto, ['ingresoPlaneado', 'asignaciones', 'origen', 'creadoEn', 'pagoDeudasFijo', 'pagoDeudasCongelado', 'sinSalario'], ctx, ruta);
    if (!esPesosValido(p.ingresoPlaneado, { min: 0, max: MAX_PESOS })) ctx.error(`${ruta}.ingresoPlaneado`, mensajePesos(p.ingresoPlaneado, 'El ingreso planeado debe ser un entero en pesos (0 o más).'));
    const asignaciones = {};
    if (!esObjetoPlano(p.asignaciones)) ctx.error(`${ruta}.asignaciones`, 'Se esperaba un objeto.');
    else {
      for (const [categoriaId, monto] of Object.entries(p.asignaciones)) {
        const c = refs.categorias.get(categoriaId);
        if (!c || c.tipo !== 'gasto') ctx.error(`${ruta}.asignaciones.${categoriaId}`, 'Hay una asignación para una categoría que no existe o no es de gasto.');
        if (!esPesosValido(monto, { min: 0, max: MAX_PESOS })) ctx.error(`${ruta}.asignaciones.${categoriaId}`, `La categoría '${c ? c.nombre : 'desconocida'}' tiene una asignación inválida: ${mensajePesos(monto, 'debe ser un entero en pesos (0 o más).').replace(/^./, (x) => x.toLowerCase())}`); // N3-07: nombre, no id interno
        asignaciones[categoriaId] = monto;
      }
    }
    if (!esUno(p.origen, ORIGENES_PRESUPUESTO)) ctx.error(`${ruta}.origen`, 'Origen de presupuesto inválido.');
    if (!esInstanteISO(p.creadoEn)) ctx.error(`${ruta}.creadoEn`, 'La fecha de creación no es válida.');
    if (p.pagoDeudasFijo !== undefined && typeof p.pagoDeudasFijo !== 'boolean') ctx.error(`${ruta}.pagoDeudasFijo`, 'Debe ser verdadero o falso.');
    for (const campo of ['pagoDeudasCongelado', 'sinSalario']) if (p[campo] !== undefined && typeof p[campo] !== 'boolean') ctx.error(`${ruta}.${campo}`, 'Debe ser verdadero o falso.');
    // Opcionales: pagoDeudasFijo (H-04) = "Pago de deudas" fijado a mano; si falta, la línea es calculada y sigue a las cuotas vigentes.
    // pagoDeudasCongelado (R2F-03) = el ciclo ya cerrado guardó el "Pago de deudas" que mostraba (no se vuelve a recalcular).
    // sinSalario (R2F-04) = ciclo de transición tras cambiar el día de pago: en él no se espera salario.
    salida[ciclo] = { ingresoPlaneado: p.ingresoPlaneado, asignaciones, origen: p.origen, creadoEn: p.creadoEn, ...(p.pagoDeudasFijo === true ? { pagoDeudasFijo: true } : {}), ...(p.pagoDeudasCongelado === true ? { pagoDeudasCongelado: true } : {}), ...(p.sinSalario === true ? { sinSalario: true } : {}) };
  }
  return salida;
}

/**
 * Σ |monto| de todo lo que guarda la app (R1F-19): saldos, cuotas, objetivos, presupuestos y movimientos (monto + interés).
 * Solo suma enteros seguros (lo demás ya tiene su propio error); nunca lanza.
 */
function sumaDeMontos({ ajustes, cuentas, deudas, recurrentes, metas, presupuestos, movimientos }) {
  let total = 0;
  const sumar = (v) => { if (Number.isSafeInteger(v)) total += Math.abs(v); };
  sumar(ajustes.ingreso?.montoMensual);
  for (const c of cuentas) sumar(c?.saldoInicial);
  for (const d of deudas) { sumar(d?.saldoInicial); sumar(d?.cuota); }
  for (const r of recurrentes) sumar(r?.monto);
  for (const m of metas) sumar(m?.objetivo);
  for (const p of Object.values(presupuestos)) { sumar(p?.ingresoPlaneado); for (const v of Object.values(p?.asignaciones ?? {})) sumar(v); }
  for (const m of movimientos) { sumar(m?.monto); sumar(m?.interes); }
  return total;
}

/** Valida y sanea un objeto de datos completo. */
/**
 * `opciones.modo`: 'carga' = datos YA guardados (R3F-01b: solo se enmascara lo de alta confianza; lo dudoso se avisa con el código
 * 'numero-dudoso' y se deja intacto). Por omisión (importar, restaurar un archivo, semilla) se enmascara todo con el aviso 'numero-largo'.
 */
export function validar(obj, opciones = {}) {
  const ctx = crearContexto();
  if (opciones && opciones.modo === 'carga') ctx.modoCarga = true;
  const fallo = () => ({ ok: false, errores: ctx.errores, avisos: ctx.avisos });
  if (!esObjetoPlano(obj)) {
    ctx.error('(raíz)', 'Se esperaba un objeto.');
    return fallo();
  }
  const raiz = tomar(obj, CAMPOS_RAIZ, ctx, '');
  if (raiz.app !== APP) ctx.error('app', 'Los datos no son de Finanzas.');
  if (raiz.schemaVersion !== VERSION) ctx.error('schemaVersion', `La versión del esquema debe ser ${VERSION}.`);
  const rev = raiz.rev === undefined ? 0 : raiz.rev;
  if (!esEntero(rev, { min: 0 })) ctx.error('rev', 'La revisión debe ser un entero.');
  if (!esInstanteISO(raiz.creadoEn)) ctx.error('creadoEn', 'La fecha de creación no es válida.');
  if (!esInstanteISO(raiz.actualizadoEn)) ctx.error('actualizadoEn', 'La fecha de actualización no es válida.');

  const idsCuentas = new Set();
  const idsDeudas = new Set();
  const idsCategorias = new Set();
  const idsRecurrentes = new Set();
  const idsMetas = new Set();
  const cuentas = lista(ctx, 'cuentas', raiz.cuentas).map((x, i) => validarCuenta(x, i, ctx, idsCuentas));
  const deudas = lista(ctx, 'deudas', raiz.deudas).map((x, i) => validarDeuda(x, i, ctx, idsDeudas));
  const categorias = lista(ctx, 'categorias', raiz.categorias).map((x, i) => validarCategoria(x, i, ctx, idsCategorias));
  const recurrentes = lista(ctx, 'recurrentes', raiz.recurrentes).map((x, i) => validarRecurrente(x, i, ctx, idsRecurrentes));
  const metas = lista(ctx, 'metas', raiz.metas).map((x, i) => validarMeta(x, i, ctx, idsMetas));

  // Relaciones tarjeta <-> cuenta de crédito (1 a 1) y vínculos de categorías.
  const refs = { cuentas: new Map(cuentas.map((c) => [c.id, c])), deudas: new Map(deudas.map((d) => [d.id, d])), categorias: new Map(categorias.map((c) => [c.id, c])), metas: new Map(metas.map((m) => [m.id, m])) };
  cuentas.forEach((c, i) => {
    if (c.tipo !== 'credito') return;
    const d = refs.deudas.get(c.deudaId);
    if (!d) ctx.error(`cuentas[${i}].deudaId`, 'La deuda vinculada no existe.');
    else if (d.tipo !== 'tarjeta' || d.cuentaId !== c.id) ctx.error(`cuentas[${i}].deudaId`, 'La cuenta de crédito y su deuda deben estar vinculadas en ambos sentidos.');
  });
  deudas.forEach((d, i) => {
    if (d.tipo === 'tarjeta') {
      const c = refs.cuentas.get(d.cuentaId);
      if (!c || c.tipo !== 'credito' || c.deudaId !== d.id) ctx.error(`deudas[${i}].cuentaId`, 'Una tarjeta debe estar vinculada a una cuenta de crédito.');
    } else if (d.cuentaId !== null) ctx.error(`deudas[${i}].cuentaId`, 'Solo las tarjetas se vinculan a una cuenta.');
  });
  for (const v of VINCULOS) {
    const n = categorias.filter((c) => c.vinculo === v).length;
    if (n !== 1) ctx.error('categorias', `Debe haber exactamente una categoría con vínculo "${v}".`);
  }
  categorias.forEach((c, i) => {
    if (c.vinculo && c.archivada) ctx.error(`categorias[${i}].archivada`, 'Las categorías automáticas no se pueden archivar.');
  });
  recurrentes.forEach((r, i) => {
    const c = refs.categorias.get(r.categoriaId);
    if (!c || c.tipo !== r.tipo || c.vinculo !== null) ctx.error(`recurrentes[${i}].categoriaId`, 'La categoría no existe o no corresponde al tipo.');
    const cu = refs.cuentas.get(r.cuentaId);
    if (!cu || (r.tipo === 'ingreso' && cu.tipo === 'credito')) ctx.error(`recurrentes[${i}].cuentaId`, 'La cuenta no existe o no admite ingresos.');
  });
  metas.forEach((m, i) => {
    if (m.cuentaId !== null) {
      const c = refs.cuentas.get(m.cuentaId);
      if (!c || c.tipo === 'credito') ctx.error(`metas[${i}].cuentaId`, 'La cuenta de la meta debe existir y no ser de crédito.');
    }
  });

  const ajustes = validarAjustes(raiz.ajustes, refs, ctx);
  const presupuestos = validarPresupuestos(raiz.presupuestos, ajustes.cicloInicial, refs, ctx);

  const idsMov = new Set();
  const origenes = new Set();
  const movimientos = [];
  lista(ctx, 'movimientos', raiz.movimientos).forEach((x, i) => {
    const ruta = `movimientos[${i}]`;
    const m = validarMovimiento(x, refs, ctx, ruta);
    if (!m) return;
    if (m.id && idsMov.has(m.id)) ctx.error(`${ruta}.id`, `Identificador repetido: ${m.id}.`);
    idsMov.add(m.id);
    const clave = claveOrigen(m.origen);
    if (clave) {
      if (origenes.has(clave)) ctx.error(`${ruta}.origen`, 'Ese pago programado ya está registrado.');
      origenes.add(clave);
    }
    movimientos.push(m);
  });

  const suma = sumaDeMontos({ ajustes, cuentas, deudas, recurrentes, metas, presupuestos, movimientos });
  if (suma > MAX_SUMA_PESOS) ctx.error('(montos)', `La suma de todos los montos (${Number.isSafeInteger(suma) ? formatearPesos(suma) : 'una cifra fuera de rango'}) es demasiado grande para calcularla con exactitud: el máximo es ${formatearPesos(MAX_SUMA_PESOS)}.`);

  if (ctx.errores.length) return fallo();
  return {
    ok: true,
    datos: { schemaVersion: VERSION, app: APP, rev, creadoEn: raiz.creadoEn, actualizadoEn: raiz.actualizadoEn, ajustes, cuentas, deudas, categorias, presupuestos, recurrentes, metas, movimientos },
    avisos: ctx.avisos,
  };
}

/** Objeto plano para la hoja de confirmación de importación. */
export function resumir(datos) {
  const fechas = datos.movimientos.map((m) => m.fecha).sort();
  return {
    movimientos: datos.movimientos.length,
    desde: fechas[0] ?? null,
    hasta: fechas[fechas.length - 1] ?? null,
    cuentas: datos.cuentas.length,
    deudas: datos.deudas.length,
    categorias: datos.categorias.length,
    metas: datos.metas.length,
    ciclos: Object.keys(datos.presupuestos).length,
  };
}
