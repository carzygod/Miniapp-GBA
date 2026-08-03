import Taro from '@tarojs/taro'
import coreManifest from './assets/minigba-core.manifest.json'
import {errorMessage} from './platform/error'

export interface RuntimeDiagnostics {
  averageFps: number
  frameTimeP95Ms: number
  audioUnderruns: number
  audioOverflows: number
  updatedAt: string
}

export interface DiagnosticError { code: string; message: string; occurredAt: string }
export interface DiagnosticPackage {
  schemaVersion: 1
  generatedAt: string
  appVersion: string
  coreBuildId: string
  baseLibraryVersion: string
  device: { platform: string; system: string; model: string; benchmarkLevel?: number; memorySize?: number }
  runtime?: RuntimeDiagnostics
  recentErrors: DiagnosticError[]
}

const runtimeKey='minigba.diagnostics.runtime.v1'
const errorsKey='minigba.diagnostics.errors.v1'
const clockKey='minigba.diagnostics.wallClock.v1'

export function recordRuntimeDiagnostics(value:Omit<RuntimeDiagnostics,'updatedAt'>):void{
  Taro.setStorageSync(runtimeKey,{...value,updatedAt:new Date().toISOString()})
}

export function recordDiagnosticError(code:string,error:unknown):void{
  const current=Taro.getStorageSync<DiagnosticError[]>(errorsKey)||[]
  current.unshift({code:sanitizeText(code).slice(0,48),message:sanitizeText(errorMessage(error)).slice(0,240),occurredAt:new Date().toISOString()})
  Taro.setStorageSync(errorsKey,current.slice(0,10))
}

export function buildDiagnosticPackage():DiagnosticPackage{
  const device=Taro.getDeviceInfo()
  const app=Taro.getAppBaseInfo()
  return{
    schemaVersion:1,generatedAt:new Date().toISOString(),appVersion:'0.1.0',coreBuildId:coreManifest.buildId,
    baseLibraryVersion:app.SDKVersion||'unknown',
    device:{platform:device.platform||'unknown',system:device.system||'unknown',model:device.model||'unknown',benchmarkLevel:device.benchmarkLevel},
    runtime:Taro.getStorageSync<RuntimeDiagnostics>(runtimeKey)||undefined,
    recentErrors:Taro.getStorageSync<DiagnosticError[]>(errorsKey)||[],
  }
}

export function clockMovedBackwards(romId:string,now=Date.now()):boolean{
  const clocks=Taro.getStorageSync<Record<string,number>>(clockKey)||{}
  const previous=clocks[romId]
  clocks[romId]=now;Taro.setStorageSync(clockKey,clocks)
  return typeof previous==='number'&&now<previous-5*60_000
}

export function sanitizeText(value:string):string{
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi,'Bearer [redacted]')
    .replace(/(?:wxfile|file):\/\/[^\s]+/gi,'[local-path]')
    .replace(/[0-9a-f]{64}/gi,'[sha256]')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi,'[id]')
}
