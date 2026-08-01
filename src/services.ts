import { LibraryRepository } from './storage/library-repository'
import { PlayHistoryRepository } from './storage/play-history-repository'
import { SaveRepository } from './storage/save-repository'
import { SyncQueue } from './storage/sync-queue'

export const libraryRepository=new LibraryRepository()
export const playHistoryRepository=new PlayHistoryRepository()
export const saveRepository=new SaveRepository()
export const syncQueue=new SyncQueue()
