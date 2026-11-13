import type { Project } from '../model/project'
import {
  playableClips,
  isAudible,
  MAX_SECONDS,
  projectDuration,
  projectPlaybackDuration,
} from '../model/project'
import { MAX_EFFECT_TAIL } from '../model/effects'
import { prepareEffects } from './effects'
import { encodeWav } from './wav'
import recorderUrl from './recorder.worklet.js?url'
import { createTrackChannel, type TrackChannel } from './graph'
import { MicrophoneInput, type LatencyMode } from './MicrophoneInput'
import { pitchFrames } from './pitch'
import { scheduleClip } from './clip'

export type TransportState = 'stopped' | 'playing' | 'paused' | 'recording'
type Capture = {
  node: AudioWorkletNode
  chunks: Float32Array[]
  done: Promise<Float32Array>
  disconnect: () => void
}

export class AudioEngine {
  private context?: AudioContext
  private master?: GainNode
  private analyser?: AnalyserNode
  private tailGate?: GainNode
  private sources: AudioBufferSourceNode[] = []
  private clipLevels: GainNode[] = []
  private channels = new Map<string, TrackChannel>()
  private buffers = new Map<string, AudioBuffer>()
  private capture?: Capture
  private microphone = new MicrophoneInput()
  private monitor?: { trackId: string; channel: TrackChannel; level: GainNode }
  private inputDeviceId = ''
  private latencyMode: LatencyMode = 'interactive'
  private monitorVolume = 0.5
  private inputGeneration = 0
  private recordingTrackId?: string
  private finishing?: Promise<Awaited<ReturnType<AudioEngine['completeRecording']>>>
  private workletReady = false
  private anchor = 0
  private offset = 0
  private stateValue: TransportState = 'stopped'
  onInterrupted?: () => void
  onCaptureEnded?: () => void
  onInputChanged?: () => void
  onInputInterrupted?: () => void

  constructor() {
    this.microphone.onChanged = () => this.onInputChanged?.()
    this.microphone.onEnded = () => {
      this.releaseInput()
      this.onInputInterrupted?.()
    }
  }

  get inputStatus() {
    const track = this.microphone.connection?.stream.getAudioTracks()[0]
    const settings = track?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined
    const reported = (value?: number) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
    return {
      active: track?.readyState === 'live',
      muted: track?.muted ?? false,
      monitorTrackId: this.monitor?.trackId ?? null,
      volume: this.monitorVolume,
      deviceId: this.inputDeviceId,
      deviceLabel: track?.label ?? '',
      latencyMode: this.latencyMode,
      inputLatency: reported(settings?.latency),
      baseLatency: reported(this.context?.baseLatency),
      outputLatency: reported(this.context?.outputLatency),
      sampleRate: this.context?.sampleRate ?? null,
    }
  }

  async configureInput(deviceId: string, latencyMode: LatencyMode) {
    if (this.capture || this.microphone.connection || this.stateValue === 'playing')
      throw new Error(
        'Detén el transporte y desactiva la monitorización para cambiar la entrada o latencia.',
      )
    if (!['interactive', 'balanced'].includes(latencyMode)) return
    this.releaseInput()
    if (latencyMode !== this.latencyMode && this.context) {
      this.clearSources()
      const context = this.context
      context.onstatechange = null
      await context.close()
      this.master?.disconnect()
      this.tailGate?.disconnect()
      this.analyser?.disconnect()
      this.context = undefined
      this.master = this.tailGate = undefined
      this.analyser = undefined
      this.workletReady = false
    }
    this.inputDeviceId = deviceId
    this.latencyMode = latencyMode
    this.onInputChanged?.()
  }

  setMonitorVolume(value: number) {
    if (!Number.isFinite(value)) return
    this.monitorVolume = Math.max(0, Math.min(1, value))
    this.monitor?.level.gain.setTargetAtTime(
      this.monitorVolume,
      this.getContext().currentTime,
      0.01,
    )
    this.onInputChanged?.()
  }

  private disconnectMonitor() {
    const monitor = this.monitor
    if (!monitor) return
    this.microphone.connection?.mono.disconnect(monitor.channel.input)
    monitor.level.disconnect()
    monitor.channel.dispose()
    this.monitor = undefined
  }

