import { describe, expect, it } from 'vitest'
import {
  cleanTakeGroups,
  duplicateTrack,
  editClip,
  envelopeAt,
  envelopePoints,
  MIN_CLIP,
  moveClips,
  removeClips,
  sampleTime,
  snapTime,
  splitClip,
  splitSelected,
  timelineSettings,
  trimClip,
} from '../../src/model/editing'
import { createEffect } from '../../src/model/effects'
import {
  createProject,
  MAX_SECONDS,
  type Clip,
  type Project,
  type Track,
} from '../../src/model/project'

const baseClip = (patch: Partial<Clip> = {}): Clip => ({
  id: 'clip-a',
  assetId: 'asset-a',
  name: 'Toma',
  start: 1,
  offset: 0.5,
  duration: 2,
  ...patch,
})

const emptyTrack = (patch: Partial<Track> = {}): Track => ({
  ...createProject().tracks[0],
  clips: [],
  takeGroups: [],
  ...patch,
})

const projectOf = (...tracks: Track[]): Project => ({ ...createProject(), tracks })

describe('non-destructive clip editing', () => {
  it('caps offset, duration, position, gain and fades without mutating the clip', () => {
    const original = baseClip()
    const snapshot = structuredClone(original)
    expect(editClip(original, { duration: 10 }, 5).duration).toBeCloseTo(4.5)
    expect(editClip(original, { offset: 123 }, 5).offset).toBeCloseTo(4.99)
    expect(editClip(original, { start: MAX_SECONDS + 10 }, 5).start).toBeCloseTo(MAX_SECONDS - 2)
    expect(editClip(original, { start: Number.NaN }, 5).start).toBe(original.start)
    expect(editClip(original, { duration: Number.NaN }, 5).duration).toBe(original.duration)
    expect(editClip(original, { gain: 5 }, 5).gain).toBe(2)
    expect(editClip(original, { gain: -1 }, 5).gain).toBe(0)
    expect(editClip(original, { gain: Number.NaN }, 5).gain).toBe(1)
    expect(editClip(original, { fadeIn: 1.5, fadeOut: 1.5 }, 5)).toMatchObject({
      fadeIn: 1.5,
      fadeOut: 0.5,
    })
    const shrunk = editClip(baseClip({ fadeIn: 1, fadeOut: 1 }), { duration: 0.5 }, 5)
    expect(shrunk).toMatchObject({ duration: 0.5, fadeIn: 0.5, fadeOut: 0 })
    // A manual envelope is discarded as soon as the fade fields are edited.
    expect(
      editClip(
        baseClip({
          envelope: [
            { time: 0, value: 1 },
            { time: 2, value: 0 },
          ],
        }),
        { fadeIn: 0.5 },
        5,
      ).envelope,
    ).toBeUndefined()
    expect(original).toEqual(snapshot)
  })

  it('trims either edge while keeping the source offset in sync', () => {
    const clip = baseClip()
    const trimmedStart = trimClip(clip, 'start', 2, 5)
    expect(trimmedStart).toMatchObject({ start: 2, offset: 1.5, duration: 1 })
    const trimmedEnd = trimClip(clip, 'end', 1.5, 5)
    expect(trimmedEnd).toMatchObject({ start: 1, offset: 0.5, duration: 0.5 })
    expect(trimClip(clip, 'end', clip.start, 5).duration).toBeCloseTo(MIN_CLIP)
    const earliest = trimClip(clip, 'start', 0, 5)
    expect(earliest.start).toBeCloseTo(0.5)
    expect(earliest.offset).toBeCloseTo(0)
    expect(earliest.duration).toBeCloseTo(2.5)
  })

  it('splits a clip and crops the envelope on both sides', () => {
    const clip = baseClip({
      takeGroupId: 'g1',
      fadeIn: 0.4,
      fadeOut: 0.6,
      envelope: [
        { time: 0, value: 0 },
        { time: 0.5, value: 1 },
        { time: 1.5, value: 0.5 },
        { time: 2, value: 0 },
      ],
    })
    const [left, right] = splitClip(clip, 2)!
    expect(left.id).toBe(clip.id)
    expect(left).toMatchObject({ duration: 1, fadeIn: 0.4, fadeOut: 0, takeGroupId: undefined })
    expect(right.id).not.toBe(clip.id)
    expect(right).toMatchObject({
      start: 2,
      offset: 1.5,
      duration: 1,
      fadeIn: 0,
      fadeOut: 0.6,
      takeGroupId: undefined,
    })
    expect(left.envelope![0]).toEqual({ time: 0, value: 0 })
    expect(left.envelope!.at(-1)!.value).toBeCloseTo(0.75)
    expect(right.envelope![0].value).toBeCloseTo(0.75)
    expect(right.envelope!.at(-1)!.value).toBeCloseTo(0)
    expect(splitClip(clip, clip.start)).toBeNull()
    expect(splitClip(clip, clip.start + clip.duration)).toBeNull()
  })

  it('splits selected clips and turns their take group into a continuation', () => {
    const selected = baseClip({ takeGroupId: 'g1' })
    const untouched = baseClip({ id: 'clip-b', start: 6, takeGroupId: undefined })
    const track = emptyTrack({
      clips: [selected, untouched],
      takeGroups: [{ id: 'g1', name: 'Toma', start: 1, duration: 2, activeTakeId: 'clip-a' }],
    })
    const project = projectOf(track, emptyTrack())
    const next = splitSelected(project, ['clip-a'], 2)
    expect(next).not.toBe(project)
    const updated = next.tracks[0]
    expect(updated.clips).toHaveLength(3)
    const left = updated.clips.find((c) => c.id === 'clip-a')!
    const right = updated.clips.find((c) => c.takeGroupId && c.takeGroupId !== 'g1')!
    expect(left.takeGroupId).toBe('g1')
    expect(right.start).toBeCloseTo(2)
    expect(updated.takeGroups).toHaveLength(2)
    const continuation = updated.takeGroups!.find((g) => g.id !== 'g1')!
    expect(continuation.name).toBe('Toma · continuación')
    expect(continuation.start).toBeCloseTo(2)
    expect(continuation.activeTakeId).toBe(right.id)
    expect(updated.clips.find((c) => c.id === 'clip-b')).toEqual(untouched)
    expect(splitSelected(project, ['clip-a'], 0)).toBe(project)
  })

  it('moves clips and their take groups together and clamps to the session', () => {
    const trackA = emptyTrack({
      clips: [baseClip({ takeGroupId: 'g1' })],
      takeGroups: [{ id: 'g1', name: 'Toma', start: 1, duration: 2, activeTakeId: 'clip-a' }],
    })
    const trackB = emptyTrack()
    const project = projectOf(trackA, trackB)
    const moved = moveClips(project, ['clip-a'], 1)
    expect(moved.tracks[0].clips[0].start).toBeCloseTo(2)
    expect(moved.tracks[0].takeGroups![0].start).toBeCloseTo(2)
    expect(moveClips(project, ['clip-a'], -10).tracks[0].clips[0].start).toBe(0)
    const crossed = moveClips(project, ['clip-a'], 0, trackB.id)
    expect(crossed.tracks[0].clips).toHaveLength(0)
    expect(crossed.tracks[1].clips.map((c) => c.id)).toEqual(['clip-a'])
    expect(crossed.tracks[1].takeGroups!.map((g) => g.id)).toEqual(['g1'])
  })

  it('removes clips and repairs or drops the affected take groups', () => {
    const group = { id: 'g1', name: 'Toma', start: 1, duration: 5, activeTakeId: 'clip-a' }
    const track = emptyTrack({
      clips: [
        baseClip({ takeGroupId: 'g1' }),
        baseClip({ id: 'clip-b', start: 4, takeGroupId: 'g1' }),
      ],
      takeGroups: [group],
    })
    const project = projectOf(track)
    const one = removeClips(project, ['clip-a'])
    expect(one.tracks[0].clips.map((c) => c.id)).toEqual(['clip-b'])
    expect(one.tracks[0].takeGroups![0].activeTakeId).toBe('clip-b')
    const none = removeClips(project, ['clip-a', 'clip-b'])
    expect(none.tracks[0].takeGroups).toEqual([])
    expect(cleanTakeGroups(emptyTrack({ takeGroups: [group] })).takeGroups).toEqual([])
  })

  it('duplicates a track with independent clip, take and effect identifiers', () => {
    const track = emptyTrack({
      name: 'Voz',
      clips: [baseClip({ takeGroupId: 'g1' })],
      effects: [createEffect('eq')],
      takeGroups: [{ id: 'g1', name: 'Toma', start: 1, duration: 2, activeTakeId: 'clip-a' }],
    })
    const copy = duplicateTrack(track)
    expect(copy.id).not.toBe(track.id)
    expect(copy.name).toBe('Voz · copia')
    expect(copy.clips[0].id).not.toBe('clip-a')
    expect(copy.clips[0].takeGroupId).not.toBe('g1')
    expect(copy.takeGroups![0].id).toBe(copy.clips[0].takeGroupId)
    expect(copy.takeGroups![0].activeTakeId).toBe(copy.clips[0].id)
    expect(copy.effects[0].id).not.toBe(track.effects[0].id)
    expect(copy.effects[0].params).not.toBe(track.effects[0].params)
    expect(copy.hidden).toBe(false)
    expect(track.clips[0].id).toBe('clip-a')
  })
})

