import type { Project, Track } from '../model/project'
import { isAudible } from '../model/project'
import type { AudioEffect } from '../model/effects'
import { createEffectNode, setAudioParam, type EffectNode } from './effects'
import { pitchFrames } from './pitch'

export interface TrackChannel {
  input: GainNode
  gain: GainNode
  pan: StereoPannerNode
  latencyFrames: number
  updateEffects(effects: AudioEffect[]): void
  dispose(): void
}

export function createTrackChannel(
  context: BaseAudioContext,
  track: Track,
  project: Project,
  output: AudioNode,
  options: { latencyFrames?: number; monitor?: boolean } = {},
): TrackChannel {
  const audibleEffects = (effects: AudioEffect[]) =>
    options.monitor ? effects.filter((effect) => effect.type !== 'autotune') : effects
  const initialEffects = audibleEffects(track.effects ?? [])
  const latencyFrames = pitchFrames(initialEffects)
  const totalLatency = Math.max(latencyFrames, options.latencyFrames ?? 0)
  const input = context.createGain()
  const gain = context.createGain()
  const pan = context.createStereoPanner()
  gain.gain.value = isAudible(track, project.tracks) ? track.volume : 0
  pan.pan.value = track.pan
  gain.connect(pan).connect(output)
  const retired = new Set<() => void>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const build = (effects: AudioEffect[], initial: boolean) => {
    const send = context.createGain()
    const level = context.createGain()
    const alignment = context.createDelay(2)
    alignment.delayTime.value = (totalLatency - latencyFrames) / context.sampleRate
    level.gain.value = initial ? 1 : 0
    const nodes: EffectNode[] = []
    try {
      let previous: AudioNode = send
      for (const effect of effects) {
        const node = createEffectNode(context, effect)
        nodes.push(node)
        previous.connect(node.input)
        previous = node.output
      }
      previous.connect(alignment).connect(level).connect(gain)
      input.connect(send)
    } catch (error) {
      nodes.forEach((node) => node.dispose())
      send.disconnect()
      level.disconnect()
      alignment.disconnect()
      throw error
    }
    return {
      effects,
      nodes,
      level,
      dispose: () => {
        input.disconnect(send)
        send.disconnect()
        level.disconnect()
        alignment.disconnect()
        nodes.forEach((node) => node.dispose())
      },
    }
  }
  let current = build(initialEffects, true)
  return {
    input,
    gain,
    pan,
    latencyFrames,
    updateEffects: (requested) => {
      const effects = audibleEffects(requested)
      if (pitchFrames(effects) !== latencyFrames)
        throw new Error(
          'Es necesario reprogramar el transporte para cambiar el retardo de afinación.',
        )
      if (effects === current.effects) return
      const sameOrder =
        effects.length === current.effects.length &&
        effects.every(
          (e, i) => e.id === current.effects[i].id && e.type === current.effects[i].type,
        )
      if (sameOrder) {
        effects.forEach((e, i) => {
          if (e !== current.effects[i]) current.nodes[i].update(e)
        })
        current.effects = effects
        return
      }
      const next = build(effects, false)
      const old = current
      current = next
      // Let the replacement fill its analysis/delay buffers before crossfading it in.
      const warmup = totalLatency / context.sampleRate
      if (warmup) {
        old.level.gain.setTargetAtTime(0, context.currentTime + warmup, 0.012)
        next.level.gain.setTargetAtTime(1, context.currentTime + warmup, 0.012)
      } else {
        setAudioParam(old.level.gain, 0, context)
        setAudioParam(next.level.gain, 1, context)
      }
      retired.add(old.dispose)
      const timer = setTimeout(
        () => {
          old.dispose()
          retired.delete(old.dispose)
          timers.delete(timer)
        },
        warmup * 1000 + 150,
      )
      timers.add(timer)
    },
    dispose: () => {
      timers.forEach(clearTimeout)
      retired.forEach((dispose) => dispose())
      current.dispose()
      input.disconnect()
      gain.disconnect()
      pan.disconnect()
    },
  }
}
