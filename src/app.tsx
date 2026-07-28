import {useEffect,type PropsWithChildren} from 'react'
import {cloudClient} from './cloud/client'
import {syncService} from './cloud/sync-service'
import './app.scss'

export default function App({ children }: PropsWithChildren) {
  useEffect(()=>{cloudClient.refresh().catch(()=>undefined).then(()=>syncService.runDue()).catch(()=>undefined)},[])
  return children
}
