import {readdirSync,readFileSync} from 'node:fs'
import {join,relative} from 'node:path'

const root='dist'
const wxssFiles=walk(root).filter(path=>path.endsWith('.wxss'))
if(!wxssFiles.length)throw new Error('dist does not contain generated WXSS files')

const project=JSON.parse(readFileSync(join(root,'project.config.json'),'utf8'))
if(project.appid!=='wx4a8213e3dfa88565')throw new Error(`unexpected WeChat AppID: ${project.appid??'missing'}`)
if(project.libVersion!=='3.15.2')throw new Error(`unexpected WeChat base library: ${project.libVersion??'missing'}`)

const expectedRomHosts=process.env.TARO_APP_ROM_DOWNLOAD_HOSTS?.trim()||'rom.sid.mom'
const javascript=walk(root).filter(path=>path.endsWith('.js')).map(path=>readFileSync(path,'utf8')).join('\n')
const hostMarker=`=${JSON.stringify(expectedRomHosts)},`
let cursor=0,romDownloadHostSets=0
while((cursor=javascript.indexOf(hostMarker,cursor))>=0){
  const context=javascript.slice(cursor,cursor+220)
  if(context.includes('new Set(')&&context.includes('.split(",")'))romDownloadHostSets++
  cursor+=hostMarker.length
}
if(romDownloadHostSets<2)throw new Error(`compiled ROM host allowlists are missing: expected ${expectedRomHosts}`)

const universalSelector=/(^|[,{>+~]\s*)\*(?=\s*(?:[,{>+~.:#\[]|$))/m
const invalid=wxssFiles.filter(path=>universalSelector.test(readFileSync(path,'utf8')))
if(invalid.length)throw new Error(`WXSS universal selectors are unsupported: ${invalid.map(path=>relative(root,path)).join(', ')}`)

console.log(JSON.stringify({validated:true,appid:project.appid,libVersion:project.libVersion,romDownloadHosts:expectedRomHosts,romDownloadHostSets,wxssFiles:wxssFiles.length}))

function walk(directory){
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const path=join(directory,entry.name)
    return entry.isDirectory()?walk(path):[path]
  })
}
