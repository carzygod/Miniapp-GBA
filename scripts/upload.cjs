'use strict'

const path = require('node:path')
const fs = require('node:fs')
const ci = require('miniprogram-ci')

const required = name => {
  const value = String(process.env[name] || '').trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

const appid = required('MINIGBA_WECHAT_APP_ID')
const configuredAppID = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'project.config.json'), 'utf8')).appid
if (appid !== configuredAppID) throw new Error('MINIGBA_WECHAT_APP_ID does not match project.config.json')

const project = new ci.Project({
  appid,
  type: 'miniProgram',
  projectPath: path.resolve(__dirname, '..'),
  privateKeyPath: path.resolve(required('MINIGBA_MINIPROGRAM_PRIVATE_KEY')),
  ignores: ['node_modules/**/*', 'src/**/*', 'coverage/**/*'],
})

ci.upload({
  project,
  version: required('MINIGBA_RELEASE_VERSION'),
  desc: String(process.env.MINIGBA_RELEASE_DESCRIPTION || 'MiniGBA release').slice(0, 100),
  robot: Number(process.env.MINIGBA_CI_ROBOT || 1),
  threads: 2,
  setting: { useProjectConfig: true },
  onProgressUpdate: progress => process.stdout.write(`${JSON.stringify(progress)}\n`),
}).then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
  process.stderr.write(`${error.stack || error}\n`)
  process.exitCode = 1
})
