import { expect, test } from '@playwright/test'

test('native DSP changes spectra, dynamics and harmonics; bypass is transparent and tails are real', async ({
  page,
}) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const effectPath = '/src/model/effects.ts'
    const projectPath = '/src/model/project.ts'
    const graphPath = '/src/audio/graph.ts'
    const dspPath = '/src/audio/effects.ts'
    const { createEffect } = await import(effectPath)
    const { createProject } = await import(projectPath)
    const { createTrackChannel } = await import(graphPath)
    const { prepareEffects } = await import(dspPath)
    const sr = 48000
    async function render(
      type: string | null,
      params: Record<string, number> = {},
      frequency = 1000,
      enabled = true,
      pulse = false,
    ) {
      const ctx = new OfflineAudioContext(2, sr, sr)
      await prepareEffects(ctx)
      const project = createProject()
      const track = project.tracks[0]
      track.volume = 1
      if (type) {
        const effect = createEffect(type)
        Object.assign(effect.params, params)
        effect.enabled = enabled
        track.effects = [effect]
      }
      const channel = createTrackChannel(ctx, track, project, ctx.destination)
      const buffer = ctx.createBuffer(2, sr, sr)
      for (let c = 0; c < 2; c++) {
        const data = buffer.getChannelData(c)
        if (pulse) data[4800] = 0.5
        else
          for (let i = 0; i < sr * 0.7; i++)
            data[i] = 0.5 * Math.sin((2 * Math.PI * frequency * i) / sr)
      }
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.connect(channel.input)
      source.start(0)
      const rendered = await ctx.startRendering()
      const data = Array.from(rendered.getChannelData(0))
      const stereoError = data.reduce(
        (max, value, i) => Math.max(max, Math.abs(value - rendered.getChannelData(1)[i])),
        0,
      )
      channel.dispose()
      return { data, stereoError }
    }
    const rms = (data: number[], from = 0.4, to = 0.65) =>
      Math.sqrt(
        data.slice(Math.round(from * sr), Math.round(to * sr)).reduce((sum, n) => sum + n * n, 0) /
          ((to - from) * sr),
      )
    const difference = (a: number[], b: number[]) =>
      Math.max(...a.map((n, i) => Math.abs(n - b[i])))
    const dry = await render(null)
    const eq = await render('eq', { frequency1: 1000, gain1: -18, q1: 2 })
    const comp = await render('compressor', { threshold: -30, ratio: 8, attack: 1 })
    const hp = await render('highpass', { frequency: 2000 })
    const lp = await render('lowpass', { frequency: 200 })
    const highDry = await render(null, {}, 8000)
    const highDeess = await render(
      'deesser',
      { frequency: 4000, threshold: -35, ratio: 12, reduction: 18 },
      8000,
    )
    const lowDry = await render(null, {}, 200)
    const lowDeess = await render(
      'deesser',
      { frequency: 4000, threshold: -35, ratio: 12, reduction: 18 },
      200,
    )
    const delay = await render('delay', { time: 100, feedback: 50, mix: 100 }, 1000, true, true)
    const reverb = await render('reverb', { duration: 0.5, mix: 100 }, 1000, true, true)
    const saturation = await render('saturation', { drive: 18, output: 0, mix: 100 })
    const distortion = await render('distortion', { drive: 18, output: 0, mix: 100 })
    const harmonic = (data: number[], hz: number) => {
      let a = 0,
        b = 0
      for (let i = 19200; i < 31200; i++) {
        a += data[i] * Math.cos((2 * Math.PI * hz * i) / sr)
        b += data[i] * Math.sin((2 * Math.PI * hz * i) / sr)
      }
      return Math.hypot(a, b) / 6000
    }
    const bypassErrors = []
    for (const type of [
      'eq',
      'compressor',
      'deesser',
      'reverb',
      'delay',
      'highpass',
      'lowpass',
      'saturation',
      'distortion',
    ]) {
      bypassErrors.push(difference(dry.data, (await render(type, {}, 1000, false)).data))
    }
    const dryMix = await render('compressor', { mix: 0 })
    return {
      eq: rms(eq.data) / rms(dry.data),
      compressor: rms(comp.data) / rms(dry.data),
      highpass: rms(hp.data) / rms(dry.data),
      lowpass: rms(lp.data) / rms(dry.data),
      deessHigh: rms(highDeess.data) / rms(highDry.data),
      deessLow: rms(lowDeess.data) / rms(lowDry.data),
      echoes: [delay.data[9600], delay.data[14400], delay.data[19200]],
      delayDry: delay.data[4800],
      echoLocations: delay.data
        .flatMap((value, index) => (Math.abs(value) > 0.01 ? [{ index, value }] : []))
        .slice(0, 12),
      reverbTail: rms(reverb.data, 0.15, 0.3),
      reverbEnd: rms(reverb.data, 0.8, 0.95),
      saturationHarmonic: harmonic(saturation.data, 3000),
      distortionHarmonic: harmonic(distortion.data, 3000),
      dryHarmonic: harmonic(dry.data, 3000),
      bypassErrors,
      dryMixError: difference(dry.data, dryMix.data),
      stereoError: comp.stereoError,
      finite: [comp, highDeess, delay, reverb, saturation, distortion].every((r) =>
        r.data.every(Number.isFinite),
      ),
    }
  })
  await test
    .info()
    .attach('dsp-measurements', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    })
  expect(result.finite).toBe(true)
  expect(result.eq).toBeLessThan(0.15)
  expect(result.compressor).toBeLessThan(0.25)
  expect(result.highpass).toBeLessThan(0.3)
  expect(result.lowpass).toBeLessThan(0.1)
  expect(result.deessHigh).toBeLessThan(0.75)
  expect(result.deessLow).toBeGreaterThan(0.95)
  expect(result.echoes[0]).toBeCloseTo(0.5, 4)
  expect(result.echoes[1]).toBeCloseTo(0.25, 4)
  expect(result.echoes[2]).toBeCloseTo(0.125, 4)
  expect(result.delayDry).toBe(0)
  expect(result.reverbTail).toBeGreaterThan(0.0001)
  expect(result.reverbEnd).toBeLessThan(0.00001)
  expect(result.saturationHarmonic).toBeGreaterThan(0.05)
  expect(result.distortionHarmonic).toBeGreaterThan(0.1)
  expect(result.dryHarmonic).toBeLessThan(0.0001)
  expect(Math.max(...result.bypassErrors)).toBeLessThan(1e-6)
  expect(result.dryMixError).toBeLessThan(1e-6)
  expect(result.stereoError).toBeLessThan(1e-6)
})

