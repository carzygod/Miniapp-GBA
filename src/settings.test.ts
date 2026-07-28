import {beforeEach,describe,expect,it,vi} from 'vitest'

const storage=new Map<string,unknown>()
vi.mock('@tarojs/taro',()=>({default:{getStorageSync:(key:string)=>storage.get(key),setStorageSync:(key:string,value:unknown)=>storage.set(key,value),removeStorageSync:(key:string)=>storage.delete(key)}}))
import {activeScope,loadSettings,saveSettings,setSettingsAccountScope} from './settings'

beforeEach(()=>storage.clear())

describe('account-scoped settings',()=>{
  it('keeps anonymous and account preferences separate',()=>{const anonymous={...loadSettings(),volume:25};saveSettings(anonymous);setSettingsAccountScope('123e4567-e89b-12d3-a456-426614174000');expect(activeScope()).not.toBe('anonymous');expect(loadSettings().volume).toBe(100);saveSettings({...loadSettings(),volume:70});setSettingsAccountScope();expect(loadSettings().volume).toBe(25)})
  it('clamps corrupted numeric settings',()=>{storage.set('minigba.settings.v2.anonymous',{volume:900,controlOpacity:-2,fastForward:9});const settings=loadSettings();expect(settings.volume).toBe(100);expect(settings.controlOpacity).toBe(40);expect(settings.fastForward).toBe(1)})
})
