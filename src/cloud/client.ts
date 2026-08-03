import Taro from '@tarojs/taro'
import type {CloudSaveHead,SaveKind,SaveManifest} from '../domain/models'
import {setSettingsAccountScope} from '../settings'

export interface CloudSaveVersion {
  romId:string
  kind:SaveKind
  slot:string
  revision:number
  checksum:string
  sizeBytes:number
  coreBuildId:string
  deviceName?:string
  createdAt:string
}

const tokenKey='minigba.accessToken'
const deletionKey='minigba.deletionReceiptToken'
const deviceKey='minigba.clientDeviceId'

export class CloudConflictError extends Error{
  constructor(readonly current:CloudSaveHead){super('云端存档已更新');this.name='CloudConflictError'}
}

export class CloudRequestError extends Error{
  constructor(readonly statusCode:number,message:string){super(message);this.name='CloudRequestError'}
  get terminal():boolean{return[400,401,403,404,413,422].includes(this.statusCode)}
}

export class CloudClient{
  private readonly apiBase:string

  constructor(baseUrl=__MINIGBA_API_BASE_URL__){
    this.apiBase=baseUrl.trim().replace(/\/+$/,'')
  }

  isConfigured():boolean{return /^https:\/\/[^/]+/i.test(this.apiBase)}
  isLoggedIn():boolean{return this.isConfigured()&&this.hasStoredSession()}
  canSync():boolean{return this.isLoggedIn()}

  async login(deviceName:string):Promise<void>{
    const url=this.endpoint('/v1/auth/wechat/login')
    const login=await Taro.login()
    const clientDeviceId=this.clientDeviceId()
    const response=await Taro.request<{accessToken:string;userId:string}>({
      url,
      method:'POST',
      data:{code:login.code,clientDeviceId,deviceName},
    })
    if(response.statusCode!==200||!response.data.accessToken||!response.data.userId)throw new Error('微信登录失败')
    Taro.setStorageSync(tokenKey,response.data.accessToken)
    setSettingsAccountScope(response.data.userId)
  }

  async refresh():Promise<boolean>{
    if(!this.canSync())return false
    const response=await Taro.request<{accessToken?:string;userId?:string}>({
      url:this.endpoint('/v1/auth/refresh'),
      method:'POST',
      header:this.headers(),
    })
    if(response.statusCode===200&&response.data.accessToken&&response.data.userId){
      Taro.setStorageSync(tokenKey,response.data.accessToken)
      setSettingsAccountScope(response.data.userId)
      return true
    }
    if(response.statusCode===401){
      Taro.removeStorageSync(tokenKey)
      setSettingsAccountScope()
      return false
    }
    throw new Error(`云服务会话刷新失败 (${response.statusCode})`)
  }

  async logout():Promise<void>{
    try{
      if(this.canSync())await Taro.request({url:this.endpoint('/v1/auth/logout'),method:'POST',header:this.headers()})
    }finally{
      Taro.removeStorageSync(tokenKey)
      setSettingsAccountScope()
    }
  }

