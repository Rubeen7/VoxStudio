import { useRef, useState } from 'react'
import {
  AudioLines,
  Check,
  CircleHelp,
  Download,
  FolderOpen,
  HardDrive,
  Headphones,
  Magnet,
  Mic,
  Minus,
  Music2,
  Pause,
  PanelRight,
  Play,
  Plus,
  Save,
  SkipBack,
  SlidersHorizontal,
  Square,
  Upload,
  X,
  ZoomIn,
} from 'lucide-react'
import { useStudio } from './hooks/useStudio'
import { Timeline } from './components/Timeline'
import { Inspector } from './components/Inspector'
import { Mixer } from './components/Mixer'
import { Dialog } from './components/Dialog'
import {
  formatTime,
  MAX_SECONDS,
  projectDuration,
  projectPlaybackDuration,
  trackKinds,
  type TrackKind,
} from './model/project'
import './App.css'
import { MAX_EFFECT_TAIL } from './model/effects'

export default function App() {
  const studio = useStudio()
  const fileInput = useRef<HTMLInputElement>(null)
  const mixerToggle = useRef<HTMLButtonElement>(null)
  const inspectorToggle = useRef<HTMLButtonElement>(null)
  const [scale, setScale] = useState(42)
  const [snap, setSnap] = useState(false)
  const [mixer, setMixer] = useState(true)
  const [inspector, setInspector] = useState(true)
  const [dialog, setDialog] = useState<'add' | 'help' | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const [trackKind, setTrackKind] = useState<TrackKind>('lead')
  const importClick = () => fileInput.current?.click()
  const recording = studio.transport === 'recording'
  const duration = projectPlaybackDuration(studio.project)
  const clips = studio.project.tracks.reduce((sum, t) => sum + t.clips.length, 0)
  const recordingTrack = studio.project.tracks.find((track) => track.id === studio.recordingTrackId)
  const firstVoice = studio.project.tracks.find((track) => track.kind !== 'beat')
  const statusLabels = {
    saved: 'Todos los cambios guardados',
    saving: 'Guardando…',
    unsaved: 'Cambios sin guardar',
    error: 'Error al guardar',
  }

  return (
    <main
      className={`studio ${dragging ? 'file-dragging' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault()
        if (e.dataTransfer.types.includes('Files')) {
          dragDepth.current++
          setDragging(true)
        }
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault()
        if (--dragDepth.current <= 0) {
          dragDepth.current = 0
          setDragging(false)
        }
      }}
      onDrop={(e) => {
        e.preventDefault()
        dragDepth.current = 0
        setDragging(false)
        void studio.importAudio(Array.from(e.dataTransfer.files))
      }}
    >
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept=".wav,.mp3,.ogg,.m4a,.aac,.flac,.webm,audio/*"
        multiple
        aria-label="Seleccionar archivos de audio"
        onChange={(e) => {
          void studio.importAudio(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      <header className="app-header">
        <a href="#studio" className="brand" aria-label="VOX Studio">
          <span className="brand-mark">
            <AudioLines size={23} />
          </span>
          <strong>
            vox<span>studio</span>
          </strong>
        </a>
        <div className="project-heading">
          <div>
            <input
              aria-label="Nombre del proyecto"
              value={studio.project.name}
              maxLength={60}
              disabled={!!studio.busy}
              onChange={(e) => studio.updateProject({ name: e.target.value })}
            />
          </div>
          <span>
            <HardDrive size={11} /> Proyecto local <i /> {clips} {clips === 1 ? 'clip' : 'clips'}
          </span>
        </div>
        <div className="header-actions">
          <button
            className="icon-button mobile-help"
            aria-label="Ayuda y atajos"
            onClick={() => setDialog('help')}
          >
            <CircleHelp size={17} />
          </button>
          <button
            className="button subtle"
            aria-label="Proyectos"
            onClick={() => void studio.openLibrary()}
            disabled={studio.locked}
          >
            <FolderOpen size={16} />
            <span>Proyectos</span>
          </button>
          <button
            className="icon-button save-button"
            onClick={() => void studio.save()}
            disabled={!!studio.busy}
            title="Guardar proyecto (Ctrl + S)"
            aria-label="Guardar proyecto"
          >
            <Save size={17} />
          </button>
          <span className="header-divider" />
          <button
            className="button export-button"
            aria-label="Exportar WAV"
            title="Exportar mezcla WAV · 48 kHz · 16 bits"
            onClick={() => void studio.exportMix()}
            disabled={studio.locked || !duration}
          >
            <Download size={15} />
            <span>Exportar WAV</span>
          </button>
        </div>
        <section className="transport-bar" aria-label="Controles de transporte">
          <div className="transport-controls">
            <button
              className="icon-button"
              title="Volver al inicio (Inicio)"
              aria-label="Volver al inicio"
              onClick={() => studio.seek(0)}
              disabled={studio.locked}
            >
              <SkipBack size={18} />
            </button>
            <button
              className="icon-button"
              title="Detener"
              aria-label="Detener"
              onClick={() => void studio.stop()}
              disabled={!!studio.busy}
            >
              <Square size={16} fill="currentColor" />
            </button>
            <button
              className={`play-button ${studio.transport === 'playing' ? 'playing' : ''}`}
              aria-label={studio.transport === 'playing' ? 'Pausar' : 'Reproducir'}
              title="Reproducir / Pausar (Espacio)"
              disabled={studio.locked}
              onClick={() => void studio.playPause()}
            >
              {studio.transport === 'playing' ? (
                <Pause size={20} fill="currentColor" />
              ) : (
                <Play size={20} fill="currentColor" />
              )}
            </button>
            <button
              className={`record-button ${recording ? 'recording' : ''}`}
              onClick={() => void studio.record()}
              disabled={!!studio.busy || (!recording && studio.selectedTrack.kind === 'beat')}
              title="Grabar en la pista de voz seleccionada (R)"
              aria-label={recording ? 'Finalizar grabación' : 'Grabar'}
            >
              <i className={`record-dot ${recording ? 'pulse' : ''}`} />
              <span>{recording ? 'Finalizar' : 'Grabar'}</span>
            </button>
          </div>
          <div className="transport-clock">
            <output aria-label="Posición de reproducción">
              {formatTime(studio.position, true)}
            </output>
            <span>
              {recording
                ? 'GRABANDO'
                : studio.transport === 'playing'
                  ? 'REPRODUCIENDO'
                  : studio.transport === 'paused'
                    ? 'EN PAUSA'
                    : 'DETENIDO'}
              <i />
              {formatTime(duration)}
            </span>
          </div>
          <div className="tempo">
            <label title="Tempo de la rejilla. No modifica la velocidad del audio.">
              <input
                type="number"
                min="40"
                max="240"
                step="1"
                aria-label="Tempo de la rejilla"
                value={studio.project.bpm}
                disabled={studio.locked}
                onChange={(e) => {
                  const bpm = e.target.valueAsNumber
                  if (Number.isFinite(bpm))
                    studio.updateProject({ bpm: Math.min(240, Math.max(40, bpm)) })
                }}
              />
              <span>BPM</span>
            </label>
            <span className="time-signature">
              4<span>/</span>4<small>COMPÁS</small>
            </span>
          </div>
        </section>
      </header>
      <div className="work-area" id="studio">
        <nav className="side-rail" aria-label="Herramientas">
          <button
            className="rail-button active"
            aria-label="Ir al timeline"
            title="Timeline"
            onClick={() =>
              document.querySelector('.timeline-scroll')?.scrollIntoView({ block: 'nearest' })
            }
          >
            <AudioLines size={21} />
          </button>
          <button
            className="rail-button"
            aria-label="Abrir proyectos"
            title="Proyectos locales"
            disabled={studio.locked}
            onClick={() => void studio.openLibrary()}
          >
            <FolderOpen size={20} />
          </button>
          <button
            className={`rail-button ${mixer ? 'active-secondary' : ''}`}
            aria-label="Mostrar u ocultar mezclador"
            title="Mezclador"
            aria-pressed={mixer}
            onClick={() => setMixer(!mixer)}
          >
            <SlidersHorizontal size={19} />
          </button>
          <button
            className={`rail-button ${inspector ? 'active-secondary' : ''}`}
            aria-label="Mostrar u ocultar inspector"
            title="Inspector"
            aria-pressed={inspector}
            onClick={() => setInspector(!inspector)}
          >
            <PanelRight size={18} />
          </button>
          <span className="rail-spacer" />
          <button
            className="rail-button"
            aria-label="Ayuda y atajos"
            title="Ayuda y atajos"
            onClick={() => setDialog('help')}
          >
            <CircleHelp size={20} />
          </button>
        </nav>
        <div className="editor-area">
          <div className="timeline-toolbar">
            <div className="view-label">
              <AudioLines size={15} />
              <strong>Timeline</strong>
              <span>{studio.project.tracks.length} pistas</span>
            </div>
            <div className="timeline-tools">
              <button
                className="button import-button"
                aria-label="Importar audio"
                onClick={importClick}
                disabled={studio.locked}
              >
                <Upload size={14} />
                <span>{clips ? 'Importar audio' : 'Importar beat'}</span>
              </button>
              <span className="toolbar-divider" />
              <button
                className={`icon-button small ${snap ? 'toggled' : ''}`}
                aria-label="Ajustar a rejilla de semicorcheas"
                aria-pressed={snap}
                title="Ajustar a rejilla (1/16). Mayús para omitir."
                onClick={() => setSnap(!snap)}
              >
                <Magnet size={15} />
              </button>
              <button
                className="icon-button small"
                aria-label="Alejar timeline"
                onClick={() => setScale(Math.max(12, scale / 1.3))}
                disabled={scale <= 12}
              >
                <Minus size={15} />
              </button>
              <span className="zoom-label">{Math.round((scale / 42) * 100)}%</span>
              <button
                className="icon-button small"
                aria-label="Acercar timeline"
                onClick={() => setScale(Math.min(180, scale * 1.3))}
                disabled={scale >= 180}
              >
                <ZoomIn size={15} />
              </button>
              <button
                className={`icon-button small ${mixer ? 'toggled' : ''}`}
                aria-label="Alternar mezclador"
                ref={mixerToggle}
                aria-controls="studio-mixer"
                aria-expanded={mixer}
                title="Mostrar u ocultar mezclador"
                aria-pressed={mixer}
                onClick={() => setMixer(!mixer)}
              >
                <SlidersHorizontal size={15} />
              </button>
              <button
                className={`icon-button small ${inspector ? 'toggled' : ''}`}
                aria-label="Alternar inspector"
                ref={inspectorToggle}
                aria-controls="track-inspector"
                aria-expanded={inspector}
                title="Mostrar u ocultar inspector"
                aria-pressed={inspector}
                onClick={() => setInspector(!inspector)}
              >
                <PanelRight size={15} />
              </button>
            </div>
          </div>
          <Timeline
            studio={studio}
            scale={scale}
            snap={snap}
            onImport={importClick}
            onAdd={() => setDialog('add')}
          />
          <div className="session-overview">
            <span className={recording ? 'red-text' : ''}>
              <Mic size={13} />
              {recording
                ? `Grabando en ${recordingTrack?.name ?? studio.selectedTrack.name}`
                : studio.selectedTrack.kind !== 'beat'
                  ? `Destino de grabación: ${studio.selectedTrack.name}`
                  : 'Selecciona una pista de voz para grabar'}
              {!recording && studio.selectedTrack.kind === 'beat' && firstVoice && (
                <button
                  className="text-button"
                  disabled={studio.locked}
                  onClick={() => studio.selectTrack(firstVoice.id)}
                >
                  Seleccionar voz
                </button>
              )}
            </span>
            <label>
              Ir a{' '}
              <input
                aria-label="Ir a segundo"
                type="number"
                min="0"
                max={MAX_SECONDS + MAX_EFFECT_TAIL}
                step="0.1"
                value={Number(studio.position.toFixed(1))}
                disabled={studio.locked}
                onChange={(e) => studio.seek(e.target.valueAsNumber)}
              />{' '}
              s
            </label>
          </div>
          {mixer && (
            <Mixer
              studio={studio}
              onClose={() => {
                setMixer(false)
                mixerToggle.current?.focus()
              }}
            />
          )}
        </div>
        {inspector && (
          <Inspector
            studio={studio}
            onClose={() => {
              setInspector(false)
              inspectorToggle.current?.focus()
            }}
          />
        )}
      </div>
      <footer className="status-bar">
        <span className={studio.saveStatus === 'error' ? 'red-text' : ''}>
          {studio.saveStatus === 'saved' ? <Check size={12} /> : <HardDrive size={12} />}
          <span role="status">{studio.busy ?? statusLabels[studio.saveStatus]}</span>
          {(studio.busy === 'Preparando monitorización…' ||
            studio.busy === 'Esperando al micrófono…') && (
            <button className="text-button" onClick={studio.cancelInputRequest}>
              Cancelar micrófono
            </button>
          )}
        </span>
        {studio.input.active ? (
          <span className="red-text" aria-label="Micrófono activo">
            <Mic size={12} /> {studio.input.muted ? 'Entrada interrumpida' : 'Micrófono activo'}
            {studio.input.monitorTrackId ? ' · escucha activada' : ' · grabación seca'}
          </span>
        ) : (
          <span className="footer-hint">
            <kbd>ESPACIO</kbd> reproducir / pausar <i /> <kbd>R</kbd> grabar
          </span>
        )}
        <span>
          {formatTime(duration)} de audio <i /> WAV · 48 kHz · 16 bits
        </span>
      </footer>
      {studio.notice && (
        <div
          className={`toast ${studio.notice.error ? 'error' : ''}`}
          role={studio.notice.error ? 'alert' : 'status'}
        >
          <span>{studio.notice.text}</span>
          <button
            className="icon-button small"
            aria-label="Cerrar aviso"
            onClick={studio.dismissNotice}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {dragging && (
        <div className="drop-overlay">
          <Upload size={40} />
          <h2>Importar audio</h2>
          <p>
            {studio.locked
              ? 'Finaliza la grabación o espera a que termine la operación.'
              : 'Importa beats y voces directamente a tu sesión.'}
          </p>
        </div>
      )}
      {dialog === 'add' && (
        <Dialog title="Añadir pista" onClose={() => setDialog(null)}>
          <p className="dialog-description">
            Selecciona el tipo de pista. Puedes cambiar su nombre en el inspector.
          </p>
          <div className="track-type-options">
            {(Object.keys(trackKinds) as TrackKind[]).map((kind) => (
              <button
                className={trackKind === kind ? 'chosen' : ''}
                key={kind}
                onClick={() => setTrackKind(kind)}
                style={{ borderLeftColor: trackKinds[kind].color }}
              >
                {kind === 'beat' ? <Music2 size={18} /> : <Mic size={18} />}
                <span>{trackKinds[kind].name}</span>
                {trackKind === kind && <Check size={16} />}
              </button>
            ))}
          </div>
          <button
            className="button primary full-width"
            disabled={studio.locked}
            onClick={() => {
              studio.addTrack(trackKind)
              setDialog(null)
            }}
          >
            <Plus size={16} /> Crear pista
          </button>
        </Dialog>
      )}
      {studio.library && (
        <Dialog title="Tus proyectos" onClose={studio.closeLibrary}>
          <p className="dialog-description">
            Sesiones guardadas en este navegador y en este dispositivo.
          </p>
          <div className="project-list">
            {studio.library.map((project) => (
              <button
                key={project.id}
                disabled={!!studio.busy}
                onClick={() => void studio.switchProject(project.id)}
              >
                <span className="project-list-icon">
                  <AudioLines size={22} />
                </span>
                <span>
                  <strong>{project.name || 'Sin título'}</strong>
                  <small>
                    {new Date(project.updatedAt).toLocaleString('es-ES')} · {project.tracks.length}{' '}
                    pistas · {formatTime(projectDuration(project))}
                  </small>
                </span>
                {project.id === studio.project.id && <span className="tiny-tag">ACTUAL</span>}
              </button>
            ))}
          </div>
          <button
            className="button primary full-width"
            disabled={studio.locked}
            onClick={() => void studio.switchProject()}
          >
            <Plus size={16} /> Nuevo proyecto
          </button>
          <p className="microcopy">
            Borrar los datos del sitio elimina estas sesiones. Exporta una mezcla de tus trabajos
            importantes.
          </p>
        </Dialog>
      )}
      {studio.monitorRequest && (
        <Dialog title="Monitorización con auriculares" onClose={studio.cancelMonitoring}>
          <p className="dialog-description">
            Conecta auriculares antes de activar la escucha. Con altavoces, el micrófono puede
            provocar acoples. El navegador no permite detectar qué estás usando.
          </p>
          <p className="dialog-description">
            Si tu interfaz tiene monitorización directa, desactívala para evitar oír la voz dos
            veces. La escucha usará los efectos de la pista; la grabación seguirá siendo seca.
          </p>
          <button
            className="button primary full-width"
            onClick={() => void studio.toggleMonitoring(studio.monitorRequest!, true)}
          >
            <Headphones size={15} /> Activar con auriculares
          </button>
        </Dialog>
      )}
      {dialog === 'help' && (
        <Dialog title="Tu estudio, de un vistazo" onClose={() => setDialog(null)}>
          <div className="help-content">
            <p>
              <strong>01 · Importa tu beat.</strong> WAV y MP3; otros formatos dependen del
              navegador. El primer archivo ocupa la pista Instrumental vacía; los siguientes usan la
              pista seleccionada.
            </p>
            <p>
              <strong>02 · Selecciona una voz y graba.</strong> Autoriza el micrófono, usa
              auriculares y pulsa Grabar. El beat se reproduce junto a la captura. Finalizar
              conserva el cursor; Detener vuelve al inicio.
            </p>
            <p>
              <strong>03 · Construye tu arreglo.</strong> Mueve clips, ajusta volumen, panorama,
              mute y solo. El inspector permite recortar y ajustar el inicio con precisión. Las
              tomas superpuestas se suman.
            </p>
            <p>
              <strong>04 · Guarda y exporta.</strong> Autoguardado local de proyectos y audios. La
              exportación WAV incluye ganancias, panoramas, solos, silencios y recortes. Si satura,
              baja el master y vuelve a exportar.
            </p>
            <div className="help-shortcuts">
              <span>
                <kbd>Espacio</kbd> Reproducir / pausar
              </span>
              <span>
                <kbd>R</kbd> Grabar / finalizar
              </span>
              <span>
                <kbd>Inicio</kbd> Volver a cero
              </span>
              <span>
                <kbd>Ctrl S</kbd> Guardar
              </span>
            </div>
            <p className="microcopy">
              La rejilla es visual: cambiar BPM no estira el audio ni detecta su tempo. Captura mono
              a 48 kHz. El botón de auriculares activa la escucha con efectos, también sin grabar.
              Solo una pista monitoriza a la vez; al grabar otra voz, la escucha sigue a esa pista.
              Detener no apaga la escucha: usa su botón para liberar el micrófono. Los efectos se
              aplican al reproducir y exportar; la toma original se conserva seca. El hardware añade
              latencia: puedes corregirla moviendo la toma. Límite: 15 minutos, 100 MB por archivo y
              256 MB de audio decodificado. No cierres la pestaña durante la captura.
            </p>
          </div>
        </Dialog>
      )}
    </main>
  )
}
