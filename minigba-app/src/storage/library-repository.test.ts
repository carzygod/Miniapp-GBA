import {beforeEach,describe,expect,it,vi} from 'vitest'

const state=vi.hoisted(()=>({
  memory:new Map<string,Uint8Array|string>(),
  storage:new Map<string,unknown>(),
  files:[] as Array<{path:string;size:number;modifiedAt:number}>,
  moves:[] as Array<{source:string;target:string}>,
  platform:'weapp' as 'weapp'|'tt',
  downloadFile:vi.fn(),
  showModal:vi.fn(async()=>({confirm:true,cancel:false})),
}))

vi.hoisted(()=>{(globalThis as Record<string,unknown>).__MINIGBA_ROM_DOWNLOAD_HOSTS__='roms.test.invalid'})
vi.mock('@tarojs/taro',()=>({default:{
  env:{USER_DATA_PATH:'/data'},
  getStorageSync:(key:string)=>state.storage.get(key),
  setStorageSync:(key:string,value:unknown)=>state.storage.set(key,value),
  downloadFile:state.downloadFile,
  showModal:state.showModal,
}}))
vi.mock('../platform/capabilities',()=>({currentPlatform:()=>state.platform}))
vi.mock('../platform/fs',()=>({
  dataRoot:'/data',
  ensureDirectory:async()=>undefined,
  exists:async(path:string)=>state.memory.has(path),
  fileSize:async(path:string)=>{const value=state.memory.get(path);if(!(value instanceof Uint8Array))throw new Error('missing binary');return value.length},
  listFilesRecursive:async()=>state.files.map(file=>({...file})),
  moveFile:async(source:string,target:string)=>{const value=state.memory.get(source);if(value===undefined)throw new Error('missing source');state.memory.delete(source);state.memory.set(target,value);state.moves.push({source,target})},
  readBytes:async(path:string)=>{const value=state.memory.get(path);if(!(value instanceof Uint8Array))throw new Error('missing binary');return value.slice()},
  readText:async(path:string)=>{const value=state.memory.get(path);if(typeof value!=='string')throw new Error('missing text');return value},
  unlinkIfExists:async(path:string)=>{state.memory.delete(path)},
  writeBytesAtomic:async(path:string,value:Uint8Array)=>{state.memory.set(path,value.slice())},
  writeTextAtomic:async(path:string,value:string)=>{state.memory.set(path,value)},
}))

import {zipSync} from 'fflate'
import {sha256Hex} from '../domain/sha256'
import {extractSingleGbaZip,hasNintendoLogo,headerChecksumValid,LibraryRepository,parseHeader,validateGba} from './library-repository'

const logo='24ffae51699aa2213d84820a84e409ad11248b98c0817f21a352be199309ce2010464a4af82731ec58c7e83382e3cebf85f4df94ce4b09c194568ac01372a7fc9f844d73a3ca9a615897a327fc039876231dc7610304ae56bf38840040a70efdff52fe036f9530f197fbc08560d68025a963be03014e38e2f9a234ffbb3e0344780090cb88113a9465c07c6387f03cafd625e48b380aac7221d4f807'
const fromHex=(value:string)=>Uint8Array.from(value.match(/../g)!.map(byte=>Number.parseInt(byte,16)))
const fixture=()=>{const rom=new Uint8Array(256*1024);for(let index=0;index<rom.length;index++)rom[index]=(index*73+index%251)&0xff;rom.set([0x2e,0,0,0xea]);rom.set(fromHex(logo),4);rom.set(new TextEncoder().encode('TEST GAME   '),0xa0);rom.set(new TextEncoder().encode('TGME'),0xac);rom[0xb2]=0x96;let checksum=0;for(let index=0xa0;index<=0xbc;index++)checksum=(checksum-rom[index]!-1)&0xff;rom[0xbd]=checksum;return rom}

