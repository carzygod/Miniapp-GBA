import {describe,expect,it} from 'vitest'
import {asError,errorMessage,isAlreadyExistsError,isCancellationError,isMissingFileError} from './error'

describe('platform error normalization',()=>{
  it('extracts WeChat errMsg objects without producing object Object',()=>{
    const source={errMsg:'readdir:fail no such file or directory',errno:2}
    expect(errorMessage(source)).toBe(source.errMsg)
    expect(asError(source)).toBeInstanceOf(Error)
    expect(asError(source).message).not.toContain('[object Object]')
  })

  it('recognizes filesystem codes before and after normalization',()=>{
    const missing={errMsg:"readdir:fail no such file or directory, scandir 'wxfile://usr/minigba/saves'",errno:2}
    const existing={errMsg:'mkdir:fail file already exists',code:'EEXIST'}
    expect(isMissingFileError(missing)).toBe(true)
    expect(isMissingFileError(asError(missing))).toBe(true)
    expect(isAlreadyExistsError(existing)).toBe(true)
    expect(isAlreadyExistsError(asError(existing))).toBe(true)
  })

  it('recognizes WeChat cancellation objects',()=>{
    expect(isCancellationError({errMsg:'chooseMessageFile:fail cancel'})).toBe(true)
    expect(isCancellationError({errMsg:'network permission denied'})).toBe(false)
  })
})
