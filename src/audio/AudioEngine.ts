import type { Project } from '../model/project'
import { clipWindow, isAudible, MAX_SECONDS, projectDuration } from '../model/project'
import { encodeWav } from './wav'
import recorderUrl from './recorder.worklet.js?url'
import { createTrackChannel, type TrackChannel } from './graph'

export type TransportState = 'stopped' | 'playing' | 'paused' | 'recording'
type Capture = {
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  node: AudioWorkletNode
  analyser: AnalyserNode
  chunks: Float32Array[]
  done: Promise<Float32Array>
  disconnect: () => void
}

export class AudioEngine {
  private context?: AudioContext
  private master?: GainNode
  private analyser?: AnalyserNode
  private sources: AudioBufferSourceNode[] = []
  private channels = new Map<string, TrackChannel>()
  private buffers = new Map<string, AudioBuffer>()
  private capture?: Capture
  private workletReady = false
  private anchor = 0
  private offset = 0
  private stateValue: TransportState = 'stopped'
  onInterrupted?: () => void
  onCaptureEnded?: () => void

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
      this.context = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 })
      this.master = this.context.createGain()
      this.analyser = this.context.createAnalyser()
      this.analyser.fftSize = 2048
      this.master.connect(this.analyser).connect(this.context.destination)
      this.context.onstatechange = () => {
        if (
          this.context?.state !== 'running' &&
          (this.stateValue === 'playing' || this.stateValue === 'recording')
        )
          this.onInterrupted?.()
      }
    }
    return this.context
  }

  async ready() {
    const context = this.getContext()
    if (context.state !== 'running') await context.resume()
    if (context.state !== 'running')
      throw new Error('El navegador ha suspendido el audio. Pulsa Reproducir de nuevo.')
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
    this.channels.forEach((channel) => channel.dispose())
    this.channels.clear()
  }

  private schedule(project: Project, position: number, when: number) {
    const context = this.getContext()
    this.clearSources()
    this.offset = position
    this.anchor = when
    this.master!.gain.value = project.masterVolume
    for (const track of project.tracks) {
      const channel = createTrackChannel(context, track, project, this.master!)
      this.channels.set(track.id, channel)
      for (const clip of track.clips) {
        const buffer = this.buffers.get(clip.assetId)
        const window = clipWindow(clip, position)
        if (!buffer || !window) continue
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(channel.gain)
        source.start(
          when + window.delay,
          window.offset,
          Math.min(window.duration, buffer.duration - window.offset),
        )
        this.sources.push(source)
      }
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
    this.offset = Math.max(0, Math.min(MAX_SECONDS, position))
    if (this.stateValue === 'playing')
      this.schedule(project, this.offset, this.getContext().currentTime + 0.02)
  }

  updateMix(project: Project) {
    const now = this.context?.currentTime ?? 0
    this.master?.gain.setTargetAtTime(project.masterVolume, now, 0.01)
    for (const track of project.tracks) {
      const channel = this.channels.get(track.id)
      channel?.gain.gain.setTargetAtTime(
        isAudible(track, project.tracks) ? track.volume : 0,
        now,
        0.01,
      )
      channel?.pan.pan.setTargetAtTime(track.pan, now, 0.01)
    }
  }

  reschedule(project: Project) {
    if (this.stateValue === 'playing')
      this.schedule(project, this.position, this.getContext().currentTime + 0.02)
  }

  /** Capture and playback are gated by the same AudioContext frame clock. */
  async startRecording(project: Project, position: number, maxDuration: number) {
    const context = await this.ready()
    if (!navigator.mediaDevices?.getUserMedia || !context.audioWorklet)
      throw new Error('La grabación necesita HTTPS o localhost y un navegador con AudioWorklet.')
    if (!this.workletReady) {
      await context.audioWorklet.addModule(recorderUrl)
      this.workletReady = true
    }
    let stream: MediaStream | undefined
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      })
      await this.ready()
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 2048
      const node = new AudioWorkletNode(context, 'vox-pcm-recorder', {
        channelCount: 1,
        channelCountMode: 'explicit',
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      })
      node.onprocessorerror = () => this.onInterrupted?.()
      source.connect(analyser)
      source.connect(node).connect(context.destination)
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
      const activeStream = stream
      this.capture = {
        stream,
        source,
        node,
        analyser,
        chunks,
        done,
        disconnect: () => {
          activeStream.getTracks().forEach((track) => {
            track.onended = null
            track.stop()
          })
          source.disconnect()
          analyser.disconnect()
          node.onprocessorerror = null
          node.disconnect()
          node.port.close()
        },
      }
      stream.getAudioTracks().forEach((track) => {
        track.onended = () => this.onInterrupted?.()
      })
      const startFrame = Math.ceil((context.currentTime + 0.12) * context.sampleRate)
      node.port.postMessage({
        type: 'start',
        startFrame,
        endFrame: startFrame + Math.floor(maxDuration * context.sampleRate),
      })
      this.schedule(project, position, startFrame / context.sampleRate)
      this.stateValue = 'recording'
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop())
      this.capture?.disconnect()
      this.capture = undefined
      throw error
    }
  }

  async finishRecording() {
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
    return { master: peak(this.analyser), input: peak(this.capture?.analyser) }
  }

  async render(project: Project): Promise<{ blob: Blob; peak: number }> {
    const duration = projectDuration(project)
    if (!duration) throw new Error('Añade audio antes de exportar la mezcla.')
    if (duration > MAX_SECONDS) throw new Error('La sesión supera el límite de 15 minutos.')
    const sampleRate = 48000
    const offline = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate)
    const master = offline.createGain()
    master.gain.value = project.masterVolume
    master.connect(offline.destination)
    for (const track of project.tracks) {
      const channel = createTrackChannel(offline, track, project, master)
      for (const clip of track.clips) {
        const buffer = this.buffers.get(clip.assetId)
        const window = clipWindow(clip, 0)
        if (!buffer || !window)
          throw new Error('Falta el audio de un clip. Vuelve a abrir el proyecto.')
        const source = offline.createBufferSource()
        source.buffer = buffer
        source.connect(channel.gain)
        source.start(window.delay, window.offset, window.duration)
      }
    }
    const result = await offline.startRendering()
    const channels = [result.getChannelData(0), result.getChannelData(1)]
    let peak = 0
    channels.forEach((channel) => {
      for (const sample of channel) peak = Math.max(peak, Math.abs(sample))
    })
    return { blob: new Blob([encodeWav(channels, sampleRate)], { type: 'audio/wav' }), peak }
  }
}

export const audioEngine = new AudioEngine()
