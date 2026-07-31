import {beforeEach,describe,expect,it,vi} from 'vitest'

const memory=vi.hoisted(()=>new Map<string,Uint8Array|string>())
vi.mock('../platform/fs',()=>({
  dataRoot:'/data',
  ensureDirectory:async()=>undefined,
  exists:async(path:string)=>memory.has(path),
  listDirectory:async()=>[],
  readBytes:async(path:string)=>{const value=memory.get(path);if(!(value instanceof Uint8Array))throw new Error('missing binary');return value.slice()},
  readText:async(path:string)=>{const value=memory.get(path);if(typeof value!=='string')throw new Error('missing text');return value},
  unlinkIfExists:async(path:string)=>{memory.delete(path)},
  writeBytesAtomic:async(path:string,value:Uint8Array)=>{if(memory.has(path))memory.set(`${path}.previous`,(memory.get(path) as Uint8Array).slice());memory.set(path,value.slice())},
  writeTextAtomic:async(path:string,value:string)=>{if(memory.has(path))memory.set(`${path}.previous`,memory.get(path) as string);memory.set(path,value)},
}))

import {SaveRepository} from './save-repository'

const romId='a'.repeat(64)
describe('SaveRepository',()=>{
  beforeEach(()=>memory.clear())
  it('retains the cloud revision across local commits',async()=>{
    const repository=new SaveRepository()
    const first=await repository.commit(romId,'battery','current',new Uint8Array([1,2,3]),'core',7)
    const second=await repository.commit(romId,'battery','current',new Uint8Array([4,5,6]),'core')
    expect(first.cloudRevision).toBe(7)
    expect(second.cloudRevision).toBe(7)
    expect(second.localRevision).toBe(2)
  })
  it('recovers the previous bytes when current content is corrupt',async()=>{
    const repository=new SaveRepository()
    await repository.commit(romId,'battery','current',new Uint8Array([1,2,3]),'core')
    await repository.commit(romId,'battery','current',new Uint8Array([4,5,6]),'core')
    memory.set(`/data/saves/${romId}/battery/current/current.bin`,new Uint8Array([9]))
    const restored=await repository.load(romId,'battery','current')
    expect([...restored!.bytes]).toEqual([1,2,3])
    expect(restored!.path.endsWith('.previous')).toBe(true)
  })
  it('enforces canonical slots',async()=>{
    const repository=new SaveRepository()
    await expect(repository.commit(romId,'battery','slot1',new Uint8Array([1]),'core')).rejects.toThrow('current')
  })
})
