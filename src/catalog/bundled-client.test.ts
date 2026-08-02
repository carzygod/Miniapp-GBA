import {expect,it,vi} from 'vitest'

const state=vi.hoisted(()=>({request:vi.fn()}))
vi.hoisted(()=>{
  const globals=globalThis as Record<string,unknown>
  globals.__MINIGBA_ROM_CATALOG_URL__='https://rom.sid.mom/catalog/v2/roms.json'
  globals.__MINIGBA_ROM_CATALOG_REMOTE_ENABLED__='false'
  globals.__MINIGBA_ROM_DOWNLOAD_HOSTS__='rom.sid.mom'
})
vi.mock('@tarojs/taro',()=>({default:{getStorageSync:()=>undefined,setStorageSync:vi.fn(),removeStorageSync:vi.fn(),request:state.request}}))

import {RomCatalogClient} from './client'

it('uses all bundled R2 entries without requesting an unpublished remote catalog',async()=>{
  const snapshot=await new RomCatalogClient().list({force:true})
  expect(snapshot.catalog.items).toHaveLength(981)
  expect(snapshot.catalog.items[0]).toMatchObject({objectKey:'gba/007 - Everything or Nothing (USA, Europe) (En,Fr,De).gba'})
  expect(state.request).not.toHaveBeenCalled()
})
