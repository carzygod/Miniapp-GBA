import Taro from '@tarojs/taro'
import {useEffect,type PropsWithChildren} from 'react'
import {cloudClient} from './cloud/client'
import {syncService} from './cloud/sync-service'
import {cleanupStaleTemporaryFiles} from './storage/storage-maintenance'
import './app.scss'

export default function App({ children }: PropsWithChildren) {
  useEffect(()=>{cleanupStaleTemporaryFiles().catch(()=>undefined);cloudClient.refresh().catch(()=>undefined).then(()=>syncService.runDue()).catch(()=>undefined);const network=({isConnected}:{isConnected:boolean})=>{if(isConnected)syncService.runDue().catch(()=>undefined)};Taro.onNetworkStatusChange(network);return()=>Taro.offNetworkStatusChange(network)},[])
  return children
}
