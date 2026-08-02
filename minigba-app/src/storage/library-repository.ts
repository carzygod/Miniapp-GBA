import Taro from '@tarojs/taro'
import { unzipSync } from 'fflate'
import { LIBRARY_SCHEMA_VERSION, type GameEntry, type LibraryIndex, type RomCatalogItem } from '../domain/models'
import { sha256Hex } from '../domain/sha256'
import { dataRoot, ensureDirectory, exists, fileSize, listFilesRecursive, moveFile, readBytes, readText, unlinkIfExists, writeBytesAtomic, writeTextAtomic } from '../platform/fs'

const romRoot = `${dataRoot}/roms`
const indexPath = `${dataRoot}/library.json`
export const MAX_ROM_BYTES = 32 * 1024 * 1024
const MAX_ZIP_BYTES = 32 * 1024 * 1024
const MAX_ZIP_ENTRIES = 64
const MAX_COMPRESSION_RATIO = 100
const consentKey='minigba.romCopyrightConsent.v1'
const configuredHosts=typeof __MINIGBA_ROM_DOWNLOAD_HOSTS__==='string'?__MINIGBA_ROM_DOWNLOAD_HOSTS__:''
const authorizedHosts = new Set(configuredHosts.split(',').map(value=>value.trim().toLowerCase()).filter(Boolean))
const NINTENDO_LOGO=hexBytes('24ffae51699aa2213d84820a84e409ad11248b98c0817f21a352be199309ce2010464a4af82731ec58c7e83382e3cebf85f4df94ce4b09c194568ac01372a7fc9f844d73a3ca9a615897a327fc039876231dc7610304ae56bf38840040a70efdff52fe036f9530f197fbc08560d68025a963be03014e38e2f9a234ffbb3e0344780090cb88113a9465c07c6387f03cafd625e48b380aac7221d4f807')

export class LibraryRepository {
  async list(): Promise<GameEntry[]> {
    const index = await this.loadIndex()
    return [...index.games].sort((a, b) => (b.lastPlayedAt ?? b.importedAt).localeCompare(a.lastPlayedAt ?? a.importedAt))
  }

  async get(romId: string): Promise<GameEntry | undefined> {
    return (await this.loadIndex()).games.find(game => game.romId === romId)
  }

  async getByCatalogId(catalogId: string): Promise<GameEntry | undefined> {
    return (await this.loadIndex()).games.find(game => game.catalogId === catalogId)
  }

  async chooseAndImport(): Promise<GameEntry> {
    await ensureCopyrightConsent()
    const result = await Taro.chooseMessageFile({ count: 1, type: 'file', extension: ['gba','zip'] })
    const selected = result.tempFiles[0]
    if (!selected) throw new Error('没有选择文件')
    const isZip=selected.name.toLowerCase().endsWith('.zip')
    if(selected.size>(isZip?MAX_ZIP_BYTES:MAX_ROM_BYTES))throw new Error(isZip?'ZIP 超过 32 MiB 限制':'ROM 超过 32 MiB 限制')
    const source=await readBytes(selected.path)
    const extracted=isZip?extractSingleGbaZip(source):{bytes:source,fileName:selected.name}
    validateGba(extracted.bytes)
    await confirmHeaderRisk(extracted.bytes)
    return this.storeBytes(extracted.bytes,extracted.fileName,isZip?'zip':'wechat-message-file')
  }

  async importFile(sourcePath: string, fileName: string, declaredSize?: number): Promise<GameEntry> {
    const isZip=fileName.toLowerCase().endsWith('.zip')
    if (!isZip&&!fileName.toLowerCase().endsWith('.gba')) throw new Error('只支持 .gba 或单 ROM .zip 文件')
    const actualSize=declaredSize??await fileSize(sourcePath)
    if (actualSize > (isZip?MAX_ZIP_BYTES:MAX_ROM_BYTES)) throw new Error(isZip?'ZIP 超过 32 MiB 限制':'ROM 超过 32 MiB 限制')
    const source=await readBytes(sourcePath)
    const extracted=isZip?extractSingleGbaZip(source):{bytes:source,fileName}
    validateGba(extracted.bytes);await confirmHeaderRisk(extracted.bytes)
    return this.storeBytes(extracted.bytes,extracted.fileName,isZip?'zip':'wechat-message-file')
  }

