import Taro,{useDidShow} from '@tarojs/taro'
import {Button,Input,Text,View} from '@tarojs/components'
import {useCallback,useState} from 'react'
import type {GameEntry} from '../../domain/models'
import {libraryRepository,saveRepository} from '../../services'
import './index.scss'

export default function LibraryPage(){
  const[games,setGames]=useState<GameEntry[]>([]);const[busy,setBusy]=useState(false);const[editing,setEditing]=useState<GameEntry>();const[editTitle,setEditTitle]=useState('')
  const refresh=useCallback(async()=>setGames(await libraryRepository.list()),[])
  useDidShow(()=>{refresh().catch(showError)})
  const importRom=async()=>{setBusy(true);try{await libraryRepository.chooseAndImport();await refresh();Taro.showToast({title:'已加入游戏库',icon:'success'})}catch(error){if(!String(error).includes('cancel')&&!String(error).includes('取消'))showError(error)}finally{setBusy(false)}}
  const play=(romId:string)=>Taro.navigateTo({url:`/player/index?romId=${romId}`})
  const manage=async(game:GameEntry)=>{
    let selection
    try{selection=await Taro.showActionSheet({itemList:['修改显示名称','查看存档','存储详情','删除 ROM']})}catch{return}
    if(selection.tapIndex===0){
      setEditing(game);setEditTitle(game.title);return
    }
    if(selection.tapIndex===1)await Taro.switchTab({url:'/pages/saves/index'})
    if(selection.tapIndex===2)await Taro.showModal({title:'存储详情',content:`ROM: ${formatBytes(game.sizeBytes)}\nSHA-256: ${game.romId}\n存档: ${game.batterySave?'有':'无'}`,showCancel:false})
    if(selection.tapIndex===3)await remove(game)
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
  return <View className='page-shell library-page'>
    <View className='library-header'><View><Text className='eyebrow'>LOCAL LIBRARY</Text><View className='page-title'>我的游戏</View><Text className='page-subtitle'>{games.length} 个本地 ROM</Text></View><Button className='import-button' loading={busy} onClick={importRom}>导入 ROM</Button></View>
    <View className='storage-strip'><Text>ROM 仅保存在本机</Text><Text className='mono'>{formatBytes(games.reduce((sum,game)=>sum+game.sizeBytes,0))}</Text></View>
    <View className='section-title'>最近游玩</View>
    {!games.length?<View className='empty-state'><View className='empty-mark'>GBA</View><Text>游戏库为空</Text><Button className='empty-import' loading={busy} onClick={importRom}>从微信文件导入</Button></View>:<View className='game-list'>{games.map((game,index)=><View key={game.romId} className='game-row' onClick={()=>play(game.romId)} onLongPress={event=>{event.stopPropagation();manage(game).catch(showError)}}>
      <View className={`game-tile tone-${index%4}`}><Text>{initials(game.title)}</Text></View>
      <View className='game-copy'><Text className='game-title'>{game.title}</Text><Text className='game-meta mono'>{game.gameCode||'HOMEBREW'} · {formatBytes(game.sizeBytes)}</Text><View className='game-flags'><Text className={`status-dot ${game.batterySave?'has-save':''}`}/><Text>{game.batterySave?'本地存档':'尚无存档'}</Text><Text className={`cloud-state ${game.cloudState}`}>{cloudLabel(game.cloudState)}</Text></View></View>
      <Text className='play-arrow'>▶</Text>
    </View>)}</View>}
    {editing&&<View className='rename-shade'><View className='rename-dialog'><Text className='rename-title'>修改显示名称</Text><Text className='rename-detail'>名称仅保存在本机，不改变 ROM 身份。</Text><Input className='rename-input' maxlength={40} value={editTitle} focus onInput={event=>setEditTitle(event.detail.value)}/><View className='rename-actions'><Button onClick={()=>setEditing(undefined)}>取消</Button><Button className='confirm' onClick={()=>saveRename().catch(showError)}>保存</Button></View></View></View>}
  </View>
}

const formatBytes=(bytes:number)=>bytes>=1048576?`${(bytes/1048576).toFixed(1)} MiB`:`${Math.ceil(bytes/1024)} KiB`
const initials=(title:string)=>title.replace(/[^A-Za-z0-9]/g,'').slice(0,2).toUpperCase()||'GB'
const cloudLabel=(state:GameEntry['cloudState'])=>({disabled:'仅本地',pending:'待同步',synced:'已同步',conflict:'有冲突',error:'同步失败'}[state])
const showError=(error:unknown)=>Taro.showModal({title:'操作失败',content:error instanceof Error?error.message:String(error),showCancel:false})
