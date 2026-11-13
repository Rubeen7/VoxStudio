import type { Studio } from '../hooks/useStudio'
import { formatTime } from '../model/project'

export function TakesPanel({ studio }: { studio: Studio }) {
  const track = studio.selectedTrack, clip = studio.selectedClip
  const group = track.takeGroups?.find(g => g.id === clip?.takeGroupId)
  const takes = group ? track.clips.filter(c => c.takeGroupId === group.id) : []
  if (track.kind === 'beat') return null
  return <section className="inspector-section takes-panel" aria-label="Tomas vocales">
    <h3>Tomas vocales</h3>
    {clip ? <>
      <button className="button full-width" disabled={studio.locked || clip.duration < 0.03} onClick={studio.repeatTake}>Grabar otra toma de esta sección</button>
      <p className="microcopy">Desde {formatTime(group?.start ?? clip.start, true)} · {formatTime(group?.duration ?? clip.duration, true)}. La captura termina al final de la sección; conserva las versiones anteriores.</p>
    </> : <p className="microcopy">Selecciona una grabación para repetir su sección y comparar tomas.</p>}
    {group && <div className="take-list" role="group" aria-label={`Tomas de ${group.name}`}>
      {takes.map((take, i) => <div className="take-row" key={take.id}>
        <label><input type="radio" name={`take-${group.id}`} aria-label={`Usar toma ${i + 1}`} checked={take.id === group.activeTakeId} disabled={studio.locked} onChange={() => void studio.chooseTake(track.id, group.id, take.id)} /> <span>{take.name}</span></label>
        <button className="text-button" disabled={studio.locked} aria-label={`Escuchar toma ${i + 1}`} onClick={() => void studio.chooseTake(track.id, group.id, take.id, true)}>Escuchar</button>
        <button className="text-button" disabled={studio.locked} aria-label={`Eliminar toma ${i + 1}`} onClick={() => studio.removeClip(take.id)}>×</button>
      </div>)}
      <p className="microcopy">Solo la toma elegida se reproduce y exporta. «Escuchar» también la elige. Supr elimina la toma seleccionada; Deshacer la recupera.</p>
    </div>}
  </section>
}
