import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { encodeWav } from '../../src/audio/wav'

test('effects UI: live audio updates, independent presets, recording, recovery and processed WAV export', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Grabar', exact: true })).toBeEnabled()
  const pcm = Float32Array.from(
    { length: 48000 * 6 },
    (_, i) => 0.15 * Math.sin((i * Math.PI * 2 * 1000) / 48000),
  )
  await page.getByLabel('Seleccionar archivos de audio').setInputFiles({
    name: 'effects-tone.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from(encodeWav([pcm], 48000)),
  })
  const panel = page.getByRole('region', { name: 'Efectos de pista' })
  const add = async (type: string) => {
    await panel.getByLabel('Tipo de efecto', { exact: true }).selectOption(type)
    await panel.getByRole('button', { name: 'Añadir efecto', exact: true }).click()
  }
  await add('compressor')
  await panel.getByRole('spinbutton', { name: 'Ratio', exact: true }).fill('1')
  await add('eq')
  await panel.getByRole('spinbutton', { name: 'Medios · frecuencia', exact: true }).fill('1000')
  await page.getByRole('button', { name: 'Reproducir', exact: true }).click()
  const meter = page.getByRole('meter', { name: 'Nivel de salida master', exact: true })
  await expect
    .poll(async () => Number(await meter.getAttribute('aria-valuenow')))
    .toBeGreaterThan(-30)
  await panel.getByRole('spinbutton', { name: 'Medios · ganancia', exact: true }).fill('-18')
  await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow'))).toBeLessThan(-30)
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeEnabled()
  await expect(page.getByLabel('Posición de reproducción')).not.toHaveText('00:00.00')
  await panel
    .getByRole('group', { name: '2. EQ paramétrico', exact: true })
    .getByRole('button', { name: 'Subir efecto' })
    .click()
  await expect(panel.getByRole('group', { name: '1. EQ paramétrico', exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Desactivar EQ paramétrico', exact: true }).click()
  await expect
    .poll(async () => Number(await meter.getAttribute('aria-valuenow')))
    .toBeGreaterThan(-30)
  await panel.getByRole('button', { name: 'Activar EQ paramétrico', exact: true }).click()
  await page.getByRole('button', { name: 'Detener', exact: true }).click()

  await panel.getByText('Presets de cadena', { exact: true }).click()
  await panel.getByLabel('Nombre del preset', { exact: true }).fill('Voz prueba')
  await panel.getByRole('button', { name: 'Guardar cadena actual', exact: true }).click()
  await expect(panel.getByRole('status')).toHaveText('Cadena guardada como preset.')
  await page.getByRole('button', { name: 'Seleccionar Voz principal', exact: true }).click()
  await expect(panel.getByRole('group', { name: /^\d+\./ })).toHaveCount(0)
  await panel.getByText('Presets de cadena', { exact: true }).click()
  await panel.getByRole('button', { name: 'Voz prueba', exact: true }).click()
  await expect(panel.getByRole('group', { name: /^\d+\./ })).toHaveCount(2)
  await panel.getByRole('spinbutton', { name: 'Medios · ganancia', exact: true }).fill('-6')
  await page.getByRole('button', { name: 'Seleccionar Instrumental', exact: true }).click()
  await panel.getByRole('button', { name: '1. EQ paramétrico', exact: true }).click()
  await expect(
    panel.getByRole('spinbutton', { name: 'Medios · ganancia', exact: true }),
  ).toHaveValue('-18')
  await page.getByRole('button', { name: 'Seleccionar Voz principal', exact: true }).click()
  for (const type of ['reverb', 'delay', 'lowpass', 'saturation', 'distortion', 'deesser'])
    await add(type)
  await expect(panel.getByRole('button', { name: 'Añadir efecto', exact: true })).toBeDisabled()
  await panel.getByRole('button', { name: 'Desactivar Distorsión', exact: true }).click()
  await panel
    .getByRole('group', { name: '5. Paso bajo', exact: true })
    .getByRole('button', { name: 'Eliminar efecto' })
    .click()
  await expect(panel.getByRole('group', { name: /^\d+\./ })).toHaveCount(7)
  await page.getByRole('button', { name: 'Grabar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Finalizar grabación', exact: true })).toBeEnabled()
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: 'Finalizar grabación', exact: true }).click()
  await expect(page.getByRole('button', { name: /Clip Voz principal · Toma 1/ })).toBeVisible()
  await expect(page.getByText('Todos los cambios guardados', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Seleccionar Voz principal', exact: true }).click()
  await expect(panel.getByRole('group', { name: /^\d+\./ })).toHaveCount(7)
  await expect(
    panel.getByRole('button', { name: 'Activar Distorsión', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false')
  await panel.getByRole('button', { name: '1. EQ paramétrico', exact: true }).click()
  await expect(
    panel.getByRole('spinbutton', { name: 'Medios · ganancia', exact: true }),
  ).toHaveValue('-6')
  await panel.getByText('Presets de cadena', { exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Voz prueba', exact: true })).toBeVisible()
  await expect(panel.getByText('Presets incluidos', { exact: true })).toBeVisible()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar WAV', exact: true }).click()
  const bytes = await readFile((await (await download).path())!)
  expect(bytes.readUInt32LE(24)).toBe(48000)
  expect(bytes.readUInt32LE(40)).toBeGreaterThan(6 * 48000 * 4)
  expect(errors).toEqual([])
  await page.getByRole('button', { name: 'Cerrar aviso', exact: true }).click()
  await page.screenshot({ path: 'test-results/effects-inspector.png', fullPage: true })
})

test('effect tails and overload: playback continues past the clip and unsafe export is rejected', async ({
  page,
}) => {
  await page.goto('/')
  const pcm = Float32Array.from(
    { length: 4800 },
    (_, i) => 0.4 * Math.sin((2 * Math.PI * 1000 * i) / 48000),
  )
  await page.getByLabel('Seleccionar archivos de audio').setInputFiles({
    name: 'tail.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from(encodeWav([pcm], 48000)),
  })
  const panel = page.getByRole('region', { name: 'Efectos de pista' })
  await panel.getByLabel('Tipo de efecto', { exact: true }).selectOption('reverb')
  await panel.getByRole('button', { name: 'Añadir efecto', exact: true }).click()
  await panel.getByRole('spinbutton', { name: 'Duración', exact: true }).fill('1')
  await page.getByRole('button', { name: 'Reproducir', exact: true }).click()
  await expect
    .poll(async () => page.getByLabel('Posición de reproducción').textContent())
    .toMatch(/00:00\.[3-9]/)
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reproducir', exact: true })).toBeVisible()
  await expect(page.getByLabel('Posición de reproducción')).toHaveText('00:01.20')
  await panel.getByRole('button', { name: 'Eliminar efecto', exact: true }).click()
  await panel.getByLabel('Tipo de efecto', { exact: true }).selectOption('eq')
  await panel.getByRole('button', { name: 'Añadir efecto', exact: true }).click()
  await panel.getByRole('spinbutton', { name: 'Medios · frecuencia', exact: true }).fill('1000')
  await panel.getByRole('spinbutton', { name: 'Medios · ganancia', exact: true }).fill('18')
  await page.getByRole('button', { name: 'Exportar WAV', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('supera 0 dBFS')
  await page.getByRole('slider', { name: 'Volumen master', exact: true }).fill('0.05')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar WAV', exact: true }).click()
  const bytes = await readFile((await (await downloaded).path())!)
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF')
  expect(bytes.readUInt32LE(40)).toBeGreaterThan(4800 * 4)
})

test('live chain changes release pending reverb nodes and keep the source clock running', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  const pcm = Float32Array.from(
    { length: 48000 * 15 },
    (_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / 48000),
  )
  await page.getByLabel('Seleccionar archivos de audio').setInputFiles({
    name: 'live.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from(encodeWav([pcm], 48000)),
  })
  await page.getByRole('button', { name: 'Reproducir', exact: true }).click()
  const position = page.getByLabel('Posición de reproducción')
  await expect(position).not.toHaveText('00:00.00')
  const panel = page.getByRole('region', { name: 'Efectos de pista' })
  const add = async (type: string) => {
    await panel.getByLabel('Tipo de efecto', { exact: true }).selectOption(type)
    await panel.getByRole('button', { name: 'Añadir efecto', exact: true }).click()
  }
  await add('reverb')
  await panel.getByRole('slider', { name: 'Duración: deslizador', exact: true }).fill('5')
  await panel.getByRole('slider', { name: 'Duración: deslizador', exact: true }).fill('0.2')
  await panel.getByRole('button', { name: 'Eliminar efecto', exact: true }).click()
  await add('delay')
  await panel.getByRole('slider', { name: 'Tiempo: deslizador', exact: true }).fill('600')
  await panel.getByRole('slider', { name: 'Tiempo: deslizador', exact: true }).fill('150')
  await add('compressor')
  await add('deesser')
  const before = (await position.textContent())!
  await panel
    .getByRole('group', { name: '3. De-esser', exact: true })
    .getByRole('button', { name: 'Subir efecto', exact: true })
    .click()
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeEnabled()
  await expect.poll(async () => (await position.textContent())! > before).toBe(true)
  await expect
    .poll(async () =>
      Number(
        await page
          .getByRole('meter', { name: 'Nivel de salida master' })
          .getAttribute('aria-valuenow'),
      ),
    )
    .toBeGreaterThan(-55)
  await page.getByRole('button', { name: 'Detener', exact: true }).click()
  await page.waitForTimeout(200)
  expect(errors).toEqual([])
})
