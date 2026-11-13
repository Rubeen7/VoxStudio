import { effectTail, normalizeEffects, type AudioEffect } from './effects'

export type TrackKind = 'beat' | 'lead' | 'double' | 'harmony' | 'adlib'

export interface Clip {
  id: string
  assetId: string
  name: string
  start: number
  offset: number
  duration: number
  gain?: number
  fadeIn?: number
  fadeOut?: number
  envelope?: { time: number; value: number }[]
  takeGroupId?: string
}

export interface TakeGroup {
  id: string
  name: string
  start: number
  duration: number
  activeTakeId: string
}
export interface Marker { id: string; name: string; time: number }

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
  effects: AudioEffect[]
  takeGroups?: TakeGroup[]
  hidden?: boolean
  collapsed?: boolean
  group?: string
}

export interface Project {
  version: 3
  id: string
  name: string
  bpm: number
  masterVolume: number
  createdAt: number
  updatedAt: number
  tracks: Track[]
  markers?: Marker[]
  timeline?: { scale: number; snap: boolean; grid: number }
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
    effects: [],
  }
}

export function createProject(): Project {
  return {
    version: 3,
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
  return Math.max(0, ...project.tracks.flatMap((t) => playableClips(t).map((c) => c.start + c.duration)))
}

/** Alternatives remain in the project, but only the chosen take enters the audio graph. */
export function playableClips(track: Track) {
  return track.clips.filter(clip => {
    const group = track.takeGroups?.find(group => group.id === clip.takeGroupId)
    return !group || group.activeTakeId === clip.id
  })
}

export function isAudible(track: Track, tracks: Track[]): boolean {
  return !track.muted && (!tracks.some((t) => t.solo) || track.solo)
}

export function projectPlaybackDuration(project: Project): number {
  return Math.max(
    projectDuration(project),
    ...project.tracks.map((track) =>
      track.clips.length && isAudible(track, project.tracks)
        ? Math.max(0, ...playableClips(track).map((clip) => clip.start + clip.duration)) +
          effectTail(track.effects)
        : 0,
    ),
  )
}

/** Version 1 sessions keep their audio, timing and mixer values; effects start empty. */
export function migrateProject(project: Project): Project {
  const version: number = project.version
  if (version !== 1 && version !== 2 && version !== 3)
    throw new Error('La versión de este proyecto no es compatible.')
  return {
    ...project,
    version: 3,
    tracks: project.tracks.map((track) => ({ ...track, effects: normalizeEffects(track.effects) })),
  }
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
