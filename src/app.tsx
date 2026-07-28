import {useEffect,type PropsWithChildren} from 'react'
import {syncService} from './cloud/sync-service'
import './app.scss'

export default function App({ children }: PropsWithChildren) {
  useEffect(()=>{syncService.runDue().catch(()=>undefined)},[])
  return children
}
