const ABI_VERSION=1
const VIDEO_INFO_SIZE=32
const AUDIO_INFO_SIZE=16
const SAVE_INFO_SIZE=16

type CoreExports=WebAssembly.Exports&{
  memory:WebAssembly.Memory
  _initialize():void
  mgba_wx_abi_version():number
  mgba_wx_build_id_ptr():number
  mgba_wx_build_id_len():number
  mgba_wx_last_error_ptr():number
  mgba_wx_last_error_len():number
  mgba_wx_create(ptr:number,len:number):number
  mgba_wx_load_rom(ptr:number,len:number):number
  mgba_wx_reset():number
  mgba_wx_run_frame():number
  mgba_wx_unload_rom():number
  mgba_wx_destroy():void
  mgba_wx_alloc(size:number,alignment:number):number
  mgba_wx_free(ptr:number,size:number,alignment:number):void
  mgba_wx_video_info(ptr:number,len:number):number
  mgba_wx_audio_info(ptr:number,len:number):number
  mgba_wx_audio_read(ptr:number,maxFrames:number):number
  mgba_wx_audio_clear():void
  mgba_wx_set_key_mask(mask:number):void
  mgba_wx_get_key_mask():number
  mgba_wx_save_info(ptr:number,len:number):number
  mgba_wx_load_save(ptr:number,len:number):number
  mgba_wx_copy_save(ptr:number,len:number):number
  mgba_wx_save_generation():bigint
  mgba_wx_state_max_size():number
  mgba_wx_state_write(ptr:number,capacity:number,writtenPtr:number):number
  mgba_wx_state_read(ptr:number,len:number):number
}

export interface VideoFrameView{pixels:Uint8ClampedArray;width:number;height:number;strideBytes:number;frameNumber:bigint}
export interface CoreSaveInfo{saveType:number;sizeBytes:number;dirtyGeneration:bigint}
export interface CoreAudioInfo{sampleRate:number;channels:number;queuedFrames:number;capacityFrames:number}

export class CoreError extends Error{constructor(readonly status:number,message:string){super(message);this.name='CoreError'}}

export class MgbaWxCore{
  readonly buildId:string
  private readonly exports:CoreExports
  private readonly videoInfoPtr:number
  private readonly audioInfoPtr:number
  private readonly saveInfoPtr:number
  private readonly audioPtr:number
  private readonly audioCapacity=4096
  private lastMemory?:ArrayBuffer
  private cachedPixels?:Uint8ClampedArray

  private constructor(exports:CoreExports){
    this.exports=exports
    exports._initialize()
    if(exports.mgba_wx_abi_version()!==ABI_VERSION)throw new Error(`核心 ABI 不兼容：${exports.mgba_wx_abi_version()}`)
    this.buildId=this.text(exports.mgba_wx_build_id_ptr(),exports.mgba_wx_build_id_len())
    this.videoInfoPtr=this.allocate(VIDEO_INFO_SIZE,8)
    this.audioInfoPtr=this.allocate(AUDIO_INFO_SIZE,8)
    this.saveInfoPtr=this.allocate(SAVE_INFO_SIZE,8)
    this.audioPtr=this.allocate(this.audioCapacity*4,16)
    const configPtr=this.allocate(16,8)
    const config=new DataView(exports.memory.buffer,configPtr,16)
    config.setUint32(0,16,true);config.setUint32(4,48000,true);config.setUint32(8,this.audioCapacity,true);config.setUint32(12,0,true)
    this.check(exports.mgba_wx_create(configPtr,16));this.release(configPtr,16,8)
  }

  static async instantiate(path='/player/assets/minigba-core.wasm'):Promise<MgbaWxCore>{
    let coreExports:CoreExports|undefined
    const memoryView=()=>{if(!coreExports)throw new Error('WASM memory is not initialized');return new DataView(coreExports.memory.buffer)}
    const writeU32=(ptr:number,value:number)=>memoryView().setUint32(ptr,value,true)
    const discardWrite=(_fd:number,iov:number,count:number,written:number)=>{
      const view=memoryView();let consumed=0
      for(let index=0;index<count;index++)consumed=(consumed+view.getUint32(iov+index*8+4,true))>>>0
      writeU32(written,consumed);return 0
    }
    const imports:WebAssembly.Imports={
      env:{
        abort:()=>{throw new Error('WASM aborted')},
        emscripten_date_now:()=>Date.now(),emscripten_get_now:()=>Date.now(),
        emscripten_notify_memory_growth:()=>undefined,
      },
      wasi_snapshot_preview1:{
        clock_time_get:(_clock:number,_precision:bigint,ptr:number)=>{memoryView().setBigUint64(ptr,BigInt(Date.now())*1_000_000n,true);return 0},
        fd_write:discardWrite,
        fd_close:()=>0,
        environ_sizes_get:(count:number,size:number)=>{writeU32(count,0);writeU32(size,0);return 0},
        environ_get:()=>0,
        random_get:(ptr:number,len:number)=>{const bytes=new Uint8Array(coreExports!.memory.buffer,ptr,len);for(let i=0;i<len;i++)bytes[i]=Math.floor(Math.random()*256);return 0},
        proc_exit:(code:number)=>{throw new Error(`WASM exited with ${code}`)},
      },
    }
    const wasmRuntime=__MINIGBA_PLATFORM__==='tt'?TTWebAssembly:WXWebAssembly
    const result=await wasmRuntime.instantiate(path,imports)
    coreExports=result.instance.exports as CoreExports
    if(!coreExports.memory||!(coreExports.memory.buffer instanceof ArrayBuffer))throw new Error('核心没有导出 memory')
    return new MgbaWxCore(coreExports)
  }