  async upload(manifest:SaveManifest,bytes:Uint8Array,idempotencyKey:string):Promise<{revision:number;checksum:string}>{
    const response=await Taro.request<{save?:{revision:number;checksum:string};error?:{code:string;details:unknown}}>({
      url:this.endpoint(`/v1/saves/${manifest.romId}/${manifest.kind}/${manifest.slot}`),
      method:'PUT',
      data:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),
      header:{...this.headers(),'Content-Type':'application/octet-stream','If-Match':`"revision-${manifest.cloudRevision}"`,'Idempotency-Key':idempotencyKey,'X-Content-SHA256':manifest.checksum,'X-Core-Build-ID':manifest.coreBuildId,'X-Device-ID':this.clientDeviceId()},
    })
    if(response.statusCode===409)throw new CloudConflictError(response.data.error?.details as CloudSaveHead)
    if(response.statusCode!==200||!response.data.save)throw new CloudRequestError(response.statusCode,`云存档上传失败 (${response.statusCode})`)
    return response.data.save
  }

  async download(romId:string,kind:SaveKind,slot:string,revision?:number):Promise<{bytes:Uint8Array;revision:number;checksum:string;coreBuildId:string;sizeBytes:number}>{
    const suffix=revision?`versions/${revision}`:'content'
    const response=await Taro.request<ArrayBuffer>({url:this.endpoint(`/v1/saves/${romId}/${kind}/${slot}/${suffix}`),method:'GET',responseType:'arraybuffer',header:this.headers()})
    if(response.statusCode!==200)throw new CloudRequestError(response.statusCode,`云存档下载失败 (${response.statusCode})`)
    const bytes=new Uint8Array(response.data),sizeBytes=Number(response.header['Content-Length']??response.header['content-length']??-1)
    if(!Number.isSafeInteger(sizeBytes)||sizeBytes!==bytes.length)throw new CloudRequestError(422,'云端存档长度校验失败')
    return{bytes,revision:Number(response.header['X-Revision']??response.header['x-revision']??0),checksum:String(response.header['X-Content-SHA256']??response.header['x-content-sha256']??''),coreBuildId:String(response.header['X-Core-Build-ID']??response.header['x-core-build-id']??''),sizeBytes}
  }

  async list(romId?:string):Promise<CloudSaveHead[]>{
    const response=await Taro.request<{saves:CloudSaveHead[]}>({url:this.endpoint(`/v1/saves${romId?`/${romId}`:''}`),method:'GET',header:this.headers()})
    if(response.statusCode!==200)throw new Error(`读取云存档失败 (${response.statusCode})`)
    return response.data.saves??[]
  }

  async versions(romId:string,kind:SaveKind,slot:string):Promise<CloudSaveVersion[]>{
    const response=await Taro.request<{versions:CloudSaveVersion[]}>({url:this.endpoint(`/v1/saves/${romId}/${kind}/${slot}/versions`),method:'GET',header:this.headers()})
    if(response.statusCode!==200)throw new Error(`读取历史版本失败 (${response.statusCode})`)
    return response.data.versions??[]
  }

  async restoreVersion(romId:string,kind:SaveKind,slot:string,revision:number,baseRevision:number):Promise<number>{
    const response=await Taro.request<{save?:{revision:number}}>({url:this.endpoint(`/v1/saves/${romId}/${kind}/${slot}/restore`),method:'POST',data:{revision},header:{...this.headers(),'If-Match':`"revision-${baseRevision}"`,'Idempotency-Key':uuid(),'X-Device-ID':this.clientDeviceId()}})
    if(response.statusCode===409)throw new Error('云端版本已再次更新，请刷新后重试')
    if(response.statusCode!==200||!response.data.save)throw new Error(`恢复历史版本失败 (${response.statusCode})`)
    return response.data.save.revision
  }

  async requestAccountDeletion():Promise<{jobId:string;status:string;updatedAt:string}>{
    const token=Taro.getStorageSync<string>(tokenKey)
    const response=await Taro.request<{jobId:string;status:string;updatedAt:string}>({url:this.endpoint('/v1/account/deletion'),method:'POST',header:{...this.headers(),'X-Confirm-Account-Deletion':'DELETE'}})
    if(response.statusCode!==202)throw new Error(`账号删除请求失败 (${response.statusCode})`)
    Taro.setStorageSync(deletionKey,token)
    Taro.removeStorageSync(tokenKey)
    setSettingsAccountScope()
    return response.data
  }

  async deletionStatus():Promise<{jobId:string;status:string;attempts:number;updatedAt:string}|undefined>{
    const token=Taro.getStorageSync<string>(deletionKey)
    if(!token)return undefined
    const response=await Taro.request<{jobId:string;status:string;attempts:number;updatedAt:string}>({url:this.endpoint('/v1/account/deletion'),method:'GET',header:{Authorization:`Bearer ${token}`}})
    if(response.statusCode===404)return undefined
    if(response.statusCode!==200)throw new Error(`读取删除进度失败 (${response.statusCode})`)
    if(response.data.status==='complete')Taro.removeStorageSync(deletionKey)
    return response.data
  }

  async deleteSave(romId:string,kind:SaveKind,slot:string):Promise<void>{
    const response=await Taro.request({url:this.endpoint(`/v1/saves/${romId}/${kind}/${slot}`),method:'DELETE',header:this.headers()})
    if(response.statusCode!==204&&response.statusCode!==404)throw new Error(`删除云存档失败 (${response.statusCode})`)
  }

  async deleteRomSaves(romId:string):Promise<void>{
    const response=await Taro.request({url:this.endpoint(`/v1/saves/${romId}`),method:'DELETE',header:this.headers()})
    if(response.statusCode!==204&&response.statusCode!==404)throw new CloudRequestError(response.statusCode,`删除游戏云数据失败 (${response.statusCode})`)
  }

  private endpoint(path:string):string{
    if(!this.isConfigured())throw new Error('云服务 HTTPS 地址未配置')
    return`${this.apiBase}${path}`
  }

  private hasStoredSession():boolean{return Boolean(Taro.getStorageSync(tokenKey))}

  private headers():Record<string,string>{
    const token=Taro.getStorageSync<string>(tokenKey)
    if(!token)throw new Error('尚未登录云服务')
    return{Authorization:`Bearer ${token}`}
  }

  private clientDeviceId():string{
    let id=Taro.getStorageSync<string>(deviceKey)
    if(!id){id=uuid();Taro.setStorageSync(deviceKey,id)}
    return id
  }
}

function uuid():string{
  const bytes=new Uint8Array(16)
  for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256)
  bytes[6]=(bytes[6]!&0x0f)|0x40
  bytes[8]=(bytes[8]!&0x3f)|0x80
  const hex=[...bytes].map(value=>value.toString(16).padStart(2,'0')).join('')
  return`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}

export const cloudClient=new CloudClient()
