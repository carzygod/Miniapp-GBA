export const DEFAULT_ROM_DOWNLOAD_HOSTS='rom.sid.mom'

export function resolveRomDownloadHosts(value:string|undefined):string{
  return value?.trim()||DEFAULT_ROM_DOWNLOAD_HOSTS
}
