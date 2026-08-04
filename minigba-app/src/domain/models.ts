export const LIBRARY_SCHEMA_VERSION = 2 as const
export const SAVE_SCHEMA_VERSION = 1 as const
export const ROM_CATALOG_SCHEMA_VERSION = 2 as const
export const PLAY_HISTORY_SCHEMA_VERSION = 1 as const

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
  source?: 'wechat-message-file' | 'authorized-download' | 'r2-catalog' | 'zip' | 'recovered'
  coverUrl?: string
  description?: string
  genres?: string[]
  region?: string
  language?: string
  licenseName?: string
  catalogId?: string
  catalogObjectKey?: string
  catalogEtag?: string
  catalogUpdatedAt?: string
  remoteDownloadUrl?: string
  lastSyncedAt?: string
  syncError?: string
}

export interface RomCatalogLicense {
  name: string
  url?: string
  notice?: string
}

export interface RomCatalogItem {
  id: string
  title: string
  objectKey: string
  etag?: string
  gameCode?: string
  downloadUrl: string
  sizeBytes: number
  description?: string
  genres: string[]
  region?: string
  language?: string
  coverUrl?: string
  featured: boolean
  updatedAt?: string
  license?: RomCatalogLicense
}

export interface RomCatalog {
  schemaVersion: typeof ROM_CATALOG_SCHEMA_VERSION
  generatedAt: string
  bucket: string
  items: RomCatalogItem[]
}

export type PlaySessionExitReason = 'paused' | 'background' | 'exit' | 'error'

export interface PlaySession {
  id: string
  romId: string
  startedAt: string
  endedAt: string
  durationSeconds: number
  exitReason: PlaySessionExitReason
}

export interface PlayHistoryIndex {
  schemaVersion: typeof PLAY_HISTORY_SCHEMA_VERSION
  sessions: PlaySession[]
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
