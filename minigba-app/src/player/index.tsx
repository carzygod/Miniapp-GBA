import Taro,{useDidHide,useRouter,useUnload} from '@tarojs/taro'
import {Button,Canvas,Text,View} from '@tarojs/components'
import {useCallback,useEffect,useRef,useState} from 'react'
import {VirtualControls} from '../components/VirtualControls'
import {InputBitmap} from '../emulator/input'
import {MgbaWxCore} from '../emulator/core-loader'
import {AudioOutput} from '../emulator/audio-output'
import {syncService} from '../cloud/sync-service'
import {clockMovedBackwards,recordDiagnosticError,recordRuntimeDiagnostics} from '../diagnostics'
import {loadSettings} from '../settings'
import {libraryRepository,playHistoryRepository,saveRepository} from '../services'
import {errorMessage} from '../platform/error'
import {dataRoot,readBytes,writeBytesAtomic} from '../platform/fs'
import type {GameEntry,PlaySessionExitReason,SaveKind} from '../domain/models'
import {PlaySessionTracker} from '../storage/play-session-tracker'
import './index.scss'

type Phase='loading'|'ready'|'running'|'paused'|'error'
const FRAME_MS=1000/59.7275
const AUTO_STATE_INTERVAL_MS=60_000

export default function PlayerPage(){
  const romId=useRouter().params.romId??''
  const settingsRef=useRef(loadSettings())
  const settings=settingsRef.current
  const[game,setGame]=useState<GameEntry>()
  const[phase,setPhase]=useState<Phase>('loading')
  const[message,setMessage]=useState('正在加载核心')
  const[fps,setFps]=useState(0)
  const gameRef=useRef<GameEntry>()
  const coreRef=useRef<MgbaWxCore>()
  const canvasRef=useRef<WechatCanvasNode>()
  const contextRef=useRef<WechatCanvasRenderingContext2D>()
  const imageRef=useRef<ImageData>()
  const animationRef=useRef<number>()
  const runningRef=useRef(false)
  const destroyedRef=useRef(false)
  const inputRef=useRef(new InputBitmap())
  const audioRef=useRef(new AudioOutput({volume:settings.volume/100,mode:settings.audioBufferMode}))
  const playSessionRef=useRef(new PlaySessionTracker(romId))
  const lastGeneration=useRef(0n)
  const saveTimer=useRef<ReturnType<typeof setTimeout>>()
  const lastAutoStateAt=useRef(Date.now())
  const autoStateInFlight=useRef(false)
  const frameTimesRef=useRef<number[]>([])
  const lastPresentedAt=useRef(0)
  const clockWarningShown=useRef(false)

  const clearInput=useCallback(()=>{inputRef.current.clear();coreRef.current?.setKeyMask(0)},[])

  const startPlayTracking=useCallback(()=>playSessionRef.current.start(),[])

  const checkpointPlay=useCallback(async(reason:PlaySessionExitReason)=>{
    const entry=gameRef.current,checkpoint=playSessionRef.current.checkpoint(reason)
    if(!entry||!checkpoint)return
    await playHistoryRepository.upsert(checkpoint.session)
    if(checkpoint.deltaSeconds>0)await libraryRepository.markPlayed(entry.romId,checkpoint.deltaSeconds)
  },[])

  const flushBattery=useCallback(async()=>{
    const core=coreRef.current,entry=gameRef.current
    if(!core||!entry)return
    const info=core.saveInfo()
    if(!info.sizeBytes||info.dirtyGeneration===lastGeneration.current)return
    const manifest=await saveRepository.commit(entry.romId,'battery','current',core.copyBatterySave(),core.buildId)
    lastGeneration.current=info.dirtyGeneration
    await libraryRepository.setSaveState(entry.romId,true,settingsRef.current.cloudSync?'pending':'disabled')
    if(settingsRef.current.cloudSync){await syncService.enqueue(manifest);syncService.runDue().catch(()=>undefined)}
  },[])

  const commitState=useCallback(async(kind:SaveKind,slot:string)=>{
    const core=coreRef.current,entry=gameRef.current
    if(!core||!entry)throw new Error('模拟器尚未就绪')
    const manifest=await saveRepository.commit(entry.romId,kind,slot,core.createState(),core.buildId)
    if(settingsRef.current.cloudSync&&settingsRef.current.cloudStateSync){await syncService.enqueue(manifest);syncService.runDue().catch(()=>undefined)}
    return manifest
  },[])

  const commitAutoState=useCallback(async()=>{
    if(!settingsRef.current.autoState||autoStateInFlight.current||!coreRef.current||!gameRef.current)return
    autoStateInFlight.current=true
    try{await commitState('auto_state','auto');lastAutoStateAt.current=Date.now()}
    finally{autoStateInFlight.current=false}
  },[commitState])

  const scheduleSave=useCallback((generation:bigint)=>{
    if(generation===lastGeneration.current)return
    if(saveTimer.current)clearTimeout(saveTimer.current)
    saveTimer.current=setTimeout(()=>flushBattery().catch(showError),5000)
  },[flushBattery])

  const present=useCallback((frame:ReturnType<MgbaWxCore['videoFrame']>)=>{
    const image=imageRef.current,context=contextRef.current
    if(!image||!context)return
    image.data.set(frame.pixels);context.putImageData(image,0,0)
  },[])

  const startLoop=useCallback(()=>{
    const canvas=canvasRef.current;if(!canvas)return
    let previous=0,accumulator=0,frames=0,windowStart=0
    const tick=(time:number)=>{
      if(destroyedRef.current)return
      try{
        if(!previous){previous=time;windowStart=time}
        const delta=Math.min(100,time-previous);previous=time
        if(runningRef.current&&coreRef.current){
          const rate=settingsRef.current.fastForward
          accumulator+=delta*rate;let executed=0;let frame
          while(accumulator>=FRAME_MS&&executed<Math.max(3,rate*3)){
            coreRef.current.setKeyMask(inputRef.current.mask)
            const frameStarted=Date.now()
            frame=coreRef.current.runFrame()
            const frameTime=Date.now()-frameStarted;frameTimesRef.current.push(frameTime);if(frameTimesRef.current.length>300)frameTimesRef.current.shift()
            scheduleSave(coreRef.current.saveInfo().dirtyGeneration)
            accumulator-=FRAME_MS;executed++;frames++
          }
          const mayPresent=!settingsRef.current.autoFrameSkip||accumulator<FRAME_MS*2||time-lastPresentedAt.current>=FRAME_MS*2
          if(frame&&mayPresent){present(frame);lastPresentedAt.current=time}
          if(settingsRef.current.sound&&rate===1)audioRef.current.push(coreRef.current.readAudio());else if(rate>1)audioRef.current.clear()
          if(settingsRef.current.autoState&&Date.now()-lastAutoStateAt.current>=AUTO_STATE_INTERVAL_MS)commitAutoState().catch(showError)
          if(time-windowStart>=1000){
            const currentFps=Math.round(frames*1000/(time-windowStart));setFps(currentFps)
            const sorted=[...frameTimesRef.current].sort((a,b)=>a-b),audio=audioRef.current.stats
            recordRuntimeDiagnostics({averageFps:currentFps,frameTimeP95Ms:sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)]??0,audioUnderruns:audio.underruns,audioOverflows:audio.overflows})
            const entry=gameRef.current
            if(entry&&clockMovedBackwards(entry.romId)&&!clockWarningShown.current){clockWarningShown.current=true;runningRef.current=false;clearInput();setPhase('paused');recordDiagnosticError('RTC_ROLLBACK','设备系统时间发生大幅回拨');Taro.showModal({title:'系统时间异常',content:'检测到设备时间大幅回拨。游戏内 RTC 可能受到影响，已暂停模拟器。',showCancel:false})}
            frames=0;windowStart=time
          }
        }else accumulator=0
      }catch(error){
        runningRef.current=false;clearInput();audioRef.current.pause().catch(()=>undefined)
        recordDiagnosticError('CORE_RUNTIME',error)
        setMessage(`CORE_RUNTIME: ${errorMessage(error)}`);setPhase('error')
        flushBattery().catch(()=>undefined);checkpointPlay('error').catch(()=>undefined)
      }
      animationRef.current=canvas.requestAnimationFrame(tick)
    }
    animationRef.current=canvas.requestAnimationFrame(tick)
  },[checkpointPlay,clearInput,commitAutoState,flushBattery,present,scheduleSave])

  useEffect(()=>{
    let cancelled=false
    ;(async()=>{try{
      setMessage('正在准备 ROM')
      const entry=await libraryRepository.prepareForPlay(romId,progress=>setMessage(`正在下载 ROM ${progress}%`))
      gameRef.current=entry;setGame(entry)
      const canvas=await selectCanvas();if(cancelled)return
      canvas.width=240;canvas.height=160;canvasRef.current=canvas
      contextRef.current=canvas.getContext('2d');contextRef.current.imageSmoothingEnabled=settings.videoScaling==='smooth'
      imageRef.current=contextRef.current.createImageData(240,160)
      const core=await MgbaWxCore.instantiate();if(cancelled){core.destroy();return}
      coreRef.current=core;core.loadRom(await readBytes(entry.localPath))
      if(clockMovedBackwards(entry.romId)){clockWarningShown.current=true;await Taro.showModal({title:'系统时间异常',content:'检测到设备时间比上次运行早超过 5 分钟。游戏内 RTC 可能受到影响。',showCancel:false})}
      const battery=await saveRepository.load(entry.romId,'battery','current')
      if(battery){core.loadBatterySave(battery.bytes);lastGeneration.current=core.saveInfo().dirtyGeneration;if(battery.recoveredFromPrevious)await Taro.showModal({title:'已使用上一存档',content:'正式电池存档未通过校验，已安全载入上一成功版本。损坏文件仍保留供诊断。',showCancel:false})}
      const automatic=settings.autoState?await saveRepository.load(entry.romId,'auto_state','auto'):undefined
      if(automatic?.manifest.coreBuildId===core.buildId){
        const choice=await chooseStartupMode()
        if(choice===0)core.loadState(automatic.bytes)
        if(choice===2)core.reset()
      }
      setMessage('已就绪');setPhase('ready');lastAutoStateAt.current=Date.now();startLoop()
    }catch(error){setMessage(errorMessage(error));setPhase('error')}})()
    return()=>{cancelled=true}
  },[romId,settings.autoState,startLoop])

  const begin=async()=>{if(settings.sound&&settings.fastForward===1)await audioRef.current.start().catch(()=>false);startPlayTracking();runningRef.current=true;setPhase('running')}
  const togglePause=async()=>{
    if(runningRef.current){runningRef.current=false;clearInput();await audioRef.current.pause();await checkpointPlay('paused');setPhase('paused')}
    else{if(settings.sound&&settings.fastForward===1)await audioRef.current.start().catch(()=>false);startPlayTracking();runningRef.current=true;setPhase('running')}
  }
  const updateInput=(source:string,mask:number)=>coreRef.current?.setKeyMask(inputRef.current.update(source,mask))

  const pauseForMenu=async()=>{runningRef.current=false;clearInput();await audioRef.current.pause();await checkpointPlay('paused');setPhase(current=>current==='running'?'paused':current)}
  const chooseSlot=async():Promise<string|undefined>=>{
    await pauseForMenu()
    try{const result=await Taro.showActionSheet({itemList:['槽位 1','槽位 2','槽位 3','槽位 4','槽位 5']});return String(result.tapIndex)}catch{return undefined}
  }
  const saveState=async()=>{const slot=await chooseSlot();if(slot===undefined)return;await commitState('state',slot);try{const preview=await captureCanvas();await saveRepository.storePreview(romId,'state',slot,await readBytes(preview.tempFilePath))}catch(error){recordDiagnosticError('STATE_PREVIEW',error)}Taro.showToast({title:`已保存到槽位 ${Number(slot)+1}`,icon:'success'})}
  const loadState=async()=>{
    const core=coreRef.current,entry=gameRef.current,slot=await chooseSlot();if(!core||!entry||slot===undefined)return
    const stored=await saveRepository.load(entry.romId,'state',slot);if(!stored){Taro.showToast({title:'该槽位没有状态',icon:'none'});return}
    if(stored.manifest.coreBuildId!==core.buildId)throw new Error('状态存档与当前核心版本不兼容')
    const wasRunning=runningRef.current,backup=core.createState();runningRef.current=false;clearInput()
    try{core.loadState(stored.bytes)}catch(error){core.loadState(backup);throw error}
    runningRef.current=wasRunning;setPhase(wasRunning?'running':'paused');Taro.showToast({title:'状态已载入',icon:'success'})
  }
  const reset=async()=>{const confirmed=await Taro.showModal({title:'软复位',content:'将重启当前游戏，已写入的电池存档不会删除。'});if(confirmed.confirm){runningRef.current=false;clearInput();await audioRef.current.pause();await checkpointPlay('paused');coreRef.current?.reset();setPhase('paused')}}
  const screenshot=async()=>{
    const entry=gameRef.current;if(!entry)throw new Error('游戏尚未就绪')
    const result=await captureCanvas()
    const path=`${dataRoot}/screenshots/${entry.romId}/${new Date().toISOString().replace(/[:.]/g,'-')}.png`
    await writeBytesAtomic(path,await readBytes(result.tempFilePath))
    const exportChoice=await Taro.showModal({title:'截图已保存',content:'截图已保存在小程序文件系统。是否同时导出到系统相册？',confirmText:'导出相册',cancelText:'仅本地'})
    if(exportChoice.confirm)await Taro.saveImageToPhotosAlbum({filePath:result.tempFilePath})
  }
  const captureCanvas=async()=>{const canvas=canvasRef.current;if(!canvas)throw new Error('画布尚未就绪');return Taro.canvasToTempFilePath({canvas:canvas as unknown as NonNullable<Parameters<typeof Taro.canvasToTempFilePath>[0]['canvas']>,fileType:'png',destWidth:720,destHeight:480})}

  const persistForBackground=useCallback(async()=>{runningRef.current=false;clearInput();setPhase(current=>current==='running'?'paused':current);await audioRef.current.pause();await flushBattery();await commitAutoState();await checkpointPlay('background')},[checkpointPlay,clearInput,commitAutoState,flushBattery])
  const shutdown=useCallback(async()=>{
    if(destroyedRef.current)return
    runningRef.current=false;clearInput();if(saveTimer.current)clearTimeout(saveTimer.current)
    await flushBattery().catch(()=>undefined);await commitAutoState().catch(()=>undefined);await checkpointPlay('exit').catch(()=>undefined)
    const entry=gameRef.current
    if(entry)clockMovedBackwards(entry.romId)
    await audioRef.current.stop();const canvas=canvasRef.current;if(canvas&&animationRef.current)canvas.cancelAnimationFrame(animationRef.current)
    coreRef.current?.destroy();coreRef.current=undefined;destroyedRef.current=true
  },[checkpointPlay,clearInput,commitAutoState,flushBattery])

  useDidHide(()=>{persistForBackground().catch(()=>undefined)})
  useUnload(()=>{shutdown().catch(()=>undefined)})
  useEffect(()=>{const interrupted=()=>{persistForBackground().catch(()=>undefined)};Taro.onAudioInterruptionBegin(interrupted);return()=>Taro.offAudioInterruptionBegin(interrupted)},[persistForBackground])

  return <View className='player-page'>
    <View className='player-status'><View><Text className='player-title'>{game?.title??'MiniGBA'}</Text><Text className='player-code mono'>{game?.gameCode??message}</Text></View><View className={`run-light ${phase}`}/></View>
    <View className='screen-bezel'><Canvas id='game-canvas' type='2d' className='game-canvas'/>{phase!=='running'&&<View className='screen-overlay'><Text>{messageFor(phase,message)}</Text>{phase==='ready'&&<Button className='start-button' onClick={begin}>开始游戏</Button>}</View>}{settings.showFps&&phase==='running'&&<Text className='fps mono'>{fps} FPS</Text>}</View>
    <View className='player-tools'><Button onClick={()=>togglePause().catch(showError)} disabled={phase==='loading'||phase==='error'}>{phase==='paused'?'继续':'暂停'}</Button><Button onClick={()=>saveState().catch(showError)}>保存</Button><Button onClick={()=>loadState().catch(showError)}>载入</Button><Button onClick={()=>screenshot().catch(showError)}>截图</Button><Button onClick={()=>reset().catch(showError)}>复位</Button><Button onClick={()=>shutdown().then(()=>Taro.navigateBack()).catch(showError)}>退出</Button></View>
    <VirtualControls onChange={updateInput} haptics={settings.haptics} preset={settings.controlPreset} scale={settings.controlScale} spacing={settings.controlSpacing} opacity={settings.controlOpacity}/>
  </View>
}

async function chooseStartupMode():Promise<number>{
  try{return(await Taro.showActionSheet({itemList:['继续自动恢复点','仅载入电池存档','重新开始']})).tapIndex}catch{return 1}
}
function selectCanvas():Promise<WechatCanvasNode>{return new Promise((resolve,reject)=>{Taro.createSelectorQuery().select('#game-canvas').fields({node:true,size:true}).exec(result=>{const node=(result[0] as unknown as {node?:WechatCanvasNode})?.node;node?resolve(node):reject(new Error('无法初始化游戏画布'))})})}
const messageFor=(phase:Phase,message:string)=>phase==='loading'?message:phase==='paused'?'已暂停':phase==='error'?message:'按下开始'
const showError=(error:unknown)=>Taro.showModal({title:'播放器错误',content:errorMessage(error),showCancel:false})
