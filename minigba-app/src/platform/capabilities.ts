export type MiniAppPlatform='weapp'|'tt'

export function currentPlatform():MiniAppPlatform{
  return typeof __MINIGBA_PLATFORM__==='string'?__MINIGBA_PLATFORM__:'weapp'
}

export function supportsLocalFileTransfer():boolean{
  return currentPlatform()!=='tt'
}

export function supportsCloudIdentity():boolean{
  return currentPlatform()!=='tt'
}
