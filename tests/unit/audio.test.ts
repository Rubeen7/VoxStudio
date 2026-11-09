import { describe, expect, it } from 'vitest'
import { encodeWav } from '../../src/audio/wav'
import {
  clipWindow,
  createProject,
  isAudible,
  projectDuration,
  type Clip,
} from '../../src/model/project'

describe('WAV compatible with PCM readers', () => {
  it('writes stereo metadata and signed interleaved PCM, with explicit saturation', () => {
    const result = encodeWav(
      [new Float32Array([-1, 0, 0.5, 2]), new Float32Array([1, -0.5, 0, -2])],
      48000,
    )
    const view = new DataView(result)
    const text = (at: number, size: number) =>
      new TextDecoder().decode(new Uint8Array(result, at, size))
    expect(text(0, 4)).toBe('RIFF')
    expect(text(8, 4)).toBe('WAVE')
    expect(view.getUint32(4, true)).toBe(result.byteLength - 8)
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(24, true)).toBe(48000)
    expect(view.getUint32(28, true)).toBe(192000)
    expect(view.getUint16(32, true)).toBe(4)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(16)
    expect(Array.from({ length: 8 }, (_, i) => view.getInt16(44 + i * 2, true))).toEqual([
      -32768, 32767, 0, -16384, 16384, 0, 32767, -32768,
    ])
  })
  it('rejects inconsistent channel lengths', () => {
    expect(() => encodeWav([new Float32Array(2), new Float32Array(1)], 44100)).toThrow()
  })
})

describe('seek, trims and audibility', () => {
  const clip: Clip = {
    id: 'clip',
    assetId: 'asset',
    name: 'take',
    start: 4,
    offset: 2,
    duration: 6,
  }
  it('schedules future clips with silence before their start', () =>
    expect(clipWindow(clip, 1)).toEqual({ delay: 3, offset: 2, duration: 6 }))
  it('seeks within a trimmed clip without resetting its source offset', () =>
    expect(clipWindow(clip, 7)).toEqual({ delay: 0, offset: 5, duration: 3 }))
  it('does not replay clips ending at or before the cursor', () => {
    expect(clipWindow(clip, 10)).toBeNull()
    expect(clipWindow(clip, 12)).toBeNull()
  })
  it('uses the latest clip end and preserves muted tails in export length', () => {
    const project = createProject()
    project.tracks[0].clips = [clip]
    project.tracks[0].muted = true
    expect(projectDuration(project)).toBe(10)
  })
  it('mute wins over solo and any solo excludes non-solo tracks', () => {
    const project = createProject()
    const [a, b] = project.tracks
    expect(isAudible(a, project.tracks)).toBe(true)
    b.solo = true
    expect(isAudible(a, project.tracks)).toBe(false)
    expect(isAudible(b, project.tracks)).toBe(true)
    b.muted = true
    expect(isAudible(b, project.tracks)).toBe(false)
  })
})
