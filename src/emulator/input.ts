export const KeyMask = {
  A: 1 << 0, B: 1 << 1, Select: 1 << 2, Start: 1 << 3,
  Right: 1 << 4, Left: 1 << 5, Up: 1 << 6, Down: 1 << 7,
  R: 1 << 8, L: 1 << 9,
} as const

export interface ControlRect { left:number; top:number; width:number; height:number }

export function directionMask(pageX:number,pageY:number,rect:ControlRect,deadZone=0.24):number{
  const x=(pageX-(rect.left+rect.width/2))/(rect.width/2)
  const y=(pageY-(rect.top+rect.height/2))/(rect.height/2)
  const magnitude=Math.hypot(x,y)
  if(magnitude<deadZone)return 0
  const angle=Math.atan2(y,x)
  const eighth=Math.PI/8
  if(angle>=-eighth&&angle<eighth)return KeyMask.Right
  if(angle>=eighth&&angle<3*eighth)return KeyMask.Right|KeyMask.Down
  if(angle>=3*eighth&&angle<5*eighth)return KeyMask.Down
  if(angle>=5*eighth&&angle<7*eighth)return KeyMask.Down|KeyMask.Left
  if(angle>=7*eighth||angle<-7*eighth)return KeyMask.Left
  if(angle>=-7*eighth&&angle<-5*eighth)return KeyMask.Left|KeyMask.Up
  if(angle>=-5*eighth&&angle<-3*eighth)return KeyMask.Up
  return KeyMask.Up|KeyMask.Right
}

export class InputBitmap {
  private readonly sources=new Map<string,number>()
  update(source:string,mask:number):number{if(mask)this.sources.set(source,mask&0x3ff);else this.sources.delete(source);return this.mask}
  clear():number{this.sources.clear();return 0}
  get mask():number{let result=0;for(const mask of this.sources.values())result|=mask;return result&0x3ff}
}

