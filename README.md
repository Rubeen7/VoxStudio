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
- Grabación **mono PCM a 48 kHz** desde el micrófono seleccionado, con permiso explícito del navegador. El beat y las voces existentes se reproducen durante la captura. Monitorización opcional con efectos, independiente de la grabación y desactivada por defecto.
- Pistas iniciales de instrumental, voz principal, dobles, coros y ad-libs. Se pueden añadir más pistas de cualquiera de estos tipos y renombrarlas.
- Formas de onda calculadas a partir de las muestras reales. Durante la captura se muestra la región en curso y el medidor de entrada; la onda completa aparece al finalizar.
- Volumen por pista, mute, solo, panorama y volumen master. Medidores reales de micrófono y master. Los clips superpuestos se suman.
- Movimiento temporal mediante arrastre, flechas o campo numérico. Rejilla opcional de semicorcheas; Mayús omite el ajuste al arrastrar y permite pasos de 10 ms con las flechas.
- Recorte reversible de inicio y duración desde el inspector, fades de entrada y salida con tiradores sobre el clip y menú contextual para renombrar el clip o ajustar su volumen. Eliminación de clips con deshacer/rehacer de hasta 50 pasos. Los audios originales se conservan en el guardado local aunque ningún clip los referencie.
- Autoguardado tras 600 ms sin cambios, guardado inmediato al terminar una toma o importación, guardado manual y biblioteca de proyectos. Se restaura la última sesión al abrir la aplicación.
- Exportación de la sesión completa como **WAV estéreo, PCM de 16 bits, 48 kHz**, desde el segundo cero hasta el final de los clips y las colas de efectos. Incluye posiciones, recortes, efectos, volumen, panorama, mute, solo y master. Incluye el silencio inicial si los clips empiezan después de cero.
- Detección de saturación al exportar: si las muestras superan 0 dBFS, se solicita bajar niveles. No se aplica normalización, limitación ni masterización automática.
- Mensajes para permisos denegados, dispositivos ausentes u ocupados, archivos inválidos y errores de almacenamiento. Las operaciones incompatibles se bloquean durante captura, importación y exportación.

## Flujo recomendado

1. Importa el beat. El primer archivo se coloca en la pista Instrumental si está vacía; en caso contrario se usa la pista seleccionada. En una importación múltiple, los archivos adicionales crean pistas de instrumental. La importación usa la posición del cursor.
2. Ponte auriculares y selecciona **Voz principal**. El botón de auriculares activa la escucha con efectos, incluso sin grabar. Pulsa **Grabar** para capturar la voz seca. En el inspector, «Dispositivo y latencia» permite elegir entrada y preferencia de latencia con el transporte detenido y la escucha apagada.
3. Pulsa **Finalizar** para conservar la toma y el cursor, o **Detener** para conservarla y volver al inicio. Selecciona Dobles, Coros o Ad-libs para grabar nuevas capas.
4. Selecciona un clip y ajusta inicio, duración y recorte. Usa el mezclador y el inspector para equilibrar niveles. M silencia, S aísla; mute prevalece sobre solo.
5. Espera a «Todos los cambios guardados». Abre **Proyectos** para crear o recuperar sesiones. **Exportar WAV** descarga la mezcla.

Atajos fuera de los campos de edición: **Espacio** reproducir/pausar, **R** grabar/finalizar, **S** cortar en el cursor, **M** marcador en el cursor, **Inicio** volver a cero, **Supr** eliminar clips, **Ctrl/Cmd + C/V/D/X** copiar, pegar, duplicar y cortar, **Ctrl/Cmd + Z/Y** deshacer y rehacer, **Ctrl/Cmd + A** seleccionar todos los clips visibles, **+/-** zoom del timeline y **Ctrl/Cmd + S** guardar. Mayús al arrastrar omite el ajuste a la rejilla; Ctrl/Cmd + clic añade clips a la selección. Cuando un botón tiene el foco, Espacio conserva su activación nativa. Los diálogos permiten cerrar con Escape y retienen el foco.

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
| [src/components/EffectsPanel.tsx](./src/components/EffectsPanel.tsx) | Controles de efectos por pista, bypass, orden, presets de fábrica y presets guardados por el usuario.                                                                                       |
| [src/audio/wav.ts](./src/audio/wav.ts)                               | Codificación PCM16 intercalada y descarga con revocación de URL.                                                                                                                            |
| [src/storage/projects.ts](./src/storage/projects.ts)                 | IndexedDB versionado con `idb`. Proyecto, audio e historial se escriben en una transacción atómica; los fallos no reemplazan el guardado anterior. Los audios originales se conservan aunque ningún clip los referencie. |
| [src/hooks/useStudio.ts](./src/hooks/useStudio.ts)                   | Coordinación de UI, audio y persistencia; exclusión de operaciones incompatibles, cola de guardados y recuperación de errores.                                                              |
| [src/components](./src/components/)                                  | Timeline, formas de onda con envolventes cacheadas, inspector, mezclador y diálogos accesibles.                                                                                             |

