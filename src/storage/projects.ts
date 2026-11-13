import { openDB, type DBSchema } from 'idb'
import type { AudioAsset, Project } from '../model/project'
import { migrateProject } from '../model/project'
import { cloneEffectChain, type EffectPreset } from '../model/effects'
import type { HistoryState } from '../model/history'

interface VoxDatabase extends DBSchema {
  projects: { key: string; value: Project }
  assets: { key: string; value: AudioAsset; indexes: { projectId: string } }
  settings: { key: string; value: string }
  presets: { key: string; value: EffectPreset }
  histories: { key: string; value: HistoryState }
}

const database = () =>
  openDB<VoxDatabase>('vox-studio', 3, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('projects', { keyPath: 'id' })
        db.createObjectStore('assets', { keyPath: 'id' }).createIndex('projectId', 'projectId')
        db.createObjectStore('settings')
      }
      if (oldVersion < 2) db.createObjectStore('presets', { keyPath: 'id' })
      if (oldVersion < 3) db.createObjectStore('histories')
    },
  })

/** A project snapshot and all its referenced audio commit in one atomic transaction. */
export async function saveProject(project: Project, assets: AudioAsset[], history?: HistoryState) {
  const db = await database()
  try {
    const tx = db.transaction(['projects', 'assets', 'settings', 'histories'], 'readwrite')
    try {
      const snapshots = [project, ...(history?.past ?? []).map(e => e.project), ...(history?.future ?? []).map(e => e.project)]
      const referenced = new Set(snapshots.flatMap(p => p.tracks.flatMap(t => t.clips.map(c => c.assetId))))
      for (const id of referenced) {
        if (await tx.objectStore('assets').getKey(id)) continue
        const asset = assets.find((a) => a.id === id)
        if (!asset) throw new Error('No se puede guardar: falta el audio de un clip.')
        await tx.objectStore('assets').put(asset)
      }
      // Preserve originals even after deleting the last region or pruning undo history.
      for (const asset of assets) if (asset.projectId === project.id && !(await tx.objectStore('assets').getKey(asset.id)))
        await tx.objectStore('assets').put(asset)
      await tx.objectStore('projects').put(project)
      if (history) await tx.objectStore('histories').put(history, project.id)
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
    const storedHistory = await db.get('histories', key)
    const migrateEntries = (entries: HistoryState['past']) => entries.slice(-50)
      .filter(e => e.project.id === project.id).map(e => ({ ...e, project: migrateProject(e.project) }))
    const history = storedHistory ? { past: migrateEntries(storedHistory.past), future: migrateEntries(storedHistory.future) } : undefined
    const historyIds = new Set([...(history?.past ?? []), ...(history?.future ?? [])].flatMap(e => e.project.tracks.flatMap(t => t.clips.map(c => c.assetId))))
    if ([...historyIds].some(id => !assets.some(a => a.id === id))) throw new Error('Falta audio necesario para recuperar el historial del proyecto.')
    return { project, assets, history }
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

export async function renameEffectPreset(id: string, name: string) {
  if (!name.trim()) throw new Error('Escribe un nombre para el preset.')
  const db = await database()
  try {
    const tx = db.transaction('presets', 'readwrite')
    const preset = await tx.store.get(id)
    if (!preset) throw new Error('No se encuentra el preset personalizado.')
    const next = { ...preset, name: name.trim().slice(0, 60), updatedAt: Date.now() }
    await tx.store.put(next)
    await tx.done
    return next
  } finally { db.close() }
}

export async function duplicateEffectPreset(id: string) {
  const db = await database()
  try {
    const original = await db.get('presets', id)
    if (!original) throw new Error('No se encuentra el preset.')
    const copy: EffectPreset = {
      ...original,
      id: crypto.randomUUID(),
      name: `${original.name} · copia`.slice(0, 60),
      updatedAt: Date.now(),
      effects: cloneEffectChain(original.effects),
    }
    await db.put('presets', copy)
    return copy
  } finally { db.close() }
}
