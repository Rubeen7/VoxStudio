import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { AudioLines, Mic, Music2, Plus, Upload } from 'lucide-react'
import type { Studio } from '../hooks/useStudio'
import { audioEngine } from '../audio/AudioEngine'
import {
  dbLabel,
  formatTime,
  MAX_SECONDS,
  projectDuration,
  type Clip,
  type Track,
} from '../model/project'
import { Waveform } from './Waveform'

function AudioClip({
  clip,
  track,
  studio,
  scale,
  snap,
}: {
  clip: Clip
  track: Track
  studio: Studio
  scale: number
  snap: boolean
}) {
  const [drag, setDrag] = useState<number | null>(null)
  const gesture = useRef<{ x: number; start: number; moved: boolean } | null>(null)
  const buffer = audioEngine.getBuffer(clip.assetId)
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    studio.selectClip(track.id, clip.id)
    if (studio.locked || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { x: event.clientX, start: clip.start, moved: false }
  }
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!gesture.current) return
    const delta = event.clientX - gesture.current.x
    if (Math.abs(delta) < 3 && !gesture.current.moved) return
    gesture.current.moved = true
    const raw = gesture.current.start + delta / scale
    const grid = 60 / studio.project.bpm / 4
    const next = snap && !event.shiftKey ? Math.round(raw / grid) * grid : raw
    setDrag(Math.max(0, Math.min(MAX_SECONDS - clip.duration, next)))
  }
  const finish = (event: PointerEvent<HTMLButtonElement>) => {
    if (gesture.current?.moved && drag !== null) studio.updateClip(clip.id, { start: drag })
    gesture.current = null
    setDrag(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return (
    <button
      className={`audio-clip ${studio.selectedClip?.id === clip.id ? 'selected' : ''} ${drag !== null ? 'dragging' : ''}`}
      style={
        {
          left: (drag ?? clip.start) * scale,
          width: Math.max(8, clip.duration * scale),
          '--track-color': track.color,
        } as CSSProperties
      }
      aria-label={`Clip ${clip.name}, inicio ${clip.start.toFixed(2)} segundos`}
      title={`${clip.name} · ${formatTime(clip.duration, true)} · Arrastra para mover. Flechas: mover; Mayús: ajuste fino.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={() => {
        gesture.current = null
        setDrag(null)
      }}
      onKeyDown={(event) => {
        if (studio.locked) return
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          studio.updateClip(clip.id, {
            start:
              clip.start +
              (event.key === 'ArrowRight' ? 1 : -1) *
                (event.shiftKey ? 0.01 : 60 / studio.project.bpm / 4),
          })
        }
      }}
      onClick={() => studio.selectClip(track.id, clip.id)}
    >
      <span className="clip-heading">
        <AudioLines size={11} />
        <span>{clip.name}</span>
      </span>
      {buffer && (
        <Waveform
          buffer={buffer}
          color={track.color}
          offset={clip.offset}
          duration={clip.duration}
        />
      )}
    </button>
  )
}

export function Timeline({
  studio,
  scale,
  snap,
  onImport,
  onAdd,
}: {
  studio: Studio
  scale: number
  snap: boolean
  onImport: () => void
  onAdd: () => void
}) {
  const scroll = useRef<HTMLDivElement>(null)
  const duration = Math.min(
    MAX_SECONDS,
    Math.max(60, projectDuration(studio.project) + 15, Math.ceil(studio.position / 30) * 30 + 30),
  )
  const width = duration * scale
  const barSeconds = 240 / studio.project.bpm
  const markerStep = Math.max(1, Math.ceil(62 / (barSeconds * scale)))
  const bars = Array.from(
    { length: Math.ceil(duration / barSeconds / markerStep) },
    (_, i) => i * markerStep,
  )
  const hasAudio = studio.project.tracks.some((track) => track.clips.length)
  useEffect(() => {
    const element = scroll.current
    if (!element || (studio.transport !== 'playing' && studio.transport !== 'recording')) return
    const x = studio.position * scale
    const viewport = element.clientWidth - 224
    if (x > element.scrollLeft + viewport - 40 || x < element.scrollLeft)
      element.scrollLeft = Math.max(0, x - 60)
  }, [scale, studio.position, studio.transport])
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
      <div className="timeline-scroll" ref={scroll} data-testid="timeline">
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
              aria-valuemax={MAX_SECONDS}
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
          <div className="track-rows">
            {studio.project.tracks.map((track, index) => (
              <div
                key={track.id}
                className={`track-row ${studio.selectedTrack.id === track.id ? 'active-track' : ''} ${track.muted ? 'muted-track' : ''} ${studio.recordingTrackId === track.id ? 'recording-track' : ''}`}
                style={{ '--track-color': track.color } as CSSProperties}
              >
                <div className="track-column track-controls">
                  <button
                    className="track-select"
                    onClick={() => studio.selectTrack(track.id)}
                    aria-label={`Seleccionar ${track.name}`}
                    aria-pressed={studio.selectedTrack.id === track.id}
                  >
                    <span className="track-number">{String(index + 1).padStart(2, '0')}</span>
                    <span className="track-type-icon">
                      {track.kind === 'beat' ? <Music2 size={17} /> : <Mic size={17} />}
                    </span>
                    <span className="track-name">
                      <strong>{track.name}</strong>
                      <small>
                        {track.kind === 'beat' ? 'Audio importado' : 'Entrada: micrófono'}
                      </small>
                    </span>
                    {studio.recordingTrackId === track.id && <i className="record-dot pulse" />}
                  </button>
                  <div className="track-buttons">
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
                  {track.clips.map((clip) => (
                    <AudioClip
                      key={clip.id}
                      clip={clip}
                      track={track}
                      studio={studio}
                      scale={scale}
                      snap={snap}
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
    </>
  )
}
