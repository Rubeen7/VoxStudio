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
  | 'autotune'
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
  factory?: true
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
  options?: string[]
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
export const PITCH_KEYS = [
  'Do',
  'Do♯',
  'Re',
  'Re♯',
  'Mi',
  'Fa',
  'Fa♯',
  'Sol',
  'Sol♯',
  'La',
  'La♯',
  'Si',
]
export const PITCH_SCALES = ['Mayor', 'Menor natural', 'Cromática']
export const PITCH_MODES = [
  { name: 'Natural', retune: 90, amount: 90, humanize: 35 },
  { name: 'Modern', retune: 25, amount: 100, humanize: 10 },
  { name: 'Hard Tune', retune: 0, amount: 100, humanize: 0 },
]
export const effectDefinitions: Record<
  EffectType,
  { name: string; description: string; parameters: EffectParameter[] }
> = {
  autotune: {
    name: 'Afinación vocal',
    description:
      'Corrección monofónica, 70–1000 Hz. Reproducción y WAV; se omite al monitorizar el micrófono. Usa una voz aislada y colócalo antes de reverb y delay.',
    parameters: [
      { ...param('key', 'Tonalidad', 0, 11, 1, 0), options: PITCH_KEYS },
      { ...param('scale', 'Escala', 0, 2, 1, 2), options: PITCH_SCALES },
      {
        ...param('mode', 'Modo · punto de partida', 0, 2, 1, 0),
        options: PITCH_MODES.map((mode) => mode.name),
      },
      param('retune', 'Retune Speed', 0, 300, 1, 90, 'ms'),
      param('amount', 'Amount', 0, 100, 1, 90, '%'),
      param('humanize', 'Humanize', 0, 100, 1, 35, '%'),
      mix(100),
    ],
  },
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
  let hasPitch = false
  return value.slice(0, MAX_EFFECTS).flatMap((raw: unknown) => {
    if (!raw || typeof raw !== 'object') return []
    const e = raw as Partial<AudioEffect>
    if (!e.type || !Object.hasOwn(effectDefinitions, e.type)) return []
    // One pitch detector per track avoids contradictory scales and needless latency/CPU.
    if (e.type === 'autotune') {
      if (hasPitch) return []
      hasPitch = true
    }
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
                ? Math.max(p.min, Math.min(p.max, p.options ? Math.round(value) : value))
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
      if (e.type === 'autotune') return sum // DSP delay is compensated, not an effect tail.
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

/** Factory presets included with VOX Studio. Marked factory:true so UI can distinguish them from user presets. */
function factoryPreset(
  id: string,
  name: string,
  chain: { type: EffectType; enabled?: boolean; params: Partial<Record<string, number>> }[],
): EffectPreset {
  return {
    id,
    version: 1,
    name,
    updatedAt: 0,
    factory: true,
    effects: chain.map(({ type, enabled = true, params }) => ({
      id: `factory-${id}-${type}`,
      type,
      enabled,
      params: Object.fromEntries(
        effectDefinitions[type].parameters.map((p) => [p.key, (params as Record<string, number>)[p.key] ?? p.default]),
      ),
    })),
  }
}

export const FACTORY_PRESETS: EffectPreset[] = [
  factoryPreset('vox-lead', 'Voz principal · limpia', [
    { type: 'highpass', params: { frequency: 90, q: 0.7 } },
    { type: 'deesser', params: { frequency: 5500, threshold: -28, ratio: 6, reduction: 12, mix: 100 } },
    { type: 'compressor', params: { threshold: -20, ratio: 4, attack: 10, release: 120, knee: 6, makeup: 3, mix: 100 } },
    { type: 'eq', params: { frequency0: 160, gain0: -2, q0: 1, frequency1: 2000, gain1: 2, q1: 1.5, frequency2: 8000, gain2: 1.5, q2: 1 } },
    { type: 'reverb', params: { duration: 1.4, tone: 7000, mix: 14 } },
  ]),
  factoryPreset('vox-warm', 'Voz cálida · soul', [
    { type: 'highpass', params: { frequency: 80, q: 0.7 } },
    { type: 'saturation', params: { drive: 4, output: -4, mix: 35 } },
    { type: 'compressor', params: { threshold: -24, ratio: 5, attack: 15, release: 180, knee: 8, makeup: 4, mix: 100 } },
    { type: 'eq', params: { frequency0: 200, gain0: 1.5, q0: 0.8, frequency1: 1200, gain1: -1, q1: 1, frequency2: 6000, gain2: 1, q2: 1 } },
    { type: 'reverb', params: { duration: 2.2, tone: 5500, mix: 20 } },
  ]),
  factoryPreset('vox-rap', 'Voz rap · punch', [
    { type: 'highpass', params: { frequency: 100, q: 0.9 } },
    { type: 'deesser', params: { frequency: 6000, threshold: -24, ratio: 8, reduction: 14, mix: 100 } },
    { type: 'compressor', params: { threshold: -18, ratio: 6, attack: 5, release: 80, knee: 4, makeup: 5, mix: 100 } },
    { type: 'eq', params: { frequency0: 120, gain0: -3, q0: 1.2, frequency1: 3000, gain1: 3, q1: 2, frequency2: 10000, gain2: 2, q2: 1 } },
    { type: 'delay', params: { time: 160, feedback: 20, mix: 12 } },
    { type: 'reverb', params: { duration: 0.8, tone: 9000, mix: 8 } },
  ]),
  factoryPreset('vox-airy', 'Voz aérea · pop', [
    { type: 'highpass', params: { frequency: 120, q: 0.7 } },
    { type: 'compressor', params: { threshold: -22, ratio: 3, attack: 20, release: 200, knee: 10, makeup: 2, mix: 100 } },
    { type: 'eq', params: { frequency0: 180, gain0: -1, q0: 1, frequency1: 1400, gain1: 1, q1: 1, frequency2: 12000, gain2: 3, q2: 0.8 } },
    { type: 'reverb', params: { duration: 2.0, tone: 10000, mix: 22 } },
  ]),
  factoryPreset('vox-autotune-hard', 'Autotune Hard · trap', [
    { type: 'autotune', params: { key: 0, scale: 0, mode: 2, retune: 0, amount: 100, humanize: 0, mix: 100 } },
    { type: 'highpass', params: { frequency: 100, q: 0.7 } },
    { type: 'compressor', params: { threshold: -20, ratio: 5, attack: 8, release: 100, knee: 5, makeup: 4, mix: 100 } },
    { type: 'reverb', params: { duration: 1.2, tone: 8000, mix: 16 } },
  ]),
  factoryPreset('vox-double', 'Dobles · amplio', [
    { type: 'highpass', params: { frequency: 150, q: 0.7 } },
    { type: 'compressor', params: { threshold: -26, ratio: 3, attack: 25, release: 300, knee: 12, makeup: 2, mix: 100 } },
    { type: 'eq', params: { frequency0: 200, gain0: -2, q0: 1, frequency1: 1200, gain1: 1, q1: 1, frequency2: 7000, gain2: 2, q2: 1 } },
    { type: 'reverb', params: { duration: 1.8, tone: 6000, mix: 25 } },
  ]),
  factoryPreset('beat-clean', 'Beat sin efectos', []),
]
