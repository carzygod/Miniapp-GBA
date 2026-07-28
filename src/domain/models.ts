export const LIBRARY_SCHEMA_VERSION = 2 as const
export const SAVE_SCHEMA_VERSION = 1 as const

export type CloudState = 'disabled' | 'pending' | 'synced' | 'conflict' | 'error'
export type SaveKind = 'battery' | 'state' | 'auto_state'

export interface GameEntry {
  romId: string
  title: string
  gameCode: string
  fileName: string
  localPath: string
  sizeBytes: number
  importedAt: string
  lastPlayedAt?: string
  playTimeSeconds: number
  batterySave: boolean
  cloudState: CloudState
  source?: 'wechat-message-file' | 'authorized-download' | 'zip' | 'recovered'
  lastSyncedAt?: string
  syncError?: string
}

export interface LibraryIndex {
  schemaVersion: typeof LIBRARY_SCHEMA_VERSION
  games: GameEntry[]
}

export interface SaveManifest {
  schemaVersion: typeof SAVE_SCHEMA_VERSION
  romId: string
  kind: SaveKind
  slot: string
  checksum: string
  sizeBytes: number
  coreBuildId: string
  localRevision: number
  cloudRevision: number
  updatedAt: string
}

export interface SyncTask {
  id: string
  romId: string
  kind: SaveKind
  slot: string
  localRevision: number
  cloudRevision: number
  checksum: string
  path: string
  attempts: number
  nextAttemptAt: string
  createdAt: string
  lastError?: string
  terminal?: boolean
  conflict?: CloudSaveHead & { detectedAt: string }
}

export interface CloudSaveHead {
  romId: string
  kind: SaveKind
  slot: string
  currentRevision: number
  checksum: string
  sizeBytes: number
  coreBuildId: string
  deviceName?: string
  updatedAt: string
}
