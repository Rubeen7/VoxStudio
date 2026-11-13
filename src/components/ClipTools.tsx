import { useEffect, useRef, useState } from 'react'
import { Copy, ClipboardPaste, Scissors, Trash2, Undo2, Redo2, CopyPlus, Flag, ListMusic } from 'lucide-react'
import type { Studio } from '../hooks/useStudio'
import { dbLabel } from '../model/project'

export function ClipTools({ studio, onTracks, onMarkers }: { studio: Studio; onTracks: () => void; onMarkers: () => void }) {
  const selected = !!studio.selectedClipIds.length
  return <div className="editing-toolbar" role="toolbar" aria-label="Herramientas de edición">
    <button className="icon-button small" aria-label="Deshacer" title={`Deshacer · Ctrl+Z${studio.undoLabel ? ` · ${studio.undoLabel}` : ''}`} disabled={studio.locked || !studio.undoLabel} onClick={studio.undo}><Undo2 size={14} /></button>
    <button className="icon-button small" aria-label="Rehacer" title="Rehacer · Ctrl+Y" disabled={studio.locked || !studio.redoLabel} onClick={studio.redo}><Redo2 size={14} /></button>
    <span className="toolbar-divider" />
    <button className="button subtle" aria-label="Cortar en el cursor" title="Dividir los clips seleccionados en el cursor · S" disabled={studio.locked || !selected} onClick={studio.splitSelection}><Scissors size={13} /> Cortar</button>
    <button className="icon-button small" aria-label="Copiar clips" title="Copiar · Ctrl+C" disabled={studio.locked || !selected} onClick={studio.copySelection}><Copy size={13} /></button>
    <button className="icon-button small" aria-label="Pegar clips" title="Pegar en el cursor · Ctrl+V" disabled={studio.locked || !studio.hasClipboard} onClick={studio.pasteSelection}><ClipboardPaste size={13} /></button>
    <button className="icon-button small" aria-label="Duplicar clips" title="Duplicar a continuación · Ctrl+D" disabled={studio.locked || !selected} onClick={studio.duplicateSelection}><CopyPlus size={13} /></button>
    <button className="icon-button small" aria-label="Eliminar clips seleccionados" title="Eliminar · Supr" disabled={studio.locked || !selected} onClick={studio.deleteSelection}><Trash2 size={13} /></button>
    <span className="selection-count">{selected ? `${studio.selectedClipIds.length} seleccionados` : 'Ctrl + clic: selección múltiple'}</span>
    <button className="button subtle" onClick={onMarkers}><Flag size={13} /> Marcadores</button>
    <button className="button subtle" onClick={onTracks}><ListMusic size={13} /> Pistas</button>
  </div>
}

export function ClipMenu({ studio, x, y, onClose }: { studio: Studio; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const clip = studio.selectedClip
  const selection = studio.selectedClipIds
  const count = selection.length
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(clip?.name ?? '')
  const gain = clip?.gain ?? 1

  useEffect(() => {
    if (!renaming) ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [renaming])

  useEffect(() => {
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      const target = e.target as HTMLElement
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // A focused slider or text field owns its arrow keys.
        if (target.closest('input, textarea')) return
        e.preventDefault()
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[(index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
      }
    }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key) }
  }, [onClose])

  const commitRename = () => {
    const next = name.trim()
    if (clip && next && next !== clip.name) studio.updateClip(clip.id, { name: next })
    setRenaming(false)
    onClose()
  }
  const items: [string, () => void, boolean][] = [
    ['Cortar en el cursor · S', studio.splitSelection, true],
    ['Copiar · Ctrl+C', studio.copySelection, true],
    ['Pegar · Ctrl+V', studio.pasteSelection, studio.hasClipboard],
    ['Duplicar · Ctrl+D', studio.duplicateSelection, true],
    ['Eliminar · Supr', studio.deleteSelection, true],
  ]
  return <div ref={ref} className="clip-menu" role="menu" aria-label="Acciones de clip" style={{ left: Math.max(8, Math.min(x, window.innerWidth - 245)), top: Math.max(8, Math.min(y, window.innerHeight - (renaming ? 160 : 320))) }}>
    {renaming ? (
      <form className="clip-menu-rename" onSubmit={(e) => { e.preventDefault(); commitRename() }}>
        <label htmlFor="clip-rename-input">Nombre del clip</label>
        <input id="clip-rename-input" className="clip-rename-input" autoFocus value={name} maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setRenaming(false) } }} />
        <div className="clip-menu-rename-actions">
          <button type="submit" className="button" disabled={!name.trim()}>Guardar</button>
          <button type="button" className="text-button" onClick={() => setRenaming(false)}>Cancelar</button>
        </div>
      </form>
    ) : (
      <>
        <button role="menuitem" disabled={studio.locked || !clip} onClick={() => { setName(clip?.name ?? ''); setRenaming(true) }}>Renombrar clip…</button>
        <div className="clip-menu-gain">
          <label htmlFor="clip-gain">{count > 1 ? `Volumen · ${count} clips` : 'Volumen del clip'}</label>
          <output>{dbLabel(gain)}</output>
          <input id="clip-gain" aria-label={count > 1 ? 'Volumen de los clips seleccionados' : 'Volumen del clip'}
            type="range" min={0} max={2} step={0.01} value={gain} disabled={studio.locked || !clip}
            onChange={(e) => studio.updateClips(selection, { gain: e.target.valueAsNumber })} />
        </div>
        <hr />
        {items.map(([label, action, enabled]) => <button key={label} role="menuitem" disabled={studio.locked || !enabled} onClick={() => { action(); onClose() }}>{label}</button>)}
      </>
    )}
  </div>
}
