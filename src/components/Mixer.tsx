import type { CSSProperties } from 'react'
import { ChevronDown, SlidersHorizontal, Volume2 } from 'lucide-react'
import type { Studio } from '../hooks/useStudio'
import { dbLabel } from '../model/project'

export function LevelMeter({ value, label }: { value: number; label: string }) {
  const amount =
    value > 0 ? Math.max(0, Math.min(100, ((20 * Math.log10(value) + 60) / 60) * 100)) : 0
  return (
    <div
      className={`level-meter ${value >= 1 ? 'clipping' : ''}`}
      role="meter"
      aria-label={label}
      aria-valuemin={-60}
      aria-valuemax={0}
      aria-valuenow={
        value > 0 ? Math.max(-60, Math.min(0, Math.round(20 * Math.log10(value)))) : -60
      }
    >
      <span style={{ width: `${amount}%` }} />
    </div>
  )
}

export function Mixer({ studio, onClose }: { studio: Studio; onClose: () => void }) {
  return (
    <section className="mixer" aria-label="Mezclador">
      <div className="mixer-title">
        <span>
          <SlidersHorizontal size={13} /> Mezclador
          <small>{studio.project.tracks.length} canales · salida estéreo</small>
        </span>
        <button className="icon-button small" aria-label="Ocultar mezclador" onClick={onClose}>
          <ChevronDown size={16} />
        </button>
      </div>
      <div className="mixer-body">
        <div className="mixer-channels">
          {studio.project.tracks.map((track, index) => (
            <div
              className={`mixer-channel ${studio.selectedTrack.id === track.id ? 'selected' : ''}`}
              key={track.id}
              style={{ '--track-color': track.color } as CSSProperties}
            >
              <button
                className="mixer-channel-name"
                aria-label={`Mezclador: seleccionar ${track.name}`}
                aria-pressed={studio.selectedTrack.id === track.id}
                title={track.name}
                onClick={() => studio.selectTrack(track.id)}
              >
                <i />
                <strong>{track.name}</strong>
                <small>{String(index + 1).padStart(2, '0')}</small>
              </button>
              <div className="channel-pan">
                <span>L</span>
                <input
                  type="range"
                  aria-label={`Mezclador: panorama ${track.name}`}
                  min="-1"
                  max="1"
                  step="0.01"
                  value={track.pan}
                  disabled={!!studio.busy}
                  onChange={(e) => studio.updateTrack(track.id, { pan: Number(e.target.value) })}
                  onDoubleClick={() => studio.updateTrack(track.id, { pan: 0 })}
                  title="Panorama. Doble clic para centrar."
                />
                <span>R</span>
              </div>
              <div className="channel-level">
                <div className="fader-scale" aria-hidden="true">
                  <span>+3</span>
                  <span>0</span>
                  <span>−12</span>
                  <span>−∞</span>
                </div>
                <div className="mixer-fader">
                  <input
                    type="range"
                    aria-label={`Mezclador: volumen ${track.name}`}
                    aria-orientation="vertical"
                    aria-valuetext={dbLabel(track.volume)}
                    min="0"
                    max="1.5"
                    step="0.01"
                    value={track.volume}
                    disabled={!!studio.busy}
                    onChange={(e) =>
                      studio.updateTrack(track.id, { volume: Number(e.target.value) })
                    }
                  />
                </div>
                <div className="channel-actions">
                  <button
                    className={`mini-button ${track.muted ? 'on mute' : ''}`}
                    aria-label={`Mezclador: silenciar ${track.name}`}
                    title="Silenciar (Mute)"
                    aria-pressed={track.muted}
                    disabled={!!studio.busy}
                    onClick={() => studio.updateTrack(track.id, { muted: !track.muted })}
                  >
                    M
                  </button>
                  <button
                    className={`mini-button ${track.solo ? 'on solo' : ''}`}
                    aria-label={`Mezclador: solo ${track.name}`}
                    title="Solo"
                    aria-pressed={track.solo}
                    disabled={!!studio.busy}
                    onClick={() => studio.updateTrack(track.id, { solo: !track.solo })}
                  >
                    S
                  </button>
                </div>
              </div>
              <div className="mixer-channel-bottom">
                <span>
                  {track.pan === 0
                    ? 'C'
                    : `${Math.round(Math.abs(track.pan) * 100)} ${track.pan < 0 ? 'L' : 'R'}`}
                </span>
                <output>{dbLabel(track.volume)}</output>
              </div>
            </div>
          ))}
        </div>
        <div className="mixer-master">
          <div className="master-heading">
            <Volume2 size={13} />
            <strong>Master</strong>
            <output className={studio.levels.master >= 1 ? 'red-text' : ''}>
              {studio.levels.master >= 1 ? 'CLIP' : dbLabel(studio.project.masterVolume)}
            </output>
          </div>
          <span className="master-route">Salida estéreo</span>
          <input
            type="range"
            aria-label="Volumen master"
            min="0"
            max="1"
            step="0.01"
            value={studio.project.masterVolume}
            disabled={!!studio.busy}
            onChange={(e) => studio.updateProject({ masterVolume: Number(e.target.value) })}
          />
          <LevelMeter value={studio.levels.master} label="Nivel de salida master" />
          <div className="meter-ticks">
            <span>−60</span>
            <span>−40</span>
            <span>−20</span>
            <span>0 dB</span>
          </div>
          <span className={`master-status ${studio.levels.master >= 1 ? 'red-text' : ''}`}>
            {studio.levels.master >= 1 ? 'Saturación: baja el volumen' : 'Nivel de salida · dBFS'}
          </span>
        </div>
      </div>
    </section>
  )
}
