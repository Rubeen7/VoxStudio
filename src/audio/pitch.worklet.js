import { Stretch, PitchDetector, PitchController, PITCH_HOP } from './pitch-dsp.js'

class PitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      ['key', 0, 0, 11],
      ['scale', 2, 0, 2],
      ['retune', 90, 0, 300],
      ['amount', 90, 0, 100],
      ['humanize', 35, 0, 100],
      ['mix', 100, 0, 100],
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
    this.stretch = new Stretch(options.processorOptions.module)
    this.detector = new PitchDetector(sampleRate)
    this.controller = new PitchController(sampleRate)
    this.dry = [new Float32Array(this.stretch.latency), new Float32Array(this.stretch.latency)]
    this.wet = [new Float32Array(128), new Float32Array(128)]
    this.position = 0
    this.counter = 0
    this.active = true
    this.params = { key: 0, scale: 2, retune: 90, amount: 90, humanize: 35 }
    this.port.onmessage = ({ data }) => {
      if (data === 'dispose') this.active = false
    }
  }
  process(inputs, outputs, parameters) {
    if (!this.active) return false
    const input = inputs[0],
      output = outputs[0]
    this.detector.push(input[0])
    this.counter += 128
    if (this.counter >= PITCH_HOP) {
      this.counter = 0
      for (const key in this.params) this.params[key] = parameters[key][0]
      this.controller.update(this.detector.detect(), this.params)
    }
    this.stretch.process(
      input,
      this.wet,
      this.controller.correction,
      this.controller.frequency,
      sampleRate,
    )
    const mix = parameters.mix[0] / 100
    for (let i = 0; i < 128; i++) {
      for (let c = 0; c < 2; c++) {
        const dry = this.dry[c][this.position]
        this.dry[c][this.position] = (input[c] ?? input[0])?.[i] ?? 0
        if (output[c]) output[c][i] = dry * (1 - mix) + this.wet[c][i] * mix
      }
      this.position = (this.position + 1) % this.stretch.latency
    }
    return true
  }
}
registerProcessor('vox-pitch', PitchProcessor)
