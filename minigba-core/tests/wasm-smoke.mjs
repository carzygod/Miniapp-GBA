import { readFile } from 'node:fs/promises'
import process from 'node:process'
import assert from 'node:assert/strict'

const path = process.argv[2]
if (!path) throw new Error('usage: node wasm-smoke.mjs <module.wasm>')
const stage = process.argv[3] ?? 'full'
const bytes = await readFile(path)
let memory
const imports = {
  env: { emscripten_notify_memory_growth: () => undefined },
  wasi_snapshot_preview1: {
    clock_time_get: (_clock, _precision, ptr) => {
      new DataView(memory.buffer).setBigUint64(ptr, BigInt(Date.now()) * 1_000_000n, true)
      return 0
    },
    fd_write: (_fd, iov, count, written) => {
      const view = new DataView(memory.buffer)
      let consumed = 0
      for (let index = 0; index < count; index += 1) {
        consumed = (consumed + view.getUint32(iov + index * 8 + 4, true)) >>> 0
      }
      view.setUint32(written, consumed, true)
      return 0
    },
    fd_close: () => 0,
    environ_sizes_get: (count, size) => {
      const view = new DataView(memory.buffer)
      view.setUint32(count, 0, true)
      view.setUint32(size, 0, true)
      return 0
    },
    environ_get: () => 0,
  },
}
const { instance } = await WebAssembly.instantiate(bytes, imports)
const core = instance.exports
memory = core.memory
stopAfter('instantiate')
core._initialize()
stopAfter('initialize')
assert.equal(core.mgba_wx_abi_version(), 1)
assert.equal(core.mgba_wx_create(0, 0), 0)
stopAfter('create')

const romSize = 256 * 1024
const romPtr = core.mgba_wx_alloc(romSize, 16)
assert.ok(romPtr)
const rom = new Uint8Array(memory.buffer, romPtr, romSize)
// Branch over the GBA header to a stable ARM loop at 0xC0.
rom.set([0x2e, 0x00, 0x00, 0xea], 0)
rom.set(new TextEncoder().encode('MINIGBA TEST'), 0xa0)
rom.set(new TextEncoder().encode('MGTE'), 0xac)
rom[0xb2] = 0x96
rom.set([0xfe, 0xff, 0xff, 0xea], 0xc0)
rom[0xbd] = headerChecksum(rom)
assert.equal(core.mgba_wx_load_rom(romPtr, romSize), 0, lastError(core, memory))
stopAfter('load')
assert.equal(core.mgba_wx_run_frame(), 0, lastError(core, memory))
stopAfter('frame')

const infoPtr = core.mgba_wx_alloc(32, 8)
assert.equal(core.mgba_wx_video_info(infoPtr, 32), 0)
const info = new DataView(memory.buffer, infoPtr, 32)
assert.equal(info.getUint32(4, true), 240)
assert.equal(info.getUint32(8, true), 160)
assert.equal(info.getBigUint64(24, true), 1n)
const pixels = new Uint8Array(memory.buffer, info.getUint32(0, true), 240 * 160 * 4)
assert.ok(pixels.some(value => value !== 0))
stopAfter('video')

const stateSize = core.mgba_wx_state_max_size()
assert.ok(stateSize > 0)
stopAfter('state-size')
const statePtr = core.mgba_wx_alloc(stateSize, 16)
const writtenPtr = core.mgba_wx_alloc(4, 4)
assert.equal(core.mgba_wx_state_write(statePtr, stateSize, writtenPtr), 0, lastError(core, memory))
assert.equal(new DataView(memory.buffer, writtenPtr, 4).getUint32(0, true), stateSize)
stopAfter('state-write')
assert.equal(core.mgba_wx_state_read(statePtr, stateSize), 0, lastError(core, memory))
stopAfter('state-read')

core.mgba_wx_destroy()
console.log(JSON.stringify({ abi: 1, frame: 1, width: 240, height: 160, stateSize }))

function lastError(core, memory) {
  const ptr = core.mgba_wx_last_error_ptr(), length = core.mgba_wx_last_error_len()
  return new TextDecoder().decode(new Uint8Array(memory.buffer, ptr, length))
}

function headerChecksum(rom) {
  let sum = 0
  for (let offset = 0xa0; offset <= 0xbc; offset += 1) sum = (sum + rom[offset]) & 0xff
  return (-sum - 0x19) & 0xff
}

function stopAfter(completedStage) {
  if (stage !== completedStage) return
  console.log(JSON.stringify({ stage: completedStage, ok: true }))
  process.exit(0)
}
