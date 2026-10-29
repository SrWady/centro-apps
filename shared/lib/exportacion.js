/*
 * exportacion.js — pasar datos a otro celular (exportar/importar JSON con sobre y validación).
 * Contrato: docs/UTILIDADES.md §9. analizarImportacion es PURA; entregarArchivo y leerArchivo usan APIs del navegador
 * inyectables (navegador, documento, urlApi).
 */
import { esFechaISO, esInstanteISO, esObjetoPlano, reviverSeguro } from './validacion.js';
import { migrar, validarSeguro } from './repositorio.js';

export const FORMATO = 'cte-export';
export const MAX_CARACTERES = 10_000_000;

const NOMBRES_APP = { finanzas: 'Finanzas', gimnasio: 'Gimnasio' };

/** Sobre `{ formato, app, schemaVersion, exportadoEn, datos }` serializado. Nombre: '<app>-<hoy>.json'. */
export function crearArchivoExportacion(datos, { app, ahora, hoy } = {}) {
  if (typeof app !== 'string' || !/^[a-z]+$/.test(app)) throw new TypeError('app inválida.');
  if (!esObjetoPlano(datos)) throw new TypeError('datos debe ser un objeto.');
  if (!esInstanteISO(ahora)) throw new TypeError('ahora debe ser un instante ISO UTC.');
  if (!esFechaISO(hoy)) throw new TypeError('hoy debe ser YYYY-MM-DD.');
  const sobre = { formato: FORMATO, app, schemaVersion: datos.schemaVersion, exportadoEn: ahora, datos };
  const texto = JSON.stringify(sobre);
  return { nombre: `${app}-${hoy}.json`, texto, bytes: new TextEncoder().encode(texto).length };
}

/**
 * Entrega el archivo: 1) hoja de compartir del sistema, 2) descarga con <a download>, 3) 'mostrado' (la vista enseña el
 * texto en un <textarea readonly>). Nunca lanza.
 * @returns {Promise<'compartido'|'descargado'|'cancelado'|'mostrado'>}
 */
export async function entregarArchivo(
  { nombre, texto },
  { navegador = globalThis.navigator, documento = globalThis.document, urlApi = globalThis.URL } = {},
) {
  // 1) Compartir (iOS 15+, Android). Se prueban dos tipos MIME porque no todos los motores aceptan application/json.
  try {
    if (navegador && typeof navegador.canShare === 'function' && typeof navegador.share === 'function' && typeof File === 'function') {
      for (const tipo of ['application/json', 'text/plain']) {
        const archivo = new File([texto], nombre, { type: tipo });
        if (navegador.canShare({ files: [archivo] })) {
          try {
            await navegador.share({ files: [archivo], title: nombre });
            return 'compartido';
          } catch (e) {
            if (e && e.name === 'AbortError') return 'cancelado';
            break; // NotAllowedError, etc.: probar la descarga
          }
        }
      }
    }
  } catch {
    /* seguir con la descarga */
  }

  // 2) Descargar
  try {
    if (documento && urlApi && typeof urlApi.createObjectURL === 'function') {
      const url = urlApi.createObjectURL(new Blob([texto], { type: 'application/json' }));
      const enlace = documento.createElement('a');
      enlace.href = url;
      enlace.download = nombre;
      enlace.style.display = 'none';
      documento.body.appendChild(enlace);
      enlace.click();
      enlace.remove();
      const temporizador = setTimeout(() => {
        try {
          urlApi.revokeObjectURL(url);
        } catch {
          /* nada */
        }
      }, 10_000);
      if (temporizador && typeof temporizador.unref === 'function') temporizador.unref();
      return 'descargado';
    }
  } catch {
    /* mostrar el texto */
  }

  // 3) Mostrar
  return 'mostrado';
}

/** Lee un File/Blob como texto. */
export async function leerArchivo(file) {
  try {
    if (!file || typeof file.size !== 'number') return { ok: false, error: 'lectura', mensaje: 'No se pudo leer el archivo.' };
    if (file.size > MAX_CARACTERES) return { ok: false, error: 'muy-grande', mensaje: 'El archivo es demasiado grande.' };
    if (typeof file.text === 'function') return { ok: true, texto: await file.text() };
    if (typeof FileReader === 'function') {
      const texto = await new Promise((resolver, rechazar) => {
        const lector = new FileReader();
        lector.onload = () => resolver(String(lector.result));
        lector.onerror = () => rechazar(lector.error);
        lector.readAsText(file);
      });
      return { ok: true, texto };
    }
  } catch {
    /* cae al error genérico */
  }
  return { ok: false, error: 'lectura', mensaje: 'No se pudo leer el archivo.' };
}

function falla(error, mensaje, extra) {
  return { ok: false, error, mensaje, ...(extra ?? {}) };
}

/**
 * PURO. Orden: vacío/tamaño → JSON → sobre → app → versión → migrar+validar.
 * @returns {{ok:true,datos:object,resumen:any,avisos:any[],versionOrigen:number}|{ok:false,error:string,mensaje:string,errores?:any[]}}
 */
export function analizarImportacion(texto, { app, version, migraciones = {}, validar, resumir = () => ({}) }) {
  if (typeof texto !== 'string' || texto.trim() === '') return falla('vacio', 'El archivo está vacío.');
  if (texto.length > MAX_CARACTERES) return falla('muy-grande', 'El archivo es demasiado grande.');

  let sobre;
  try {
    sobre = JSON.parse(texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto, reviverSeguro);
  } catch {
    return falla('json-invalido', 'El archivo no es un respaldo válido.');
  }

  if (!esObjetoPlano(sobre) || sobre.formato !== FORMATO || !esObjetoPlano(sobre.datos)) {
    return falla('formato', 'El archivo no es un respaldo de esta app.');
  }
  const appArchivo = sobre.app;
  if (typeof appArchivo !== 'string' || sobre.datos.app !== appArchivo) return falla('formato', 'El archivo no es un respaldo de esta app.');
  if (appArchivo !== app) {
    const nombre = NOMBRES_APP[appArchivo];
    return nombre ? falla('otra-app', `Este archivo es de ${nombre}.`) : falla('formato', 'El archivo no es un respaldo de esta app.');
  }

  const versionOrigen = sobre.datos.schemaVersion;
  if (!Number.isSafeInteger(versionOrigen) || versionOrigen < 1 || sobre.schemaVersion !== versionOrigen) {
    return falla('version-invalida', 'El archivo tiene una versión desconocida.');
  }
  if (versionOrigen > version) return falla('version-futura', 'El archivo viene de una versión más nueva; actualice la app.');

  let migrados;
  try {
    migrados = migrar(sobre.datos, version, migraciones);
  } catch {
    return falla('esquema', 'El archivo tiene datos inválidos.', { errores: [{ ruta: '', mensaje: 'No se pudo actualizar el archivo a la versión actual.' }] });
  }
  // R0-03: un validar o resumir que lanza no tumba la importación.
  const v = validarSeguro(validar, migrados);
  if (!v.ok) return falla('esquema', 'El archivo tiene datos inválidos.', { errores: v.errores.slice(0, 5) });

  const avisos = [...v.avisos];
  let resumen;
  try {
    resumen = resumir(v.datos);
  } catch {
    resumen = {};
    avisos.push({ ruta: '', mensaje: 'No se pudo preparar el resumen del archivo; revise los datos después de importar.' });
  }
  return { ok: true, datos: v.datos, resumen, avisos, versionOrigen };
}
