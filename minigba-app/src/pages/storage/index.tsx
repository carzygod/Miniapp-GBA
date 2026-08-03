import Taro,{useDidShow} from '@tarojs/taro'
import {Button,Text,View} from '@tarojs/components'
import {useCallback,useState} from 'react'
import {errorMessage} from '../../platform/error'
import {calculateStorageUsage,clearQuarantine,clearScreenshots,clearTemporaryFiles,type StorageUsage} from '../../storage/storage-maintenance'
import './index.scss'

const emptyUsage:StorageUsage={roms:0,batterySaves:0,stateSaves:0,playHistory:0,screenshots:0,temporary:0,quarantine:0,other:0,total:0}

export default function StoragePage(){
  const[usage,setUsage]=useState(emptyUsage);const[busy,setBusy]=useState(false)
  const refresh=useCallback(async()=>setUsage(await calculateStorageUsage()),[])
  useDidShow(()=>{refresh().catch(showError)})
  const clearCache=async()=>{const result=await Taro.showModal({title:'清理临时文件',content:'只删除下载临时文件和已导出的副本，不删除 ROM、正式存档、状态存档或截图。',confirmText:'清理'});if(!result.confirm)return;await run(clearTemporaryFiles)}
  const clearDurable=async(kind:'screenshots'|'quarantine')=>{const label=kind==='screenshots'?'全部截图':'隔离文件';const first=await Taro.showModal({title:`删除${label}`,content:`将永久删除${label}，ROM 和正式存档不受影响。`,confirmText:'继续',confirmColor:'#d43c62'});if(!first.confirm)return;const second=await Taro.showModal({title:'再次确认',content:'该操作无法撤销。',confirmText:'确认删除',confirmColor:'#d43c62'});if(!second.confirm)return;await run(kind==='screenshots'?clearScreenshots:clearQuarantine)}
  const run=async(action:()=>Promise<void>)=>{setBusy(true);try{await action();await refresh();Taro.showToast({title:'清理完成',icon:'success'})}catch(error){showError(error)}finally{setBusy(false)}}
  const rows:[string,number,string][]=[['ROM',usage.roms,'正式游戏文件'],['电池存档',usage.batterySaves,'SRAM / Flash / EEPROM'],['状态存档',usage.stateSaves,'手动槽与自动恢复点'],['游玩记录',usage.playHistory,'最近 500 次会话'],['截图',usage.screenshots,'本地画面截图'],['临时文件',usage.temporary,'可安全清理'],['隔离文件',usage.quarantine,'校验失败内容'],['其他',usage.other,'索引与同步元数据']]
  return <View className='page-shell storage-page'><Text className='eyebrow'>LOCAL DATA</Text><View className='page-title'>存储管理</View><Text className='page-subtitle'>合计 {formatBytes(usage.total)}</Text><View className='usage-list'>{rows.map(([label,value,detail])=><View className='usage-row' key={label}><View><Text className='usage-title'>{label}</Text><Text className='usage-detail'>{detail}</Text></View><Text className='usage-value mono'>{formatBytes(value)}</Text></View>)}</View><View className='storage-actions'><Button className='secondary-button' loading={busy} onClick={()=>clearCache().catch(showError)}>清理临时文件</Button><Button className='danger-outline' loading={busy} onClick={()=>clearDurable('screenshots')}>删除全部截图</Button><Button className='danger-outline' loading={busy} onClick={()=>clearDurable('quarantine')}>删除隔离文件</Button></View></View>
}

const formatBytes=(bytes:number)=>bytes>=1048576?`${(bytes/1048576).toFixed(2)} MiB`:bytes>=1024?`${(bytes/1024).toFixed(1)} KiB`:`${bytes} B`
const showError=(error:unknown)=>Taro.showModal({title:'存储操作失败',content:errorMessage(error),showCancel:false})
