import Taro from '@tarojs/taro'

export interface AppSettings{sound:boolean;haptics:boolean;autoState:boolean;cloudSync:boolean;showFps:boolean}
const key='minigba.settings.v1'
const defaults:AppSettings={sound:true,haptics:true,autoState:true,cloudSync:false,showFps:false}
export function loadSettings():AppSettings{const stored=Taro.getStorageSync<Partial<AppSettings>>(key);return{...defaults,...(stored||{})}}
export function saveSettings(value:AppSettings):void{Taro.setStorageSync(key,value)}

