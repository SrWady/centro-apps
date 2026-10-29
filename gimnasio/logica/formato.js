/*
 * formato.js — textos es-CO de la rutina y de las series (PURO). Coma decimal, punto de miles.
 */
import { formatearNumero, formatearKg } from '../../shared/lib/numeros.js';

export const NOMBRES_DIA = Object.freeze(['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']);
export const CORTOS_DIA = Object.freeze(['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']);
export const LETRAS_DIA = Object.freeze(['', 'L', 'M', 'X', 'J', 'V', 'S', 'D']);

/** 1.323 kg (entero, con punto de miles). */
export function textoVolumen(kg) {
  return `${formatearNumero(Math.round(kg))} kg`;
}

export function textoKg(kg) {
  return formatearKg(kg);
}

/** 90 → '1:30'; 0 → 'sin descanso'. */
export function textoDescanso(seg) {
  if (!seg) return 'sin descanso';
  return `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;
}

/** { min:8, max:10 } → '8–10'; min = max → '12'. En segundos añade ' s'. */
export function textoObjetivo(e) {
  const rango = e.min === e.max ? `${e.min}` : `${e.min}–${e.max}`;
  return e.medida === 'segundos' ? `${rango} s` : rango;
}

export function textoRir(rir) {
  if (!rir) return '';
  return rir.min === rir.max ? `RIR ${rir.min}` : `RIR ${rir.min}–${rir.max}`;
}

/**
 * Ejercicios de pierna conocidos (lista EXPLÍCITA, R3G-08 / N3-06): se prueba primero. Nada de palabras sueltas que también aparecen en
 * ejercicios de brazo ("patada de tríceps", "remo a una mano con rodilla en el banco", "abducción de hombro", "prensa militar"):
 * solo pierna, búlgara, zancada/estocada/desplante, step-up/subida al cajón, sentadilla/prensa de pierna (no "prensa militar"),
 * peso muerto (rumano, a una pierna), hip thrust/puente de glúteo/patada de glúteo, curl femoral/isquios, extensión de cuádriceps,
 * elevación de talones/pantorrillas, abducción/aducción de cadera.
 */
const EJERCICIOS_DE_PIERNA = new RegExp([
  'pierna', 'b[uú]lgara', 'zancada', 'estocada', 'desplante', 'step[ -]?up', 'subida (?:al|a) caj[oó]n', 'sentadilla', 'prensa(?! militar)',
  'peso muerto', 'hip thrust', 'puente de gl[uú]teo', 'patada de gl[uú]teo', 'patada de burro', 'curl femoral', 'isquio', 'femoral',
  'extensi[oó]n de cu[aá]driceps', 'cu[aá]driceps', 'elevaci[oó]n de talones', 'talones', 'pantorrilla', 'gemelo', 's[oó]leo',
  '(?:abducci[oó]n|aducci[oó]n|abductor|aductor)(?:es)? (?:de )?(?:la )?cadera', 'abductores', 'aductores',
].join('|'), 'i');
/** Ejercicios de brazo, torso y hombro conocidos (lista explícita): se prueban después de los de pierna. */
const EJERCICIOS_DE_BRAZO = /brazo|una mano|b[ií]ceps|tr[ií]ceps|antebrazo|hombro|militar|pecho|remo|jal[oó]n|elevaci[oó]n lateral|curl/i;

/**
 * Rótulo de un ejercicio "por lado": "por pierna" si es de la lista explícita de ejercicios de pierna conocidos, "por brazo" si es de
 * brazo, torso u hombro conocidos, y el neutro "por lado" para el resto. Heurística por nombre, como unidadPeso (el esquema no guarda
 * qué lado es; a futuro, `lado` en el esquema v2). No cambia el cálculo del volumen.
 */
export function rotuloPorLado(e) {
  const nombre = e.nombre ?? '';
  if (EJERCICIOS_DE_PIERNA.test(nombre)) return 'por pierna';
  if (EJERCICIOS_DE_BRAZO.test(nombre)) return 'por brazo';
  return 'por lado';
}

/** "4 × 8–10 · descanso 2:00 · RIR 2" (con "por pierna" / "por brazo" / "por lado" cuando aplica). */
export function textoMetaEjercicio(e, { descanso = true } = {}) {
  const partes = [`${e.series ?? ''}${e.series ? ' × ' : ''}${textoObjetivo(e)}${e.porLado ? ` ${rotuloPorLado(e)}` : ''}`];
  if (descanso) partes.push(e.descansoSeg ? `descanso ${textoDescanso(e.descansoSeg)}` : 'sin descanso');
  const rir = textoRir(e.rir);
  if (rir) partes.push(rir);
  return partes.join(' · ');
}

/** Con mancuernas el peso se anota por mancuerna (V7). Heurística por nombre. */
export function unidadPeso(e) {
  return /mancuerna/i.test(e.nombre) ? 'kg por mancuerna' : 'kg';
}

/** Una serie: '35 kg × 12' | '45 s' | '10 kg × 45 s'. */
export function textoSerie(e, s) {
  const valor = e.medida === 'segundos' ? `${s.seg} s` : `${s.reps}`;
  if (e.medida === 'segundos') return s.kg > 0 ? `${formatearKg(s.kg)} × ${valor}` : valor;
  return `${formatearKg(s.kg)} × ${valor}`;
}

/**
 * Agrupa series consecutivas con el mismo peso: '35 kg × 12, 11 · 37,5 kg × 10'. En segundos: '45, 50 s'.
 * Solo cuenta las series hechas (ok).
 */
export function textoSeries(e, series) {
  const hechas = series.filter((s) => s.ok);
  if (!hechas.length) return '';
  if (e.medida === 'segundos' && hechas.every((s) => !s.kg)) return `${hechas.map((s) => s.seg).join(', ')} s`;
  const grupos = [];
  for (const s of hechas) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.kg === s.kg) ultimo.valores.push(e.medida === 'segundos' ? s.seg : s.reps);
    else grupos.push({ kg: s.kg, valores: [e.medida === 'segundos' ? s.seg : s.reps] });
  }
  return grupos
    .map((g) => `${g.kg > 0 || e.medida !== 'segundos' ? formatearKg(g.kg) + ' × ' : ''}${g.valores.join(', ')}${e.medida === 'segundos' ? ' s' : ''}`)
    .join(' · ');
}

export function textoCardio(plan) {
  if (!plan) return '';
  const partes = [plan.nombre, `${plan.minutos} min`];
  if (plan.velocidadKmH) partes.push(`${rango(plan.velocidadKmH)} km/h`);
  if (plan.inclinacionPct) partes.push(`inclinación ${rango(plan.inclinacionPct)} %`);
  if (plan.nota) partes.push(plan.nota);
  return partes.join(' · ');
}

function rango(r) {
  return r.min === r.max ? formatearNumero(r.min) : `${formatearNumero(r.min)}–${formatearNumero(r.max)}`;
}

/** '2026-11-09' → '9/11' (etiqueta de ejes). */
export function etiquetaSemanaCorta(lunes) {
  const [, m, d] = lunes.split('-');
  return `${Number(d)}/${Number(m)}`;
}
