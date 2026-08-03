import {beforeEach,describe,expect,it,vi} from 'vitest'
import type {CloudSaveHead,SaveManifest,SyncTask} from '../domain/models'

const state=vi.hoisted(()=>({
  settings:{cloudSync:true,cloudStateSync:true},scope:'223e4567-e89b-42d3-a456-426614174000',loggedIn:true,configured:true,
  tasks:[] as SyncTask[],stored:undefined as unknown,
  completed:[] as string[],retried:[] as string[],failed:[] as string[],conflicts:[] as string[],
  updates:[] as number[],cloudStates:[] as string[],
  upload:vi.fn(),download:vi.fn(),
}))

vi.mock('@tarojs/taro',()=>({default:{}}))
vi.mock('../settings',()=>({activeScope:()=>state.scope,loadSettings:()=>state.settings}))
vi.mock('../services',()=>({
  saveRepository:{
    contentPath:()=>'/save/current.bin',
    load:async()=>state.stored,
    updateCloudRevision:async(_romId:string,_kind:string,_slot:string,revision:number)=>{state.updates.push(revision);return (state.stored as {manifest:Record<string,unknown>}).manifest},
    commit:vi.fn(),storeConflictCopy:vi.fn(),
  },
  syncQueue:{
    list:async()=>state.tasks,
    enqueue:async(task:SyncTask)=>{state.tasks.push(task)},
    complete:async(id:string)=>{state.completed.push(id);state.tasks=state.tasks.filter(task=>task.id!==id)},
    find:async(id:string)=>state.tasks.find(task=>task.id===id),
    markConflict:async(id:string)=>{state.conflicts.push(id)},
    retry:async(id:string)=>{state.retried.push(id)},
    fail:async(id:string)=>{state.failed.push(id)},retryNow:vi.fn(),
  },
  libraryRepository:{
    setCloudState:async(_romId:string,value:string)=>{state.cloudStates.push(value)},
    setSaveState:vi.fn(),
  },
}))
vi.mock('./client',()=>{
  class CloudConflictError extends Error{constructor(readonly current:Record<string,unknown>){super('conflict')}}
  class CloudRequestError extends Error{constructor(readonly statusCode:number,message:string){super(message)}get terminal(){return[400,401,403,404,413,422].includes(this.statusCode)}}
  return{CloudConflictError,CloudRequestError,cloudClient:{isLoggedIn:()=>state.loggedIn,canSync:()=>state.configured&&state.loggedIn,upload:state.upload,download:state.download}}
})

import {sha256Hex} from '../domain/sha256'
import {CloudConflictError,CloudRequestError} from './client'
import {SyncService} from './sync-service'

const romId='a'.repeat(64),bytes=Uint8Array.from([1,2,3]),checksum=sha256Hex(bytes)
const manifest:SaveManifest={schemaVersion:1,romId,kind:'battery',slot:'current',checksum,sizeBytes:bytes.length,coreBuildId:'core-1',localRevision:2,cloudRevision:7,updatedAt:'2026-07-28T00:00:00.000Z'}
const task=():SyncTask=>({id:'123e4567-e89b-42d3-a456-426614174000',romId,kind:'battery',slot:'current',localRevision:2,cloudRevision:7,checksum,path:'/save/current.bin',attempts:0,nextAttemptAt:'2020-01-01T00:00:00.000Z',createdAt:'2020-01-01T00:00:00.000Z'})
const head=(value:string):CloudSaveHead=>({romId,kind:'battery',slot:'current',currentRevision:9,checksum:value,sizeBytes:bytes.length,coreBuildId:'core-2',updatedAt:'2026-07-28T00:00:00.000Z'})

beforeEach(()=>{
  state.settings={cloudSync:true,cloudStateSync:true};state.scope='223e4567-e89b-42d3-a456-426614174000';state.loggedIn=true;state.configured=true;state.tasks=[task()]
  state.stored={manifest:{...manifest},bytes:bytes.slice(),path:'/save/current.bin'}
  state.completed=[];state.retried=[];state.failed=[];state.conflicts=[];state.updates=[];state.cloudStates=[]
  state.upload.mockReset();state.download.mockReset()
})

describe('SyncService queue processing',()=>{
  it('serializes exclusive operations in FIFO order',async()=>{
    const service=new SyncService(),events:string[]=[]
    let releaseFirst!:()=>void
    const gate=new Promise<void>(resolve=>{releaseFirst=resolve})
    const first=service.exclusive(async()=>{events.push('first-start');await gate;events.push('first-end')})
    const second=service.exclusive(async()=>{events.push('second')})
    await Promise.resolve()
    expect(events).toEqual(['first-start'])
    releaseFirst()
    await Promise.all([first,second])
    expect(events).toEqual(['first-start','first-end','second'])
  })

  it('never processes a queue without an authenticated account scope',async()=>{
    state.scope='anonymous';state.upload.mockResolvedValue({revision:8,checksum})
    await new SyncService().runDue()
    expect(state.upload).not.toHaveBeenCalled();expect(state.completed).toEqual([])
  })

  it('never processes a queue when the cloud API is not configured',async()=>{
    state.configured=false;state.upload.mockResolvedValue({revision:8,checksum})
    await new SyncService().runDue()
    expect(state.upload).not.toHaveBeenCalled();expect(state.completed).toEqual([])
  })

  it('commits a successful cloud revision and completes the task',async()=>{
    state.upload.mockResolvedValue({revision:8,checksum})
    await new SyncService().runDue()
    expect(state.updates).toEqual([8]);expect(state.completed).toEqual([task().id]);expect(state.cloudStates).toEqual(['synced'])
  })

  it('treats an identical remote conflict as an idempotent success',async()=>{
    state.upload.mockRejectedValue(new CloudConflictError(head(checksum)))
    await new SyncService().runDue()
    expect(state.updates).toEqual([9]);expect(state.completed).toEqual([task().id]);expect(state.conflicts).toEqual([])
  })

  it('persists a real conflict without retrying or overwriting',async()=>{
    state.upload.mockRejectedValue(new CloudConflictError(head('f'.repeat(64))))
    await new SyncService().runDue()
    expect(state.conflicts).toEqual([task().id]);expect(state.completed).toEqual([]);expect(state.cloudStates).toEqual(['conflict'])
  })

  it('separates terminal client errors from retryable server errors',async()=>{
    state.upload.mockRejectedValueOnce(new CloudRequestError(413,'too large'))
    await new SyncService().runDue()
    expect(state.failed).toEqual([task().id]);expect(state.retried).toEqual([])
    state.failed=[];state.cloudStates=[];state.upload.mockRejectedValueOnce(new CloudRequestError(503,'unavailable'))
    await new SyncService().runDue()
    expect(state.retried).toEqual([task().id]);expect(state.failed).toEqual([]);expect(state.cloudStates).toEqual(['error'])
  })
})
