import Taro from '@tarojs/taro'
import {ROM_CATALOG_SCHEMA_VERSION,type RomCatalog,type RomCatalogItem} from '../domain/models'

const catalogUrl=typeof __MINIGBA_ROM_CATALOG_URL__==='string'?__MINIGBA_ROM_CATALOG_URL__.trim():''
const configuredHosts=typeof __MINIGBA_ROM_DOWNLOAD_HOSTS__==='string'?__MINIGBA_ROM_DOWNLOAD_HOSTS__:''
const authorizedHosts=new Set(configuredHosts.split(',').map(value=>value.trim().toLowerCase()).filter(Boolean))
const cacheKey='minigba.romCatalog.v2'
const cacheTtlMs=15*60*1000
const maxCatalogItems=2000
const maxRomBytes=32*1024*1024

interface CatalogCache{sourceUrl:string;fetchedAt:string;catalog:RomCatalog}
export interface CatalogSnapshot{catalog:RomCatalog;stale:boolean;fetchedAt:string}

export class RomCatalogClient{
  configured():boolean{return Boolean(catalogUrl)}
  sourceUrl():string{return catalogUrl}

  async list(options:{force?:boolean}={}):Promise<CatalogSnapshot>{
    const cached=this.cached()
    if(!options.force&&cached&&Date.now()-Date.parse(cached.fetchedAt)<cacheTtlMs)return{catalog:cached.catalog,stale:false,fetchedAt:cached.fetchedAt}
    if(!catalogUrl)throw new Error('ROM 广场尚未配置目录地址')
    assertAuthorizedUrl(catalogUrl,'ROM 目录')
    try{
      const response=await Taro.request<unknown>({url:catalogUrl,method:'GET',timeout:15_000,header:{Accept:'application/json'}})
      if(response.statusCode!==200)throw new Error(`ROM 目录读取失败 (${response.statusCode})`)
      const catalog=parseRomCatalog(response.data,catalogUrl)
      const value:CatalogCache={sourceUrl:catalogUrl,fetchedAt:new Date().toISOString(),catalog}
      Taro.setStorageSync(cacheKey,value)
      return{catalog,stale:false,fetchedAt:value.fetchedAt}
    }catch(error){
      if(cached)return{catalog:cached.catalog,stale:true,fetchedAt:cached.fetchedAt}
      throw error
    }
  }

  async find(id:string):Promise<RomCatalogItem|undefined>{return(await this.list()).catalog.items.find(item=>item.id===id)}

  clearCache():void{Taro.removeStorageSync(cacheKey)}

  private cached():CatalogCache|undefined{
    const value=Taro.getStorageSync<CatalogCache>(cacheKey)
    if(!value||value.sourceUrl!==catalogUrl||typeof value.fetchedAt!=='string')return undefined
    try{return{...value,catalog:parseRomCatalog(value.catalog,catalogUrl)}}catch{return undefined}
  }
}

export function parseRomCatalog(input:unknown,sourceUrl:string):RomCatalog{
  if(!input||typeof input!=='object')throw new Error('ROM 目录不是 JSON 对象')
  const value=input as Record<string,unknown>
  if(value.schemaVersion!==ROM_CATALOG_SCHEMA_VERSION)throw new Error('ROM 目录版本不受支持')
  if(!validDate(value.generatedAt))throw new Error('ROM 目录生成时间无效')
  const bucket=shortText(value.bucket,64,'R2 bucket')
  if(bucket!=='rom')throw new Error('ROM 目录 bucket 必须是 rom')
  if(!Array.isArray(value.items)||value.items.length>maxCatalogItems)throw new Error('ROM 目录条目数量无效')
  const seenIds=new Set<string>(),seenObjectKeys=new Set<string>()
  const items=value.items.map((candidate,index)=>parseItem(candidate,sourceUrl,index,seenIds,seenObjectKeys))
  return{schemaVersion:ROM_CATALOG_SCHEMA_VERSION,generatedAt:value.generatedAt as string,bucket,items}
}

