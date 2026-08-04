type ErrorRecord=Record<string,unknown>

export function errorMessage(error:unknown,fallback='未知错误'):string{
  if(error instanceof Error){
    const message=error.message.trim()
    return friendlyMessage(message||error.name||fallback)
  }
  if(typeof error==='string')return friendlyMessage(error.trim()||fallback)
  if(isRecord(error)){
    for(const key of['errMsg','message','errorMessage','errmsg','reason']){
      const value=error[key]
      if(typeof value==='string'&&value.trim())return friendlyMessage(value.trim())
    }
    const code=error.code??error.errno
    if(typeof code==='string'||typeof code==='number')return`错误代码 ${code}`
    try{
      const serialized=JSON.stringify(error)
      if(serialized&&serialized!=='{}')return serialized
    }catch{ /* fall through to the bounded fallback */ }
    return fallback
  }
  if(error===undefined||error===null)return fallback
  const text=String(error).trim()
  return text&&text!=='[object Object]'?text:fallback
}

export function asError(error:unknown,fallback='操作失败'):Error{
  return error instanceof Error?error:new Error(errorMessage(error,fallback))
}

export function isMissingFileError(error:unknown):boolean{
  if(isRecord(error)&&(error.code==='ENOENT'||error.errno===2||error.errno===-2))return true
  return /(?:no such file|\benoent\b|file not found)/i.test(errorMessage(error,''))
}

export function isAlreadyExistsError(error:unknown):boolean{
  if(isRecord(error)&&(error.code==='EEXIST'||error.errno===17||error.errno===-17))return true
  return /(?:file exists|already exists|\beexist\b)/i.test(errorMessage(error,''))
}

export function isCancellationError(error:unknown):boolean{
  return /(?:\bcancel(?:led|ed)?\b|取消)/i.test(errorMessage(error,''))
}

function isRecord(value:unknown):value is ErrorRecord{
  return Boolean(value)&&typeof value==='object'
}

function friendlyMessage(message:string):string{
  if(/user dir saved file size limit exceeded/i.test(message))return'小程序本地存储空间不足，请前往“设置 > 存储管理”清理后重试'
  return message
}
