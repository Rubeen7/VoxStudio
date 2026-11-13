import type { AudioEffect } from '../model/effects'
import dynamicsUrl from './dynamics.worklet.js?url'
import { preparePitch, pitchModule } from './pitch'

const modules = new WeakMap<BaseAudioContext, Promise<void>>()
export function prepareEffects(context: BaseAudioContext) {
  if (!context.audioWorklet)
    return Promise.reject(
      new Error(
        'Este navegador no admite AudioWorklet en este contexto. Abre el estudio en Chrome de escritorio con HTTPS o localhost.',
      ),
    )
  let task = modules.get(context)
  if (!task) {
    task = Promise.all([context.audioWorklet.addModule(dynamicsUrl), preparePitch(context)])
      .then(() => {})
      .catch((error: unknown) => {
        modules.delete(context)
        throw error
      })
    modules.set(context, task)
  }
  return task
}

export function setAudioParam(
  param: AudioParam,
  value: number,
  context: BaseAudioContext,
  immediate = false,
) {
  const now = context.currentTime
  param.cancelScheduledValues(now)
  if (immediate) param.setValueAtTime(value, now)
  else param.setTargetAtTime(value, now, 0.012)
}
const toGain = (db: number) => 10 ** (db / 20)
const responses = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>()
function impulse(context: BaseAudioContext, duration: number) {
  let cache = responses.get(context)
  if (!cache) {
    cache = new Map()
    responses.set(context, cache)
  }
  const key = Math.round(duration * 10) / 10
  const cached = cache.get(key)
  if (cached) return cached
  // Mono response preserves channel layout; stereo material is convolved independently.
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * key), context.sampleRate)
  const samples = buffer.getChannelData(0)
  let seed = 0x1234abcd
  let energy = 0
  for (let i = 0; i < samples.length; i++) {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    const t = i / context.sampleRate
    const envelope =
      Math.min(1, t / 0.008) * Math.exp((-6.9 * t) / key) * Math.min(1, (key - t) / 0.02)
    samples[i] = (seed / 2147483648) * envelope
    energy += samples[i] * samples[i]
  }
  const normalization = 0.65 / Math.sqrt(Math.max(energy, 1e-12))
  for (let i = 0; i < samples.length; i++) samples[i] *= normalization
  if (cache.size >= 8) cache.delete(cache.keys().next().value!)
  cache.set(key, buffer)
  return buffer
}

export interface EffectNode {
  input: GainNode
  output: GainNode
  update(effect: AudioEffect, immediate?: boolean): void
  dispose(): void
}

