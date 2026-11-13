import { useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { AudioLines } from 'lucide-react'
import type { Studio } from '../hooks/useStudio'
import { audioEngine } from '../audio/AudioEngine'
import { formatTime, type Clip, type Track } from '../model/project'
import { editClip, envelopePoints, snapTime, timelineSettings, trimClip } from '../model/editing'
import { Waveform } from './Waveform'

type Gesture = 'move' | 'start' | 'end' | 'fadeIn' | 'fadeOut'
export function AudioClip({ clip, track, studio, scale, onMenu }: { clip: Clip; track: Track; studio: Studio; scale: number; onMenu: (x: number, y: number) => void }) {
  const [preview, setPreview] = useState<Clip | null>(null)
  const gesture = useRef<{ mode: Gesture; x: number; scroll: number; moved: boolean; element: HTMLElement; ids: string[]; next?: Clip; destination?: string } | null>(null)
  const buffer = audioEngine.getBuffer(clip.assetId)
  const shown = preview ?? clip
  const begin = (event: PointerEvent<HTMLElement>, mode: Gesture) => {
    event.stopPropagation()
    if (event.button !== 0 || studio.locked) return
    const additive = event.ctrlKey || event.metaKey
    studio.selectClip(track.id, clip.id, additive, !additive && mode === 'move')
    if (additive) return
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { mode, x: event.clientX, scroll: event.currentTarget.closest('.timeline-scroll')!.scrollLeft,
      moved: false, element: event.currentTarget, ids: studio.selectedClipIds.includes(clip.id) ? studio.selectedClipIds : [clip.id] }
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g) return
    const scroller = event.currentTarget.closest('.timeline-scroll')!
    const bounds = scroller.getBoundingClientRect()
    if (event.clientX > bounds.right - 25) scroller.scrollLeft += 14
    else if (event.clientX < bounds.left + 245) scroller.scrollLeft -= 14
    const pixels = event.clientX - g.x + scroller.scrollLeft - g.scroll
    if (!g.moved && Math.abs(pixels) < 3) return
    g.moved = true
    const delta = pixels / scale
    let next: Clip
    if (g.mode === 'move') {
      next = editClip(clip, { start: snapTime(clip.start + delta, studio.project, event.shiftKey) }, buffer?.duration ?? clip.offset + clip.duration)
      g.destination = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-track-id]')?.dataset.trackId
    } else if (g.mode === 'start' || g.mode === 'end') {
      const time = snapTime(clip.start + (g.mode === 'end' ? clip.duration : 0) + delta, studio.project, event.shiftKey)
      next = trimClip(clip, g.mode, time, buffer?.duration ?? clip.offset + clip.duration)
    } else next = editClip(clip, { [g.mode]: (clip[g.mode] ?? 0) + delta * (g.mode === 'fadeIn' ? 1 : -1) }, buffer?.duration ?? clip.offset + clip.duration)
    g.next = next; setPreview(next)
  }
  const finish = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const g = gesture.current
    if (!g) return
    gesture.current = null; setPreview(null)
    if (g.element.hasPointerCapture(event.pointerId)) g.element.releasePointerCapture(event.pointerId)
    if (!cancelled && g.moved && g.next) {
      if (g.mode === 'move') studio.moveSelection(g.ids, g.next.start - clip.start, g.destination)
      else studio.updateClip(clip.id, g.next)
    }
  }
  const step = (fine: boolean) => fine ? 0.01 : 60 / studio.project.bpm * timelineSettings(studio.project).grid
  const selected = studio.selectedClipIds.includes(clip.id)
  const fadeIn = shown.fadeIn ?? 0, fadeOut = shown.fadeOut ?? 0
  const fading = fadeIn > 0 || fadeOut > 0
  const fadeLabel = [fadeIn ? `entrada ${fadeIn.toFixed(2)} s` : '', fadeOut ? `salida ${fadeOut.toFixed(2)} s` : '']
    .filter(Boolean).join(' · ')
  return <div className={`audio-clip ${selected ? 'selected' : ''} ${preview ? 'dragging' : ''} ${fading ? 'has-fade' : ''}`}
    style={{ left: shown.start * scale, width: Math.max(8, shown.duration * scale), '--track-color': track.color } as CSSProperties}
    onPointerMove={move} onPointerUp={e => finish(e)} onPointerCancel={e => finish(e, true)}>
    <button className="clip-body" aria-label={`Clip ${clip.name}, inicio ${clip.start.toFixed(2)} segundos`} aria-pressed={selected}
      title={`${clip.name} · ${formatTime(clip.start, true)} → ${formatTime(clip.start + clip.duration, true)}${fadeLabel ? ` · Fade ${fadeLabel}` : ''} · Ctrl+clic: selección múltiple · Mayús: sin snap`}
      onPointerDown={e => begin(e, 'move')} onClick={e => { if (e.detail === 0) studio.selectClip(track.id, clip.id) }}
      onContextMenu={e => { e.preventDefault(); studio.selectClip(track.id, clip.id, false, true); onMenu(e.clientX, e.clientY) }}
      onKeyDown={e => { if (!studio.locked && ['ArrowLeft','ArrowRight'].includes(e.key)) { e.preventDefault(); studio.moveSelection(selected ? studio.selectedClipIds : [clip.id], (e.key === 'ArrowRight' ? 1 : -1) * step(e.shiftKey)) } }}>
      <span className="clip-heading"><AudioLines size={11} /><span>{clip.name}</span>{clip.takeGroupId && <small className="take-badge">Tomas</small>}</span>
      {buffer && <Waveform buffer={buffer} color={track.color} offset={shown.offset} duration={shown.duration} gain={shown.gain ?? 1} />}
      <svg className="clip-envelope" viewBox={`0 0 ${shown.duration} 1`} preserveAspectRatio="none" aria-hidden="true">
        <polyline points={envelopePoints(shown).map(p => `${p.time},${1 - p.value}`).join(' ')} />
      </svg>
    </button>
    {fadeIn > 0 && <span className="clip-fade fade-in" style={{ width: Math.max(2, fadeIn * scale) }} aria-hidden="true" />}
    {fadeOut > 0 && <span className="clip-fade fade-out" style={{ width: Math.max(2, fadeOut * scale) }} aria-hidden="true" />}
    {(['start','end'] as const).map(edge => <button key={edge} className={`clip-trim trim-${edge}`} aria-label={`Recortar ${edge === 'start' ? 'inicio' : 'final'} de ${clip.name}`}
      title={`Arrastra para recortar ${edge === 'start' ? 'inicio' : 'final'}`} disabled={studio.locked} onPointerDown={e => begin(e, edge)}
      onKeyDown={e => { if (['ArrowLeft','ArrowRight'].includes(e.key)) { e.preventDefault(); studio.updateClip(clip.id, trimClip(clip, edge, clip.start + (edge === 'end' ? clip.duration : 0) + step(e.shiftKey) * (e.key === 'ArrowRight' ? 1 : -1), buffer?.duration ?? clip.duration)) } }} />)}
    {(['fadeIn','fadeOut'] as const).map(fade => <button key={fade} className="fade-handle" aria-label={`${fade === 'fadeIn' ? 'Fundido de entrada' : 'Fundido de salida'} de ${clip.name}`}
      title={`${fade === 'fadeIn' ? 'Fade in' : 'Fade out'}: ${(shown[fade] ?? 0).toFixed(2)} s · arrastra`}
      style={fade === 'fadeIn' ? { left: Math.max(7, (shown.fadeIn ?? 0) * scale - 4) } : { right: Math.max(7, (shown.fadeOut ?? 0) * scale - 4) }}
      disabled={studio.locked} onPointerDown={e => begin(e, fade)}
      onKeyDown={e => { if (['ArrowLeft','ArrowRight'].includes(e.key)) { e.preventDefault(); studio.updateClip(clip.id, { [fade]: (clip[fade] ?? 0) + 0.01 * (e.key === 'ArrowRight' ? 1 : -1) }) } }} />)}
  </div>
}
