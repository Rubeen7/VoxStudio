// Linked peak compressor / complementary split-band de-esser. No look-ahead or frame delay.
class VoxDynamics extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      ['threshold', -24, -60, 0],
      ['ratio', 4, 1, 20],
      ['attack', 10, 0.1, 100],
      ['release', 120, 10, 1000],
      ['knee', 6, 0, 24],
      ['makeup', 0, -24, 12],
      ['frequency', 5500, 2500, 10000],
      ['reduction', 12, 0, 60],
    ].map(([name, defaultValue, minValue, maxValue]) => ({
      name,
      defaultValue,
      minValue,
      maxValue,
      automationRate: 'k-rate',
    }))
  }
  constructor(options) {
    super()
    this.deesser = options.processorOptions?.mode === 'deesser'
    this.low = new Float64Array(2)
    this.envelope = 0
    this.gain = 1
    this.active = true
    this.port.onmessage = ({ data }) => {
      if (data === 'dispose') this.active = false
    }
  }
  process(inputs, outputs, parameters) {
    if (!this.active) return false
    const input = inputs[0]
    const output = outputs[0]
    if (!output?.length) return true
    const attack = Math.exp(-1 / (parameters.attack[0] * 0.001 * sampleRate))
    const release = Math.exp(-1 / (parameters.release[0] * 0.001 * sampleRate))
    const cutoff = Math.exp(
      (-2 * Math.PI * Math.min(parameters.frequency[0], sampleRate * 0.45)) / sampleRate,
    )
    const threshold = parameters.threshold[0]
    const slope = 1 - 1 / parameters.ratio[0]
    const knee = parameters.knee[0]
    const makeup = 10 ** (parameters.makeup[0] / 20)
    for (let i = 0; i < output[0].length; i++) {
      let peak = 0
      for (let c = 0; c < Math.min(2, output.length); c++) {
        const x = input[c]?.[i] ?? 0
        this.low[c] = (1 - cutoff) * x + cutoff * this.low[c]
        peak = Math.max(peak, Math.abs(this.deesser ? x - this.low[c] : x))
      }
      this.envelope = Math.max(peak, this.envelope * release)
      const over = 20 * Math.log10(Math.max(1e-12, this.envelope)) - threshold
      let reduction =
        knee > 0 && over > -knee / 2 && over < knee / 2
          ? (slope * (over + knee / 2) ** 2) / (2 * knee)
          : slope * Math.max(0, over)
      if (this.deesser) reduction = Math.min(reduction, parameters.reduction[0])
      const target = 10 ** (-reduction / 20)
      const coefficient = target < this.gain ? attack : release
      this.gain = target + coefficient * (this.gain - target)
      for (let c = 0; c < output.length; c++) {
        const x = input[c]?.[i] ?? 0
        output[c][i] = this.deesser
          ? (this.low[c] + (x - this.low[c]) * this.gain) * makeup
          : x * this.gain * makeup
      }
    }
    return true
  }
}
registerProcessor('vox-dynamics', VoxDynamics)

// A native graph feedback cycle can add a render quantum on every repeat.
// Keep feedback inside the processor so each echo uses exactly the requested interval.
class VoxDelay extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'time', defaultValue: 280, minValue: 10, maxValue: 1000, automationRate: 'a-rate' },
      { name: 'feedback', defaultValue: 30, minValue: 0, maxValue: 75, automationRate: 'k-rate' },
    ]
  }
  constructor() {
    super()
    this.length = Math.ceil(sampleRate * 1.1) + 2
    this.buffers = [new Float32Array(this.length), new Float32Array(this.length)]
    this.index = 0
    this.active = true
    this.port.onmessage = ({ data }) => {
      if (data === 'dispose') this.active = false
    }
  }
  process(inputs, outputs, parameters) {
    if (!this.active) return false
    const input = inputs[0]
    const output = outputs[0]
    if (!output?.length) return true
    const feedback = parameters.feedback[0] / 100
    for (let i = 0; i < output[0].length; i++) {
      const delay = (parameters.time[parameters.time.length === 1 ? 0 : i] * sampleRate) / 1000
      const position = (this.index - delay + this.length) % this.length
      const from = Math.floor(position)
      const fraction = position - from
      const to = (from + 1) % this.length
      for (let c = 0; c < Math.min(2, output.length); c++) {
        const ring = this.buffers[c]
        const value = ring[from] * (1 - fraction) + ring[to] * fraction
        ring[this.index] = (input[c]?.[i] ?? 0) + value * feedback
        output[c][i] = value
      }
      this.index = (this.index + 1) % this.length
    }
    return true
  }
}
registerProcessor('vox-delay', VoxDelay)
