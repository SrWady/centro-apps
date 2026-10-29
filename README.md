# Centro de Entrenamiento + Finanzas Personales

Dos aplicaciones web instalables (PWA) que funcionan **sin internet** y guardan todo **solo en el celular**, sin cuentas, sin servidor y sin sincronización:

| App | Qué hace | Carpeta |
|---|---|---|
| **Gimnasio** (Centro de Entrenamiento) | Rutina semanal para dos personas ("Ella" y "Él", nombres editables): series, descansos, récords, semana, progreso. | `gimnasio/` |
| **Finanzas** (Finanzas Personales) | Presupuesto por ciclos de pago a pago, movimientos, deudas, metas, cuentas y reportes. | `finanzas/` |

> **Publicación y enlaces:** cómo se publica el sitio está en la [sección 2](#2-publicar-en-github-pages) y las direcciones de las dos apps, justo debajo. Si un enlace responde "404", GitHub Pages todavía no está activado para este repositorio o está construyendo el sitio (la primera vez puede tardar hasta 10 minutos): ver el paso final de la sección 2.

**Enlaces** (los mismos para iPhone y Samsung):

| Qué | Enlace |
|---|---|
| Lanzador (solo para elegir; no se instala) | `https://srwady.github.io/centro-apps/` |
| **Gimnasio** (se instala desde aquí) | `https://srwady.github.io/centro-apps/gimnasio/` |
| **Finanzas** (se instala desde aquí) | `https://srwady.github.io/centro-apps/finanzas/` |

Cada app se instala con **su propio ícono** ("Gimnasio" y "Finanzas") y guarda sus datos aparte.

`index.html` en la raíz es solo una página para elegir una de las dos apps. **No se instala**: cada app se instala desde su propia página (ver más abajo por qué).

> **Lea esto primero: sus datos viven solo en ese celular y ese navegador.** No hay copia en ninguna nube. Si borra los datos del navegador, desinstala la app (iPhone) o limpia el almacenamiento del sitio, **se pierden**. Para cambiar de celular o hacer una copia use *Ajustes → Pasar datos a otro celular* (ver sección 6).

---

## 1. Estructura

Lo que está en el repositorio público (y por tanto en el sitio publicado):

```
/                    raíz del repo = raíz publicada en GitHub Pages
├── index.html       lanzador (dos tarjetas; sin manifest: no instalable)
├── sw.js            service worker del lanzador (solo atiende la página de inicio)
├── .nojekyll        evita que GitHub procese el sitio con Jekyll
├── gimnasio/        app: index.html, app.js, manifest.webmanifest, sw.js, registrar-sw.js, icons/ ...
├── finanzas/        app: ídem
├── shared/          código y estilos compartidos (lib/ y ui/); ambos service workers lo precargan
└── README.md
```

En el equipo de desarrollo hay además carpetas que **no se publican** (no están en el repositorio): `tools/` (íconos, lista de precarga, publicador), `tests/`, `docs/`, `mockups/`, `PLAN.md`, `.claude/`, `package.json` y `privado/` (datos reales, ver sección 5). El script de publicación (sección 2) sube **solo** una lista blanca de archivos, de modo que nada de eso llega a GitHub aunque exista en el disco; el `.gitignore` lo refuerza por si alguien usara git por su cuenta.

Todo usa **rutas relativas**, así que funciona igual en `https://srwady.github.io/centro-apps/` (subruta) que en cualquier otra carpeta. Sin dependencias externas: ni CDN ni fuentes remotas.

---

## 2. Publicar en GitHub Pages

> **Qué se publica y qué no.** El repositorio será **público**: cualquiera con el enlace puede leer todos los archivos que se suban, y lo que se sube **queda en el historial para siempre**. Por eso `finanzas/seed.js` trae **solo datos de ejemplo** (cifras redondas y ficticias) y los nombres de las dos personas de Gimnasio no están en el código. Sus datos reales viven en un archivo que **está solo en el equipo del usuario** (sección 5) y el script **nunca lo sube**.
>
> El script sube **únicamente** una lista blanca: la raíz (`index.html`, `sw.js`, `.nojekyll`, `README.md`) y, de cada app, lo que su lista de precarga indica (incluye los archivos de `shared/` que realmente usa), más su `sw.js`, `registrar-sw.js`, manifest e íconos. Cualquier otro archivo que haya en esas carpetas (copias `.bak`, archivos ocultos, notas...) **se avisa y no se sube**. Además, **antes de subir lee sus datos reales y comprueba que ninguna cifra ni texto privado aparezca en un archivo a subir**; si aparece, se detiene sin subir nada (y sin mostrar el dato). El simulacro lo hace todo menos subir. Nada se publica sin que usted lo confirme.

Hay **una sola vía**: el script `tools/publicar-github.mjs`. No usa `git` ni `gh` (no hace falta instalar nada más que Node). Nadie más debe manejar su contraseña ni su token: los escribe **usted** en su propia terminal.

### 2.0 Publicar con `tools/publicar-github.mjs`

Necesita Node 18 o superior (el mismo que usa para las pruebas) y conexión a internet. El script sube los archivos con la API de GitHub, en un solo commit. **No activa GitHub Pages**: eso se hace a mano, una sola vez, con tres clics (paso 6).

1. **Cree una cuenta** en https://github.com (gratis) si no tiene.
2. **Repositorio vacío:** debe existir `SrWady/centro-apps` (creado vacío). Si tuviera que crearlo de nuevo: botón **New repository** → nombre → **Public** → **no** marque "Add a README", ".gitignore" ni licencia → **Create repository**. (Pages en repositorios privados exige un plan de pago.)
3. **Cree un token con UN solo permiso:** foto de perfil → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - *Token name*: `publicar-centro`. *Expiration*: corta (por ejemplo 7 o 30 días).
   - *Resource owner*: su cuenta. *Repository access*: **Only select repositories** → elija **solo ese repositorio**.
   - *Permissions → Repository permissions*: **Contents: Read and write**. Nada más (*Metadata: Read-only* se agrega sola). No agregue *Pages* ni *Administration*.
   - **Generate token** y copie el texto (empieza con `github_pat_`). Solo se muestra una vez. Trátelo como una contraseña: no lo pegue en chats, correos ni archivos.
4. **Simulacro** (por defecto; no usa internet ni el token): comprueba la lista de precarga, muestra qué archivos subiría y cuáles rechaza, y hace el escaneo de seguridad contra sus datos reales.
   ```bash
   node tools/publicar-github.mjs --repo SrWady/centro-apps
   ```
   Si termina sin errores y dice "Escaneo de seguridad: ... sin coincidencias", puede continuar. Si dice que no encuentra la carpeta `privado/`, no es el equipo con sus datos: no publique desde ahí.
5. **Publicar de verdad** (**solo después de confirmar** que entiende que lo publicado puede ser visible para cualquiera):
   ```bash
   node tools/publicar-github.mjs --repo SrWady/centro-apps --publicar --acepto-datos-publicos
   ```
   El script le pide el token por la terminal **sin mostrarlo**: péguelo y pulse Enter. Use **PowerShell** o el **Símbolo del sistema**. En *Git Bash* no hay modo oculto: escriba `winpty node tools/publicar-github.mjs ...`. El token no se guarda en ningún archivo ni aparece en los mensajes.
   - Evite dejar el token en una variable de entorno (queda en el historial de la terminal). Si no hay otra forma, en PowerShell 7 `$env:GITHUB_TOKEN = Read-Host -MaskInput` y en bash `read -rs GITHUB_TOKEN && export GITHUB_TOKEN`; al terminar, `Remove-Item Env:GITHUB_TOKEN` o `unset GITHUB_TOKEN`.
6. **Active GitHub Pages a mano (una sola vez):** en https://github.com/SrWady/centro-apps/settings/pages → **Build and deployment** → *Source*: **Deploy from a branch** → *Branch*: **main** y carpeta **/ (root)** → **Save**. Al terminar, el script repite estas instrucciones. Pages tarda 1 o 2 minutos (la primera vez, hasta 10) y publica las tres direcciones de la tabla de arriba.
7. **Revoque el token** cuando termine (Settings → Developer settings → Personal access tokens → Revoke); para una actualización cree otro.

Errores frecuentes: `401` = token mal copiado o vencido; `403` = el token no tiene *Contents: Read and write* o no es de ese repositorio; `404` = el repositorio no existe, el nombre en `--repo` está mal escrito o el token no es de ese repositorio. Si el script dice "La lista de precarga o CACHE_VERSION no están al día", siga lo que indica (sección 2.2). Si dice "ABORTADO ... coincidencia(s) con datos de privado/", abra el archivo y la línea indicados y quite ese dato (no se muestra el dato); no use `--sin-escaneo-privado` para saltarse el aviso.

Opciones avanzadas: `--ayuda` muestra todas. `--activar-pages` intenta activar Pages por la API, pero GitHub probablemente exija permisos más amplios que *Contents* (*Pages* y *Administration*); no se recomienda ampliar el token: active Pages a mano.

### 2.1 Preparar y comprobar (local, no publica nada)

```bash
node tools/generar-precache.mjs              # regenera la lista de archivos que se guardan para uso sin internet
node tools/verificar-precache.mjs --final    # debe terminar en "OK: sin errores"
npm test                                     # pruebas unitarias del proyecto
node --test "tools/pruebas/*.test.js"        # pruebas de la PWA (necesitan Chrome o Edge para las de navegador)
```

### 2.2 Publicar un cambio después (actualizar)

El orden importa: **editar → regenerar la precarga subiendo la versión → verificar → publicar**.

```bash
node tools/generar-precache.mjs --subir-version   # regenera la lista y sube CACHE_VERSION (v1 -> v2 ...) en ambas apps
node tools/verificar-precache.mjs --final         # debe terminar en "OK: sin errores"
node tools/publicar-github.mjs --repo SrWady/centro-apps --publicar --acepto-datos-publicos   # token nuevo
```

El script compara cada archivo con lo ya publicado y crea un commit nuevo solo con lo que cambió (y borra lo que ya no está en la lista blanca). **Se niega a publicar** si la lista de precarga no coincide con los archivos (falta o sobra alguno) y **avisa** si cambiaron archivos de una app y `CACHE_VERSION` es la misma que la ya publicada. Pages ya está activado: no hay que repetir el paso 6.

**Qué es `CACHE_VERSION`:** una constante al inicio de `gimnasio/sw.js` y `finanzas/sw.js` (`const CACHE_VERSION = 'v1';`). Cada app guarda sus archivos en una caché llamada `cte-<app>-<versión>`. Al subir la versión, el celular descarga todo de nuevo y **borra la caché vieja de esa app** (nunca las de la otra app ni los datos de usted: los datos están en `localStorage`, que el service worker no toca). Se puede subir a mano editando esa línea en el `sw.js` de la app cambiada (`v1` → `v2`), pero conviene usar el comando de arriba porque además regenera la lista de archivos.

**Para que cada celular reciba el cambio:** abrir la app **con buena señal de internet**, cerrarla del todo (en iPhone, deslizarla hacia arriba en el selector de apps) y volver a abrirla; a veces hace falta repetirlo una vez. Como la estrategia es *red primero*, con internet siempre se pide la versión más reciente; la caché solo responde cuando no hay conexión o la red tarda más de 3 segundos.

**Riesgo conocido tras una actualización con señal débil.** Para que la app abra rápido con mala señal, si un archivo tarda más de 3 segundos en llegar se usa la copia guardada. Justo después de publicar una versión nueva, con señal muy débil, algunos archivos pueden llegar nuevos y otros salir de la copia vieja; si el cambio tocó la forma en que dos archivos se hablan, la pantalla puede quedar **en blanco** (la app muestra un aviso para cerrar y reintentar). Qué hacer: **cerrar la app por completo y volver a abrirla con buena señal** (wifi, preferiblemente). Si sigue en blanco, **como último recurso** borre los datos del sitio (en Chrome: Ajustes del sitio → Borrar datos; en iPhone: desinstalar y volver a instalar). **Eso borra los datos de la app: exporte antes** (sección 6) si todavía puede abrirla alguna vez, y recuerde que sin exportación previa se pierden.

---

## 3. Instalar en el celular

**Instale primero, ingrese datos después.** Instale cada app desde **su propia página** (no desde el lanzador), abra la app una vez **con internet** para que se guarde para uso sin conexión y recién entonces empiece a anotar.

### iPhone (Safari)

1. Abra **Safari** (debe ser Safari) en el enlace de la app, por ejemplo `https://srwady.github.io/centro-apps/gimnasio/`.
2. Toque **Compartir** (el cuadrado con la flecha) → **"Agregar a pantalla de inicio"** → **Agregar**.
3. Repita con el enlace de la otra app (`.../finanzas/`). Quedan **dos íconos distintos**.
4. Abra siempre la app **desde su ícono**, no desde Safari.

**En iPhone esto es obligatorio, no opcional:** Safari puede borrar los datos de un sitio que no se visita en un tiempo, mientras que las apps agregadas a la pantalla de inicio conservan sus datos. Y **Safari y la app instalada guardan los datos por separado**: lo que anote en Safari *antes* de instalar **no aparece** en la app instalada. Por eso: instalar primero y usar después. Si ya anotó datos en Safari, use *Pasar datos a otro celular* (sección 6) para llevarlos a la app instalada (exportar en Safari, importar en la app instalada).

### Samsung (Chrome)

1. Abra **Chrome** en el enlace de la app.
2. Menú **⋮** (arriba a la derecha) → **"Instalar app"** (o **"Agregar a pantalla de inicio"**) → confirme.
3. Repita con la otra app.
4. Abra la app desde su ícono. En Android la app instalada comparte los datos con Chrome para ese sitio; no los pierde al instalar.

### Por qué cada app se instala por separado

Cada app tiene su propio ícono y su propio espacio de datos. El lanzador (`index.html`) existe solo para elegir qué abrir y a propósito **no es instalable**: si se instalara y se entrara a las apps desde ahí, en iPhone los datos quedarían en un espacio distinto del de la app instalada por separado. Si alguna vez agregó el lanzador a la pantalla de inicio, quítelo e instale las dos apps por separado.

---

## 4. Funciona sin internet

Después de la primera visita **con internet** a cada app, funcionan en modo avión: la estrategia es *red primero con caché de respaldo* (si hay conexión se usa la versión más nueva; si no, la guardada). Si abre una app instalada en modo avión sin haberla abierto antes con internet, no tendrá nada guardado.

Limitaciones conocidas:

- **La vibración háptica no funciona en iPhone** (Safari no ofrece vibración web): se compensa con un pulso visual. En el Samsung sí vibra.
- **No hay recordatorios ni notificaciones** (sin servidor no hay avisos con la app cerrada). El descanso entre series avisa solo con la app visible.
- La pantalla siempre encendida durante el entrenamiento depende del navegador; si no está disponible, la app avisa y sigue funcionando.
- **Después de una actualización**, abra la app con buena señal (ver el riesgo descrito en la sección 2.2).

---

## 5. Cargar tus datos reales

**Finanzas se publica con datos de ejemplo** (ingreso, cuentas y deudas ficticios y redondos), porque el repositorio es público. Sus cifras reales están en un archivo de datos (su nombre termina en `.privado.json`) que **existe solo en el equipo del usuario**: no está en GitHub, el script de publicación no lo sube (y comprueba que nada de su contenido se cuele en lo que sube) y no debe pegarse en chats públicos ni subirse a ningún repositorio.

Para cargarlo en el celular:

1. **Instale primero la app Finanzas** (sección 3) y ábrala una vez con internet.
2. **Pase el archivo al celular** por AirDrop (iPhone) o por WhatsApp (envíeselo a usted mismo o a su otro chat) y guárdelo en *Archivos* / *Descargas*.
3. Abra **Finanzas desde su ícono** → **Ajustes → Datos** → **Importar copia** → **Elegir archivo** y seleccione el archivo de datos reales. Si el celular no deja elegir el archivo, abra el archivo, copie su texto y péguelo en el cuadro de esa misma hoja ("Revisar texto pegado"). (Ojo: en esa misma pantalla el otro botón, "Pasar datos a otro celular (exportar)", **exporta**; para cargar datos use **Importar copia**.)
4. La app muestra un resumen. Confirme: **importar reemplaza los datos de ejemplo** (guarda antes un respaldo automático).

> **En iPhone, importe dentro de la app instalada (desde su ícono), no en Safari.** Safari y la app instalada guardan los datos por separado: lo que se importe en Safari no aparecería en la app.

Una vez importado, bórrelo de la galería o de WhatsApp si no quiere que quede copia suelta. Si más adelante usa **Ajustes → Borrar todos los datos**, la app vuelve a los datos de ejemplo (no a los reales): vuelva a importar el archivo.

### Poner los nombres de las dos personas en Gimnasio

Gimnasio se usa **en un solo celular para las dos personas**. En el código no hay nombres reales (solo "Ella" y "Él" de ejemplo): se escriben en la propia app.

1. Abra **Gimnasio** desde su ícono → **Ajustes → Personas**.
2. Escriba en **Nombre 1** y **Nombre 2** los nombres de las dos personas. Se guardan al salir de cada campo.
3. En la misma pantalla puede elegir la **persona por defecto al abrir en este celular** (o "La última"). Esa preferencia es solo de ese celular y no se pasa al exportar.

Los nombres y todo el historial de las dos personas quedan **solo en ese celular**; la copia de seguridad es el archivo de *Pasar datos a otro celular* (sección 6).

---

## 6. Pasar datos a otro celular (o hacer una copia)

Cada app guarda sus datos aparte; haga esto **en cada app**:

1. En el celular de origen: **Ajustes → "Pasar datos a otro celular" → exportar**. Se genera un archivo `gimnasio-AAAA-MM-DD.json` (o `finanzas-…`); compártalo (AirDrop, WhatsApp, Archivos...) o guárdelo.
2. En el celular nuevo: instale la app (sección 3), ábrala con internet una vez y vaya a **Ajustes → "Pasar datos a otro celular" → importar** (en Finanzas el botón se llama **Importar copia**, dentro de Ajustes → Datos); elija el archivo.
3. La app muestra un resumen y pide confirmación: **importar reemplaza todos los datos de ese celular** (no se mezcla). Antes de reemplazar, la app guarda una copia automática de lo que había.

(Los nombres exactos de los botones pueden variar ligeramente; están en Ajustes de cada app.) No hay copias de seguridad automáticas: si quiere respaldo, exporte de vez en cuando y guarde el archivo. El archivo contiene sus datos personales: no lo publique.

---

## 7. Si algo no va bien

| Síntoma | Qué hacer |
|---|---|
| No aparece "Instalar app" en Chrome | Abra la página de la **app** (no el lanzador) con internet y espere unos segundos; recargue una vez. |
| En iPhone no existe "Agregar a pantalla de inicio" | Debe abrirse en Safari (no dentro de otra app como WhatsApp); use Compartir → Agregar a pantalla de inicio. |
| La app instalada aparece vacía en iPhone | Es lo esperado si anotó datos en Safari antes de instalar: Safari y la app instalada no comparten datos. Exporte en Safari e importe en la app (sección 6). |
| Una actualización no llega | Abra la app **con buena señal**, ciérrela del todo y ábrala otra vez. Si persiste, confirme que se publicó el cambio (el script terminó mostrando "Commit ..." o "No hay nada nuevo") y que `CACHE_VERSION` subió (sección 2.2). |
| Pantalla en blanco justo después de una actualización | Cierre la app por completo y ábrala con buena señal (wifi). Si sigue en blanco, **último recurso**: borrar los datos del sitio, que **borra los datos de la app** (exporte antes si puede; sección 2.2). |
| "Sin conexión y sin copia guardada" | Esa app nunca se abrió con internet en este celular (o se borraron los datos del navegador). Ábrala una vez con internet. |
| Quitar todo y empezar de cero | Use **Ajustes → Borrar todo** dentro de la app (pide confirmación). Desinstalar el ícono en iPhone también borra sus datos. |
| El enlace da 404 | GitHub Pages aún no está activado o está construyendo el sitio: sección 2.0, paso 6. |

Nota para Android y escritorio: `https://srwady.github.io` es **un solo sitio para todos sus repositorios**, y comparte el almacenamiento entre ellos; por eso todas las claves de estas apps empiezan con `cte.` y "Borrar todo" no usa `localStorage.clear()`.

---

## 8. Desarrollo

Solo para quien modifique el código, **en el equipo de desarrollo** (estas herramientas y carpetas no están en el repositorio público; nada de esto se ejecuta en el celular):

```bash
npm test                                          # unitarias (Node >= 22)
node --test "tools/pruebas/*.test.js"             # PWA: íconos, manifests, service workers, precarga, publicador, navegador
node tools/generar-iconos.mjs                     # regenera los íconos PNG (solo si cambia el diseño)
node tools/generar-precache.mjs [app] [--seco] [--subir-version]
node tools/verificar-precache.mjs [app] [--final]
node tools/probar-offline.mjs                     # primera visita -> sin red -> recarga, instalabilidad (Chrome o Edge)
node tools/probar-uso-offline.mjs                 # usar las apps sin red: registrar series (Gimnasio) y un gasto (Finanzas)
node tools/publicar-github.mjs --repo usuario/nombre   # simulacro de publicación (ver 2.0); --ayuda lista las opciones
node tools/servir.mjs 8080                        # servidor estático para ver las maquetas (el antivirus corporativo puede bloquearlo); nunca sirve privado/
```

Reglas del código: HTML, CSS y JS sin frameworks ni dependencias externas en ejecución; módulos ES con imports relativos con extensión; rutas siempre relativas; todo texto de usuario escapado. Detalle en `docs/ARQUITECTURA.md` y guía de publicación en `docs/despliegue/` (ambas solo en el equipo de desarrollo).
