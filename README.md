# VOX Studio

Estudio web de grabación vocal sobre beats, desarrollado con React, TypeScript y Vite. Funciona íntegramente en el navegador: Web Audio para reproducir, mezclar y procesar efectos; AudioWorklet para capturar PCM, comprimir, reducir sibilancia y generar ecos precisos; IndexedDB para conservar proyectos, grabaciones y presets. No requiere cuentas, claves, backend ni servicios externos. Las tipografías se sirven localmente.

## Iniciar

Requiere Node.js 22.12+ (probado con Node 24) y npm.

```sh
npm install
npm run dev
```

Abre **http://127.0.0.1:5173/**. El puerto es fijo para mantener el mismo origen de almacenamiento. Usa siempre esta dirección: `localhost`, `127.0.0.1` y otros puertos tienen bases de datos independientes.

Para generar y previsualizar la versión de producción:

```sh
npm run build
npm run preview
```

La previsualización usa otro puerto y, por tanto, otra biblioteca local. El contenido de [dist](./dist/) se puede servir en cualquier hosting estático con HTTPS. El micrófono necesita **HTTPS o una dirección de loopback como 127.0.0.1**. No abras directamente el HTML con `file://`.

## Qué incluye

- Interfaz oscura adaptativa, timeline horizontal con compases y segundos, zoom, cursor y seguimiento de reproducción. Inspector y mezclador; diseño centrado en ordenador.
- Importación con selector o arrastrar y soltar: **WAV y MP3**, además de OGG, M4A, AAC, FLAC y WebM cuando el navegador pueda decodificarlos. Se conserva el archivo original. Solo mono o estéreo.
- Reproducción, pausa, parada, vuelta al inicio y búsqueda desde la regla, la pista vacía o el campo «Ir a». Las pistas se programan sobre un único `AudioContext`.
- Grabación **mono PCM a 48 kHz** desde el micrófono predeterminado del sistema, con permiso explícito del navegador. El beat y las voces existentes se reproducen durante la captura. No hay monitorización directa de la voz para evitar realimentación.
- Pistas iniciales de instrumental, voz principal, dobles, coros y ad-libs. Se pueden añadir más pistas de cualquiera de estos tipos y renombrarlas.
- Formas de onda calculadas a partir de las muestras reales. Durante la captura se muestra la región en curso y el medidor de entrada; la onda completa aparece al finalizar.
- Volumen por pista, mute, solo, panorama y volumen master. Medidores reales de micrófono y master. Los clips superpuestos se suman.
- Movimiento temporal mediante arrastre, flechas o campo numérico. Rejilla opcional de semicorcheas; Mayús omite el ajuste al arrastrar y permite pasos de 10 ms con las flechas.
- Recorte reversible de inicio y duración desde el inspector. Eliminación de clips. No hay undo/redo en esta fase: eliminar el último clip de un archivo elimina ese audio del guardado local.
- Autoguardado tras 600 ms sin cambios, guardado inmediato al terminar una toma o importación, guardado manual y biblioteca de proyectos. Se restaura la última sesión al abrir la aplicación.
- Exportación de la sesión completa como **WAV estéreo, PCM de 16 bits, 48 kHz**, desde el segundo cero hasta el final de los clips y las colas de efectos. Incluye posiciones, recortes, efectos, volumen, panorama, mute, solo y master. Incluye el silencio inicial si los clips empiezan después de cero.
- Detección de saturación al exportar: si las muestras superan 0 dBFS, se solicita bajar niveles. No se aplica normalización, limitación ni masterización automática.
- Mensajes para permisos denegados, dispositivos ausentes u ocupados, archivos inválidos y errores de almacenamiento. Las operaciones incompatibles se bloquean durante captura, importación y exportación.

## Flujo recomendado

1. Importa el beat. El primer archivo se coloca en la pista Instrumental si está vacía; en caso contrario se usa la pista seleccionada. En una importación múltiple, los archivos adicionales crean pistas de instrumental. La importación usa la posición del cursor.
2. Ponte auriculares y selecciona **Voz principal**. Pulsa **Grabar** y acepta el permiso. Puedes cambiar el micrófono predeterminado desde el sistema o la configuración del navegador.
3. Pulsa **Finalizar** para conservar la toma y el cursor, o **Detener** para conservarla y volver al inicio. Selecciona Dobles, Coros o Ad-libs para grabar nuevas capas.
4. Selecciona un clip y ajusta inicio, duración y recorte. Usa el mezclador y el inspector para equilibrar niveles. M silencia, S aísla; mute prevalece sobre solo.
5. Espera a «Todos los cambios guardados». Abre **Proyectos** para crear o recuperar sesiones. **Exportar WAV** descarga la mezcla.

