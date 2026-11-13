import { describe, expect, it } from 'vitest'
import { importStart, isSupportedAudioFile, timelineDropTime } from '../../src/model/importing'
import { MAX_SECONDS } from '../../src/model/project'

describe('file drop importing helpers', () => {
  it('accepts WAV and MP3 names case-insensitively and rejects anything else', () => {
    for (const name of ['take.wav', 'TAKE.WAV', 'voz.mp3', 'Mi canción.Mp3'])
      expect(isSupportedAudioFile(name)).toBe(true)
    for (const name of ['notas.txt', 'cover.png', 'sin-extension', 'audio.wav.txt', ''])
      expect(isSupportedAudioFile(name)).toBe(false)
  })

  it('maps a pointer position to seconds inside the visible timeline', () => {
    expect(timelineDropTime(1424, 224, 42, 120)).toBeCloseTo((1424 - 224) / 42)
    expect(timelineDropTime(224, 224, 42, 120)).toBe(0)
    expect(timelineDropTime(99999, 224, 42, 120)).toBe(120)
    // Left of the timeline (over the track headers) falls back to the playhead.
    expect(timelineDropTime(100, 224, 42, 120, 7)).toBe(7)
    expect(timelineDropTime(100, 224, 42, 120)).toBe(0)
    expect(timelineDropTime(100, 224, 42, 120, 999)).toBe(120)
    expect(timelineDropTime(Number.NaN, 224, 42, 120, 3)).toBe(3)
    expect(timelineDropTime(500, 224, 0, 120, 3)).toBe(3)
  })

  it('places imports inside the session, on the sample grid and after earlier files', () => {
    expect(importStart(2, 3)).toBe(2)
    expect(importStart(-5, 3)).toBe(0)
    expect(importStart(MAX_SECONDS - 1, 3)).toBeCloseTo(MAX_SECONDS - 3)
    expect(importStart(2, 3, 3)).toBe(5)
    expect(importStart(2, 3, MAX_SECONDS)).toBeCloseTo(MAX_SECONDS - 3)
    expect(importStart(Number.NaN, 3)).toBe(0)
    expect(importStart(1.000005, 2) * 48000).toBeCloseTo(Math.round(1.000005 * 48000))
  })
})
