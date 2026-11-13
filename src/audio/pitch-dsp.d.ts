export const PITCH_BLOCK: number
export const PITCH_HOP: number
export class Stretch {
  constructor(module: WebAssembly.Module)
  latency: number
  process(
    input: Float32Array[],
    output: Float32Array[],
    semitones: number,
    fundamental: number,
    sampleRate: number,
  ): void
}
export function nearestNote(
  midi: number,
  key: number,
  scale: number,
  previous?: number | null,
): number
export class PitchDetector {
  constructor(sampleRate: number)
  push(input?: Float32Array): void
  detect(): { frequency: number; confidence: number } | null
}
export class PitchController {
  constructor(sampleRate: number)
  correction: number
  frequency: number
  update(
    detected: { frequency: number; confidence: number } | null,
    params: Record<string, number>,
  ): number
}
