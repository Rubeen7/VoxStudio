# VOX Studio

Estudio web de grabación vocal sobre beats, desarrollado con React, TypeScript y Vite. La primera fase funciona íntegramente en el navegador: Web Audio para reproducir y mezclar, AudioWorklet para capturar PCM e IndexedDB para conservar proyectos y grabaciones. No requiere cuentas, claves, backend ni servicios externos. Las tipografías se sirven localmente.

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
- Exportación de la sesión completa como **WAV estéreo, PCM de 16 bits, 48 kHz**, desde el segundo cero hasta el final del último clip. Incluye posiciones, recortes, volumen, panorama, mute, solo y master. Incluye el silencio inicial si los clips empiezan después de cero.
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

| Módulo                                                           | Responsabilidad                                                                                                                                                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/model/project.ts](./src/model/project.ts)                   | Modelo versionado de proyectos, pistas y clips; cálculo compartido de ventanas de reproducción y audibilidad. Las posiciones están en segundos, los recortes referencian el audio original.        |
| [src/audio/AudioEngine.ts](./src/audio/AudioEngine.ts)           | Un contexto de audio, caché de buffers, transporte, adquisición/liberación del micrófono, medidores y render offline.                                                                              |
| [src/audio/recorder.worklet.js](./src/audio/recorder.worklet.js) | Captura en el hilo de audio. Inicio y límite en fotogramas del mismo reloj que la reproducción; bloques PCM transferibles y salida silenciosa.                                                     |
| [src/audio/graph.ts](./src/audio/graph.ts)                       | Grafo común por pista para reproducción y exportación. `EffectFactory` y `EffectNode` definen un punto de extensión con liberación explícita de recursos. No se activa ningún efecto en esta fase. |
| [src/audio/wav.ts](./src/audio/wav.ts)                           | Codificación PCM16 intercalada y descarga con revocación de URL.                                                                                                                                   |
| [src/storage/projects.ts](./src/storage/projects.ts)             | IndexedDB versionado con `idb`. Proyecto y archivos referenciados se escriben en una transacción atómica; los fallos no reemplazan el guardado anterior. Limpieza de audios huérfanos.             |
| [src/hooks/useStudio.ts](./src/hooks/useStudio.ts)               | Coordinación de UI, audio y persistencia; exclusión de operaciones incompatibles, cola de guardados y recuperación de errores.                                                                     |
| [src/components](./src/components/)                              | Timeline, formas de onda con envolventes cacheadas, inspector, mezclador y diálogos accesibles.                                                                                                    |

La reproducción no utiliza `setInterval` para disparar clips: todos los `AudioBufferSourceNode` se programan contra un mismo instante de `AudioContext.currentTime`. `requestAnimationFrame` actualiza únicamente interfaz y fin del transporte. El grabador inicia en un fotograma futuro de ese mismo contexto. Las ganancias se suavizan al cambiarlas. El render offline reutiliza las reglas de programación y el grafo de mezcla.

Para añadir efectos en una fase futura: implementar factorías compatibles con `BaseAudioContext`, incorporar sus parámetros al modelo con migración de esquema y usarlas tanto en el grafo en vivo como en el offline. Autotune con procesamiento de tono y latencia necesitará además compensación explícita, AudioWorklet y pruebas de alineación. No se han añadido dependencias ni controles de efectos anticipadamente.

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
- **Sin efectos avanzados:** no hay autotune, efectos vocales, plugins externos, masterización automática ni normalización. No se han simulado estas funciones.
