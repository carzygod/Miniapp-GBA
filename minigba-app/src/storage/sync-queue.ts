import type { CloudSaveHead,SyncTask } from '../domain/models'
import { activeScope } from '../settings'
import { dataRoot, ensureDirectory, exists, readText, writeTextAtomic } from '../platform/fs'

const queueRoot=`${dataRoot}/sync-queues`

export class SyncQueue {
  async list():Promise<SyncTask[]>{
    const current=queuePath()
    for(const path of [current,`${current}.previous`]){
      if(!(await exists(path)))continue
      try{const parsed=JSON.parse(await readText(path)) as unknown;if(Array.isArray(parsed))return parsed.filter(isSyncTask)}catch{continue}
    }
    return[]
  }
  async enqueue(task:SyncTask):Promise<void>{
    if(!isSyncTask(task))throw new Error('同步任务无效')
    const tasks=await this.list();const index=tasks.findIndex(item=>item.romId===task.romId&&item.kind===task.kind&&item.slot===task.slot)
    if(index>=0){const current=tasks[index];if(current&&current.localRevision>task.localRevision)return;tasks[index]=task}else tasks.push(task)
    await this.save(tasks)
  }
  async complete(id:string):Promise<void>{await this.save((await this.list()).filter(task=>task.id!==id))}
  async find(id:string):Promise<SyncTask|undefined>{return(await this.list()).find(task=>task.id===id)}
  async markConflict(id:string,current:CloudSaveHead):Promise<void>{const tasks=await this.list();const task=tasks.find(item=>item.id===id);if(task){task.conflict={...current,detectedAt:new Date().toISOString()};await this.save(tasks)}}
  async retry(id:string,error?:string):Promise<void>{const tasks=await this.list();const task=tasks.find(item=>item.id===id);if(task){task.conflict=undefined;task.terminal=false;task.lastError=error?.slice(0,160);task.attempts++;const delay=Math.min(3600,2**task.attempts*5);task.nextAttemptAt=new Date(Date.now()+delay*1000).toISOString();await this.save(tasks)}}
  async fail(id:string,error:string):Promise<void>{const tasks=await this.list();const task=tasks.find(item=>item.id===id);if(task){task.terminal=true;task.lastError=error.slice(0,160);task.nextAttemptAt='9999-12-31T23:59:59.999Z';await this.save(tasks)}}
  async retryNow(id:string):Promise<void>{const tasks=await this.list();const task=tasks.find(item=>item.id===id);if(task){task.terminal=false;task.lastError=undefined;task.attempts=0;task.nextAttemptAt=new Date().toISOString();await this.save(tasks)}}
  async removeKey(romId:string,kind?:SyncTask['kind'],slot?:string):Promise<void>{await this.save((await this.list()).filter(task=>task.romId!==romId||(kind!==undefined&&task.kind!==kind)||(slot!==undefined&&task.slot!==slot)))}
  private async save(tasks:SyncTask[]):Promise<void>{await ensureDirectory(queueRoot);await writeTextAtomic(queuePath(),JSON.stringify(tasks))}
}

function queuePath():string{return`${queueRoot}/${activeScope()}.json`}

function isSyncTask(value:unknown):value is SyncTask{
  if(!value||typeof value!=='object')return false
  const task=value as Partial<SyncTask>
  return typeof task.id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(task.id)
    &&typeof task.romId==='string'&&/^[0-9a-f]{64}$/.test(task.romId)
    &&typeof task.kind==='string'&&['battery','state','auto_state'].includes(task.kind)
    &&typeof task.slot==='string'&&/^[a-z0-9][a-z0-9_-]{0,31}$/.test(task.slot)
    &&Number.isSafeInteger(task.localRevision)&&Number(task.localRevision)>=0
    &&Number.isSafeInteger(task.cloudRevision)&&Number(task.cloudRevision)>=0
    &&typeof task.checksum==='string'&&/^[0-9a-f]{64}$/.test(task.checksum)
    &&typeof task.path==='string'&&task.path.startsWith(`${dataRoot}/saves/${task.romId}/`)
    &&Number.isSafeInteger(task.attempts)&&Number(task.attempts)>=0
    &&typeof task.nextAttemptAt==='string'&&Number.isFinite(Date.parse(task.nextAttemptAt))
    &&typeof task.createdAt==='string'&&Number.isFinite(Date.parse(task.createdAt))
}
