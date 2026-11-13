import { memo, useEffect, useRef } from 'react'

const cache = new WeakMap<AudioBuffer, { min: Float32Array; max: Float32Array }>()
const BLOCK = 256
function peaks(buffer: AudioBuffer) {
  let value = cache.get(buffer)
  if (value) return value
  const length = Math.ceil(buffer.length / BLOCK)
  value = { min: new Float32Array(length), max: new Float32Array(length) }
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel)
    for (let index = 0; index < samples.length; index++) {
      const bin = Math.floor(index / BLOCK)
      value.min[bin] = Math.min(value.min[bin], samples[index])
      value.max[bin] = Math.max(value.max[bin], samples[index])
    }
  }
  cache.set(buffer, value)
  return value
}

export const Waveform = memo(function Waveform({
  buffer,
  color,
  offset = 0,
  duration,
  gain = 1,
}: {
  buffer: AudioBuffer
  color: string
  offset?: number
  duration: number
  gain?: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current!
    const paint = () => {
      const bounds = canvas.getBoundingClientRect()
      const width = Math.min(4096, Math.max(1, Math.ceil(bounds.width)))
      const height = Math.max(1, Math.ceil(bounds.height))
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = width * dpr
      canvas.height = height * dpr
      const ctx = canvas.getContext('2d')!
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, width, height)
      const envelope = peaks(buffer)
      const start = (offset * buffer.sampleRate) / BLOCK
      const span = (duration * buffer.sampleRate) / BLOCK
      ctx.fillStyle = color
      ctx.globalAlpha = 0.88
      const scale = Math.min(2, gain)
      for (let x = 0; x < width; x++) {
        const from = Math.floor(start + (span * x) / width)
        const to = Math.min(
          envelope.min.length,
          Math.max(from + 1, Math.ceil(start + (span * (x + 1)) / width)),
        )
        let min = 0
        let max = 0
        for (let bin = from; bin < to; bin++) {
          min = Math.min(min, envelope.min[bin] * scale)
          max = Math.max(max, envelope.max[bin] * scale)
        }
        min = Math.max(-1, min)
        max = Math.min(1, max)
        const top = ((1 - max) * height) / 2
        ctx.fillRect(x, top, 1, Math.max(0.7, ((max - min) * height) / 2))
      }
    }
    const observer = new ResizeObserver(paint)
    observer.observe(canvas)
    paint()
    return () => observer.disconnect()
  }, [buffer, color, duration, gain, offset])
  return <canvas ref={ref} className="waveform" aria-label="Forma de onda del audio" role="img" />
})