export function createEffectNode(context: BaseAudioContext, initial: AudioEffect): EffectNode {
  if (initial.type === 'autotune') {
    const input = context.createGain()
    const output = context.createGain()
    const processor = new AudioWorkletNode(context, 'vox-pitch', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 2,
      channelCountMode: 'max',
      processorOptions: { module: pitchModule() },
    })
    input.connect(processor).connect(output)
    const update = (effect: AudioEffect, immediate = false) => {
      for (const [name, value] of Object.entries(effect.params)) {
        const parameter = processor.parameters.get(name)
        if (parameter)
          setAudioParam(
            parameter,
            name === 'mix' && !effect.enabled ? 0 : value,
            context,
            immediate || name === 'key' || name === 'scale',
          )
      }
    }
    update(initial, true)
    return {
      input,
      output,
      update,
      dispose: () => {
        input.disconnect()
        processor.disconnect()
        output.disconnect()
        processor.port.postMessage('dispose')
        processor.port.close()
      },
    }
  }
  const nodes = new Set<AudioNode>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const own = <T extends AudioNode>(node: T): T => {
    nodes.add(node)
    return node
  }
  const later = (fn: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      fn()
    }, ms)
    timers.add(timer)
    return timer
  }
  const input = own(context.createGain())
  const output = own(context.createGain())
  const dry = own(context.createGain())
  const wet = own(context.createGain())
  const send = own(context.createGain())
  input.connect(dry).connect(output)
  input.connect(send)
  wet.connect(output)
  let configure: (params: AudioEffect['params'], immediate: boolean) => void
  const set = (p: AudioParam, v: number, immediate: boolean) =>
    setAudioParam(p, v, context, immediate)
  let worklet: AudioWorkletNode | undefined

  if (initial.type === 'eq') {
    const filters = [0, 1, 2].map(() => {
      const node = own(context.createBiquadFilter())
      node.type = 'peaking'
      return node
    })
    send.connect(filters[0]).connect(filters[1]).connect(filters[2]).connect(wet)
    configure = (p, now) =>
      filters.forEach((node, i) => {
        set(node.frequency, Math.min(p[`frequency${i}`], context.sampleRate * 0.45), now)
        set(node.gain, p[`gain${i}`], now)
        set(node.Q, p[`q${i}`], now)
      })
  } else if (initial.type === 'highpass' || initial.type === 'lowpass') {
    const filter = own(context.createBiquadFilter())
    filter.type = initial.type
    send.connect(filter).connect(wet)
    configure = (p, now) => {
      set(filter.frequency, Math.min(p.frequency, context.sampleRate * 0.45), now)
      set(filter.Q, p.q, now)
    }
  } else if (initial.type === 'delay') {
    worklet = own(
      new AudioWorkletNode(context, 'vox-delay', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: 'max',
      }),
    )
    send.connect(worklet).connect(wet)
    configure = (p, now) => {
      set(worklet!.parameters.get('time')!, p.time, now)
      set(worklet!.parameters.get('feedback')!, p.feedback, now)
    }
  } else if (initial.type === 'reverb') {
    const tone = own(context.createBiquadFilter())
    tone.type = 'lowpass'
    tone.Q.value = 0.7
    tone.connect(wet)
    let current: { node: ConvolverNode; level: GainNode } | undefined
    let duration = -1
    let pending: ReturnType<typeof setTimeout> | undefined
    const replace = (seconds: number, immediate: boolean) => {
      const next = { node: own(context.createConvolver()), level: own(context.createGain()) }
      next.node.normalize = false
      next.node.buffer = impulse(context, seconds)
      next.level.gain.value = immediate ? 1 : 0
      send.connect(next.node).connect(next.level).connect(tone)
      const old = current
      current = next
      if (!immediate) set(next.level.gain, 1, false)
      if (old) {
        set(old.level.gain, 0, false)
        later(() => {
          send.disconnect(old.node)
          old.node.disconnect()
          old.level.disconnect()
          nodes.delete(old.node)
          nodes.delete(old.level)
        }, 150)
      }
    }
    configure = (p, now) => {
      set(tone.frequency, p.tone, now)
      if (p.duration === duration) return
      duration = p.duration
      if (pending) {
        clearTimeout(pending)
        timers.delete(pending)
      }
      if (now) replace(duration, true)
      else pending = later(() => replace(duration, false), 90)
    }
  } else if (initial.type === 'saturation' || initial.type === 'distortion') {
    const drive = own(context.createGain())
    const shaper = own(context.createWaveShaper())
    const trim = own(context.createGain())
    const curve = new Float32Array(4097)
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1
      curve[i] =
        initial.type === 'saturation'
          ? Math.tanh(2 * x) / Math.tanh(2)
          : Math.max(-1, Math.min(1, 3 * x))
    }
    shaper.curve = curve
    shaper.oversample = '4x'
    send.connect(drive).connect(shaper).connect(trim).connect(wet)
    configure = (p, now) => {
      set(drive.gain, toGain(p.drive), now)
      set(trim.gain, toGain(p.output), now)
    }
  } else {
    worklet = own(
      new AudioWorkletNode(context, 'vox-dynamics', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: 'max',
        processorOptions: { mode: initial.type },
      }),
    )
    send.connect(worklet).connect(wet)
    configure = (p, now) => {
      const values =
        initial.type === 'deesser' ? { ...p, attack: 1, release: 60, knee: 6, makeup: 0 } : p
      for (const [name, value] of Object.entries(values)) {
        const parameter = worklet!.parameters.get(name)
        if (parameter) set(parameter, value, now)
      }
    }
  }
  const update = (effect: AudioEffect, immediate = false) => {
    configure(effect.params, immediate)
    const amount = effect.enabled ? (effect.params.mix ?? 100) / 100 : 0
    // Linear dry/wet preserves unity for identical paths; no equal-power boost.
    set(dry.gain, 1 - amount, immediate)
    set(wet.gain, amount, immediate)
    set(send.gain, effect.enabled && amount > 0 ? 1 : 0, immediate)
  }
  update(initial, true)
  return {
    input,
    output,
    update,
    dispose: () => {
      timers.forEach(clearTimeout)
      nodes.forEach((node) => node.disconnect())
      if (worklet) {
        worklet.port.postMessage('dispose')
        worklet.port.close()
      }
    },
  }
}
