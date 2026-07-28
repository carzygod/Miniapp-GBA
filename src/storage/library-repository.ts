import Taro from '@tarojs/taro'
import { LIBRARY_SCHEMA_VERSION, type GameEntry, type LibraryIndex } from '../domain/models'
import { sha256Hex } from '../domain/sha256'
import { dataRoot, ensureDirectory, exists, readBytes, readText, unlinkIfExists, writeBytesAtomic, writeTextAtomic } from '../platform/fs'

const romRoot = `${dataRoot}/roms`
const indexPath = `${dataRoot}/library.json`
const MAX_ROM_BYTES = 32 * 1024 * 1024
const consentKey='minigba.romCopyrightConsent.v1'
const NINTENDO_LOGO=hexBytes('24ffae51699aa2213d84820a84e409ad11248b98c0817f21a352be199309ce2010464a4af82731ec58c7e83382e3cebf85f4df94ce4b09c194568ac01372a7fc9f844d73a3ca9a615897a327fc039876231dc7610304ae56bf38840040a70efdff52fe036f9530f197fbc08560d68025a963be03014e38e2f9a234ffbb3e0344780090cb88113a9465c07c6387f03cafd625e48b380aac7221d4f807')

export class LibraryRepository {
  async list(): Promise<GameEntry[]> {
    const index = await this.loadIndex()
    return [...index.games].sort((a, b) => (b.lastPlayedAt ?? b.importedAt).localeCompare(a.lastPlayedAt ?? a.importedAt))
  }

  async get(romId: string): Promise<GameEntry | undefined> {
    return (await this.loadIndex()).games.find(game => game.romId === romId)
  }

  async chooseAndImport(): Promise<GameEntry> {
    await ensureCopyrightConsent()
    const result = await Taro.chooseMessageFile({ count: 1, type: 'file', extension: ['gba'] })
    const selected = result.tempFiles[0]
    if (!selected) throw new Error('没有选择文件')
    if(selected.size>MAX_ROM_BYTES)throw new Error('ROM 超过 32 MiB 限制')
    const bytes=await readBytes(selected.path);validateGba(bytes)
    if(!hasNintendoLogo(bytes)){
      const warning=await Taro.showModal({title:'ROM 头部异常',content:'Nintendo Logo 校验区不匹配。文件可能是自制程序、损坏文件或非 GBA ROM。仍要导入吗？',confirmText:'仍要导入'})
      if(!warning.confirm)throw new Error('已取消导入')
    }
    return this.storeBytes(bytes,selected.name)
  }

  async importFile(sourcePath: string, fileName: string, declaredSize?: number): Promise<GameEntry> {
    if (!fileName.toLowerCase().endsWith('.gba')) throw new Error('只支持未压缩的 .gba 文件')
    if (declaredSize && declaredSize > MAX_ROM_BYTES) throw new Error('ROM 超过 32 MiB 限制')
    const bytes = await readBytes(sourcePath);validateGba(bytes)
    return this.storeBytes(bytes,fileName)
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

  private async storeBytes(bytes:Uint8Array,fileName:string):Promise<GameEntry>{
    const romId = sha256Hex(bytes)
    const localPath = `${romRoot}/${romId}.gba`
    await ensureDirectory(romRoot)
    if (!(await exists(localPath))) await writeBytesAtomic(localPath, bytes)

    const current = await this.loadIndex()
    const existing = current.games.find(game => game.romId === romId)
    if (existing) return existing
    const header = parseHeader(bytes)
    const entry: GameEntry = {
      romId, title: header.title || fileName.replace(/\.gba$/i, ''), gameCode: header.gameCode,
      fileName, localPath, sizeBytes: bytes.length, importedAt: new Date().toISOString(),
      playTimeSeconds: 0, batterySave: false, cloudState: 'disabled',
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

  async setSaveState(romId: string, batterySave: boolean, cloudState?: GameEntry['cloudState']): Promise<void> {
    const index = await this.loadIndex(); const game = index.games.find(item => item.romId === romId); if (!game) return
    game.batterySave = batterySave; if (cloudState) game.cloudState = cloudState; await this.saveIndex(index)
  }

  private async loadIndex(): Promise<LibraryIndex> {
    await ensureDirectory(dataRoot)
    if (!(await exists(indexPath))) return { schemaVersion: LIBRARY_SCHEMA_VERSION, games: [] }
    try {
      const parsed = JSON.parse(await readText(indexPath)) as LibraryIndex
      if (parsed.schemaVersion !== LIBRARY_SCHEMA_VERSION || !Array.isArray(parsed.games)) throw new Error('unsupported library index')
      return parsed
    } catch (error) {
      if (await exists(`${indexPath}.previous`)) {
        const previous = JSON.parse(await readText(`${indexPath}.previous`)) as LibraryIndex
        if (previous.schemaVersion === LIBRARY_SCHEMA_VERSION && Array.isArray(previous.games)) return previous
      }
      throw error
    }
  }

  private saveIndex(index: LibraryIndex): Promise<void> { return writeTextAtomic(indexPath, JSON.stringify(index)) }
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

async function ensureCopyrightConsent():Promise<void>{
  if(Taro.getStorageSync(consentKey))return
  const result=await Taro.showModal({title:'导入内容确认',content:'请仅导入你自行制作、合法备份或已获授权使用的 GBA ROM。MiniGBA 不提供或上传 ROM。',confirmText:'我已确认'})
  if(!result.confirm)throw new Error('未确认 ROM 使用权')
  Taro.setStorageSync(consentKey,{version:1,acceptedAt:new Date().toISOString()})
}

function hexBytes(hex:string):Uint8Array{const result=new Uint8Array(hex.length/2);for(let index=0;index<result.length;index++)result[index]=Number.parseInt(hex.slice(index*2,index*2+2),16);return result}
