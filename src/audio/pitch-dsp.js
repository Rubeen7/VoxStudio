// Original VOX pitch tracking/control code; Signalsmith's MIT WASM does the spectral synthesis.
// The adapter ABI is pinned to signalsmith-stretch 1.3.2 (see scripts/extract-stretch.mjs).
export const PITCH_BLOCK = 4096
export const PITCH_HOP = 512

export class Stretch {
  constructor(module) {
    let memory
    let seed = 0x13579bdf
    const instance = new WebAssembly.Instance(module, {
      a: {
        a: (pointer, size) => {
          const bytes = new Uint8Array(memory.buffer)
          for (let i = 0; i < size; i++) {
            seed ^= seed << 13
            seed ^= seed >>> 17
            seed ^= seed << 5
            bytes[pointer + i] = seed & 255
          }
          return 0
        },
        b: (size) => {
          try {
            memory.grow(Math.max(0, Math.ceil((size - memory.buffer.byteLength) / 65536)))
            return 1
          } catch {
            return 0
          }
        },
        c: (to, from, size) => new Uint8Array(memory.buffer).copyWithin(to, from, from + size),
        d: () => {
          throw new Error('Signalsmith Stretch: WASM aborted.')
        },
      },
    })
    const e = instance.exports
    memory = e.e
    this.memory = memory
    this.api = {
      initialize: e.f,
      setBuffers: e.h,
      inputLatency: e.k,
      outputLatency: e.l,
      reset: e.m,
      configure: e.p,
      transpose: e.r,
      formant: e.t,
      formantBase: e.u,
      process: e.w,
    }
    this.api.initialize()
    // A short synthesis hop reduces steady-tone pitch bias in small corrections.
    // Pitch detection still runs every 512 frames; synthesis runs every render quantum.
    this.api.configure(2, PITCH_BLOCK, 128, 1)
    this.api.reset()
    this.latency = this.api.inputLatency() + this.api.outputLatency()
    this.pointer = this.api.setBuffers(2, 128)
    this.heap = new Float32Array(memory.buffer)
    this.api.formant(0, 1)
  }

  process(input, output, semitones, fundamental, sampleRate) {
    // Memory views must be refreshed after a possible WASM allocation.
    if (this.heap.buffer !== this.memory.buffer) this.heap = new Float32Array(this.memory.buffer)
    const start = this.pointer / 4
    for (let c = 0; c < 2; c++) {
      const source = input[c] ?? input[0]
      const offset = start + c * 128
      for (let i = 0; i < 128; i++) this.heap[offset + i] = source?.[i] ?? 0
    }
    this.api.transpose(semitones, 8000 / sampleRate)
    this.api.formantBase(fundamental > 0 ? fundamental / sampleRate : 0)
    this.api.process(128, 128)
    if (this.heap.buffer !== this.memory.buffer) this.heap = new Float32Array(this.memory.buffer)
    for (let c = 0; c < 2; c++) {
      const offset = start + (c + 2) * 128
      for (let i = 0; i < 128; i++) output[c][i] = this.heap[offset + i]
    }
  }
}

const scales = [
  [0, 2, 4, 5, 7, 9, 11],
  [0, 2, 3, 5, 7, 8, 10],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
]
export function nearestNote(midi, key, scale, previous = null) {
  const allowed = scales[scale] ?? scales[2]
  const accepts = (note) => allowed.includes((((note - key) % 12) + 12) % 12)
  let best = Math.round(midi)
  let distance = Infinity
  for (let note = Math.floor(midi) - 2; note <= Math.ceil(midi) + 2; note++) {
    if (accepts(note) && Math.abs(note - midi) < distance) {
      best = note
      distance = Math.abs(note - midi)
    }
  }
  // Eight cents of hysteresis prevents boundary chatter; never retains a disallowed note.
  return previous !== null && accepts(previous) && Math.abs(previous - midi) <= distance + 0.08
    ? previous
    : best
}

