# Afinación vocal de VOX Studio

## Alcance operativo

El efecto **Afinación vocal** corrige audio monofónico durante la reproducción de clips y el render WAV. No modifica los archivos originales ni cambia la velocidad de los clips. Se guarda en proyectos y presets con el resto de la cadena. Se admite un corrector por pista, dentro del límite de ocho efectos.

Los parámetros se pueden cambiar mientras suena una grabación. El micrófono **omite este efecto** durante la monitorización; los demás efectos siguen activos. Esta decisión evita añadir el retardo del análisis al cantante. La toma se registra seca y se afina al reproducirla. El procesador ya funciona por bloques en AudioWorklet, por lo que una futura modalidad de escucha podrá reutilizarlo, pero necesitará evaluar otra configuración de calidad/latencia.

## Alternativas evaluadas

| Alternativa                                                                        | Evaluación y licencia                                                                                                                                                                           |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Signalsmith Stretch](https://github.com/Signalsmith-Audio/signalsmith-stretch)    | Elegido: transformación espectral, compensación de formantes, retardos consultables y distribución WASM. [MIT](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/LICENSE.txt). |
| [Rubber Band](https://breakfastquay.com/rubberband/)                               | Motor C++ con doble licencia GPL/comercial. No se incorporó: requiere decidir la licencia de distribución y una integración WASM adicional.                                                     |
| [Phaze](https://github.com/olvb/phaze)                                             | Pitch shifter AudioWorklet bajo Unlicense. Necesitaría añadir detección, control de escala y tratamiento de formantes.                                                                          |
| PSOLA                                                                              | Buena candidata para voz aislada; implementar marcas de periodo y transiciones fiables implica otra fase de DSP. No se usa una implementación externa.                                          |
| [Pitchfinder](https://github.com/peterkhayes/pitchfinder/blob/master/package.json) | Su paquete declara GNU v3. No se ha copiado ni instalado su detector.                                                                                                                           |

El detector de VOX es una implementación propia del método [YIN, de Cheveigné y Kawahara, 2002](https://pubmed.ncbi.nlm.nih.gov/12002874/): diferencia temporal, normalización acumulativa, umbral de periodicidad e interpolación parabólica. La publicación describe el método; no se ha copiado código de una librería GPL.

## Procesamiento

1. Se filtra y diezma la señal para estimar F0 entre 70 y 1000 Hz. La ventana de análisis es de 4096 muestras de entrada; se actualiza cada 512 muestras. Silencio y señales sin periodicidad suficiente no reciben una nota objetivo.
2. F0 se convierte a nota MIDI con referencia La4 = 440 Hz. Se busca la nota permitida más cercana en la tonalidad y escala elegidas. Una histéresis de ocho cents reduce oscilaciones en las fronteras.
3. Amount escala la corrección. Retune Speed suaviza su evolución. Humanize conserva parte de las variaciones rápidas en notas sostenidas mediante una estimación lenta del centro tonal; no interpreta expresividad ni reconoce frases.
4. Signalsmith Stretch 1.3.2 aplica el desplazamiento espectral en WASM, con igual número de muestras de entrada y salida. Se activa su compensación de formantes y se proporciona F0 cuando es fiable. Bloque de síntesis: 4096; salto: 128 muestras. Se reutilizan buffers; no se envía audio al hilo de UI para calcular la afinación.
5. Dry/Wet mezcla linealmente dos rutas alineadas. Bypass conserva el retardo y los ajustes; no mueve el clip ni su posición audible.

Los modos son puntos de partida editables, no tres motores diferentes:

| Modo      | Retune | Amount | Humanize |
| --------- | -----: | -----: | -------: |
| Natural   |  90 ms |   90 % |     35 % |
| Modern    |  25 ms |  100 % |     10 % |
| Hard Tune |   0 ms |  100 % |      0 % |

Retune a cero significa la corrección más rápida del motor, no latencia cero. Cromática permite todas las notas; la tonalidad solo restringe notas en mayor o menor natural. Conviene colocar el corrector antes de reverb/delay y trabajar con una voz aislada.

## Sincronización y ciclo de vida

La configuración actual declara **4224 muestras de retardo: 88 ms a 48 kHz**. Se consulta al motor WASM; no es una medición de la interfaz de audio. Los canales con menos retardo reciben la diferencia mediante DelayNode. El cursor y el inicio de captura se anclan a la salida audible compensada. El render offline añade esas muestras al buffer y después las recorta del inicio del WAV. Su duración final y el tiempo del beat se conservan.

Buscar desde una posición intermedia precarga hasta 150 ms de audio anterior para estabilizar el detector, sin reproducir esa precarga. Añadir o quitar el corrector durante reproducción reprograma el transporte desde su posición actual y produce una breve espera de preparación. Durante una toma esas dos operaciones se bloquean; parámetros, bypass y orden siguen disponibles. Reordenar conserva el retardo y funde las cadenas después de llenar los nuevos buffers.

La adquisición del micrófono sigue siendo única. Monitorizar, grabar, reproducir y exportar no agregan una segunda copia audible de la cadena. Los nodos y puertos retirados se desconectan al cambiar la cadena o detener el transporte.

## Límites y pruebas

- Es corrección monofónica automática: no separa voces de un beat, no corrige acordes/coros mezclados y no decide la tonalidad de la canción.
- Ruido, voz susurrada, graves inferiores a 70 Hz, falsete superior a 1000 Hz, ataques rápidos y saltos de octava pueden impedir o confundir la detección.
- La compensación de formantes es aproximada. Cambios bruscos de nota, mezcla parcial Dry/Wet y correcciones fuertes pueden producir modulación o coloración. No sustituye una herramienta comercial ni ofrece edición manual por nota.
- Un gran número de correctores consume CPU. Validado en Chrome de escritorio; no hay garantía de rendimiento o compatibilidad en todos los dispositivos.
- Pruebas automáticas: detección con armónicos y ruido; las doce tonalidades; escalas, Amount, Humanize y modos; transformación nativa en AudioWorklet; bypass transparente; cambios de frecuencia durante playback; exportación con offsets, panorama y EQ; persistencia/presets; dos tomas secas con un único stream; reloj de captura compensado; bundle de producción.
- Señales de prueba de 112, 432, 450 y 890 Hz alcanzan sus objetivos con menos de 5 cents de error sostenido en esta configuración. Esto no mide la calidad perceptiva de voces reales.

Prueba manual: graba una frase con notas sostenidas, vibrato, consonantes y cambios rápidos. Selecciona la tonalidad real; compara Natural, Modern y Hard Tune con bypass. Ajusta Humanize y Amount, escucha consonantes y timbre, guarda/recarga el preset y compara el WAV fuera del navegador. Repite con tus auriculares, interfaz y número habitual de pistas.

## Distribución y mantenimiento

El binario está extraído, sin modificar DSP, del paquete npm fijado a 1.3.2. [El script de extracción](../scripts/extract-stretch.mjs) verifica versión, SHA256 e importaciones/exportaciones antes de escribirlo. Ejecutar `node scripts/extract-stretch.mjs` permite reproducirlo tras `npm install`. Cambiar de versión requiere auditar el adaptador ABI y volver a probar el retardo.

La [licencia MIT](../src/audio/vendor/signalsmith-LICENSE.txt) acompaña al binario en los assets de producción. No se descarga código DSP de una CDN en ejecución. La compilación WASM se comparte; cada efecto tiene su propia instancia y estado de audio.
