import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { audioEngine as engine, type TransportState } from '../audio/AudioEngine'
import { downloadBlob } from '../audio/wav'
import {
  createProject,
  createTrack,
  MAX_DECODED_BYTES,
  MAX_SECONDS,
  projectDuration,
  projectPlaybackDuration,
  playableClips,
  type AudioAsset,
  type Clip,
  type Project,
  type Track,
  type TrackKind,
} from '../model/project'
import * as storage from '../storage/projects'
import { normalizeEffects, type AudioEffect } from '../model/effects'
import { importStart, isSupportedAudioFile } from '../model/importing'
import { ProjectHistory } from '../model/history'
import * as editing from '../model/editing'
import type { LatencyMode } from '../audio/MicrophoneInput'

function errorMessage(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'AbortError')
      return 'La solicitud de micrófono se ha cancelado o interrumpido. Puedes volver a intentarlo.'
    if (error.name === 'NotAllowedError')
      return 'No se ha permitido acceder al micrófono. Activa el permiso en la barra de direcciones y vuelve a intentarlo.'
    if (error.name === 'OverconstrainedError')
      return 'La entrada seleccionada ya no está disponible. Elige otro micrófono o la entrada del sistema.'
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
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([])
  const history = useRef(new ProjectHistory())
  // Labels are mirrored in state so rendering never reads the history ref.
  const [historyLabels, setHistoryLabels] = useState<{ undo: string | null; redo: string | null }>({
    undo: null,
    redo: null,
  })
  const syncHistoryLabels = useCallback(() => {
    const { past, future } = history.current.state
    setHistoryLabels({ undo: past.at(-1)?.label ?? null, redo: future.at(-1)?.label ?? null })
  }, [])
  const clipboard = useRef<{ trackId: string; clip: Clip }[]>([])
  const [hasClipboard, setHasClipboard] = useState(false)
  const [recordingTrackId, setRecordingTrackId] = useState<string | null>(null)
  const [recordingStart, setRecordingStart] = useState(0)
  const recordMeta = useRef<{ trackId: string; position: number; maxDuration: number; repeatClipId?: string } | null>(null)
  const finishRef = useRef<() => Promise<void>>(async () => {})
  const [library, setLibrary] = useState<Project[] | null>(null)
  const [input, setInput] = useState(() => engine.inputStatus)
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([])
  const [monitorRequest, setMonitorRequest] = useState<string | null>(null)
  const headphonesAcknowledged = useRef(false)
  const inputSelectionSupported = !!navigator.mediaDevices?.getSupportedConstraints().deviceId

  const notify = useCallback((text: string, error = false) => setNotice({ text, error }), [])
  const setOperation = useCallback((value: string | null) => {
    busyRef.current = !!value
    setBusy(value)
  }, [])

  const commit = useCallback((next: Project, schedule = false, label = 'Editar proyecto', mergeKey = '', recordHistory = true) => {
    const previous = projectRef.current
    if (next === previous) return
    // Validate the audio graph before changing the persistent snapshot/history.
    engine.updateMix(next)
    if (recordHistory) {
      history.current.record(previous, label, mergeKey)
      syncHistoryLabels()
    }
    next = { ...next, updatedAt: Date.now() }
    projectRef.current = next
    setProject(next)
    setSaveStatus('unsaved')
    if (schedule) engine.reschedule(next)
  }, [syncHistoryLabels])

  const persist = useCallback(async () => {
    const snapshot = projectRef.current
    const snapshotAssets = [...assets.current.values()]
    const snapshotHistory = history.current.state
    setSaveStatus('saving')
    const task = saveQueue.current
      .catch(() => {})
      .then(() => storage.saveProject(snapshot, snapshotAssets, snapshotHistory))
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
    engine.releaseInput()
    setMonitorRequest(null)
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
    history.current.restore(saved?.history)
    syncHistoryLabels()
    clipboard.current = []
    setHasClipboard(false)
    setSelectedClipIds([])
    setProject(next)
    savedSnapshot.current = saved ? next : null
    setSaveStatus(saved ? 'saved' : 'unsaved')
    setSelectedTrackId(next.tracks.find((t) => t.kind !== 'beat')?.id ?? next.tracks[0]?.id ?? '')
    setSelectedClipId(null)
    setTransport('stopped')
    setPosition(0)
  }, [syncHistoryLabels])

  const refreshInputs = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      setInputDevices(devices.filter((device) => device.kind === 'audioinput' && device.deviceId))
    } catch (error) {
      notify(`No se pudieron consultar las entradas: ${errorMessage(error)}`, true)
    }
  }, [notify])

  const toggleMonitoring = useCallback(
    async (trackId: string, acknowledged = false) => {
      if (busyRef.current) return
      const isOff = engine.inputStatus.monitorTrackId === trackId
      if (recordMeta.current && recordMeta.current.trackId !== trackId) return
      if (!isOff && !headphonesAcknowledged.current && !acknowledged) {
        setMonitorRequest(trackId)
        return
      }
      if (acknowledged) headphonesAcknowledged.current = true
      setMonitorRequest(null)
      setOperation(isOff ? 'Desactivando escucha…' : 'Preparando monitorización…')
      try {
        await engine.setMonitoring(projectRef.current, isOff ? null : trackId)
        if (!isOff && engine.inputStatus.monitorTrackId === trackId) {
          setSelectedTrackId(trackId)
          setSelectedClipId(null)
        }
        void refreshInputs()
      } catch (error) {
        notify(errorMessage(error), true)
      } finally {
        setOperation(null)
      }
    },
    [notify, refreshInputs, setOperation],
  )

  const configureInput = useCallback(
    async (deviceId: string, latencyMode: LatencyMode) => {
      if (busyRef.current || recordMeta.current) return
      setOperation('Configurando audio…')
      try {
        await engine.configureInput(deviceId, latencyMode)
      } catch (error) {
        notify(errorMessage(error), true)
      } finally {
        setOperation(null)
      }
    },
    [notify, setOperation],
  )

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
        const previousTake = track.clips.find(c => c.id === meta.repeatClipId)
        const existingGroup = track.takeGroups?.find(g => g.id === previousTake?.takeGroupId)
        const takeGroup = previousTake ? existingGroup ?? {
          id: crypto.randomUUID(), name: previousTake.name, start: previousTake.start,
          duration: previousTake.duration, activeTakeId: previousTake.id,
        } : undefined
        if (takeGroup) clip.takeGroupId = takeGroup.id
        commit({
          ...current,
          tracks: current.tracks.map((t) =>
            t.id === meta.trackId ? { ...t,
              clips: [...t.clips.map(c => c.id === previousTake?.id ? { ...c, takeGroupId: takeGroup!.id } : c), clip],
              takeGroups: takeGroup ? [...(t.takeGroups ?? []).filter(g => g.id !== takeGroup.id), { ...takeGroup, activeTakeId: clip.id }] : t.takeGroups,
            } : t,
          ),
        }, false, takeGroup ? 'Grabar otra toma' : 'Grabar voz')
        setSelectedClipId(clip.id)
        setSelectedClipIds([clip.id])
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
    const syncInput = () => {
      const next = engine.inputStatus
      setInput((previous) =>
        Object.keys(next).every(
          (key) => next[key as keyof typeof next] === previous[key as keyof typeof next],
        )
          ? previous
          : next,
      )
    }
    engine.onInputChanged = syncInput
    engine.onInputInterrupted = () => {
      if (recordMeta.current) {
        notify(
          'El micrófono se ha interrumpido. Se está recuperando la toma; la escucha queda desactivada.',
          true,
        )
        void finishRef.current()
      } else {
        engine.pause()
        setTransport('paused')
        notify(
          'Entrada interrumpida. La monitorización está desactivada; vuelve a activarla cuando esté disponible.',
          true,
        )
      }
    }
    const pagehide = () => {
      engine.releaseInput()
      if (recordMeta.current) void finishRef.current()
      else engine.stop()
    }
    window.addEventListener('pagehide', pagehide)
    navigator.mediaDevices?.addEventListener('devicechange', refreshInputs)
    // Device enumeration synchronizes external hardware, with state updated after the async query.
    // oxlint-disable-next-line react/set-state-in-effect
    void refreshInputs()
    engine.onCaptureEnded = () => {
      if (recordMeta.current) void finishRef.current()
    }
    engine.onInterrupted = () => {
      if (recordMeta.current) {
        engine.releaseInput()
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
    let lastInputUpdate = 0
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
        if (time - lastInputUpdate > 500) {
          lastInputUpdate = time
          syncInput()
        }
        if (engine.state === 'playing' && now >= projectPlaybackDuration(projectRef.current)) {
          engine.pause()
          engine.seek(projectPlaybackDuration(projectRef.current), projectRef.current)
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
      engine.onInputChanged = undefined
      engine.onInputInterrupted = undefined
      window.removeEventListener('pagehide', pagehide)
      navigator.mediaDevices?.removeEventListener('devicechange', refreshInputs)
      engine.releaseInput()
    }
  }, [notify, refreshInputs])

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
        engine.position >= projectPlaybackDuration(projectRef.current) ? 0 : engine.position,
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

  const record = useCallback(async (repeatClipId?: string) => {
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
    const previousTake = track.clips.find(c => c.id === repeatClipId)
    const section = track.takeGroups?.find(g => g.id === previousTake?.takeGroupId)
    const position = section?.start ?? previousTake?.start ?? engine.position
    const maxDuration = Math.min(
      MAX_SECONDS - position,
      (MAX_DECODED_BYTES - engine.decodedBytes) / (engine.sampleRate * 4),
      section?.duration ?? previousTake?.duration ?? MAX_SECONDS,
    )
    if (maxDuration < (previousTake ? 0.03 : 1)) {
      notify('Has alcanzado el límite de sesión o de memoria. Abre un proyecto nuevo.', true)
      return
    }
    setOperation('Esperando al micrófono…')
    try {
      const playback = previousTake ? { ...current, tracks: current.tracks.map(t => t.id === track.id ? {
        ...t, clips: t.clips.filter(c => c.id !== previousTake.id && (!section || c.takeGroupId !== section.id)),
      } : t) } : current
      await engine.startRecording(playback, position, maxDuration, track.id)
      void refreshInputs()
      recordMeta.current = { trackId: track.id, position, maxDuration, repeatClipId }
      setRecordingTrackId(track.id)
      setRecordingStart(position)
      setTransport('recording')
      setNotice(null)
    } catch (error) {
      notify(errorMessage(error), true)
    } finally {
      setOperation(null)
    }
  }, [finishRecording, notify, refreshInputs, selectedTrackId, setOperation])

  const seek = useCallback((seconds: number) => {
    if (busyRef.current || recordMeta.current || !Number.isFinite(seconds)) return
    engine.seek(seconds, projectRef.current)
    setPosition(engine.position)
  }, [])

  const updateProject = useCallback(
    (patch: Partial<Pick<Project, 'name' | 'bpm' | 'masterVolume' | 'timeline'>>) => {
      if (busyRef.current) return
      commit({ ...projectRef.current, ...patch }, false, 'Ajustar proyecto', `project:${Object.keys(patch).join()}`)
    },
    [commit],
  )

  const updateTrack = useCallback(
    (id: string, patch: Partial<Pick<Track, 'name' | 'volume' | 'pan' | 'muted' | 'solo' | 'color' | 'hidden' | 'collapsed' | 'group' | 'kind'>>) => {
      if (busyRef.current) return
      if (recordMeta.current && Object.keys(patch).some(key => !['volume','pan','muted','solo'].includes(key))) return
      commit({
        ...projectRef.current,
        tracks: projectRef.current.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      }, false, 'Ajustar pista', `track:${id}:${Object.keys(patch).join()}`)
    },
    [commit],
  )

  const updateEffects = useCallback(
    (trackId: string, effects: AudioEffect[]) => {
      if (busyRef.current) return
      const previous = projectRef.current
      const next = {
        ...previous,
        tracks: previous.tracks.map((track) =>
          track.id === trackId ? { ...track, effects: normalizeEffects(effects) } : track,
        ),
      }
      try {
        // Validate/update the live graph before persisting this edit.
        engine.updateMix(next)
        commit(next, false, 'Ajustar efectos', `effects:${trackId}:${effects.map(e => e.id).join()}`)
      } catch (error) {
        engine.updateMix(previous)
        notify(`No se pudo aplicar el efecto: ${errorMessage(error)}`, true)
      }
    },
    [commit, notify],
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
    (id: string, patch: Partial<Clip>) => {
      if (busyRef.current || recordMeta.current) return
      commit(
        {
          ...projectRef.current,
          tracks: projectRef.current.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((clip) => {
              if (clip.id !== id) return clip
              const sourceDuration = engine.getBuffer(clip.assetId)?.duration ?? clip.duration
              return editing.editClip(clip, patch, sourceDuration)
            }),
          })),
        },
        true,
        'Editar clip', `clip:${id}:${Object.keys(patch).join()}`,
      )
    },
    [commit],
  )

  /** Applies one non-destructive patch to every selected clip as a single undo step. */
  const updateClips = useCallback(
    (ids: string[], patch: Partial<Pick<Clip, 'gain' | 'fadeIn' | 'fadeOut' | 'name'>>) => {
      if (busyRef.current || recordMeta.current || !ids.length) return
      const selected = new Set(ids)
      commit(
        {
          ...projectRef.current,
          tracks: projectRef.current.tracks.map((t) => ({
            ...t,
            clips: t.clips.map((clip) => {
              if (!selected.has(clip.id)) return clip
              const sourceDuration = engine.getBuffer(clip.assetId)?.duration ?? clip.duration
              return editing.editClip(clip, patch, sourceDuration)
            }),
          })),
        },
        true,
        'Ajustar clips', `clips:${ids.join()}:${Object.keys(patch).join()}`,
      )
    },
    [commit],
  )

  const removeClip = useCallback(
    (id: string) => {
      if (busyRef.current || recordMeta.current) return
      commit(editing.removeClips(projectRef.current, [id]), true, 'Eliminar clip')
      setSelectedClipId(null)
      setSelectedClipIds([])
    },
    [commit],
  )

  const changeHistory = useCallback((direction: 'undo' | 'redo') => {
    if (busyRef.current || recordMeta.current) return
    const before = history.current.state
    const next = history.current[direction](projectRef.current)
    if (!next) return
    try {
      if (engine.inputStatus.monitorTrackId && !next.tracks.some(t => t.id === engine.inputStatus.monitorTrackId)) engine.releaseInput()
      commit(next, true, '', '', false)
      syncHistoryLabels()
      setSelectedTrackId(id => next.tracks.some(t => t.id === id) ? id : next.tracks[0].id)
      setSelectedClipId(null)
      setSelectedClipIds([])
    } catch (error) { history.current.restore(before); syncHistoryLabels(); notify(errorMessage(error), true) }
  }, [commit, notify, syncHistoryLabels])

  const selectionIds = useMemo(
    () => (selectedClipIds.length ? selectedClipIds : selectedClipId ? [selectedClipId] : []),
    [selectedClipIds, selectedClipId],
  )
  const deleteSelection = useCallback(() => {
    if (busyRef.current || recordMeta.current || !selectionIds.length) return
    commit(editing.removeClips(projectRef.current, selectionIds), true, 'Eliminar clips')
    setSelectedClipIds([]); setSelectedClipId(null)
  }, [commit, selectionIds])
  const splitSelection = useCallback(() => {
    if (busyRef.current || recordMeta.current) return
    const next = editing.splitSelected(projectRef.current, selectionIds, engine.position)
    if (next === projectRef.current) { notify('Coloca el cursor dentro del clip que quieres cortar.'); return }
    commit(next, true, 'Cortar clips')
  }, [commit, notify, selectionIds])
  const copySelection = useCallback(() => {
    if (!selectionIds.length) return
    clipboard.current = projectRef.current.tracks.flatMap(t => t.clips.filter(c => selectionIds.includes(c.id)).map(clip => ({ trackId: t.id, clip: structuredClone(clip) })))
    setHasClipboard(!!clipboard.current.length)
  }, [selectionIds])
  const insertCopies = useCallback((items: { trackId: string; clip: Clip }[], at: number, toSelectedTrack: boolean) => {
    if (busyRef.current || recordMeta.current || !items.length) return
    const origin = Math.min(...items.map(i => i.clip.start))
    const span = Math.max(...items.map(i => i.clip.start + i.clip.duration)) - origin
    const start = Math.max(0, Math.min(MAX_SECONDS - span, at))
    const singleSource = new Set(items.map(i => i.trackId)).size === 1
    const copies = items.map(({ trackId, clip }) => ({ trackId: toSelectedTrack && singleSource ? selectedTrackId : trackId,
      clip: { ...structuredClone(clip), id: crypto.randomUUID(), takeGroupId: undefined, start: editing.sampleTime(start + clip.start - origin) } }))
    if (copies.some(item => !projectRef.current.tracks.some(t => t.id === item.trackId))) { notify('La pista de origen ya no existe. Pega una selección de una sola pista en la pista actual.', true); return }
    commit({ ...projectRef.current, tracks: projectRef.current.tracks.map(t => ({ ...t, clips: [...t.clips, ...copies.filter(c => c.trackId === t.id).map(c => c.clip)] })) }, true, 'Duplicar / pegar clips')
    setSelectedClipIds(copies.map(c => c.clip.id)); setSelectedClipId(copies[0].clip.id); setSelectedTrackId(copies[0].trackId)
  }, [commit, notify, selectedTrackId])
  const pasteSelection = useCallback(() => insertCopies(clipboard.current, engine.position, true), [insertCopies])
  const duplicateSelection = useCallback(() => {
    const items = projectRef.current.tracks.flatMap(t => t.clips.filter(c => selectionIds.includes(c.id)).map(clip => ({ trackId: t.id, clip })))
    insertCopies(items, Math.max(0, ...items.map(i => i.clip.start + i.clip.duration)), false)
  }, [insertCopies, selectionIds])
  const moveSelection = useCallback((ids: string[], delta: number, destinationId?: string) => {
    if (busyRef.current || recordMeta.current) return
    commit(editing.moveClips(projectRef.current, ids, delta, destinationId), true, 'Mover clips')
    if (destinationId) setSelectedTrackId(destinationId)
  }, [commit])
  const trackOperation = useCallback((id: string, operation: 'delete' | 'duplicate' | 'up' | 'down') => {
    if (busyRef.current || recordMeta.current) return
    const current = projectRef.current, index = current.tracks.findIndex(t => t.id === id)
    if (index < 0) return
    const tracks = [...current.tracks]
    if (operation === 'delete') {
      if (tracks.length === 1) { notify('Conserva al menos una pista.'); return }
      if (engine.inputStatus.monitorTrackId === id) engine.releaseInput()
      tracks.splice(index, 1)
      setSelectedTrackId(tracks[Math.min(index, tracks.length - 1)].id)
      setSelectedClipIds([]); setSelectedClipId(null)
    } else if (operation === 'duplicate') {
      const copy = editing.duplicateTrack(tracks[index])
      tracks.splice(index + 1, 0, copy); setSelectedTrackId(copy.id)
    } else {
      const target = index + (operation === 'up' ? -1 : 1)
      if (target < 0 || target >= tracks.length) return
      ;[tracks[index], tracks[target]] = [tracks[target], tracks[index]]
    }
    commit({ ...current, tracks }, true, 'Organizar pistas')
  }, [commit, notify])
  /** Reorder one track by dropping it on another position (drag & drop in the track list). */
  const moveTrack = useCallback((id: string, toIndex: number) => {
    if (busyRef.current || recordMeta.current) return
    const current = projectRef.current
    const from = current.tracks.findIndex((t) => t.id === id)
    const to = Math.max(0, Math.min(current.tracks.length - 1, toIndex))
    if (from < 0 || from === to) return
    const tracks = [...current.tracks]
    const [moved] = tracks.splice(from, 1)
    tracks.splice(to, 0, moved)
    commit({ ...current, tracks }, true, 'Reordenar pistas')
  }, [commit])
  const chooseTake = useCallback(async (trackId: string, groupId: string, clipId: string, audition = false) => {
    if (busyRef.current || recordMeta.current) return
    const current = projectRef.current, track = current.tracks.find(t => t.id === trackId)
    if (!track?.clips.some(c => c.id === clipId && c.takeGroupId === groupId)) return
    const next = { ...current, tracks: current.tracks.map(t => t.id === trackId ? {
      ...t, takeGroups: t.takeGroups?.map(g => g.id === groupId ? { ...g, activeTakeId: clipId } : g),
    } : t) }
    commit(next, true, 'Elegir toma')
    setSelectedClipId(clipId); setSelectedClipIds([clipId]); setSelectedTrackId(trackId)
    if (audition) {
      setOperation('Preparando audio…')
      try { await engine.play(next, track.takeGroups!.find(g => g.id === groupId)!.start); setTransport('playing') }
      catch (error) { notify(errorMessage(error), true) }
      finally { setOperation(null) }
    }
  }, [commit, notify, setOperation])
  const updateMarker = useCallback((id: string | null, patch: { name?: string; time?: number }, remove = false) => {
    if (busyRef.current || recordMeta.current) return
    const markers = [...(projectRef.current.markers ?? [])]
    if (!id) markers.push({ id: crypto.randomUUID(), name: patch.name ?? 'Sección', time: editing.sampleTime(engine.position) })
    const next = markers.filter(m => !remove || m.id !== id).map(m => m.id === id ? {
      ...m, ...patch, time: editing.sampleTime(Math.max(0, Math.min(MAX_SECONDS, Number.isFinite(patch.time) ? patch.time! : m.time))),
    } : m).sort((a,b) => a.time - b.time)
    commit({ ...projectRef.current, markers: next }, false, 'Editar marcadores', id && !remove ? `marker:${id}` : '')
  }, [commit])

  const updateGroup = useCallback((group: string, patch: Pick<Track, 'collapsed'>) => {
    if (busyRef.current || recordMeta.current) return
    commit({ ...projectRef.current, tracks: projectRef.current.tracks.map(t => t.group === group ? { ...t, ...patch } : t) }, false, 'Organizar grupo')
  }, [commit])

  const importAudio = useCallback(
    async (files: File[], target?: { trackId?: string; start?: number }) => {
      if (busyRef.current || recordMeta.current || !files.length) return
      // Validate the whole drop before committing anything, so an accidental
      // non-audio file never leaves a half-finished import behind.
      const unsupported = files.find((file) => !isSupportedAudioFile(file.name))
      if (unsupported) {
        notify(`«${unsupported.name}» no es un archivo de audio compatible. Usa WAV o MP3.`, true)
        return
      }
      setOperation('Importando audio…')
      let imported = 0
      let sequential = 0
      try {
        engine.pause()
        setTransport('paused')
        for (const file of files) {
          if (file.size > 100 * 1024 * 1024)
            throw new Error(`${file.name}: el máximo es 100 MB por archivo.`)
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
          // A drop on a lane keeps every file on that track, one after another.
          const targetTrack = target?.trackId
            ? current.tracks.find((t) => t.id === target.trackId)
            : undefined
          const track =
            targetTrack ??
            (imported === 0
              ? (current.tracks.find((t) => t.kind === 'beat' && !t.clips.length) ??
                selected ??
                current.tracks[0])
              : createTrack('beat'))
          const start = importStart(
            target?.start ?? engine.position,
            buffer.duration,
            targetTrack ? sequential : 0,
          )
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
          setSelectedClipIds([clip.id])
          setSelectedTrackId(track.id)
          if (targetTrack) sequential += buffer.duration
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
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase()
        const actions: Record<string, () => void> = {
          z: () => changeHistory(event.shiftKey ? 'redo' : 'undo'), y: () => changeHistory('redo'),
          c: copySelection, v: pasteSelection, d: duplicateSelection,
          x: () => { copySelection(); deleteSelection() },
          a: () => { const ids = projectRef.current.tracks.flatMap(t => t.hidden ? [] : playableClips(t).map(c => c.id)); setSelectedClipIds(ids); setSelectedClipId(ids[0] ?? null) },
        }
        if (actions[key]) { event.preventDefault(); actions[key]() }
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection() }
      if (event.key.toLowerCase() === 's') { event.preventDefault(); splitSelection() }
      if (event.key.toLowerCase() === 'm') { event.preventDefault(); updateMarker(null, { name: 'Sección' }) }
      if (['+', '=', '-'].includes(event.key)) {
        event.preventDefault()
        const timeline = editing.timelineSettings(projectRef.current)
        updateProject({ timeline: { ...timeline, scale: Math.max(12, Math.min(720, timeline.scale * (event.key === '-' ? 1 / 1.3 : 1.3))) } })
      }
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
  }, [finishRecording, playPause, record, save, seek, changeHistory, copySelection, pasteSelection, duplicateSelection, deleteSelection, splitSelection, updateMarker, updateProject])

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
    selectedClipIds: selectionIds,
    hasClipboard,
    undoLabel: historyLabels.undo,
    redoLabel: historyLabels.redo,
    undo: () => changeHistory('undo'),
    redo: () => changeHistory('redo'),
    copySelection, pasteSelection, duplicateSelection, deleteSelection, splitSelection, moveSelection,
    trackOperation, moveTrack, chooseTake, updateMarker, updateGroup,
    repeatTake: () => selectedClip && void record(selectedClip.id),
    recordingTrackId,
    recordingStart,
    library,
    input,
    inputDevices,
    inputSelectionSupported,
    monitorRequest,
    cancelInputRequest: () => engine.releaseInput(),
    cancelMonitoring: () => setMonitorRequest(null),
    toggleMonitoring,
    configureInput,
    refreshInputs,
    setMonitorVolume: (value: number) => engine.setMonitorVolume(value),
    locked: !!busy || transport === 'recording',
    selectTrack: (id: string) => {
      setSelectedTrackId(id)
      setSelectedClipId(null)
      setSelectedClipIds([])
    },
    selectClip: (trackId: string, clipId: string, additive = false, preserve = false) => {
      setSelectedTrackId(trackId)
      setSelectedClipId(clipId)
      setSelectedClipIds(ids => additive ? ids.includes(clipId) ? ids.filter(id => id !== clipId) : [...ids, clipId]
        : preserve && ids.includes(clipId) ? ids : [clipId])
    },
    dismissNotice: () => setNotice(null),
    closeLibrary: () => setLibrary(null),
    playPause,
    stop,
    record,
    seek,
    updateProject,
    updateTrack,
    updateEffects,
    updateClip,
    updateClips,
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
