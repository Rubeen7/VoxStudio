import wasmUrl from './vendor/signalsmith-stretch.wasm?url'
import licenseUrl from './vendor/signalsmith-LICENSE.txt?url'
import workletUrl from './pitch.worklet.js?worker&url'
import { Stretch } from './pitch-dsp.js'
import type { AudioEffect } from '../model/effects'

// Keep the MIT notice in the production assets alongside the binary.
export const pitchLicenseUrl = licenseUrl
let compiled: Promise<{ module: WebAssembly.Module; latency: number }> | undefined
let prepared: { module: WebAssembly.Module; latency: number } | undefined
const contexts = new WeakMap<BaseAudioContext, Promise<void>>()

export function preparePitch(context: BaseAudioContext) {
  let task = contexts.get(context)
  if (!task) {
    compiled ??= fetch(wasmUrl)
      .then(async (response) => {
        if (!response.ok) throw new Error('No se pudo cargar el motor de afinación.')
        const module = await WebAssembly.compile(await response.arrayBuffer())
        const latency = new Stretch(module).latency
        return { module, latency }
      })
      .catch((error) => {
        compiled = undefined
        throw error
      })
    task = Promise.all([compiled, context.audioWorklet.addModule(workletUrl)])
      .then(([data]) => {
        prepared = data
      })
      .catch((error) => {
        contexts.delete(context)
        throw error
      })
    contexts.set(context, task)
  }
  return task
}

export function pitchFrames(effects: AudioEffect[] = []) {
  const count = effects.filter((effect) => effect.type === 'autotune').length
  if (!count) return 0
  if (!prepared) throw new Error('Inicia el motor de audio antes de usar la afinación.')
  return count * prepared.latency
}

export function pitchModule() {
  if (!prepared) throw new Error('El motor de afinación no está preparado.')
  return prepared.module
}
