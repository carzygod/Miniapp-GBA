import type { CloudSaveHead,SyncTask } from '../domain/models'
import { dataRoot, ensureDirectory, exists, readText, writeTextAtomic } from '../platform/fs'

const queuePath=`${dataRoot}/sync-queue.json`

export class SyncQueue {
  async list():Promise<SyncTask[]>{if(!(await exists(queuePath)))return[];const parsed=JSON.parse(await readText(queuePath)) as SyncTask[];return Array.isArray(parsed)?parsed:[]}
  async enqueue(task:SyncTask):Promise<void>{
    const tasks=await this.list();const index=tasks.findIndex(item=>item.romId===task.romId&&item.kind===task.kind&&item.slot===task.slot)
    if(index>=0){const current=tasks[index];if(current&&current.localRevision>task.localRevision)return;tasks[index]=task}else tasks.push(task)
    await this.save(tasks)
  }
  async complete(id:string):Promise<void>{await this.save((await this.list()).filter(task=>task.id!==id))}
  async find(id:string):Promise<SyncTask|undefined>{return(await this.list()).find(task=>task.id===id)}
  async markConflict(id:string,current:CloudSaveHead):Promise<void>{const tasks=await this.list();const task=tasks.find(item=>item.id===id);if(task){task.conflict={...current,detectedAt:new Date().toISOString()};await this.save(tasks)}}
  async retry(id:string):Promise<void>{const tasks=await this.list();const task=tasks.find(item=>item.id===id);if(task){task.conflict=undefined;task.attempts++;const delay=Math.min(3600,2**task.attempts*5);task.nextAttemptAt=new Date(Date.now()+delay*1000).toISOString();await this.save(tasks)}}
  private async save(tasks:SyncTask[]):Promise<void>{await ensureDirectory(dataRoot);await writeTextAtomic(queuePath,JSON.stringify(tasks))}
}
