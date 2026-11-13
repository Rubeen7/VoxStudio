// Repeatable extraction from the pinned upstream npm distribution. No DSP is modified.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const pkg = JSON.parse(
  await readFile(new URL('../node_modules/signalsmith-stretch/package.json', import.meta.url)),
)
if (pkg.version !== '1.3.2')
  throw new Error('Audit the WASM ABI before updating Signalsmith Stretch.')
const source = await readFile(
  new URL('../node_modules/signalsmith-stretch/SignalsmithStretch.mjs', import.meta.url),
  'utf8',
)
const encoded = source.match(/base64,([A-Za-z0-9+/=]+)/)?.[1]
if (!encoded) throw new Error('Upstream embedded WASM not found.')
const bytes = Buffer.from(encoded, 'base64')
const checksum = createHash('sha256').update(bytes).digest('hex')
if (checksum !== '83869197b3c5ebf9fc8c517a1586aef1ecf77404842218d62b9c0e82882d8ca3')
  throw new Error('Unexpected upstream binary. Audit it before changing the checksum.')
const module = await WebAssembly.compile(bytes)
const exports = WebAssembly.Module.exports(module)
  .map((e) => e.name)
  .join(',')
const imports = WebAssembly.Module.imports(module)
  .map((e) => `${e.module}.${e.name}`)
  .join(',')
if (exports !== 'e,f,g,h,i,j,k,l,m,n,o,p,q,r,s,t,u,v,w,x,y' || imports !== 'a.a,a.b,a.c,a.d')
  throw new Error(`Unexpected ABI: ${imports} / ${exports}`)
const dir = new URL('../src/audio/vendor/', import.meta.url)
await mkdir(dir, { recursive: true })
await writeFile(new URL('signalsmith-stretch.wasm', dir), bytes)
console.log(`Signalsmith Stretch ${pkg.version}: ${bytes.length} bytes, SHA256 ${checksum}`)
