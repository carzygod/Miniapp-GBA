import {describe,expect,it,vi} from 'vitest'

vi.mock('@tarojs/taro',()=>({default:{env:{USER_DATA_PATH:'/data'},getStorageSync:()=>undefined}}))
vi.mock('../platform/fs',()=>({dataRoot:'/data',ensureDirectory:async()=>undefined,exists:async()=>false,readBytes:async()=>new Uint8Array(),readText:async()=>'',unlinkIfExists:async()=>undefined,writeBytesAtomic:async()=>undefined,writeTextAtomic:async()=>undefined}))

import {hasNintendoLogo,parseHeader,validateGba} from './library-repository'

const logo='24ffae51699aa2213d84820a84e409ad11248b98c0817f21a352be199309ce2010464a4af82731ec58c7e83382e3cebf85f4df94ce4b09c194568ac01372a7fc9f844d73a3ca9a615897a327fc039876231dc7610304ae56bf38840040a70efdff52fe036f9530f197fbc08560d68025a963be03014e38e2f9a234ffbb3e0344780090cb88113a9465c07c6387f03cafd625e48b380aac7221d4f807'
const fromHex=(value:string)=>Uint8Array.from(value.match(/../g)!.map(byte=>Number.parseInt(byte,16)))
const fixture=()=>{const rom=new Uint8Array(256*1024);rom.set([0x2e,0,0,0xea]);rom.set(fromHex(logo),4);rom.set(new TextEncoder().encode('TEST GAME   '),0xa0);rom.set(new TextEncoder().encode('TGME'),0xac);rom[0xb2]=0x96;return rom}
describe('GBA header validation',()=>{
  it('recognizes a complete logo and parses identity fields',()=>{const rom=fixture();expect(()=>validateGba(rom)).not.toThrow();expect(hasNintendoLogo(rom)).toBe(true);expect(parseHeader(rom)).toEqual({title:'TEST GAME',gameCode:'TGME'})})
  it('rejects a file without the fixed GBA header byte',()=>{const rom=fixture();rom[0xb2]=0;expect(()=>validateGba(rom)).toThrow('GBA ROM')})
})
