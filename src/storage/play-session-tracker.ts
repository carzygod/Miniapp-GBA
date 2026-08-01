import type {PlaySession,PlaySessionExitReason} from '../domain/models'

export interface PlaySessionCheckpoint{session:PlaySession;deltaSeconds:number}

export class PlaySessionTracker{
  private state?:{id:string;startedAt:string;activeStartedAt?:number;durationSeconds:number;checkpointedSeconds:number}
  constructor(private readonly romId:string,private readonly now:()=>number=Date.now,private readonly idFactory:()=>string=uuid){if(!/^[0-9a-f]{64}$/.test(romId))throw new Error('ROM ID 无效')}

  start():void{
    const current=this.now()
    if(!this.state)this.state={id:this.idFactory(),startedAt:new Date(current).toISOString(),activeStartedAt:current,durationSeconds:0,checkpointedSeconds:0}
    else if(this.state.activeStartedAt===undefined)this.state.activeStartedAt=current
  }

  checkpoint(exitReason:PlaySessionExitReason):PlaySessionCheckpoint|undefined{
    const state=this.state
    if(!state)return undefined
    const current=this.now()
    if(state.activeStartedAt!==undefined){state.durationSeconds+=Math.max(0,(current-state.activeStartedAt)/1000);state.activeStartedAt=undefined}
    const durationSeconds=Math.max(0,Math.floor(state.durationSeconds)),deltaSeconds=durationSeconds-state.checkpointedSeconds
    if(durationSeconds===0)return undefined
    state.checkpointedSeconds=durationSeconds
    return{session:{id:state.id,romId:this.romId,startedAt:state.startedAt,endedAt:new Date(current).toISOString(),durationSeconds,exitReason},deltaSeconds}
  }
}

function uuid():string{const bytes=new Uint8Array(16);for(let index=0;index<bytes.length;index++)bytes[index]=Math.floor(Math.random()*256);bytes[6]=(bytes[6]!&0x0f)|0x40;bytes[8]=(bytes[8]!&0x3f)|0x80;const hex=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');return`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`}