  async importAuthorizedDownload(url:string,expectedSize:number,displayName?:string):Promise<GameEntry>{
    await ensureCopyrightConsent()
    const parsed=new URL(url)
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash)throw new Error('授权 ROM 地址必须使用无凭证、无片段的 HTTPS')
    if(!authorizedHosts.size||!authorizedHosts.has(parsed.host.toLowerCase()))throw new Error('该域名不在授权 ROM 下载白名单中')
    if(!Number.isInteger(expectedSize)||expectedSize<0xc0||expectedSize>MAX_ROM_BYTES)throw new Error('授权 ROM 长度无效')
    const response=await Taro.downloadFile({url:parsed.toString(),timeout:30_000})
    if(response.statusCode!==200)throw new Error(`授权 ROM 下载失败 (${response.statusCode})`)
    if(response.dataLength!==undefined&&response.dataLength!==expectedSize)throw new Error('下载响应长度与授权清单不一致')
    const actualSize=await fileSize(response.tempFilePath)
    if(actualSize!==expectedSize)throw new Error('下载文件长度与授权清单不一致')
    const bytes=await readBytes(response.tempFilePath)
    validateGba(bytes);await confirmHeaderRisk(bytes)
    const fileName=(displayName?.trim()||decodeURIComponent(parsed.pathname.split('/').pop()||'authorized.gba')).replace(/\.gba$/i,'')+'.gba'
    return this.storeBytes(bytes,fileName,'authorized-download')
  }

  async importCatalogItem(item:RomCatalogItem,onProgress?:(progress:number)=>void):Promise<GameEntry>{
    await ensureCopyrightConsent()
    const parsed=new URL(item.downloadUrl)
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash)throw new Error('ROM 广场下载地址必须使用无凭证、无片段的 HTTPS')
    if(!authorizedHosts.size||!authorizedHosts.has(parsed.host.toLowerCase()))throw new Error('ROM 广场域名不在发布白名单中')
    if(!Number.isInteger(item.sizeBytes)||item.sizeBytes<0xc0||item.sizeBytes>MAX_ROM_BYTES)throw new Error('ROM 广场长度无效')
    const task=Taro.downloadFile({url:parsed.toString(),timeout:30_000})
    task.progress?.(event=>onProgress?.(Math.max(0,Math.min(100,event.progress))))
    const response=await task
    if(response.statusCode!==200)throw new Error(`ROM 下载失败 (${response.statusCode})`)
    if(response.dataLength!==undefined&&response.dataLength!==item.sizeBytes)throw new Error('下载响应长度与 ROM 目录不一致')
    const actualSize=await fileSize(response.tempFilePath)
    if(actualSize!==item.sizeBytes)throw new Error('下载文件长度与 ROM 目录不一致')
    const bytes=await readBytes(response.tempFilePath)
    validateGba(bytes);await confirmHeaderRisk(bytes)
    const entry=await this.storeBytes(bytes,`${safeFileName(item.title)}.gba`,'r2-catalog')
    const index=await this.loadIndex(),stored=index.games.find(game=>game.romId===entry.romId)
    if(!stored)throw new Error('ROM 已写入但游戏库索引缺失')
    stored.title=item.title;stored.gameCode=item.gameCode||stored.gameCode;stored.coverUrl=item.coverUrl;stored.description=item.description;stored.genres=[...item.genres];stored.region=item.region;stored.language=item.language;stored.licenseName=item.license?.name;stored.catalogId=item.id;stored.catalogObjectKey=item.objectKey;stored.catalogEtag=item.etag;stored.catalogUpdatedAt=item.updatedAt
    await this.saveIndex(index)
    return stored
  }

  async repairLibrary():Promise<{added:number;removed:number;quarantined:number}>{
    const before=await this.readIndexCandidate()
    const old=before?.games??[]
    const rebuilt=await this.scanRomFiles(old)
    await this.saveIndex(rebuilt.index)
    const oldIds=new Set(old.map(item=>item.romId)),newIds=new Set(rebuilt.index.games.map(item=>item.romId))
    return{added:[...newIds].filter(id=>!oldIds.has(id)).length,removed:[...oldIds].filter(id=>!newIds.has(id)).length,quarantined:rebuilt.quarantined}
  }

  async rename(romId:string,title:string):Promise<void>{
    const clean=title.trim().slice(0,40);if(!clean)throw new Error('显示名称不能为空')
    const index=await this.loadIndex(),game=index.games.find(item=>item.romId===romId);if(!game)throw new Error('游戏不存在')
    game.title=clean;await this.saveIndex(index)
  }

  async removeRom(romId:string):Promise<void>{
    const index=await this.loadIndex(),position=index.games.findIndex(item=>item.romId===romId);if(position<0)return
    const [game]=index.games.splice(position,1);await this.saveIndex(index);if(game)await unlinkIfExists(game.localPath)
  }

  private async storeBytes(bytes:Uint8Array,fileName:string,source:GameEntry['source']='wechat-message-file'):Promise<GameEntry>{
    const romId = sha256Hex(bytes)
    const localPath = romPath(romId)
    await ensureDirectory(localPath.slice(0,localPath.lastIndexOf('/')))
    if (!(await exists(localPath))) await writeBytesAtomic(localPath, bytes)

    const current = await this.loadIndex()
    const existing = current.games.find(game => game.romId === romId)
    if (existing) return existing
    const header = parseHeader(bytes)
    const entry: GameEntry = {
      romId, title: header.title || fileName.replace(/\.gba$/i, ''), gameCode: header.gameCode,
      fileName, localPath, sizeBytes: bytes.length, importedAt: new Date().toISOString(),
      playTimeSeconds: 0, batterySave: false, cloudState: 'disabled',source,
    }
    current.games.push(entry)
    await this.saveIndex(current)
    return entry
  }

  async markPlayed(romId: string, seconds: number): Promise<void> {
    const index = await this.loadIndex()
    const game = index.games.find(item => item.romId === romId)
    if (!game) return
    game.lastPlayedAt = new Date().toISOString()
    game.playTimeSeconds += Math.max(0, Math.floor(seconds))
    await this.saveIndex(index)
  }

  async setSaveState(romId: string, batterySave: boolean, cloudState?: GameEntry['cloudState'],syncError?:string): Promise<void> {
    const index = await this.loadIndex(); const game = index.games.find(item => item.romId === romId); if (!game) return
    game.batterySave = batterySave
    if (cloudState) {
      game.cloudState = cloudState
      game.syncError=syncError?.slice(0,160)
      if(cloudState==='synced')game.lastSyncedAt=new Date().toISOString()
    }
    await this.saveIndex(index)
  }

  async setCloudState(romId:string,cloudState:GameEntry['cloudState'],syncError?:string):Promise<void>{
    const index=await this.loadIndex(),game=index.games.find(item=>item.romId===romId);if(!game)return
    game.cloudState=cloudState;game.syncError=syncError?.slice(0,160);if(cloudState==='synced')game.lastSyncedAt=new Date().toISOString();await this.saveIndex(index)
  }

  private async loadIndex(): Promise<LibraryIndex> {
    await ensureDirectory(dataRoot)
    if (!(await exists(indexPath))) return { schemaVersion: LIBRARY_SCHEMA_VERSION, games: [] }
    const candidate=await this.readIndexCandidate()
    if(candidate)return candidate
    const rebuilt=await this.scanRomFiles([]);await this.saveIndex(rebuilt.index);return rebuilt.index
  }

  private saveIndex(index: LibraryIndex): Promise<void> { return writeTextAtomic(indexPath, JSON.stringify(index)) }

  private async readIndexCandidate():Promise<LibraryIndex|undefined>{
    for(const path of [indexPath,`${indexPath}.previous`]){
      if(!(await exists(path)))continue
      try{
        const parsed=JSON.parse(await readText(path)) as {schemaVersion?:number;games?:GameEntry[];entries?:GameEntry[]}
        const games=parsed.games??parsed.entries
        if((parsed.schemaVersion!==1&&parsed.schemaVersion!==LIBRARY_SCHEMA_VERSION)||!Array.isArray(games))continue
        return{schemaVersion:LIBRARY_SCHEMA_VERSION,games:games.filter(item=>/^[0-9a-f]{64}$/.test(item.romId)).map(item=>({...item,source:item.source??'recovered'}))}
      }catch{continue}
    }
    return undefined
  }

  private async scanRomFiles(previous:GameEntry[]):Promise<{index:LibraryIndex;quarantined:number}>{
    const metadata=new Map(previous.map(item=>[item.romId,item])),games:GameEntry[]=[],seen=new Set<string>()
    let quarantined=0
    for(const file of await listFilesRecursive(romRoot)){
      if(!file.path.toLowerCase().endsWith('.gba'))continue
      try{
        if(file.size<0xc0||file.size>MAX_ROM_BYTES)throw new Error('ROM size invalid')
        const bytes=await readBytes(file.path);validateGba(bytes)
        const romId=sha256Hex(bytes),canonical=romPath(romId)
        if(seen.has(romId)){if(file.path!==canonical)await unlinkIfExists(file.path);continue}
        if(file.path!==canonical){if(await exists(canonical))await unlinkIfExists(file.path);else await moveFile(file.path,canonical)}
        const prior=metadata.get(romId),header=parseHeader(bytes)
        const modifiedAt=file.modifiedAt>0?(file.modifiedAt<1e12?file.modifiedAt*1000:file.modifiedAt):Date.now()
        games.push(prior?{...prior,localPath:canonical,sizeBytes:bytes.length}:{romId,title:header.title||'Recovered ROM',gameCode:header.gameCode,fileName:`${romId}.gba`,localPath:canonical,sizeBytes:bytes.length,importedAt:new Date(modifiedAt).toISOString(),playTimeSeconds:0,batterySave:false,cloudState:'disabled',source:'recovered'})
        seen.add(romId)
      }catch{
        const target=`${dataRoot}/quarantine/${Date.now()}-${quarantined}.gba.bad`
        await moveFile(file.path,target);quarantined++
      }
    }
    return{index:{schemaVersion:LIBRARY_SCHEMA_VERSION,games},quarantined}
  }
}

