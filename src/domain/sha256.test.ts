import { describe, expect, it } from 'vitest'
import { Sha256, sha256Hex } from './sha256'

const bytes = (value: string) => new TextEncoder().encode(value)

describe('Sha256', () => {
  it('matches standard vectors', () => {
    expect(sha256Hex(bytes(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex(bytes('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('supports incremental chunks', () => {
    const hash = new Sha256().update(bytes('mini')).update(bytes('gba')).hex()
    expect(hash).toBe(sha256Hex(bytes('minigba')))
  })
})
