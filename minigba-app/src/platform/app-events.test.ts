import {beforeEach,describe,expect,it,vi} from 'vitest'

const state=vi.hoisted(()=>({api:{} as Record<string,unknown>}))
vi.mock('@tarojs/taro',()=>({default:state.api}))

import {listenForAudioInterruption} from './app-events'

beforeEach(()=>{for(const key of Object.keys(state.api))delete state.api[key]})

describe('audio interruption lifecycle',()=>{
  it('is a no-op when the host does not implement the WeChat event',()=>{
    const callback=vi.fn(),dispose=listenForAudioInterruption(callback)
    expect(dispose).toBeTypeOf('function')
    expect(()=>dispose()).not.toThrow()
  })

  it('subscribes and unsubscribes when both host methods are available',()=>{
    const on=vi.fn(),off=vi.fn(),callback=vi.fn()
    state.api.onAudioInterruptionBegin=on;state.api.offAudioInterruptionBegin=off
    const dispose=listenForAudioInterruption(callback)
    expect(on).toHaveBeenCalledWith(callback)
    dispose();expect(off).toHaveBeenCalledWith(callback)
  })
})
