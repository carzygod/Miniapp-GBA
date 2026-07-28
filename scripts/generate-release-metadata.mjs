import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const [wasmPath, sbomPath, metadataPath] = process.argv.slice(2)
if (!wasmPath || !sbomPath || !metadataPath) {
  throw new Error('usage: generate-release-metadata.mjs <wasm> <sbom> <metadata>')
}

const wasm = await readFile(wasmPath)
const versions = parseEnv(await readFile(new URL('../toolchains/versions.env', import.meta.url), 'utf8'))
const digest = createHash('sha256').update(wasm).digest('hex')
const serial = `urn:uuid:${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`

const metadata = {
  schemaVersion: 1,
  abiVersion: 1,
  buildId: 'mgba-0.10.5-0.1.0',
  wasm: { file: 'minigba-core.wasm', sizeBytes: wasm.length, sha256: digest },
  upstream: { name: 'mGBA', version: versions.MGBA_VERSION, commit: versions.MGBA_COMMIT },
  toolchain: { emscriptenVersion: versions.EMSDK_VERSION, emsdkCommit: versions.EMSDK_COMMIT },
  configuration: {
    gbaOnly: true, singleThreaded: true, filesystem: false,
    optionalDependencies: ['zlib', 'libpng', 'libzip', 'sqlite3', 'ffmpeg', 'lua'].map(name => ({ name, enabled: false })),
  },
}

const sbom = {
  bomFormat: 'CycloneDX', specVersion: '1.5', serialNumber: serial, version: 1,
  metadata: {
    component: {
      type: 'application', name: 'minigba-core', version: '0.1.0',
      hashes: [{ alg: 'SHA-256', content: digest }],
      licenses: [{ license: { id: 'Apache-2.0' } }],
    },
  },
  components: [
    {
      type: 'library', name: 'mGBA', version: versions.MGBA_VERSION,
      'bom-ref': `git:mgba@${versions.MGBA_COMMIT}`,
      licenses: [{ license: { id: 'MPL-2.0' } }],
      externalReferences: [{ type: 'vcs', url: `https://github.com/mgba-emu/mgba/tree/${versions.MGBA_COMMIT}` }],
    },
    {
      type: 'framework', name: 'Emscripten', version: versions.EMSDK_VERSION,
      'bom-ref': `git:emsdk@${versions.EMSDK_COMMIT}`, scope: 'excluded',
      licenses: [{ license: { id: 'MIT' } }],
      properties: [{ name: 'minigba:usage', value: 'build-toolchain-only' }],
    },
  ],
}

await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`)
await writeFile(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`)
console.log(JSON.stringify({ wasmBytes: wasm.length, wasmSha256: digest, components: sbom.components.length }))

function parseEnv(source) {
  return Object.fromEntries(source.split(/\r?\n/).filter(Boolean).map(line => line.split('=', 2)))
}
