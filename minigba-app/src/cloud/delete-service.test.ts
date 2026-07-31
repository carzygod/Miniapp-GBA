import {beforeEach,describe,expect,it,vi} from 'vitest'
import type {SyncTask} from '../domain/models'

const state=vi.hoisted(()=>({
  tasks:[] as SyncTask[],events:[] as string[],deleteSave:vi.fn(),deleteROM:vi.fn(),
}))
vi.mock('../services',()=>({
  syncQueue:{
    list:async()=>state.tasks,
    removeKey:async()=>{state.events.push('queue-remove');state.tasks=[]},
    enqueue:async(task:SyncTask)=>{state.events.push('queue-restore');state.tasks.push(task)},
  },
  libraryRepository:{setCloudState:async()=>{state.events.push('library-disabled')}},
}))
vi.mock('./client',()=>({cloudClient:{
  deleteSave:async(...args:unknown[])=>{state.events.push('remote-delete-save');return state.deleteSave(...args)},
  deleteRomSaves:async(...args:unknown[])=>{state.events.push('remote-delete-rom');return state.deleteROM(...args)},
}}))
vi.mock('./sync-service',()=>({syncService:{exclusive:async<T>(operation:()=>Promise<T>)=>{state.events.push('lock-start');try{return await operation()}finally{state.events.push('lock-end')}}}}))

import {CloudDeleteService} from './delete-service'

const romId='a'.repeat(64)
const pending:SyncTask={id:'123e4567-e89b-42d3-a456-426614174000',romId,kind:'battery',slot:'current',localRevision:1,cloudRevision:0,checksum:'b'.repeat(64),path:`/data/saves/${romId}/battery/current/current.bin`,attempts:0,nextAttemptAt:'2026-07-28T00:00:00.000Z',createdAt:'2026-07-28T00:00:00.000Z'}

beforeEach(()=>{state.tasks=[{...pending}];state.events=[];state.deleteSave.mockReset();state.deleteROM.mockReset()})

describe('CloudDeleteService',()=>{
  it('removes the pending upload before deleting the remote slot under one lock',async()=>{
    state.deleteSave.mockResolvedValue(undefined)
    await new CloudDeleteService().deleteSave(romId,'battery','current')
    expect(state.events).toEqual(['lock-start','queue-remove','remote-delete-save','lock-end'])
    expect(state.tasks).toEqual([])
  })

  it('restores pending work when the remote deletion fails',async()=>{
    state.deleteSave.mockRejectedValue(new Error('network'))
    await expect(new CloudDeleteService().deleteSave(romId,'battery','current')).rejects.toThrow('network')
    expect(state.events).toEqual(['lock-start','queue-remove','remote-delete-save','queue-restore','lock-end'])
    expect(state.tasks).toEqual([pending])
  })

  it('marks a game local-only only after all remote saves are deleted',async()=>{
    state.deleteROM.mockResolvedValue(undefined)
    await new CloudDeleteService().deleteROM(romId)
    expect(state.events).toEqual(['lock-start','queue-remove','remote-delete-rom','library-disabled','lock-end'])
  })
})
