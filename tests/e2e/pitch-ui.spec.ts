import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { encodeWav } from '../../src/audio/wav'

test('pitch UI: live controls, presets, project recovery and corrected downloadable WAV', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  const pcm = Float32Array.from(
    { length: 48000 * 8 },
    (_, i) => 0.15 * Math.sin((2 * Math.PI * 450 * i) / 48000),
  )
  await page.getByLabel('Seleccionar archivos de audio').setInputFiles({
    name: 'voz-desafinada.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from(encodeWav([pcm], 48000)),
  })
  const panel = page.getByRole('region', { name: 'Efectos de pista' })
  await page.getByRole('button', { name: 'Reproducir', exact: true }).click()
  await panel.getByLabel('Tipo de efecto', { exact: true }).selectOption('autotune')
  await panel.getByRole('button', { name: 'Añadir efecto', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Añadir efecto', exact: true })).toBeDisabled()
  await panel.getByLabel('Tonalidad', { exact: true }).selectOption('9')
  await panel.getByLabel('Escala', { exact: true }).selectOption('0')
  await panel.getByLabel('Modo · punto de partida', { exact: true }).selectOption('2')
  await expect(panel.getByRole('spinbutton', { name: 'Retune Speed', exact: true })).toHaveValue(
    '0',
  )
  await expect(panel.getByRole('spinbutton', { name: 'Humanize', exact: true })).toHaveValue('0')
  await expect(panel.getByText('La · Mayor · Reproducción / WAV', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Desactivar Afinación vocal', exact: true }).click()
  await panel.getByRole('button', { name: 'Activar Afinación vocal', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pausar', exact: true })).toBeVisible()
  await expect
    .poll(async () =>
      Number(
        await page
          .getByRole('meter', { name: 'Nivel de salida master', exact: true })
          .getAttribute('aria-valuenow'),
      ),
    )
    .toBeGreaterThan(-35)
  await page.getByRole('button', { name: 'Detener', exact: true }).click()
  await panel.getByText('Presets de cadena', { exact: true }).click()
  await panel.getByLabel('Nombre del preset', { exact: true }).fill('Voz Hard Tune La')
  await panel.getByRole('button', { name: 'Guardar cadena actual', exact: true }).click()
  await expect(panel.getByRole('status')).toHaveText('Cadena guardada como preset.')
  await page.getByRole('button', { name: 'Seleccionar Voz principal', exact: true }).click()
  await panel.getByText('Presets de cadena', { exact: true }).click()
  await panel.getByRole('button', { name: 'Voz Hard Tune La', exact: true }).click()
  await expect(panel.getByLabel('Tonalidad', { exact: true })).toHaveValue('9')
  await expect(page.getByText(/La escucha del micrófono conserva/)).toBeVisible()
  await page.getByRole('button', { name: 'Grabar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Finalizar grabación', exact: true })).toBeEnabled()
  await expect(panel.getByRole('button', { name: 'Eliminar efecto', exact: true })).toBeDisabled()
  await expect(panel.getByLabel('Tonalidad', { exact: true })).toBeEnabled()
  await page.waitForTimeout(450)
  await page.getByRole('button', { name: 'Finalizar grabación', exact: true }).click()
  // Keep the exported sine isolated from the fake microphone recording.
  await page.getByRole('button', { name: 'Seleccionar Instrumental', exact: true }).click()
  await expect(page.getByText('Todos los cambios guardados', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Seleccionar Instrumental', exact: true }).click()
  await panel.getByRole('button', { name: '1. Afinación vocal', exact: true }).click()
  await expect(panel.getByLabel('Escala', { exact: true })).toHaveValue('0')
  await expect(panel.getByRole('spinbutton', { name: 'Retune Speed', exact: true })).toHaveValue(
    '0',
  )
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar WAV', exact: true }).click()
  const bytes = await readFile((await (await download).path())!)
  expect(bytes.readUInt32LE(24)).toBe(48000)
  expect(bytes.readUInt32LE(40)).toBe(8 * 48000 * 4)
  const crossings: number[] = []
  for (let i = 48000 * 3; i < 48000 * 4; i++) {
    const a = bytes.readInt16LE(44 + i * 4),
      b = bytes.readInt16LE(44 + (i + 1) * 4)
    if (a <= 0 && b > 0) crossings.push(i - a / (b - a))
  }
  expect(((crossings.length - 1) * 48000) / (crossings.at(-1)! - crossings[0])).toBeCloseTo(440, 0)
  expect(errors).toEqual([])
  await panel.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/pitch-inspector.png', fullPage: true })
})
