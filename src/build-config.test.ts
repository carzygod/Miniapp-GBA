import {describe,expect,it} from 'vitest'
import {DEFAULT_ROM_DOWNLOAD_HOSTS,resolveRomDownloadHosts} from '../config/rom-download-hosts'

describe('ROM download host build defaults',()=>{
  it('uses the audited bundled catalog host when no local environment is present',()=>{
    expect(resolveRomDownloadHosts(undefined)).toBe(DEFAULT_ROM_DOWNLOAD_HOSTS)
    expect(resolveRomDownloadHosts('')).toBe(DEFAULT_ROM_DOWNLOAD_HOSTS)
    expect(DEFAULT_ROM_DOWNLOAD_HOSTS).toBe('rom.sid.mom')
  })

  it('preserves an explicit release allowlist',()=>{
    expect(resolveRomDownloadHosts(' rom.sid.mom,mirror.example.com ')).toBe('rom.sid.mom,mirror.example.com')
  })
})
