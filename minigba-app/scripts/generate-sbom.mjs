import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const lockBytes = readFileSync('package-lock.json')
const lock = JSON.parse(lockBytes)
const root = lock.packages?.[''] ?? {}
const digest = createHash('sha256').update(lockBytes).digest('hex')
const uuid = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`

const components = Object.entries(lock.packages ?? {})
  .filter(([path, info]) => path && info?.version)
  .map(([path, info]) => {
    const name = info.name ?? packageName(path)
    const component = {
      type: 'library',
      'bom-ref': `npm:${path}@${info.version}`,
      name,
      version: info.version,
      purl: `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(info.version)}`,
      properties: [
        { name: 'minigba:npm-path', value: path },
        { name: 'minigba:development', value: String(Boolean(info.dev)) },
        { name: 'minigba:optional', value: String(Boolean(info.optional)) },
      ],
    }
    if (info.license) component.licenses = [{ license: { id: info.license } }]
    if (info.resolved) component.externalReferences = [{ type: 'distribution', url: info.resolved }]
    return component
  })
  .sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref']))

const bom = {
  bomFormat: 'CycloneDX', specVersion: '1.5', serialNumber: `urn:uuid:${uuid}`,
  version: 1,
  metadata: {
    component: {
      type: 'application', name: root.name ?? 'minigba-weapp',
      version: root.version ?? '0.0.0',
      licenses: [{ license: { id: 'Apache-2.0' } }],
    },
    properties: [{ name: 'minigba:package-lock-sha256', value: digest }],
  },
  components,
}

mkdirSync('artifacts/reports', { recursive: true })
writeFileSync('artifacts/reports/sbom.cdx.json', `${JSON.stringify(bom, null, 2)}\n`)
const rows = ['name\tversion\tlicense\tdevelopment\tresolved']
for (const component of components) {
  rows.push([
    component.name, component.version, component.licenses?.[0]?.license?.id ?? 'UNKNOWN',
    component.properties[1].value, component.externalReferences?.[0]?.url ?? '',
  ].map(cell => String(cell).replaceAll('\t', ' ')).join('\t'))
}
writeFileSync('artifacts/reports/licenses.tsv', `${rows.join('\n')}\n`)
console.log(JSON.stringify({ components: components.length, lockSha256: digest }))

function packageName(path) {
  const marker = path.lastIndexOf('node_modules/')
  return path.slice(marker + 'node_modules/'.length)
}
