import { SAVE_SCHEMA_VERSION, type SaveKind, type SaveManifest } from '../domain/models'
import { sha256Hex } from '../domain/sha256'
import { dataRoot, ensureDirectory, exists, listDirectory, readBytes, readText, unlinkIfExists, writeBytesAtomic, writeTextAtomic } from '../platform/fs'

export interface StoredSave { manifest: SaveManifest; bytes: Uint8Array; path: string; recoveredFromPrevious?: boolean }

export class SaveRepository {
  async commit(romId: string, kind: SaveKind, slot: string, bytes: Uint8Array, coreBuildId: string, cloudRevision?: number): Promise<SaveManifest> {
    validateKey(romId, kind, slot)
    if (!bytes.length) throw new Error('不能保存空存档')
    const directory = this.directory(romId, kind, slot)
    await ensureDirectory(directory)
    const previous = await this.manifest(romId, kind, slot)
    const manifest: SaveManifest = {
      schemaVersion: SAVE_SCHEMA_VERSION, romId, kind, slot,
      checksum: sha256Hex(bytes), sizeBytes: bytes.length, coreBuildId,
      localRevision: (previous?.localRevision ?? 0) + 1,
      cloudRevision: cloudRevision ?? previous?.cloudRevision ?? 0, updatedAt: new Date().toISOString(),
    }
    await writeBytesAtomic(`${directory}/current.bin`, bytes)
    const committed = await readBytes(`${directory}/current.bin`)
    if (committed.length !== bytes.length || sha256Hex(committed) !== manifest.checksum) throw new Error('存档写入后校验失败，已保留上一版本')
    await writeTextAtomic(`${directory}/manifest.json`, JSON.stringify(manifest))
    return manifest
  }

  async load(romId: string, kind: SaveKind, slot: string): Promise<StoredSave | undefined> {
    const manifest = await this.manifest(romId, kind, slot)
    if (!manifest) return undefined
    const path = `${this.directory(romId, kind, slot)}/current.bin`
    try{const bytes=await readBytes(path);if(bytes.length===manifest.sizeBytes&&sha256Hex(bytes)===manifest.checksum)return{manifest,bytes,path}}catch{ /* previous is checked below */ }
    const previousPath=`${path}.previous`,previousManifestPath=`${this.directory(romId,kind,slot)}/manifest.json.previous`
    if(!(await exists(previousPath))||!(await exists(previousManifestPath)))throw new Error('存档校验失败且没有完整的可恢复副本')
    const previous=await readBytes(previousPath),previousManifest=JSON.parse(await readText(previousManifestPath)) as SaveManifest
    if(previousManifest.schemaVersion!==SAVE_SCHEMA_VERSION||previousManifest.romId!==romId||previousManifest.kind!==kind||previousManifest.slot!==slot||previous.length!==previousManifest.sizeBytes||sha256Hex(previous)!==previousManifest.checksum)throw new Error('上一成功存档也未通过校验')
    return{manifest:previousManifest,bytes:previous,path:previousPath,recoveredFromPrevious:true}
  }

  async manifest(romId: string, kind: SaveKind, slot: string): Promise<SaveManifest | undefined> {
    validateKey(romId, kind, slot)
    const path = `${this.directory(romId, kind, slot)}/manifest.json`
    let source=path
    if (!(await exists(source))) {source=`${path}.previous`;if(!(await exists(source)))return undefined}
    let value:SaveManifest
    try{value=JSON.parse(await readText(source)) as SaveManifest}catch(error){const previous=`${path}.previous`;if(source===previous||!(await exists(previous)))throw error;value=JSON.parse(await readText(previous)) as SaveManifest}
    if (value.schemaVersion !== SAVE_SCHEMA_VERSION || value.romId !== romId || value.kind !== kind || value.slot !== slot) throw new Error('存档清单无效')
    return value
  }

