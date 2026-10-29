/*
 * dinero.js — pesos enteros (PURO). Contrato: docs/UTILIDADES.md §3.1.
 * Nunca se acumulan flotantes: todo monto guardado es Number.isSafeInteger. El redondeo es explícito (mitades lejos de cero).
 * Los textos con '$' usan espacio duro (U+00A0) entre el símbolo y la cifra, como produce Intl; las pruebas lo normalizan.
 */
import { formatearNumero, redondearA } from './numeros.js';

const NBSP = String.fromCharCode(0xa0); // U+00A0 (espacio duro)

function exigirPesos(n, nombre = 'monto') {
  if (!esPesos(n)) throw new TypeError(`${nombre} debe ser un entero en pesos (recibido: ${String(n)}).`);
}

export function esPesos(n) {
  return Number.isSafeInteger(n);
}

/** Mitades lejos de cero: 2,5 → 3; −2,5 → −3; 1234,5 → 1235; 1234,2 → 1234. Nunca devuelve −0. */
export function redondearPesos(x) {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new TypeError('redondearPesos requiere un número finito.');
  const r = Math.sign(x) * Math.round(Math.abs(x));
  return r === 0 ? 0 : r;
}

// --- Formato ---------------------------------------------------------------------------------------------------

let formateador = null; // { intl: Intl.NumberFormat | null }

