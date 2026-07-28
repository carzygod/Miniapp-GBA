import type {SaveKind,SyncTask} from '../domain/models'
import {libraryRepository,syncQueue} from '../services'
import {cloudClient} from './client'
import {syncService} from './sync-service'

export class CloudDeleteService{
  async deleteSave(romId:string,kind:SaveKind,slot:string):Promise<void>{
    await syncService.exclusive(async()=>{
      const pending=(await syncQueue.list()).filter(task=>task.romId===romId&&task.kind===kind&&task.slot===slot)
      await syncQueue.removeKey(romId,kind,slot)
      try{await cloudClient.deleteSave(romId,kind,slot)}catch(error){await restoreTasks(pending);throw error}
    })
  }

  async deleteROM(romId:string):Promise<void>{
    await syncService.exclusive(async()=>{
      const pending=(await syncQueue.list()).filter(task=>task.romId===romId)
      await syncQueue.removeKey(romId)
      try{await cloudClient.deleteRomSaves(romId)}catch(error){await restoreTasks(pending);throw error}
      await libraryRepository.setCloudState(romId,'disabled')
    })
  }
}

async function restoreTasks(tasks:SyncTask[]):Promise<void>{for(const task of tasks)await syncQueue.enqueue(task)}

export const cloudDeleteService=new CloudDeleteService()
