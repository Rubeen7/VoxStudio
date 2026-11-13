import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Studio } from '../hooks/useStudio'
import { formatTime } from '../model/project'

export function MarkersPanel({ studio }: { studio: Studio }) {
  const markers = studio.project.markers ?? []
  // Navigation follows the session order even for legacy projects stored unsorted.
  const ordered = [...markers].sort((a, b) => a.time - b.time)
  const previous = [...ordered].reverse().find((m) => m.time < studio.position - 0.01)
  const next = ordered.find((m) => m.time > studio.position + 0.01)
  return <div className="markers-panel">
    <div className="marker-nav">
      <button className="button" aria-label="Ir al marcador anterior" title={previous ? `Ir a ${previous.name || 'Sección'} · ${formatTime(previous.time, true)}` : 'No hay marcador anterior'} disabled={studio.locked || !previous} onClick={() => previous && studio.seek(previous.time)}><ChevronLeft size={13} /> Anterior</button>
      <button className="button" aria-label="Ir al marcador siguiente" title={next ? `Ir a ${next.name || 'Sección'} · ${formatTime(next.time, true)}` : 'No hay marcador siguiente'} disabled={studio.locked || !next} onClick={() => next && studio.seek(next.time)}>Siguiente <ChevronRight size={13} /></button>
    </div>
    <button className="button primary full-width" disabled={studio.locked} onClick={() => studio.updateMarker(null, { name: 'Sección' })}>Añadir marcador en el cursor</button>
    <p className="microcopy">Nombra intro, verso, estribillo o puente. Pulsa «Ir» para situar el cursor. «Anterior» y «Siguiente» recorren las secciones desde la posición actual.</p>
    {markers.map((marker, i) => <div className="marker-editor" key={marker.id}>
      <input aria-label={`Nombre del marcador ${i + 1}`} maxLength={60} value={marker.name} disabled={studio.locked} onChange={e => studio.updateMarker(marker.id, { name: e.target.value })} />
      <input type="number" aria-label={`Posición del marcador ${i + 1}`} min={0} max={900} step={0.01} value={marker.time} disabled={studio.locked} onChange={e => studio.updateMarker(marker.id, { time: e.target.valueAsNumber })} />
      <button className="button" disabled={studio.locked} onClick={() => studio.seek(marker.time)}>Ir</button>
      <button className="text-button" aria-label={`Eliminar marcador ${i + 1}`} disabled={studio.locked} onClick={() => studio.updateMarker(marker.id, {}, true)}>×</button>
    </div>)}
    {!markers.length && <p className="microcopy">Aún no hay marcadores. Añade uno en la posición del cursor.</p>}
  </div>
}
