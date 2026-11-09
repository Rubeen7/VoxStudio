import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

describe('AudioWorklet frame-aligned capture', () => {
  it('captures only scheduled frames, preserves silent gaps and flushes the partial block', () => {
    const messages: { type: string; frames?: number; chunk?: Float32Array }[] = []
    let Processor: new () => {
      port: { onmessage: (event: { data: unknown }) => void }
      process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean
    }
    const sandbox = {
      currentFrame: 0,
      Float32Array,
      AudioWorkletProcessor: class {
        port = { postMessage: (data: (typeof messages)[number]) => messages.push(data) }
      },
      registerProcessor: (_: string, type: typeof Processor) => {
        Processor = type
      },
    }
    vm.runInNewContext(
      readFileSync(new URL('../../src/audio/recorder.worklet.js', import.meta.url), 'utf8'),
      sandbox,
    )
    const processor = new Processor!()
    processor.port.onmessage({ data: { type: 'start', startFrame: 50, endFrame: 300 } })
    const output = [[new Float32Array(128)]]
    processor.process([[new Float32Array(128).fill(0.25)]], output)
    sandbox.currentFrame = 128
    processor.process([[]], output)
    sandbox.currentFrame = 256
    processor.process([[new Float32Array(128).fill(0.5)]], output)
    const pcm = messages.find((m) => m.type === 'chunk')!.chunk!
    expect(pcm.length).toBe(250)
    expect(Array.from(pcm.slice(0, 78))).toEqual(Array(78).fill(0.25))
    expect(Array.from(pcm.slice(78, 206))).toEqual(Array(128).fill(0))
    expect(Array.from(pcm.slice(206))).toEqual(Array(44).fill(0.5))
    expect(messages.filter((m) => m.type === 'done')).toEqual([{ type: 'done', frames: 250 }])
    expect(output[0][0].every((x) => x === 0)).toBe(true)
    processor.port.onmessage({ data: { type: 'flush' } })
    expect(messages.filter((m) => m.type === 'done')).toHaveLength(1)
  })
})
