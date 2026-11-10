import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { encodeWav } from '../../src/audio/wav'

function beatFile() {
  const sampleRate = 48000
  const pcm = Float32Array.from(
    { length: sampleRate * 4 },
    (_, i) => Math.sin((i / sampleRate) * Math.PI * 2 * 220) * 0.18,
  )
  return {
    name: 'beat-test.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from(encodeWav([pcm], sampleRate)),
  }
}

test('import, edit, transport, microphone, local recovery, export and multiple projects', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Grabar', exact: true })).toBeEnabled()
  await page.getByRole('textbox', { name: 'Nombre del proyecto' }).fill('Sesión de prueba')
  await page.getByLabel('Seleccionar archivos de audio').setInputFiles(beatFile())
  await expect(page.getByRole('button', { name: /Clip beat-test/ })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Forma de onda del audio' }).first()).toBeVisible()
  await page.getByRole('spinbutton', { name: 'Inicio en sesión', exact: true }).fill('1')
  await page.getByRole('spinbutton', { name: 'Recorte inicial' }).fill('0.25')
  await page.getByRole('spinbutton', { name: 'Duración del clip' }).fill('2')
  const clip = page.getByRole('button', { name: /Clip beat-test/ })
  const bounds = (await clip.boundingBox())!
  await page.mouse.move(bounds.x + 20, bounds.y + 15)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 62, bounds.y + 15, { steps: 6 })
  await page.mouse.up()
  await expect(page.getByRole('spinbutton', { name: 'Inicio en sesión', exact: true })).toHaveValue(
    '2',
  )
  await page.getByRole('button', { name: 'Silenciar Instrumental', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Silenciar Instrumental', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Silenciar Instrumental', exact: true }).click()
  await page.getByRole('button', { name: 'Reproducir', exact: true }).click()
  await expect
    .poll(async () => page.getByLabel('Posición de reproducción').textContent())
    .not.toBe('00:00.00')
  await page.getByRole('button', { name: 'Pausar', exact: true }).click()
  const paused = await page.getByLabel('Posición de reproducción').textContent()
  await page.waitForTimeout(200)
  await expect(page.getByLabel('Posición de reproducción')).toHaveText(paused!)
  await page.getByRole('spinbutton', { name: 'Ir a segundo' }).fill('1.5')
  await expect(page.getByLabel('Posición de reproducción')).toHaveText('00:01.50')
  await page.getByRole('button', { name: 'Seleccionar Voz principal', exact: true }).click()
  await page.getByRole('button', { name: 'Grabar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Finalizar grabación' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Importar audio', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Reproducir', exact: true })).toBeDisabled()
  await page.waitForTimeout(850)
  await page.getByRole('button', { name: 'Finalizar grabación' }).click()
  await expect(page.getByRole('button', { name: /Clip Voz principal · Toma 1/ })).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Inicio en sesión', exact: true })).toHaveValue(
    '1.5',
  )
  expect(
    Number(await page.getByRole('spinbutton', { name: 'Duración del clip' }).inputValue()),
  ).toBeGreaterThan(0.5)
  await expect(page.getByText('Todos los cambios guardados', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: /Clip Voz principal · Toma 1/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Clip beat-test/ })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Nombre del proyecto' })).toHaveValue(
    'Sesión de prueba',
  )
  await page.getByRole('button', { name: 'Detener', exact: true }).click()
  await expect(page.getByLabel('Posición de reproducción')).toHaveText('00:00.00')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar WAV', exact: true }).click()
  const download = await downloadPromise
  const bytes = await readFile((await download.path())!)
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF')
  expect(bytes.readUInt16LE(22)).toBe(2)
  expect(bytes.readUInt32LE(24)).toBe(48000)
  expect(bytes.readUInt32LE(40)).toBe(4 * 48000 * 4)
  expect(bytes.some((byte, i) => i > 44 && byte !== 0)).toBe(true)
  await page.getByRole('button', { name: 'Añadir pista', exact: true }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Ad-libs', exact: true }).click()
  await page.getByRole('button', { name: 'Crear pista', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Seleccionar Ad-libs', exact: true })).toHaveCount(
    2,
  )
  await page.getByRole('button', { name: 'Proyectos', exact: true }).click()
  await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Nombre del proyecto' })).toHaveValue(
    'Mi primera sesión',
  )
  await expect(page.locator('.audio-clip')).toHaveCount(0)
  await page.getByRole('button', { name: 'Proyectos', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Sesión de prueba/ })
    .click()
  await expect(page.locator('.audio-clip')).toHaveCount(2)
  await page.getByRole('button', { name: /Clip beat-test/ }).click()
  await expect(page.getByRole('spinbutton', { name: 'Recorte inicial' })).toHaveValue('0.25')
  await page.getByRole('button', { name: /Clip Voz principal/ }).click()
  await page.screenshot({ path: 'test-results/studio-desktop.png', fullPage: true })
  expect(errors).toEqual([])
})