beforeEach(()=>{
  state.memory.clear();state.storage.clear();state.files=[];state.moves=[]
  state.platform='weapp'
  state.storage.set('minigba.romCopyrightConsent.v1',{version:1})
  state.downloadFile.mockReset();state.showModal.mockClear()
})

describe('GBA header validation',()=>{
  it('recognizes a complete logo and parses identity fields',()=>{const rom=fixture();expect(()=>validateGba(rom)).not.toThrow();expect(hasNintendoLogo(rom)).toBe(true);expect(headerChecksumValid(rom)).toBe(true);expect(parseHeader(rom)).toEqual({title:'TEST GAME',gameCode:'TGME'})})
  it('rejects a file without the fixed GBA header byte',()=>{const rom=fixture();rom[0xb2]=0;expect(()=>validateGba(rom)).toThrow('GBA ROM')})
})

describe('safe ZIP import',()=>{
  it('extracts exactly one bounded GBA file',()=>{const result=extractSingleGbaZip(zipSync({'folder/game.gba':fixture()}));expect(result.fileName).toBe('game.gba');expect(result.bytes).toEqual(fixture())})
  it('rejects path traversal and ambiguous archives',()=>{expect(()=>extractSingleGbaZip(zipSync({'../game.gba':fixture()}))).toThrow('不安全路径');expect(()=>extractSingleGbaZip(zipSync({'a.gba':fixture(),'b.gba':fixture()}))).toThrow('多个')})
})

describe('authorized HTTPS import',()=>{
  it('checks the allowlist and exact length before storing with a local content ID',async()=>{
    const rom=fixture(),digest=sha256Hex(rom),temporary='/tmp/download.gba'
    state.memory.set(temporary,rom)
    state.downloadFile.mockResolvedValue({statusCode:200,tempFilePath:temporary,dataLength:rom.length})
    const entry=await new LibraryRepository().importAuthorizedDownload('https://roms.test.invalid/releases/game.gba',rom.length,'Authorized Demo')
    expect(entry).toMatchObject({romId:digest,title:'TEST GAME',source:'authorized-download',fileName:'Authorized Demo.gba'})
    expect(state.memory.has(`/data/roms/${digest.slice(0,2)}/${digest.slice(2,4)}/${digest}.gba`)).toBe(true)
  })

  it('rejects hostname lookalikes and declared length mismatches',async()=>{
    const repository=new LibraryRepository(),rom=fixture(),temporary='/tmp/download.gba'
    await expect(repository.importAuthorizedDownload('https://roms.test.invalid.evil.example/game.gba',rom.length)).rejects.toThrow('白名单')
    expect(state.downloadFile).not.toHaveBeenCalled()
    state.memory.set(temporary,rom);state.downloadFile.mockResolvedValue({statusCode:200,tempFilePath:temporary,dataLength:rom.length})
    await expect(repository.importAuthorizedDownload('https://roms.test.invalid/game.gba',rom.length+1)).rejects.toThrow('长度')
  })

  it('stores validated R2 catalog metadata with the local ROM',async()=>{
    const rom=fixture(),romId=sha256Hex(rom),temporary='/tmp/catalog.gba'
    state.memory.set(temporary,rom);state.downloadFile.mockResolvedValue({statusCode:200,tempFilePath:temporary,dataLength:rom.length})
    const repository=new LibraryRepository()
    const entry=await repository.importCatalogItem({id:'catalog-title-v1',title:'Catalog Title',objectKey:'gba/catalog.gba',etag:'not-a-sha256',gameCode:'CAT1',downloadUrl:'https://roms.test.invalid/gba/catalog.gba',sizeBytes:rom.length,description:'Authorized catalog entry',genres:['Homebrew'],region:'World',language:'中文',coverUrl:'https://roms.test.invalid/covers/catalog.webp',featured:true,updatedAt:'2026-08-01T00:00:00.000Z',license:{name:'CC BY 4.0'}})
    expect(entry).toMatchObject({romId,title:'Catalog Title',gameCode:'CAT1',source:'r2-catalog',catalogId:'catalog-title-v1',catalogObjectKey:'gba/catalog.gba',catalogEtag:'not-a-sha256',description:'Authorized catalog entry',genres:['Homebrew'],licenseName:'CC BY 4.0'})
    await expect(repository.getByCatalogId('catalog-title-v1')).resolves.toMatchObject({romId,catalogObjectKey:'gba/catalog.gba'})
  })

  it('keeps Douyin catalog ROMs in temporary storage and downloads them again after eviction',async()=>{
    state.platform='tt'
    const rom=fixture(),romId=sha256Hex(rom),first='/tmp/catalog-first.gba',second='/tmp/catalog-second.gba'
    state.memory.set(first,rom);state.downloadFile.mockResolvedValue({statusCode:200,tempFilePath:first,dataLength:rom.length})
    const repository=new LibraryRepository(),url='https://roms.test.invalid/gba/catalog.gba'
    const entry=await repository.importCatalogItem({id:'catalog-title-v1',title:'Catalog Title',objectKey:'gba/catalog.gba',downloadUrl:url,sizeBytes:rom.length,genres:[],featured:false})
    expect(entry).toMatchObject({romId,localPath:first,remoteDownloadUrl:url})
    expect([...state.memory.keys()].some(path=>path.startsWith('/data/roms/'))).toBe(false)

    state.memory.delete(first);state.memory.set(second,rom)
    state.downloadFile.mockResolvedValue({statusCode:200,tempFilePath:second,dataLength:rom.length})
    await expect(repository.prepareForPlay(romId)).resolves.toMatchObject({romId,localPath:second})
    expect(state.downloadFile).toHaveBeenCalledTimes(2)
  })
})

