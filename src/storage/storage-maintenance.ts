import {dataRoot,listFilesRecursive,removeDirectoryIfExists,unlinkIfExists,type FileEntry} from '../platform/fs'

export interface StorageUsage {
  roms: number
  batterySaves: number
  stateSaves: number
  playHistory: number
  screenshots: number
  temporary: number
  quarantine: number
  other: number
  total: number
}

export async function calculateStorageUsage():Promise<StorageUsage>{
  const files=await listFilesRecursive(dataRoot)
  return classifyStorage(files)
}

export function classifyStorage(files:FileEntry[]):StorageUsage{
  const result:StorageUsage={roms:0,batterySaves:0,stateSaves:0,playHistory:0,screenshots:0,temporary:0,quarantine:0,other:0,total:0}
  for(const file of files){
    result.total+=file.size
    const path=file.path.replace(/\\/g,'/')
    if(path.includes('/tmp/')||path.includes('/exports/')||/\.tmp-[^/]+$/.test(path)){result.temporary+=file.size;continue}
    if(path.includes('/quarantine/')){result.quarantine+=file.size;continue}
    if(path.includes('/screenshots/')){result.screenshots+=file.size;continue}
    if(path.includes('/roms/')){result.roms+=file.size;continue}
    if(path.endsWith('/play-history.json')||path.endsWith('/play-history.json.previous')){result.playHistory+=file.size;continue}
    if(path.includes('/saves/')&&path.includes('/battery/')){result.batterySaves+=file.size;continue}
    if(path.includes('/saves/')&&(path.includes('/state/')||path.includes('/auto_state/'))){result.stateSaves+=file.size;continue}
    result.other+=file.size
  }
  return result
}

export async function clearTemporaryFiles():Promise<void>{
  for(const file of await listFilesRecursive(dataRoot))if(isTemporary(file.path))await unlinkIfExists(file.path)
  await removeDirectoryIfExists(`${dataRoot}/tmp`)
  await removeDirectoryIfExists(`${dataRoot}/exports`)
}

export async function cleanupStaleTemporaryFiles(now=Date.now()):Promise<number>{
  let removed=0
  for(const file of await listFilesRecursive(dataRoot)){
    const modified=file.modifiedAt<1_000_000_000_000?file.modifiedAt*1000:file.modifiedAt
    if(isTemporary(file.path)&&now-modified>24*60*60*1000){await unlinkIfExists(file.path);removed++}
  }
  return removed
}

export async function clearScreenshots():Promise<void>{await removeDirectoryIfExists(`${dataRoot}/screenshots`)}
export async function clearQuarantine():Promise<void>{await removeDirectoryIfExists(`${dataRoot}/quarantine`)}

function isTemporary(path:string):boolean{
  const normalized=path.replace(/\\/g,'/')
  return normalized.includes('/tmp/')||normalized.includes('/exports/')||/\.tmp-[^/]+$/.test(normalized)
}
