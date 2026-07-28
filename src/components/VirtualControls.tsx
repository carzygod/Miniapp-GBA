import Taro from '@tarojs/taro'
import {useEffect,useRef,useState} from 'react'
import {Text,View} from '@tarojs/components'
import {directionMask,KeyMask,type ControlRect} from '../emulator/input'
import './VirtualControls.scss'

interface Props{onChange:(source:string,mask:number)=>void;haptics?:boolean}
interface TouchLike{changedTouches:Array<{pageX:number;pageY:number}>;preventDefault?:()=>void}

export function VirtualControls({onChange,haptics=true}:Props){
  const rect=useRef<ControlRect>();const [direction,setDirection]=useState(0)
  useEffect(()=>{Taro.createSelectorQuery().select('#minigba-dpad').boundingClientRect(value=>{const item=value as unknown as ControlRect;if(item)rect.current=item}).exec()},[])
  const updateDirection=(rawEvent:unknown)=>{const event=rawEvent as TouchLike;event.preventDefault?.();const touch=event.changedTouches[0];if(!touch||!rect.current)return;const mask=directionMask(touch.pageX,touch.pageY,rect.current);setDirection(mask);onChange('dpad',mask)}
  const stopDirection=()=>{setDirection(0);onChange('dpad',0)}
  return <View className='controls' catchMove>
    <View className='shoulder-row'><PressButton label='L' source='l' mask={KeyMask.L} onChange={onChange}/><PressButton label='R' source='r' mask={KeyMask.R} onChange={onChange}/></View>
    <View className='control-main'>
      <View id='minigba-dpad' className='dpad' onTouchStart={updateDirection} onTouchMove={updateDirection} onTouchEnd={stopDirection} onTouchCancel={stopDirection}>
        <Text className={`dpad-arrow up ${direction&KeyMask.Up?'active':''}`}>UP</Text><Text className={`dpad-arrow right ${direction&KeyMask.Right?'active':''}`}>R</Text><Text className={`dpad-arrow down ${direction&KeyMask.Down?'active':''}`}>DN</Text><Text className={`dpad-arrow left ${direction&KeyMask.Left?'active':''}`}>L</Text><View className='dpad-center'/>
      </View>
      <View className='system-buttons'><PressButton label='SELECT' source='select' mask={KeyMask.Select} onChange={onChange}/><PressButton label='START' source='start' mask={KeyMask.Start} onChange={onChange}/></View>
      <View className='action-cluster'><PressButton label='B' source='b' mask={KeyMask.B} accent onChange={onChange} haptics={haptics}/><PressButton label='A' source='a' mask={KeyMask.A} accent onChange={onChange} haptics={haptics}/></View>
    </View>
  </View>
}

function PressButton({label,source,mask,onChange,accent=false,haptics=false}:{label:string;source:string;mask:number;onChange:(source:string,mask:number)=>void;accent?:boolean;haptics?:boolean}){
  const[pressed,setPressed]=useState(false)
  const down=(rawEvent:unknown)=>{const event=rawEvent as TouchLike;event.preventDefault?.();setPressed(true);onChange(source,mask);if(haptics)Taro.vibrateShort({type:'light'}).catch(()=>undefined)}
  const up=()=>{setPressed(false);onChange(source,0)}
  return <View className={`control-button ${accent?'accent':''} ${pressed?'pressed':''}`} onTouchStart={down} onTouchEnd={up} onTouchCancel={up}><Text>{label}</Text></View>
}
