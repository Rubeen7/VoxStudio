export type LatencyMode = 'interactive' | 'balanced'

export type MicrophoneConnection = {
  stream: MediaStream
  source: MediaStreamAudioSourceNode
  mono: GainNode
  analyser: AnalyserNode
}

/** One input shared by the dry recorder and the optional listening route. */
export class MicrophoneInput {
  connection?: MicrophoneConnection
  private pending?: Promise<MicrophoneConnection>
  private generation = 0
  private cancelPending?: () => void
  onChanged?: () => void
  onEnded?: () => void

  open(context: AudioContext, deviceId: string, mode: LatencyMode) {
    if (this.connection) return Promise.resolve(this.connection)
    if (this.pending) return this.pending
    if (!navigator.mediaDevices?.getUserMedia)
      return Promise.reject(new Error('El micrófono necesita HTTPS o localhost.'))
    const generation = this.generation
    const supported = navigator.mediaDevices.getSupportedConstraints()
    const constraints: MediaTrackConstraints & { latency?: { ideal: number } } = {
      channelCount: { ideal: 1 },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      ...(deviceId && supported.deviceId ? { deviceId: { exact: deviceId } } : {}),
      ...((supported as MediaTrackSupportedConstraints & { latency?: boolean }).latency
        ? { latency: { ideal: mode === 'interactive' ? 0.01 : 0.04 } }
        : {}),
    }
    const cancelled = new Promise<never>((_, reject) => {
      this.cancelPending = () =>
        reject(new DOMException('Solicitud de micrófono cancelada.', 'AbortError'))
    })
    const request = navigator.mediaDevices
      .getUserMedia({ audio: constraints, video: false })
      .then((stream) => {
        if (generation !== this.generation || context.state === 'closed') {
          stream.getTracks().forEach((track) => track.stop())
          throw new DOMException('Solicitud de micrófono cancelada.', 'AbortError')
        }
        let source: MediaStreamAudioSourceNode | undefined
        let mono: GainNode | undefined
        let analyser: AnalyserNode | undefined
        try {
          if (!stream.getAudioTracks().some((track) => track.readyState === 'live'))
            throw new Error('La entrada de audio se ha desconectado.')
          source = context.createMediaStreamSource(stream)
          mono = context.createGain()
          mono.channelCount = 1
          mono.channelCountMode = 'explicit'
          analyser = context.createAnalyser()
          analyser.fftSize = 2048
          source.connect(mono).connect(analyser)
          this.connection = { stream, source, mono, analyser }
          stream.getAudioTracks().forEach((track) => {
            track.onended = () => this.onEnded?.()
            track.onmute = track.onunmute = () => this.onChanged?.()
          })
          this.onChanged?.()
          return this.connection
        } catch (error) {
          source?.disconnect()
          mono?.disconnect()
          analyser?.disconnect()
          stream.getTracks().forEach((track) => track.stop())
          throw error
        }
      })
    const pending = Promise.race([request, cancelled]).finally(() => {
      if (this.pending === pending) {
        this.pending = undefined
        this.cancelPending = undefined
      }
    })
    this.pending = pending
    return pending
  }

  close() {
    this.generation++
    this.cancelPending?.()
    this.cancelPending = undefined
    this.pending = undefined
    const connection = this.connection
    this.connection = undefined
    if (connection) {
      connection.stream.getTracks().forEach((track) => {
        track.onended = track.onmute = track.onunmute = null
        track.stop()
      })
      connection.source.disconnect()
      connection.mono.disconnect()
      connection.analyser.disconnect()
      this.onChanged?.()
    }
  }
}
