import { Mic, Music2, SlidersHorizontal, Trash2, X } from 'lucide-react'
import type { Studio } from '../hooks/useStudio'
import { audioEngine } from '../audio/AudioEngine'
import { dbLabel, formatTime, MAX_SECONDS, trackKinds } from '../model/project'
import { LevelMeter } from './Mixer'

export function Inspector({ studio, onClose }: { studio: Studio; onClose: () => void }) {
  const track = studio.selectedTrack
  const clip = studio.selectedClip
  const buffer = clip ? audioEngine.getBuffer(clip.assetId) : undefined
  return (
    <aside className="inspector" id="track-inspector" aria-label="Inspector de pista y clip">
      <div className="panel-title">
        <span>
          <SlidersHorizontal size={14} /> Inspector
        </span>
        <button className="icon-button small" aria-label="Ocultar inspector" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <div className="inspector-content">
        <div className="selected-track-heading">
          <span className="inspector-icon" style={{ color: track.color }}>
            {track.kind === 'beat' ? <Music2 size={17} /> : <Mic size={17} />}
          </span>
          <div>
            <small>
              Pista {String(studio.project.tracks.indexOf(track) + 1).padStart(2, '0')} ·{' '}
              {trackKinds[track.kind].name}
            </small>
            <h2>{track.name}</h2>
          </div>
        </div>
        <section className="inspector-section" aria-label="Ajustes de pista">
          <label className="field-label">
            Nombre de pista
            <input
              value={track.name}
              maxLength={40}
              disabled={!!studio.busy}
              onChange={(e) => studio.updateTrack(track.id, { name: e.target.value })}
            />
          </label>
          <div className="control-section">
            <div className="section-label">
              <span>Volumen</span>
              <output>{dbLabel(track.volume)}</output>
            </div>
            <input
              aria-label="Ganancia de pista"
              type="range"
              min="0"
              max="1.5"
              step="0.01"
              value={track.volume}
              disabled={!!studio.busy}
              onChange={(e) => studio.updateTrack(track.id, { volume: Number(e.target.value) })}
            />
            <div className="range-labels">
              <span>−∞</span>
              <button
                disabled={!!studio.busy}
                onClick={() => studio.updateTrack(track.id, { volume: 1 })}
              >
                0 dB
              </button>
              <span>+3.5 dB</span>
            </div>
          </div>
          <div className="control-section">
            <div className="section-label">
              <span>Panorama</span>
              <output>
                {track.pan === 0
                  ? 'Centro'
                  : `${Math.round(Math.abs(track.pan) * 100)} ${track.pan < 0 ? 'L' : 'R'}`}
              </output>
            </div>
            <input
              aria-label="Panorama de pista"
              type="range"
              min="-1"
              max="1"
              step="0.01"
              value={track.pan}
              disabled={!!studio.busy}
              onChange={(e) => studio.updateTrack(track.id, { pan: Number(e.target.value) })}
            />
            <div className="range-labels">
              <span>L</span>
              <button
                disabled={!!studio.busy}
                onClick={() => studio.updateTrack(track.id, { pan: 0 })}
              >
                Centrar
              </button>
              <span>R</span>
            </div>
          </div>
        </section>
        <section className="inspector-section" aria-label="Entrada y salida">
          <h3>Entrada y salida</h3>
          <dl className="routing-details">
            <div>
              <dt>Entrada</dt>
              <dd>{track.kind === 'beat' ? 'Archivo de audio' : 'Micrófono del sistema'}</dd>
            </div>
            <div>
              <dt>Salida</dt>
              <dd>Master · estéreo</dd>
            </div>
          </dl>
          {track.kind !== 'beat' && (
            <>
              <div className="section-label input-status">
                <span>Nivel de entrada</span>
                <output className={studio.transport === 'recording' ? 'red-text' : ''}>
                  {studio.transport === 'recording' ? 'Activo' : 'En espera'}
                </output>
              </div>
              <LevelMeter value={studio.levels.input} label="Nivel del micrófono" />
              <p className="microcopy">
                El micrófono se activa al grabar. Usa auriculares; la voz no se monitoriza en
                directo.
              </p>
            </>
          )}
        </section>
        <section className="inspector-section" aria-label="Edición de clip">
          <h3>Clip seleccionado</h3>
          {clip && buffer ? (
            <div className="clip-editor">
              <div className="clip-metadata">
                <span>
                  {buffer.numberOfChannels === 1 ? 'Mono' : 'Estéreo'} · {buffer.sampleRate / 1000}{' '}
                  kHz
                </span>
                <span>{formatTime(clip.duration, true)}</span>
              </div>
              <label className="field-label">
                Nombre del clip
                <input
                  value={clip.name}
                  maxLength={80}
                  disabled={studio.locked}
                  onChange={(e) => studio.updateClip(clip.id, { name: e.target.value })}
                />
              </label>
              <div className="field-grid">
                <label className="field-label">
                  Inicio en sesión{' '}
                  <span className="input-unit">
                    <input
                      aria-label="Inicio en sesión"
                      type="number"
                      min="0"
                      max={MAX_SECONDS - clip.duration}
                      step="0.01"
                      value={Number(clip.start.toFixed(3))}
                      disabled={studio.locked}
                      onChange={(e) =>
                        studio.updateClip(clip.id, { start: e.target.valueAsNumber })
                      }
                    />
                    <span>s</span>
                  </span>
                </label>
                <label className="field-label">
                  Duración{' '}
                  <span className="input-unit">
                    <input
                      aria-label="Duración del clip"
                      type="number"
                      min="0.01"
                      max={buffer.duration - clip.offset}
                      step="0.01"
                      value={Number(clip.duration.toFixed(3))}
                      disabled={studio.locked}
                      onChange={(e) =>
                        studio.updateClip(clip.id, { duration: e.target.valueAsNumber })
                      }
                    />
                    <span>s</span>
                  </span>
                </label>
              </div>
              <label className="field-label">
                Recorte inicial del archivo{' '}
                <span className="input-unit">
                  <input
                    aria-label="Recorte inicial"
                    type="number"
                    min="0"
                    max={buffer.duration - 0.01}
                    step="0.01"
                    value={Number(clip.offset.toFixed(3))}
                    disabled={studio.locked}
                    onChange={(e) => studio.updateClip(clip.id, { offset: e.target.valueAsNumber })}
                  />
                  <span>s</span>
                </span>
              </label>
              <p className="microcopy">Recorte reversible; conserva el audio original.</p>
              <button
                className="delete-clip"
                onClick={() => studio.removeClip(clip.id)}
                disabled={studio.locked}
              >
                <Trash2 size={13} /> Eliminar clip
              </button>
            </div>
          ) : (
            <p className="microcopy">
              Selecciona un clip en el timeline para editar su nombre, posición y recorte.
            </p>
          )}
        </section>
        <section className="inspector-section">
          <h3>Efectos</h3>
          <p className="microcopy">No disponibles en esta versión.</p>
        </section>
      </div>
    </aside>
  )
}
