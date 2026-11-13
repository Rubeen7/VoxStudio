import { cloneEffectChain } from './effects'
import { MAX_SECONDS, type Clip, type Project, type Track } from './project'

export const MIN_CLIP = 0.01
export const sampleTime = (time: number) => Math.round(time * 48000) / 48000
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
export const timelineSettings = (project: Project) => project.timeline ?? { scale: 42, snap: false, grid: 0.25 }
export function snapTime(time: number, project: Project, bypass = false) {
  const { snap, grid } = timelineSettings(project)
  const step = 60 / project.bpm * grid
  return sampleTime(snap && !bypass ? Math.round(time / step) * step : time)
}
export function envelopePoints(clip: Clip) {
  if (clip.envelope?.length) return clip.envelope
  const fadeIn = Math.max(0, clip.fadeIn ?? 0), fadeOut = Math.max(0, clip.fadeOut ?? 0)
  const ratio = Math.min(1, clip.duration / Math.max(clip.duration, fadeIn + fadeOut))
  const points = [{ time: 0, value: fadeIn ? 0 : 1 }]
  if (fadeIn) points.push({ time: fadeIn * ratio, value: 1 })
  if (fadeOut) points.push({ time: clip.duration - fadeOut * ratio, value: 1 })
  points.push({ time: clip.duration, value: fadeOut ? 0 : 1 })
  return points
}
export function envelopeAt(clip: Clip, time: number) {
  const points = envelopePoints(clip)
  for (let i = 1; i < points.length; i++) if (time <= points[i].time) {
    const a = points[i - 1], b = points[i]
    const fraction = clamp((time - a.time) / Math.max(1e-12, b.time - a.time), 0, 1)
    return a.value + (b.value - a.value) * fraction
  }
  return points.at(-1)!.value
}
function cropEnvelope(clip: Clip, start: number, end: number) {
  return [{ time: 0, value: envelopeAt(clip, start) },
    ...envelopePoints(clip).filter(p => p.time > start && p.time < end).map(p => ({ ...p, time: p.time - start })),
    { time: end - start, value: envelopeAt(clip, end) }]
}
export function editClip(clip: Clip, patch: Partial<Clip>, sourceDuration: number): Clip {
  const next = { ...clip, ...patch }
  next.offset = sampleTime(clamp(Number.isFinite(next.offset) ? next.offset : clip.offset, 0, Math.max(0, sourceDuration - MIN_CLIP)))
  next.duration = sampleTime(clamp(Number.isFinite(next.duration) ? next.duration : clip.duration, MIN_CLIP, sourceDuration - next.offset))
  next.start = sampleTime(clamp(Number.isFinite(next.start) ? next.start : clip.start, 0, MAX_SECONDS - next.duration))
  if (patch.gain !== undefined) next.gain = clamp(Number.isFinite(patch.gain) ? patch.gain : clip.gain ?? 1, 0, 2)
  if (patch.fadeIn !== undefined || patch.fadeOut !== undefined || patch.duration !== undefined) {
    next.fadeIn = clamp(Number.isFinite(next.fadeIn) ? next.fadeIn! : 0, 0, next.duration)
    next.fadeOut = clamp(Number.isFinite(next.fadeOut) ? next.fadeOut! : 0, 0, next.duration - next.fadeIn)
    next.envelope = undefined
  }
  return next
}
export function trimClip(clip: Clip, edge: 'start' | 'end', time: number, sourceDuration: number) {
  if (edge === 'end') return editClip(clip, { duration: time - clip.start }, sourceDuration)
  const start = sampleTime(clamp(time, Math.max(0, clip.start - clip.offset), clip.start + clip.duration - MIN_CLIP))
  const delta = start - clip.start
  return editClip(clip, { start, offset: clip.offset + delta, duration: clip.duration - delta }, sourceDuration)
}
export function splitClip(clip: Clip, time: number): [Clip, Clip] | null {
  const cut = sampleTime(time - clip.start)
  if (cut < MIN_CLIP || clip.duration - cut < MIN_CLIP) return null
  return [
    { ...clip, duration: cut, takeGroupId: undefined, fadeIn: Math.min(clip.fadeIn ?? 0, cut), fadeOut: 0,
      envelope: cropEnvelope(clip, 0, cut) },
    { ...clip, id: crypto.randomUUID(), start: sampleTime(clip.start + cut), offset: sampleTime(clip.offset + cut),
      duration: sampleTime(clip.duration - cut), takeGroupId: undefined, fadeIn: 0, fadeOut: Math.min(clip.fadeOut ?? 0, clip.duration - cut),
      envelope: cropEnvelope(clip, cut, clip.duration) },
  ]
}
export function cleanTakeGroups(track: Track): Track {
  const groups = (track.takeGroups ?? []).flatMap(group => {
    const members = track.clips.filter(c => c.takeGroupId === group.id)
    return members.length ? [{ ...group, activeTakeId: members.some(c => c.id === group.activeTakeId) ? group.activeTakeId : members[0].id }] : []
  })
  return { ...track, takeGroups: groups }
}
export function removeClips(project: Project, ids: string[]): Project {
  const selected = new Set(ids)
  return { ...project, tracks: project.tracks.map(track => cleanTakeGroups({ ...track, clips: track.clips.filter(c => !selected.has(c.id)) })) }
}
export function moveClips(project: Project, ids: string[], delta: number, destinationId?: string): Project {
  const selected = new Set(ids)
  // Moving a selected take moves its alternatives as one section.
  for (const track of project.tracks) for (const clip of track.clips) if (selected.has(clip.id) && clip.takeGroupId)
    track.clips.filter(c => c.takeGroupId === clip.takeGroupId).forEach(c => selected.add(c.id))
  const moving = project.tracks.flatMap(t => t.clips.filter(c => selected.has(c.id)))
  if (!moving.length) return project
  const sourceTracks = project.tracks.filter(t => t.clips.some(c => selected.has(c.id)))
  // All VOX tracks accept mono/stereo. A cross-track drag moves one source track's selection.
  const destination = destinationId && sourceTracks.length === 1 ? project.tracks.find(t => t.id === destinationId) : undefined
  delta = sampleTime(clamp(delta, -Math.min(...moving.map(c => c.start)), MAX_SECONDS - Math.max(...moving.map(c => c.start + c.duration))))
  const groups = sourceTracks.flatMap(t => (t.takeGroups ?? []).filter(g => moving.some(c => c.takeGroupId === g.id)))
    .map(g => ({ ...g, start: sampleTime(g.start + delta) }))
  const shifted = moving.map(c => ({ ...c, start: sampleTime(c.start + delta) }))
  return { ...project, tracks: project.tracks.map(track => {
    if (destination) return { ...track,
      clips: [...track.clips.filter(c => !selected.has(c.id)), ...(track.id === destination.id ? shifted : [])],
      takeGroups: [...(track.takeGroups ?? []).filter(g => !groups.some(m => m.id === g.id)), ...(track.id === destination.id ? groups : [])] }
    return { ...track, clips: track.clips.map(c => shifted.find(m => m.id === c.id) ?? c),
      takeGroups: track.takeGroups?.map(g => groups.find(m => m.id === g.id) ?? g) }
  }) }
}
export function duplicateTrack(track: Track): Track {
  const groups = new Map((track.takeGroups ?? []).map(g => [g.id, crypto.randomUUID()]))
  const ids = new Map(track.clips.map(c => [c.id, crypto.randomUUID()]))
  return { ...track, id: crypto.randomUUID(), name: `${track.name} · copia`, hidden: false,
    effects: cloneEffectChain(track.effects), clips: track.clips.map(c => ({ ...c, id: ids.get(c.id)!, takeGroupId: c.takeGroupId ? groups.get(c.takeGroupId) : undefined })),
    takeGroups: track.takeGroups?.map(g => ({ ...g, id: groups.get(g.id)!, activeTakeId: ids.get(g.activeTakeId)! })) }
}

