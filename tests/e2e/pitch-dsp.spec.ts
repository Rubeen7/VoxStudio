import { expect, test } from '@playwright/test'

test('pitch DSP: real correction, aligned dry/wet, stable stereo and scale/amount changes', async ({
  page,
}) => {
  await page.goto('/')
  const results = await page.evaluate(async () => {
    const dspPath = '/src/audio/effects.ts',
      modelPath = '/src/model/effects.ts',
      pitchPath = '/src/audio/pitch.ts'
    const { createEffectNode, prepareEffects } = await import(dspPath)
    const { createEffect } = await import(modelPath)
    const { pitchFrames } = await import(pitchPath)
    const sr = 48000
    const frequencyOf = (pcm: Float32Array) => {
      const crossings: number[] = []
      for (let i = sr / 2; i < sr * 0.9; i++)
        if (pcm[i] <= 0 && pcm[i + 1] > 0) crossings.push(i - pcm[i] / (pcm[i + 1] - pcm[i]))
      return ((crossings.length - 1) * sr) / (crossings.at(-1)! - crossings[0])
    }
    const render = async (
      frequency: number,
      params: Record<string, number> = {},
      enabled = true,
    ) => {
      const context = new OfflineAudioContext(2, sr + 8192, sr)
      await prepareEffects(context)
      const effect = createEffect('autotune')
      Object.assign(effect.params, { retune: 0, humanize: 0, amount: 100 }, params)
      effect.enabled = enabled
      const node = createEffectNode(context, effect)
      node.output.connect(context.destination)
      const source = context.createBufferSource(),
        buffer = context.createBuffer(2, sr, sr)
      for (let c = 0; c < 2; c++)
        for (let i = 0; i < sr; i++)
          buffer.getChannelData(c)[i] = 0.2 * Math.sin((2 * Math.PI * frequency * i) / sr)
      source.buffer = buffer
      source.connect(node.input)
      source.start()
      const rendered = await context.startRendering()
      const latency = pitchFrames([effect])
      const pcm = rendered.getChannelData(0).subarray(latency, latency + sr)
      let dryError = 0,
        stereoError = 0,
        maxStep = 0,
        peak = 0
      for (let i = 0; i < sr; i++) {
        dryError = Math.max(dryError, Math.abs(pcm[i] - buffer.getChannelData(0)[i]))
        stereoError = Math.max(
          stereoError,
          Math.abs(pcm[i] - rendered.getChannelData(1)[i + latency]),
        )
        peak = Math.max(peak, Math.abs(pcm[i]))
        if (i > sr / 5 && i < sr * 0.9) maxStep = Math.max(maxStep, Math.abs(pcm[i] - pcm[i - 1]))
      }
      node.dispose()
      return { frequency: frequencyOf(pcm), dryError, stereoError, maxStep, peak, latency }
    }
    return {
      hard: await render(450),
      half: await render(450, { amount: 50 }),
      minor: await render(432, { key: 0, scale: 1 }),
      major: await render(432, { key: 0, scale: 0 }),
      bypass: await render(450, {}, false),
      dry: await render(450, { mix: 0 }),
      neutral: await render(450, { amount: 0 }),
      low: await render(112),
      high: await render(890),
    }
  })
  console.log('Pitch DSP measurements', results)
  expect(results.hard.frequency).toBeCloseTo(440, 0)
  expect(results.half.frequency).toBeCloseTo(Math.sqrt(450 * 440), 0)
  expect(results.minor.frequency).toBeCloseTo(440 * 2 ** (-1 / 12), 0)
  expect(results.major.frequency).toBeCloseTo(440, 0)
  expect(results.low.frequency).toBeCloseTo(110, 0)
  expect(results.high.frequency).toBeCloseTo(880, 0)
  expect(results.neutral.frequency).toBeCloseTo(450, 0)
  expect(results.bypass.dryError).toBeLessThan(1e-6)
  expect(results.dry.dryError).toBeLessThan(1e-6)
  for (const result of Object.values(results)) {
    expect(result.latency).toBe(4224)
    expect(result.stereoError).toBeLessThan(0.001)
    expect(result.peak).toBeGreaterThan(0.1)
    expect(result.peak).toBeLessThan(0.4)
    expect(result.maxStep).toBeLessThan(0.08)
  }
})

