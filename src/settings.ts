import Taro from '@tarojs/taro'

export type VideoScaling = 'sharp' | 'smooth'
export type AudioBufferMode = 'low_latency' | 'stable'
export type ControlPreset = 'right_handed' | 'left_handed' | 'landscape'
export type FastForwardRate = 1 | 2 | 3 | 4

export interface AppSettings {
  sound: boolean
  volume: number
  audioBufferMode: AudioBufferMode
  videoScaling: VideoScaling
  fastForward: FastForwardRate
  autoFrameSkip: boolean
  haptics: boolean
  controlPreset: ControlPreset
  controlScale: number
  controlSpacing: number
  controlOpacity: number
  autoState: boolean
  cloudSync: boolean
  cloudStateSync: boolean
  showFps: boolean
}

const activeScopeKey = 'minigba.settings.activeScope.v1'
const legacyKey = 'minigba.settings.v1'
const accountIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
export const defaultSettings: AppSettings = {
  sound: true,
  volume: 100,
  audioBufferMode: 'stable',
  videoScaling: 'sharp',
  fastForward: 1,
  autoFrameSkip: false,
  haptics: true,
  controlPreset: 'right_handed',
  controlScale: 100,
  controlSpacing: 100,
  controlOpacity: 90,
  autoState: true,
  cloudSync: false,
  cloudStateSync: false,
  showFps: false,
}

export function loadSettings(): AppSettings {
  const scoped = Taro.getStorageSync<Partial<AppSettings>>(settingsKey())
  const legacy = activeScope() === 'anonymous' ? Taro.getStorageSync<Partial<AppSettings>>(legacyKey) : undefined
  return normalizeSettings(scoped || legacy || {})
}

export function saveSettings(value: AppSettings): void {
  Taro.setStorageSync(settingsKey(), normalizeSettings(value))
}

export function resetSettings(): AppSettings {
  const reset = { ...defaultSettings }
  saveSettings(reset)
  return reset
}

export function setSettingsAccountScope(accountId?: string): void {
  if (accountId && accountIdPattern.test(accountId)) Taro.setStorageSync(activeScopeKey, accountId)
  else Taro.removeStorageSync(activeScopeKey)
}

export function activeScope(): string {
  const stored=Taro.getStorageSync<string>(activeScopeKey)
  return stored&&accountIdPattern.test(stored)?stored:'anonymous'
}

function settingsKey(): string { return `minigba.settings.v2.${activeScope()}` }

function normalizeSettings(input: Partial<AppSettings>): AppSettings {
  const result = { ...defaultSettings, ...input }
  result.volume = clampNumber(result.volume, 0, 100, 100)
  result.controlScale = clampNumber(result.controlScale, 80, 120, 100)
  result.controlSpacing = clampNumber(result.controlSpacing, 80, 120, 100)
  result.controlOpacity = clampNumber(result.controlOpacity, 40, 100, 90)
  if (!['sharp', 'smooth'].includes(result.videoScaling)) result.videoScaling = 'sharp'
  if (!['low_latency', 'stable'].includes(result.audioBufferMode)) result.audioBufferMode = 'stable'
  if (![1, 2, 3, 4].includes(result.fastForward)) result.fastForward = 1
  if (!['right_handed', 'left_handed', 'landscape'].includes(result.controlPreset)) result.controlPreset = 'right_handed'
  return result
}

function clampNumber(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, Math.round(value))) : fallback
}
