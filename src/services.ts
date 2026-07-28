import { LibraryRepository } from './storage/library-repository'
import { SaveRepository } from './storage/save-repository'
import { SyncQueue } from './storage/sync-queue'

export const libraryRepository=new LibraryRepository()
export const saveRepository=new SaveRepository()
export const syncQueue=new SyncQueue()

