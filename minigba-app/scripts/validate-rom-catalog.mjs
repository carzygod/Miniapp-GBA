import {readFile} from 'node:fs/promises'

const source=process.argv[2]??'catalog.example.json'
const allowed=new Set((process.env.TARO_APP_ROM_DOWNLOAD_HOSTS??'roms.example.com').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean))
const resolutionBase=/^https:\/\//i.test(source)?source:`https://${[...allowed][0]??'invalid.example'}/catalog/v1/roms.json`
const text=/^https:\/\//i.test(source)?await fetchRemote(source):await readFile(source,'utf8')
let value
try{value=JSON.parse(text)}catch{throw new Error('ROM catalog is not valid JSON')}
if(!value||typeof value!=='object'||value.schemaVersion!==1||!validDate(value.generatedAt)||value.bucket!=='rom')throw new Error('ROM catalog header is invalid or bucket is not rom')
if(!Array.isArray(value.items)||value.items.length>500)throw new Error('ROM catalog must contain at most 500 items')
const seen=new Set()
for(const[itemIndex,item]of value.items.entries()){
  const label=`item ${itemIndex+1}`
  if(!item||typeof item!=='object'||!/^[0-9a-f]{64}$/.test(item.romId)||seen.has(item.romId))throw new Error(`${label} has an invalid or duplicate romId`)
  seen.add(item.romId)
  if(!short(item.title,80)||item.gameCode!==undefined&&!short(item.gameCode,12))throw new Error(`${label} has invalid title or gameCode`)
  if(!Number.isInteger(item.sizeBytes)||item.sizeBytes<0xc0||item.sizeBytes>32*1024*1024)throw new Error(`${label} has invalid sizeBytes`)
  validateAssetUrl(item.downloadUrl,resolutionBase,allowed,`${label} downloadUrl`)
  if(item.coverUrl!==undefined)validateAssetUrl(item.coverUrl,resolutionBase,allowed,`${label} coverUrl`)
  if(item.genres!==undefined&&(!Array.isArray(item.genres)||item.genres.length>8||item.genres.some(value=>!short(value,24))))throw new Error(`${label} has invalid genres`)
  if(!item.license||typeof item.license!=='object'||!short(item.license.name,80))throw new Error(`${label} must declare a distribution license`)
  if(item.license.url!==undefined)validateHttps(item.license.url,`${label} license URL`)
}
console.log(JSON.stringify({validated:true,source,bucket:value.bucket,items:value.items.length,generatedAt:value.generatedAt}))

async function fetchRemote(url){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15_000);try{const response=await fetch(url,{headers:{Accept:'application/json'},signal:controller.signal});if(!response.ok)throw new Error(`ROM catalog request failed (${response.status})`);return await response.text()}finally{clearTimeout(timer)}}
function validateAssetUrl(value,base,hosts,label){if(typeof value!=='string'||!value.trim())throw new Error(`${label} is missing`);const url=validateHttps(new URL(value,base).toString(),label);if(!hosts.has(url.host.toLowerCase()))throw new Error(`${label} host is not in TARO_APP_ROM_DOWNLOAD_HOSTS`)}
function validateHttps(value,label){let url;try{url=new URL(value)}catch{throw new Error(`${label} is invalid`)}if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error(`${label} must be credential-free HTTPS without a fragment`);return url}
function short(value,max){return typeof value==='string'&&Boolean(value.trim())&&value.trim().length<=max}
function validDate(value){return typeof value==='string'&&Number.isFinite(Date.parse(value))}