test('offline mixer honors sample alignment, source offset, solo, mute, pan and gain', async ({
  page,
}) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const engineModule = '/src/audio/AudioEngine.ts'
    const projectModule = '/src/model/project.ts'
    const { AudioEngine } = await import(engineModule)
    const { createProject } = await import(projectModule)
    const engine = new AudioEngine()
    const context = new OfflineAudioContext(1, 48000, 48000)
    const source = context.createBuffer(1, 48000, 48000)
    source.getChannelData(0).fill(0.2, 12000)
    engine.setBuffer('tone', source)
    const project = createProject()
    project.masterVolume = 0.5
    const track = project.tracks[0]
    track.volume = 0.5
    track.pan = -1
    track.clips = [
      { id: 'one', assetId: 'tone', name: 'test', start: 0.25, offset: 0.25, duration: 0.5 },
    ]
    const rendered = await engine.render(project)
    const wav = new DataView(await rendered.blob.arrayBuffer())
    let earlyMax = 0
    let rightMax = 0
    for (let i = 0; i < 12000; i++)
      earlyMax = Math.max(earlyMax, Math.abs(wav.getInt16(44 + i * 4, true)))
    for (let i = 0; i < 36000; i++)
      rightMax = Math.max(rightMax, Math.abs(wav.getInt16(46 + i * 4, true)))
    const left = wav.getInt16(44 + 12000 * 4, true) / 32767
    track.muted = true
    const muted = (await engine.render(project)).peak
    track.muted = false
    project.tracks[1].solo = true
    const soloExcluded = (await engine.render(project)).peak
    project.tracks[1].solo = false
    const inverse = context.createBuffer(1, 48000, 48000)
    inverse.getChannelData(0).fill(-0.2, 12000)
    engine.setBuffer('inverse', inverse)
    Object.assign(project.tracks[1], {
      volume: 0.5,
      pan: -1,
      clips: [{ ...track.clips[0], id: 'two', assetId: 'inverse' }],
    })
    const cancelled = (await engine.render(project)).peak
    return {
      earlyMax,
      rightMax,
      left,
      muted,
      soloExcluded,
      cancelled,
      frames: wav.getUint32(40, true) / 4,
    }
  })
  expect(result).toMatchObject({
    earlyMax: 0,
    rightMax: 0,
    muted: 0,
    soloExcluded: 0,
    cancelled: 0,
    frames: 36000,
  })
  expect(result.left).toBeCloseTo(0.05, 4)
})

test('permission and invalid audio errors leave controls usable', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('denied', 'NotAllowedError')
    }
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Grabar', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('No se ha permitido acceder al micrófono')
  await expect(page.getByRole('button', { name: 'Grabar', exact: true })).toBeEnabled()
  await page
    .getByLabel('Seleccionar archivos de audio')
    .setInputFiles({ name: 'broken.wav', mimeType: 'audio/wav', buffer: Buffer.from('not audio') })
  await expect(page.getByRole('alert')).toContainText('No se ha podido decodificar')
  await expect(page.getByRole('button', { name: 'Importar audio', exact: true })).toBeEnabled()
})

