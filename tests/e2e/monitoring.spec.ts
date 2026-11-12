import { expect, test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

// Chrome's default fake microphone emits intermittent beeps; use a continuous reference signal.
test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      `--use-file-for-fake-audio-capture=${fileURLToPath(new URL('../fixtures/microphone.wav', import.meta.url))}`,
    ],
  },
})

declare global {
  interface Window {
    micRequests: MediaStreamConstraints[]
    micStreams: MediaStream[]
  }
}

async function observeInput(page: Page) {
  await page.addInitScript(() => {
    window.micRequests = []
    window.micStreams = []
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.micRequests.push(constraints ?? {})
      const stream = await original(constraints)
      window.micStreams.push(stream)
      return stream
    }
  })
}

test('monitoring UI: safe default, one input, independent takes, device settings and project shutdown', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await observeInput(page)
  await page.goto('/')
  const lead = page.getByRole('button', { name: 'Monitorizar Voz principal', exact: true })
  const doubles = page.getByRole('button', { name: 'Monitorizar Dobles', exact: true })
  await expect(lead).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => window.micRequests.length)).toBe(0)
  await lead.click()
  await expect(page.getByRole('dialog')).toContainText('altavoces')
  expect(await page.evaluate(() => window.micRequests.length)).toBe(0)
  await page.getByRole('button', { name: 'Cerrar ventana', exact: true }).click()
  await expect(lead).toHaveAttribute('aria-pressed', 'false')
  await lead.click()
  await page.getByRole('button', { name: 'Activar con auriculares', exact: true }).click()
  await expect(lead).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Estado del micrófono')).toHaveText('Activo')
  const inputMeter = page.getByRole('meter', { name: 'Nivel del micrófono', exact: true })
  const master = page.getByRole('meter', { name: 'Nivel de salida master', exact: true })
  await expect
    .poll(async () => Number(await inputMeter.getAttribute('aria-valuenow')))
    .toBeGreaterThan(-50)
  await expect
    .poll(async () => Number(await master.getAttribute('aria-valuenow')))
    .toBeGreaterThan(-55)
  const effects = page.getByRole('region', { name: 'Efectos de pista' })
  for (const type of ['eq', 'compressor', 'reverb', 'delay', 'deesser']) {
    await effects.getByLabel('Tipo de efecto', { exact: true }).selectOption(type)
    await effects.getByRole('button', { name: 'Añadir efecto', exact: true }).click()
  }
  await effects.getByRole('spinbutton', { name: 'Frecuencia sibilante', exact: true }).fill('7000')
  await page.getByRole('slider', { name: 'Volumen de monitorización' }).fill('0')
  await expect.poll(async () => Number(await master.getAttribute('aria-valuenow'))).toBe(-60)
  await page.getByRole('slider', { name: 'Volumen de monitorización' }).fill('0.5')
  await page.getByText('Dispositivo y latencia', { exact: true }).click()
  await expect(page.getByLabel('Preferencia de latencia')).toBeDisabled()
  await expect(page.getByLabel('Dispositivo de entrada', { exact: true })).toBeDisabled()
  await expect(page.getByLabel('Latencias comunicadas por el navegador')).toContainText('ms')

  await page.getByRole('button', { name: 'Grabar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Finalizar grabación', exact: true })).toBeEnabled()
  await expect(doubles).toBeDisabled()
  await lead.click() // Stop listening, but keep dry capture alive.
  await expect(lead).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByLabel('Estado del micrófono')).toHaveText('Activo')
  await lead.click()
  await page.waitForTimeout(450)
  await page.getByRole('button', { name: 'Finalizar grabación', exact: true }).click()
  await expect(page.getByRole('button', { name: /Clip Voz principal · Toma 1/ })).toBeVisible()
  await expect(lead).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Detener', exact: true }).click()
  await expect(page.getByLabel('Estado del micrófono')).toHaveText('Activo')
  await page.getByRole('button', { name: 'Seleccionar Dobles', exact: true }).click()
  await page.getByRole('button', { name: 'Grabar', exact: true }).click()
  await expect(doubles).toHaveAttribute('aria-pressed', 'true')
  await expect(lead).toHaveAttribute('aria-pressed', 'false')
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: 'Finalizar grabación', exact: true }).click()
  await expect(page.getByRole('button', { name: /Clip Dobles · Toma 1/ })).toBeVisible()
  expect(await page.evaluate(() => window.micRequests.length)).toBe(1)
  expect(await page.evaluate(() => window.micStreams[0].getAudioTracks()[0].readyState)).toBe(
    'live',
  )
  await doubles.click()
  await expect(page.getByLabel('Estado del micrófono')).toHaveText('Apagado')
  expect(await page.evaluate(() => window.micStreams[0].getAudioTracks()[0].readyState)).toBe(
    'ended',
  )
  await page.getByLabel('Preferencia de latencia').selectOption('balanced')
  await expect(page.getByLabel('Preferencia de latencia')).toHaveValue('balanced')
  const devices = page.getByLabel('Dispositivo de entrada', { exact: true })
  const deviceId = await devices.locator('option').nth(1).getAttribute('value')
  expect(deviceId).toBeTruthy()
  await devices.selectOption(deviceId!)
  await doubles.click()
  await expect(doubles).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => window.micRequests[1].audio)).toMatchObject({
    deviceId: { exact: deviceId },
  })
  await page.getByRole('button', { name: 'Proyectos', exact: true }).click()
  await page.getByRole('button', { name: 'Nuevo proyecto', exact: true }).click()
  await expect(page.getByLabel('Estado del micrófono')).toHaveText('Apagado')
  expect(
    await page.evaluate(() =>
      window.micStreams.every((stream) =>
        stream.getTracks().every((track) => track.readyState === 'ended'),
      ),
    ),
  ).toBe(true)
  await expect(page.getByText('Todos los cambios guardados', { exact: true })).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('button', { name: 'Monitorizar Voz principal', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => window.micRequests.length)).toBe(0)
  expect(errors).toEqual([])
})

