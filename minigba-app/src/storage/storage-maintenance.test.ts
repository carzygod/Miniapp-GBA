import {describe,expect,it,vi} from 'vitest'

vi.mock('../platform/fs',()=>({dataRoot:'/data',listFilesRecursive:async()=>[],removeDirectoryIfExists:async()=>undefined,unlinkIfExists:async()=>undefined}))
import {classifyStorage} from './storage-maintenance'

describe('storage classification',()=>{
  it('separates durable data from disposable files',()=>{const usage=classifyStorage([
    {path:'/data/roms/a.gba',size:10,modifiedAt:0},{path:'/data/saves/a/battery/current.bin',size:20,modifiedAt:0},{path:'/data/saves/a/state/0/current.bin',size:30,modifiedAt:0},{path:'/data/play-history.json',size:7,modifiedAt:0},{path:'/data/screenshots/a.png',size:40,modifiedAt:0},{path:'/data/tmp/upload.part',size:50,modifiedAt:0},{path:'/data/quarantine/bad',size:60,modifiedAt:0},
  ]);expect(usage).toMatchObject({roms:10,batterySaves:20,stateSaves:30,playHistory:7,screenshots:40,temporary:50,quarantine:60,total:217})})
})