La reproducción no utiliza `setInterval` para disparar clips: todos los `AudioBufferSourceNode` se programan contra un mismo instante de `AudioContext.currentTime`. `requestAnimationFrame` actualiza únicamente interfaz y fin del transporte. El grabador inicia en un fotograma futuro de ese mismo contexto. Las ganancias se suavizan al cambiarlas. El render offline reutiliza las reglas de programación y el grafo de mezcla.

El proyecto usa el esquema 3. Al abrir un proyecto de esquema 1 o 2, sus pistas reciben una cadena de efectos normalizada y se conservan sus identificadores, archivos, clips, marcadores y ajustes de mezcla. IndexedDB migra a la versión 3 añadiendo los almacenes de presets e historial de deshacer. Las configuraciones se validan antes de procesarlas: tipos conocidos, parámetros finitos, rangos acotados e identificadores únicos.

## Efectos de pista

El inspector permite añadir, eliminar, activar/desactivar y subir/bajar cada efecto. La cadena se procesa de arriba abajo. Los cambios se oyen durante reproducción y en la monitorización del micrófono si está activada, excepto la afinación vocal, que se aplica solo a clips y exportación. **El micrófono se captura seco**, sin modificar el archivo original.

| Efecto                  | Procesamiento y controles                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EQ paramétrico          | Tres filtros de campana: frecuencia, ganancia ±18 dB y Q por banda.                                                                                                                                                                               |
| Compresor               | Detector de pico estéreo enlazado, umbral, ratio, ataque, relajación, knee suave, salida y Dry/Wet. Sin anticipación ni retardo fijo añadido; no es un limitador de picos.                                                                        |
| Reverb                  | Convolución con respuesta de sala sintética y determinista, duración 0,2–5 s, amortiguación y Dry/Wet. Conserva el formato de canales de entrada; no genera una sala estéreo decorrelacionada desde una voz mono.                                 |
| Delay                   | Tiempo 10–1000 ms, feedback 0–75 % y Dry/Wet. Lectura interpolada de un buffer circular en AudioWorklet; los ecos siguen el intervalo solicitado.                                                                                                 |
| Paso alto / paso bajo   | Filtros de 12 dB/octava, corte 20–20.000 Hz y resonancia Q.                                                                                                                                                                                       |
| Saturación / distorsión | Recorte suave / duro, sobremuestreo 4×, Drive, salida y Dry/Wet.                                                                                                                                                                                  |
| De-esser                | Detector de banda alta con corte 2,5–10 kHz, umbral, ratio, reducción máxima y Dry/Wet. Compresión enlazada de la banda sibilante; ataque de 1 ms y relajación de 60 ms. No reconoce fonemas ni distingue sibilancia de otros agudos.             |
| Afinación vocal         | Detección YIN y corrección espectral WASM con Signalsmith Stretch. Doce tonalidades, mayor/menor natural/cromática, Natural/Modern/Hard Tune, Retune Speed, Amount, Humanize y Dry/Wet. Reproducción y WAV; se omite en la escucha del micrófono. |

Dry/Wet usa mezcla lineal: 0 % entrega audio seco y 100 % señal procesada. Bypass conserva todos los ajustes. Los cambios continuos de parámetros se suavizan aproximadamente en 12 ms. La reverb agrupa cambios rápidos de duración durante 90 ms, y sustituye la respuesta mediante fundido. Al modificar el orden se funden las cadenas y se reinicia su estado interno. Añadir o quitar afinación reprograma la reproducción con una breve espera para compensar su retardo; se bloquea durante una toma. Pausar, buscar o editar la posición de clips también reinicia las memorias: no se reconstruyen colas largas anteriores al cursor.

