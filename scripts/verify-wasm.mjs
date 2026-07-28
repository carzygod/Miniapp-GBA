import { readFile } from 'node:fs/promises'
import process from 'node:process'

const path = process.argv[2]
if (!path) throw new Error('usage: node verify-wasm.mjs <module.wasm>')

const bytes = await readFile(path)
if (!WebAssembly.validate(bytes)) throw new Error('invalid WebAssembly module')
const module = await WebAssembly.compile(bytes)
const imports = WebAssembly.Module.imports(module)
const exports = new Set(WebAssembly.Module.exports(module).map(({ name }) => name))

const required = [
  'memory', '_initialize', 'mgba_wx_abi_version', 'mgba_wx_create', 'mgba_wx_load_rom',
  'mgba_wx_run_frame', 'mgba_wx_video_info', 'mgba_wx_audio_read',
  'mgba_wx_set_key_mask', 'mgba_wx_save_info', 'mgba_wx_copy_save',
  'mgba_wx_state_write', 'mgba_wx_state_read', 'mgba_wx_destroy',
]
for (const name of required) {
  if (!exports.has(name)) throw new Error(`missing export: ${name}`)
}

const allowedImports = new Set([
  'env.emscripten_notify_memory_growth',
  'wasi_snapshot_preview1.clock_time_get',
  'wasi_snapshot_preview1.fd_write',
  'wasi_snapshot_preview1.fd_close',
  'wasi_snapshot_preview1.environ_sizes_get',
  'wasi_snapshot_preview1.environ_get',
])
for (const entry of imports) {
  const qualified = `${entry.module}.${entry.name}`
  if (!allowedImports.has(qualified) || /pthread|thread/i.test(qualified)) {
    throw new Error(`forbidden import: ${qualified}`)
  }
}

const text = new TextDecoder('latin1').decode(bytes)
for (const marker of ['SDL', 'IDBFS', 'WebGL', 'pthread_create']) {
  if (text.includes(marker)) throw new Error(`forbidden runtime marker: ${marker}`)
}

console.log(JSON.stringify({ bytes: bytes.length, imports, exports: [...exports].sort() }, null, 2))
