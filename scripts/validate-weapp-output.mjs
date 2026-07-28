import {readdirSync,readFileSync} from 'node:fs'
import {join,relative} from 'node:path'

const root='dist'
const wxssFiles=walk(root).filter(path=>path.endsWith('.wxss'))
if(!wxssFiles.length)throw new Error('dist does not contain generated WXSS files')

const universalSelector=/(^|[,{>+~]\s*)\*(?=\s*(?:[,{>+~.:#\[]|$))/m
const invalid=wxssFiles.filter(path=>universalSelector.test(readFileSync(path,'utf8')))
if(invalid.length)throw new Error(`WXSS universal selectors are unsupported: ${invalid.map(path=>relative(root,path)).join(', ')}`)

console.log(JSON.stringify({validated:true,wxssFiles:wxssFiles.length}))

function walk(directory){
  return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const path=join(directory,entry.name)
    return entry.isDirectory()?walk(path):[path]
  })
}
