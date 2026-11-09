/* Runs on the audio rendering thread. No timers, codecs or audible monitoring. */
class PcmRecorder extends AudioWorkletProcessor {
  constructor() {
    super()
    this.startFrame = Infinity
    this.endFrame = Infinity
    this.active = false
    this.buffer = new Float32Array(16384)
    this.count = 0
    this.total = 0
    this.port.onmessage = ({ data }) => {
      if (data.type === 'start') {
        this.startFrame = data.startFrame
        this.endFrame = data.endFrame
        this.active = true
      }
      if (data.type === 'stop') {
        this.endFrame = Math.min(this.endFrame, data.endFrame)
        if (currentFrame >= this.endFrame) this.finish()
      }
      if (data.type === 'flush') this.finish()
    }
  }
  flush() {
    if (!this.count) return
    const chunk = this.buffer.slice(0, this.count)
    this.port.postMessage({ type: 'chunk', chunk }, [chunk.buffer])
    this.count = 0
  }
  finish() {
    if (!this.active) return
    this.active = false
    this.flush()
    this.port.postMessage({ type: 'done', frames: this.total })
  }
  process(inputs, outputs) {
    // Unwritten output remains silent, but keeps the node in the rendering graph.
    if (!this.active) return true
    const input = inputs[0]?.[0]
    const length = outputs[0]?.[0]?.length || 128
    for (let i = 0; i < length; i++) {
      const frame = currentFrame + i
      if (frame < this.startFrame) continue
      if (frame >= this.endFrame) {
        this.finish()
        break
      }
      this.buffer[this.count++] = input?.[i] || 0
      this.total++
      if (this.count === this.buffer.length) this.flush()
    }
    return true
  }
}
registerProcessor('vox-pcm-recorder', PcmRecorder)
