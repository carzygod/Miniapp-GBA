import {existsSync,readdirSync,readFileSync,statSync} from 'node:fs'
import {join,relative} from 'node:path'

const root='dist-douyin'
if(!existsSync(root)||!statSync(root).isDirectory())throw new Error(`${root} does not exist`)

const files=walk(root)
const ttssFiles=files.filter(path=>path.endsWith('.ttss'))
const ttmlFiles=files.filter(path=>path.endsWith('.ttml'))
if(!ttssFiles.length||!ttmlFiles.length)throw new Error('Douyin output does not contain generated TTSS and TTML files')

const project=JSON.parse(readFileSync(join(root,'project.config.json'),'utf8'))
const expectedAppId=process.env.TARO_APP_ID?.trim()||'testAppId'
if(project.appid!==expectedAppId)throw new Error(`unexpected Douyin AppID: ${project.appid??'missing'}`)
if(project.miniprogramRoot!=='./')throw new Error(`unexpected Douyin miniprogramRoot: ${project.miniprogramRoot??'missing'}`)
if(project.douyinProjectType!=='native')throw new Error(`unexpected Douyin project type: ${project.douyinProjectType??'missing'}`)

const app=JSON.parse(readFileSync(join(root,'app.json'),'utf8'))
if(!Array.isArray(app.pages)||!app.pages.includes('pages/library/index'))throw new Error('Douyin app.json is missing the library entry page')

const wasmPath=join(root,'player','assets','minigba-core.wasm')
if(!existsSync(wasmPath)||statSync(wasmPath).size===0)throw new Error('Douyin output is missing the emulator WASM core')

const javascript=files.filter(path=>path.endsWith('.js')).map(path=>readFileSync(path,'utf8')).join('\n')
if(!javascript.includes('TTWebAssembly'))throw new Error('Douyin output does not reference TTWebAssembly')
if(javascript.includes('WXWebAssembly'))throw new Error('Douyin output still references WXWebAssembly')

const unexpectedWeChatFiles=files.filter(path=>/\.(?:wxml|wxss)$/.test(path))
if(unexpectedWeChatFiles.length)throw new Error(`Douyin output contains WeChat templates: ${unexpectedWeChatFiles.map(path=>relative(root,path)).join(', ')}`)

console.log(JSON.stringify({validated:true,appid:project.appid,projectType:project.douyinProjectType,ttmlFiles:ttmlFiles.length,ttssFiles:ttssFiles.length,wasmBytes:statSync(wasmPath).size}))

function walk(directory){
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const path=join(directory,entry.name)
    return entry.isDirectory()?walk(path):[path]
  })
}