function parseItem(input:unknown,sourceUrl:string,index:number,seenIds:Set<string>,seenObjectKeys:Set<string>):RomCatalogItem{
  if(!input||typeof input!=='object')throw new Error(`ROM 目录第 ${index+1} 项无效`)
  const value=input as Record<string,unknown>
  const id=typeof value.id==='string'?value.id.trim():''
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)||seenIds.has(id))throw new Error(`ROM 目录第 ${index+1} 项的 ID 无效或重复`)
  seenIds.add(id)
  const title=shortText(value.title,128,'ROM 标题')
  const objectKey=shortText(value.objectKey,400,'R2 对象键')
  if(!validObjectKey(objectKey)||seenObjectKeys.has(objectKey))throw new Error(`${title} 的 R2 对象键无效或重复`)
  seenObjectKeys.add(objectKey)
  const etag=value.etag===undefined?undefined:shortText(value.etag,128,'R2 ETag')
  const gameCode=value.gameCode===undefined?undefined:shortText(value.gameCode,12,'游戏代码')
  const sizeBytes=Number(value.sizeBytes)
  if(!Number.isInteger(sizeBytes)||sizeBytes<0xc0||sizeBytes>maxRomBytes)throw new Error(`${title} 的 ROM 长度无效`)
  const downloadUrl=resolveAuthorizedUrl(value.downloadUrl,sourceUrl,`${title} 下载地址`)
  if(decodedPath(downloadUrl)!==`/${objectKey}`)throw new Error(`${title} 的下载地址与 R2 对象键不一致`)
  const coverUrl=value.coverUrl===undefined?undefined:resolveAuthorizedUrl(value.coverUrl,sourceUrl,`${title} 封面地址`)
  const genres=parseTags(value.genres,title)
  const license=value.license===undefined?undefined:parseLicense(value.license,title)
  return{
    id,title,objectKey,etag,gameCode,downloadUrl,sizeBytes,genres,license,coverUrl,
    description:optionalText(value.description,240,'简介'),region:optionalText(value.region,24,'地区'),language:optionalText(value.language,32,'语言'),
    featured:value.featured===true,updatedAt:value.updatedAt===undefined?undefined:validDate(value.updatedAt)?value.updatedAt as string:invalid(`${title} 的更新时间无效`),
  }
}

function parseLicense(input:unknown,title:string):RomCatalogItem['license']{
  if(!input||typeof input!=='object')throw new Error(`${title} 缺少分发许可`)
  const value=input as Record<string,unknown>,name=shortText(value.name,80,'许可名称')
  const url=value.url===undefined?undefined:assertHttpsUrl(shortText(value.url,300,'许可地址'),'许可地址').toString()
  return{name,url,notice:optionalText(value.notice,240,'许可说明')}
}

function parseTags(input:unknown,title:string):string[]{
  if(input===undefined)return[]
  if(!Array.isArray(input)||input.length>8)throw new Error(`${title} 的分类无效`)
  return[...new Set(input.map(value=>shortText(value,24,'ROM 分类')))]
}

function resolveAuthorizedUrl(input:unknown,base:string,label:string):string{
  const raw=shortText(input,600,label)
  let resolved:string
  try{resolved=new URL(raw,base).toString()}catch{throw new Error(`${label}无效`)}
  assertAuthorizedUrl(resolved,label)
  return resolved
}

function assertAuthorizedUrl(value:string,label:string):void{
  const parsed=assertHttpsUrl(value,label)
  if(!authorizedHosts.size||!authorizedHosts.has(parsed.host.toLowerCase()))throw new Error(`${label}域名不在发布白名单中`)
}

function assertHttpsUrl(value:string,label:string):URL{
  let parsed:URL
  try{parsed=new URL(value)}catch{throw new Error(`${label}无效`)}
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash)throw new Error(`${label}必须是无凭证、无片段的 HTTPS 地址`)
  return parsed
}

function shortText(value:unknown,max:number,label:string):string{if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new Error(`${label}无效`);return value.trim()}
function optionalText(value:unknown,max:number,label:string):string|undefined{return value===undefined?undefined:shortText(value,max,label)}
function validObjectKey(value:string):boolean{const segments=value.split('/');return value.startsWith('gba/')&&value.toLowerCase().endsWith('.gba')&&!/[\\\0\r\n]/.test(value)&&segments.every(segment=>Boolean(segment)&&segment!=='.'&&segment!=='..')}
function decodedPath(value:string):string{try{return decodeURIComponent(new URL(value).pathname)}catch{return''}}
function validDate(value:unknown):boolean{return typeof value==='string'&&Number.isFinite(Date.parse(value))}
function invalid(message:string):never{throw new Error(message)}

export const romCatalogClient=new RomCatalogClient()
