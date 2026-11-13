import { sampleTime } from './editing'
import { MAX_SECONDS } from './project'

/** The browser validates the actual bytes while decoding; the name is the pre-decode hint. */
const AUDIO_FILE = /\.(wav|mp3|ogg|m4a|aac|flac|webm)$/i

export function isSupportedAudioFile(name: string): boolean {
  return AUDIO_FILE.test(name)
}

/**
 * Maps a pointer position inside a timeline lane to seconds. Positions left of
 * the timeline (over the track headers) fall back to the playhead, and the
 * result never leaves the visible timeline or becomes negative.
 */
export function timelineDropTime(
  clientX: number,
  left: number,
  scale: number,
  max: number,
  fallback = 0,
): number {
  const limit = Math.max(0, Number.isFinite(max) ? max : 0)
  const safeFallback = Math.min(limit, Math.max(0, Number.isFinite(fallback) ? fallback : 0))
  if (!Number.isFinite(scale) || scale <= 0) return safeFallback
  const time = (clientX - left) / scale
  if (!Number.isFinite(time) || time < 0) return safeFallback
  return Math.min(time, limit)
}

/**
 * Clamps an imported clip to the session, rounds it to the sample grid and
 * offsets additional files dropped on the same track.
 */
export function importStart(base: number, duration: number, offset = 0): number {
  const safeBase = Number.isFinite(base) ? base : 0
  const safeOffset = Number.isFinite(offset) ? offset : 0
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0
  return sampleTime(Math.max(0, Math.min(MAX_SECONDS - safeDuration, safeBase + safeOffset)))
}
