import Taro,{useDidHide,useRouter,useUnload} from '@tarojs/taro'
import {Button,Canvas,Text,View} from '@tarojs/components'
import {useCallback,useEffect,useRef,useState} from 'react'
import {VirtualControls} from '../components/VirtualControls'
import {InputBitmap} from '../emulator/input'
import {MgbaWxCore} from '../emulator/core-loader'
import {AudioOutput} from '../emulator/audio-output'
import {syncService} from '../cloud/sync-service'
import {loadSettings} from '../settings'
import {libraryRepository,saveRepository} from '../services'
import {readBytes} from '../platform/fs'
import type {GameEntry,SaveKind} from '../domain/models'
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
  const audioRef=useRef(new AudioOutput())
  const startTimeRef=useRef(Date.now())
  const lastGeneration=useRef(0n)
  const saveTimer=useRef<ReturnType<typeof setTimeout>>()
  const lastAutoStateAt=useRef(Date.now())
  const autoStateInFlight=useRef(false)

  const clearInput=useCallback(()=>{inputRef.current.clear();coreRef.current?.setKeyMask(0)},[])

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
    return saveRepository.commit(entry.romId,kind,slot,core.createState(),core.buildId)
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
          accumulator+=delta;let executed=0;let frame
          while(accumulator>=FRAME_MS&&executed<3){
            coreRef.current.setKeyMask(inputRef.current.mask)
            frame=coreRef.current.runFrame()
            scheduleSave(coreRef.current.saveInfo().dirtyGeneration)
            accumulator-=FRAME_MS;executed++;frames++
          }
          if(frame)present(frame)
          if(settingsRef.current.sound)audioRef.current.push(coreRef.current.readAudio())
          if(settingsRef.current.autoState&&Date.now()-lastAutoStateAt.current>=AUTO_STATE_INTERVAL_MS)commitAutoState().catch(showError)
          if(time-windowStart>=1000){setFps(Math.round(frames*1000/(time-windowStart)));frames=0;windowStart=time}
        }else accumulator=0
      }catch(error){
        runningRef.current=false;clearInput();audioRef.current.pause().catch(()=>undefined)
        setMessage(`CORE_RUNTIME: ${error instanceof Error?error.message:String(error)}`);setPhase('error')
        flushBattery().catch(()=>undefined)
      }
      animationRef.current=canvas.requestAnimationFrame(tick)
    }
    animationRef.current=canvas.requestAnimationFrame(tick)
  },[clearInput,commitAutoState,flushBattery,present,scheduleSave])

  useEffect(()=>{
    let cancelled=false
    ;(async()=>{try{
      const entry=await libraryRepository.get(romId)
      if(!entry)throw new Error('游戏不在本地游戏库中')
      gameRef.current=entry;setGame(entry)
      const canvas=await selectCanvas();if(cancelled)return
      canvas.width=240;canvas.height=160;canvasRef.current=canvas
      contextRef.current=canvas.getContext('2d');contextRef.current.imageSmoothingEnabled=false
      imageRef.current=contextRef.current.createImageData(240,160)
      const core=await MgbaWxCore.instantiate();if(cancelled){core.destroy();return}
      coreRef.current=core;core.loadRom(await readBytes(entry.localPath))
      const battery=await saveRepository.load(entry.romId,'battery','current')
      if(battery){core.loadBatterySave(battery.bytes);lastGeneration.current=core.saveInfo().dirtyGeneration}
      const automatic=settings.autoState?await saveRepository.load(entry.romId,'auto_state','auto'):undefined
      if(automatic?.manifest.coreBuildId===core.buildId){
        const choice=await chooseStartupMode()
        if(choice===0)core.loadState(automatic.bytes)
        if(choice===2)core.reset()
      }
      setMessage('已就绪');setPhase('ready');lastAutoStateAt.current=Date.now();startLoop()
    }catch(error){setMessage(error instanceof Error?error.message:String(error));setPhase('error')}})()
    return()=>{cancelled=true}
  },[romId,settings.autoState,startLoop])

  const begin=async()=>{if(settings.sound)await audioRef.current.start().catch(()=>false);runningRef.current=true;startTimeRef.current=Date.now();setPhase('running')}
  const togglePause=async()=>{
    if(runningRef.current){runningRef.current=false;clearInput();await audioRef.current.pause();setPhase('paused')}
    else{if(settings.sound)await audioRef.current.start().catch(()=>false);runningRef.current=true;setPhase('running')}
  }
  const updateInput=(source:string,mask:number)=>coreRef.current?.setKeyMask(inputRef.current.update(source,mask))

  const chooseSlot=async():Promise<string|undefined>=>{
    try{const result=await Taro.showActionSheet({itemList:['槽位 1','槽位 2','槽位 3','槽位 4','槽位 5']});return String(result.tapIndex)}catch{return undefined}
  }
  const saveState=async()=>{const slot=await chooseSlot();if(slot===undefined)return;await commitState('state',slot);Taro.showToast({title:`已保存到槽位 ${Number(slot)+1}`,icon:'success'})}
  const loadState=async()=>{
    const core=coreRef.current,entry=gameRef.current,slot=await chooseSlot();if(!core||!entry||slot===undefined)return
    const stored=await saveRepository.load(entry.romId,'state',slot);if(!stored){Taro.showToast({title:'该槽位没有状态',icon:'none'});return}
    if(stored.manifest.coreBuildId!==core.buildId)throw new Error('状态存档与当前核心版本不兼容')
    const wasRunning=runningRef.current,backup=core.createState();runningRef.current=false;clearInput()
    try{core.loadState(stored.bytes)}catch(error){core.loadState(backup);throw error}
    runningRef.current=wasRunning;setPhase(wasRunning?'running':'paused');Taro.showToast({title:'状态已载入',icon:'success'})
  }
  const reset=async()=>{const confirmed=await Taro.showModal({title:'软复位',content:'将重启当前游戏，已写入的电池存档不会删除。'});if(confirmed.confirm){runningRef.current=false;clearInput();coreRef.current?.reset();setPhase('paused')}}

  const persistForBackground=useCallback(async()=>{runningRef.current=false;clearInput();setPhase(current=>current==='running'?'paused':current);await audioRef.current.pause();await flushBattery();await commitAutoState()},[clearInput,commitAutoState,flushBattery])
  const shutdown=useCallback(async()=>{
    if(destroyedRef.current)return
    runningRef.current=false;clearInput();if(saveTimer.current)clearTimeout(saveTimer.current)
    await flushBattery().catch(()=>undefined);await commitAutoState().catch(()=>undefined)
    const entry=gameRef.current;if(entry)await libraryRepository.markPlayed(entry.romId,(Date.now()-startTimeRef.current)/1000)
    await audioRef.current.stop();const canvas=canvasRef.current;if(canvas&&animationRef.current)canvas.cancelAnimationFrame(animationRef.current)
    coreRef.current?.destroy();coreRef.current=undefined;destroyedRef.current=true
  },[clearInput,commitAutoState,flushBattery])

  useDidHide(()=>{persistForBackground().catch(()=>undefined)})
  useUnload(()=>{shutdown().catch(()=>undefined)})

  return <View className='player-page'>
    <View className='player-status'><View><Text className='player-title'>{game?.title??'MiniGBA'}</Text><Text className='player-code mono'>{game?.gameCode??message}</Text></View><View className={`run-light ${phase}`}/></View>
    <View className='screen-bezel'><Canvas id='game-canvas' type='2d' className='game-canvas'/>{phase!=='running'&&<View className='screen-overlay'><Text>{messageFor(phase,message)}</Text>{phase==='ready'&&<Button className='start-button' onClick={begin}>开始游戏</Button>}</View>}{settings.showFps&&phase==='running'&&<Text className='fps mono'>{fps} FPS</Text>}</View>
    <View className='player-tools'><Button onClick={()=>togglePause().catch(showError)} disabled={phase==='loading'||phase==='error'}>{phase==='paused'?'继续':'暂停'}</Button><Button onClick={()=>saveState().catch(showError)}>保存</Button><Button onClick={()=>loadState().catch(showError)}>载入</Button><Button onClick={()=>reset().catch(showError)}>复位</Button><Button onClick={()=>shutdown().then(()=>Taro.navigateBack()).catch(showError)}>退出</Button></View>
    <VirtualControls onChange={updateInput} haptics={settings.haptics}/>
  </View>
}

async function chooseStartupMode():Promise<number>{
  try{return(await Taro.showActionSheet({itemList:['继续自动恢复点','仅载入电池存档','重新开始']})).tapIndex}catch{return 1}
}
function selectCanvas():Promise<WechatCanvasNode>{return new Promise((resolve,reject)=>{Taro.createSelectorQuery().select('#game-canvas').fields({node:true,size:true}).exec(result=>{const node=(result[0] as unknown as {node?:WechatCanvasNode})?.node;node?resolve(node):reject(new Error('无法初始化游戏画布'))})})}
const messageFor=(phase:Phase,message:string)=>phase==='loading'?message:phase==='paused'?'已暂停':phase==='error'?message:'按下开始'
const showError=(error:unknown)=>Taro.showModal({title:'播放器错误',content:error instanceof Error?error.message:String(error),showCancel:false})
