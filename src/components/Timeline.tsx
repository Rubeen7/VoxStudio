import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from 'react'
import { Headphones, Mic, Music2, Plus, Upload } from 'lucide-react'
import type { Studio } from '../hooks/useStudio'
import {
  dbLabel,
  formatTime,
  MAX_SECONDS,
  projectPlaybackDuration,
  playableClips,
  trackKinds,
} from '../model/project'
import { snapTime } from '../model/editing'
import { timelineDropTime } from '../model/importing'
import { AudioClip } from './AudioClip'
import { ClipMenu } from './ClipTools'
import './Editing.css'
import { MAX_EFFECT_TAIL } from '../model/effects'


export function Timeline({
  studio,
  scale,
  onImport,
  onAdd,
  onFileDragActive,
  onFilesHandled,
}: {
  studio: Studio
  scale: number
  onImport: () => void
  onAdd: () => void
  onFileDragActive: (active: boolean) => void
  onFilesHandled: () => void
}) {
  const scroll = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [dropTarget, setDropTarget] = useState<{ trackId: string | null; time: number } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const duration = Math.min(
    MAX_SECONDS + MAX_EFFECT_TAIL,
    Math.max(
      60,
      projectPlaybackDuration(studio.project) + 15,
      Math.max(0, ...(studio.project.markers ?? []).map(m => m.time)) + 5,
      Math.ceil(studio.position / 30) * 30 + 30,
    ),
  )
  const width = duration * scale
  const barSeconds = 240 / studio.project.bpm
  const markerStep = Math.max(1, Math.ceil(62 / (barSeconds * scale)))
  const bars = Array.from(
    { length: Math.ceil(duration / barSeconds / markerStep) },
    (_, i) => i * markerStep,
  )
  const hasAudio = studio.project.tracks.some((track) => track.clips.length)
  const dropTrack = dropTarget?.trackId
    ? studio.project.tracks.find((track) => track.id === dropTarget.trackId)
    : undefined
  // Only external file drags opt in: clip and track-list drags use pointer events
  // or text/plain, so they never reach these handlers.
  const acceptsFiles = (event: DragEvent<HTMLDivElement>) =>
    !studio.locked && event.dataTransfer.types.includes('Files')
  const fileDropInfo = (event: DragEvent<HTMLDivElement>) => {
    const lane = (event.target as HTMLElement).closest<HTMLElement>('[data-track-id]')
    // The ruler marks time zero even when the drop lands outside a lane.
    const base = lane ?? event.currentTarget.querySelector<HTMLElement>('.ruler')
    if (!base) return { trackId: lane?.dataset.trackId ?? null, time: studio.position }
    const rect = base.getBoundingClientRect()
    const time = timelineDropTime(event.clientX, rect.left, scale, duration, studio.position)
    return {
      trackId: lane?.dataset.trackId ?? null,
      time: snapTime(time, studio.project, event.shiftKey),
    }
  }
  const fileDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsFiles(event)) return
    event.preventDefault()
    setDropTarget(fileDropInfo(event))
    onFileDragActive(true)
  }
  const fileDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsFiles(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    const info = fileDropInfo(event)
    setDropTarget((current) =>
      current && current.trackId === info.trackId && current.time === info.time ? current : info,
    )
  }
  const fileDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    const next = event.relatedTarget as Node | null
    if (next && event.currentTarget.contains(next)) return
    setDropTarget(null)
    onFileDragActive(false)
  }
  const fileDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files') || studio.locked) return
    event.preventDefault()
    event.stopPropagation()
    const info = fileDropInfo(event)
    const files = Array.from(event.dataTransfer.files)
    setDropTarget(null)
    onFileDragActive(false)
    onFilesHandled()
    void studio.importAudio(files, { trackId: info.trackId ?? undefined, start: info.time })
  }
  useEffect(() => {
    const element = scroll.current
    if (!element || (studio.transport !== 'playing' && studio.transport !== 'recording')) return
    const x = studio.position * scale
    const viewport = element.clientWidth - 224
    if (x > element.scrollLeft + viewport - 40 || x < element.scrollLeft)
      element.scrollLeft = Math.max(0, x - 60)
  }, [scale, studio.position, studio.transport])
  // Cancelled or finished drags (Escape, dropping elsewhere) must clear the line.
  useEffect(() => {
    const clearDrop = () => {
      setDropTarget(null)
      onFileDragActive(false)
    }
    window.addEventListener('dragend', clearDrop)
    window.addEventListener('drop', clearDrop)
    return () => {
      window.removeEventListener('dragend', clearDrop)
      window.removeEventListener('drop', clearDrop)
    }
  }, [onFileDragActive])
  return (
    <>
      {!hasAudio && studio.transport !== 'recording' && (
        <div className="session-start">
          <div>
            <strong>Sesión vacía</strong>
            <span>Importa un beat, selecciona una pista de voz y pulsa Grabar.</span>
          </div>
          <button className="button" onClick={onImport} disabled={studio.locked}>
            <Upload size={14} /> Importar beat
          </button>
        </div>
      )}
      <div
        className={`timeline-scroll ${dropTarget ? 'file-drop-active' : ''}`}
        ref={scroll}
        data-testid="timeline"
        onDragEnter={fileDragEnter}
        onDragOver={fileDragOver}
        onDragLeave={fileDragLeave}
        onDrop={fileDrop}
      >
        <div className="timeline-content" style={{ width: width + 224 }}>
          <div className="ruler-row">
            <div className="track-column ruler-label">
              <span>
                Pistas <b>{studio.project.tracks.length}</b>
              </span>
              <button
                className="icon-button small"
                aria-label="Añadir pista"
                disabled={studio.locked}
                onClick={onAdd}
              >
                <Plus size={16} />
              </button>
            </div>
            <div
              className="ruler"
              style={{ width }}
              onPointerDown={(event) =>
                studio.seek(
                  (event.clientX - event.currentTarget.getBoundingClientRect().left) / scale,
                )
              }
              aria-label="Regla de tiempo: pulsa para desplazar el cursor"
              role="slider"
              aria-valuenow={Math.round(studio.position)}
              aria-valuemin={0}
              aria-valuemax={MAX_SECONDS + MAX_EFFECT_TAIL}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  e.preventDefault()
                  studio.seek(studio.position + (e.key === 'ArrowRight' ? 1 : -1))
                }
              }}
            >
              {bars.map((bar) => (
                <span className="ruler-marker" key={bar} style={{ left: bar * barSeconds * scale }}>
                  <b>{bar + 1}</b>
                  <small>{formatTime(bar * barSeconds)}</small>
                </span>
              ))}
            </div>
          </div>
          {!!studio.project.markers?.length && <div className="marker-row"><div className="track-column marker-label">Marcadores</div><div className="marker-lane" style={{ width }}>
            {studio.project.markers.map(marker => <button key={marker.id} className="timeline-marker" style={{ left: marker.time * scale }} title={`${marker.name} · ${formatTime(marker.time, true)}`} onClick={() => studio.seek(marker.time)}>{marker.name || 'Sección'}</button>)}
          </div></div>}
          <div className="track-rows">
            {studio.project.tracks.filter(track => !track.hidden || track.id === studio.recordingTrackId).map((track) => (
              <div
                key={track.id}
                className={`track-row ${track.collapsed && track.id !== studio.recordingTrackId ? 'collapsed-track' : ''} ${studio.selectedTrack.id === track.id ? 'active-track' : ''} ${track.muted ? 'muted-track' : ''} ${studio.recordingTrackId === track.id ? 'recording-track' : ''} ${dropTarget?.trackId === track.id ? 'drop-target-track' : ''}`}
                style={{ '--track-color': track.color } as CSSProperties}
              >
                <div className="track-column track-controls">
                  <button
                    className="track-select"
                    onClick={() => studio.selectTrack(track.id)}
                    aria-label={`Seleccionar ${track.name}`}
                    aria-pressed={studio.selectedTrack.id === track.id}
                  >
                    <span className="track-number">{String(studio.project.tracks.indexOf(track) + 1).padStart(2, '0')}</span>
                    <span className="track-type-icon">
                      {track.kind === 'beat' ? <Music2 size={17} /> : <Mic size={17} />}
                    </span>
                    <span className="track-name">
                      <strong>{track.name}</strong>
                      <small>
                        {track.kind === 'beat'
                          ? 'Audio importado'
                          : studio.input.monitorTrackId === track.id
                            ? 'Escucha en directo'
                            : `${trackKinds[track.kind].name}${track.group ? ` · ${track.group}` : ''}`}
                      </small>
                    </span>
                    {studio.recordingTrackId === track.id && <i className="record-dot pulse" />}
                  </button>
                  <div className="track-buttons">
                    {track.kind !== 'beat' && (
                      <button
                        className={`mini-button ${studio.input.monitorTrackId === track.id ? 'monitor-on' : ''}`}
                        aria-label={`Monitorizar ${track.name}`}
                        title="Escucha con efectos · usa auriculares"
                        aria-pressed={studio.input.monitorTrackId === track.id}
                        disabled={
                          !!studio.busy ||
                          (!!studio.recordingTrackId && studio.recordingTrackId !== track.id)
                        }
                        onClick={() => void studio.toggleMonitoring(track.id)}
                      >
                        <Headphones size={13} />
                      </button>
                    )}
                    <button
                      className={`mini-button ${track.muted ? 'on mute' : ''}`}
                      aria-label={`Silenciar ${track.name}`}
                      title="Silenciar pista (Mute)"
                      aria-pressed={track.muted}
                      disabled={!!studio.busy}
                      onClick={() => studio.updateTrack(track.id, { muted: !track.muted })}
                    >
                      M
                    </button>
                    <button
                      className={`mini-button ${track.solo ? 'on solo' : ''}`}
                      aria-label={`Solo ${track.name}`}
                      title="Escuchar solo esta pista (Solo)"
                      aria-pressed={track.solo}
                      disabled={!!studio.busy}
                      onClick={() => studio.updateTrack(track.id, { solo: !track.solo })}
                    >
                      S
                    </button>
                    {track.kind !== 'beat' && (
                      <button
                        className={`mini-button record-ready ${(studio.recordingTrackId ?? studio.selectedTrack.id) === track.id ? 'armed' : ''}`}
                        aria-label={`Preparar grabación en ${track.name}`}
                        title="Seleccionar esta pista como destino de grabación"
                        aria-pressed={
                          (studio.recordingTrackId ?? studio.selectedTrack.id) === track.id
                        }
                        disabled={studio.locked}
                        onClick={() => studio.selectTrack(track.id)}
                      >
                        <span />
                      </button>
                    )}
                    <input
                      aria-label={`Volumen ${track.name}`}
                      type="range"
                      min="0"
                      max="1.5"
                      step="0.01"
                      value={track.volume}
                      disabled={!!studio.busy}
                      onChange={(e) =>
                        studio.updateTrack(track.id, { volume: Number(e.target.value) })
                      }
                    />
                    <small>{dbLabel(track.volume).replace(' dB', '')}</small>
                  </div>
                </div>
                <div
                  className="track-lane"
                  data-track-id={track.id}
                  style={{
                    width,
                    backgroundSize: `${barSeconds * scale}px 100%, ${(barSeconds * scale) / 4}px 100%`,
                  }}
                  onPointerDown={(event) => {
                    if (event.target !== event.currentTarget) return
                    studio.selectTrack(track.id)
                    studio.seek(
                      (event.clientX - event.currentTarget.getBoundingClientRect().left) / scale,
                    )
                  }}
                >
                  {playableClips(track).map((clip) => (
                    <AudioClip
                      key={clip.id}
                      clip={clip}
                      track={track}
                      studio={studio}
                      scale={scale}
                      onMenu={(x, y) => setMenu({ x, y })}
                    />
                  ))}
                  {studio.recordingTrackId === track.id && (
                    <div
                      className="recording-clip"
                      style={{
                        left: studio.recordingStart * scale,
                        width: Math.max(8, (studio.position - studio.recordingStart) * scale),
                      }}
                    >
                      <i className="record-dot pulse" /> Grabando…
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div
              className="playhead"
              style={{
                left: 224 + studio.position * scale,
              }}
            >
              <span />
            </div>
            {dropTarget && (
              <>
                <div
                  className="timeline-drop-line"
                  data-testid="file-drop-indicator"
                  style={{ left: 224 + dropTarget.time * scale }}
                  aria-hidden="true"
                />
                <div
                  className="timeline-drop-label"
                  style={{
                    left: Math.max(
                      232,
                      Math.min(224 + dropTarget.time * scale + 8, 224 + width - 205),
                    ),
                  }}
                  aria-hidden="true"
                >
                  {dropTrack
                    ? `Suelta en «${dropTrack.name}» · ${formatTime(dropTarget.time, true)}`
                    : `Suelta para importar · ${formatTime(dropTarget.time, true)}`}
                </div>
              </>
            )}
          </div>
          <div className="timeline-empty-space" style={{ width: width + 224 }}>
            <div className="track-column add-track-cell">
              <button onClick={onAdd} disabled={studio.locked}>
                <Plus size={14} /> Añadir pista
              </button>
            </div>
          </div>
        </div>
      </div>
      {menu && <ClipMenu studio={studio} {...menu} onClose={closeMenu} />}
    </>
  )
}
