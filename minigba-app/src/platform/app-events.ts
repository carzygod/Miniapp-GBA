import Taro from '@tarojs/taro'

type AudioInterruptionApi={
  onAudioInterruptionBegin?:(callback:()=>void)=>void
  offAudioInterruptionBegin?:(callback:()=>void)=>void
}

export function listenForAudioInterruption(callback:()=>void):()=>void{
  const api=Taro as unknown as AudioInterruptionApi
  if(typeof api.onAudioInterruptionBegin!=='function')return()=>undefined
  api.onAudioInterruptionBegin(callback)
  return()=>{if(typeof api.offAudioInterruptionBegin==='function')api.offAudioInterruptionBegin(callback)}
}