describe('library repair',()=>{
  it('recovers valid orphan ROMs, removes missing entries and quarantines invalid files',async()=>{
    const rom=fixture(),valid='/data/roms/legacy.gba',invalid='/data/roms/broken.gba'
    state.memory.set(valid,rom);state.memory.set(invalid,new Uint8Array(32))
    state.memory.set('/data/library.json',JSON.stringify({schemaVersion:2,games:[{romId:'f'.repeat(64),title:'Missing',fileName:'missing.gba',localPath:'/data/roms/missing.gba',sizeBytes:256,importedAt:'2026-01-01T00:00:00.000Z',playTimeSeconds:0,batterySave:false,cloudState:'disabled',source:'recovered'}]}))
    state.files=[{path:valid,size:rom.length,modifiedAt:1_700_000_000},{path:invalid,size:32,modifiedAt:1_700_000_000}]
    const repository=new LibraryRepository(),result=await repository.repairLibrary(),games=await repository.list()
    expect(result).toEqual({added:1,removed:1,quarantined:1})
    expect(games).toHaveLength(1)
    expect(games[0]).toMatchObject({romId:sha256Hex(rom),source:'recovered',importedAt:'2023-11-14T22:13:20.000Z'})
    expect(state.moves.some(move=>move.target.includes('/quarantine/'))).toBe(true)
  })

  it('preserves an on-demand ROM entry when its temporary file has expired',async()=>{
    const romId='f'.repeat(64),remoteDownloadUrl='https://roms.test.invalid/gba/remote.gba'
    state.memory.set('/data/library.json',JSON.stringify({schemaVersion:2,games:[{romId,title:'Remote',fileName:'remote.gba',localPath:'/tmp/expired.gba',sizeBytes:256,importedAt:'2026-01-01T00:00:00.000Z',playTimeSeconds:0,batterySave:false,cloudState:'disabled',source:'r2-catalog',remoteDownloadUrl}]}))
    const repository=new LibraryRepository(),result=await repository.repairLibrary()
    expect(result).toEqual({added:0,removed:0,quarantined:0})
    await expect(repository.list()).resolves.toEqual([expect.objectContaining({romId,remoteDownloadUrl})])
  })
})
