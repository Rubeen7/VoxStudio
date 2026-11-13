import { expect, test, type Page } from '@playwright/test'
import { encodeWav } from '../../src/audio/wav'

type DropTarget = { kind: 'lane'; index: number } | { kind: 'empty' }

interface DropFile {
  name: string
  mimeType: string
  base64: string
}

interface StagedDrop {
  dt: DataTransfer
  clientX: number
  clientY: number
  target: HTMLElement
}

function audioFile(name: string) {
  const sampleRate = 48000
  const pcm = Float32Array.from(
    { length: sampleRate },
    (_, i) => 0.15 * Math.sin((i * Math.PI * 2 * 440) / sampleRate),
  )
  return {
    name,
    mimeType: 'audio/wav',
    base64: Buffer.from(encodeWav([pcm], sampleRate)).toString('base64'),
  }
}

/** Fires dragenter + dragover with a real DataTransfer and keeps it for the drop. */
async function stageDrop(page: Page, target: DropTarget, file: DropFile, time: number) {
  await page.evaluate(
    ({ target, file, time }) => {
      const lane =
        target.kind === 'lane'
          ? document.querySelectorAll<HTMLElement>('[data-track-id]')[target.index]
          : null
      const element = lane ?? document.querySelector<HTMLElement>('.timeline-empty-space')!
      const base = lane ?? document.querySelector<HTMLElement>('.ruler')!
      const zoom = Number.parseInt(document.querySelector('.zoom-label')?.textContent ?? '100', 10)
      const scale = ((Number.isFinite(zoom) ? zoom : 100) / 100) * 42
      const rect = base.getBoundingClientRect()
      const clientX = rect.left + time * scale
      const clientY = element.getBoundingClientRect().top + 10
      const dt = new DataTransfer()
      const bytes = Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0))
      dt.items.add(new File([bytes], file.name, { type: file.mimeType }))
      const init = { bubbles: true, cancelable: true, dataTransfer: dt, clientX, clientY }
      element.dispatchEvent(new DragEvent('dragenter', init))
      element.dispatchEvent(new DragEvent('dragover', init))
      ;(window as unknown as { __voxDrop?: StagedDrop }).__voxDrop = {
        dt,
        clientX,
        clientY,
        target: element,
      }
    },
    { target, file, time },
  )
}

async function finishDrop(page: Page) {
  await page.evaluate(() => {
    const staged = (window as unknown as { __voxDrop?: StagedDrop }).__voxDrop
    if (!staged) throw new Error('No hay un arrastre preparado.')
    const init = {
      bubbles: true,
      cancelable: true,
      dataTransfer: staged.dt,
      clientX: staged.clientX,
      clientY: staged.clientY,
    }
    staged.target.dispatchEvent(new DragEvent('drop', init))
    delete (window as unknown as { __voxDrop?: StagedDrop }).__voxDrop
  })
}

test('dropping a WAV on a track places it there at the drop time and survives reload', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Grabar', exact: true })).toBeEnabled()
  const trackId = await page.locator('[data-track-id]').nth(1).getAttribute('data-track-id')

  await stageDrop(page, { kind: 'lane', index: 1 }, audioFile('drop-take.wav'), 2)
  // The full-window overlay yields to the precise timeline indicator.
  await expect(page.getByTestId('file-drop-indicator')).toBeVisible()
  await expect(page.locator('.drop-overlay')).toHaveCount(0)
  await expect(page.locator('.track-row.drop-target-track')).toHaveCount(1)
  await expect(page.locator('.timeline-drop-label')).toContainText('Suelta en «Voz principal»')
  await page.screenshot({ path: 'test-results/import-drop-indicator.png' })

  await finishDrop(page)
  await expect(page.getByTestId('file-drop-indicator')).toHaveCount(0)
  const clip = page.getByRole('button', { name: /Clip drop-take/ })
  await expect(clip).toBeVisible()
  expect(
    Number(
      await page.getByRole('spinbutton', { name: 'Inicio en sesión', exact: true }).inputValue(),
    ),
  ).toBeCloseTo(2, 2)
  expect(
    await clip.evaluate((element) => element.closest('[data-track-id]')?.getAttribute('data-track-id')),
  ).toBe(trackId)

  await expect(page.getByText('Todos los cambios guardados', { exact: true })).toBeVisible()
  await page.reload()
  const restored = page.getByRole('button', { name: /Clip drop-take/ })
  await expect(restored).toBeVisible()
  expect(
    await restored.evaluate(
      (element) => element.closest('[data-track-id]')?.getAttribute('data-track-id'),
    ),
  ).toBe(trackId)
  await restored.click()
  expect(
    Number(
      await page.getByRole('spinbutton', { name: 'Inicio en sesión', exact: true }).inputValue(),
    ),
  ).toBeCloseTo(2, 2)
  expect(errors).toEqual([])
})

test('dropping a non-audio file reports the problem and imports nothing', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Grabar', exact: true })).toBeEnabled()
  await stageDrop(
    page,
    { kind: 'lane', index: 1 },
    { name: 'notas.txt', mimeType: 'text/plain', base64: Buffer.from('hola').toString('base64') },
    1,
  )
  await expect(page.getByTestId('file-drop-indicator')).toBeVisible()
  await finishDrop(page)
  await expect(page.getByRole('alert')).toContainText('no es un archivo de audio compatible')
  await expect(page.locator('.audio-clip')).toHaveCount(0)
  await expect(page.getByTestId('file-drop-indicator')).toHaveCount(0)
})

test('dropping a WAV in empty space uses the instrumental track at the drop time', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Grabar', exact: true })).toBeEnabled()
  const trackId = await page.locator('[data-track-id]').first().getAttribute('data-track-id')
  await stageDrop(page, { kind: 'empty' }, audioFile('drop-empty.wav'), 3)
  await expect(page.getByTestId('file-drop-indicator')).toBeVisible()
  await expect(page.locator('.track-row.drop-target-track')).toHaveCount(0)
  await expect(page.locator('.timeline-drop-label')).toContainText('Suelta para importar')
  await finishDrop(page)
  const clip = page.getByRole('button', { name: /Clip drop-empty/ })
  await expect(clip).toBeVisible()
  expect(
    Number(
      await page.getByRole('spinbutton', { name: 'Inicio en sesión', exact: true }).inputValue(),
    ),
  ).toBeCloseTo(3, 2)
  expect(
    await clip.evaluate((element) => element.closest('[data-track-id]')?.getAttribute('data-track-id')),
  ).toBe(trackId)
})
