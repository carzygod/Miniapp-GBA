import Taro from '@tarojs/taro'
import type { CloudSaveHead,SaveKind, SaveManifest } from '../domain/models'

export interface CloudSaveVersion{romId:string;kind:SaveKind;slot:string;revision:number;checksum:string;sizeBytes:number;coreBuildId:string;deviceName?:string;createdAt:string}

const tokenKey='minigba.accessToken'
const deletionKey='minigba.deletionReceiptToken'
const deviceKey='minigba.clientDeviceId'
const apiBase=(process.env.TARO_APP_API_BASE_URL??'').replace(/\/$/,'')

export class CloudConflictError extends Error{constructor(readonly current:CloudSaveHead){super('云端存档已更新');this.name='CloudConflictError'}}

export class CloudClient{
  async login(deviceName:string):Promise<void>{
    if(!apiBase)throw new Error('云服务地址未配置')
    const login=await Taro.login()
    const clientDeviceId=this.clientDeviceId()
    const response=await Taro.request<{accessToken:string}>({url:`${apiBase}/v1/auth/wechat/login`,method:'POST',data:{code:login.code,clientDeviceId,deviceName}})
    if(response.statusCode!==200||!response.data.accessToken)throw new Error('微信登录失败')
    Taro.setStorageSync(tokenKey,response.data.accessToken)
  }
  isLoggedIn():boolean{return Boolean(Taro.getStorageSync(tokenKey))}
  async logout():Promise<void>{try{await Taro.request({url:`${apiBase}/v1/auth/logout`,method:'POST',header:this.headers()})}finally{Taro.removeStorageSync(tokenKey)}}
  async upload(manifest:SaveManifest,bytes:Uint8Array,idempotencyKey:string):Promise<{revision:number;checksum:string}>{
    const url=`${apiBase}/v1/saves/${manifest.romId}/${manifest.kind}/${manifest.slot}`
    const response=await Taro.request<{save?:{revision:number;checksum:string};error?:{code:string;details:unknown}}>({url,method:'PUT',data:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),header:{...this.headers(),'Content-Type':'application/octet-stream','If-Match':`"revision-${manifest.cloudRevision}"`,'Idempotency-Key':idempotencyKey,'X-Content-SHA256':manifest.checksum,'X-Core-Build-ID':manifest.coreBuildId,'X-Device-ID':this.clientDeviceId()}})
    if(response.statusCode===409)throw new CloudConflictError(response.data.error?.details as CloudSaveHead)
    if(response.statusCode!==200||!response.data.save)throw new Error(`云存档上传失败 (${response.statusCode})`)
    return response.data.save
  }
  async download(romId:string,kind:SaveKind,slot:string,revision?:number):Promise<{bytes:Uint8Array;revision:number;checksum:string;coreBuildId:string}>{
    const suffix=revision?`versions/${revision}`:'content'
    const response=await Taro.request<ArrayBuffer>({url:`${apiBase}/v1/saves/${romId}/${kind}/${slot}/${suffix}`,method:'GET',responseType:'arraybuffer',header:this.headers()})
    if(response.statusCode!==200)throw new Error(`云存档下载失败 (${response.statusCode})`)
    return{bytes:new Uint8Array(response.data),revision:Number(response.header['X-Revision']??response.header['x-revision']??0),checksum:String(response.header['X-Content-SHA256']??response.header['x-content-sha256']??''),coreBuildId:String(response.header['X-Core-Build-ID']??response.header['x-core-build-id']??'')}
  }
  async list(romId?:string):Promise<CloudSaveHead[]>{const response=await Taro.request<{saves:CloudSaveHead[]}>({url:`${apiBase}/v1/saves${romId?`/${romId}`:''}`,method:'GET',header:this.headers()});if(response.statusCode!==200)throw new Error(`读取云存档失败 (${response.statusCode})`);return response.data.saves??[]}
  async versions(romId:string,kind:SaveKind,slot:string):Promise<CloudSaveVersion[]>{const response=await Taro.request<{versions:CloudSaveVersion[]}>({url:`${apiBase}/v1/saves/${romId}/${kind}/${slot}/versions`,method:'GET',header:this.headers()});if(response.statusCode!==200)throw new Error(`读取历史版本失败 (${response.statusCode})`);return response.data.versions??[]}
  async restoreVersion(romId:string,kind:SaveKind,slot:string,revision:number,baseRevision:number):Promise<number>{const response=await Taro.request<{save?:{revision:number}}>({url:`${apiBase}/v1/saves/${romId}/${kind}/${slot}/restore`,method:'POST',data:{revision},header:{...this.headers(),'If-Match':`"revision-${baseRevision}"`,'Idempotency-Key':uuid(),'X-Device-ID':this.clientDeviceId()}});if(response.statusCode===409)throw new Error('云端版本已再次更新，请刷新后重试');if(response.statusCode!==200||!response.data.save)throw new Error(`恢复历史版本失败 (${response.statusCode})`);return response.data.save.revision}
  async requestAccountDeletion():Promise<{jobId:string;status:string;updatedAt:string}>{const token=Taro.getStorageSync<string>(tokenKey);const response=await Taro.request<{jobId:string;status:string;updatedAt:string}>({url:`${apiBase}/v1/account/deletion`,method:'POST',header:{...this.headers(),'X-Confirm-Account-Deletion':'DELETE'}});if(response.statusCode!==202)throw new Error(`账号删除请求失败 (${response.statusCode})`);Taro.setStorageSync(deletionKey,token);Taro.removeStorageSync(tokenKey);return response.data}
  async deletionStatus():Promise<{jobId:string;status:string;attempts:number;updatedAt:string}|undefined>{const token=Taro.getStorageSync<string>(deletionKey);if(!token)return undefined;const response=await Taro.request<{jobId:string;status:string;attempts:number;updatedAt:string}>({url:`${apiBase}/v1/account/deletion`,method:'GET',header:{Authorization:`Bearer ${token}`}});if(response.statusCode===404)return undefined;if(response.statusCode!==200)throw new Error(`读取删除进度失败 (${response.statusCode})`);if(response.data.status==='complete')Taro.removeStorageSync(deletionKey);return response.data}
  async deleteSave(romId:string,kind:SaveKind,slot:string):Promise<void>{
    const response=await Taro.request({url:`${apiBase}/v1/saves/${romId}/${kind}/${slot}`,method:'DELETE',header:this.headers()})
    if(response.statusCode!==204&&response.statusCode!==404)throw new Error(`删除云存档失败 (${response.statusCode})`)
  }
  private headers():Record<string,string>{const token=Taro.getStorageSync<string>(tokenKey);if(!token)throw new Error('尚未登录云服务');return{Authorization:`Bearer ${token}`}}
  private clientDeviceId():string{let id=Taro.getStorageSync<string>(deviceKey);if(!id){id=uuid();Taro.setStorageSync(deviceKey,id)}return id}
}

function uuid():string{const bytes=new Uint8Array(16);for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);bytes[6]=(bytes[6]!&0x0f)|0x40;bytes[8]=(bytes[8]!&0x3f)|0x80;const hex=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('');return`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`}

export const cloudClient=new CloudClient()
