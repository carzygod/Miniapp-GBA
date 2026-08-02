import Taro,{useDidShow,useRouter} from '@tarojs/taro'
import {Button,Image,Input,Text,View} from '@tarojs/components'
import {useCallback,useState} from 'react'
import {romCatalogClient} from '../../catalog/client'
import {syncService} from '../../cloud/sync-service'
import type {GameEntry,PlaySession,RomCatalogItem,SaveManifest} from '../../domain/models'
import {readBytes} from '../../platform/fs'
import {loadSettings} from '../../settings'
import {libraryRepository,playHistoryRepository,saveRepository} from '../../services'
import './index.scss'

export default function GamePage(){
  const params=useRouter().params
  const romId=params.romId??''
  const catalogId=params.catalogId??''
  const[game,setGame]=useState<GameEntry>()
  const[item,setItem]=useState<RomCatalogItem>()
  const[saves,setSaves]=useState<SaveManifest[]>([])
  const[history,setHistory]=useState<PlaySession[]>([])
  const[busy,setBusy]=useState(false)
  const[progress,setProgress]=useState(0)
  const[editing,setEditing]=useState(false)
  const[title,setTitle]=useState('')
  const refresh=useCallback(async()=>{const local=romId?await libraryRepository.get(romId):catalogId?await libraryRepository.getByCatalogId(catalogId):undefined;const effectiveCatalogId=catalogId||local?.catalogId||'';const[catalogItem,localSaves,sessions]=await Promise.all([effectiveCatalogId?romCatalogClient.find(effectiveCatalogId).catch(()=>undefined):undefined,local?saveRepository.list(local.romId):[],local?playHistoryRepository.list(local.romId):[]]);setGame(local);setSaves(localSaves);setHistory(sessions);setItem(catalogItem)},[catalogId,romId])
  useDidShow(()=>{refresh().catch(showError)})
  const displayTitle=item?.title??game?.title??'未知游戏'
  const coverUrl=item?.coverUrl??game?.coverUrl
  const description=item?.description??game?.description
  const play=()=>{if(!game)throw new Error('请先下载 ROM');return Taro.navigateTo({url:`/player/index?romId=${game.romId}`})}
  const install=async()=>{if(!item)throw new Error('ROM 目录中没有这个条目');setBusy(true);setProgress(0);try{await libraryRepository.importCatalogItem(item,setProgress);await refresh();Taro.showToast({title:'下载完成',icon:'success'})}finally{setBusy(false);setProgress(0)}}
  const rename=async()=>{if(!game)return;await libraryRepository.rename(game.romId,title);setEditing(false);await refresh()}
  const importBattery=async()=>{if(!game)throw new Error('请先下载 ROM');const selection=await Taro.chooseMessageFile({count:1,type:'file',extension:['sav']});const file=selection.tempFiles[0];if(!file)return;if(file.size>1024*1024)throw new Error('.sav 超过 1 MiB 限制');const bytes=await readBytes(file.path);if(!bytes.length)throw new Error('不能导入空存档');const previous=await saveRepository.manifest(game.romId,'battery','current'),confirm=await Taro.showModal({title:'导入电池存档',content:previous?'当前存档会保留为上一成功版本。':'将为此游戏创建首个电池存档。',confirmText:'导入'});if(!confirm.confirm)return;const settings=loadSettings(),manifest=await saveRepository.commit(game.romId,'battery','current',bytes,previous?.coreBuildId??'external-sav',previous?.cloudRevision??0);await libraryRepository.setSaveState(game.romId,true,settings.cloudSync?'pending':'disabled');if(settings.cloudSync){await syncService.enqueue(manifest);syncService.runDue().catch(()=>undefined)}await refresh();Taro.showToast({title:'已导入',icon:'success'})}
  const removeLocal=async()=>{if(!game)return;let choice;try{choice=await Taro.showActionSheet({itemList:['仅删除 ROM（保留存档）','删除 ROM 和本地存档']})}catch{return}const withSaves=choice.tapIndex===1,confirm=await Taro.showModal({title:withSaves?'删除 ROM 和存档':'删除 ROM',content:withSaves?'本机 ROM 和全部本地存档将被删除。':'本机 ROM 将被删除，存档与游玩记录保留。',confirmText:'确认删除',confirmColor:'#d43c62'});if(!confirm.confirm)return;if(withSaves)await saveRepository.removeAll(game.romId);await libraryRepository.removeRom(game.romId);await refresh()}
  const removeSession=async(session:PlaySession)=>{const confirm=await Taro.showModal({title:'删除游玩记录',content:`${formatDate(session.endedAt)} · ${formatDuration(session.durationSeconds)}`,confirmText:'删除',confirmColor:'#d43c62'});if(!confirm.confirm)return;await playHistoryRepository.remove(session.id);await refresh()}
  const clearHistory=async()=>{if(!game)return;const confirm=await Taro.showModal({title:'清除此游戏的记录',content:'只清除会话明细，不删除累计时长、ROM 或存档。',confirmText:'清除',confirmColor:'#d43c62'});if(!confirm.confirm)return;await playHistoryRepository.clear(game.romId);await refresh()}
  const source=item?'ROM 广场':game?.source==='wechat-message-file'||game?.source==='zip'?'本地导入':game?.source==='r2-catalog'?'ROM 广场':'授权下载'
  return <View className='page-shell game-page'>
    <View className='game-identity'>{coverUrl?<Image className='detail-cover' src={coverUrl} mode='aspectFill'/>:<View className='detail-cover fallback'><Text>{initials(displayTitle)}</Text><Text>GAME PAK</Text></View>}<View className='identity-copy'><Text className='eyebrow'>{item?.featured?'FEATURED GAME':'GAME DETAIL'}</Text><Text className='detail-title'>{displayTitle}</Text><Text className='detail-code mono'>{item?.gameCode??game?.gameCode??'HOMEBREW'} · {source}</Text>{(item?.genres??game?.genres)?.length?<View className='detail-tags'>{(item?.genres??game?.genres??[]).map(value=><Text key={value}>{value}</Text>)}</View>:undefined}</View></View>
    <View className='detail-actions'>{game?<Button className='play-button' onClick={()=>play().catch(showError)}>开始游戏</Button>:<Button className='play-button' loading={busy} onClick={()=>install().catch(showError)}>{busy?`下载 ${progress}%`:'下载并加入'}</Button>}{game&&<Button className='manage-button' onClick={()=>{setTitle(game.title);setEditing(true)}}>改名</Button>}</View>
    {description&&<Text className='game-description'>{description}</Text>}
    <View className='detail-metrics'><View><Text>{game?formatDuration(game.playTimeSeconds):'0 秒'}</Text><Text>累计游玩</Text></View><View><Text>{history.length}</Text><Text>会话记录</Text></View><View><Text>{saves.length}</Text><Text>本地存档</Text></View></View>
    <View className='detail-section'><View className='detail-heading'><Text>存档管理</Text><Button onClick={()=>Taro.switchTab({url:'/pages/saves/index'})}>全部存档</Button></View>{!saves.length?<View className='detail-empty'>尚无存档</View>:<View className='detail-save-list'>{saves.slice(0,5).map(save=><View key={`${save.kind}-${save.slot}`}><View><Text>{saveLabel(save.kind,save.slot)}</Text><Text>{formatDate(save.updatedAt)} · r{save.localRevision} / cloud {save.cloudRevision}</Text></View><Text>{formatBytes(save.sizeBytes)}</Text></View>)}</View>}{game&&<Button className='inline-command' onClick={()=>importBattery().catch(showError)}>导入 .sav</Button>}</View>
    <View className='detail-section'><View className='detail-heading'><Text>最近游玩</Text>{history.length>0&&<Button className='danger-link' onClick={()=>clearHistory().catch(showError)}>清除</Button>}</View>{!history.length?<View className='detail-empty'>尚无会话记录</View>:<View className='detail-history'>{history.slice(0,8).map(session=><View key={session.id}><View><Text>{formatDate(session.endedAt)}</Text><Text>{formatDuration(session.durationSeconds)} · {reasonLabel(session.exitReason)}</Text></View><Button onClick={()=>removeSession(session).catch(showError)}>删除</Button></View>)}</View>}</View>
    <View className='detail-section rom-facts'><View className='detail-heading'><Text>ROM 信息</Text></View>{item&&<Fact label='R2 对象' value={item.objectKey}/>}<Fact label='大小' value={item?formatBytes(item.sizeBytes):game?formatBytes(game.sizeBytes):'未知'}/><Fact label='地区 / 语言' value={`${item?.region??game?.region??'未标注'} / ${item?.language??game?.language??'未标注'}`}/>{item?.etag&&<Fact label='对象版本' value={item.etag}/>}<Fact label='分发许可' value={item?.license?.name??game?.licenseName??(item?'未标注':'本地文件')}/>{game&&<Fact label='本地内容 ID' value={game.romId}/>}{game&&<Fact label='云存档' value={cloudLabel(game.cloudState)}/>}</View>
    {game&&<Button className='remove-rom' onClick={()=>removeLocal().catch(showError)}>删除本机 ROM</Button>}
    {editing&&<View className='detail-dialog-shade'><View className='detail-dialog'><Text>修改显示名称</Text><Input maxlength={40} value={title} focus onInput={event=>setTitle(event.detail.value)}/><View><Button onClick={()=>setEditing(false)}>取消</Button><Button className='confirm' onClick={()=>rename().catch(showError)}>保存</Button></View></View></View>}
  </View>
}

