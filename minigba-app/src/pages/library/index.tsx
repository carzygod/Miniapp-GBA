import Taro,{useDidShow} from '@tarojs/taro'
import {Button,Input,Text,View} from '@tarojs/components'
import {useCallback,useState} from 'react'
import {syncService} from '../../cloud/sync-service'
import type {GameEntry} from '../../domain/models'
import {loadSettings} from '../../settings'
import {libraryRepository,saveRepository} from '../../services'
import {readBytes} from '../../platform/fs'
import './index.scss'

export default function LibraryPage(){
  const[games,setGames]=useState<GameEntry[]>([]);const[busy,setBusy]=useState(false);const[editing,setEditing]=useState<GameEntry>();const[editTitle,setEditTitle]=useState('');const[query,setQuery]=useState('');const[downloadOpen,setDownloadOpen]=useState(false);const[downloadUrl,setDownloadUrl]=useState('');const[downloadHash,setDownloadHash]=useState('');const[downloadSize,setDownloadSize]=useState('');const[downloadName,setDownloadName]=useState('')
  const refresh=useCallback(async()=>setGames(await libraryRepository.list()),[])
  useDidShow(()=>{refresh().catch(showError)})
  const importRom=async()=>{let selected;try{selected=await Taro.showActionSheet({itemList:['微信文件（.gba / .zip）','授权 HTTPS 下载']})}catch{return}if(selected.tapIndex===1){setDownloadOpen(true);return}setBusy(true);try{await libraryRepository.chooseAndImport();await refresh();Taro.showToast({title:'已加入游戏库',icon:'success'})}catch(error){if(!String(error).includes('cancel')&&!String(error).includes('取消'))showError(error)}finally{setBusy(false)}}
  const submitDownload=async()=>{setBusy(true);try{await libraryRepository.importAuthorizedDownload(downloadUrl,downloadHash.trim().toLowerCase(),Number(downloadSize),downloadName);setDownloadOpen(false);setDownloadUrl('');setDownloadHash('');setDownloadSize('');setDownloadName('');await refresh();Taro.showToast({title:'授权 ROM 已导入',icon:'success'})}catch(error){showError(error)}finally{setBusy(false)}}
  const repair=async()=>{const confirm=await Taro.showModal({title:'重新扫描游戏库',content:'将验证所有 ROM 的大小、Header 和 SHA-256，恢复未入库的合法文件，并把损坏文件移入隔离区。存档不会删除。',confirmText:'开始扫描'});if(!confirm.confirm)return;setBusy(true);try{const result=await libraryRepository.repairLibrary();await refresh();await Taro.showModal({title:'扫描完成',content:`新增 ${result.added}，移除丢失条目 ${result.removed}，隔离异常文件 ${result.quarantined}。`,showCancel:false})}finally{setBusy(false)}}
  const play=(romId:string)=>Taro.navigateTo({url:`/player/index?romId=${romId}`})
  const manage=async(game:GameEntry)=>{
    let selection
    try{selection=await Taro.showActionSheet({itemList:['修改显示名称','导入 .sav','查看存档','存储详情','删除 ROM']})}catch{return}
    if(selection.tapIndex===0){
      setEditing(game);setEditTitle(game.title);return
    }
    if(selection.tapIndex===1)await importBattery(game)
    if(selection.tapIndex===2)await Taro.switchTab({url:'/pages/saves/index'})
    if(selection.tapIndex===3)await Taro.showModal({title:'存储详情',content:`ROM: ${formatBytes(game.sizeBytes)}\nSHA-256: ${game.romId}\n存档: ${game.batterySave?'有':'无'}`,showCancel:false})
    if(selection.tapIndex===4)await remove(game)
    await refresh()
  }
  const remove=async(game:GameEntry)=>{
    let choice
    try{choice=await Taro.showActionSheet({itemList:['仅删除 ROM（保留存档）','删除 ROM 和本地存档']})}catch{return}
    const withSaves=choice.tapIndex===1
    const confirm=await Taro.showModal({title:withSaves?'删除 ROM 和存档':'删除 ROM',content:withSaves?'此操作会删除本机 ROM、所有电池存档和状态存档，无法撤销。':'只删除本机 ROM，现有存档将保留。',confirmText:'确认删除',confirmColor:'#d43c62'})
    if(!confirm.confirm)return
    if(withSaves)await saveRepository.removeAll(game.romId)
    await libraryRepository.removeRom(game.romId)
  }
  const saveRename=async()=>{if(!editing)return;await libraryRepository.rename(editing.romId,editTitle);setEditing(undefined);await refresh()}
  const importBattery=async(game:GameEntry)=>{const selection=await Taro.chooseMessageFile({count:1,type:'file',extension:['sav']});const file=selection.tempFiles[0];if(!file)return;if(file.size>1024*1024)throw new Error('.sav 超过 1 MiB 限制');const bytes=await readBytes(file.path);if(!bytes.length)throw new Error('不能导入空存档');const previous=await saveRepository.manifest(game.romId,'battery','current');const confirm=await Taro.showModal({title:'导入电池存档',content:previous?'当前正式存档会自动保留为上一成功版本。游戏运行中请先退出播放器。':'将为这个 ROM 创建首个电池存档。进入游戏时由核心校验容量。',confirmText:'导入'});if(!confirm.confirm)return;const settings=loadSettings(),manifest=await saveRepository.commit(game.romId,'battery','current',bytes,previous?.coreBuildId??'external-sav',previous?.cloudRevision??0);await libraryRepository.setSaveState(game.romId,true,settings.cloudSync?'pending':'disabled');if(settings.cloudSync){await syncService.enqueue(manifest);syncService.runDue().catch(()=>undefined)}await refresh();Taro.showToast({title:'已导入',icon:'success'})}
  const visibleGames=games.filter(game=>`${game.title} ${game.gameCode}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <View className='page-shell library-page'>
    <View className='library-header'><View><Text className='eyebrow'>LOCAL LIBRARY</Text><View className='page-title'>我的游戏</View><Text className='page-subtitle'>{games.length} 个本地 ROM</Text></View><Button className='import-button' loading={busy} onClick={importRom}>导入 ROM</Button></View>
    <View className='library-search'><Input value={query} placeholder='搜索标题或游戏代码' onInput={event=>setQuery(event.detail.value)}/></View>
    <View className='storage-strip'><View><Text>ROM 仅保存在本机</Text><Text className='mono'>{formatBytes(games.reduce((sum,game)=>sum+game.sizeBytes,0))}</Text></View><Button onClick={()=>repair().catch(showError)}>重新扫描</Button></View>
    <View className='section-title'>最近游玩</View>
    {!games.length?<View className='empty-state'><View className='empty-mark'>GBA</View><Text>游戏库为空</Text><Button className='empty-import' loading={busy} onClick={importRom}>导入合法 ROM</Button></View>:!visibleGames.length?<View className='empty-state'>没有匹配的游戏</View>:<View className='game-list'>{visibleGames.map((game,index)=><View key={game.romId} className='game-row' onClick={()=>play(game.romId)} onLongPress={event=>{event.stopPropagation();manage(game).catch(showError)}}>
      <View className={`game-tile tone-${index%4}`}><Text>{initials(game.title)}</Text></View>
      <View className='game-copy'><Text className='game-title'>{game.title}</Text><Text className='game-meta mono'>{game.gameCode||'HOMEBREW'} · {formatBytes(game.sizeBytes)} · {game.lastPlayedAt?relativeTime(game.lastPlayedAt):'未游玩'}</Text><View className='game-flags'><Text className={`status-dot ${game.batterySave?'has-save':''}`}/><Text>{game.batterySave?'本地存档':'尚无存档'}</Text><Text className={`cloud-state ${game.cloudState}`}>{cloudLabel(game.cloudState)}</Text>{game.lastSyncedAt&&<Text>{relativeTime(game.lastSyncedAt)}</Text>}</View>{game.syncError&&<Text className='sync-error'>{game.syncError}</Text>}</View>
      <Text className='play-arrow'>▶</Text>
    </View>)}</View>}
    {editing&&<View className='rename-shade'><View className='rename-dialog'><Text className='rename-title'>修改显示名称</Text><Text className='rename-detail'>名称仅保存在本机，不改变 ROM 身份。</Text><Input className='rename-input' maxlength={40} value={editTitle} focus onInput={event=>setEditTitle(event.detail.value)}/><View className='rename-actions'><Button onClick={()=>setEditing(undefined)}>取消</Button><Button className='confirm' onClick={()=>saveRename().catch(showError)}>保存</Button></View></View></View>}
    {downloadOpen&&<View className='rename-shade'><View className='download-dialog'><Text className='rename-title'>授权 HTTPS 下载</Text><Text className='rename-detail'>地址域名必须由发布配置白名单允许，长度和 SHA-256 必须来自授权清单。</Text><Input className='rename-input' value={downloadUrl} placeholder='https://allowed.example/game.gba' onInput={event=>setDownloadUrl(event.detail.value)}/><Input className='rename-input mono' value={downloadHash} maxlength={64} placeholder='64 位小写 SHA-256' onInput={event=>setDownloadHash(event.detail.value)}/><Input className='rename-input' type='number' value={downloadSize} placeholder='精确字节数' onInput={event=>setDownloadSize(event.detail.value)}/><Input className='rename-input' value={downloadName} maxlength={40} placeholder='显示名称（可选）' onInput={event=>setDownloadName(event.detail.value)}/><View className='rename-actions'><Button onClick={()=>setDownloadOpen(false)}>取消</Button><Button className='confirm' loading={busy} onClick={()=>submitDownload()}>下载并校验</Button></View></View></View>}
  </View>
}

const formatBytes=(bytes:number)=>bytes>=1048576?`${(bytes/1048576).toFixed(1)} MiB`:`${Math.ceil(bytes/1024)} KiB`
const initials=(title:string)=>title.replace(/[^A-Za-z0-9]/g,'').slice(0,2).toUpperCase()||'GB'
const cloudLabel=(state:GameEntry['cloudState'])=>({disabled:'仅本地',pending:'待同步',synced:'已同步',conflict:'有冲突',error:'同步失败'}[state])
const relativeTime=(value:string)=>{const seconds=Math.max(0,Math.round((Date.now()-new Date(value).getTime())/1000));if(seconds<60)return'刚刚';if(seconds<3600)return`${Math.floor(seconds/60)} 分钟前`;if(seconds<86400)return`${Math.floor(seconds/3600)} 小时前`;return`${Math.floor(seconds/86400)} 天前`}
const showError=(error:unknown)=>Taro.showModal({title:'操作失败',content:error instanceof Error?error.message:String(error),showCancel:false})
