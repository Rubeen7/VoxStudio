import type { Project, Track } from '../model/project'
import { isAudible } from '../model/project'

/** Future effects must support both live and offline contexts and release their nodes. */
export interface EffectNode {
  input: AudioNode
  output: AudioNode
  dispose(): void
}
export type EffectFactory = (context: BaseAudioContext) => EffectNode

export interface TrackChannel {
  gain: GainNode
  pan: StereoPannerNode
  dispose(): void
}

export function createTrackChannel(
  context: BaseAudioContext,
  track: Track,
  project: Project,
  output: AudioNode,
  effectFactories: readonly EffectFactory[] = [],
): TrackChannel {
  const gain = context.createGain()
  const pan = context.createStereoPanner()
  gain.gain.value = isAudible(track, project.tracks) ? track.volume : 0
  pan.pan.value = track.pan
  const effects = effectFactories.map((factory) => factory(context))
  let previous: AudioNode = gain
  for (const effect of effects) {
    previous.connect(effect.input)
    previous = effect.output
  }
  previous.connect(pan).connect(output)
  return {
    gain,
    pan,
    dispose: () => {
      gain.disconnect()
      effects.forEach((effect) => effect.dispose())
      pan.disconnect()
    },
  }
}
