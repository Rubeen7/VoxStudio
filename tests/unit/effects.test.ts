import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { describe, expect, it } from 'vitest'
import {
  cloneEffectChain,
  createEffect,
  effectTail,
  MAX_EFFECTS,
  normalizeEffects,
} from '../../src/model/effects'
import { createProject, projectPlaybackDuration } from '../../src/model/project'
import {
  deleteEffectPreset,
  listEffectPresets,
  loadProject,
  saveEffectPreset,
  saveProject,
} from '../../src/storage/projects'

describe('effect settings and persistence', () => {
  it('rejects unknown effects, repairs non-finite values and bounds unsafe feedback', () => {
    const effect = createEffect('delay')
    const chain = normalizeEffects([
      { ...effect, params: { time: NaN, feedback: 999, mix: -20 } },
      effect,
      { type: 'imaginary' },
      null,
    ])
    expect(chain).toHaveLength(2)
    expect(chain[0].params).toEqual({ time: 280, feedback: 75, mix: 0 })
    expect(chain[0].id).not.toBe(chain[1].id)
    expect(normalizeEffects(Array(20).fill(effect))).toHaveLength(MAX_EFFECTS)
  })
  it('clones presets without sharing identifiers or parameter objects', () => {
    const original = [createEffect('eq')]
    const copied = cloneEffectChain(original)
    copied[0].params.gain1 = 12
    expect(original[0].params.gain1).toBe(0)
    expect(copied[0].id).not.toBe(original[0].id)
  })
  it('includes active tails, ignores bypass/dry paths and caps extreme serial tails', () => {
    const project = createProject()
    project.tracks[0].clips = [
      { id: 'clip', assetId: 'asset', name: 'clip', start: 0, offset: 0, duration: 2 },
    ]
    const reverb = createEffect('reverb')
    project.tracks[0].effects = [reverb]
    expect(projectPlaybackDuration(project)).toBeCloseTo(3.7)
    reverb.enabled = false
    expect(projectPlaybackDuration(project)).toBe(2)
    reverb.enabled = true
    reverb.params.mix = 0
    expect(projectPlaybackDuration(project)).toBe(2)
    const delay = createEffect('delay')
    delay.params.time = 1000
    delay.params.feedback = 75
    expect(effectTail(Array(8).fill(delay))).toBe(60)
  })
  it('upgrades a real v1 database without losing track/clip data', async () => {
    const old = createProject()
    const legacy = {
      ...old,
      version: 1,
      tracks: old.tracks.map(({ effects: _effects, ...track }) => track),
    }
    const db = await openDB('vox-studio', 1, {
      upgrade(database) {
        database.createObjectStore('projects', { keyPath: 'id' })
        database
          .createObjectStore('assets', { keyPath: 'id' })
          .createIndex('projectId', 'projectId')
        database.createObjectStore('settings')
      },
    })
    await db.put('projects', legacy)
    await db.put('settings', old.id, 'last-project')
    db.close()
    const restored = (await loadProject())!.project
    expect(restored.version).toBe(2)
    expect(restored.tracks.map((t) => t.effects)).toEqual([[], [], [], [], []])
    expect(restored.tracks[0].id).toBe(old.tracks[0].id)
    restored.tracks[1].effects = [createEffect('compressor'), createEffect('deesser')]
    await saveProject(restored, [])
    expect((await loadProject())!.project.tracks[1].effects).toEqual(restored.tracks[1].effects)
  })
  it('stores reusable custom presets separately from projects', async () => {
    const effects = [createEffect('reverb'), createEffect('eq')]
    effects[0].enabled = false
    const preset = await saveEffectPreset('  Cadena vocal  ', effects)
    effects[1].params.gain1 = 10
    const saved = (await listEffectPresets()).find((p) => p.id === preset.id)!
    expect(saved.name).toBe('Cadena vocal')
    expect(saved.effects.map((e) => e.type)).toEqual(['reverb', 'eq'])
    expect(saved.effects[0].enabled).toBe(false)
    expect(saved.effects[1].params.gain1).toBe(0)
    await deleteEffectPreset(saved.id)
    expect((await listEffectPresets()).some((p) => p.id === saved.id)).toBe(false)
    await expect(saveEffectPreset(' ', effects)).rejects.toThrow('nombre')
  })
})
