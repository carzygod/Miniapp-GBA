import {readFile} from 'node:fs/promises'

const source=process.argv[2]??'catalog.example.json'
const allowed=new Set((process.env.TARO_APP_ROM_DOWNLOAD_HOSTS?.trim()||'rom.sid.mom').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean))
const resolutionBase=/^https:\/\//i.test(source)?source:`https://${[...allowed][0]??'invalid.example'}/catalog/v2/roms.json`
const text=/^https:\/\//i.test(source)?await fetchRemote(source):await readFile(source,'utf8')
let value
try{value=JSON.parse(text)}catch{throw new Error('ROM catalog is not valid JSON')}
if(!value||typeof value!=='object'||value.schemaVersion!==2||!validDate(value.generatedAt)||value.bucket!=='rom')throw new Error('ROM catalog header is invalid or bucket is not rom')
if(!Array.isArray(value.items)||value.items.length>2000)throw new Error('ROM catalog must contain at most 2000 items')
const seen=new Set(),seenKeys=new Set()
for(const[itemIndex,item]of value.items.entries()){
  const label=`item ${itemIndex+1}`
  if(!item||typeof item!=='object'||!validId(item.id)||seen.has(item.id))throw new Error(`${label} has an invalid or duplicate id`)
  seen.add(item.id)
  if(!short(item.title,128)||item.gameCode!==undefined&&!short(item.gameCode,12))throw new Error(`${label} has invalid title or gameCode`)
  if(!validObjectKey(item.objectKey)||seenKeys.has(item.objectKey))throw new Error(`${label} has an invalid or duplicate objectKey`)
  seenKeys.add(item.objectKey)
  if(item.etag!==undefined&&!short(item.etag,128))throw new Error(`${label} has an invalid etag`)
  if(!Number.isInteger(item.sizeBytes)||item.sizeBytes<0xc0||item.sizeBytes>32*1024*1024)throw new Error(`${label} has invalid sizeBytes`)
  const downloadUrl=validateAssetUrl(item.downloadUrl,resolutionBase,allowed,`${label} downloadUrl`)
  if(decodedPath(downloadUrl)!==`/${item.objectKey}`)throw new Error(`${label} downloadUrl does not match objectKey`)
  if(item.coverUrl!==undefined)validateAssetUrl(item.coverUrl,resolutionBase,allowed,`${label} coverUrl`)
  if(item.genres!==undefined&&(!Array.isArray(item.genres)||item.genres.length>8||item.genres.some(value=>!short(value,24))))throw new Error(`${label} has invalid genres`)
  if(item.description!==undefined&&!short(item.description,240))throw new Error(`${label} has an invalid description`)
  if(item.region!==undefined&&!short(item.region,24))throw new Error(`${label} has an invalid region`)
  if(item.language!==undefined&&!short(item.language,48))throw new Error(`${label} has an invalid language`)
  if(item.featured!==undefined&&typeof item.featured!=='boolean')throw new Error(`${label} has an invalid featured flag`)
  if(item.updatedAt!==undefined&&!validDate(item.updatedAt))throw new Error(`${label} has an invalid updatedAt`)
  if(item.license!==undefined&&(!item.license||typeof item.license!=='object'||!short(item.license.name,80)))throw new Error(`${label} has invalid license metadata`)
  if(item.license?.url!==undefined){if(!short(item.license.url,300))throw new Error(`${label} has an invalid license URL`);validateHttps(item.license.url,`${label} license URL`)}
  if(item.license?.notice!==undefined&&!short(item.license.notice,240))throw new Error(`${label} has an invalid license notice`)
}
console.log(JSON.stringify({validated:true,source,bucket:value.bucket,items:value.items.length,generatedAt:value.generatedAt}))

async function fetchRemote(url){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15_000);try{const response=await fetch(url,{headers:{Accept:'application/json'},signal:controller.signal});if(!response.ok)throw new Error(`ROM catalog request failed (${response.status})`);return await response.text()}finally{clearTimeout(timer)}}
function validateAssetUrl(value,base,hosts,label){if(!short(value,600))throw new Error(`${label} is missing or too long`);const url=validateHttps(new URL(value,base).toString(),label);if(!hosts.has(url.host.toLowerCase()))throw new Error(`${label} host is not in TARO_APP_ROM_DOWNLOAD_HOSTS`);return url}
function validateHttps(value,label){let url;try{url=new URL(value)}catch{throw new Error(`${label} is invalid`)}if(url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error(`${label} must be credential-free HTTPS without a fragment`);return url}
function short(value,max){return typeof value==='string'&&Boolean(value.trim())&&value.trim().length<=max}
function validId(value){return typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)}
function validObjectKey(value){if(!short(value,400))return false;const segments=value.split('/');return value.startsWith('gba/')&&value.toLowerCase().endsWith('.gba')&&!/[\\\0\r\n]/.test(value)&&segments.every(segment=>Boolean(segment)&&segment!=='.'&&segment!=='..')}
function decodedPath(value){try{return decodeURIComponent(value.pathname)}catch{return''}}
function validDate(value){return typeof value==='string'&&Number.isFinite(Date.parse(value))}