export function splitSelected(project: Project, ids: string[], time: number): Project {
  const selected = new Set(ids)
  let changed = false
  const tracks = project.tracks.map(track => {
    let groups = [...(track.takeGroups ?? [])]
    const groupIds = new Set(track.clips.filter(c => selected.has(c.id) && splitClip(c, time)).map(c => c.takeGroupId).filter(Boolean))
    const rightGroups = new Map([...groupIds].map(id => [id, crypto.randomUUID()]))
    const rightActive = new Map<string, string>()
    const clips = track.clips.flatMap(clip => {
      if (!selected.has(clip.id) && !groupIds.has(clip.takeGroupId)) return [clip]
      const pair = splitClip(clip, time)
      if (!pair) {
        return clip.takeGroupId && groupIds.has(clip.takeGroupId) && clip.start >= time
          ? [{ ...clip, takeGroupId: rightGroups.get(clip.takeGroupId) }] : [clip]
      }
      changed = true
      if (clip.takeGroupId) {
        pair[0].takeGroupId = clip.takeGroupId
        pair[1].takeGroupId = rightGroups.get(clip.takeGroupId)
        if (groups.find(g => g.id === clip.takeGroupId)?.activeTakeId === clip.id)
          rightActive.set(clip.takeGroupId, pair[1].id)
      }
      return pair
    })
    groups = groups.flatMap(g => groupIds.has(g.id) ? [
      { ...g, duration: time - g.start },
      { ...g, id: rightGroups.get(g.id)!, name: `${g.name} · continuación`, start: time,
        duration: Math.max(MIN_CLIP, g.start + g.duration - time), activeTakeId: rightActive.get(g.id)! },
    ] : [g])
    return cleanTakeGroups({ ...track, clips, takeGroups: groups })
  })
  return changed ? { ...project, tracks } : project
}