test('pitch export preserves clip offsets, beat timing, WAV length, original buffers and effect order', async ({
  page,
}) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/AudioEngine.ts',
      modelPath = '/src/model/effects.ts',
      projectPath = '/src/model/project.ts'
    const { AudioEngine } = await import(enginePath)
    const { createEffect } = await import(modelPath)
    const { createProject } = await import(projectPath)
    const engine = new AudioEngine(),
      project = createProject(),
      sr = 48000
    const beat = project.tracks[0],
      voice = project.tracks[1]
    project.tracks = [beat, voice]
    project.masterVolume = beat.volume = voice.volume = 1
    beat.pan = 1
    voice.pan = -1
    const tone = new AudioBuffer({ length: sr * 2, numberOfChannels: 1, sampleRate: sr })
    for (let i = 0; i < tone.length; i++)
      tone.getChannelData(0)[i] = 0.15 * Math.sin((2 * Math.PI * 450 * i) / sr)
    const pulse = new AudioBuffer({ length: sr, numberOfChannels: 1, sampleRate: sr })
    pulse.getChannelData(0)[sr / 2] = 0.5
    engine.setBuffer('voice', tone)
    engine.setBuffer('beat', pulse)
    voice.clips = [
      { id: 'v', assetId: 'voice', start: 0.2, offset: 0.1, duration: 1.5, name: 'Voice' },
    ]
    beat.clips = [
      { id: 'b', assetId: 'beat', start: 0.3, offset: 0.1, duration: 0.8, name: 'Beat' },
    ]
    const effect = createEffect('autotune')
    Object.assign(effect.params, { retune: 0, humanize: 0, amount: 100 })
    const decode = async () => {
      const rendered = await engine.render(project)
      return engine.decode(rendered.blob)
    }
    const dry = await decode()
    voice.effects = [{ ...effect, enabled: false }]
    const bypass = await decode()
    voice.effects = [effect]
    const wet = await decode()
    let bypassError = 0,
      beatError = 0,
      originalError = 0
    for (let i = 0; i < dry.length; i++) {
      bypassError = Math.max(
        bypassError,
        Math.abs(bypass.getChannelData(0)[i] - dry.getChannelData(0)[i]),
      )
      beatError = Math.max(beatError, Math.abs(wet.getChannelData(1)[i] - dry.getChannelData(1)[i]))
    }
    for (let i = 0; i < tone.length; i++)
      originalError = Math.max(
        originalError,
        Math.abs(
          tone.getChannelData(0)[i] - Math.fround(0.15 * Math.sin((2 * Math.PI * 450 * i) / sr)),
        ),
      )
    const crossings: number[] = []
    const pcm = wet.getChannelData(0)
    for (let i = sr * 0.6; i < sr * 1.2; i++)
      if (pcm[i] <= 0 && pcm[i + 1] > 0) crossings.push(i - pcm[i] / (pcm[i + 1] - pcm[i]))
    const eq = createEffect('eq')
    Object.assign(eq.params, { frequency1: 440, gain1: -18, q1: 8 })
    voice.effects = [effect, eq]
    const filtered = await decode()
    const rms = (buffer: AudioBuffer) => {
      let sum = 0
      for (let i = sr * 0.6; i < sr; i++) sum += buffer.getChannelData(0)[i] ** 2
      return Math.sqrt(sum / (sr * 0.4))
    }
    return {
      bypassError,
      beatError,
      originalError,
      length: wet.length,
      expectedLength: Math.ceil(1.7 * sr),
      frequency: ((crossings.length - 1) * sr) / (crossings.at(-1)! - crossings[0]),
      eqRatio: rms(filtered) / rms(wet),
      pulseAt: wet.getChannelData(1).findIndex((n) => n > 0.4),
    }
  })
  console.log('Pitch export measurements', result)
  expect(result.bypassError).toBeLessThan(1e-4)
  expect(result.beatError).toBeLessThan(1e-4)
  expect(result.originalError).toBe(0)
  expect(result.length).toBe(result.expectedLength)
  expect(result.pulseAt).toBe(33600) // .3 + .5 - .1 seconds
  expect(result.frequency).toBeCloseTo(440, 0)
  expect(result.eqRatio).toBeLessThan(0.25)
})