test('monitoring permissions: failures do not leave an active listening route', async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Denied', 'NotAllowedError')
    }
  })
  await page.goto('/')
  const lead = page.getByRole('button', { name: 'Monitorizar Voz principal', exact: true })
  await lead.click()
  await page.getByRole('button', { name: 'Activar con auriculares', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('No se ha permitido')
  await expect(lead).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByLabel('Estado del micrófono')).toHaveText('Apagado')
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException('Missing', 'OverconstrainedError')
    }
  })
  await lead.click()
  await expect(page.getByRole('alert')).toContainText('entrada seleccionada ya no está disponible')
  await expect(lead).toBeEnabled()
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise<MediaStream>(() => {})
  })
  await lead.click()
  await page.getByRole('button', { name: 'Cancelar micrófono', exact: true }).click()
  await expect(lead).toBeEnabled()
  await expect(lead).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByLabel('Estado del micrófono')).toHaveText('Apagado')
})

test('monitoring disconnect: unplugging recovers dry audio and releases the listening route', async ({
  page,
}) => {
  await observeInput(page)
  await page.goto('/')
  const lead = page.getByRole('button', { name: 'Monitorizar Voz principal', exact: true })
  await lead.click()
  await page.getByRole('button', { name: 'Activar con auriculares', exact: true }).click()
  await expect(lead).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Grabar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Finalizar grabación', exact: true })).toBeEnabled()
  await page.waitForTimeout(700)
  await page.evaluate(() => {
    const track = window.micStreams[0].getAudioTracks()[0]
    track.stop()
    track.dispatchEvent(new Event('ended'))
  })
  await expect(page.getByRole('button', { name: /Clip Voz principal · Toma 1/ })).toBeVisible()
  await expect(page.getByLabel('Estado del micrófono')).toHaveText('Apagado')
  await expect(lead).toHaveAttribute('aria-pressed', 'false')
  await lead.click()
  await expect(lead).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Estado del micrófono')).toHaveText('Activo')
  await expect(page.getByText('Todos los cambios guardados', { exact: true })).toBeVisible()
  await page.reload()
  await expect(lead).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => window.micRequests.length)).toBe(0)
})

