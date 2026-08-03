import {beforeEach,describe,expect,it,vi} from 'vitest'

const storage=new Map<string,unknown>()
vi.mock('@tarojs/taro',()=>({default:{getStorageSync:(key:string)=>storage.get(key),setStorageSync:(key:string,value:unknown)=>storage.set(key,value),getDeviceInfo:()=>({platform:'ios',system:'iOS 18',model:'Phone',benchmarkLevel:42}),getAppBaseInfo:()=>({SDKVersion:'3.15.2'})}}))

import {buildDiagnosticPackage,clockMovedBackwards,recordDiagnosticError,sanitizeText} from './diagnostics'

beforeEach(()=>storage.clear())

describe('diagnostics redaction',()=>{
  it('removes tokens, local paths, hashes and UUIDs',()=>{const text=sanitizeText('Bearer secret.token wxfile://user/a 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef 123e4567-e89b-12d3-a456-426614174000');expect(text).not.toContain('secret.token');expect(text).not.toContain('wxfile');expect(text).not.toContain('0123456789abcdef');expect(text).not.toContain('123e4567')})
  it('exports only bounded sanitized errors',()=>{recordDiagnosticError('CORE','Bearer abc wxfile://user/private');const value=buildDiagnosticPackage();expect(value.recentErrors).toHaveLength(1);expect(JSON.stringify(value)).not.toContain('private')})
  it('uses the non-deprecated split system APIs',()=>{const value=buildDiagnosticPackage();expect(value.baseLibraryVersion).toBe('3.15.2');expect(value.device).toMatchObject({platform:'ios',benchmarkLevel:42})})
  it('detects a wall clock rollback over five minutes',()=>{expect(clockMovedBackwards('rom',1_000_000)).toBe(false);expect(clockMovedBackwards('rom',600_000)).toBe(true)})
})