test('pitch playback updates notes live; monitoring stays immediate and takes stay dry on the compensated clock', async ({
  page,
}) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const enginePath = '/src/audio/AudioEngine.ts',
      effectPath = '/src/model/effects.ts',
      projectPath = '/src/model/project.ts'
    const { AudioEngine } = await import(enginePath)
    const { createEffect } = await import(effectPath)
    const { createProject } = await import(projectPath)
    const engine = new AudioEngine(),
      project = createProject()
    const context = await engine.ready(),
      voice = project.tracks[1],
      sr = context.sampleRate
    project.tracks = [voice]
    project.masterVolume = voice.volume = 1
    let effect = createEffect('autotune')
    Object.assign(effect.params, { retune: 0, amount: 100, humanize: 0 })
    voice.effects = [effect]
    const tone = context.createBuffer(1, sr * 6, sr)
    for (let i = 0; i < tone.length; i++)
      tone.getChannelData(0)[i] = 0.2 * Math.sin((2 * Math.PI * 450 * i) / sr)
    engine.setBuffer('tone', tone)
    voice.clips = [{ id: 'v', assetId: 'tone', name: 'Voice', start: 0, offset: 0, duration: 6 }]
    const analyser = context.createAnalyser()
    analyser.fftSize = 8192
    engine.master.connect(analyser)
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const frequency = (data: Float32Array) => {
      const crossings: number[] = []
      for (let i = 0; i < data.length - 1; i++)
        if (data[i] <= 0 && data[i + 1] > 0) crossings.push(i - data[i] / (data[i + 1] - data[i]))
      return ((crossings.length - 1) * sr) / (crossings.at(-1)! - crossings[0])
    }
    const heard = () => {
      const data = new Float32Array(analyser.fftSize)
      analyser.getFloatTimeDomainData(data)
      return frequency(data)
    }
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    const oscillator = context.createOscillator(),
      level = context.createGain(),
      mic = context.createMediaStreamDestination()
    oscillator.frequency.value = 450
    level.gain.value = 0.2
    oscillator.connect(level).connect(mic)
    oscillator.start()
    let requests = 0
    navigator.mediaDevices.getUserMedia = async () => {
      requests++
      return mic.stream
    }
    try {
      await engine.play(project, 0)
      await wait(700)
      const chromatic = heard()
      effect = { ...effect, params: { ...effect.params, scale: 1 } }
      voice.effects = [effect]
      engine.updateMix(project)
      await wait(450)
      const minor = heard()
      voice.effects = [{ ...effect, enabled: false }]
      engine.updateMix(project)
      await wait(300)
      const bypass = heard()
      voice.effects = [effect]
      engine.updateMix(project)
      engine.seek(1.25, project)
      await wait(650)
      const seekFrequency = heard(),
        seekPosition = engine.position
      engine.stop()
      voice.clips = []
      engine.setMonitorVolume(1)
      await engine.setMonitoring(project, voice.id)
      await wait(300)
      const monitored = heard(),
        monitorLatency = engine.monitor.channel.latencyFrames
      await engine.startRecording(project, 0.375, 3, voice.id)
      const anchor = engine.anchor
      let preventedLatencyChange = false
      try {
        engine.updateMix({ ...project, tracks: [{ ...voice, effects: [] }] })
      } catch {
        preventedLatencyChange = true
      }
      await wait(850)
      const take = await engine.finishRecording()
      const duration = take.buffer.duration,
        position = engine.position
      const dryFrequency = frequency(take.buffer.getChannelData(0).subarray(4096))
      const captureClockError = Math.abs(position - 0.375 - duration)
      await engine.startRecording(project, 1.25, 3, voice.id)
      await wait(800)
      const second = await engine.finishRecording()
      const secondFrequency = frequency(second.buffer.getChannelData(0).subarray(4096))
      const afterTwoTakes = heard()
      engine.releaseInput()
      return {
        chromatic,
        minor,
        bypass,
        seekFrequency,
        seekPosition,
        monitored,
        monitorLatency,
        dryFrequency,
        secondFrequency,
        captureClockError,
        duration,
        anchor,
        preventedLatencyChange,
        afterTwoTakes,
        requests,
        released: mic.stream.getAudioTracks()[0].readyState === 'ended',
      }
    } finally {
      navigator.mediaDevices.getUserMedia = original
      engine.releaseInput()
      engine.stop()
      oscillator.stop()
      analyser.disconnect()
      await context.close()
    }
  })
  console.log('Pitch live/recording measurements', result)
  expect(result.chromatic).toBeCloseTo(440, 0)
  expect(result.minor).toBeCloseTo(440 * 2 ** (1 / 12), 0)
  expect(result.bypass).toBeCloseTo(450, 0)
  expect(result.seekFrequency).toBeCloseTo(440 * 2 ** (1 / 12), 0)
  expect(result.seekPosition).toBeGreaterThan(1.5)
  expect(result.seekPosition).toBeLessThan(1.95)
  expect(result.monitorLatency).toBe(0)
  expect(result.monitored).toBeCloseTo(450, 0)
  expect(result.dryFrequency).toBeCloseTo(450, 0)
  expect(result.secondFrequency).toBeCloseTo(450, 0)
  expect(result.afterTwoTakes).toBeCloseTo(450, 0)
  expect(result.captureClockError).toBeLessThan(0.006)
  expect(result.duration).toBeGreaterThan(0.3)
  expect(result.preventedLatencyChange).toBe(true)
  expect(result.requests).toBe(1)
  expect(result.released).toBe(true)
})