test('export shares the live graph, preserves effect order, muted tails and deterministic reverb', async ({
  page,
}) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const paths = [
      '/src/audio/AudioEngine.ts',
      '/src/model/project.ts',
      '/src/model/effects.ts',
      '/src/audio/graph.ts',
      '/src/audio/effects.ts',
    ]
    const [
      { AudioEngine },
      { createProject, projectPlaybackDuration },
      { createEffect },
      { createTrackChannel },
      { prepareEffects },
    ] = await Promise.all(paths.map((p) => import(p)))
    const engine = new AudioEngine()
    const project = createProject()
    project.masterVolume = 1
    const track = project.tracks[0]
    track.volume = 1
    const context = new OfflineAudioContext(2, 48000, 48000)
    const buffer = context.createBuffer(2, 12000, 48000)
    for (let c = 0; c < 2; c++) {
      const data = buffer.getChannelData(c)
      for (let i = 0; i < data.length; i++)
        data[i] = 0.3 * Math.sin((2 * Math.PI * 900 * i) / 48000)
    }
    engine.setBuffer('test', buffer)
    track.clips = [
      { id: 'clip', name: 'tone', assetId: 'test', start: 0, offset: 0, duration: 0.25 },
    ]
    const reverb = createEffect('reverb')
    reverb.params.duration = 0.5
    reverb.params.mix = 40
    const comp = createEffect('compressor')
    track.effects = [comp, reverb]
    const one = await engine.render(project)
    const two = await engine.render(project)
    const bytes = new Uint8Array(await one.blob.arrayBuffer())
    const repeat = new Uint8Array(await two.blob.arrayBuffer())
    const view = new DataView(bytes.buffer)
    const native = new OfflineAudioContext(
      2,
      Math.ceil(projectPlaybackDuration(project) * 48000),
      48000,
    )
    await prepareEffects(native)
    const channel = createTrackChannel(native, track, project, native.destination)
    const source = native.createBufferSource()
    source.buffer = buffer
    source.connect(channel.input)
    source.start(0)
    const reference = (await native.startRendering()).getChannelData(0)
    let graphError = 0,
      tail = 0
    for (let i = 0; i < 36000; i++) {
      graphError = Math.max(
        graphError,
        Math.abs(view.getInt16(44 + i * 4, true) / 32768 - reference[i]),
      )
      if (i > 12000) tail = Math.max(tail, Math.abs(reference[i]))
    }
    channel.dispose()
    const eq = createEffect('eq')
    eq.params.gain1 = 18
    eq.params.frequency1 = 900
    const distortion = createEffect('distortion')
    distortion.params.mix = 100
    track.effects = [eq, distortion]
    const orderOne = new Uint8Array(await (await engine.render(project)).blob.arrayBuffer())
    track.effects = [distortion, eq]
    const orderTwo = new Uint8Array(await (await engine.render(project)).blob.arrayBuffer())
    track.muted = true
    const muted = await engine.render(project)
    return {
      graphError,
      tail,
      frames: view.getUint32(40, true) / 4,
      deterministic: bytes.every((b, i) => b === repeat[i]),
      orderDifference: orderOne.some((b, i) => b !== orderTwo[i]),
      mutedPeak: muted.peak,
    }
  })
  expect(result.frames).toBeGreaterThan(12000)
  expect(result.tail).toBeGreaterThan(0.001)
  expect(result.graphError).toBeLessThan(0.00007)
  expect(result.deterministic).toBe(true)
  expect(result.orderDifference).toBe(true)
  expect(result.mutedPeak).toBe(0)
})
