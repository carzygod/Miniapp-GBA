import {beforeEach,describe,expect,it,vi} from 'vitest'

const state=vi.hoisted(()=>({memory:new Map<string,string>(),scope:'223e4567-e89b-42d3-a456-426614174000'}))
vi.mock('../settings',()=>({activeScope:()=>state.scope}))
vi.mock('../platform/fs',()=>({
  dataRoot:'/data',ensureDirectory:async()=>undefined,
  exists:async(path:string)=>state.memory.has(path),readText:async(path:string)=>state.memory.get(path)!,
  writeTextAtomic:async(path:string,value:string)=>{if(state.memory.has(path))state.memory.set(`${path}.previous`,state.memory.get(path)!);state.memory.set(path,value)},
}))

import type {SyncTask} from '../domain/models'
import {SyncQueue} from './sync-queue'

const romId='b'.repeat(64)
const task=(revision:number):SyncTask=>({id:`123e4567-e89b-42d3-a456-${String(revision).padStart(12,'0')}`,romId,kind:'battery',slot:'current',localRevision:revision,cloudRevision:0,checksum:'c'.repeat(64),path:`/data/saves/${romId}/battery/current/current.bin`,attempts:0,nextAttemptAt:new Date(0).toISOString(),createdAt:new Date(0).toISOString()})
describe('SyncQueue',()=>{
  beforeEach(()=>{state.memory.clear();state.scope='223e4567-e89b-42d3-a456-426614174000'})
  it('keeps only the latest task for one save key',async()=>{const queue=new SyncQueue();await queue.enqueue(task(1));await queue.enqueue(task(2));await queue.enqueue(task(1));expect((await queue.list()).map(item=>item.localRevision)).toEqual([2])})
  it('persists conflict metadata',async()=>{const queue=new SyncQueue();await queue.enqueue(task(1));await queue.markConflict(task(1).id,{romId,kind:'battery',slot:'current',currentRevision:3,checksum:'d'.repeat(64),sizeBytes:32,coreBuildId:'core',updatedAt:new Date().toISOString()});expect((await queue.find(task(1).id))?.conflict?.currentRevision).toBe(3)})
  it('persists terminal errors and permits an explicit retry',async()=>{const queue=new SyncQueue();await queue.enqueue(task(1));await queue.fail(task(1).id,'unauthorized');expect((await queue.find(task(1).id))?.terminal).toBe(true);await queue.retryNow(task(1).id);expect(await queue.find(task(1).id)).toMatchObject({terminal:false,attempts:0})})
  it('removes only tasks covered by a cloud deletion',async()=>{const queue=new SyncQueue();await queue.enqueue(task(1));await queue.enqueue({...task(2),kind:'state',slot:'0'});await queue.removeKey(romId,'battery','current');expect((await queue.list()).map(item=>item.kind)).toEqual(['state']);await queue.removeKey(romId);expect(await queue.list()).toEqual([])})
  it('isolates queues between account UUIDs',async()=>{const queue=new SyncQueue();await queue.enqueue(task(1));state.scope='323e4567-e89b-42d3-a456-426614174000';expect(await queue.list()).toEqual([]);await queue.enqueue(task(2));state.scope='223e4567-e89b-42d3-a456-426614174000';expect((await queue.list()).map(item=>item.localRevision)).toEqual([1])})
  it('recovers a valid previous queue and filters invalid tasks',async()=>{const path=`/data/sync-queues/${state.scope}.json`;state.memory.set(path,'{corrupt');state.memory.set(`${path}.previous`,JSON.stringify([task(1),{id:'invalid'}]));expect((await new SyncQueue().list()).map(item=>item.id)).toEqual([task(1).id])})
  it('rejects invalid tasks before persistence',async()=>{await expect(new SyncQueue().enqueue({...task(1),path:'/outside'})).rejects.toThrow('无效')})
})
