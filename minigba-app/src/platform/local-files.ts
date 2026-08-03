import Taro from '@tarojs/taro'
import {supportsLocalFileTransfer} from './capabilities'

export {supportsLocalFileTransfer} from './capabilities'

export interface LocalFileSelection {
  name: string
  path: string
  size: number
}

export async function chooseLocalFile(extensions:string[]):Promise<LocalFileSelection|undefined>{
  if(!supportsLocalFileTransfer())throw new Error('抖音小程序不提供任意文件选择能力，请通过 ROM 广场或授权 HTTPS 地址导入 ROM。')
  const result=await Taro.chooseMessageFile({count:1,type:'file',extension:extensions})
  const file=result.tempFiles[0]
  return file?{name:file.name,path:file.path,size:file.size}:undefined
}

export async function shareLocalFile(filePath:string,fileName:string):Promise<void>{
  if(!supportsLocalFileTransfer())throw new Error('抖音小程序不提供任意文件分享能力，请使用云存档完成跨设备同步。')
  await Taro.shareFileMessage({filePath,fileName})
}
