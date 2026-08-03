import Taro,{useDidShow} from '@tarojs/taro'
import {Button,Image,Input,Picker,Text,View} from '@tarojs/components'
import {useCallback,useEffect,useMemo,useState} from 'react'
import {romCatalogClient} from '../../catalog/client'
import {syncService} from '../../cloud/sync-service'
import type {GameEntry,PlaySession,RomCatalogItem,SaveManifest} from '../../domain/models'
import {errorMessage,isCancellationError} from '../../platform/error'
import {readBytes} from '../../platform/fs'
import {chooseLocalFile,supportsLocalFileTransfer} from '../../platform/local-files'
import {loadSettings} from '../../settings'
import {libraryRepository,playHistoryRepository,saveRepository} from '../../services'
import './index.scss'

type HomeMode='square'|'library'|'history'
type CatalogStatus='loading'|'ready'|'stale'|'error'

export default function LibraryPage(){
  const[games,setGames]=useState<GameEntry[]>([])
  const[saves,setSaves]=useState<SaveManifest[]>([])
  const[history,setHistory]=useState<PlaySession[]>([])
  const[catalog,setCatalog]=useState<RomCatalogItem[]>([])
  const[catalogStatus,setCatalogStatus]=useState<CatalogStatus>('loading')
  const[catalogError,setCatalogError]=useState('')
  const[catalogLimit,setCatalogLimit]=useState(60)
  const[mode,setMode]=useState<HomeMode>('square')
  const[query,setQuery]=useState('')
  const[genre,setGenre]=useState('全部分类')
  const[busy,setBusy]=useState(false)
  const[busyCatalogId,setBusyCatalogId]=useState('')
  const[downloadProgress,setDownloadProgress]=useState(0)
  const[editing,setEditing]=useState<GameEntry>()
  const[editTitle,setEditTitle]=useState('')
  const[downloadOpen,setDownloadOpen]=useState(false)
  const[downloadUrl,setDownloadUrl]=useState('')
  const[downloadSize,setDownloadSize]=useState('')
  const[downloadName,setDownloadName]=useState('')

  const refreshLocal=useCallback(async()=>{const[localGames,localSaves,sessions]=await Promise.all([libraryRepository.list(),saveRepository.list(),playHistoryRepository.list()]);setGames(localGames);setSaves(localSaves);setHistory(sessions)},[])
  const refreshCatalog=useCallback(async(force=false)=>{setCatalogStatus('loading');setCatalogError('');try{const snapshot=await romCatalogClient.list({force});setCatalog(snapshot.catalog.items);setCatalogStatus(snapshot.stale?'stale':'ready')}catch(error){setCatalogStatus('error');setCatalogError(errorMessage(error))}},[])
  useDidShow(()=>{refreshLocal().catch(showError);refreshCatalog().catch(()=>undefined)})

  const localByCatalogId=useMemo(()=>new Map(games.filter(game=>game.catalogId).map(game=>[game.catalogId!,game])),[games])
  const names=useMemo(()=>new Map(games.map(game=>[game.romId,game.title])),[games])
  const genres=useMemo(()=>['全部分类',...new Set(catalog.flatMap(item=>item.genres))],[catalog])
  const normalized=query.trim().toLowerCase()
  const visibleCatalog=useMemo(()=>catalog.filter(item=>(genre==='全部分类'||item.genres.includes(genre))&&`${item.title} ${item.objectKey} ${item.gameCode??''} ${item.region??''} ${item.language??''} ${item.genres.join(' ')}`.toLowerCase().includes(normalized)).sort((a,b)=>Number(b.featured)-Number(a.featured)||a.title.localeCompare(b.title,'zh-CN')),[catalog,genre,normalized])
  const renderedCatalog=visibleCatalog.slice(0,catalogLimit)
  useEffect(()=>setCatalogLimit(60),[catalog,genre,query])
  const visibleGames=useMemo(()=>games.filter(game=>`${game.title} ${game.gameCode}`.toLowerCase().includes(normalized)),[games,normalized])
  const recentGame=games.find(game=>game.lastPlayedAt)
  const totalPlaySeconds=games.reduce((sum,game)=>sum+game.playTimeSeconds,0)

  const openGame=(romId:string)=>Taro.navigateTo({url:`/pages/game/index?romId=${romId}`})
  const openCatalogItem=(catalogId:string)=>Taro.navigateTo({url:`/pages/game/index?catalogId=${encodeURIComponent(catalogId)}`})
  const play=(romId:string)=>Taro.navigateTo({url:`/player/index?romId=${romId}`})
  const install=async(item:RomCatalogItem)=>{
    const installed=localByCatalogId.get(item.id)
    if(installed){await openGame(installed.romId);return}
    setBusyCatalogId(item.id);setDownloadProgress(0)
    try{const entry=await libraryRepository.importCatalogItem(item,setDownloadProgress);await refreshLocal();Taro.showToast({title:'已加入游戏库',icon:'success'});await openGame(entry.romId)}catch(error){showError(error)}finally{setBusyCatalogId('');setDownloadProgress(0)}
  }
  const importRom=async()=>{if(!supportsLocalFileTransfer()){setDownloadOpen(true);return}let selected;try{selected=await Taro.showActionSheet({itemList:['微信文件（.gba / .zip）','授权 HTTPS 下载']})}catch{return}if(selected.tapIndex===1){setDownloadOpen(true);return}setBusy(true);try{await libraryRepository.chooseAndImport();await refreshLocal();Taro.showToast({title:'已加入游戏库',icon:'success'})}catch(error){if(!isCancellationError(error))showError(error)}finally{setBusy(false)}}
  const submitDownload=async()=>{setBusy(true);try{await libraryRepository.importAuthorizedDownload(downloadUrl,Number(downloadSize),downloadName);setDownloadOpen(false);setDownloadUrl('');setDownloadSize('');setDownloadName('');await refreshLocal();Taro.showToast({title:'授权 ROM 已导入',icon:'success'})}catch(error){showError(error)}finally{setBusy(false)}}
  const repair=async()=>{const confirm=await Taro.showModal({title:'重新扫描游戏库',content:'验证 ROM 并恢复未入库文件；异常文件会移入隔离区，存档不会删除。',confirmText:'开始扫描'});if(!confirm.confirm)return;setBusy(true);try{const result=await libraryRepository.repairLibrary();await refreshLocal();await Taro.showModal({title:'扫描完成',content:`新增 ${result.added}，移除 ${result.removed}，隔离 ${result.quarantined}。`,showCancel:false})}finally{setBusy(false)}}
  const manage=async(game:GameEntry)=>{const items=['查看游戏详情','修改显示名称'];if(supportsLocalFileTransfer())items.push('导入 .sav');items.push('查看存档','重新扫描','删除 ROM');let selection;try{selection=await Taro.showActionSheet({itemList:items})}catch{return}const action=items[selection.tapIndex];if(action==='查看游戏详情')await openGame(game.romId);if(action==='修改显示名称'){setEditing(game);setEditTitle(game.title)}if(action==='导入 .sav')await importBattery(game);if(action==='查看存档')await Taro.switchTab({url:'/pages/saves/index'});if(action==='重新扫描')await repair();if(action==='删除 ROM')await remove(game);await refreshLocal()}
  const remove=async(game:GameEntry)=>{let choice;try{choice=await Taro.showActionSheet({itemList:['仅删除 ROM（保留存档）','删除 ROM 和本地存档']})}catch{return}const withSaves=choice.tapIndex===1,confirm=await Taro.showModal({title:withSaves?'删除 ROM 和存档':'删除 ROM',content:withSaves?'本机 ROM 和全部本地存档将被删除。':'本机 ROM 将被删除，存档保留。',confirmText:'确认删除',confirmColor:'#d43c62'});if(!confirm.confirm)return;if(withSaves)await saveRepository.removeAll(game.romId);await libraryRepository.removeRom(game.romId)}
  const saveRename=async()=>{if(!editing)return;await libraryRepository.rename(editing.romId,editTitle);setEditing(undefined);await refreshLocal()}
  const importBattery=async(game:GameEntry)=>{const file=await chooseLocalFile(['sav']);if(!file)return;if(file.size>1024*1024)throw new Error('.sav 超过 1 MiB 限制');const bytes=await readBytes(file.path);if(!bytes.length)throw new Error('不能导入空存档');const previous=await saveRepository.manifest(game.romId,'battery','current'),confirm=await Taro.showModal({title:'导入电池存档',content:previous?'当前存档会保留为上一成功版本。':'将创建首个电池存档。',confirmText:'导入'});if(!confirm.confirm)return;const settings=loadSettings(),manifest=await saveRepository.commit(game.romId,'battery','current',bytes,previous?.coreBuildId??'external-sav',previous?.cloudRevision??0);await libraryRepository.setSaveState(game.romId,true,settings.cloudSync?'pending':'disabled');if(settings.cloudSync){await syncService.enqueue(manifest);syncService.runDue().catch(()=>undefined)}await refreshLocal();Taro.showToast({title:'已导入',icon:'success'})}
  const removeSession=async(session:PlaySession)=>{const confirm=await Taro.showModal({title:'删除游玩记录',content:`${names.get(session.romId)??'未知游戏'} · ${formatDuration(session.durationSeconds)}`,confirmText:'删除',confirmColor:'#d43c62'});if(!confirm.confirm)return;await playHistoryRepository.remove(session.id);await refreshLocal()}
  const clearHistory=async()=>{const confirm=await Taro.showModal({title:'清空游玩记录',content:'只清除会话明细，不删除 ROM 或存档。累计游玩时间仍保留在游戏库。',confirmText:'清空',confirmColor:'#d43c62'});if(!confirm.confirm)return;await playHistoryRepository.clear();await refreshLocal()}

  return <View className='page-shell home-page'>
    <View className='home-header'><View><Text className='eyebrow'>PLAY DESK</Text><View className='page-title'>游玩中心</View><Text className='page-subtitle'>{games.length} 个游戏 · {formatDuration(totalPlaySeconds)} · {saves.length} 份存档</Text></View><Button className='import-button' loading={busy} onClick={importRom}>导入</Button></View>
    {recentGame?<View className='continue-band'><View className='continue-mark'>{initials(recentGame.title)}</View><View className='continue-copy'><Text className='continue-label'>继续游玩</Text><Text className='continue-title'>{recentGame.title}</Text><Text className='continue-meta'>{relativeTime(recentGame.lastPlayedAt!)} · {formatDuration(recentGame.playTimeSeconds)}</Text></View><Button className='continue-button' onClick={()=>play(recentGame.romId)}>继续</Button></View>:<View className='continue-band empty'><View className='continue-mark'>GBA</View><View className='continue-copy'><Text className='continue-label'>开始收藏</Text><Text className='continue-title'>从 ROM 广场选择游戏</Text></View></View>}
    <View className='home-tabs'>{(['square','library','history'] as HomeMode[]).map(value=><Button key={value} className={mode===value?'active':''} onClick={()=>{setMode(value);setQuery('')}}>{modeLabel(value)}</Button>)}</View>
    {mode!=='history'&&<View className='search-row'><View className='home-search'><Input value={query} placeholder={mode==='square'?'搜索 ROM、代码或分类':'搜索本地游戏'} onInput={event=>setQuery(event.detail.value)}/></View>{mode==='square'&&<Picker mode='selector' range={genres} value={Math.max(0,genres.indexOf(genre))} onChange={event=>setGenre(genres[Number(event.detail.value)]??'全部分类')}><View className='genre-picker'>{genre}</View></Picker>}</View>}
    {mode==='square'&&<View className='shelf-section'><View className='section-heading'><View><Text className='section-title'>ROM 广场</Text><Text className='section-count'>{catalogStatus==='stale'?'缓存目录':`${visibleCatalog.length} 个 R2 条目`}</Text></View><Button className='refresh-button' loading={catalogStatus==='loading'} onClick={()=>refreshCatalog(true)}>刷新</Button></View>{catalogStatus==='error'?<View className='catalog-state'><Text>{catalogError}</Text><Button onClick={()=>refreshCatalog(true)}>重试</Button></View>:catalogStatus==='loading'&&!catalog.length?<View className='catalog-state'>正在读取 ROM 目录</View>:!visibleCatalog.length?<View className='catalog-state'>没有匹配的 ROM</View>:<View className='catalog-shelf'>{renderedCatalog.map((item,index)=>{const installed=localByCatalogId.get(item.id),downloading=busyCatalogId===item.id;return <View className='catalog-row' key={item.id} onClick={()=>openCatalogItem(item.id)}><GameArtwork coverUrl={item.coverUrl} title={item.title} tone={index}/><View className='catalog-copy'><View className='catalog-title-line'><Text className='catalog-title'>{item.title}</Text>{item.featured&&<Text className='featured-label'>精选</Text>}</View><Text className='catalog-meta mono'>{item.gameCode||'GBA'} · {formatBytes(item.sizeBytes)} · {item.region||'未标注地区'}</Text><Text className='catalog-description'>{item.description||item.objectKey}</Text><View className='catalog-tags'><Text>{item.license?.name??'权利信息未标注'}</Text>{item.genres.slice(0,2).map(value=><Text key={value}>{value}</Text>)}</View></View><Button className={`shelf-action ${installed?'installed':''}`} loading={downloading} onClick={event=>{event.stopPropagation();install(item).catch(showError)}}>{downloading?`${downloadProgress}%`:installed?'详情':'获取'}</Button></View>})}{renderedCatalog.length<visibleCatalog.length&&<Button className='catalog-more' onClick={()=>setCatalogLimit(value=>value+60)}>加载更多 · {visibleCatalog.length-renderedCatalog.length} 条</Button>}</View>}</View>}
    {mode==='library'&&<View className='shelf-section'><View className='section-heading'><View><Text className='section-title'>我的游戏</Text><Text className='section-count'>{visibleGames.length} 个本地 ROM</Text></View><Button className='refresh-button' onClick={()=>repair().catch(showError)}>扫描</Button></View>{!games.length?<View className='catalog-state'><Text>本机还没有游戏</Text><Button onClick={importRom}>导入 ROM</Button></View>:!visibleGames.length?<View className='catalog-state'>没有匹配的游戏</View>:<View className='catalog-shelf'>{visibleGames.map((game,index)=><View key={game.romId} className='catalog-row' onClick={()=>openGame(game.romId)}><GameArtwork coverUrl={game.coverUrl} title={game.title} tone={index}/><View className='catalog-copy'><Text className='catalog-title'>{game.title}</Text><Text className='catalog-meta mono'>{game.gameCode||'HOMEBREW'} · {formatBytes(game.sizeBytes)} · {game.lastPlayedAt?relativeTime(game.lastPlayedAt):'未游玩'}</Text><View className='catalog-tags'><Text>{game.batterySave?'有电池存档':'尚无电池存档'}</Text><Text className={game.cloudState}>{cloudLabel(game.cloudState)}</Text></View></View><Button className='more-button' onClick={event=>{event.stopPropagation();manage(game).catch(showError)}}>•••</Button></View>)}</View>}</View>}
    {mode==='history'&&<View className='shelf-section'><View className='section-heading'><View><Text className='section-title'>游玩记录</Text><Text className='section-count'>{history.length} 次会话 · {formatDuration(history.reduce((sum,item)=>sum+item.durationSeconds,0))}</Text></View>{history.length>0&&<Button className='refresh-button danger' onClick={()=>clearHistory().catch(showError)}>清空</Button>}</View>{!history.length?<View className='catalog-state'>开始游戏后会记录实际游玩时长</View>:<View className='history-list'>{history.map(session=><View className='history-row' key={session.id} onClick={()=>openGame(session.romId)}><View className='history-date'><Text>{dateDay(session.endedAt)}</Text><Text>{dateTime(session.endedAt)}</Text></View><View className='history-copy'><Text>{names.get(session.romId)??'已移除的游戏'}</Text><Text>{formatDuration(session.durationSeconds)} · {exitReasonLabel(session.exitReason)}</Text></View><Button onClick={event=>{event.stopPropagation();removeSession(session).catch(showError)}}>删除</Button></View>)}</View>}</View>}
    {editing&&<View className='dialog-shade'><View className='dialog-panel'><Text className='dialog-title'>修改显示名称</Text><Text className='dialog-detail'>名称仅保存在本机，不改变 ROM 身份。</Text><Input className='dialog-input' maxlength={40} value={editTitle} focus onInput={event=>setEditTitle(event.detail.value)}/><View className='dialog-actions'><Button onClick={()=>setEditing(undefined)}>取消</Button><Button className='confirm' onClick={()=>saveRename().catch(showError)}>保存</Button></View></View></View>}
    {downloadOpen&&<View className='dialog-shade'><View className='dialog-panel'><Text className='dialog-title'>授权 HTTPS 下载</Text><Input className='dialog-input' value={downloadUrl} placeholder='https://allowed.example/game.gba' onInput={event=>setDownloadUrl(event.detail.value)}/><Input className='dialog-input' type='number' value={downloadSize} placeholder='精确字节数' onInput={event=>setDownloadSize(event.detail.value)}/><Input className='dialog-input' value={downloadName} maxlength={40} placeholder='显示名称（可选）' onInput={event=>setDownloadName(event.detail.value)}/><View className='dialog-actions'><Button onClick={()=>setDownloadOpen(false)}>取消</Button><Button className='confirm' loading={busy} onClick={submitDownload}>下载并检查</Button></View></View></View>}
  </View>
}

