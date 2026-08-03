import {currentPlatform} from '../platform/capabilities'

type AudioProcessEvent={outputBuffer:{getChannelData(index:number):Float32Array}}
type ScriptNode={onaudioprocess?:(event:AudioProcessEvent)=>void;connect(target:unknown):void;disconnect():void}
type AudioContextLike={destination:unknown;state:string;createScriptProcessor(size:number,input:number,output:number):ScriptNode;resume():Promise<void>;suspend?:()=>Promise<void>;close():Promise<void>}
type AudioHost={createWebAudioContext?:()=>unknown}
export type AudioBufferMode='low_latency'|'stable'
export interface AudioStats{underruns:number;overflows:number;queuedChunks:number}

export class AudioOutput{
  private context?:AudioContextLike
  private node?:ScriptNode
  private chunks:Int16Array[]=[]
  private chunkOffset=0
  private underruns=0
  private overflows=0
  private readonly volume:number
  private readonly mode:AudioBufferMode
  constructor(options:{volume?:number;mode?:AudioBufferMode}={}){
    this.volume=Math.min(1,Math.max(0,options.volume??1));this.mode=options.mode??'stable'
  }
  get available():boolean{return Boolean(audioFactory())}
  get stats():AudioStats{return{underruns:this.underruns,overflows:this.overflows,queuedChunks:this.chunks.length}}
  async start():Promise<boolean>{
    if(this.context){await this.context.resume();return true}
    const factory=audioFactory()
    if(!factory)return false
    this.context=factory() as AudioContextLike
    if(typeof this.context.createScriptProcessor!=='function'){await this.context.close();this.context=undefined;return false}
    this.node=this.context.createScriptProcessor(this.mode==='low_latency'?1024:4096,0,2)
    this.node.onaudioprocess=event=>this.fill(event)
    this.node.connect(this.context.destination)
    await this.context.resume()
    return true
  }
  push(samples:Int16Array):void{if(samples.length){this.chunks.push(samples);const maximum=this.mode==='low_latency'?8:24;if(this.chunks.length>maximum){this.chunks.shift();this.chunkOffset=0;this.overflows++}}}
  clear():void{this.chunks=[];this.chunkOffset=0}
  async pause():Promise<void>{this.clear();await this.context?.suspend?.()}
  async stop():Promise<void>{this.node?.disconnect();this.node=undefined;this.clear();await this.context?.close();this.context=undefined}
  private fill(event:AudioProcessEvent):void{const left=event.outputBuffer.getChannelData(0),right=event.outputBuffer.getChannelData(1);left.fill(0);right.fill(0);let starved=false;for(let frame=0;frame<left.length;frame++){
    while(this.chunks.length&&this.chunkOffset>=this.chunks[0]!.length){this.chunks.shift();this.chunkOffset=0}
    const chunk=this.chunks[0];if(!chunk){starved=true;break}
    left[frame]=((chunk[this.chunkOffset]??0)/32768)*this.volume;right[frame]=((chunk[this.chunkOffset+1]??0)/32768)*this.volume;this.chunkOffset+=2
  }if(starved)this.underruns++}
}

function audioFactory():(()=>unknown)|undefined{
  const globals=globalThis as unknown as {wx?:AudioHost;tt?:AudioHost}
  return (currentPlatform()==='tt'?globals.tt:globals.wx)?.createWebAudioContext
}
