import {readFileSync,statSync} from 'node:fs'
import {join} from 'node:path'

const expectedTabs=[
  {pagePath:'pages/library/index',iconPath:'assets/tabbar/game.png',selectedIconPath:'assets/tabbar/game-active.png'},
  {pagePath:'pages/saves/index',iconPath:'assets/tabbar/saves.png',selectedIconPath:'assets/tabbar/saves-active.png'},
  {pagePath:'pages/settings/index',iconPath:'assets/tabbar/settings.png',selectedIconPath:'assets/tabbar/settings-active.png'},
]

export function validateTabBarIcons(root,app){
  if(!Array.isArray(app.tabBar?.list)||app.tabBar.list.length!==expectedTabs.length)throw new Error('tabBar does not contain the expected entries')
  for(const expected of expectedTabs){
    const actual=app.tabBar.list.find(item=>item.pagePath===expected.pagePath)
    if(!actual||actual.iconPath!==expected.iconPath||actual.selectedIconPath!==expected.selectedIconPath)throw new Error(`tabBar icons are missing for ${expected.pagePath}`)
    validatePng(join(root,expected.iconPath))
    validatePng(join(root,expected.selectedIconPath))
  }
  return expectedTabs.length*2
}

function validatePng(path){
  const size=statSync(path).size
  if(size<=24||size>40*1024)throw new Error(`tabBar icon has an invalid size: ${path}`)
  const header=readFileSync(path).subarray(0,24)
  if(header.toString('hex',0,8)!=='89504e470d0a1a0a')throw new Error(`tabBar icon is not a PNG: ${path}`)
  if(header.readUInt32BE(16)!==81||header.readUInt32BE(20)!==81)throw new Error(`tabBar icon must be 81x81: ${path}`)
}