  private async fadeMonitorOut() {
    const monitor = this.monitor
    if (!monitor) return
    if (this.context?.state === 'running') {
      monitor.level.gain.setTargetAtTime(0, this.context.currentTime, 0.003)
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    if (this.monitor === monitor) this.disconnectMonitor()
  }

  private connectMonitor(project: Project, trackId: string) {
    const track = project.tracks.find((track) => track.id === trackId && track.kind !== 'beat')
    const input = this.microphone.connection
    if (!track || !input) throw new Error('Selecciona una pista de voz con una entrada disponible.')
    if (this.monitor?.trackId === trackId) {
      this.updateMix(project)
      return
    }
    const context = this.getContext()
    const level = context.createGain()
    level.gain.value = 0
    let channel: TrackChannel | undefined
    try {
      // Same track DSP factory as playback/export, instantiated once for the live input.
      // This separate source needs its own post-FX listening level; it never feeds the recorder.
      channel = createTrackChannel(context, track, project, level, { monitor: true })
      this.disconnectMonitor()
      level.connect(this.master!)
      input.mono.connect(channel.input)
      this.monitor = { trackId, channel, level }
      level.gain.setTargetAtTime(this.monitorVolume, context.currentTime, 0.01)
      this.updateMix(project)
      this.onInputChanged?.()
    } catch (error) {
      if (channel && this.monitor?.channel === channel) {
        input.mono.disconnect(channel.input)
        this.monitor = undefined
      }
      channel?.dispose()
      level.disconnect()
      throw error
    }
  }

  async setMonitoring(project: Project, trackId: string | null) {
    const generation = ++this.inputGeneration
    if (trackId === null) {
      await this.fadeMonitorOut()
      if (generation !== this.inputGeneration) return
      if (!this.capture) this.microphone.close()
      this.onInputChanged?.()
      return
    }
    if (this.capture && this.recordingTrackId !== trackId)
      throw new Error('Durante una toma solo se puede monitorizar la pista que se está grabando.')
    if (!project.tracks.some((track) => track.id === trackId && track.kind !== 'beat'))
      throw new Error('Selecciona una pista de voz para monitorizar.')
    try {
      const context = await this.ready()
      if (generation !== this.inputGeneration) return
      await this.microphone.open(context, this.inputDeviceId, this.latencyMode)
      if (generation !== this.inputGeneration) return
      await this.ready()
      if (generation !== this.inputGeneration) return
      if (this.monitor && this.monitor.trackId !== trackId) await this.fadeMonitorOut()
      if (generation !== this.inputGeneration) return
      this.connectMonitor(project, trackId)
    } catch (error) {
      if (generation !== this.inputGeneration) return
      if (!this.capture && !this.monitor) this.microphone.close()
      throw error
    }
  }

  /** Safety shutdown also invalidates a permission request that is still pending. */
  releaseInput() {
    this.inputGeneration++
    this.disconnectMonitor()
    this.microphone.close()
    this.onInputChanged?.()
  }

  get state() {
    return this.stateValue
  }
  get sampleRate() {
    return this.context?.sampleRate ?? 48000
  }
  get position() {
    return this.stateValue === 'playing' || this.stateValue === 'recording'
      ? this.offset + Math.max(0, (this.context?.currentTime ?? 0) - this.anchor)
      : this.offset
  }
  get decodedBytes() {
    return [...this.buffers.values()].reduce((sum, b) => sum + b.length * b.numberOfChannels * 4, 0)
  }
  getBuffer(id: string) {
    return this.buffers.get(id)
  }
  setBuffer(id: string, buffer: AudioBuffer) {
    this.buffers.set(id, buffer)
  }
  removeBuffer(id: string) {
    this.buffers.delete(id)
  }
  replaceBuffers(buffers: Map<string, AudioBuffer>) {
    this.buffers = buffers
  }

  private getContext() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: this.latencyMode, sampleRate: 48000 })
      this.master = this.context.createGain()
      this.analyser = this.context.createAnalyser()
      this.tailGate = this.context.createGain()
      this.analyser.fftSize = 2048
      // Only scheduled clips pass through the end-of-song fade; monitoring stays independent.
      this.tailGate.connect(this.master).connect(this.analyser).connect(this.context.destination)
      this.context.onstatechange = () => {
        if (this.context?.state !== 'running') {
          const hadInput = !!this.microphone.connection
          this.releaseInput()
          if (hadInput) this.onInputInterrupted?.()
          else if (this.stateValue === 'playing' || this.stateValue === 'recording')
            this.onInterrupted?.()
        }
      }
    }
    return this.context
  }

  async ready() {
    const context = this.getContext()
    if (context.state !== 'running') await context.resume()
    if (context.state !== 'running')
      throw new Error('El navegador ha suspendido el audio. Pulsa Reproducir de nuevo.')
    await prepareEffects(context)
    return context
  }

  async decode(blob: Blob) {
    return this.getContext().decodeAudioData(await blob.arrayBuffer())
  }

  private clearSources() {
    this.sources.forEach((source) => {
      try {
        source.stop()
      } catch {
        /* Already ended. */
      }
      source.disconnect()
    })
    this.sources = []
    this.clipLevels.forEach(node => node.disconnect())
    this.clipLevels = []
    this.channels.forEach((channel) => channel.dispose())
    this.channels.clear()
  }

  private schedule(project: Project, position: number, when: number, includeTailFade = true) {
    const context = this.getContext()
    this.clearSources()
    const latencyFrames = Math.max(0, ...project.tracks.map((track) => pitchFrames(track.effects)))
    // Warm the detector from earlier audio after a seek; gate this pre-roll from the speakers.
    const preRoll = latencyFrames ? Math.min(position, 0.15) : 0
    this.offset = position
    this.anchor = when + latencyFrames / context.sampleRate + preRoll
    this.master!.gain.value = project.masterVolume
    this.tailGate!.gain.cancelScheduledValues(context.currentTime)
    this.tailGate!.gain.setValueAtTime(0, context.currentTime)
    this.tailGate!.gain.setValueAtTime(1, this.anchor)
    if (includeTailFade) this.scheduleTailFade(project)
    for (const track of project.tracks) {
      const channel = createTrackChannel(context, track, project, this.tailGate!, { latencyFrames })
      this.channels.set(track.id, channel)
      for (const clip of playableClips(track)) {
        const buffer = this.buffers.get(clip.assetId)
        if (!buffer) continue
        const scheduled = scheduleClip(context, buffer, clip, position - preRoll, when, channel.input)
        if (scheduled) { this.sources.push(scheduled.source); this.clipLevels.push(scheduled.level) }
      }
    }
  }

  private scheduleTailFade(project: Project) {
    const context = this.getContext()
    const gain = this.tailGate!.gain
    const duration = projectPlaybackDuration(project)
    gain.cancelScheduledValues(context.currentTime)
    gain.setValueAtTime(context.currentTime < this.anchor ? 0 : 1, context.currentTime)
    if (context.currentTime < this.anchor) gain.setValueAtTime(1, this.anchor)
    if (duration <= projectDuration(project)) return
    const end = this.anchor + duration - this.offset
    const start = this.anchor + Math.max(projectDuration(project), duration - 0.03) - this.offset
    if (end > context.currentTime) {
      gain.setValueAtTime(1, Math.max(context.currentTime, start))
      gain.linearRampToValueAtTime(0, end)
    }
  }

  async play(project: Project, position = this.position) {
    const context = await this.ready()
    this.schedule(project, position, context.currentTime + 0.06)
    this.stateValue = 'playing'
  }

  pause() {
    this.offset = this.position
    this.stateValue = 'paused'
    this.clearSources()
  }

  stop() {
    this.stateValue = 'stopped'
    this.offset = 0
    this.clearSources()
  }

  seek(position: number, project: Project) {
    if (this.stateValue === 'recording') return
    this.offset = Math.max(0, Math.min(MAX_SECONDS + MAX_EFFECT_TAIL, position))
    if (this.stateValue === 'playing')
      this.schedule(project, this.offset, this.getContext().currentTime + 0.02)
  }

  updateMix(project: Project) {
    const latencyChanged = project.tracks.some((track) => {
      const channel = this.channels.get(track.id)
      return channel && channel.latencyFrames !== pitchFrames(track.effects)
    })
    if (latencyChanged && this.stateValue === 'recording')
      throw new Error(
        'Termina la toma antes de añadir o quitar afinación. Sus parámetros y bypass sí se pueden ajustar.',
      )
    if (latencyChanged && this.stateValue === 'playing')
      this.schedule(project, this.position, this.getContext().currentTime + 0.06)
    const now = this.context?.currentTime ?? 0
    this.master?.gain.setTargetAtTime(project.masterVolume, now, 0.01)
    for (const track of project.tracks) {
      const targets = [this.channels.get(track.id)]
      if (this.monitor?.trackId === track.id) targets.push(this.monitor.channel)
      for (const channel of targets) {
        channel?.gain.gain.setTargetAtTime(
          isAudible(track, project.tracks) ? track.volume : 0,
          now,
          0.01,
        )
        channel?.pan.pan.setTargetAtTime(track.pan, now, 0.01)
        channel?.updateEffects(track.effects)
      }
    }
    if (this.stateValue === 'playing') this.scheduleTailFade(project)
  }

  reschedule(project: Project) {
    if (this.stateValue === 'playing')
      this.schedule(project, this.position, this.getContext().currentTime + 0.02)
  }

  /** Capture and playback are gated by the same AudioContext frame clock. */
  async startRecording(project: Project, position: number, maxDuration: number, trackId?: string) {
    if (this.capture || this.finishing) throw new Error('Ya hay una toma en curso.')
    const generation = ++this.inputGeneration
    const context = await this.ready()
    if (!navigator.mediaDevices?.getUserMedia || !context.audioWorklet)
      throw new Error('La grabación necesita HTTPS o localhost y un navegador con AudioWorklet.')
    if (!this.workletReady) {
      await context.audioWorklet.addModule(recorderUrl)
      this.workletReady = true
    }
    try {
      if (generation !== this.inputGeneration)
        throw new DOMException('Grabación cancelada.', 'AbortError')
      const input = await this.microphone.open(context, this.inputDeviceId, this.latencyMode)
      await this.ready()
      if (generation !== this.inputGeneration)
        throw new DOMException('Grabación cancelada.', 'AbortError')
      const node = new AudioWorkletNode(context, 'vox-pcm-recorder', {
        channelCount: 1,
        channelCountMode: 'explicit',
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      })
      node.onprocessorerror = () => this.onInterrupted?.()
      input.mono.connect(node).connect(context.destination)
      const chunks: Float32Array[] = []
      const done = new Promise<Float32Array>((resolve) => {
        node.port.onmessage = ({ data }) => {
          if (data.type === 'chunk') chunks.push(data.chunk)
          if (data.type === 'done') {
            const pcm = new Float32Array(data.frames)
            let index = 0
            for (const chunk of chunks) {
              pcm.set(chunk, index)
              index += chunk.length
            }
            chunks.length = 0
            resolve(pcm)
            this.onCaptureEnded?.()
          }
        }
      })
      this.capture = {
        node,
        chunks,
        done,
        disconnect: () => {
          // The shared microphone may have been disconnected by an interruption already.
          if (this.microphone.connection === input) input.mono.disconnect(node)
          node.onprocessorerror = null
          node.disconnect()
          node.port.close()
        },
      }
      this.recordingTrackId = trackId
      if (this.monitor && trackId) {
        if (this.monitor.trackId !== trackId) await this.fadeMonitorOut()
        if (generation !== this.inputGeneration)
          throw new DOMException('Grabación cancelada.', 'AbortError')
        this.connectMonitor(project, trackId)
      }
      const sourceFrame = Math.ceil((context.currentTime + 0.12) * context.sampleRate)
      this.schedule(project, position, sourceFrame / context.sampleRate, false)
      // Capture begins with the audible, latency-compensated beat, not the earlier DSP input.
      const startFrame = Math.round(this.anchor * context.sampleRate)
      node.port.postMessage({
        type: 'start',
        startFrame,
        endFrame: startFrame + Math.floor(maxDuration * context.sampleRate),
      })
      this.stateValue = 'recording'
    } catch (error) {
      this.capture?.disconnect()
      this.capture = undefined
      this.recordingTrackId = undefined
      if (!this.monitor) this.microphone.close()
      throw error
    }
  }

  finishRecording() {
    if (this.finishing) return this.finishing
    this.finishing = this.completeRecording().finally(() => {
      this.finishing = undefined
    })
    return this.finishing
  }

  private async completeRecording() {
    const capture = this.capture
    if (!capture) return null
    this.pause()
    capture.node.port.postMessage({
      type: this.context?.state === 'running' ? 'stop' : 'flush',
      endFrame: Math.ceil(this.getContext().currentTime * this.sampleRate),
    })
    // A suspended graph still handles port messages. Preserve accumulated PCM if the renderer fails.
    let timeout: ReturnType<typeof setTimeout> | undefined
    let recovered = false
    const fallback = new Promise<Float32Array>((resolve) => {
      timeout = setTimeout(() => {
        recovered = true
        const pcm = new Float32Array(capture.chunks.reduce((n, chunk) => n + chunk.length, 0))
        let at = 0
        capture.chunks.forEach((chunk) => {
          pcm.set(chunk, at)
          at += chunk.length
        })
        resolve(pcm)
      }, 2500)
    })
    const pcm = await Promise.race([capture.done, fallback])
    clearTimeout(timeout)
    capture.disconnect()
    this.capture = undefined
    this.recordingTrackId = undefined
    if (!this.monitor) this.microphone.close()
    this.onInputChanged?.()
    if (!pcm.length) return null
    const buffer = this.getContext().createBuffer(1, pcm.length, this.sampleRate)
    buffer.getChannelData(0).set(pcm)
    return {
      buffer,
      blob: new Blob([encodeWav([pcm], this.sampleRate)], { type: 'audio/wav' }),
      recovered,
    }
  }

  readLevels() {
    const peak = (node?: AnalyserNode) => {
      if (!node) return 0
      const data = new Float32Array(node.fftSize)
      node.getFloatTimeDomainData(data)
      let value = 0
      for (const sample of data) value = Math.max(value, Math.abs(sample))
      return value
    }
    return { master: peak(this.analyser), input: peak(this.microphone.connection?.analyser) }
  }

  async render(project: Project): Promise<{ blob: Blob; peak: number }> {
    const audioDuration = projectDuration(project)
    const duration = projectPlaybackDuration(project)
    if (!audioDuration) throw new Error('Añade audio antes de exportar la mezcla.')
    if (audioDuration > MAX_SECONDS) throw new Error('La sesión supera el límite de 15 minutos.')
    const sampleRate = 48000
    // prepareEffects on the live context supplies the exact latency reported by the WASM engine.
    await prepareEffects(this.getContext())
    const latencyFrames = Math.max(0, ...project.tracks.map((track) => pitchFrames(track.effects)))
    const latency = latencyFrames / sampleRate
    const offline = new OfflineAudioContext(
      2,
      Math.ceil(duration * sampleRate) + latencyFrames,
      sampleRate,
    )
    await prepareEffects(offline)
    const master = offline.createGain()
    master.gain.value = project.masterVolume
    master.connect(offline.destination)
    // A bounded final fade avoids a discontinuity if a long serial delay chain reaches the tail limit.
    if (duration > audioDuration) {
      master.gain.setValueAtTime(
        project.masterVolume,
        latency + Math.max(audioDuration, duration - 0.03),
      )
      master.gain.linearRampToValueAtTime(0, latency + duration)
    }
    const channelsToDispose: TrackChannel[] = []
    const clipNodes: { source: AudioBufferSourceNode; level: GainNode }[] = []
    try {
      for (const track of project.tracks) {
        const channel = createTrackChannel(offline, track, project, master, { latencyFrames })
        channelsToDispose.push(channel)
        for (const clip of playableClips(track)) {
          const buffer = this.buffers.get(clip.assetId)
          if (!buffer)
            throw new Error('Falta el audio de un clip. Vuelve a abrir el proyecto.')
          const scheduled = scheduleClip(offline, buffer, clip, 0, 0, channel.input)
          if (scheduled) clipNodes.push(scheduled)
        }
      }
      const result = await offline.startRendering()
      const channels = [
        result.getChannelData(0).subarray(latencyFrames),
        result.getChannelData(1).subarray(latencyFrames),
      ]
      let peak = 0
      channels.forEach((channel) => {
        for (const sample of channel) {
          if (!Number.isFinite(sample))
            throw new Error(
              'El procesamiento produjo audio no válido. Revisa la cadena de efectos.',
            )
          peak = Math.max(peak, Math.abs(sample))
        }
      })
      return { blob: new Blob([encodeWav(channels, sampleRate)], { type: 'audio/wav' }), peak }
    } finally {
      clipNodes.forEach(({ source, level }) => { source.disconnect(); level.disconnect() })
      channelsToDispose.forEach((channel) => channel.dispose())
      master.disconnect()
    }
  }
}

export const audioEngine = new AudioEngine()
