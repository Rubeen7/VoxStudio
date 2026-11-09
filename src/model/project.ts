export type TrackKind = 'beat' | 'lead' | 'double' | 'harmony' | 'adlib'

export interface Clip {
  id: string
  assetId: string
  name: string
  start: number
  offset: number
  duration: number
}

export interface Track {
  id: string
  name: string
  kind: TrackKind
  color: string
  volume: number
  pan: number
  muted: boolean
  solo: boolean
  clips: Clip[]
}

export interface Project {
  version: 1
  id: string
  name: string
  bpm: number
  masterVolume: number
  createdAt: number
  updatedAt: number
  tracks: Track[]
}

export interface AudioAsset {
  id: string
  projectId: string
  name: string
  blob: Blob
  duration: number
  sampleRate: number
  channels: number
}

export const MAX_SECONDS = 15 * 60
export const MAX_DECODED_BYTES = 256 * 1024 * 1024
export const trackKinds: Record<TrackKind, { name: string; color: string; short: string }> = {
  beat: { name: 'Instrumental', color: '#8b9e91', short: 'BEAT' },
  lead: { name: 'Voz principal', color: '#9b94b2', short: 'LEAD' },
  double: { name: 'Dobles', color: '#8b9eae', short: 'DBL' },
  harmony: { name: 'Coros', color: '#aea08a', short: 'HARM' },
  adlib: { name: 'Ad-libs', color: '#ae929e', short: 'ADLIB' },
}

export function createTrack(kind: TrackKind): Track {
  return {
    id: crypto.randomUUID(),
    kind,
    name: trackKinds[kind].name,
    color: trackKinds[kind].color,
    volume: 0.8,
    pan: 0,
    muted: false,
    solo: false,
    clips: [],
  }
}

export function createProject(): Project {
  return {
    version: 1,
    id: crypto.randomUUID(),
    name: 'Mi primera sesión',
    bpm: 90,
    masterVolume: 0.85,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    tracks: (['beat', 'lead', 'double', 'harmony', 'adlib'] as TrackKind[]).map(createTrack),
  }
}

export function projectDuration(project: Project): number {
  return Math.max(0, ...project.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)))
}

export function isAudible(track: Track, tracks: Track[]): boolean {
  return !track.muted && (!tracks.some((t) => t.solo) || track.solo)
}

export function formatTime(seconds: number, precise = false): string {
  const safe = Math.max(0, seconds)
  const mins = Math.floor(safe / 60)
    .toString()
    .padStart(2, '0')
  const secs = Math.floor(safe % 60)
    .toString()
    .padStart(2, '0')
  return `${mins}:${secs}${
    precise
      ? '.' +
        Math.floor((safe % 1) * 100)
          .toString()
          .padStart(2, '0')
      : ''
  }`
}

export function dbLabel(volume: number): string {
  return volume <= 0 ? '−∞ dB' : `${(20 * Math.log10(volume)).toFixed(1)} dB`
}

/** One shared scheduling calculation for live playback and offline rendering. */
export function clipWindow(clip: Clip, position: number) {
  const skipped = Math.max(0, position - clip.start)
  const duration = clip.duration - skipped
  if (duration <= 0) return null
  return { delay: Math.max(0, clip.start - position), offset: clip.offset + skipped, duration }
}
