import {PLAY_HISTORY_SCHEMA_VERSION,type PlayHistoryIndex,type PlaySession} from '../domain/models'
import {dataRoot,ensureDirectory,exists,readText,writeTextAtomic} from '../platform/fs'

const historyPath=`${dataRoot}/play-history.json`
const maxSessions=500

export class PlayHistoryRepository{
  async list(romId?:string):Promise<PlaySession[]>{
    const sessions=(await this.load()).sessions
    return sessions.filter(session=>!romId||session.romId===romId).sort((a,b)=>b.endedAt.localeCompare(a.endedAt))
  }

  async upsert(session:PlaySession):Promise<void>{
    validateSession(session)
    const index=await this.load(),position=index.sessions.findIndex(item=>item.id===session.id)
    if(position>=0)index.sessions[position]=session;else index.sessions.push(session)
    index.sessions.sort((a,b)=>b.endedAt.localeCompare(a.endedAt));index.sessions=index.sessions.slice(0,maxSessions)
    await this.save(index)
  }

  async remove(id:string):Promise<void>{const index=await this.load();index.sessions=index.sessions.filter(item=>item.id!==id);await this.save(index)}
  async clear(romId?:string):Promise<void>{const index=await this.load();index.sessions=romId?index.sessions.filter(item=>item.romId!==romId):[];await this.save(index)}

  private async load():Promise<PlayHistoryIndex>{
    await ensureDirectory(dataRoot)
    for(const path of[historyPath,`${historyPath}.previous`]){
      if(!(await exists(path)))continue
      try{
        const parsed=JSON.parse(await readText(path)) as PlayHistoryIndex
        if(parsed.schemaVersion!==PLAY_HISTORY_SCHEMA_VERSION||!Array.isArray(parsed.sessions))continue
        const sessions=parsed.sessions.filter(validSession).sort((a,b)=>b.endedAt.localeCompare(a.endedAt)).slice(0,maxSessions)
        return{schemaVersion:PLAY_HISTORY_SCHEMA_VERSION,sessions}
      }catch{continue}
    }
    return{schemaVersion:PLAY_HISTORY_SCHEMA_VERSION,sessions:[]}
  }

  private save(index:PlayHistoryIndex):Promise<void>{return writeTextAtomic(historyPath,JSON.stringify(index))}
}

function validSession(value:unknown):value is PlaySession{
  if(!value||typeof value!=='object')return false
  const item=value as PlaySession
  return /^[0-9a-f-]{36}$/.test(item.id)&&/^[0-9a-f]{64}$/.test(item.romId)&&validDate(item.startedAt)&&validDate(item.endedAt)&&Number.isInteger(item.durationSeconds)&&item.durationSeconds>=0&&['paused','background','exit','error'].includes(item.exitReason)
}
function validateSession(value:PlaySession):void{if(!validSession(value))throw new Error('游玩记录无效')}
function validDate(value:string):boolean{return typeof value==='string'&&Number.isFinite(Date.parse(value))}