test('mobile layout fits viewport and retains editing controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Grabar', exact: true })).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.getByRole('button', { name: 'Seleccionar Dobles', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Nombre de pista' })).toHaveValue('Dobles')
  await page.getByRole('button', { name: 'Proyectos', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Cerrar ventana' }).click()
  await page.getByRole('button', { name: 'Ayuda y atajos', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Tu estudio, de un vistazo')
  await page.keyboard.press('Escape')
  await page.screenshot({ path: 'test-results/studio-mobile.png', fullPage: true })
})

test('MP3 imports and survives reload with its original audio', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Importar audio', exact: true })).toBeEnabled()
  await page.getByLabel('Seleccionar archivos de audio').setInputFiles('tests/fixtures/tone.mp3')
  await expect(page.getByRole('button', { name: /Clip tone/ })).toBeVisible()
  const length = Number(
    await page.getByRole('spinbutton', { name: 'Duración del clip' }).inputValue(),
  )
  expect(length).toBeGreaterThan(0.9)
  expect(length).toBeLessThan(1.2)
  await expect(page.getByText('Todos los cambios guardados', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: /Clip tone/ })).toBeVisible()
  await page.getByRole('button', { name: 'Reproducir', exact: true }).click()
  await expect
    .poll(async () =>
      Number(
        await page
          .getByRole('meter', { name: 'Nivel de salida master' })
          .getAttribute('aria-valuenow'),
      ),
    )
    .toBeGreaterThan(-50)
  await page.getByRole('button', { name: 'Detener', exact: true }).click()
})

test('clipped export is rejected; lowering master produces a valid mix', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Importar audio', exact: true })).toBeEnabled()
  const pcm = new Float32Array(4800).fill(0.9)
  await page.getByLabel('Seleccionar archivos de audio').setInputFiles({
    name: 'loud.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from(encodeWav([pcm, pcm], 48000)),
  })
  await expect(page.getByRole('button', { name: /Clip loud/ })).toBeVisible()
  await page.getByRole('slider', { name: 'Ganancia de pista', exact: true }).fill('1.5')
  await page.getByRole('slider', { name: 'Volumen master', exact: true }).fill('1')
  await page.getByRole('button', { name: 'Exportar WAV', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('supera 0 dBFS')
  await page.getByRole('slider', { name: 'Volumen master', exact: true }).fill('0.5')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Exportar WAV', exact: true }).click()
  const bytes = await readFile((await (await downloadPromise).path())!)
  expect(bytes.readInt16LE(44) / 32767).toBeCloseTo(0.675, 3)
})

test('compact workspace keeps panel controls, recording destination and mixer values in sync', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Grabar', exact: true })).toBeEnabled()
  await page.getByLabel('Seleccionar archivos de audio').setInputFiles(beatFile())
  await expect(page.getByRole('button', { name: /Clip beat-test/ })).toBeVisible()
  await page.getByRole('button', { name: 'Seleccionar voz', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Grabar', exact: true })).toBeEnabled()
  await expect(page.getByText('Destino de grabación: Voz principal')).toBeVisible()

  await page.getByRole('button', { name: 'Mezclador: seleccionar Dobles', exact: true }).click()
  await page.getByRole('slider', { name: 'Mezclador: panorama Dobles', exact: true }).fill('0.35')
  await expect(page.getByRole('slider', { name: 'Panorama de pista', exact: true })).toHaveValue(
    '0.35',
  )
  const fader = page.getByRole('slider', { name: 'Mezclador: volumen Dobles', exact: true })
  await fader.focus()
  await page.keyboard.press('ArrowUp')
  await expect(fader).toHaveValue('0.81')
  await expect(page.getByRole('slider', { name: 'Ganancia de pista', exact: true })).toHaveValue(
    '0.81',
  )
  await expect(
    page.getByRole('button', { name: 'Preparar grabación en Dobles', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true')

  const before = (await page.getByTestId('timeline').boundingBox())!
  await page.getByRole('button', { name: 'Ocultar inspector', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Alternar inspector', exact: true })).toBeFocused()
  expect((await page.getByTestId('timeline').boundingBox())!.width).toBeGreaterThan(before.width)
  await page.getByRole('button', { name: 'Ocultar mezclador', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Alternar mezclador', exact: true })).toBeFocused()
  expect((await page.getByTestId('timeline').boundingBox())!.height).toBeGreaterThan(before.height)
  await page.getByRole('button', { name: 'Alternar inspector', exact: true }).click()
  await page.getByRole('button', { name: 'Alternar mezclador', exact: true }).click()
  await expect(fader).toHaveValue('0.81')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1366)
  await page.screenshot({ path: 'test-results/studio-laptop.png', fullPage: true })
})