Atajos fuera de los campos de edición: **Espacio** reproducir/pausar, **R** grabar/finalizar, **Inicio** volver a cero y **Ctrl/Cmd + S** guardar. Cuando un botón tiene el foco, Espacio conserva su activación nativa. Los diálogos permiten cerrar con Escape y retienen el foco.

## Arquitectura

| Módulo                                                               | Responsabilidad                                                                                                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/model/project.ts](./src/model/project.ts)                       | Modelo versionado de proyectos, pistas y clips; cálculo compartido de ventanas de reproducción y audibilidad. Las posiciones están en segundos, los recortes referencian el audio original. |
| [src/audio/AudioEngine.ts](./src/audio/AudioEngine.ts)               | Un contexto de audio, caché de buffers, transporte, adquisición/liberación del micrófono, medidores y render offline.                                                                       |
| [src/audio/recorder.worklet.js](./src/audio/recorder.worklet.js)     | Captura en el hilo de audio. Inicio y límite en fotogramas del mismo reloj que la reproducción; bloques PCM transferibles y salida silenciosa.                                              |
| [src/audio/graph.ts](./src/audio/graph.ts)                           | Grafo común: entrada → cadena de efectos → volumen/mute/solo → panorama → master. Parámetros en vivo y cambios de orden con fundido, sin reprogramar los clips.                             |
| [src/audio/effects.ts](./src/audio/effects.ts)                       | Factorías DSP, curvas de distorsión, respuestas de reverb deterministas y limitadas en caché, suavizado y liberación de nodos/temporizadores.                                               |
| [src/audio/dynamics.worklet.js](./src/audio/dynamics.worklet.js)     | Compresor y de-esser sin look-ahead; delay con realimentación dentro del procesador para evitar añadir un bloque a cada eco.                                                                |
| [src/model/effects.ts](./src/model/effects.ts)                       | Tipos, parámetros, valores por defecto, validación, clonación de presets y cálculo de colas.                                                                                                |
| [src/components/EffectsPanel.tsx](./src/components/EffectsPanel.tsx) | Controles de efectos por pista, bypass, orden y presets personalizados.                                                                                                                     |
| [src/audio/wav.ts](./src/audio/wav.ts)                               | Codificación PCM16 intercalada y descarga con revocación de URL.                                                                                                                            |
| [src/storage/projects.ts](./src/storage/projects.ts)                 | IndexedDB versionado con `idb`. Proyecto y archivos referenciados se escriben en una transacción atómica; los fallos no reemplazan el guardado anterior. Limpieza de audios huérfanos.      |
| [src/hooks/useStudio.ts](./src/hooks/useStudio.ts)                   | Coordinación de UI, audio y persistencia; exclusión de operaciones incompatibles, cola de guardados y recuperación de errores.                                                              |
| [src/components](./src/components/)                                  | Timeline, formas de onda con envolventes cacheadas, inspector, mezclador y diálogos accesibles.                                                                                             |

La reproducción no utiliza `setInterval` para disparar clips: todos los `AudioBufferSourceNode` se programan contra un mismo instante de `AudioContext.currentTime`. `requestAnimationFrame` actualiza únicamente interfaz y fin del transporte. El grabador inicia en un fotograma futuro de ese mismo contexto. Las ganancias se suavizan al cambiarlas. El render offline reutiliza las reglas de programación y el grafo de mezcla.

El proyecto usa el esquema 2. Al abrir un proyecto de esquema 1, sus pistas reciben una cadena vacía, conservando sus identificadores, archivos, clips y ajustes. IndexedDB migra a la versión 2 añadiendo únicamente un almacén de presets. Las configuraciones se validan antes de procesarlas: tipos conocidos, parámetros finitos, rangos acotados e identificadores únicos.

## Efectos de pista

