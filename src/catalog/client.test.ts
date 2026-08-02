import {beforeEach,describe,expect,it,vi} from 'vitest'

const state=vi.hoisted(()=>({storage:new Map<string,unknown>(),request:vi.fn()}))
vi.hoisted(()=>{
  const globals=globalThis as Record<string,unknown>
  globals.__MINIGBA_ROM_CATALOG_URL__='https://roms.test.invalid/catalog/v2/roms.json'
  globals.__MINIGBA_ROM_DOWNLOAD_HOSTS__='roms.test.invalid'
})
vi.mock('@tarojs/taro',()=>({default:{
  getStorageSync:(key:string)=>state.storage.get(key),setStorageSync:(key:string,value:unknown)=>state.storage.set(key,value),removeStorageSync:(key:string)=>state.storage.delete(key),request:state.request,
}}))

import {parseRomCatalog,RomCatalogClient} from './client'

const catalog=()=>({schemaVersion:2,generatedAt:'2026-08-01T00:00:00.000Z',bucket:'rom',items:[{id:'open-adventure-v1',title:'Open Adventure',objectKey:'gba/open-adventure.gba',etag:'r2-object-version',gameCode:'OPEN',downloadUrl:'../../gba/open-adventure.gba',sizeBytes:262144,description:'A redistributable homebrew adventure.',genres:['冒险'],region:'World',language:'中文',featured:true,license:{name:'CC BY 4.0',url:'https://example.invalid/license'}}]})

describe('R2 ROM catalog',()=>{
  beforeEach(()=>{state.storage.clear();state.request.mockReset()})
  it('resolves relative R2 objects and preserves optional distribution metadata',()=>{
    const result=parseRomCatalog(catalog(),'https://roms.test.invalid/catalog/v2/roms.json')
    expect(result.items[0]).toMatchObject({id:'open-adventure-v1',objectKey:'gba/open-adventure.gba',downloadUrl:'https://roms.test.invalid/gba/open-adventure.gba',featured:true,license:{name:'CC BY 4.0'}})
  })
  it('accepts R2 entries without a predeclared digest or license',()=>{
    const item=Object.fromEntries(Object.entries(catalog().items[0]!).filter(([key])=>key!=='license'))
    const input={...catalog(),items:[item]}
    expect(parseRomCatalog(input,'https://roms.test.invalid/catalog/v2/roms.json').items[0]).toMatchObject({id:'open-adventure-v1',etag:'r2-object-version'})
  })
  it('rejects duplicate catalog IDs and hosts outside the release allowlist',()=>{
    const duplicate=catalog();duplicate.items.push({...duplicate.items[0]!})
    expect(()=>parseRomCatalog(duplicate,'https://roms.test.invalid/catalog/v2/roms.json')).toThrow('重复')
    const wrong=catalog();wrong.items[0]!.downloadUrl='https://roms.test.invalid.evil.example/game.gba'
    expect(()=>parseRomCatalog(wrong,'https://roms.test.invalid/catalog/v2/roms.json')).toThrow('白名单')
  })
  it('rejects duplicate object keys and download URLs that do not match the key',()=>{
    const duplicate=catalog();duplicate.items.push({...duplicate.items[0]!,id:'another-release'})
    expect(()=>parseRomCatalog(duplicate,'https://roms.test.invalid/catalog/v2/roms.json')).toThrow('对象键')
    const mismatch=catalog();mismatch.items[0]!.downloadUrl='../../gba/another-game.gba'
    expect(()=>parseRomCatalog(mismatch,'https://roms.test.invalid/catalog/v2/roms.json')).toThrow('不一致')
  })
  it('falls back to a validated cached catalog after a network failure',async()=>{
    state.request.mockResolvedValueOnce({statusCode:200,data:catalog()})
    const client=new RomCatalogClient(),fresh=await client.list({force:true})
    expect(fresh.stale).toBe(false)
    state.request.mockRejectedValueOnce(new Error('offline'))
    const cached=await client.list({force:true})
    expect(cached.stale).toBe(true);expect(cached.catalog.items).toHaveLength(1)
  })
})
