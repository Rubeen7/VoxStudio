import { openDB, type DBSchema } from 'idb'
import type { AudioAsset, Project } from '../model/project'
import { migrateProject } from '../model/project'
import { cloneEffectChain, type EffectPreset } from '../model/effects'

interface VoxDatabase extends DBSchema {
  projects: { key: string; value: Project }
  assets: { key: string; value: AudioAsset; indexes: { projectId: string } }
  settings: { key: string; value: string }
  presets: { key: string; value: EffectPreset }
}

const database = () =>
  openDB<VoxDatabase>('vox-studio', 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('projects', { keyPath: 'id' })
        db.createObjectStore('assets', { keyPath: 'id' }).createIndex('projectId', 'projectId')
        db.createObjectStore('settings')
      }
      if (oldVersion < 2) db.createObjectStore('presets', { keyPath: 'id' })
    },
  })

/** A project snapshot and all its referenced audio commit in one atomic transaction. */
export async function saveProject(project: Project, assets: AudioAsset[]) {
  const db = await database()
  try {
    const tx = db.transaction(['projects', 'assets', 'settings'], 'readwrite')
    try {
      const referenced = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.assetId)))
      for (const id of referenced) {
        if (await tx.objectStore('assets').getKey(id)) continue
        const asset = assets.find((a) => a.id === id)
        if (!asset) throw new Error('No se puede guardar: falta el audio de un clip.')
        await tx.objectStore('assets').put(asset)
      }
      const existing = await tx.objectStore('assets').index('projectId').getAllKeys(project.id)
      for (const id of existing) if (!referenced.has(id)) await tx.objectStore('assets').delete(id)
      await tx.objectStore('projects').put(project)
      await tx.objectStore('settings').put(project.id, 'last-project')
      await tx.done
    } catch (error) {
      try {
        tx.abort()
      } catch {
        /* Transaction already aborted. */
      }
      await tx.done.catch(() => {})
      throw error
    }
  } finally {
    db.close()
  }
}

export async function listProjects() {
  const db = await database()
  try {
    return (await db.getAll('projects'))
      .map(migrateProject)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } finally {
    db.close()
  }
}

export async function loadProject(id?: string) {
  const db = await database()
  try {
    const key = id ?? (await db.get('settings', 'last-project'))
    if (!key) return null
    const stored = await db.get('projects', key)
    if (!stored) return null
    const project = migrateProject(stored)
    const assets = await db.getAllFromIndex('assets', 'projectId', key)
    const required = new Set(project.tracks.flatMap((t) => t.clips.map((c) => c.assetId)))
    if ([...required].some((id) => !assets.some((a) => a.id === id)))
      throw new Error('El proyecto tiene archivos de audio ausentes.')
    return { project, assets }
  } finally {
    db.close()
  }
}

export async function listEffectPresets() {
  const db = await database()
  try {
    return (await db.getAll('presets'))
      .filter((p) => p.version === 1)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } finally {
    db.close()
  }
}

export async function saveEffectPreset(name: string, effects: EffectPreset['effects']) {
  if (!name.trim()) throw new Error('Escribe un nombre para el preset.')
  const preset: EffectPreset = {
    id: crypto.randomUUID(),
    version: 1,
    name: name.trim().slice(0, 60),
    updatedAt: Date.now(),
    effects: cloneEffectChain(effects),
  }
  const db = await database()
  try {
    await db.put('presets', preset)
    return preset
  } finally {
    db.close()
  }
}

export async function deleteEffectPreset(id: string) {
  const db = await database()
  try {
    await db.delete('presets', id)
  } finally {
    db.close()
  }
}
