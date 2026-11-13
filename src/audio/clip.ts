import { clipWindow, type Clip } from '../model/project'
import { envelopeAt, envelopePoints } from '../model/editing'

/** One envelope/scheduling path for playback, seek and offline export. Originals are never written. */
export function scheduleClip(context: BaseAudioContext, buffer: AudioBuffer, clip: Clip, position: number, when: number, output: AudioNode) {
  const window = clipWindow(clip, position)
  if (!window) return null
  const source = context.createBufferSource()
  const level = context.createGain()
  source.buffer = buffer
  source.connect(level).connect(output)
  const skipped = Math.max(0, position - clip.start)
  const start = when + window.delay
  const gain = clip.gain ?? 1
  level.gain.setValueAtTime(gain * envelopeAt(clip, skipped), start)
  for (const point of envelopePoints(clip)) if (point.time > skipped)
    level.gain.linearRampToValueAtTime(gain * point.value, start + point.time - skipped)
  source.start(start, window.offset, Math.min(window.duration, buffer.duration - window.offset))
  return { source, level }
}
