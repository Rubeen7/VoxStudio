import type { Studio } from '../hooks/useStudio'

export function MarkersPanel({ studio }: { studio: Studio }) {
  return <div className="markers-panel">
    <button className="button" disabled={studio.locked} onClick={() => studio.updateMarker(null, { name: 'Sección' })}>Añadir marcador en el cursor</button>
    <p className="microcopy">Nombra intro, verso, estribillo o puente. Pulsa «Ir» para situar el cursor.</p>
    {(studio.project.markers ?? []).map((marker, i) => <div className="marker-editor" key={marker.id}>
      <input aria-label={`Nombre del marcador ${i + 1}`} maxLength={60} value={marker.name} disabled={studio.locked} onChange={e => studio.updateMarker(marker.id, { name: e.target.value })} />
      <input type="number" aria-label={`Posición del marcador ${i + 1}`} min={0} max={900} step={0.01} value={marker.time} disabled={studio.locked} onChange={e => studio.updateMarker(marker.id, { time: e.target.valueAsNumber })} />
      <button className="button" disabled={studio.locked} onClick={() => studio.seek(marker.time)}>Ir</button>
      <button className="text-button" aria-label={`Eliminar marcador ${i + 1}`} disabled={studio.locked} onClick={() => studio.updateMarker(marker.id, {}, true)}>×</button>
    </div>)}
  </div>
}
