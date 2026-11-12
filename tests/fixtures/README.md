# Audio de prueba

`tone.mp3` contiene un tono original de 440 Hz, un segundo, mono, generado matemáticamente a 44.100 Hz y codificado a 128 kbps con lamejs 1.2.1. Amplitud PCM16: 6.000. No contiene material musical de terceros y solo se usa en pruebas; no se carga en la aplicación.

El WAV de las pruebas se genera directamente con el codificador del proyecto.

`microphone.wav` es un tono continuo original de 1.000 Hz, un segundo, mono PCM16 a 48 kHz y amplitud 0,15. Chrome lo reproduce en bucle como entrada virtual en las pruebas de monitorización. Evita que sus pitidos de prueba intermitentes se confundan con un fallo de nivel. La aplicación nunca carga este archivo.

Para regenerarlo desde la raíz del proyecto (Node con soporte de TypeScript):

```sh
node --input-type=module -e "import { writeFileSync } from 'node:fs'; import { encodeWav } from './src/audio/wav.ts'; const pcm = Float32Array.from({ length: 48000 }, (_, i) => 0.15 * Math.sin(2 * Math.PI * 1000 * i / 48000)); writeFileSync('tests/fixtures/microphone.wav', Buffer.from(encodeWav([pcm], 48000)));"
```
