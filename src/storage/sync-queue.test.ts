import {beforeEach,describe,expect,it,vi} from 'vitest'

const memory=vi.hoisted(()=>new Map<string,string>())
vi.mock('../platform/fs',()=>({dataRoot:'/data',ensureDirectory:async()=>undefined,exists:async(path:string)=>memory.has(path),readText:async(path:string)=>memory.get(path)!,writeTextAtomic:async(path:string,value:string)=>{memory.set(path,value)}}))

import type {SyncTask} from '../domain/models'
import {SyncQueue} from './sync-queue'

const task=(revision:number):SyncTask=>({id:`id-${revision}`,romId:'b'.repeat(64),kind:'battery',slot:'current',localRevision:revision,cloudRevision:0,checksum:'c'.repeat(64),path:'/save',attempts:0,nextAttemptAt:new Date(0).toISOString(),createdAt:new Date(0).toISOString()})
describe('SyncQueue',()=>{
  beforeEach(()=>memory.clear())
  it('keeps only the latest task for one save key',async()=>{const queue=new SyncQueue();await queue.enqueue(task(1));await queue.enqueue(task(2));await queue.enqueue(task(1));expect((await queue.list()).map(item=>item.localRevision)).toEqual([2])})
  it('persists conflict metadata',async()=>{const queue=new SyncQueue();await queue.enqueue(task(1));await queue.markConflict('id-1',{romId:'b'.repeat(64),kind:'battery',slot:'current',currentRevision:3,checksum:'d'.repeat(64),sizeBytes:32,coreBuildId:'core',updatedAt:new Date().toISOString()});expect((await queue.find('id-1'))?.conflict?.currentRevision).toBe(3)})
})
