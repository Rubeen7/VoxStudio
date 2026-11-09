/** PCM16 little-endian WAV. Interleaves channels; never normalizes the mix. */
export function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const frames = channels[0]?.length ?? 0
  if (!channels.length || channels.some((c) => c.length !== frames))
    throw new Error('Canales de audio no válidos.')
  const bytes = frames * channels.length * 2
  const buffer = new ArrayBuffer(44 + bytes)
  const view = new DataView(buffer)
  const text = (offset: number, value: string) =>
    [...value].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + bytes, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels.length, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels.length * 2, true)
  view.setUint16(32, channels.length * 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, bytes, true)
  let cursor = 44
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, channel[frame]))
      view.setInt16(cursor, Math.round(sample * (sample < 0 ? 32768 : 32767)), true)
      cursor += 2
    }
  }
  return buffer
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