  loadRom(rom:Uint8Array):void{this.withBytes(rom,16,(ptr,len)=>this.check(this.exports.mgba_wx_load_rom(ptr,len)))}
  reset():void{this.check(this.exports.mgba_wx_reset())}
  setKeyMask(mask:number):void{this.exports.mgba_wx_set_key_mask(mask)}
  runFrame():VideoFrameView{this.check(this.exports.mgba_wx_run_frame());return this.videoFrame()}
  videoFrame():VideoFrameView{
    this.check(this.exports.mgba_wx_video_info(this.videoInfoPtr,VIDEO_INFO_SIZE));const view=new DataView(this.exports.memory.buffer,this.videoInfoPtr,VIDEO_INFO_SIZE)
    const ptr=view.getUint32(0,true),width=view.getUint32(4,true),height=view.getUint32(8,true),strideBytes=view.getUint32(12,true)
    if(this.lastMemory!==this.exports.memory.buffer||!this.cachedPixels){this.lastMemory=this.exports.memory.buffer;this.cachedPixels=new Uint8ClampedArray(this.lastMemory,ptr,strideBytes*height)}
    return{pixels:this.cachedPixels,width,height,strideBytes,frameNumber:view.getBigUint64(24,true)}
  }
  audioInfo():CoreAudioInfo{this.check(this.exports.mgba_wx_audio_info(this.audioInfoPtr,AUDIO_INFO_SIZE));const v=new DataView(this.exports.memory.buffer,this.audioInfoPtr,AUDIO_INFO_SIZE);return{sampleRate:v.getUint32(0,true),channels:v.getUint32(4,true),queuedFrames:v.getUint32(8,true),capacityFrames:v.getUint32(12,true)}}
  readAudio(maxFrames=this.audioCapacity):Int16Array{const frames=this.exports.mgba_wx_audio_read(this.audioPtr,Math.min(maxFrames,this.audioCapacity));return new Int16Array(this.exports.memory.buffer,this.audioPtr,frames*2).slice()}
  saveInfo():CoreSaveInfo{this.check(this.exports.mgba_wx_save_info(this.saveInfoPtr,SAVE_INFO_SIZE));const v=new DataView(this.exports.memory.buffer,this.saveInfoPtr,SAVE_INFO_SIZE);return{saveType:v.getUint32(0,true),sizeBytes:v.getUint32(4,true),dirtyGeneration:v.getBigUint64(8,true)}}
  loadBatterySave(bytes:Uint8Array):void{this.withBytes(bytes,16,(ptr,len)=>this.check(this.exports.mgba_wx_load_save(ptr,len)))}
  copyBatterySave():Uint8Array{const size=this.saveInfo().sizeBytes;if(!size)return new Uint8Array();const ptr=this.allocate(size,16);try{this.check(this.exports.mgba_wx_copy_save(ptr,size));return new Uint8Array(this.exports.memory.buffer,ptr,size).slice()}finally{this.release(ptr,size,16)}}
  createState():Uint8Array{const size=this.exports.mgba_wx_state_max_size();if(!size)throw new Error('核心不支持即时存档');const ptr=this.allocate(size,16),written=this.allocate(4,4);try{this.check(this.exports.mgba_wx_state_write(ptr,size,written));const length=new DataView(this.exports.memory.buffer,written,4).getUint32(0,true);return new Uint8Array(this.exports.memory.buffer,ptr,length).slice()}finally{this.release(written,4,4);this.release(ptr,size,16)}}
  loadState(bytes:Uint8Array):void{this.withBytes(bytes,16,(ptr,len)=>this.check(this.exports.mgba_wx_state_read(ptr,len)))}
  destroy():void{this.release(this.audioPtr,this.audioCapacity*4,16);this.release(this.saveInfoPtr,SAVE_INFO_SIZE,8);this.release(this.audioInfoPtr,AUDIO_INFO_SIZE,8);this.release(this.videoInfoPtr,VIDEO_INFO_SIZE,8);this.exports.mgba_wx_destroy()}
  private withBytes(bytes:Uint8Array,alignment:number,action:(ptr:number,len:number)=>void):void{const ptr=this.allocate(bytes.length,alignment);try{new Uint8Array(this.exports.memory.buffer,ptr,bytes.length).set(bytes);action(ptr,bytes.length)}finally{this.release(ptr,bytes.length,alignment)}}
  private allocate(size:number,alignment:number):number{const ptr=this.exports.mgba_wx_alloc(size,alignment);if(!ptr)throw new CoreError(3,this.lastError()||'核心内存不足');return ptr}
  private release(ptr:number,size:number,alignment:number):void{this.exports.mgba_wx_free(ptr,size,alignment)}
  private check(status:number):void{if(status!==0)throw new CoreError(status,this.lastError()||`核心错误 ${status}`)}
  private lastError():string{return this.text(this.exports.mgba_wx_last_error_ptr(),this.exports.mgba_wx_last_error_len())}
  private text(ptr:number,len:number):string{return String.fromCharCode(...new Uint8Array(this.exports.memory.buffer,ptr,len))}
}