test('monitoring lifecycle: late permission and suspended audio cannot leave the microphone open', async ({
  page,
}) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/AudioEngine.ts'
    const modelPath = '/src/model/project.ts'
    const { AudioEngine } = await import(enginePath)
    const { createProject } = await import(modelPath)
    const engine = new AudioEngine()
    const context = await engine.ready()
    const project = createProject()
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    let received!: () => void
    let allow!: () => void
    let delayedStream: MediaStream | undefined
    let delivered!: () => void
    const delivery = new Promise<void>((resolve) => {
      delivered = resolve
    })
    const requested = new Promise<void>((resolve) => {
      received = resolve
    })
    const permission = new Promise<void>((resolve) => {
      allow = resolve
    })
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      received()
      await permission
      delayedStream = await original(constraints)
      delivered()
      return delayedStream
    }
    try {
      const pending = engine.setMonitoring(project, project.tracks[1].id)
      await requested
      engine.releaseInput()
      await pending // Cancellation must complete even if the permission prompt remains unanswered.
      allow()
      await delivery
      await new Promise((resolve) => setTimeout(resolve, 0))
      const cancelled =
        !engine.inputStatus.active &&
        engine.inputStatus.monitorTrackId === null &&
        delayedStream!.getAudioTracks()[0].readyState === 'ended'
      navigator.mediaDevices.getUserMedia = original
      await engine.setMonitoring(project, project.tracks[1].id)
      let interrupted!: () => void
      const interruption = new Promise<void>((resolve) => {
        interrupted = resolve
      })
      engine.onInputInterrupted = interrupted
      await context.suspend()
      await interruption
      const suspended = !engine.inputStatus.active && engine.inputStatus.monitorTrackId === null
      await context.resume()
      const staysOff = !engine.inputStatus.active
      return { cancelled, suspended, staysOff }
    } finally {
      navigator.mediaDevices.getUserMedia = original
      engine.releaseInput()
      await context.close()
    }
  })
  expect(result).toEqual({ cancelled: true, suspended: true, staysOff: true })
})

