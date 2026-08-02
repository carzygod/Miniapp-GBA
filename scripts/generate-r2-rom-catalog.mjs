import {readFile,writeFile} from 'node:fs/promises'

const inputPath=process.argv[2]
const outputPath=process.argv[3]??'catalog.r2.json'
if(!inputPath)throw new Error('usage: npm run generate:catalog -- <r2-objects.json> [catalog.r2.json]')

const input=JSON.parse(await readFile(inputPath,'utf8'))
const objects=Array.isArray(input)?input:Array.isArray(input.result)?input.result:Array.isArray(input.objects)?input.objects:undefined
if(!objects)throw new Error('input must be an object array or contain result/objects')

const publicBase=validateBase(process.env.TARO_APP_ROM_PUBLIC_BASE_URL??'https://rom.sid.mom')
const generatedAt=process.env.MINIGBA_CATALOG_GENERATED_AT??new Date().toISOString()
if(!Number.isFinite(Date.parse(generatedAt)))throw new Error('MINIGBA_CATALOG_GENERATED_AT is invalid')

const seenIds=new Set(),seenKeys=new Set()
const items=objects.map((object,index)=>{
  const label=`object ${index+1}`
  const objectKey=requiredText(object?.key,400,`${label} key`)
  if(!validObjectKey(objectKey))throw new Error(`${label} is not a safe gba/ object`)
  const etag=requiredText(object?.etag,128,`${label} etag`).replace(/^"|"$/g,'')
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(etag))throw new Error(`${label} etag cannot be used as a catalog ID`)
  if(seenIds.has(etag)||seenKeys.has(objectKey))throw new Error(`${label} duplicates an ID or object key`)
  seenIds.add(etag);seenKeys.add(objectKey)
  const sizeBytes=Number(object?.size)
  if(!Number.isInteger(sizeBytes)||sizeBytes<0xc0||sizeBytes>32*1024*1024)throw new Error(`${label} size is invalid`)
  const updatedAt=requiredText(object?.last_modified,64,`${label} last_modified`)
  if(!Number.isFinite(Date.parse(updatedAt)))throw new Error(`${label} last_modified is invalid`)
  const {title,region,language}=parseName(objectKey)
  const item={id:etag,title,objectKey,etag,downloadUrl:objectUrl(publicBase,objectKey),sizeBytes,genres:[],featured:false,updatedAt}
  if(region)item.region=region
  if(language)item.language=language
  return item
})

const catalog={schemaVersion:2,generatedAt,bucket:'rom',items}
await writeFile(outputPath,`${JSON.stringify(catalog,null,2)}\n`,'utf8')
console.log(JSON.stringify({generated:true,input:inputPath,output:outputPath,items:items.length,generatedAt}))

function parseName(key){
  const title=key.slice(key.lastIndexOf('/')+1).replace(/\.gba$/i,'')
  if(!title||title.length>128)throw new Error(`${key} title is invalid`)
  const groups=[...title.matchAll(/\(([^()]*)\)/g)].map(match=>match[1])
  const regionWords=['USA','Europe','Japan','World','Australia','Korea','China','Taiwan','Brazil','France','Germany','Spain','Italy','Netherlands','Sweden','Denmark','Norway']
  const languageCodes=new Set(['En','Fr','De','Es','It','Nl','Pt','Sv','Da','No','Fi','Ja','Ko','Zh'])
  const region=groups.find(group=>regionWords.some(word=>group.split(/,\s*/).includes(word)))
  const languageGroup=groups.find(group=>{const parts=group.split(/,\s*/);return parts.length>0&&parts.every(part=>languageCodes.has(part))})
  return{title,region,language:languageGroup?.split(/,\s*/).join(', ')}
}

function objectUrl(base,key){return`${base}/${key.split('/').map(encodeURIComponent).join('/')}`}
function requiredText(value,max,label){if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new Error(`${label} is invalid`);return value.trim()}
function validObjectKey(value){const segments=value.split('/');return value.startsWith('gba/')&&value.toLowerCase().endsWith('.gba')&&!/[\\\0\r\n]/.test(value)&&segments.every(segment=>Boolean(segment)&&segment!=='.'&&segment!=='..')}
function validateBase(value){let url;try{url=new URL(value)}catch{throw new Error('TARO_APP_ROM_PUBLIC_BASE_URL is invalid')}if(url.protocol!=='https:'||url.username||url.password||url.hash||url.pathname!=='/'||url.search)throw new Error('TARO_APP_ROM_PUBLIC_BASE_URL must be an HTTPS origin');return url.origin}