El inspector permite añadir, eliminar, activar/desactivar y subir/bajar cada efecto. La cadena se procesa de arriba abajo. Los cambios se oyen durante reproducción y durante la reproducción de pistas existentes al grabar. **El micrófono se captura seco y no se monitoriza en directo**; al finalizar la toma, sus efectos se oyen al reproducir y se incluyen al exportar.

| Efecto                  | Procesamiento y controles                                                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EQ paramétrico          | Tres filtros de campana: frecuencia, ganancia ±18 dB y Q por banda.                                                                                                                                                                   |
| Compresor               | Detector de pico estéreo enlazado, umbral, ratio, ataque, relajación, knee suave, salida y Dry/Wet. Sin anticipación ni retardo fijo añadido; no es un limitador de picos.                                                            |
| Reverb                  | Convolución con respuesta de sala sintética y determinista, duración 0,2–5 s, amortiguación y Dry/Wet. Conserva el formato de canales de entrada; no genera una sala estéreo decorrelacionada desde una voz mono.                     |
| Delay                   | Tiempo 10–1000 ms, feedback 0–75 % y Dry/Wet. Lectura interpolada de un buffer circular en AudioWorklet; los ecos siguen el intervalo solicitado.                                                                                     |
| Paso alto / paso bajo   | Filtros de 12 dB/octava, corte 20–20.000 Hz y resonancia Q.                                                                                                                                                                           |
| Saturación / distorsión | Recorte suave / duro, sobremuestreo 4×, Drive, salida y Dry/Wet.                                                                                                                                                                      |
| De-esser                | Detector de banda alta con corte 2,5–10 kHz, umbral, ratio, reducción máxima y Dry/Wet. Compresión enlazada de la banda sibilante; ataque de 1 ms y relajación de 60 ms. No reconoce fonemas ni distingue sibilancia de otros agudos. |

Dry/Wet usa mezcla lineal: 0 % entrega audio seco y 100 % señal procesada. Bypass conserva todos los ajustes. Los cambios de parámetros se suavizan aproximadamente en 12 ms. La reverb agrupa cambios rápidos de duración durante 90 ms, y sustituye la respuesta mediante fundido. Al añadir, quitar o reordenar, se funden las cadenas sin reiniciar el transporte; se reinicia el estado interno de los procesadores. Pausar, buscar o editar la posición de clips también reinicia las memorias de efectos: no se reconstruyen ecos anteriores al cursor.

**Presets:** despliega «Presets de cadena», escribe un nombre y pulsa «Guardar cadena». En otra pista, selecciona el preset y pulsa «Cargar cadena». Cargar sustituye la cadena completa de esa pista; guarda antes una cadena que quieras conservar. Los parámetros, orden y bypass se copian con identificadores nuevos: editar la copia no modifica el preset ni otras pistas. Eliminar un preset no elimina las cadenas ya cargadas. Los presets son locales a este navegador/origen, sin sincronización en la nube.

**Niveles y recursos:** hasta 8 efectos por pista. El feedback está acotado para evitar inestabilidad. Las colas se calculan hasta aproximadamente −60 dB de feedback y se suman en cadenas en serie, con un máximo de 60 s adicionales y un fundido final de 30 ms, compartido por reproducción y exportación. Un gran número de pistas con convolución sigue consumiendo CPU. EQ, Drive o salida pueden elevar el nivel: vigila el master y baja ganancias si marca saturación. La exportación rechaza audio no finito o que supere 0 dBFS; no se aplica limitación ni normalización oculta.

