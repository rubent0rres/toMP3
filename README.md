# toMP3

Aplicación de escritorio con Electron + Next.js para guardar videos de YouTube y Reels de Facebook en **MP3** o **MP4**. Interfaz en español, archivos locales y sin servidor externo propio.

## Iniciar el desarrollo

Requiere Node.js 22 o posterior y acceso a internet durante la instalación.

```sh
npm ci
npm run dev
```

El primer inicio prepara yt-dlp, FFmpeg y FFprobe en `resources/bin/`. Los siguientes inicios reutilizan las herramientas locales después de comprobar que funcionan. Si falta FFmpeg tanto en las dependencias como en esa carpeta (por ejemplo, cuando se omiten los scripts de instalación), se descarga automáticamente al ejecutar `npm run dev` o `npm run tools:setup`. No hace falta instalar Python ni estas herramientas en el sistema. La descarga de yt-dlp se verifica con el SHA-256 publicado por el proyecto oficial. El servidor de desarrollo utiliza `127.0.0.1:3210`; Electron se cierra junto con él al detener el comando.

## Abrir la versión compilada

```sh
npm run tools:setup
npm run build
npm start
```

`npm run dev:web` muestra solamente la interfaz en el navegador. Las descargas, el portapapeles y la selección de carpeta funcionan dentro de Electron.

## Uso

1. Pega el enlace de un video y pulsa **Analizar enlace**.
2. Selecciona **Solo audio / MP3** o **Video + audio / MP4** y su calidad.
3. Cambia la carpeta de destino si lo necesitas y pulsa **Descargar**.
4. Consulta el progreso, cancela o reintenta descargas, o muestra los archivos terminados en Finder/Explorador.

Acepta Reels públicos de Facebook con enlaces `facebook.com/reel/ID`, `facebook.com/share/r/CODIGO/` y `fb.watch/CODIGO/`. Los enlaces móviles y los parámetros de compartir se normalizan. También acepta enlaces `youtube.com/watch`, `youtu.be`, Shorts, `live` y `embed` de un video individual. Si un enlace incluye una lista, solo se descarga el video seleccionado. Las listas completas y las transmisiones activas no están incluidas.

- MP3: 128, 192, 256 o 320 kbps. La calidad de la fuente limita la calidad del resultado.
- MP4 de Facebook: mejor calidad original disponible, con video y audio. No se aplica un filtro de resolución porque Facebook puede omitir ese dato en sus pistas HD/SD.
- MP4 de YouTube: resolución máxima de 720p, 1080p, 1440p o 2160p. Se usan las pistas MP4/M4A disponibles y se unen localmente; no se inventa una resolución superior a la fuente.
- Cola de hasta 20 descargas pendientes, procesadas una a la vez.
- Historial local de hasta 100 registros. Limpiarlo no elimina tus archivos.
- Los archivos existentes se conservan; se agrega un número al nombre cuando hace falta.
- Cancelar elimina los temporales de esa descarga. Si la aplicación se cierra abruptamente, el registro queda disponible para reintentar al abrir de nuevo; puede quedar un temporal en `.tomp3` dentro de la carpeta elegida.
- Los cambios de carpeta se aplican a las nuevas descargas. Las que ya están en cola conservan su destino.

El historial se guarda en `downloads.json`, dentro de la carpeta de datos de Electron para toMP3. La carpeta de destino inicial es `Descargas/toMP3`.

## Verificación

```sh
npm run check
npm test
npm run test:e2e
```

La prueba integral abre Electron con un perfil aislado dentro de `work/smoke`, analiza un video público corto y descarga sus versiones MP3 y MP4. Requiere acceso a YouTube. Para probar un Reel real en la app ya empaquetada: `node scripts/smoke-electron.mjs --packaged --url https://www.facebook.com/reel/ID`. Las capturas y los archivos de prueba quedan en esa misma carpeta, separada del historial personal.

Las pruebas unitarias cubren validación de enlaces y opciones, serialización de la cola, nombres únicos, cancelación, limpieza de temporales, reintentos y recuperación de historial.

## Generar una aplicación

```sh
npm run pack   # Aplicación local sin instalador
npm run dist   # DMG/ZIP en macOS, NSIS en Windows, AppImage en Linux
```

Los resultados quedan en `release/`. Compila en el sistema y arquitectura de destino: las herramientas multimedia se seleccionan para la máquina que ejecuta `tools:setup`. La versión de Mac se genera sin firma ni notarización; el proyecto todavía no configura publicación ni actualizaciones automáticas. No se ha validado la ejecución en Windows o Linux.

Para actualizar el motor de descarga:

```sh
npm run tools:setup -- --update
```

Después vuelve a compilar y empaquetar. Reinicia cualquier instancia que estuviera abierta para utilizar el motor nuevo.

## Estructura

- `app/`: interfaz de Next.js, TypeScript y estilos.
- `electron/main.cjs`: ventana, protocolo local, preferencias e IPC.
- `electron/preload.cjs`: API limitada entre la interfaz y Electron.
- `electron/downloader.cjs`: análisis, cola y procesos multimedia.
- `scripts/`: instalación de herramientas, desarrollo y prueba integral.
- `tests/`: pruebas de la cola y sus límites.
- `resources/bin/`: herramientas locales, excluidas de Git.

Next.js exporta una interfaz estática a `out/`. Electron la carga por el protocolo privado `tomp3://desktop`, con aislamiento de contexto, sandbox y Node deshabilitado en la interfaz. El proceso principal valida enlaces y opciones, inicia los programas sin un intérprete de comandos y limita las operaciones de archivos a la carpeta elegida y a descargas conocidas.

React y Next.js son dependencias de compilación: el paquete de escritorio contiene la interfaz compilada y los procesos de Electron, sin instalar un servidor Next.js en el equipo del usuario.

## Limitaciones y dependencias

YouTube y Facebook pueden limitar videos por región, acceso o verificación; en esos casos la aplicación muestra el error y permite reintentar. Esta versión no importa cookies ni inicia sesión en YouTube o Facebook. Los Reels privados o que pidan iniciar sesión no se pueden descargar; se muestra un mensaje específico de Facebook. Utiliza contenido propio o para el que tengas permiso de descarga.

La revisión inicial de `npm audit` detectó avisos transitivos en las herramientas de desarrollo `eslint-config-next` (braces) y `electron-builder` (sprintf-js), sin corrección compatible publicada en esas dependencias en el momento de la revisión. No se incluyen esos módulos en la aplicación empaquetada. Revisar de nuevo antes de publicar una distribución.

Fuentes y licencias de terceros:

- [Electron](https://www.electronjs.org/): MIT.
- [Next.js](https://nextjs.org/): MIT.
- [yt-dlp](https://github.com/yt-dlp/yt-dlp): consultar sus avisos y los componentes de la distribución binaria.
- [FFmpeg](https://ffmpeg.org/legal.html), [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) y [FFprobe installer](https://github.com/SavageCore/node-ffprobe-installer): las licencias dependen de las opciones de compilación del binario. Los binarios preparados son para desarrollo local; revisar las licencias, fuentes y requisitos de redistribución antes de publicar instaladores.
