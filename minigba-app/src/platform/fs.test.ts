import {beforeEach,describe,expect,it,vi} from 'vitest'

type Operation=(options:Record<string,unknown>)=>void
const state=vi.hoisted(()=>({manager:{} as Record<string,Operation>}))

vi.mock('@tarojs/taro',()=>({default:{
  env:{USER_DATA_PATH:'wxfile://usr'},
  getFileSystemManager:()=>state.manager,
}}))

import {ensureDirectory,listDirectory,readText,removeDirectoryIfExists,unlinkIfExists} from './fs'

beforeEach(()=>{state.manager={}})

describe('WeChat filesystem failure handling',()=>{
  it('treats a missing first-run directory as an empty directory',async()=>{
    state.manager.readdir=options=>(options.fail as (error:unknown)=>void)({errMsg:"readdir:fail no such file or directory, scandir 'wxfile://usr/minigba/saves'",errno:2})
    await expect(listDirectory('wxfile://usr/minigba/saves')).resolves.toEqual([])
  })

  it('makes missing-path cleanup idempotent',async()=>{
    const fail=(options:Record<string,unknown>)=>(options.fail as (error:unknown)=>void)({errMsg:'operation:fail ENOENT',code:'ENOENT'})
    state.manager.unlink=fail
    state.manager.rmdir=fail
    await expect(unlinkIfExists('wxfile://usr/missing')).resolves.toBeUndefined()
    await expect(removeDirectoryIfExists('wxfile://usr/missing')).resolves.toBeUndefined()
  })

  it('accepts an existing recursive data directory',async()=>{
    state.manager.mkdir=options=>(options.fail as (error:unknown)=>void)({errMsg:'mkdir:fail file already exists',errno:17})
    await expect(ensureDirectory('wxfile://usr/minigba')).resolves.toBeUndefined()
  })

  it('turns other WeChat failure objects into readable Errors',async()=>{
    state.manager.readFile=options=>(options.fail as (error:unknown)=>void)({errMsg:'readFile:fail permission denied',errno:13})
    await expect(readText('wxfile://usr/private')).rejects.toThrow('readFile:fail permission denied')
  })
})