/** Formato manual: '$ 1.250.000' / '-$ 15.000'. Se usa si el motor no produce exactamente ese formato (riesgo A5). */
export function formatearPesosManual(n) {
  exigirPesos(n);
  const digitos = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n < 0 ? '-' : ''}$${NBSP}${digitos}`;
}

/**
 * Crea (una sola vez) el formateador de Intl y comprueba que da el formato del contrato para 1000 y −1000. Si no
 * (p. ej. el motor no agrupa 4 dígitos en español, o usa otro símbolo/signo), devuelve { intl: null } y se formatea a mano.
 * `crearIntl` es inyectable para probar el respaldo.
 */
export function crearFormateadorPesos(crearIntl = defectoIntl) {
  try {
    const intl = crearIntl();
    const normal = (s) => s.replace(/\s/g, ' ');
    if (normal(intl.format(1000)) === '$ 1.000' && normal(intl.format(-1000)) === '-$ 1.000') return { intl };
  } catch {
    /* sin Intl o sin datos es-CO: se formatea a mano */
  }
  return { intl: null };
}

function defectoIntl() {
  const base = { style: 'currency', currency: 'COP', maximumFractionDigits: 0 };
  try {
    return new Intl.NumberFormat('es-CO', { ...base, useGrouping: 'always' });
  } catch {
    return new Intl.NumberFormat('es-CO', base);
  }
}

/** '$ 1.250.000' · 0 → '$ 0' · −15.000 → '-$ 15.000'. No entero → TypeError. */
export function formatearPesos(n) {
  exigirPesos(n);
  if (formateador === null) formateador = crearFormateadorPesos();
  const valor = n === 0 ? 0 : n; // evita '-$ 0' con −0
  return formateador.intl ? formateador.intl.format(valor) : formatearPesosManual(valor);
}

/** Ejes de gráficos: 2.500.000 → '$ 2,5 M'; 430.000 → '$ 430 mil'; 950 → '$ 950'. */
export function formatearPesosCorto(n) {
  exigirPesos(n);
  const signo = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const con = (texto) => `${signo}$${NBSP}${texto}`;
  if (abs >= 1_000_000) return con(`${formatearNumero(abs / 1_000_000, { maxDecimales: 1 })}${NBSP}M`);
  if (abs >= 1000) {
    const miles = redondearA(abs / 1000, 1);
    if (miles >= 1000) return con(`1${NBSP}M`);
    return con(`${formatearNumero(miles, { maxDecimales: 1 })}${NBSP}mil`);
  }
  return con(String(abs));
}

/**
 * '$ 1.250.000' | '1250000' → 1250000; '' | '12,50' | 'abc' → null; '12,00' → 12. Punto = miles, coma = decimales (solo
 * ceros). Negativos solo con permitirNegativo.
 */
export function parsearPesos(texto, { permitirNegativo = false } = {}) {
  if (typeof texto !== 'string') return null;
  // R0-16: se quitan '$' y espacios del principio/final y alrededor del signo; un espacio INTERNO solo se acepta como
  // separador de miles bien formado ('1 250 000'); '1 2' o '12 500 3' son ambiguos → null.
  let s = texto.replace(/^[\s$]*([-−]?)[\s$]*/, '$1').replace(/[\s$]+$/, '');
  if (/\s/.test(s)) {
    if (!/^[-−]?\d{1,3}(\s\d{3})+(,0+)?$/.test(s)) return null;
    s = s.replace(/\s/g, '');
  }
  let negativo = false;
  if (s.startsWith('-') || s.startsWith('−')) {
    if (!permitirNegativo) return null;
    negativo = true;
    s = s.slice(1);
  }
  const coma = s.indexOf(',');
  let enteros = s;
  if (coma !== -1) {
    enteros = s.slice(0, coma);
    if (!/^0+$/.test(s.slice(coma + 1))) return null; // decimales distintos de cero (o coma sin dígitos)
  }
  if (!/^(\d+|\d{1,3}(\.\d{3})+)$/.test(enteros)) return null;
  const n = Number(enteros.replace(/\./g, ''));
  if (!Number.isSafeInteger(n)) return null;
  return negativo && n !== 0 ? -n : n;
}

/**
 * R2F-06: lectura de un monto ESCRITO O PEGADO en un campo (es-CO: punto = miles, coma = decimales), sin adivinar.
 * Aditiva: `parsearPesos` (estricta, devuelve número o null) no cambia. Esta función dice POR QUÉ no se pudo leer.
 *
 * Devuelve { estado, digitos, valor, negativo, coma, decimales }:
 *  - estado 'vacio'      → no hay dígitos (texto vacío, solo símbolos, letras o un "-" suelto; `negativo` sí se informa).
 *  - estado 'ok'         → entero leído. `digitos` es la cadena de dígitos de la parte entera (sin separadores; puede traer ceros a
 *                          la izquierda), `valor` es Number(digitos) (null si no es un entero seguro). Una coma con solo ceros
 *                          detrás ('1.234.567,00') se descarta; `coma` dice si había coma y `decimales` conserva esos ceros.
 *  - estado 'centavos'   → hay decimales distintos de cero ('1.234.567,50', '1,5'): los pesos son enteros, no se redondea.
 *  - estado 'cientifica' → notación científica ('1e10', '2E+5'): se rechaza (se leería como dígitos sueltos).
 *  - estado 'formato'    → más de una coma ('1,234,567'), puntos después de la coma, o con `estricto` puntos que no agrupan
 *                          de a tres ('1234567.50', '1.5'): ambiguo, se rechaza en vez de multiplicar el valor por 100.
 * `permitirNegativo`: un "-" inicial (también − y –) marca `negativo`; sin él se ignora.
 * `estricto` (para texto PEGADO): los puntos deben ser miles bien formados ('1.234.567'). Sin él (al teclear o al editar un
 * campo ya formateado) los puntos se ignoran, para tolerar '2.74.110' tras borrar un dígito del medio.
 * Los símbolos y letras sueltas ('$', 'COP', espacios, NBSP) se ignoran. No usa Intl ni flotantes.
 */
export function analizarPesos(texto, { permitirNegativo = false, estricto = false } = {}) {
  const vacio = { estado: 'vacio', digitos: '', valor: null, negativo: false, coma: false, decimales: '' };
  if (typeof texto !== 'string') return vacio;
  let s = texto.replace(/[\s$]/g, ''); // \s incluye el espacio duro (U+00A0)
  let negativo = false;
  if (/^[-−–]/.test(s)) {
    negativo = permitirNegativo;
    s = s.replace(/^[-−–]+/, '');
  }
  if (/\d[eE][+-]?\d/.test(s)) return { ...vacio, estado: 'cientifica', negativo };
  s = s.replace(/[^0-9.,]/g, '');
  const comas = s.split(',').length - 1;
  if (comas > 1) return { ...vacio, estado: 'formato', negativo };
  let entera = s;
  let decimales = '';
  const coma = comas === 1;
  if (coma) {
    [entera, decimales] = s.split(',');
    if (decimales.includes('.')) return { ...vacio, estado: 'formato', negativo, coma };
  }
  if (estricto) {
    const sinFinal = entera.replace(/\.$/, ''); // "2.742." mientras se teclea
    if (sinFinal !== '' && !/^(\d+|\d{1,3}(\.\d{3})+)$/.test(sinFinal)) return { ...vacio, estado: 'formato', negativo, coma };
    entera = sinFinal;
  }
  const digitos = entera.replace(/\./g, '');
  if (/[1-9]/.test(decimales)) return { ...vacio, estado: 'centavos', digitos, negativo, coma, decimales };
  if (digitos === '') return { ...vacio, negativo, coma, decimales: '' };
  const n = Number(digitos);
  return { estado: 'ok', digitos, valor: Number.isSafeInteger(n) ? n : null, negativo, coma, decimales };
}

// --- Aritmética entera -----------------------------------------------------------------------------------------

/** Σ con verificación de que cada sumando y el total sean pesos enteros seguros. */
export function sumarPesos(lista) {
  if (!Array.isArray(lista)) throw new TypeError('sumarPesos requiere un arreglo.');
  let total = 0;
  for (const x of lista) {
    exigirPesos(x, 'sumando');
    total += x;
    if (!esPesos(total)) throw new RangeError('La suma excede el rango de enteros seguros.');
  }
  return total;
}

/** redondearPesos(monto × tasa). `tasa` es una fracción (0,02 = 2 %). */
export function multiplicarPorTasa(monto, tasa) {
  exigirPesos(monto);
  if (typeof tasa !== 'number' || !Number.isFinite(tasa)) throw new TypeError('tasa debe ser un número finito.');
  return redondearPesos(monto * tasa);
}

/** Techo de a / b con enteros (a ≥ 0, b > 0), exacto con el residuo: sin dividir en coma flotante. */
export function dividirHaciaArriba(a, b) {
  exigirPesos(a, 'a');
  exigirPesos(b, 'b');
  if (a < 0 || b <= 0) throw new RangeError('dividirHaciaArriba requiere a ≥ 0 y b > 0.');
  const resto = a % b;
  return (a - resto) / b + (resto > 0 ? 1 : 0);
}

/**
 * Reparte `total` en partes proporcionales a `pesos` (enteros ≥ 0) por mayor residuo; Σ resultado === total.
 * Empates: gana el índice menor. repartir(100, [1, 1, 1]) → [34, 33, 33]. Usa BigInt para no perder exactitud.
 */
export function repartir(total, pesos) {
  exigirPesos(total, 'total');
  if (!Array.isArray(pesos) || !pesos.every((p) => esPesos(p) && p >= 0)) {
    throw new TypeError('pesos debe ser un arreglo de enteros no negativos.');
  }
  if (total < 0) return repartir(-total, pesos).map((x) => (x === 0 ? 0 : -x));
  const suma = pesos.reduce((acc, p) => acc + BigInt(p), 0n);
  if (suma === 0n) {
    if (total === 0) return pesos.map(() => 0);
    throw new RangeError('No se puede repartir entre pesos que suman cero.');
  }
  const t = BigInt(total);
  const partes = pesos.map((p, indice) => {
    const numerador = t * BigInt(p);
    return { indice, base: numerador / suma, residuo: numerador % suma };
  });
  let faltan = Number(t - partes.reduce((acc, p) => acc + p.base, 0n));
  const porResiduo = [...partes].sort((x, y) => (x.residuo === y.residuo ? x.indice - y.indice : x.residuo > y.residuo ? -1 : 1));
  for (let i = 0; i < faltan; i += 1) porResiduo[i].base += 1n;
  return partes.map((p) => Number(p.base));
}

// --- Teclado numérico propio -----------------------------------------------------------------------------------

/** 32 + '0' → 320; 32 + '000' → 32000. Si superaría maxDigitos (o los enteros seguros) devuelve el mismo monto. */
export function agregarDigitos(monto, digitos, { maxDigitos = 12 } = {}) {
  exigirPesos(monto);
  if (monto < 0) throw new RangeError('El teclado numérico no admite montos negativos.');
  if (typeof digitos !== 'string' || !/^\d{1,3}$/.test(digitos)) throw new TypeError("digitos debe ser '0'..'9' o '000'.");
  const nuevo = Number(monto === 0 ? digitos : `${monto}${digitos}`);
  if (!esPesos(nuevo) || String(nuevo).length > maxDigitos) return monto;
  return nuevo;
}

/** 3200 → 320; 5 → 0. */
export function borrarDigito(monto) {
  exigirPesos(monto);
  if (monto < 0) throw new RangeError('El teclado numérico no admite montos negativos.');
  return Math.floor(monto / 10);
}
