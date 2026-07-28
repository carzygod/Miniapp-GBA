import Taro from '@tarojs/taro'
import {Button,Switch,Text,View} from '@tarojs/components'
import {useState} from 'react'
import {cloudClient} from '../../cloud/client'
import {loadSettings,saveSettings,type AppSettings} from '../../settings'
import './index.scss'

export default function SettingsPage(){
  const[settings,setSettings]=useState(loadSettings);const[loggedIn,setLoggedIn]=useState(cloudClient.isLoggedIn());const[loggingIn,setLoggingIn]=useState(false);const[deletionStatus,setDeletionStatus]=useState('')
  const update=<K extends keyof AppSettings>(key:K,value:AppSettings[K])=>{const next={...settings,[key]:value};setSettings(next);saveSettings(next)}
  const login=async()=>{setLoggingIn(true);try{const consent=await Taro.showModal({title:'云存档隐私说明',content:'云端仅保存 ROM SHA-256、存档正文、版本、设备名称和同步审计；不会上传 ROM。',confirmText:'同意并登录'});if(!consent.confirm)return;const system=await Taro.getDeviceInfo();await cloudClient.login(`${system.brand||'WeChat'} ${system.model||'device'}`);setLoggedIn(true);Taro.showToast({title:'云服务已连接',icon:'success'})}catch(error){showError(error)}finally{setLoggingIn(false)}}
  const logout=async()=>{const result=await Taro.showModal({title:'退出云服务',content:'本地 ROM 和本地存档不会删除'});if(result.confirm){await cloudClient.logout();setLoggedIn(false);update('cloudSync',false)}}
  const deleteAccount=async()=>{const first=await Taro.showModal({title:'删除全部云端数据',content:'将撤销所有设备会话并删除云存档、历史版本和设备记录。本地 ROM 与本地存档不会删除。',confirmText:'继续',confirmColor:'#d43c62'});if(!first.confirm)return;const second=await Taro.showModal({title:'再次确认',content:'云端数据进入删除流程后不能恢复。',confirmText:'确认删除',confirmColor:'#d43c62'});if(!second.confirm)return;const result=await cloudClient.requestAccountDeletion();setLoggedIn(false);update('cloudSync',false);setDeletionStatus(result.status)}
  const checkDeletion=async()=>{const result=await cloudClient.deletionStatus();setDeletionStatus(result?.status??'无进行中的请求')}
  return <View className='page-shell settings-page'><Text className='eyebrow'>SYSTEM</Text><View className='page-title'>设置</View><Text className='page-subtitle'>播放、触控和数据</Text>
    <SettingGroup title='播放'><SettingSwitch title='声音' detail='48 kHz 双声道' value={settings.sound} onChange={value=>update('sound',value)}/><SettingSwitch title='触控反馈' detail='操作键轻触振动' value={settings.haptics} onChange={value=>update('haptics',value)}/><SettingSwitch title='显示帧率' detail='播放器性能计数器' value={settings.showFps} onChange={value=>update('showFps',value)}/></SettingGroup>
    <SettingGroup title='存档'><SettingSwitch title='自动恢复点' detail='进入后台时创建' value={settings.autoState} onChange={value=>update('autoState',value)}/></SettingGroup>
    <SettingGroup title='云存档'><View className='account-line'><View><Text className='setting-title'>{loggedIn?'已连接':'未连接'}</Text><Text className='setting-detail'>{loggedIn?'微信身份会话有效':'仅使用本地存档'}</Text></View>{loggedIn?<Button className='account-button' onClick={()=>logout().catch(showError)}>退出</Button>:<Button className='account-button connect' loading={loggingIn} onClick={login}>微信登录</Button>}</View><SettingSwitch title='自动同步' detail='只上传存档，不上传 ROM' disabled={!loggedIn} value={settings.cloudSync&&loggedIn} onChange={value=>update('cloudSync',value)}/>{loggedIn&&<View className='account-line danger-line'><View><Text className='setting-title'>删除云端账号数据</Text><Text className='setting-detail'>本地文件不受影响</Text></View><Button className='account-button danger' onClick={()=>deleteAccount().catch(showError)}>删除</Button></View>}<View className='account-line'><View><Text className='setting-title'>删除进度</Text><Text className='setting-detail'>{deletionStatus||'可查询最近请求'}</Text></View><Button className='account-button' onClick={()=>checkDeletion().catch(showError)}>查询</Button></View></SettingGroup>
    <SettingGroup title='关于'><View className='about-line'><Text>MiniGBA</Text><Text className='mono'>0.1.0</Text></View><View className='about-line'><Text>核心</Text><Text className='mono'>mGBA 0.10.5</Text></View></SettingGroup>
  </View>
}

function SettingGroup({title,children}:{title:string;children:React.ReactNode}){return <View className='setting-group'><View className='section-title'>{title}</View><View className='setting-lines'>{children}</View></View>}
function SettingSwitch({title,detail,value,onChange,disabled=false}:{title:string;detail:string;value:boolean;onChange:(value:boolean)=>void;disabled?:boolean}){return <View className={`setting-line ${disabled?'disabled':''}`}><View><Text className='setting-title'>{title}</Text><Text className='setting-detail'>{detail}</Text></View><Switch color='#1bb4a5' checked={value} disabled={disabled} onChange={event=>onChange(event.detail.value)}/></View>}
const showError=(error:unknown)=>Taro.showModal({title:'云服务连接失败',content:error instanceof Error?error.message:String(error),showCancel:false})
