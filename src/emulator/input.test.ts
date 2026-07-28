import {describe,expect,it} from 'vitest'
import {directionMask,InputBitmap,KeyMask} from './input'

const rect={left:100,top:200,width:200,height:200}
describe('virtual input',()=>{
  it('maps the full directional disc including diagonals',()=>{
    expect(directionMask(200,300,rect)).toBe(0)
    expect(directionMask(290,300,rect)).toBe(KeyMask.Right)
    expect(directionMask(275,225,rect)).toBe(KeyMask.Right|KeyMask.Up)
    expect(directionMask(200,390,rect)).toBe(KeyMask.Down)
    expect(directionMask(110,300,rect)).toBe(KeyMask.Left)
  })
  it('combines independent touches without losing held buttons',()=>{
    const bitmap=new InputBitmap()
    expect(bitmap.update('dpad',KeyMask.Right)).toBe(KeyMask.Right)
    expect(bitmap.update('a',KeyMask.A)).toBe(KeyMask.Right|KeyMask.A)
    expect(bitmap.update('dpad',0)).toBe(KeyMask.A)
    expect(bitmap.clear()).toBe(0)
  })
})

