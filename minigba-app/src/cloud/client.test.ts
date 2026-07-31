import {beforeEach,describe,expect,it,vi} from 'vitest'

const state=vi.hoisted(()=>({
  storage:new Map<string,unknown>(),
  request:vi.fn(),
  login:vi.fn(async()=>({code:'wechat-code'})),
  setScope:vi.fn(),
}))
vi.hoisted(()=>{(globalThis as Record<string,unknown>).__MINIGBA_API_BASE_URL__='https://api.test.invalid/'})
vi.mock('@tarojs/taro',()=>({default:{
  getStorageSync:(key:string)=>state.storage.get(key),
  setStorageSync:(key:string,value:unknown)=>state.storage.set(key,value),
  removeStorageSync:(key:string)=>state.storage.delete(key),
  request:state.request,
  login:state.login,
}}))
vi.mock('../settings',()=>({setSettingsAccountScope:state.setScope}))

import type {CloudSaveHead,SaveManifest} from '../domain/models'
import {CloudClient,CloudConflictError,CloudRequestError} from './client'

const romId='a'.repeat(64)
const manifest:SaveManifest={schemaVersion:1,romId,kind:'battery',slot:'current',checksum:'b'.repeat(64),sizeBytes:3,coreBuildId:'core-1',localRevision:2,cloudRevision:7,updatedAt:'2026-07-28T00:00:00.000Z'}

beforeEach(()=>{state.storage.clear();state.request.mockReset();state.login.mockClear();state.setScope.mockReset()})

describe('CloudClient session handling',()=>{
  it('stores the token and scopes settings to the internal user UUID',async()=>{
    state.request.mockResolvedValue({statusCode:200,data:{accessToken:'token-1',userId:'223e4567-e89b-42d3-a456-426614174000'}})
    await new CloudClient().login('Test Device')
    expect(state.storage.get('minigba.accessToken')).toBe('token-1')
    expect(state.setScope).toHaveBeenCalledWith('223e4567-e89b-42d3-a456-426614174000')
    const request=state.request.mock.calls[0]![0]
    expect(request).toMatchObject({url:'https://api.test.invalid/v1/auth/wechat/login',method:'POST',data:{code:'wechat-code',deviceName:'Test Device'}})
    expect(request.data.clientDeviceId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('clears a revoked session and returns to anonymous settings',async()=>{
    state.storage.set('minigba.accessToken','expired')
    state.request.mockResolvedValue({statusCode:401,data:{}})
    await new CloudClient().refresh()
    expect(state.storage.has('minigba.accessToken')).toBe(false)
    expect(state.setScope).toHaveBeenCalledWith()
  })

  it('refreshes both the token and the account scope',async()=>{
    state.storage.set('minigba.accessToken','old-token')
    state.request.mockResolvedValue({statusCode:200,data:{accessToken:'new-token',userId:'223e4567-e89b-42d3-a456-426614174000'}})
    await new CloudClient().refresh()
    expect(state.storage.get('minigba.accessToken')).toBe('new-token')
    expect(state.setScope).toHaveBeenCalledWith('223e4567-e89b-42d3-a456-426614174000')
  })
})

describe('CloudClient save transport',()=>{
  beforeEach(()=>state.storage.set('minigba.accessToken','token-1'))

  it('reads exact binary length and version headers',async()=>{
    const bytes=Uint8Array.from([1,2,3])
    state.request.mockResolvedValue({statusCode:200,data:bytes.buffer,header:{'content-length':'3','x-revision':'8','x-content-sha256':'c'.repeat(64),'x-core-build-id':'core-2'}})
    const result=await new CloudClient().download(romId,'battery','current')
    expect([...result.bytes]).toEqual([1,2,3])
    expect(result).toMatchObject({sizeBytes:3,revision:8,checksum:'c'.repeat(64),coreBuildId:'core-2'})
  })

  it('rejects a truncated response as a terminal validation error',async()=>{
    const bytes=Uint8Array.from([1,2,3])
    state.request.mockResolvedValue({statusCode:200,data:bytes.buffer,header:{'Content-Length':'4'}})
    const error=await new CloudClient().download(romId,'battery','current').catch(value=>value)
    expect(error).toBeInstanceOf(CloudRequestError)
    expect(error).toMatchObject({statusCode:422,terminal:true})
  })

  it('turns revision conflicts into a structured conflict error',async()=>{
    const current:CloudSaveHead={romId,kind:'battery',slot:'current',currentRevision:9,checksum:'d'.repeat(64),sizeBytes:3,coreBuildId:'core-2',updatedAt:'2026-07-28T00:00:00.000Z'}
    state.request.mockResolvedValue({statusCode:409,data:{error:{code:'SAVE_CONFLICT',details:current}}})
    const error=await new CloudClient().upload(manifest,Uint8Array.from([1,2,3]),'123e4567-e89b-42d3-a456-426614174000').catch(value=>value)
    expect(error).toBeInstanceOf(CloudConflictError)
    expect(error.current).toEqual(current)
  })
})
