import { useCallback, useEffect, useRef, useState } from 'react'
import { audioEngine as engine, type TransportState } from '../audio/AudioEngine'
import { downloadBlob } from '../audio/wav'
import {
  createProject,
  createTrack,
  MAX_DECODED_BYTES,
  MAX_SECONDS,
  projectDuration,
  type AudioAsset,
  type Clip,
  type Project,
  type Track,
  type TrackKind,
} from '../model/project'
import * as storage from '../storage/projects'

function errorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError')
      return 'No se ha permitido acceder al micrófono. Activa el permiso en la barra de direcciones y vuelve a grabar.'
    if (error.name === 'NotFoundError')
      return 'No se ha encontrado un micrófono. Conecta uno y vuelve a intentarlo.'
    if (error.name === 'NotReadableError')
      return 'El micrófono está ocupado o no está disponible. Revisa la entrada de audio del sistema.'
    if (error.name === 'QuotaExceededError')
      return 'No hay espacio local suficiente. La sesión sigue en memoria; exporta tu mezcla antes de cerrar.'
    if (error.name === 'EncodingError')
      return 'No se ha podido decodificar el audio. Prueba un archivo WAV o MP3 válido.'
  }
  return error instanceof Error ? error.message : 'Ha ocurrido un error inesperado.'
}

