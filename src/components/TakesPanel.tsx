import { useState } from 'react'
import type { Studio } from '../hooks/useStudio'
import { formatTime, type Clip } from '../model/project'

export function TakesPanel({ studio }: { studio: Studio }) {
  const track = studio.selectedTrack
  const clip = studio.selectedClip
  const group = track.takeGroups?.find((g) => g.id === clip?.takeGroupId)
  const takes = group ? track.clips.filter((c) => c.takeGroupId === group.id) : []
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  if (track.kind === 'beat') return null

  const startRename = (take: Clip) => {
    setRenamingId(take.id)
    setRenameValue(take.name)
  }

  const commitRename = (id: string) => {
    if (renameValue.trim()) {
      studio.updateClip(id, { name: renameValue.trim() })
    }
    setRenamingId(null)
  }

  return (
    <section className="inspector-section takes-panel" aria-label="Tomas vocales">
      <h3>Tomas vocales</h3>
      {clip ? (
        <>
          <button
            className="button full-width"
            disabled={studio.locked || clip.duration < 0.03}
            onClick={studio.repeatTake}
          >
            Grabar otra toma de esta sección
          </button>
          <p className="microcopy">
            Desde {formatTime(group?.start ?? clip.start, true)} ·{' '}
            {formatTime(group?.duration ?? clip.duration, true)}. La captura termina al final de la
            sección; conserva las versiones anteriores.
          </p>
        </>
      ) : (
        <p className="microcopy">
          Selecciona una grabación para repetir su sección y comparar tomas.
        </p>
      )}
      {group && (
        <div
          className="take-list"
          role="group"
          aria-label={`Tomas de ${group.name}`}
          style={{ '--track-color': track.color } as React.CSSProperties}
        >
          {takes.map((take, i) => (
            <div
              className={`take-row ${take.id === group.activeTakeId ? 'active-take' : ''}`}
              key={take.id}
            >
              <label>
                <input
                  type="radio"
                  name={`take-${group.id}`}
                  aria-label={`Usar toma ${i + 1}`}
                  checked={take.id === group.activeTakeId}
                  disabled={studio.locked}
                  onChange={() => void studio.chooseTake(track.id, group.id, take.id)}
                />
                {renamingId === take.id ? (
                  <input
                    className="take-name-input"
                    value={renameValue}
                    maxLength={80}
                    autoFocus
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(take.id)
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    onBlur={() => commitRename(take.id)}
                    disabled={studio.locked}
                  />
                ) : (
                  <span
                    title={take.name}
                    onDoubleClick={() => !studio.locked && startRename(take)}
                  >
                    {take.name || `Toma ${i + 1}`}
                  </span>
                )}
              </label>
              <button
                className="text-button"
                disabled={studio.locked}
                aria-label={`Escuchar toma ${i + 1}`}
                onClick={() => void studio.chooseTake(track.id, group.id, take.id, true)}
              >
                ▶
              </button>
              <button
                className="text-button"
                disabled={studio.locked}
                aria-label={`Renombrar toma ${i + 1}`}
                title="Renombrar (doble clic en el nombre)"
                onClick={() => startRename(take)}
              >
                ✎
              </button>
              <button
                className="text-button"
                disabled={studio.locked}
                aria-label={`Eliminar toma ${i + 1}`}
                onClick={() => studio.removeClip(take.id)}
              >
                ×
              </button>
            </div>
          ))}
          <p className="microcopy">
            Solo la toma elegida se reproduce y exporta. «▶» también la elige. Supr elimina la toma
            seleccionada. Doble clic en el nombre para renombrar.
          </p>
        </div>
      )}
    </section>
  )
}