test('monitoring DSP: wet listening, dry capture, clock stability, single routing and export isolation', async ({
  page,
}) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/AudioEngine.ts'
    const modelPath = '/src/model/project.ts'
    const fxPath = '/src/model/effects.ts'
    const { AudioEngine } = await import(enginePath)
    const { createProject } = await import(modelPath)
    const { createEffect } = await import(fxPath)
    const engine = new AudioEngine()
    const context = await engine.ready()
    const oscillator = context.createOscillator()
    oscillator.frequency.value = 1000
    const gain = context.createGain()
    gain.gain.value = 0.2
    const destination = context.createMediaStreamDestination()
    oscillator.connect(gain).connect(destination)
    oscillator.start()
    let requests = 0
    const original = navigator.mediaDevices.getUserMedia
    navigator.mediaDevices.getUserMedia = async () => {
      requests++
      return destination.stream
    }
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const project = createProject()
    project.masterVolume = 1
    const voice = project.tracks[1]
    voice.volume = 1
    const eq = createEffect('eq')
    eq.params.frequency1 = 1000
    eq.params.gain1 = -18
    voice.effects = [eq]
    engine.setMonitorVolume(1)
    try {
      await engine.setMonitoring(project, voice.id)
      await wait(250)
      const wet = engine.readLevels().master
      const input = engine.readLevels().input
      voice.effects = [{ ...eq, enabled: false }]
      engine.updateMix(project)
      await wait(150)
      const bypass = engine.readLevels().master
      voice.effects = [eq]
      engine.updateMix(project)
      const beat = project.tracks[0]
      beat.volume = 1
      beat.pan = -1
      const beatBuffer = context.createBuffer(1, 48000 * 3, 48000)
      beatBuffer.getChannelData(0).fill(0.03)
      engine.setBuffer('beat', beatBuffer)
      beat.clips = [
        { id: 'beat-clip', assetId: 'beat', name: 'Beat', start: 0, offset: 0, duration: 3 },
      ]
      await engine.play(project, 0)
      await wait(200)
      const beatAndVoice = engine.readLevels().master
      const playbackBeforeSwitch = engine.position
      await engine.setMonitoring(project, project.tracks[2].id)
      await engine.setMonitoring(project, voice.id)
      const playbackAfterSwitch = engine.position
      engine.pause()
      await engine.startRecording(project, 0.375, 3, voice.id)
      await wait(650)
      beat.muted = true
      engine.updateMix(project)
      await wait(100)
      const beforeToggle = engine.position
      await engine.setMonitoring(project, null)
      await wait(80)
      const silent = engine.readLevels().master
      const stillActive = engine.inputStatus.active
      await engine.setMonitoring(project, voice.id)
      const afterToggle = engine.position
      await wait(150)
      const take = await engine.finishRecording()
      const dry = take.buffer.getChannelData(0)
      let dryPeak = 0
      for (let i = 5000; i < dry.length; i++) dryPeak = Math.max(dryPeak, Math.abs(dry[i]))
      const activeAfterTake =
        engine.inputStatus.active && engine.inputStatus.monitorTrackId === voice.id
      const firstLevel = engine.readLevels().master
      for (let i = 0; i < 8; i++) {
        await engine.setMonitoring(project, project.tracks[2].id)
        await engine.setMonitoring(project, voice.id)
      }
      await wait(200)
      const lastLevel = engine.readLevels().master
      const secondStart = 1.75
      await engine.startRecording(project, secondStart, 3, voice.id)
      await wait(400)
      const second = await engine.finishRecording()
      beat.clips = []
      beat.muted = false
      engine.setBuffer('recorded', take.buffer)
      voice.clips = [
        {
          id: 'clip',
          assetId: 'recorded',
          name: 'Dry',
          start: 0.375,
          offset: 0,
          duration: take.buffer.duration,
        },
      ]
      const liveExport = await engine.render(project)
      const wav = new DataView(await liveExport.blob.arrayBuffer())
      let earlyPeak = 0
      for (let i = 0; i < 18000; i++)
        earlyPeak = Math.max(earlyPeak, Math.abs(wav.getInt16(44 + i * 4, true)))
      // Playback tail fade must never mute the microphone's independent route.
      voice.effects = [createEffect('reverb')]
      voice.effects[0].params.duration = 0.2
      voice.effects[0].params.mix = 10
      voice.clips[0].duration = 0.1
      voice.clips[0].start = 0
      engine.updateMix(project)
      await engine.play(project, 0)
      await wait(650)
      const liveAfterTail = engine.readLevels().master
      engine.stop()
      voice.effects = [eq]
      voice.clips[0].start = 0.375
      voice.clips[0].duration = take.buffer.duration
      await engine.setMonitoring(project, null)
      const noLiveExport = await engine.render(project)
      const bytesA = new Uint8Array(await liveExport.blob.arrayBuffer())
      const bytesB = new Uint8Array(await noLiveExport.blob.arrayBuffer())
      const equalExports =
        bytesA.length === bytesB.length && bytesA.every((value, index) => value === bytesB[index])
      return {
        wet,
        input,
        bypass,
        dryPeak,
        silent,
        stillActive,
        activeAfterTake,
        beforeToggle,
        afterToggle,
        firstLevel,
        lastLevel,
        requests,
        liveAfterTail,
        earlyPeak,
        equalExports,
        beatAndVoice,
        playbackBeforeSwitch,
        playbackAfterSwitch,
        takeDuration: take.buffer.duration,
        secondDuration: second.buffer.duration,
        released: destination.stream.getAudioTracks()[0].readyState === 'ended',
      }
    } finally {
      navigator.mediaDevices.getUserMedia = original
      engine.releaseInput()
      engine.stop()
      oscillator.stop()
      await context.close()
    }
  })
  expect(result.input).toBeGreaterThan(0.19)
  expect(result.beatAndVoice).toBeGreaterThan(result.wet + 0.01)
  expect(result.playbackAfterSwitch).toBeGreaterThan(result.playbackBeforeSwitch)
  expect(result.playbackAfterSwitch - result.playbackBeforeSwitch).toBeLessThan(0.3)
  expect(result.bypass).toBeGreaterThan(0.13)
  expect(result.wet / result.bypass).toBeCloseTo(10 ** (-18 / 20), 2)
  expect(result.dryPeak).toBeCloseTo(0.2, 2)
  expect(result.silent).toBeLessThan(0.0001)
  expect(result.stillActive).toBe(true)
  expect(result.activeAfterTake).toBe(true)
  expect(result.afterToggle).toBeGreaterThan(result.beforeToggle)
  expect(result.afterToggle - result.beforeToggle).toBeLessThan(0.5)
  expect(result.lastLevel / result.firstLevel).toBeCloseTo(1, 2)
  expect(result.requests).toBe(1)
  expect(result.takeDuration).toBeGreaterThan(0.5)
  expect(result.secondDuration).toBeGreaterThan(0.15)
  expect(result.liveAfterTail).toBeGreaterThan(0.05)
  expect(result.earlyPeak).toBe(0)
  expect(result.equalExports).toBe(true)
  expect(result.released).toBe(true)
})