  async list(romId?: string): Promise<SaveManifest[]> {
    const roots = romId ? [romId] : await listDirectory(`${dataRoot}/saves`)
    const results: SaveManifest[] = []
    for (const id of roots) for (const kind of ['battery','state','auto_state'] as const) {
      const slots = await listDirectory(`${dataRoot}/saves/${id}/${kind}`)
      for (const slot of slots) { const manifest = await this.manifest(id,kind,slot); if (manifest) results.push(manifest) }
    }
    return results.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))
  }

  async remove(romId: string, kind: SaveKind, slot: string): Promise<void> {
    const directory=this.directory(romId,kind,slot)
    for(const name of ['current.bin','current.bin.previous','manifest.json','manifest.json.previous','preview.png','preview.png.previous']) await unlinkIfExists(`${directory}/${name}`)
  }

  async removeAll(romId:string):Promise<void>{
    for(const manifest of await this.list(romId))await this.remove(romId,manifest.kind,manifest.slot)
  }

  async updateCloudRevision(romId:string,kind:SaveKind,slot:string,cloudRevision:number):Promise<SaveManifest>{const manifest=await this.manifest(romId,kind,slot);if(!manifest)throw new Error('本地存档不存在');const updated={...manifest,cloudRevision};await writeTextAtomic(`${this.directory(romId,kind,slot)}/manifest.json`,JSON.stringify(updated));return updated}

  async storeConflictCopy(romId:string,kind:SaveKind,slot:string,source:'local'|'cloud',bytes:Uint8Array,metadata:Record<string,unknown>):Promise<string>{
    validateKey(romId,kind,slot);if(!bytes.length)throw new Error('冲突副本不能为空')
    const id=`${new Date().toISOString().replace(/[:.]/g,'-')}-${source}`;const directory=`${this.directory(romId,kind,slot)}/conflicts`;await ensureDirectory(directory)
    const path=`${directory}/${id}.bin`;await writeBytesAtomic(path,bytes);const committed=await readBytes(path);const checksum=sha256Hex(committed);if(committed.length!==bytes.length||checksum!==sha256Hex(bytes))throw new Error('冲突副本校验失败')
    await writeTextAtomic(`${directory}/${id}.json`,JSON.stringify({schemaVersion:SAVE_SCHEMA_VERSION,source,romId,kind,slot,checksum,sizeBytes:bytes.length,createdAt:new Date().toISOString(),...metadata}))
    return path
  }

  async storePreview(romId:string,kind:SaveKind,slot:string,png:Uint8Array):Promise<string>{
    validateKey(romId,kind,slot);if(kind==='battery')throw new Error('电池存档不使用状态预览')
    if(png.length<8||png[0]!==0x89||png[1]!==0x50||png[2]!==0x4e||png[3]!==0x47)throw new Error('状态预览不是有效 PNG')
    const path=this.previewPath(romId,kind,slot);await writeBytesAtomic(path,png);const committed=await readBytes(path);if(committed.length!==png.length||sha256Hex(committed)!==sha256Hex(png))throw new Error('状态预览写入校验失败');return path
  }

  previewPath(romId:string,kind:SaveKind,slot:string):string{validateKey(romId,kind,slot);return`${this.directory(romId,kind,slot)}/preview.png`}

  contentPath(romId:string,kind:SaveKind,slot:string):string{validateKey(romId,kind,slot);return`${this.directory(romId,kind,slot)}/current.bin`}

  private directory(romId:string,kind:SaveKind,slot:string):string{return `${dataRoot}/saves/${romId}/${kind}/${slot}`}
}

function validateKey(romId:string,kind:SaveKind,slot:string):void{
  if(!/^[0-9a-f]{64}$/.test(romId))throw new Error('ROM ID 无效')
  if(!['battery','state','auto_state'].includes(kind))throw new Error('存档类型无效')
  if(!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(slot))throw new Error('存档槽无效')
  if(kind==='battery'&&slot!=='current')throw new Error('电池存档槽必须为 current')
}