function GameArtwork({coverUrl,title,tone}:{coverUrl?:string;title:string;tone:number}){return coverUrl?<Image className='game-artwork' src={coverUrl} mode='aspectFill'/>:<View className={`game-artwork fallback tone-${tone%4}`}><Text>{initials(title)}</Text><Text>GAME PAK</Text></View>}
const modeLabel=(value:HomeMode)=>({square:'ROM 广场',library:'我的游戏',history:'游玩记录'}[value])
const formatBytes=(bytes:number)=>bytes>=1048576?`${(bytes/1048576).toFixed(1)} MiB`:`${Math.max(1,Math.ceil(bytes/1024))} KiB`
const formatDuration=(seconds:number)=>seconds<60?`${Math.max(0,Math.floor(seconds))} 秒`:seconds<3600?`${Math.floor(seconds/60)} 分钟`:`${Math.floor(seconds/3600)} 小时 ${Math.floor(seconds%3600/60)} 分`
const initials=(title:string)=>title.replace(/[^A-Za-z0-9\u4e00-\u9fff]/g,'').slice(0,2).toUpperCase()||'GB'
const cloudLabel=(state:GameEntry['cloudState'])=>({disabled:'仅本地',pending:'待同步',synced:'已同步',conflict:'有冲突',error:'同步失败'}[state])
const relativeTime=(value:string)=>{const seconds=Math.max(0,Math.round((Date.now()-new Date(value).getTime())/1000));if(seconds<60)return'刚刚';if(seconds<3600)return`${Math.floor(seconds/60)} 分钟前`;if(seconds<86400)return`${Math.floor(seconds/3600)} 小时前`;return`${Math.floor(seconds/86400)} 天前`}
const dateDay=(value:string)=>{const date=new Date(value);return`${date.getMonth()+1}/${date.getDate()}`}
const dateTime=(value:string)=>{const date=new Date(value);return`${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`}
const exitReasonLabel=(reason:PlaySession['exitReason'])=>({paused:'暂停',background:'进入后台',exit:'正常退出',error:'异常中止'}[reason])
const showError=(error:unknown)=>Taro.showModal({title:'操作失败',content:errorMessage(error),showCancel:false})
