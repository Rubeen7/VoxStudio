import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, Copy, Pencil, Plus, Power, Trash2 } from 'lucide-react'
import type { Studio } from '../hooks/useStudio'
import {
  cloneEffectChain,
  createEffect,
  effectDefinitions,
  FACTORY_PRESETS,
  MAX_EFFECTS,
  PITCH_KEYS,
  PITCH_SCALES,
  PITCH_MODES,
  type AudioEffect,
  type EffectParameter,
  type EffectPreset,
  type EffectType,
} from '../model/effects'
import {
  deleteEffectPreset,
  duplicateEffectPreset,
  listEffectPresets,
  renameEffectPreset,
  saveEffectPreset,
} from '../storage/projects'
import './EffectsPanel.css'

function Parameter({
  definition: p,
  value,
  disabled,
  onChange,
}: {
  definition: EffectParameter
  value: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  if (p.options)
    return (
      <label className="field-label effect-parameter">
        {p.label}
        <select
          aria-label={p.label}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {p.options.map((name, index) => (
            <option value={index} key={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
    )
  const slider = p.logarithmic ? (Math.log(value / p.min) / Math.log(p.max / p.min)) * 1000 : value
  return (
    <div className="effect-parameter">
      <label>
        <span>{p.label}</span>
        <span className="effect-value">
          <input
            type="number"
            aria-label={p.label}
            min={p.min}
            max={p.max}
            step={p.step}
            value={value}
            disabled={disabled}
            onChange={(e) => {
              if (Number.isFinite(e.target.valueAsNumber))
                onChange(Math.min(p.max, Math.max(p.min, e.target.valueAsNumber)))
            }}
          />
          <small>{p.unit}</small>
        </span>
      </label>
      <input
        type="range"
        aria-label={`${p.label}: deslizador`}
        aria-valuetext={`${value} ${p.unit}`}
        min={p.logarithmic ? 0 : p.min}
        max={p.logarithmic ? 1000 : p.max}
        step={p.logarithmic ? 1 : p.step}
        value={slider}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value)
          onChange(p.logarithmic ? Math.round(p.min * (p.max / p.min) ** (n / 1000)) : n)
        }}
      />
    </div>
  )
}

export function EffectsPanel({ studio }: { studio: Studio }) {
  const track = studio.selectedTrack
  const effects = track.effects
  const recording = studio.transport === 'recording'
  const hasPitch = effects.some((effect) => effect.type === 'autotune')
  const [type, setType] = useState<EffectType>('eq')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [userPresets, setUserPresets] = useState<EffectPreset[]>([])
  const [presetId, setPresetId] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const renameRef = useRef<HTMLInputElement>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    let active = true
    void listEffectPresets()
      .then((items) => {
        if (active) setUserPresets(items)
      })
      .catch(() => {
        if (active) setMessage({ text: 'No se pudieron leer los presets locales.', error: true })
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (renamingId && renameRef.current) renameRef.current.select()
  }, [renamingId])

  const update = (effect: AudioEffect) =>
    studio.updateEffects(
      track.id,
      effects.map((e) => (e.id === effect.id ? effect : e)),
    )
  const move = (index: number, delta: number) => {
    const next = [...effects]
    ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
    studio.updateEffects(track.id, next)
  }
  const savePreset = async () => {
    setSaving(true)
    try {
      const saved = await saveEffectPreset(name, effects)
      setUserPresets((items) => [saved, ...items])
      setPresetId(saved.id)
      setName('')
      setMessage({ text: 'Cadena guardada como preset.', error: false })
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : 'No se pudo guardar el preset.',
        error: true,
      })
    } finally {
      setSaving(false)
    }
  }
  const removePreset = async (id: string) => {
    setSaving(true)
    try {
      await deleteEffectPreset(id)
      setUserPresets((items) => items.filter((p) => p.id !== id))
      if (presetId === id) setPresetId('')
      setMessage({ text: 'Preset eliminado. La cadena de la pista se conserva.', error: false })
    } catch {
      setMessage({ text: 'No se pudo eliminar el preset.', error: true })
    } finally {
      setSaving(false)
    }
  }
  const duplicatePreset = async (id: string) => {
    setSaving(true)
    try {
      const copy = await duplicateEffectPreset(id)
      setUserPresets((items) => [copy, ...items])
      setMessage({ text: `Preset duplicado: «${copy.name}».`, error: false })
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : 'No se pudo duplicar el preset.',
        error: true,
      })
    } finally {
      setSaving(false)
    }
  }
  const startRename = (preset: EffectPreset) => {
    setRenamingId(preset.id)
    setRenameValue(preset.name)
  }
  const commitRename = async () => {
    if (!renamingId) return
    setSaving(true)
    try {
      const updated = await renameEffectPreset(renamingId, renameValue)
      setUserPresets((items) => items.map((p) => (p.id === updated.id ? updated : p)))
      setMessage({ text: 'Preset renombrado.', error: false })
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : 'No se pudo renombrar.',
        error: true,
      })
    } finally {
      setSaving(false)
      setRenamingId(null)
    }
  }

  const loadPreset = (preset: EffectPreset) => {
    const chain = cloneEffectChain(preset.effects)
    studio.updateEffects(track.id, chain)
    setPresetId(preset.id)
    setExpanded(chain[0]?.id ?? null)
    setMessage({
      text: `Cadena «${preset.name}» cargada en ${track.name}.`,
      error: false,
    })
  }

  // Factory presets first, then the ones saved in this browser.
  const allPresets = [...FACTORY_PRESETS, ...userPresets]
  const selectedPreset = allPresets.find(p => p.id === presetId)

  return (
    <section className="inspector-section effects-panel" aria-label="Efectos de pista">
      <div className="effects-title">
        <h3>Efectos</h3>
        <span>
          {effects.length} / {MAX_EFFECTS}
        </span>
      </div>
      <p className="microcopy effects-flow">Orden de arriba abajo → volumen → panorama.</p>
      <div className="effect-add">
        <select
          aria-label="Tipo de efecto"
          value={type}
          onChange={(e) => setType(e.target.value as EffectType)}
          disabled={!!studio.busy}
        >
          {Object.entries(effectDefinitions).map(([key, definition]) => (
            <option key={key} value={key}>
              {definition.name}
            </option>
          ))}
        </select>
        <button
          className="button"
          aria-label="Añadir efecto"
          title="Añadir efecto al final de la cadena"
          disabled={
            !!studio.busy ||
            effects.length >= MAX_EFFECTS ||
            (type === 'autotune' && (hasPitch || recording))
          }
          onClick={() => {
            const effect = createEffect(type)
            studio.updateEffects(track.id, [...effects, effect])
            setExpanded(effect.id)
          }}
        >
          <Plus size={14} />
        </button>
      </div>
      {type === 'autotune' && (hasPitch || recording) && (
        <p className="microcopy">
          {hasPitch
            ? 'Un corrector de afinación por pista.'
            : 'Añade la afinación cuando termine la toma.'}
        </p>
      )}
      {effects.length === 0 && (
        <p className="microcopy">Sin efectos. La pista reproduce el audio original.</p>
      )}
      <div className="effect-chain">
        {effects.map((effect, index) => {
          const definition = effectDefinitions[effect.type]
          return (
            <div
              className={`effect-unit ${effect.enabled ? '' : 'bypassed'}`}
              role="group"
              aria-label={`${index + 1}. ${definition.name}`}
              key={effect.id}
            >
              <div className="effect-heading">
                <button
                  className={`icon-button small effect-power ${effect.enabled ? 'enabled' : ''}`}
                  aria-label={`${effect.enabled ? 'Desactivar' : 'Activar'} ${definition.name}`}
                  aria-pressed={effect.enabled}
                  title={effect.enabled ? 'Desactivar efecto (bypass)' : 'Activar efecto'}
                  disabled={!!studio.busy}
                  onClick={() => update({ ...effect, enabled: !effect.enabled })}
                >
                  <Power size={12} />
                </button>
                <button
                  className="effect-expand"
                  aria-expanded={expanded === effect.id}
                  aria-controls={`effect-${effect.id}`}
                  onClick={() => setExpanded(expanded === effect.id ? null : effect.id)}
                  title={definition.name}
                >
                  <span>
                    {index + 1}. {definition.name}
                  </span>
                  <ChevronDown size={11} />
                </button>
                <button
                  className="icon-button small"
                  aria-label="Subir efecto"
                  title="Procesar antes"
                  disabled={!!studio.busy || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  className="icon-button small"
                  aria-label="Bajar efecto"
                  title="Procesar después"
                  disabled={!!studio.busy || index === effects.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={12} />
                </button>
                <button
                  className="icon-button small"
                  aria-label="Eliminar efecto"
                  title="Eliminar efecto"
                  disabled={!!studio.busy || (effect.type === 'autotune' && recording)}
                  onClick={() =>
                    studio.updateEffects(
                      track.id,
                      effects.filter((e) => e.id !== effect.id),
                    )
                  }
                >
                  <Trash2 size={12} />
                </button>
              </div>
              {effect.type === 'autotune' && (
                <p className="pitch-summary microcopy">
                  {PITCH_KEYS[effect.params.key]} · {PITCH_SCALES[effect.params.scale]} ·
                  Reproducción / WAV
                </p>
              )}
              {expanded === effect.id && (
                <div className="effect-settings" id={`effect-${effect.id}`}>
                  <p className="microcopy">{definition.description}</p>
                  {!effect.enabled && (
                    <p className="effect-bypass-note">Bypass · ajustes conservados</p>
                  )}
                  {definition.parameters.map((parameter) => (
                    <Parameter
                      key={parameter.key}
                      definition={parameter}
                      value={effect.params[parameter.key]}
                      disabled={!!studio.busy}
                      onChange={(value) => {
                        const params = { ...effect.params, [parameter.key]: value }
                        if (effect.type === 'autotune' && parameter.key === 'mode') {
                          const mode = PITCH_MODES[value]
                          Object.assign(params, {
                            retune: mode.retune,
                            amount: mode.amount,
                            humanize: mode.humanize,
                          })
                        }
                        update({ ...effect, params })
                      }}
                    />
                  ))}
                  {effect.type === 'autotune' && (
                    <p className="microcopy">
                      Retune bajo: corrección más rápida. Humanize conserva parte del vibrato en
                      notas sostenidas. La compensación de formantes es aproximada; compara con
                      bypass.
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <details className="effect-presets">
        <summary>Presets de cadena</summary>
        {/* Factory presets */}
        <p className="microcopy" style={{ marginTop: 8 }}>Presets incluidos</p>
        <div className="preset-list">
          {FACTORY_PRESETS.map((preset) => (
            <div key={preset.id} className="preset-row">
              <span className="preset-tag factory">VOX</span>
              <button
                className="text-button preset-load-btn"
                disabled={!!studio.busy || recording}
                onClick={() => loadPreset(preset)}
                title={`Cargar «${preset.name}» en ${track.name}`}
              >
                {preset.name}
              </button>
            </div>
          ))}
        </div>
        {/* User presets */}
        {userPresets.length > 0 && (
          <>
            <p className="microcopy" style={{ marginTop: 10 }}>Mis presets</p>
            <div className="preset-list">
              {userPresets.map((preset) => (
                <div key={preset.id} className="preset-row">
                  {renamingId === preset.id ? (
                    <input
                      ref={renameRef}
                      className="take-name-input"
                      value={renameValue}
                      maxLength={60}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitRename()
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      onBlur={() => void commitRename()}
                      disabled={saving}
                    />
                  ) : (
                    <button
                      className="text-button preset-load-btn"
                      disabled={!!studio.busy || recording}
                      onClick={() => loadPreset(preset)}
                      title={`Cargar «${preset.name}» en ${track.name}`}
                    >
                      {preset.name}
                    </button>
                  )}
                  <button
                    className="icon-button small"
                    aria-label={`Renombrar ${preset.name}`}
                    title="Renombrar preset"
                    disabled={saving}
                    onClick={() => (renamingId === preset.id ? void commitRename() : startRename(preset))}
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    className="icon-button small"
                    aria-label={`Duplicar ${preset.name}`}
                    title="Duplicar preset"
                    disabled={saving}
                    onClick={() => void duplicatePreset(preset.id)}
                  >
                    <Copy size={11} />
                  </button>
                  <button
                    className="icon-button small"
                    aria-label={`Eliminar ${preset.name}`}
                    title="Eliminar preset"
                    disabled={saving}
                    onClick={() => void removePreset(preset.id)}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
        {/* Save new preset */}
        <p className="microcopy" style={{ marginTop: 12 }}>
          {selectedPreset && !selectedPreset.factory
            ? `Cadena de «${selectedPreset.name}» activa.`
            : 'Cargar sustituye los efectos de esta pista.'}
        </p>
        <label className="field-label preset-name">
          Nombre del nuevo preset
          <input
            aria-label="Nombre del preset"
            value={name}
            maxLength={60}
            disabled={saving}
            onChange={(e) => setName(e.target.value)}
            placeholder="Voz principal…"
          />
        </label>
        <button
          className="button full-width"
          disabled={saving || !!studio.busy || !name.trim() || !effects.length}
          onClick={() => void savePreset()}
        >
          Guardar cadena actual
        </button>
        <p className="microcopy">Disponible en los proyectos de este navegador.</p>
      </details>
      {message && (
        <p
          className={`microcopy ${message.error ? 'red-text' : ''}`}
          role={message.error ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}
    </section>
  )
}
