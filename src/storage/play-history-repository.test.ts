import {beforeEach,describe,expect,it,vi} from 'vitest'

const memory=vi.hoisted(()=>new Map<string,string>())
vi.mock('../platform/fs',()=>({
  dataRoot:'/data',ensureDirectory:async()=>undefined,exists:async(path:string)=>memory.has(path),readText:async(path:string)=>{const value=memory.get(path);if(value===undefined)throw new Error('missing');return value},writeTextAtomic:async(path:string,value:string)=>{memory.set(path,value)},
}))

import type {PlaySession} from '../domain/models'
import {PlayHistoryRepository} from './play-history-repository'

const romId='b'.repeat(64)
const session=(id:string,durationSeconds=60):PlaySession=>({id,romId,startedAt:'2026-08-01T00:00:00.000Z',endedAt:'2026-08-01T00:01:00.000Z',durationSeconds,exitReason:'paused'})

describe('PlayHistoryRepository',()=>{
  beforeEach(()=>memory.clear())
  it('upserts a running session without duplicating it',async()=>{
    const repository=new PlayHistoryRepository(),id='123e4567-e89b-42d3-a456-426614174000'
    await repository.upsert(session(id));await repository.upsert({...session(id,90),exitReason:'exit'})
    expect(await repository.list()).toEqual([{...session(id,90),exitReason:'exit'}])
  })
  it('filters and removes records by game',async()=>{
    const repository=new PlayHistoryRepository(),first=session('123e4567-e89b-42d3-a456-426614174001'),second={...session('123e4567-e89b-42d3-a456-426614174002'),romId:'c'.repeat(64)}
    await repository.upsert(first);await repository.upsert(second);await repository.clear(romId)
    expect(await repository.list()).toEqual([second])
  })
  it('recovers from a malformed index',async()=>{
    memory.set('/data/play-history.json','{"schemaVersion":1,"sessions":"bad"}')
    expect(await new PlayHistoryRepository().list()).toEqual([])
  })
  it('uses the previous valid index when current JSON is corrupt',async()=>{
    const previous=session('123e4567-e89b-42d3-a456-426614174003')
    memory.set('/data/play-history.json','{broken')
    memory.set('/data/play-history.json.previous',JSON.stringify({schemaVersion:1,sessions:[previous]}))
    expect(await new PlayHistoryRepository().list()).toEqual([previous])
  })
})
