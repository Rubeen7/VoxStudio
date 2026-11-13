import { useEffect, useRef } from 'react'
import { Copy, ClipboardPaste, Scissors, Trash2, Undo2, Redo2, CopyPlus, Flag, ListMusic } from 'lucide-react'
import type { Studio } from '../hooks/useStudio'

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
  useEffect(() => {
    ref.current?.querySelector('button')?.focus()
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[(index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
      }
    }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key) }
  }, [onClose])
  const items: [string, () => void, boolean][] = [
    ['Cortar en el cursor · S', studio.splitSelection, true],
    ['Copiar · Ctrl+C', studio.copySelection, true],
    ['Pegar · Ctrl+V', studio.pasteSelection, studio.hasClipboard],
    ['Duplicar · Ctrl+D', studio.duplicateSelection, true],
    ['Eliminar · Supr', studio.deleteSelection, true],
  ]
  return <div ref={ref} className="clip-menu" role="menu" aria-label="Acciones de clip" style={{ left: Math.max(8, Math.min(x, window.innerWidth - 225)), top: Math.max(8, Math.min(y, window.innerHeight - 210)) }}>
    {items.map(([name, action, enabled]) => <button key={name} role="menuitem" disabled={studio.locked || !enabled} onClick={() => { action(); onClose() }}>{name}</button>)}
  </div>
}
