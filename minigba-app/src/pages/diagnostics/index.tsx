import Taro,{useDidShow} from '@tarojs/taro'
import {Button,Text,View} from '@tarojs/components'
import {useCallback,useState} from 'react'
import {buildDiagnosticPackage,type DiagnosticPackage} from '../../diagnostics'
import {dataRoot,writeTextAtomic} from '../../platform/fs'
import './index.scss'

export default function DiagnosticsPage(){
  const[value,setValue]=useState<DiagnosticPackage>()
  const refresh=useCallback(()=>setValue(buildDiagnosticPackage()),[]);useDidShow(refresh)
  const exportPackage=async()=>{const current=buildDiagnosticPackage(),path=`${dataRoot}/exports/minigba-diagnostics-${Date.now()}.json`;await writeTextAtomic(path,JSON.stringify(current,null,2));await Taro.shareFileMessage({filePath:path,fileName:'minigba-diagnostics.json'})}
  if(!value)return <View className='page-shell'><View className='empty-state'>正在读取诊断信息</View></View>
  const rows:[string,string][]=[['小程序版本',value.appVersion],['基础库',value.baseLibraryVersion],['核心',value.coreBuildId],['设备',`${value.device.platform} · ${value.device.model}`],['系统',value.device.system],['平均 FPS',String(value.runtime?.averageFps??'尚无样本')],['帧耗时 P95',value.runtime?`${value.runtime.frameTimeP95Ms} ms`:'尚无样本'],['音频欠载',String(value.runtime?.audioUnderruns??0)],['音频溢出',String(value.runtime?.audioOverflows??0)]]
  return <View className='page-shell diagnostics-page'><Text className='eyebrow'>RUNTIME</Text><View className='page-title'>诊断</View><Text className='page-subtitle'>最近一次运行状态</Text><View className='diagnostic-list'>{rows.map(([label,detail])=><View className='diagnostic-row' key={label}><Text>{label}</Text><Text className='mono'>{detail}</Text></View>)}</View><View className='section-title'>最近错误</View>{value.recentErrors.length?<View className='error-list'>{value.recentErrors.map(item=><View className='error-row' key={`${item.occurredAt}-${item.code}`}><Text className='error-code mono'>{item.code}</Text><Text className='error-message'>{item.message}</Text><Text className='error-time'>{formatDate(item.occurredAt)}</Text></View>)}</View>:<View className='empty-errors'>没有记录到运行错误</View>}<Button className='secondary-button export-diagnostic' onClick={()=>exportPackage().catch(showError)}>导出脱敏诊断包</Button></View>
}
const formatDate=(value:string)=>new Date(value).toLocaleString()
const showError=(error:unknown)=>Taro.showModal({title:'诊断导出失败',content:error instanceof Error?error.message:String(error),showCancel:false})
