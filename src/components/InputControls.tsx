import { Headphones, RefreshCw } from 'lucide-react'
import type { Studio } from '../hooks/useStudio'
import type { LatencyMode } from '../audio/MicrophoneInput'
import { dbLabel } from '../model/project'
import { LevelMeter } from './Mixer'

const latencyLabel = (seconds: number | null) =>
  seconds === null ? 'No disponible' : `${(seconds * 1000).toFixed(1)} ms`

export function InputControls({ studio }: { studio: Studio }) {
  const { input, selectedTrack: track } = studio
  const monitoring = input.monitorTrackId === track.id
  const monitoredTrack = studio.project.tracks.find((track) => track.id === input.monitorTrackId)
  const settingsLocked =
    !!studio.busy ||
    input.active ||
    studio.transport === 'playing' ||
    studio.transport === 'recording'
  const monitorLocked =
    !!studio.busy || (!!studio.recordingTrackId && studio.recordingTrackId !== track.id)
  return (
    <section className="inspector-section input-controls" aria-label="Entrada y salida">
      <h3>Entrada y salida</h3>
      {track.kind === 'beat' ? (
        <p className="microcopy">Archivo de audio → Master · estéreo</p>
      ) : (
        <>
          <button
            className={`button full-width monitor-toggle ${monitoring ? 'monitor-on' : ''}`}
            aria-label="Monitorizar pista seleccionada"
            aria-pressed={monitoring}
            disabled={monitorLocked}
            onClick={() => void studio.toggleMonitoring(track.id)}
          >
            <Headphones size={14} />{' '}
            {monitoring ? 'Monitorización activada' : 'Monitorización desactivada'}
          </button>
          <div className="section-label input-status">
            <span>Micrófono</span>
            <output aria-label="Estado del micrófono" className={input.active ? 'red-text' : ''}>
              {input.active ? (input.muted ? 'Interrumpido' : 'Activo') : 'Apagado'}
            </output>
          </div>
          <LevelMeter value={studio.levels.input} label="Nivel del micrófono" />
          <div className="control-section">
            <div className="section-label">
              <span>Volumen de escucha</span>
              <output>{dbLabel(input.volume)}</output>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={input.volume}
              aria-label="Volumen de monitorización"
              disabled={!!studio.busy}
              onChange={(event) => studio.setMonitorVolume(Number(event.target.value))}
            />
          </div>
          <p className="microcopy">
            {monitoredTrack ? `Escucha: ${monitoredTrack.name}. ` : ''}
            Usa auriculares: los altavoces pueden provocar acoples. La toma se graba seca.
          </p>
          {track.effects.some((effect) => effect.type === 'autotune') && (
            <p className="microcopy">
              Afinación vocal se aplica al reproducir la toma y al exportar. La escucha del
              micrófono conserva los demás efectos, sin el retardo del corrector.
            </p>
          )}
          <details className="input-options">
            <summary>Dispositivo y latencia</summary>
            <label className="field-label">
              Dispositivo de entrada
              <select
                aria-label="Dispositivo de entrada"
                value={input.deviceId}
                disabled={settingsLocked || !studio.inputSelectionSupported}
                onChange={(event) =>
                  void studio.configureInput(event.target.value, input.latencyMode)
                }
              >
                <option value="">Predeterminado del sistema</option>
                {input.deviceId &&
                  !studio.inputDevices.some((device) => device.deviceId === input.deviceId) && (
                    <option value={input.deviceId}>Entrada seleccionada no disponible</option>
                  )}
                {studio.inputDevices
                  .filter((device) => device.deviceId !== 'default')
                  .map((device, index) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Entrada ${index + 1}`}
                    </option>
                  ))}
              </select>
            </label>
            <button
              className="text-button refresh-inputs"
              onClick={() => void studio.refreshInputs()}
              disabled={!!studio.busy}
            >
              <RefreshCw size={12} /> Actualizar entradas
            </button>
            <p className="microcopy">
              {input.deviceLabel || 'Los nombres aparecen al autorizar el micrófono.'}
            </p>
            <label className="field-label">
              Preferencia de latencia
              <select
                aria-label="Preferencia de latencia"
                value={input.latencyMode}
                disabled={settingsLocked}
                onChange={(event) =>
                  void studio.configureInput(input.deviceId, event.target.value as LatencyMode)
                }
              >
                <option value="interactive">Baja · interactiva</option>
                <option value="balanced">Equilibrada · más margen</option>
              </select>
            </label>
            <dl className="routing-details" aria-label="Latencias comunicadas por el navegador">
              <div>
                <dt>Entrada</dt>
                <dd>{latencyLabel(input.inputLatency)}</dd>
              </div>
              <div>
                <dt>Base del motor</dt>
                <dd>{latencyLabel(input.baseLatency)}</dd>
              </div>
              <div>
                <dt>Salida estimada</dt>
                <dd>{latencyLabel(input.outputLatency)}</dd>
              </div>
              <div>
                <dt>Frecuencia del motor</dt>
                <dd>{input.sampleRate ? `${input.sampleRate / 1000} kHz` : 'Sin iniciar'}</dd>
              </div>
            </dl>
            <p className="microcopy">
              Son datos del navegador, no una medición del recorrido completo. La preferencia puede
              ser ignorada. Para cambiarla, detén el transporte y apaga la escucha.
            </p>
            <p className="microcopy">
              Si oyes la voz doble, desactiva la monitorización directa de tu interfaz de audio. No
              podemos detectar auriculares ni controlar la escucha del hardware.
            </p>
          </details>
        </>
      )}
    </section>
  )
}