function Fact({label,value}:{label:string;value:string}){return <View className='fact-row'><Text>{label}</Text><Text className={label==='R2 对象'||label.includes('ID')||label==='对象版本'?'mono':''}>{value}</Text></View>}
const saveLabel=(kind:SaveManifest['kind'],slot:string)=>kind==='battery'?'电池存档':kind==='auto_state'?'自动恢复点':`状态槽 ${Number(slot)+1}`
const formatBytes=(bytes:number)=>bytes>=1048576?`${(bytes/1048576).toFixed(1)} MiB`:`${Math.max(1,Math.ceil(bytes/1024))} KiB`
const formatDuration=(seconds:number)=>seconds<60?`${Math.max(0,Math.floor(seconds))} 秒`:seconds<3600?`${Math.floor(seconds/60)} 分钟`:`${Math.floor(seconds/3600)} 小时 ${Math.floor(seconds%3600/60)} 分`
const formatDate=(value:string)=>{const date=new Date(value);return`${date.getMonth()+1}/${date.getDate()} ${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`}
const initials=(title:string)=>title.replace(/[^A-Za-z0-9\u4e00-\u9fff]/g,'').slice(0,2).toUpperCase()||'GB'
const reasonLabel=(reason:PlaySession['exitReason'])=>({paused:'暂停',background:'进入后台',exit:'正常退出',error:'异常中止'}[reason])
const cloudLabel=(state:GameEntry['cloudState'])=>({disabled:'仅本地',pending:'待同步',synced:'已同步',conflict:'有冲突',error:'同步失败'}[state])
const showError=(error:unknown)=>Taro.showModal({title:'游戏操作失败',content:error instanceof Error?error.message:String(error),showCancel:false})
