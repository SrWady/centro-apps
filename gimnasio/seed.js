/*
 * seed.js — ÚNICA semilla de datos de Gimnasio (docs/ESQUEMA-GIMNASIO.md §4.4).
 * Ejercicios, series, repeticiones, superseries y cardio son los del requisito. RIR, descansos, consejos y textos
 * de ajuste por persona son la propuesta del arquitecto (V1, aceptada): todo es editable en la app.
 * Para cambiar la rutina inicial solo se toca este archivo. Cada llamada devuelve un objeto NUEVO (nadie comparte
 * ni muta una constante): "Restaurar rutina original" usa crearRutinaSemilla().
 */

const RIR2 = () => ({ min: 2, max: 2 });
const RIR12 = () => ({ min: 1, max: 2 });
const MAS_PESADO = () => ({ rir: { min: 1, max: 2 }, nota: 'Cargas más pesadas, RIR 1–2' });

function ejercicio(base) {
  return { medida: 'reps', porLado: false, superserie: null, ajustes: {}, ...base };
}

export function crearRutinaSemilla() {
  return {
    version: 1,
    dias: [
      {
        id: 'dia-lun',
        diaSemana: 1,
        nombre: 'Torso completo',
        calentamiento: 'Movilidad de hombros y escápulas',
        ejercicios: [
          ejercicio({ id: 'ej-press-inclinado-manc', nombre: 'Press inclinado con mancuernas', series: 4, min: 8, max: 10, rir: RIR2(), descansoSeg: 120,
            consejo: 'Banco a 30°, escápulas juntas y abajo; baja controlado hasta la línea del pecho.', ajustes: { p2: MAS_PESADO() } }),
          ejercicio({ id: 'ej-jalon-pecho', nombre: 'Jalón al pecho', series: 4, min: 10, max: 12, rir: RIR2(), descansoSeg: 90,
            consejo: 'Pecho alto, lleva la barra a la clavícula sin balancear el torso.' }),
          ejercicio({ id: 'ej-press-militar-manc', nombre: 'Press militar con mancuernas sentado', series: 3, min: 10, max: 12, rir: RIR2(), descansoSeg: 90,
            consejo: 'Espalda apoyada, abdomen firme; no arquees la zona lumbar al subir.' }),
          ejercicio({ id: 'ej-remo-barra-gironda', nombre: 'Remo con barra o Gironda', series: 3, min: 10, max: 12, rir: RIR2(), descansoSeg: 90,
            consejo: 'Tira con los codos hacia la cadera y aprieta las escápulas 1 s.' }),
          ejercicio({ id: 'ej-elevaciones-laterales', nombre: 'Elevaciones laterales', series: 3, min: 12, max: 15, rir: RIR12(), descansoSeg: 0, superserie: 'A',
            consejo: 'Codos ligeramente flexionados; sube hasta la altura del hombro, sin impulso.' }),
          ejercicio({ id: 'ej-ext-triceps-polea', nombre: 'Extensiones de tríceps en polea', series: 3, min: 12, max: 15, rir: RIR12(), descansoSeg: 75, superserie: 'A',
            consejo: 'Codos pegados al cuerpo; extiende completo sin mover los hombros.' }),
        ],
        cardio: { nombre: 'Caminadora', minutos: 20, velocidadKmH: { min: 4.5, max: 5.5 }, inclinacionPct: { min: 8, max: 10 }, nota: '' },
      },
      {
        id: 'dia-mar',
        diaSemana: 2,
        nombre: 'Pierna I (cuádriceps y glúteo)',
        calentamiento: '',
        ejercicios: [
          ejercicio({ id: 'ej-prensa-45', nombre: 'Prensa 45°', series: 4, min: 10, max: 12, rir: RIR2(), descansoSeg: 120,
            consejo: 'No bloquees las rodillas arriba; baja hasta ~90° sin despegar la zona lumbar.',
            ajustes: { p1: { nota: 'Pies altos en la plataforma (más glúteo)' }, p2: MAS_PESADO() } }),
          ejercicio({ id: 'ej-sentadilla-bulgara', nombre: 'Sentadilla búlgara', series: 3, min: 10, max: 10, porLado: true, rir: RIR2(), descansoSeg: 90,
            consejo: 'Torso levemente inclinado; la rodilla delantera sigue la línea del pie.' }),
          ejercicio({ id: 'ej-hip-thrust', nombre: 'Hip thrust', series: 4, min: 8, max: 10, rir: RIR2(), descansoSeg: 120,
            consejo: 'Mentón al pecho, empuja con los talones y aprieta glúteos arriba.',
            ajustes: { p1: { nota: 'Pausa de 1 s arriba' }, p2: MAS_PESADO() } }),
          ejercicio({ id: 'ej-ext-cuadriceps', nombre: 'Extensión de cuádriceps', series: 3, min: 12, max: 15, rir: RIR12(), descansoSeg: 75,
            consejo: 'Sube controlado y sostén 1 s con la rodilla extendida.' }),
          ejercicio({ id: 'ej-pantorrilla-pie', nombre: 'Pantorrilla de pie', series: 4, min: 15, max: 15, rir: RIR12(), descansoSeg: 60,
            consejo: 'Rango completo: estira abajo 1 s y sube a puntas.' }),
        ],
        cardio: { nombre: 'Bicicleta', minutos: 20, velocidadKmH: null, inclinacionPct: null, nota: '' },
      },
      {
        id: 'dia-jue',
        diaSemana: 4,
        nombre: 'Torso y brazos',
        calentamiento: '',
        ejercicios: [
          ejercicio({ id: 'ej-remo-manc-una-mano', nombre: 'Remo con mancuerna a una mano', series: 4, min: 10, max: 10, porLado: true, rir: RIR2(), descansoSeg: 90,
            consejo: 'Espalda neutra apoyada en el banco; lleva el codo hacia la cadera.' }),
          ejercicio({ id: 'ej-press-banca-plano', nombre: 'Press de banca plano', series: 3, min: 8, max: 10, rir: RIR2(), descansoSeg: 120,
            consejo: 'Escápulas retraídas, pies firmes; la barra toca el esternón bajo.', ajustes: { p2: MAS_PESADO() } }),
          ejercicio({ id: 'ej-pec-deck-cruce', nombre: 'Pec deck o cruce de poleas', series: 3, min: 12, max: 15, rir: RIR12(), descansoSeg: 75,
            consejo: 'Codos ligeramente flexionados y fijos; junta las manos sin chocar.' }),
          ejercicio({ id: 'ej-face-pull', nombre: 'Face pulls', series: 4, min: 15, max: 15, rir: RIR2(), descansoSeg: 60,
            consejo: 'Cuerda a la altura de la cara, separa las manos y rota hacia afuera.' }),
          ejercicio({ id: 'ej-curl-biceps', nombre: 'Curl de bíceps', series: 3, min: 12, max: 12, rir: RIR12(), descansoSeg: 0, superserie: 'A',
            consejo: 'Codos quietos junto al torso; baja en 2 s.' }),
          ejercicio({ id: 'ej-ext-overhead-triceps', nombre: 'Extensión overhead de tríceps', series: 3, min: 12, max: 12, rir: RIR12(), descansoSeg: 75, superserie: 'A',
            consejo: 'Codos apuntando al frente; estira completo detrás de la cabeza.' }),
        ],
        cardio: { nombre: 'Caminadora con intervalos', minutos: 20, velocidadKmH: null, inclinacionPct: null, nota: 'Intervalos' },
      },
      {
        id: 'dia-vie',
        diaSemana: 5,
        nombre: 'Pierna II (cadena posterior)',
        calentamiento: '',
        ejercicios: [
          ejercicio({ id: 'ej-peso-muerto-rumano', nombre: 'Peso muerto rumano', series: 4, min: 8, max: 10, rir: RIR2(), descansoSeg: 120,
            consejo: 'Cadera atrás, barra pegada a las piernas, espalda neutra; baja hasta sentir isquios.', ajustes: { p2: MAS_PESADO() } }),
          ejercicio({ id: 'ej-curl-femoral', nombre: 'Curl femoral', series: 4, min: 10, max: 12, rir: RIR2(), descansoSeg: 90,
            consejo: 'Cadera pegada al banco; baja lento.' }),
          ejercicio({ id: 'ej-abducciones', nombre: 'Abducciones', series: 4, min: 15, max: 15, rir: RIR12(), descansoSeg: 60,
            consejo: 'Torso levemente inclinado al frente; pausa 1 s afuera.' }),
          ejercicio({ id: 'ej-zancadas-caminando', nombre: 'Zancadas caminando', series: 3, min: 12, max: 12, porLado: true, rir: RIR2(), descansoSeg: 90,
            consejo: 'Paso largo, rodilla trasera cerca del piso, torso erguido.' }),
          ejercicio({ id: 'ej-planchas', nombre: 'Planchas', medida: 'segundos', series: 3, min: 45, max: 60, rir: null, descansoSeg: 60,
            consejo: 'Glúteos y abdomen apretados; cuerpo en línea recta, sin hundir la cadera.' }),
        ],
        cardio: { nombre: 'Elíptica', minutos: 20, velocidadKmH: null, inclinacionPct: null, nota: '' },
      },
    ],
  };
}

/** Datos iniciales completos. `ctx` = { hoy, ahora } (el repositorio la valida y estampa rev/fechas al guardar). */
export function crearSemilla(ctx) {
  return {
    schemaVersion: 1,
    app: 'gimnasio',
    rev: 0,
    creadoEn: ctx.ahora,
    actualizadoEn: ctx.ahora,
    ajustes: {
      personas: [{ id: 'p1', nombre: 'Ella' }, { id: 'p2', nombre: 'Él' }],
      incrementoKg: 2.5,
      fechaInicio: ctx.hoy,
    },
    rutina: crearRutinaSemilla(),
    sesiones: {},
    pesoCorporal: [],
    control: { generadoHasta: null },
  };
}