export class PitchDetector {
  constructor(sampleRate) {
    this.sampleRate = sampleRate / 4
    this.ring = new Float32Array(1024)
    this.window = new Float32Array(1024)
    this.difference = new Float32Array(Math.ceil(this.sampleRate / 70) + 2)
    this.rawDifference = new Float32Array(this.difference.length)
    this.index = 0
    this.decimation = 0
    this.filled = 0
    // Two-pole Butterworth anti-alias filter, before decimation to 11/12 kHz.
    const w = (2 * Math.PI * 2200) / sampleRate
    const cos = Math.cos(w),
      alpha = Math.sin(w) / Math.SQRT2,
      a0 = 1 + alpha
    this.b0 = (1 - cos) / (2 * a0)
    this.b1 = (1 - cos) / a0
    this.a1 = (-2 * cos) / a0
    this.a2 = (1 - alpha) / a0
    this.z1 = 0
    this.z2 = 0
  }

  push(input) {
    for (let i = 0; i < 128; i++) {
      const x = input?.[i] ?? 0
      const y = this.b0 * x + this.z1
      this.z1 = this.b1 * x - this.a1 * y + this.z2
      this.z2 = this.b0 * x - this.a2 * y
      if (++this.decimation === 4) {
        this.decimation = 0
        this.ring[this.index] = y
        this.index = (this.index + 1) % 1024
        this.filled++
      }
    }
  }

  detect() {
    if (this.filled < 1024) return null
    let energy = 0
    for (let i = 0; i < 1024; i++) {
      const x = this.ring[(this.index + i) % 1024]
      this.window[i] = x
      energy += x * x
    }
    if (energy / 1024 < 0.000004) return null // -54 dBFS RMS confidence floor
    const max = Math.floor(this.sampleRate / 70)
    const min = Math.floor(this.sampleRate / 1000)
    const length = 1024 - max
    let running = 0
    this.difference[0] = 1
    for (let lag = 1; lag <= max; lag++) {
      let sum = 0
      for (let j = 0; j < length; j++) {
        const delta = this.window[j] - this.window[j + lag]
        sum += delta * delta
      }
      running += sum
      this.rawDifference[lag] = sum
      this.difference[lag] = running > 0 ? (sum * lag) / running : 1
    }
    for (let lag = min; lag < max - 1; lag++) {
      if (this.difference[lag] >= 0.15) continue
      while (lag < max - 1 && this.difference[lag + 1] < this.difference[lag]) lag++
      // Refine on the unnormalized difference to avoid CMNDF's upward frequency bias.
      const a = this.rawDifference[lag - 1],
        b = this.rawDifference[lag],
        c = this.rawDifference[lag + 1]
      const denominator = 2 * (a - 2 * b + c)
      const refined = lag + (Math.abs(denominator) > 1e-12 ? (a - c) / denominator : 0)
      const frequency = this.sampleRate / refined
      if (frequency < 70 || frequency > 1000) return null
      return { frequency, confidence: 1 - this.difference[lag] }
    }
    return null
  }
}

export class PitchController {
  constructor(sampleRate) {
    this.sampleRate = sampleRate
    this.note = null
    this.held = 0
    this.trend = 0
    this.correction = 0
    this.frequency = 0
  }
  update(detected, params) {
    const dt = PITCH_HOP / this.sampleRate
    let desired = 0
    if (detected) {
      const midi = 69 + 12 * Math.log2(detected.frequency / 440)
      const target = nearestNote(midi, Math.round(params.key), Math.round(params.scale), this.note)
      if (target !== this.note) {
        this.held = 0
        this.trend = midi
      } else this.held += dt
      this.note = target
      this.frequency = detected.frequency
      this.trend += (midi - this.trend) * (1 - Math.exp(-dt / 0.15))
      // On sustained notes, remove the slow drift while retaining part of the vibrato.
      const human = (params.humanize / 100) * Math.min(1, Math.max(0, (this.held - 0.12) / 0.18))
      desired = ((target - (midi * (1 - human) + this.trend * human)) * params.amount) / 100
    } else {
      this.note = null
      this.held = 0
      this.frequency = 0
    }
    const tau = Math.max(0.002, params.retune / 1000)
    this.correction += (desired - this.correction) * (1 - Math.exp(-dt / tau))
    return this.correction
  }
}
