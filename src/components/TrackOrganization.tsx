import type { Studio } from '../hooks/useStudio'
import { trackKinds, type TrackKind } from '../model/project'

export function TrackOrganization({ studio }: { studio: Studio }) {
  const track = studio.selectedTrack, index = studio.project.tracks.indexOf(track)
  return <details className="track-organization"><summary>Organizar pista</summary>
    <div className="field-grid">
      <label className="field-label">Color de pista<input type="color" aria-label="Color de pista" value={track.color} disabled={studio.locked} onChange={e => studio.updateTrack(track.id, { color: e.target.value })} /></label>
      <label className="field-label">Tipo de pista<select aria-label="Tipo de pista" value={track.kind} disabled={studio.locked} onChange={e => studio.updateTrack(track.id, { kind: e.target.value as TrackKind })}>{Object.entries(trackKinds).map(([key, kind]) => <option key={key} value={key}>{kind.name}</option>)}</select></label>
    </div>
    <label className="field-label">Grupo de voces<input aria-label="Grupo de voces" list="vocal-groups" maxLength={40} value={track.group ?? ''} disabled={studio.locked || track.kind === 'beat'} onChange={e => studio.updateTrack(track.id, { group: e.target.value })} placeholder="Estribillo, armonías…" /></label>
    <datalist id="vocal-groups">{[...new Set(studio.project.tracks.map(t => t.group).filter(Boolean))].map(name => <option key={name} value={name} />)}</datalist>
    <div className="compact-actions">
      <button className="button" disabled={studio.locked || !index} onClick={() => studio.trackOperation(track.id, 'up')}>Subir pista</button>
      <button className="button" disabled={studio.locked || index === studio.project.tracks.length - 1} onClick={() => studio.trackOperation(track.id, 'down')}>Bajar pista</button>
      <button className="button" disabled={studio.locked} onClick={() => studio.trackOperation(track.id, 'duplicate')}>Duplicar pista</button>
      <button className="button" disabled={studio.locked} onClick={() => studio.updateTrack(track.id, { collapsed: !track.collapsed })}>{track.collapsed ? 'Expandir pista' : 'Contraer pista'}</button>
      <button className="button" disabled={studio.locked} onClick={() => studio.updateTrack(track.id, { hidden: !track.hidden })}>{track.hidden ? 'Mostrar pista' : 'Ocultar pista'}</button>
      <button className="delete-clip" disabled={studio.locked || studio.project.tracks.length < 2} onClick={() => studio.trackOperation(track.id, 'delete')}>Eliminar pista</button>
    </div>
    <p className="microcopy">Ocultar o contraer no silencia. Eliminar se puede deshacer; el audio original se conserva.</p>
  </details>
}

export function TrackList({ studio }: { studio: Studio }) {
  const groups = [...new Set(studio.project.tracks.map(t => t.group).filter((g): g is string => !!g))]
  return <div className="track-list">
    <p className="microcopy">Los grupos organizan la vista; cada pista conserva su mezcla y efectos.</p>
    {groups.map(group => <div className="group-row" key={group}><strong>{group}</strong><button className="button" disabled={studio.locked} onClick={() => studio.updateGroup(group, { collapsed: !studio.project.tracks.filter(t => t.group === group).every(t => t.collapsed) })}>Contraer / expandir grupo</button></div>)}
    {studio.project.tracks.map(track => <div key={track.id} className="track-list-row" style={{ borderLeftColor: track.color }}>
      <button className="text-button" onClick={() => studio.selectTrack(track.id)}>{track.name}</button>
      <small>{track.group || trackKinds[track.kind].name}</small>
      <label><input type="checkbox" aria-label={`Mostrar ${track.name}`} checked={!track.hidden} disabled={studio.locked} onChange={e => studio.updateTrack(track.id, { hidden: !e.target.checked })} /> Visible</label>
      <label><input type="checkbox" aria-label={`Contraer ${track.name}`} checked={!!track.collapsed} disabled={studio.locked} onChange={e => studio.updateTrack(track.id, { collapsed: e.target.checked })} /> Compacta</label>
    </div>)}
  </div>
}