export function validateGba(bytes: Uint8Array): void {
  if (bytes.length < 0xC0 || bytes.length > MAX_ROM_BYTES) throw new Error('ROM 大小无效')
  if (bytes[3] !== 0xEA || bytes[0xB2] !== 0x96) throw new Error('文件头不是有效的 GBA ROM')
}

export function hasNintendoLogo(bytes:Uint8Array):boolean{
  if(bytes.length<0xa0)return false
  for(let index=0;index<NINTENDO_LOGO.length;index++)if(bytes[index+4]!==NINTENDO_LOGO[index])return false
  return true
}

export function parseHeader(bytes: Uint8Array): { title: string; gameCode: string } {
  const decode = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length)).replace(/[\0\xff]/g, '').trim()
  return { title: decode(0xA0, 12), gameCode: decode(0xAC, 4) }
}

export function headerChecksumValid(bytes:Uint8Array):boolean{
  if(bytes.length<0xbe)return false
  let checksum=0
  for(let index=0xa0;index<=0xbc;index++)checksum=(checksum-(bytes[index]??0)-1)&0xff
  return checksum===(bytes[0xbd]??-1)
}

export function extractSingleGbaZip(archive:Uint8Array):{bytes:Uint8Array;fileName:string}{
  if(!archive.length||archive.length>MAX_ZIP_BYTES)throw new Error('ZIP 大小无效')
  let entries=0,totalSize=0
  const candidates:string[]=[]
  const unpacked=unzipSync(archive,{filter:file=>{
    entries++;if(entries>MAX_ZIP_ENTRIES)throw new Error('ZIP 条目过多')
    if(!safeZipPath(file.name))throw new Error('ZIP 包含不安全路径')
    totalSize+=file.originalSize;if(totalSize>MAX_ROM_BYTES)throw new Error('ZIP 解压后总大小超过 32 MiB')
    if(file.originalSize>0&&(file.size===0||file.originalSize/file.size>MAX_COMPRESSION_RATIO))throw new Error('ZIP 压缩比异常')
    if(file.name.toLowerCase().endsWith('.gba'))candidates.push(file.name)
    return file.name.toLowerCase().endsWith('.gba')
  }})
  if(candidates.length!==1)throw new Error(candidates.length?'ZIP 包含多个 GBA ROM':'ZIP 中没有 GBA ROM')
  const bytes=unpacked[candidates[0]!]
  if(!bytes||bytes.length<0xc0||bytes.length>MAX_ROM_BYTES)throw new Error('ZIP 中 ROM 大小无效')
  return{bytes,fileName:candidates[0]!.split('/').pop()!}
}