**Presets:** «Presets incluidos» reúne cadenas de fábrica (voz limpia, cálida, rap, aérea, autotune, dobles y beat sin efectos). Para crear uno propio, despliega «Presets de cadena», escribe un nombre y pulsa «Guardar cadena actual». Cada preset de usuario se puede renombrar, duplicar o eliminar con sus botones. Pulsa el nombre de cualquier preset para cargarlo en la pista seleccionada: sustituye la cadena completa, así que guarda antes una cadena que quieras conservar. Los parámetros, orden y bypass se copian con identificadores nuevos: editar la copia no modifica el preset ni otras pistas. Eliminar un preset no elimina las cadenas ya cargadas. Los presets de usuario son locales a este navegador/origen, sin sincronización en la nube.

**Niveles y recursos:** hasta 8 efectos por pista. El feedback está acotado para evitar inestabilidad. Las colas se calculan hasta aproximadamente −60 dB de feedback y se suman en cadenas en serie, con un máximo de 60 s adicionales y un fundido final de 30 ms, compartido por reproducción y exportación. Un gran número de pistas con convolución sigue consumiendo CPU. EQ, Drive o salida pueden elevar el nivel: vigila el master y baja ganancias si marca saturación. La exportación rechaza audio no finito o que supere 0 dBFS; no se aplica limitación ni normalización oculta.

