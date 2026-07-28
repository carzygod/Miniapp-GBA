import Taro from '@tarojs/taro'

const manager = () => Taro.getFileSystemManager()

export const dataRoot = `${Taro.env.USER_DATA_PATH}/minigba`

export async function ensureDirectory(path: string): Promise<void> {
  try { await call<void>('mkdir', { dirPath: path, recursive: true }) }
  catch (error) { if (!String(error).includes('exist')) throw error }
}

export async function readBytes(path: string): Promise<Uint8Array> {
  const result = await call<{ data: ArrayBuffer | string }>('readFile', { filePath: path })
  if (typeof result.data === 'string') throw new Error('Expected binary file data')
  return new Uint8Array(result.data)
}

export async function readText(path: string): Promise<string> {
  const result = await call<{ data: ArrayBuffer | string }>('readFile', { filePath: path, encoding: 'utf8' })
  if (typeof result.data !== 'string') return decodeUtf8(new Uint8Array(result.data))
  return result.data
}

export async function writeBytesAtomic(path: string, value: Uint8Array): Promise<void> {
  await ensureDirectory(path.slice(0, path.lastIndexOf('/')))
  const temporary = `${path}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`
  try {
    await call<void>('writeFile', { filePath: temporary, data: exactArrayBuffer(value) })
    await replace(temporary, path)
  } catch (error) {
    await unlinkIfExists(temporary)
    throw error
  }
}

export async function writeTextAtomic(path: string, value: string): Promise<void> {
  await ensureDirectory(path.slice(0, path.lastIndexOf('/')))
  const temporary = `${path}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`
  try {
    await call<void>('writeFile', { filePath: temporary, data: value, encoding: 'utf8' })
    await replace(temporary, path)
  } catch (error) {
    await unlinkIfExists(temporary)
    throw error
  }
}

export async function exists(path: string): Promise<boolean> {
  try { await call<void>('access', { path }); return true } catch { return false }
}

export async function listDirectory(path: string): Promise<string[]> {
  try { const result = await call<{ files: string[] }>('readdir', { dirPath: path }); return result.files }
  catch (error) { if (String(error).includes('no such')) return []; throw error }
}

export async function unlinkIfExists(path: string): Promise<void> {
  try { await call<void>('unlink', { filePath: path }) }
  catch (error) { if (!String(error).includes('no such')) throw error }
}

async function replace(source: string, target: string): Promise<void> {
  const previous = `${target}.previous`
  await unlinkIfExists(previous)
  if (await exists(target)) await call<void>('rename', { oldPath: target, newPath: previous })
  try { await call<void>('rename', { oldPath: source, newPath: target }) }
  catch (error) {
    if (await exists(previous)) await call<void>('rename', { oldPath: previous, newPath: target })
    throw error
  }
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function call<T>(method: string, options: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const fs = manager() as unknown as Record<string, (input: Record<string, unknown>) => void>
    const operation=fs[method]
    if(!operation){reject(new Error(`FileSystemManager.${method} is unavailable`));return}
    operation({ ...options, success: resolve, fail: reject })
  })
}

function decodeUtf8(bytes:Uint8Array):string{
  let result=''
  for(let i=0;i<bytes.length;){const first=bytes[i++]??0
    if(first<0x80){result+=String.fromCharCode(first);continue}
    const second=bytes[i++]??0
    if(first<0xe0){result+=String.fromCharCode(((first&0x1f)<<6)|(second&0x3f));continue}
    const third=bytes[i++]??0
    if(first<0xf0){result+=String.fromCharCode(((first&0x0f)<<12)|((second&0x3f)<<6)|(third&0x3f));continue}
    const fourth=bytes[i++]??0;const point=((first&7)<<18)|((second&0x3f)<<12)|((third&0x3f)<<6)|(fourth&0x3f);const adjusted=point-0x10000;result+=String.fromCharCode(0xd800+(adjusted>>10),0xdc00+(adjusted&0x3ff))
  }
  return result
}
