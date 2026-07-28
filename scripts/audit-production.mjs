import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const expiresAt = '2026-10-31T23:59:59Z'
const allowed = new Set([
  '@babel/core', '@tarojs/components', '@tarojs/helper',
  '@tarojs/plugin-framework-react', '@tarojs/plugin-platform-weapp',
  '@tarojs/runner-utils', '@tarojs/service', '@tarojs/taro',
  'brace-expansion', 'esbuild', 'glob', 'globs', 'minimatch', 'rimraf',
  'scss-bundle', 'sockjs', 'swiper', 'uuid', 'webpack',
  'webpack-dev-server',
])

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(npm, ['audit', '--omit=dev', '--json'], {
  encoding: 'utf8', shell: process.platform === 'win32',
})
if (!result.stdout) throw new Error(`npm audit did not return JSON: ${result.stderr?.trim() ?? result.error ?? 'unknown error'}`)

let report
try { report = JSON.parse(result.stdout) }
catch { throw new Error('npm audit returned invalid JSON') }

mkdirSync('artifacts/reports', { recursive: true })
writeFileSync('artifacts/reports/npm-audit.json', `${JSON.stringify(report, null, 2)}\n`)

if (Date.now() > Date.parse(expiresAt)) {
  throw new Error(`security exception expired at ${expiresAt}`)
}
const found = Object.keys(report.vulnerabilities ?? {})
const unexpected = found.filter(name => !allowed.has(name))
if (unexpected.length) {
  throw new Error(`unreviewed production dependency findings: ${unexpected.join(', ')}`)
}

const counts = report.metadata?.vulnerabilities ?? {}
console.log(JSON.stringify({ audited: true, expiresAt, findings: found.length, counts }))