Las implementaciones siguen el modelo de nodos, parámetros y AudioWorklet de la [especificación Web Audio](https://www.w3.org/TR/webaudio/). La afinación incorpora Signalsmith Stretch 1.3.2 bajo MIT. Consulta [algoritmo, alternativas, sincronización, licencia y límites](./docs/pitch-correction.md).

**Afinación vocal:** añade un corrector por pista desde el inspector, selecciona tonalidad/escala y compara los tres modos. Los modos cargan valores editables de Retune, Amount y Humanize. Trabaja con voces aisladas y coloca el efecto antes de reverb/delay. La detección cubre 70–1000 Hz; la conservación de formantes es aproximada. Se compensan 4224 muestras (88 ms a 48 kHz) en las demás pistas y se recorta ese retardo del WAV. No se compensa la latencia física de tu dispositivo. Los parámetros se oyen al cambiarlos durante reproducción; el micrófono omite este corrector para conservar la respuesta de escucha existente.

### Prueba manual recomendada

1. Abre un proyecto anterior, importa un beat y graba una voz. Comprueba que el original se conserva y que editar/guardar funciona.
2. En la voz, añade paso alto (80–120 Hz), EQ, compresor y de-esser. Ajusta el corte del de-esser sobre palabras con «s»; compara con bypass a un volumen parecido.
3. Añade reverb y delay. Reproduce hasta el final: deben seguir las colas. Prueba Dry/Wet a 0 %, 100 % y valores intermedios.
4. Cambia parámetros y orden durante reproducción. Comprueba ausencia de saltos del cursor, clicks repetidos o cortes sostenidos. Cambiar tiempo de delay puede provocar el cambio de tono natural de un eco variable.
5. Guarda un preset, cárgalo en otra pista, modifica la copia y recarga la página. Comprueba independencia y persistencia.
6. Exporta WAV y escúchalo fuera del navegador. Compara efectos, panorama, volumen, mute/solo y colas. Si se rechaza por saturación, baja el master y repite.
7. Prueba en tu interfaz de audio con auriculares y en un proyecto representativo: las pruebas automáticas usan tonos y un micrófono virtual, no evalúan el carácter musical ni la latencia de tu hardware.

## Monitorización en tiempo real

- Activa el botón de auriculares de una pista vocal. El primer uso de cada apertura muestra el aviso de auriculares y acoples antes de solicitar el micrófono. El navegador no permite detectar de forma fiable si hay auriculares o altavoces; el aviso no pretende identificar el dispositivo de salida.
- Solo una pista monitoriza la entrada. Activar otra transfiere la escucha; seleccionar una pista por sí solo no cambia la ruta. Si grabas en otra pista con la escucha encendida, esta sigue a la pista de grabación. Durante una toma, los botones de escucha de otras pistas quedan bloqueados.
- Finalizar, pausar o detener conserva la escucha si estaba encendida. Apagarla mientras grabas conserva la captura; finalizar la toma con la escucha apagada libera el micrófono. Cambiar de proyecto, cerrar la página, desconectar la entrada o suspenderse el contexto apaga la escucha. Una petición de permiso pendiente puede cancelarse desde la barra inferior; cualquier stream entregado después se cierra.
- El medidor de entrada muestra la señal mono seca. El volumen de monitorización se aplica **después** de efectos, volumen/panorama de pista y mute/solo, antes del master. No cambia el nivel grabado, los clips ni el WAV exportado. Ponerlo a cero no libera el micrófono: usa el botón de escucha.
- «Dispositivo y latencia» enumera las entradas admitidas por el navegador. Los nombres pueden estar ocultos hasta conceder permiso. Una entrada específica desaparecida produce un error; no se cambia de micrófono silenciosamente. La opción predeterminada sigue la elección del sistema.
- La preferencia «Baja · interactiva» solicita `latencyHint: 'interactive'` y, si se admite, una latencia de entrada ideal de 10 ms. «Equilibrada» solicita `balanced` y 40 ms de entrada. Son preferencias, no garantías ni tamaños de buffer impuestos. Cambiar la preferencia recrea el contexto de audio únicamente sin reproducción ni entrada activas y conserva los buffers y proyectos. Estos ajustes de dispositivo/escucha son de la sesión de la pestaña; nunca restauran automáticamente el micrófono.
- Se muestran `getSettings().latency`, `baseLatency` y `outputLatency` solo cuando son números comunicados por el navegador. **No se suman ni se presentan como latencia total medida.** No incluyen necesariamente todo el recorrido físico o los retardos de cada efecto. Véanse [Web Audio](https://www.w3.org/TR/webaudio/) y [Media Capture](https://www.w3.org/TR/mediacapture-streams/).

La entrada compartida se administra en [MicrophoneInput](./src/audio/MicrophoneInput.ts): un único stream → conversión mono → medidor y dos destinos. El grabador recibe PCM seco y produce una salida silenciosa. La escucha usa una sola instancia de [createTrackChannel](./src/audio/graph.ts), la misma factoría DSP utilizada por reproducción y exportación, y una ganancia posterior propia. No hay una segunda implementación de efectos ni una conexión seca audible en paralelo. Las voces ya grabadas se procesan en sus canales de reproducción; el micrófono nunca entra en el render offline. El fundido final del transporte está antes del master y fuera de la ruta de escucha.

Activar/desactivar la escucha y cambiar de pista utiliza fundidos breves; los cambios de parámetros conservan el suavizado existente. Cambiar el destino de escucha reinicia la memoria de sus efectos. La captura y el beat mantienen el mismo reloj y fotograma de inicio, independientemente de la escucha. **No hay compensación automática de latencia física ni detección de la monitorización directa del hardware.** Desactiva esta última si utilizas la escucha de VOX, para evitar una voz duplicada. Bluetooth, equipos saturados o muchos efectos pueden producir un retardo perceptible; usar una interfaz cableada y reducir efectos ayuda, pero no se promete latencia cero ni ausencia universal de cortes.

Prueba manual con tu equipo:

1. Con auriculares y monitorización directa del hardware apagada, activa la escucha sin grabar. Comprueba nivel de entrada, volumen independiente y cambios de EQ, compresión, reverb y delay.
2. Reproduce un beat y graba dos tomas. Apaga y enciende la escucha durante una toma: el archivo debe seguir grabándose seco, sin saltos de posición. Comprueba que no aumenta el volumen al repetir tomas.
3. Transfiere la escucha a otra pista, prueba mute/solo y finaliza/detén el transporte. La escucha debe seguir activa hasta apagar su botón.
4. Con todo detenido y el micrófono apagado, selecciona otra entrada y compara las dos preferencias de latencia. Los valores informados pueden no variar; evalúa el retardo con tu propia voz y tu dispositivo.
5. Guarda, recarga y cambia de proyecto: efectos y clips deben conservarse y la escucha permanecer apagada. Exporta con escucha activada y comprueba que el WAV solo contiene los clips.
6. Deniega el permiso o desconecta el dispositivo durante una toma. Debe mostrarse el estado/error correspondiente, conservarse el audio recuperable y permitir reactivar la entrada explícitamente.

Las pruebas automatizadas comprueban cambios reales de amplitud por EQ, captura seca, beat y voz simultáneos, independencia del reloj, igualdad del WAV con/sin escucha, una sola adquisición durante múltiples tomas y cambios de pista, liberación del stream, permiso tardío cancelado, suspensión y recuperación ante desconexión. La calidad perceptiva, latencia física y comportamiento de cada controlador requieren la prueba manual.

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

- Pruebas unitarias: cabecera y muestras WAV, recortes y búsqueda, mute/solo, persistencia atómica con Blob y rollback, conservación de los audios originales, edición no destructiva (recorte, división de tomas, movimiento entre pistas, duplicado, fades y snap), presets de fábrica y de usuario, y límites exactos del AudioWorklet, incluidos huecos silenciosos y vaciado del último bloque.
- E2E: importación WAV/MP3 y onda real, arrastre y recortes, transporte, captura PCM a través del AudioWorklet, recuperación tras recarga, varios proyectos y descarga WAV; permisos y archivo inválido; adaptación móvil y control de saturación. El recorrido completo también se comprueba contra la compilación de producción, incluido el archivo AudioWorklet emitido.
- Verificación de mezcla en Web Audio nativo: silencio previo, comienzo exacto, offset de origen, duración, panorámica, ganancias, mute/solo y cancelación de dos señales opuestas alineadas.

Los tonos generados y el micrófono virtual se utilizan **solo en las pruebas**. La aplicación inicia con una sesión vacía y solo muestra y reproduce audio importado o capturado.

## Límites de esta fase

- **Guardado local:** no existe sincronización ni copia del proyecto fuera del navegador. Borrar los datos del sitio, cambiar de perfil/origen o usar modo privado puede eliminar o aislar las sesiones. El guardado manual solicita almacenamiento persistente si está disponible; el navegador decide si lo concede. Exporta tus mezclas importantes. Un WAV final no es una copia editable del proyecto.
- **Grabación en curso:** queda en memoria hasta finalizar. Un cierre normal con cambios pendientes muestra la advertencia del navegador, pero un cierre forzado, fallo del proceso o pérdida de energía puede perder la toma en curso. Una interrupción detectable del dispositivo/contexto intenta finalizar y guardar el audio. Si falla el procesador, se recuperan los bloques recibidos y se avisa de que puede faltar el último bloque de hasta unos 0,35 segundos.
- **Latencia:** reproducción y captura comparten el reloj del motor, pero la entrada/salida física, Bluetooth y el sistema operativo introducen latencia. No hay calibración automática ni compensación de dispositivo; corrige una toma con su posición en el inspector. Se recomienda interfaz cableada y auriculares.
- **Memoria:** hasta 15 minutos de sesión, 100 MB por archivo y 256 MB de audio decodificado en memoria. La captura se detiene automáticamente al alcanzar el tiempo o la memoria restante. Exportar crea buffers adicionales; en equipos limitados, trabaja con sesiones más cortas.
- **Compatibilidad:** validado en Chrome de escritorio. Edge Chromium debería comportarse de forma equivalente; Firefox y Safari no se han verificado. Codecs adicionales, almacenamiento y captura dependen del navegador. En móvil el editor es adaptable, pero el sistema puede suspender audio al bloquear pantalla o cambiar de aplicación.
- **Tempo y edición:** BPM solo define la rejilla 4/4; no hay detección automática, time-stretch, metrónomo, cuantización del audio, loops ni comping. Las tomas superpuestas suenan juntas. Los fades son manuales (tiradores o inspector), no automáticos.
- **No incluido:** afinación durante monitorización del micrófono, edición manual por nota, corrección polifónica, plugins externos, automatización temporal de parámetros, masterización automática, normalización, selección de dispositivo de salida y compensación automática de latencia física.
