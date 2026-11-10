export type EffectType =
  | 'eq'
  | 'compressor'
  | 'reverb'
  | 'delay'
  | 'highpass'
  | 'lowpass'
  | 'saturation'
  | 'distortion'
  | 'deesser'
export interface AudioEffect {
  id: string
  type: EffectType
  enabled: boolean
  params: Record<string, number>
}
export interface EffectPreset {
  id: string
  version: 1
  name: string
  updatedAt: number
  effects: AudioEffect[]
}
export interface EffectParameter {
  key: string
  label: string
  min: number
  max: number
  step: number
  default: number
  unit: string
  logarithmic?: boolean
}
const param = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  unit = '',
  logarithmic = false,
): EffectParameter => ({ key, label, min, max, step, default: value, unit, logarithmic })
const mix = (value: number) => param('mix', 'Dry / Wet', 0, 100, 1, value, '%')
const frequency = (key: string, label: string, value: number, min = 20, max = 20000) =>
  param(key, label, min, max, 1, value, 'Hz', true)
export const MAX_EFFECTS = 8
export const MAX_EFFECT_TAIL = 60
export const effectDefinitions: Record<
  EffectType,
  { name: string; description: string; parameters: EffectParameter[] }
> = {
  eq: {
    name: 'EQ paramétrico',
    description: 'Tres bandas de campana en serie. Q alto: banda más estrecha.',
    parameters: ['Graves', 'Medios', 'Agudos'].flatMap((name, i) => [
      frequency(`frequency${i}`, `${name} · frecuencia`, [160, 1400, 6500][i], 60, 16000),
      param(`gain${i}`, `${name} · ganancia`, -18, 18, 0.1, 0, 'dB'),
      param(`q${i}`, `${name} · Q`, 0.3, 8, 0.1, 1),
    ]),
  },
  compressor: {
    name: 'Compresor',
    description:
      'Compresión estéreo enlazada, sin look-ahead. Ajusta la salida para comparar niveles.',
    parameters: [
      param('threshold', 'Umbral', -60, 0, 1, -24, 'dB'),
      param('ratio', 'Ratio', 1, 20, 0.1, 4, ':1'),
      param('attack', 'Ataque', 0.1, 100, 0.1, 10, 'ms'),
      param('release', 'Relajación', 10, 1000, 1, 120, 'ms'),
      param('knee', 'Knee', 0, 24, 1, 6, 'dB'),
      param('makeup', 'Salida', -24, 12, 0.1, 0, 'dB'),
      mix(100),
    ],
  },
  reverb: {
    name: 'Reverb',
    description:
      'Convolución con respuesta de sala sintética. Cambiar la duración renueva la cola con un fundido.',
    parameters: [
      param('duration', 'Duración', 0.2, 5, 0.1, 1.6, 's'),
      frequency('tone', 'Amortiguación', 6500, 500, 16000),
      mix(18),
    ],
  },
  delay: {
    name: 'Delay',
    description:
      'Eco con realimentación limitada al 75 %. Cambiar el tiempo puede variar el tono de la cola.',
    parameters: [
      param('time', 'Tiempo', 10, 1000, 1, 280, 'ms'),
      param('feedback', 'Feedback', 0, 75, 1, 30, '%'),
      mix(20),
    ],
  },
  highpass: {
    name: 'Paso alto',
    description: 'Filtro de 12 dB/octava para retirar graves.',
    parameters: [
      frequency('frequency', 'Frecuencia de corte', 90),
      param('q', 'Resonancia Q', 0.5, 2, 0.1, 0.7),
    ],
  },
  lowpass: {
    name: 'Paso bajo',
    description: 'Filtro de 12 dB/octava para atenuar agudos.',
    parameters: [
      frequency('frequency', 'Frecuencia de corte', 12000),
      param('q', 'Resonancia Q', 0.5, 2, 0.1, 0.7),
    ],
  },
  saturation: {
    name: 'Saturación',
    description: 'Recorte suave con sobremuestreo 4×. Compensa el nivel con Salida.',
    parameters: [
      param('drive', 'Drive', 0, 24, 0.1, 6, 'dB'),
      param('output', 'Salida', -30, 0, 0.1, -6, 'dB'),
      mix(50),
    ],
  },
  distortion: {
    name: 'Distorsión',
    description: 'Recorte duro con sobremuestreo 4×. Empieza con una mezcla baja.',
    parameters: [
      param('drive', 'Drive', 0, 36, 0.1, 12, 'dB'),
      param('output', 'Salida', -36, 0, 0.1, -12, 'dB'),
      mix(25),
    ],
  },
  deesser: {
    name: 'De-esser',
    description:
      'Reduce dinámicamente la banda por encima del corte. No identifica fonemas: también puede suavizar aire y platos.',
    parameters: [
      frequency('frequency', 'Frecuencia sibilante', 5500, 2500, 10000),
      param('threshold', 'Umbral', -60, 0, 1, -28, 'dB'),
      param('ratio', 'Ratio', 1, 12, 0.1, 6, ':1'),
      param('reduction', 'Reducción máxima', 0, 24, 0.5, 12, 'dB'),
      mix(100),
    ],
  },
}
export function createEffect(type: EffectType): AudioEffect {
  return {
    id: crypto.randomUUID(),
    type,
    enabled: true,
    params: Object.fromEntries(effectDefinitions[type].parameters.map((p) => [p.key, p.default])),
  }
}
/** Validate persisted settings before passing them to DSP. */
export function normalizeEffects(value: unknown): AudioEffect[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  return value.slice(0, MAX_EFFECTS).flatMap((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return []
    const e = raw as Partial<AudioEffect>
    if (!e.type || !Object.hasOwn(effectDefinitions, e.type)) return []
    const id = typeof e.id === 'string' && e.id && !ids.has(e.id) ? e.id : crypto.randomUUID()
    ids.add(id)
    return [
      {
        id,
        type: e.type,
        enabled: e.enabled !== false,
        params: Object.fromEntries(
          effectDefinitions[e.type].parameters.map((p) => {
            const value = e.params?.[p.key]
            return [
              p.key,
              typeof value === 'number' && Number.isFinite(value)
                ? Math.max(p.min, Math.min(p.max, value))
                : p.default,
            ]
          }),
        ),
      },
    ]
  })
}
export function cloneEffectChain(effects: AudioEffect[]): AudioEffect[] {
  return normalizeEffects(effects).map((effect) => ({ ...effect, id: crypto.randomUUID() }))
}
export function effectTail(effects: AudioEffect[] = []): number {
  return Math.min(
    MAX_EFFECT_TAIL,
    effects.reduce((sum, e) => {
      if (!e.enabled || e.params.mix === 0) return sum
      if (e.type === 'reverb') return sum + e.params.duration + 0.1
      if (e.type === 'delay') {
        const feedback = e.params.feedback / 100
        return (
          sum +
          (e.params.time / 1000) *
            (feedback > 0 ? Math.ceil(Math.log(0.001) / Math.log(feedback)) + 1 : 1)
        )
      }
      return sum + (['eq', 'highpass', 'lowpass'].includes(e.type) ? 0.5 : 0.01)
    }, 0),
  )
}
