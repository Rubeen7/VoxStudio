import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, Plus, Power, Trash2 } from 'lucide-react'
import type { Studio } from '../hooks/useStudio'
import {
  cloneEffectChain,
  createEffect,
  effectDefinitions,
  MAX_EFFECTS,
  type AudioEffect,
  type EffectParameter,
  type EffectPreset,
  type EffectType,
} from '../model/effects'
import { deleteEffectPreset, listEffectPresets, saveEffectPreset } from '../storage/projects'
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
  const [type, setType] = useState<EffectType>('eq')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [presets, setPresets] = useState<EffectPreset[]>([])
  const [presetId, setPresetId] = useState('')
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  useEffect(() => {
    let active = true
    void listEffectPresets()
      .then((items) => {
        if (active) setPresets(items)
      })
      .catch(() => {
        if (active) setMessage({ text: 'No se pudieron leer los presets locales.', error: true })
      })
    return () => {
      active = false
    }
  }, [])
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
      setPresets((items) => [saved, ...items])
      setPresetId(saved.id)
      setName('')
      setMessage({ text: 'Cadena guardada como preset local.', error: false })
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : 'No se pudo guardar el preset.',
        error: true,
      })
    } finally {
      setSaving(false)
    }
  }
  const removePreset = async () => {
    setSaving(true)
    try {
      await deleteEffectPreset(presetId)
      setPresets((items) => items.filter((p) => p.id !== presetId))
      setPresetId('')
      setMessage({ text: 'Preset eliminado. La cadena de la pista se conserva.', error: false })
    } catch {
      setMessage({ text: 'No se pudo eliminar el preset.', error: true })
    } finally {
      setSaving(false)
    }
  }
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
          disabled={!!studio.busy || effects.length >= MAX_EFFECTS}
          onClick={() => {
            const effect = createEffect(type)
            studio.updateEffects(track.id, [...effects, effect])
            setExpanded(effect.id)
          }}
        >
          <Plus size={14} />
        </button>
      </div>
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
                  disabled={!!studio.busy}
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
                      onChange={(value) =>
                        update({ ...effect, params: { ...effect.params, [parameter.key]: value } })
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <details className="effect-presets">
        <summary>Presets de cadena</summary>
        <label className="field-label">
          Preset personalizado
          <select
            aria-label="Preset personalizado"
            value={presetId}
            onChange={(e) => setPresetId(e.target.value)}
            disabled={saving}
          >
            <option value="">Seleccionar preset…</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        <div className="preset-actions">
          <button
            className="button"
            disabled={saving || !!studio.busy || !presets.some((p) => p.id === presetId)}
            onClick={() => {
              const preset = presets.find((p) => p.id === presetId)
              if (!preset) return
              const chain = cloneEffectChain(preset.effects)
              studio.updateEffects(track.id, chain)
              setExpanded(chain[0]?.id ?? null)
              setMessage({
                text: `Cadena «${preset.name}» cargada en ${track.name}.`,
                error: false,
              })
            }}
          >
            Cargar cadena
          </button>
          <button
            className="icon-button small"
            aria-label="Eliminar preset"
            title="Eliminar preset guardado"
            disabled={saving || !presetId}
            onClick={() => void removePreset()}
          >
            <Trash2 size={13} />
          </button>
        </div>
        <p className="microcopy">
          Cargar sustituye los efectos de esta pista. Guarda primero su cadena si quieres
          conservarla.
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
          Guardar cadena
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
