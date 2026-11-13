import { useState } from 'react'
import { GripVertical } from 'lucide-react'
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
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  return <div className="track-list">
    <p className="microcopy">Arrastra una pista para cambiar su orden, o usa Alt + ↑/↓ con el foco en su nombre. Los grupos organizan la vista; cada pista conserva su mezcla y efectos.</p>
    {groups.map(group => <div className="group-row" key={group}><strong>{group}</strong><button className="button" disabled={studio.locked} onClick={() => studio.updateGroup(group, { collapsed: !studio.project.tracks.filter(t => t.group === group).every(t => t.collapsed) })}>Contraer / expandir grupo</button></div>)}
    {studio.project.tracks.map((track, index) => <div key={track.id}
      className={`track-list-row ${dragging === track.id ? 'dragging' : ''} ${over === track.id ? 'drop-target' : ''}`}
      style={{ borderLeftColor: track.color }}
      draggable={!studio.locked}
      onDragStart={(e) => { setDragging(track.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', track.id) }}
      onDragOver={(e) => { if (!dragging || dragging === track.id) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(track.id) }}
      onDragLeave={() => setOver((current) => (current === track.id ? null : current))}
      onDrop={(e) => {
        e.preventDefault()
        const id = dragging ?? e.dataTransfer.getData('text/plain')
        setOver(null)
        setDragging(null)
        if (id) studio.moveTrack(id, index)
      }}
      onDragEnd={() => { setDragging(null); setOver(null) }}
    >
      <span className="track-drag-handle" aria-hidden="true" title="Arrastra para reordenar"><GripVertical size={13} /></span>
      <button className="text-button" title="Arrastra o Alt + ↑/↓ para reordenar"
        onClick={() => studio.selectTrack(track.id)}
        onKeyDown={(e) => {
          if (!e.altKey) return
          if (e.key === 'ArrowUp' && index > 0) { e.preventDefault(); studio.moveTrack(track.id, index - 1) }
          if (e.key === 'ArrowDown' && index < studio.project.tracks.length - 1) { e.preventDefault(); studio.moveTrack(track.id, index + 1) }
        }}>{track.name}</button>
      <small>{track.group || trackKinds[track.kind].name}</small>
      <label><input type="checkbox" aria-label={`Mostrar ${track.name}`} checked={!track.hidden} disabled={studio.locked} onChange={e => studio.updateTrack(track.id, { hidden: !e.target.checked })} /> Visible</label>
      <label><input type="checkbox" aria-label={`Contraer ${track.name}`} checked={!!track.collapsed} disabled={studio.locked} onChange={e => studio.updateTrack(track.id, { collapsed: e.target.checked })} /> Compacta</label>
    </div>)}
  </div>
}