async function ensureCopyrightConsent():Promise<void>{
  if(Taro.getStorageSync(consentKey))return
  const result=await Taro.showModal({title:'导入内容确认',content:'请仅导入你自行制作、合法备份或已获授权使用的 GBA ROM。MiniGBA 不提供或上传 ROM。',confirmText:'我已确认'})
  if(!result.confirm)throw new Error('未确认 ROM 使用权')
  Taro.setStorageSync(consentKey,{version:1,acceptedAt:new Date().toISOString()})
}

async function confirmHeaderRisk(bytes:Uint8Array):Promise<void>{
  const warnings=[]
  if(!hasNintendoLogo(bytes))warnings.push('Nintendo Logo 校验区不匹配')
  if(!headerChecksumValid(bytes))warnings.push('Header checksum 不匹配')
  if(!warnings.length)return
  const warning=await Taro.showModal({title:'ROM 头部异常',content:`${warnings.join('；')}。文件可能是自制程序、损坏文件或非标准 ROM。仍要导入吗？`,confirmText:'仍要导入'})
  if(!warning.confirm)throw new Error('已取消导入')
}

function safeZipPath(path:string):boolean{
  const normalized=path.replace(/\\/g,'/')
  return Boolean(normalized)&&!normalized.startsWith('/')&&!/^[a-zA-Z]:/.test(normalized)&&!normalized.includes('\0')&&!normalized.split('/').includes('..')
}

function romPath(romId:string):string{return`${romRoot}/${romId.slice(0,2)}/${romId.slice(2,4)}/${romId}.gba`}

function safeFileName(value:string):string{return value.replace(/[\\/:*?"<>|]/g,'_').trim().slice(0,80)||'authorized-rom'}

function hexBytes(hex:string):Uint8Array{const result=new Uint8Array(hex.length/2);for(let index=0;index<result.length;index++)result[index]=Number.parseInt(hex.slice(index*2,index*2+2),16);return result}
