import { describe, expect, it } from 'vitest'
import { PitchController, PitchDetector, nearestNote } from '../../src/audio/pitch-dsp.js'
import { createEffect, normalizeEffects, PITCH_MODES } from '../../src/model/effects'

describe('vocal pitch analysis and musical correction', () => {
  it('detects fundamentals at both supported sample rates, including stronger harmonics', () => {
    for (const sr of [44100, 48000])
      for (const frequency of [80, 110, 220, 440, 880]) {
        const detector = new PitchDetector(sr)
        const block = new Float32Array(128)
        for (let start = 0; start < sr / 3; start += 128) {
          for (let i = 0; i < 128; i++) {
            const phase = ((start + i) * 2 * Math.PI * frequency) / sr
            block[i] =
              0.08 * Math.sin(phase) + 0.2 * Math.sin(phase * 2) + 0.12 * Math.sin(phase * 3)
          }
          detector.push(block)
        }
        const result = detector.detect()
        expect(result).not.toBeNull()
        expect(Math.abs(1200 * Math.log2(result!.frequency / frequency))).toBeLessThan(8)
      }
  })
  it('does not assign a note to silence or unpitched noise', () => {
    const detector = new PitchDetector(48000)
    for (let i = 0; i < 64; i++) detector.push()
    expect(detector.detect()).toBeNull()
    let seed = 99
    for (let block = 0; block < 64; block++) {
      detector.push(
        Float32Array.from({ length: 128 }, () => {
          seed ^= seed << 13
          seed ^= seed >>> 17
          seed ^= seed << 5
          return (seed / 2147483648) * 0.1
        }),
      )
    }
    expect(detector.detect()).toBeNull()
  })
  it('uses allowed notes for all 12 roots and keeps hysteresis within the chosen scale', () => {
    const intervals = [
      [0, 2, 4, 5, 7, 9, 11],
      [0, 2, 3, 5, 7, 8, 10],
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    ]
    for (let key = 0; key < 12; key++)
      for (let scale = 0; scale < 3; scale++) {
        for (let midi = 36.2; midi < 90; midi += 0.31) {
          const note = nearestNote(midi, key, scale, 60)
          expect(intervals[scale]).toContain((((note - key) % 12) + 12) % 12)
          expect(Math.abs(note - midi)).toBeLessThan(1.09)
        }
      }
  })
  it('makes Hard Tune faster than Natural and Humanize preserves sustained vibrato', () => {
    const params = createEffect('autotune').params
    const natural = new PitchController(48000),
      hard = new PitchController(48000)
    natural.update({ frequency: 450, confidence: 1 }, {
      ...params,
      ...PITCH_MODES[0],
    } as typeof params)
    hard.update({ frequency: 450, confidence: 1 }, {
      ...params,
      ...PITCH_MODES[2],
    } as typeof params)
    expect(Math.abs(hard.correction)).toBeGreaterThan(Math.abs(natural.correction) * 5)
    const robotic = new PitchController(48000),
      human = new PitchController(48000)
    let hardEnergy = 0,
      humanEnergy = 0
    for (let i = 0; i < 500; i++) {
      const midi = 69.2 + 0.15 * Math.sin((2 * Math.PI * 5 * i * 512) / 48000)
      const detected = { frequency: 440 * 2 ** ((midi - 69) / 12), confidence: 1 }
      const a = robotic.update(detected, { ...params, retune: 0, amount: 100, humanize: 0 })
      const b = human.update(detected, { ...params, retune: 0, amount: 100, humanize: 100 })
      if (i > 100) {
        hardEnergy += (midi + a - 69) ** 2
        humanEnergy += (midi + b - 69) ** 2
      }
    }
    expect(humanEnergy).toBeGreaterThan(hardEnergy * 10)
  })
  it('sanitizes presets and permits only one pitch corrector per track', () => {
    const effect = createEffect('autotune')
    const [saved] = normalizeEffects([
      { ...effect, params: { key: 19, scale: 0.6, retune: NaN, mix: -1 } },
      effect,
    ])
    expect(saved.params).toMatchObject({ key: 11, scale: 1, retune: 90, mix: 0 })
    expect(normalizeEffects([effect, effect])).toHaveLength(1)
  })
})
