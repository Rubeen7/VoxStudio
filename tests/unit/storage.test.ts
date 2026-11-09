import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { createProject, type AudioAsset } from '../../src/model/project'
import { listProjects, loadProject, saveProject } from '../../src/storage/projects'

describe('atomic project persistence', () => {
  it('round-trips a recording Blob, edits and last-opened project', async () => {
    const project = createProject()
    const asset: AudioAsset = {
      id: crypto.randomUUID(),
      projectId: project.id,
      name: 'take.wav',
      blob: new Blob(['real bytes'], { type: 'audio/wav' }),
      duration: 2,
      channels: 1,
      sampleRate: 48000,
    }
    project.tracks[1].clips.push({
      id: 'take',
      assetId: asset.id,
      start: 3,
      offset: 0.1,
      duration: 1.9,
      name: 'Toma',
    })
    project.tracks[1].volume = 0.4
    await saveProject(project, [asset])
    const restored = await loadProject()
    expect(restored?.project).toEqual(project)
    expect(await restored?.assets[0].blob.text()).toBe('real bytes')
    expect((await listProjects()).some((p) => p.id === project.id)).toBe(true)
    const broken = structuredClone(project)
    broken.name = 'Must not commit'
    broken.tracks[0].clips.push({
      id: 'missing',
      assetId: 'absent',
      start: 0,
      offset: 0,
      duration: 1,
      name: 'Missing',
    })
    await expect(saveProject(broken, [])).rejects.toThrow('falta el audio')
    expect((await loadProject(project.id))?.project.name).toBe(project.name)
    project.tracks[1].clips = []
    await saveProject(project, [])
    expect((await loadProject(project.id))?.assets).toHaveLength(0)
  })
})
