import {afterEach,describe,expect,it} from 'vitest'
import {AudioOutput} from './audio-output'

const originalWx=(globalThis as unknown as {wx?:unknown}).wx

afterEach(()=>{(globalThis as unknown as {wx?:unknown}).wx=originalWx})

describe('AudioOutput',()=>{
  it('applies volume and records underruns without blocking',async()=>{
    let callback:((event:{outputBuffer:{getChannelData(index:number):Float32Array}})=>void)|undefined
    let processorSize=0
    ;(globalThis as unknown as {wx?:unknown}).wx={createWebAudioContext:()=>({destination:{},state:'suspended',createScriptProcessor:(size:number)=>{processorSize=size;return{set onaudioprocess(value:typeof callback){callback=value},connect:()=>undefined,disconnect:()=>undefined}},resume:async()=>undefined,suspend:async()=>undefined,close:async()=>undefined})}
    const output=new AudioOutput({mode:'low_latency',volume:.5})
    expect(await output.start()).toBe(true);expect(processorSize).toBe(1024)
    output.push(Int16Array.from([16384,-16384]))
    const left=new Float32Array(2),right=new Float32Array(2)
    callback!({outputBuffer:{getChannelData:index=>index?right:left}})
    expect(left[0]).toBeCloseTo(.25);expect(right[0]).toBeCloseTo(-.25)
    expect(output.stats.underruns).toBe(1)
  })

  it('bounds queued audio and records overflow',()=>{
    const output=new AudioOutput({mode:'low_latency'})
    for(let index=0;index<10;index++)output.push(Int16Array.from([index,index]))
    expect(output.stats.queuedChunks).toBe(8)
    expect(output.stats.overflows).toBe(2)
  })
})