export function useStudio() {
  const [project, setProject] = useState<Project>(createProject)
  const projectRef = useRef(project)
  const assets = useRef(new Map<string, AudioAsset>())
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState<string | null>('Abriendo estudio…')
  const busyRef = useRef(true)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('unsaved')
  const savedSnapshot = useRef<Project | null>(null)
  const saveQueue = useRef(Promise.resolve())
  const [transport, setTransport] = useState<TransportState>('stopped')
  const [position, setPosition] = useState(0)
  const [levels, setLevels] = useState({ master: 0, input: 0 })
  const [selectedTrackId, setSelectedTrackId] = useState(project.tracks[1].id)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [recordingTrackId, setRecordingTrackId] = useState<string | null>(null)
  const [recordingStart, setRecordingStart] = useState(0)
  const recordMeta = useRef<{ trackId: string; position: number; maxDuration: number } | null>(null)
  const finishRef = useRef<() => Promise<void>>(async () => {})
  const [library, setLibrary] = useState<Project[] | null>(null)

  const notify = useCallback((text: string, error = false) => setNotice({ text, error }), [])
  const setOperation = useCallback((value: string | null) => {
    busyRef.current = !!value
    setBusy(value)
  }, [])

  const commit = useCallback((next: Project, schedule = false) => {
    next = { ...next, updatedAt: Date.now() }
    projectRef.current = next
    setProject(next)
    setSaveStatus('unsaved')
    engine.updateMix(next)
    if (schedule) engine.reschedule(next)
  }, [])

  const persist = useCallback(async () => {
    const snapshot = projectRef.current
    const snapshotAssets = [...assets.current.values()]
    setSaveStatus('saving')
    const task = saveQueue.current
      .catch(() => {})
      .then(() => storage.saveProject(snapshot, snapshotAssets))
    saveQueue.current = task
    try {
      await task
      savedSnapshot.current = snapshot
      setSaveStatus(projectRef.current === snapshot ? 'saved' : 'unsaved')
    } catch (error) {
      setSaveStatus('error')
      notify(`Error de guardado: ${errorMessage(error)}`, true)
      throw error
    }
  }, [notify])

  const install = useCallback(async (saved: Awaited<ReturnType<typeof storage.loadProject>>) => {
    const next = saved?.project ?? createProject()
    const buffers = new Map<string, AudioBuffer>()
    let bytes = 0
    for (const asset of saved?.assets ?? []) {
      const buffer = await engine.decode(asset.blob)
      bytes += buffer.length * buffer.numberOfChannels * 4
      if (bytes > MAX_DECODED_BYTES)
        throw new Error(
          'Este proyecto supera el límite de memoria de 256 MB de audio decodificado.',
        )
      buffers.set(asset.id, buffer)
    }
    engine.stop()
    engine.replaceBuffers(buffers)
    assets.current = new Map((saved?.assets ?? []).map((a) => [a.id, a]))
    projectRef.current = next
    setProject(next)
    savedSnapshot.current = saved ? next : null
    setSaveStatus(saved ? 'saved' : 'unsaved')
    setSelectedTrackId(next.tracks.find((t) => t.kind !== 'beat')?.id ?? next.tracks[0]?.id ?? '')
    setSelectedClipId(null)
    setTransport('stopped')
    setPosition(0)
  }, [])

  useEffect(() => {
    let cancelled = false
    const initialize = async () => {
      try {
        const saved = await storage.loadProject()
        if (!cancelled) await install(saved)
      } catch (error) {
        if (!cancelled) notify(`No se pudo recuperar la sesión: ${errorMessage(error)}`, true)
      } finally {
        if (!cancelled) {
          setReady(true)
          setOperation(null)
        }
      }
    }
    void initialize()
    return () => {
      cancelled = true
    }
  }, [install, notify, setOperation])

  useEffect(() => {
    if (!ready || savedSnapshot.current === project) return
    const timeout = setTimeout(() => {
      void persist().catch(() => {})
    }, 600)
    return () => clearTimeout(timeout)
  }, [project, ready, persist])

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (recordMeta.current || busyRef.current || savedSnapshot.current !== projectRef.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [])

  const finishRecording = useCallback(async () => {
    const meta = recordMeta.current
    if (!meta || busyRef.current) return
    setOperation('Guardando toma…')
    recordMeta.current = null
    try {
      const captured = await engine.finishRecording()
      setTransport('paused')
      setRecordingTrackId(null)
      if (captured && captured.buffer.duration >= 0.03) {
        const id = crypto.randomUUID()
        const current = projectRef.current
        const track = current.tracks.find((t) => t.id === meta.trackId)!
        const name = `${track.name} · Toma ${track.clips.length + 1}`
        const asset: AudioAsset = {
          id,
          projectId: current.id,
          name,
          blob: captured.blob,
          duration: captured.buffer.duration,
          sampleRate: captured.buffer.sampleRate,
          channels: 1,
        }
        assets.current.set(id, asset)
        engine.setBuffer(id, captured.buffer)
        const clip: Clip = {
          id: crypto.randomUUID(),
          assetId: id,
          name,
          start: meta.position,
          offset: 0,
          duration: Math.min(captured.buffer.duration, MAX_SECONDS - meta.position),
        }
        commit({
          ...current,
          tracks: current.tracks.map((t) =>
            t.id === meta.trackId ? { ...t, clips: [...t.clips, clip] } : t,
          ),
        })
        setSelectedClipId(clip.id)
        await persist()
        notify(
          captured.recovered
            ? 'Se ha recuperado la toma tras un fallo del motor de audio. Puede faltar el último bloque (hasta 0,35 s).'
            : 'Toma guardada. Ya puedes editarla o grabar otra capa.',
          captured.recovered,
        )
      } else notify('La toma es demasiado corta. Mantén la grabación unos instantes.', true)
    } catch (error) {
      notify(errorMessage(error), true)
    } finally {
      setRecordingTrackId(null)
      setTransport('paused')
      setOperation(null)
    }
  }, [commit, notify, persist, setOperation])

  useEffect(() => {
    finishRef.current = finishRecording
  }, [finishRecording])

  useEffect(() => {
    engine.onCaptureEnded = () => {
      if (recordMeta.current) void finishRef.current()
    }
    engine.onInterrupted = () => {
      if (recordMeta.current) {
        notify('La entrada de audio se ha interrumpido. Se está recuperando la toma.', true)
        void finishRef.current()
      } else {
        engine.pause()
        setTransport('paused')
        notify('Audio pausado por el navegador. Pulsa Reproducir para continuar.')
      }
    }
    let frame = 0
    let previous = 0
    const tick = (time: number) => {
      if (time - previous > 32) {
        previous = time
        const now = engine.position
        setPosition(now)
        const nextLevels = engine.readLevels()
        setLevels((previous) =>
          previous.master === nextLevels.master && previous.input === nextLevels.input
            ? previous
            : nextLevels,
        )
        if (engine.state === 'playing' && now >= projectDuration(projectRef.current)) {
          engine.pause()
          engine.seek(projectDuration(projectRef.current), projectRef.current)
          setTransport('paused')
        }
        if (
          recordMeta.current &&
          now >= recordMeta.current.position + recordMeta.current.maxDuration
        )
          void finishRef.current()
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      engine.onInterrupted = undefined
      engine.onCaptureEnded = undefined
    }
  }, [notify])

  const playPause = useCallback(async () => {
    if (busyRef.current || recordMeta.current) return
    if (engine.state === 'playing') {
      engine.pause()
      setPosition(engine.position)
      setTransport('paused')
      return
    }
    if (!projectDuration(projectRef.current)) {
      notify('Importa un beat o graba tu primera voz para reproducir.')
      return
    }
    setOperation('Preparando audio…')
    try {
      await engine.play(
        projectRef.current,
        engine.position >= projectDuration(projectRef.current) ? 0 : engine.position,
      )
      setTransport('playing')
    } catch (error) {
      notify(errorMessage(error), true)
    } finally {
      setOperation(null)
    }
  }, [notify, setOperation])

  const stop = useCallback(async () => {
    if (busyRef.current) return
    if (recordMeta.current) await finishRecording()
    engine.stop()
    setTransport('stopped')
    setPosition(0)
  }, [finishRecording])

  const record = useCallback(async () => {
    if (busyRef.current) return
    if (recordMeta.current) {
      await finishRecording()
      return
    }
    const current = projectRef.current
    const track = current.tracks.find((t) => t.id === selectedTrackId)
    if (!track || track.kind === 'beat') {
      notify('Selecciona una pista de voz para grabar.', true)
      return
    }
    engine.pause()
    setTransport('paused')
    const position = engine.position
    const maxDuration = Math.min(
      MAX_SECONDS - position,
      (MAX_DECODED_BYTES - engine.decodedBytes) / (engine.sampleRate * 4),
    )
    if (maxDuration < 1) {
      notify('Has alcanzado el límite de sesión o de memoria. Abre un proyecto nuevo.', true)
      return
    }
    setOperation('Esperando al micrófono…')
    try {
      await engine.startRecording(current, position, maxDuration)
      recordMeta.current = { trackId: track.id, position, maxDuration }
      setRecordingTrackId(track.id)
      setRecordingStart(position)
      setTransport('recording')
      setNotice(null)
    } catch (error) {
      notify(errorMessage(error), true)
    } finally {
      setOperation(null)
    }
  }, [finishRecording, notify, selectedTrackId, setOperation])

  const seek = useCallback((seconds: number) => {
    if (busyRef.current || recordMeta.current || !Number.isFinite(seconds)) return
    engine.seek(seconds, projectRef.current)
    setPosition(engine.position)
  }, [])

  const updateProject = useCallback(
    (patch: Partial<Pick<Project, 'name' | 'bpm' | 'masterVolume'>>) => {
      if (busyRef.current) return
      commit({ ...projectRef.current, ...patch })
    },
    [commit],
  )

  const updateTrack = useCallback(
    (id: string, patch: Partial<Pick<Track, 'name' | 'volume' | 'pan' | 'muted' | 'solo'>>) => {
      if (busyRef.current) return
      commit({
        ...projectRef.current,
        tracks: projectRef.current.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      })
    },
    [commit],
  )

  const addTrack = useCallback(
    (kind: TrackKind) => {
      if (busyRef.current || recordMeta.current) return
      const track = createTrack(kind)
      commit({ ...projectRef.current, tracks: [...projectRef.current.tracks, track] }, true)
      setSelectedTrackId(track.id)
      setSelectedClipId(null)
    },
    [commit],
  )

  const updateClip = useCallback(
    (id: string, patch: Partial<Pick<Clip, 'start' | 'offset' | 'duration' | 'name'>>) => {
      if (busyRef.current || recordMeta.current) return
      commit(
        {
          ...projectRef.current,
          tracks: projectRef.current.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((clip) => {
              if (clip.id !== id) return clip
              const next = { ...clip, ...patch }
              const sourceDuration = engine.getBuffer(clip.assetId)?.duration ?? clip.duration
              next.offset = Math.min(
                Math.max(0, Number.isFinite(next.offset) ? next.offset : clip.offset),
                Math.max(0, sourceDuration - 0.01),
              )
              next.duration = Math.max(
                0.01,
                Math.min(
                  Number.isFinite(next.duration) ? next.duration : clip.duration,
                  sourceDuration - next.offset,
                ),
              )
              next.start = Math.max(
                0,
                Math.min(
                  Number.isFinite(next.start) ? next.start : clip.start,
                  MAX_SECONDS - next.duration,
                ),
              )
              return next
            }),
          })),
        },
        true,
      )
    },
    [commit],
  )

  const removeClip = useCallback(
    (id: string) => {
      if (busyRef.current || recordMeta.current) return
      commit(
        {
          ...projectRef.current,
          tracks: projectRef.current.tracks.map((t) => ({
            ...t,
            clips: t.clips.filter((c) => c.id !== id),
          })),
        },
        true,
      )
      const referenced = new Set(
        projectRef.current.tracks.flatMap((t) => t.clips.map((c) => c.assetId)),
      )
      for (const assetId of assets.current.keys()) {
        if (!referenced.has(assetId)) {
          assets.current.delete(assetId)
          engine.removeBuffer(assetId)
        }
      }
      setSelectedClipId(null)
    },
    [commit],
  )

  const importAudio = useCallback(
    async (files: File[]) => {
      if (busyRef.current || recordMeta.current || !files.length) return
      setOperation('Importando audio…')
      let imported = 0
      try {
        engine.pause()
        setTransport('paused')
        for (const file of files) {
          if (file.size > 100 * 1024 * 1024)
            throw new Error(`${file.name}: el máximo es 100 MB por archivo.`)
          if (!/\.(wav|mp3|ogg|m4a|aac|flac|webm)$/i.test(file.name))
            throw new Error(
              `${file.name}: selecciona un archivo WAV, MP3, OGG, M4A, AAC, FLAC o WebM.`,
            )
          const buffer = await engine.decode(file)
          if (buffer.duration > MAX_SECONDS || buffer.duration <= 0)
            throw new Error('Cada audio debe durar entre 0 y 15 minutos.')
          if (buffer.numberOfChannels > 2)
            throw new Error('Esta fase admite archivos mono o estéreo.')
          if (engine.decodedBytes + buffer.length * buffer.numberOfChannels * 4 > MAX_DECODED_BYTES)
            throw new Error('Se ha alcanzado el límite de 256 MB de audio decodificado.')
          const current = projectRef.current
          const id = crypto.randomUUID()
          assets.current.set(id, {
            id,
            projectId: current.id,
            name: file.name,
            blob: file,
            duration: buffer.duration,
            sampleRate: buffer.sampleRate,
            channels: buffer.numberOfChannels,
          })
          engine.setBuffer(id, buffer)
          const selected = current.tracks.find((t) => t.id === selectedTrackId)
          const track =
            imported === 0
              ? (current.tracks.find((t) => t.kind === 'beat' && !t.clips.length) ??
                selected ??
                current.tracks[0])
              : createTrack('beat')
          const start = Math.min(engine.position, MAX_SECONDS - buffer.duration)
          const clip: Clip = {
            id: crypto.randomUUID(),
            assetId: id,
            name: file.name.replace(/\.[^.]+$/, ''),
            start,
            offset: 0,
            duration: buffer.duration,
          }
          const tracks = current.tracks.some((t) => t.id === track.id)
            ? current.tracks
            : [...current.tracks, track]
          commit({
            ...current,
            tracks: tracks.map((t) =>
              t.id === track.id ? { ...t, clips: [...t.clips, clip] } : t,
            ),
          })
          setSelectedClipId(clip.id)
          setSelectedTrackId(track.id)
          imported++
        }
        await persist()
        notify(
          `${imported} ${imported === 1 ? 'archivo importado' : 'archivos importados'}. Audio listo para grabar.`,
        )
      } catch (error) {
        notify(errorMessage(error), true)
      } finally {
        setOperation(null)
      }
    },
    [commit, notify, persist, selectedTrackId, setOperation],
  )

  const exportMix = useCallback(async () => {
    if (busyRef.current || recordMeta.current) return
    engine.pause()
    setTransport('paused')
    setOperation('Renderizando mezcla WAV…')
    try {
      const { blob, peak } = await engine.render(projectRef.current)
      if (peak > 1) {
        notify(
          'La mezcla supera 0 dBFS. Baja el volumen master o las pistas y vuelve a exportar para evitar distorsión.',
          true,
        )
        return
      }
      downloadBlob(blob, `${projectRef.current.name.replace(/[<>:"/\\|?*]/g, '_') || 'VOX'}.wav`)
      notify('Mezcla exportada: WAV estéreo · 48 kHz · 16 bits.')
    } catch (error) {
      notify(errorMessage(error), true)
    } finally {
      setOperation(null)
    }
  }, [notify, setOperation])

  const openLibrary = useCallback(async () => {
    if (busyRef.current || recordMeta.current) return
    try {
      await persist()
      setLibrary(await storage.listProjects())
    } catch (error) {
      notify(errorMessage(error), true)
    }
  }, [notify, persist])

  const switchProject = useCallback(
    async (id?: string) => {
      if (busyRef.current || recordMeta.current) return
      setOperation(id ? 'Abriendo proyecto…' : 'Creando sesión…')
      try {
        await persist()
        const saved = id ? await storage.loadProject(id) : null
        if (id && !saved) throw new Error('No se ha encontrado el proyecto.')
        await install(saved)
        await persist()
        setLibrary(null)
        setNotice(null)
      } catch (error) {
        notify(errorMessage(error), true)
      } finally {
        setOperation(null)
      }
    },
    [install, notify, persist, setOperation],
  )

  const save = useCallback(async () => {
    if (busyRef.current) return
    try {
      await persist()
      if (navigator.storage?.persist) await navigator.storage.persist()
      notify('Proyecto y grabaciones guardados en este navegador.')
    } catch {
      /* persist already reports the error. */
    }
  }, [notify, persist])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void save()
        return
      }
      if (element.closest('input, textarea, select, dialog, [role="dialog"]') || event.altKey)
        return
      if (event.ctrlKey || event.metaKey) return
      if (event.code === 'Space' && element.closest('button')) return
      if (event.code === 'Space') {
        event.preventDefault()
        if (recordMeta.current) void finishRecording()
        else void playPause()
      }
      if (event.key.toLowerCase() === 'r') {
        event.preventDefault()
        void record()
      }
      if (event.key === 'Home') {
        event.preventDefault()
        seek(0)
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [finishRecording, playPause, record, save, seek])

  const selectedTrack = project.tracks.find((t) => t.id === selectedTrackId) ?? project.tracks[0]
  const selectedClip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipId)
  return {
    project,
    ready,
    busy,
    notice,
    saveStatus,
    transport,
    position,
    levels,
    selectedTrack,
    selectedClip,
    recordingTrackId,
    recordingStart,
    library,
    locked: !!busy || transport === 'recording',
    selectTrack: (id: string) => {
      setSelectedTrackId(id)
      setSelectedClipId(null)
    },
    selectClip: (trackId: string, clipId: string) => {
      setSelectedTrackId(trackId)
      setSelectedClipId(clipId)
    },
    dismissNotice: () => setNotice(null),
    closeLibrary: () => setLibrary(null),
    playPause,
    stop,
    record,
    seek,
    updateProject,
    updateTrack,
    updateClip,
    addTrack,
    removeClip,
    importAudio,
    exportMix,
    openLibrary,
    switchProject,
    save,
  }
}

export type Studio = ReturnType<typeof useStudio>
