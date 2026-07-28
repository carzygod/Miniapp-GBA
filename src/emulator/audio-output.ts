type AudioProcessEvent={outputBuffer:{getChannelData(index:number):Float32Array}}
type ScriptNode={onaudioprocess?:(event:AudioProcessEvent)=>void;connect(target:unknown):void;disconnect():void}
type AudioContextLike={destination:unknown;state:string;createScriptProcessor(size:number,input:number,output:number):ScriptNode;resume():Promise<void>;suspend?:()=>Promise<void>;close():Promise<void>}

export class AudioOutput{
  private context?:AudioContextLike
  private node?:ScriptNode
  private chunks:Int16Array[]=[]
  private chunkOffset=0
  get available():boolean{return Boolean((globalThis as unknown as {wx?:{createWebAudioContext?:()=>unknown}}).wx?.createWebAudioContext)}
  async start():Promise<boolean>{
    if(this.context){await this.context.resume();return true}
    const factory=(globalThis as unknown as {wx?:{createWebAudioContext?:()=>unknown}}).wx?.createWebAudioContext
    if(!factory)return false
    this.context=factory() as AudioContextLike
    if(typeof this.context.createScriptProcessor!=='function'){await this.context.close();this.context=undefined;return false}
    this.node=this.context.createScriptProcessor(2048,0,2)
    this.node.onaudioprocess=event=>this.fill(event)
    this.node.connect(this.context.destination)
    await this.context.resume()
    return true
  }
  push(samples:Int16Array):void{if(samples.length){this.chunks.push(samples);if(this.chunks.length>12){this.chunks.shift();this.chunkOffset=0}}}
  clear():void{this.chunks=[];this.chunkOffset=0}
  async pause():Promise<void>{this.clear();await this.context?.suspend?.()}
  async stop():Promise<void>{this.node?.disconnect();this.node=undefined;this.clear();await this.context?.close();this.context=undefined}
  private fill(event:AudioProcessEvent):void{const left=event.outputBuffer.getChannelData(0),right=event.outputBuffer.getChannelData(1);left.fill(0);right.fill(0);for(let frame=0;frame<left.length;frame++){
    while(this.chunks.length&&this.chunkOffset>=this.chunks[0]!.length){this.chunks.shift();this.chunkOffset=0}
    const chunk=this.chunks[0];if(!chunk)break
    left[frame]=(chunk[this.chunkOffset]??0)/32768;right[frame]=(chunk[this.chunkOffset+1]??0)/32768;this.chunkOffset+=2
  }}
}