describe('timeline helpers', () => {
  it('snaps to the configured grid, honours bypass and rounds to samples otherwise', () => {
    const project: Project = {
      ...createProject(),
      bpm: 90,
      timeline: { scale: 42, snap: true, grid: 0.25 },
    }
    const step = (60 / 90) * 0.25
    expect(snapTime(step * 3 + step * 0.2, project)).toBeCloseTo(step * 3, 4)
    expect(snapTime(step * 3 + step * 0.2, project, true)).toBeCloseTo(step * 3 + step * 0.2, 4)
    const free = { ...project, timeline: { ...project.timeline!, snap: false } }
    expect(snapTime(0.1234567, free)).toBe(sampleTime(0.1234567))
    expect(sampleTime(0.000001)).toBe(0)
    expect(timelineSettings({ ...createProject(), timeline: undefined })).toEqual({
      scale: 42,
      snap: false,
      grid: 0.25,
    })
  })

  it('builds fades as an envelope and interpolates it', () => {
    const plain = baseClip({ fadeIn: undefined, fadeOut: undefined, envelope: undefined })
    expect(envelopePoints(plain)).toEqual([
      { time: 0, value: 1 },
      { time: 2, value: 1 },
    ])
    const faded = baseClip({ fadeIn: 0.5, fadeOut: 0.5 })
    expect(envelopePoints(faded).map((p) => p.time)).toEqual([0, 0.5, 1.5, 2])
    expect(envelopePoints(faded)[0].value).toBe(0)
    expect(envelopePoints(faded).at(-1)!.value).toBe(0)
    expect(envelopeAt(faded, 0)).toBe(0)
    expect(envelopeAt(faded, 0.25)).toBeCloseTo(0.5)
    expect(envelopeAt(faded, 1)).toBe(1)
    expect(envelopeAt(faded, 1.75)).toBeCloseTo(0.5)
    expect(envelopeAt(faded, 2)).toBe(0)
    const custom = baseClip({
      envelope: [
        { time: 0, value: 0.25 },
        { time: 2, value: 0.75 },
      ],
    })
    expect(envelopeAt(custom, 1)).toBeCloseTo(0.5)
  })
})