Las implementaciones siguen el modelo de nodos, parámetros y AudioWorklet de la [especificación Web Audio](https://www.w3.org/TR/webaudio/). No se han incorporado dependencias de DSP ni autotune.

### Prueba manual recomendada

1. Abre un proyecto anterior, importa un beat y graba una voz. Comprueba que el original se conserva y que editar/guardar funciona.
2. En la voz, añade paso alto (80–120 Hz), EQ, compresor y de-esser. Ajusta el corte del de-esser sobre palabras con «s»; compara con bypass a un volumen parecido.
3. Añade reverb y delay. Reproduce hasta el final: deben seguir las colas. Prueba Dry/Wet a 0 %, 100 % y valores intermedios.
4. Cambia parámetros y orden durante reproducción. Comprueba ausencia de saltos del cursor, clicks repetidos o cortes sostenidos. Cambiar tiempo de delay puede provocar el cambio de tono natural de un eco variable.
5. Guarda un preset, cárgalo en otra pista, modifica la copia y recarga la página. Comprueba independencia y persistencia.
6. Exporta WAV y escúchalo fuera del navegador. Compara efectos, panorama, volumen, mute/solo y colas. Si se rechaza por saturación, baja el master y repite.
7. Prueba en tu interfaz de audio con auriculares y en un proyecto representativo: las pruebas automáticas usan tonos y un micrófono virtual, no evalúan el carácter musical ni la latencia de tu hardware.

## Comprobaciones

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run test:production
```

`npm run check` ejecuta TypeScript, lint sin advertencias, pruebas unitarias y compilación. `npm run format` aplica Prettier.

Las pruebas E2E usan **Google Chrome instalado** mediante Playwright, con un micrófono virtual del navegador. Si no tienes Chrome, instala el canal con `npx playwright install chrome`, o cambia `channel` en [playwright.config.ts](./playwright.config.ts). El servidor de desarrollo arranca automáticamente si no está activo.

- Pruebas unitarias: cabecera y muestras WAV, recortes y búsqueda, mute/solo, persistencia atómica con Blob y rollback, limpieza de archivos huérfanos y límites exactos del AudioWorklet, incluidos huecos silenciosos y vaciado del último bloque.
- E2E: importación WAV/MP3 y onda real, arrastre y recortes, transporte, captura PCM a través del AudioWorklet, recuperación tras recarga, varios proyectos y descarga WAV; permisos y archivo inválido; adaptación móvil y control de saturación. El recorrido completo también se comprueba contra la compilación de producción, incluido el archivo AudioWorklet emitido.
- Verificación de mezcla en Web Audio nativo: silencio previo, comienzo exacto, offset de origen, duración, panorámica, ganancias, mute/solo y cancelación de dos señales opuestas alineadas.

Los tonos generados y el micrófono virtual se utilizan **solo en las pruebas**. La aplicación inicia con una sesión vacía y solo muestra y reproduce audio importado o capturado.

## Límites de esta fase

- **Guardado local:** no existe sincronización ni copia del proyecto fuera del navegador. Borrar los datos del sitio, cambiar de perfil/origen o usar modo privado puede eliminar o aislar las sesiones. El guardado manual solicita almacenamiento persistente si está disponible; el navegador decide si lo concede. Exporta tus mezclas importantes. Un WAV final no es una copia editable del proyecto.
- **Grabación en curso:** queda en memoria hasta finalizar. Un cierre normal con cambios pendientes muestra la advertencia del navegador, pero un cierre forzado, fallo del proceso o pérdida de energía puede perder la toma en curso. Una interrupción detectable del dispositivo/contexto intenta finalizar y guardar el audio. Si falla el procesador, se recuperan los bloques recibidos y se avisa de que puede faltar el último bloque de hasta unos 0,35 segundos.
- **Latencia:** reproducción y captura comparten el reloj del motor, pero la entrada/salida física, Bluetooth y el sistema operativo introducen latencia. No hay calibración automática ni compensación de dispositivo; corrige una toma con su posición en el inspector. Se recomienda interfaz cableada y auriculares.
- **Memoria:** hasta 15 minutos de sesión, 100 MB por archivo y 256 MB de audio decodificado en memoria. La captura se detiene automáticamente al alcanzar el tiempo o la memoria restante. Exportar crea buffers adicionales; en equipos limitados, trabaja con sesiones más cortas.
- **Compatibilidad:** validado en Chrome de escritorio. Edge Chromium debería comportarse de forma equivalente; Firefox y Safari no se han verificado. Codecs adicionales, almacenamiento y captura dependen del navegador. En móvil el editor es adaptable, pero el sistema puede suspender audio al bloquear pantalla o cambiar de aplicación.
- **Tempo y edición:** BPM solo define la rejilla 4/4; no hay detección automática, time-stretch, metrónomo, cuantización del audio, loops, undo/redo ni comping. Las tomas superpuestas suenan juntas. El recorte no incorpora fades automáticos.
- **No incluido:** autotune, plugins externos, automatización temporal de parámetros, masterización automática, normalización y monitorización directa del micrófono.
