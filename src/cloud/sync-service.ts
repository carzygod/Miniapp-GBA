import Taro from '@tarojs/taro'
import type {SaveManifest,SyncTask} from '../domain/models'
import {sha256Hex} from '../domain/sha256'
import {activeScope,loadSettings} from '../settings'
import {libraryRepository,saveRepository,syncQueue} from '../services'
import {cloudClient,CloudConflictError,CloudRequestError} from './client'

export class SyncService{
  private exclusiveTail:Promise<void>=Promise.resolve()
  async exclusive<T>(operation:()=>Promise<T>):Promise<T>{
    const previous=this.exclusiveTail
    let release!:()=>void
    this.exclusiveTail=new Promise(resolve=>{release=resolve})
    await previous
    try{return await operation()}finally{release()}
  }
  async enqueue(manifest:SaveManifest):Promise<void>{const now=new Date().toISOString();await syncQueue.enqueue({id:uuid(),romId:manifest.romId,kind:manifest.kind,slot:manifest.slot,localRevision:manifest.localRevision,cloudRevision:manifest.cloudRevision,checksum:manifest.checksum,path:saveRepository.contentPath(manifest.romId,manifest.kind,manifest.slot),attempts:0,nextAttemptAt:now,createdAt:now})}
  async runDue():Promise<void>{
    await this.exclusive(async()=>{if(activeScope()==='anonymous'||!loadSettings().cloudSync||!cloudClient.canSync())return;const now=new Date().toISOString(),settings=loadSettings();for(const task of await syncQueue.list()){if(task.terminal||task.nextAttemptAt>now||(task.kind!=='battery'&&!settings.cloudStateSync))continue;await this.runTask(task)}})
  }
  private async runTask(task:SyncTask):Promise<void>{try{
    const stored=await saveRepository.load(task.romId,task.kind,task.slot);if(!stored||stored.manifest.localRevision!==task.localRevision||stored.manifest.checksum!==task.checksum){await syncQueue.complete(task.id);return}
    const result=await cloudClient.upload(stored.manifest,stored.bytes,task.id)
    await saveRepository.updateCloudRevision(task.romId,task.kind,task.slot,result.revision);await syncQueue.complete(task.id);await libraryRepository.setCloudState(task.romId,'synced')
  }catch(error){if(error instanceof CloudConflictError){if(error.current?.checksum===task.checksum){await saveRepository.updateCloudRevision(task.romId,task.kind,task.slot,error.current.currentRevision);await syncQueue.complete(task.id);await libraryRepository.setCloudState(task.romId,'synced');return}await syncQueue.markConflict(task.id,error.current);await libraryRepository.setCloudState(task.romId,'conflict');return}const message=error instanceof Error?error.message:String(error);if(error instanceof CloudRequestError&&error.terminal)await syncQueue.fail(task.id,message);else await syncQueue.retry(task.id,message);await libraryRepository.setCloudState(task.romId,'error',message)}}
  async retry(taskId:string):Promise<void>{const task=await syncQueue.find(taskId);if(!task)throw new Error('同步任务不存在');await syncQueue.retryNow(taskId);await libraryRepository.setCloudState(task.romId,'pending');await this.runDue()}
  async restoreCloudBattery(romId:string):Promise<void>{const remote=await cloudClient.download(romId,'battery','current');verifyRemote(remote.bytes,remote.checksum,remote.sizeBytes);await saveRepository.commit(romId,'battery','current',remote.bytes,remote.coreBuildId,remote.revision);await libraryRepository.setSaveState(romId,true,'synced')}
  async resolveKeepLocal(taskId:string):Promise<void>{const task=await syncQueue.find(taskId);if(!task?.conflict)throw new Error('同步冲突不存在');const remote=await cloudClient.download(task.romId,task.kind,task.slot,task.conflict.currentRevision);verifyRemote(remote.bytes,remote.checksum,remote.sizeBytes);await saveRepository.storeConflictCopy(task.romId,task.kind,task.slot,'cloud',remote.bytes,{cloudRevision:remote.revision,coreBuildId:remote.coreBuildId});const manifest=await saveRepository.updateCloudRevision(task.romId,task.kind,task.slot,remote.revision);await syncQueue.complete(task.id);await this.enqueue(manifest);await libraryRepository.setCloudState(task.romId,'pending');await this.runDue()}
  async resolveUseCloud(taskId:string):Promise<void>{const task=await syncQueue.find(taskId);if(!task?.conflict)throw new Error('同步冲突不存在');const local=await saveRepository.load(task.romId,task.kind,task.slot);if(local)await saveRepository.storeConflictCopy(task.romId,task.kind,task.slot,'local',local.bytes,{localRevision:local.manifest.localRevision,cloudRevision:local.manifest.cloudRevision,coreBuildId:local.manifest.coreBuildId});const remote=await cloudClient.download(task.romId,task.kind,task.slot,task.conflict.currentRevision);verifyRemote(remote.bytes,remote.checksum,remote.sizeBytes);await saveRepository.commit(task.romId,task.kind,task.slot,remote.bytes,remote.coreBuildId,remote.revision);await syncQueue.complete(task.id);await markSynced(task.romId,task.kind)}
  async restoreCloudVersion(romId:string,kind:SaveManifest['kind'],slot:string,sourceRevision:number):Promise<void>{const heads=await cloudClient.list(romId);const head=heads.find(item=>item.kind===kind&&item.slot===slot);if(!head)throw new Error('云端存档不存在');const local=await saveRepository.load(romId,kind,slot);if(local)await saveRepository.storeConflictCopy(romId,kind,slot,'local',local.bytes,{reason:'before-cloud-history-restore',localRevision:local.manifest.localRevision,cloudRevision:local.manifest.cloudRevision});const revision=await cloudClient.restoreVersion(romId,kind,slot,sourceRevision,head.currentRevision);const remote=await cloudClient.download(romId,kind,slot,revision);verifyRemote(remote.bytes,remote.checksum,remote.sizeBytes);await saveRepository.commit(romId,kind,slot,remote.bytes,remote.coreBuildId,remote.revision);await markSynced(romId,kind)}
}
function verifyRemote(bytes:Uint8Array,checksum:string,sizeBytes:number):void{if(bytes.length!==sizeBytes)throw new Error('云端存档长度校验失败');if(!checksum||sha256Hex(bytes)!==checksum)throw new Error('云端存档摘要校验失败')}
async function markSynced(romId:string,kind:SaveManifest['kind']):Promise<void>{if(kind==='battery')await libraryRepository.setSaveState(romId,true,'synced');else await libraryRepository.setCloudState(romId,'synced')}
function uuid():string{const bytes=new Uint8Array(16);for(let i=0;i<16;i++)bytes[i]=Math.floor(Math.random()*256);bytes[6]=(bytes[6]!&15)|64;bytes[8]=(bytes[8]!&63)|128;const hex=[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');return`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`}
export const syncService=new SyncService()
