import {describe,expect,it} from 'vitest'
import {PlaySessionTracker} from './play-session-tracker'

const romId='d'.repeat(64)
describe('PlaySessionTracker',()=>{
  it('counts only active intervals across pause and background checkpoints',()=>{
    let now=1_700_000_000_000
    const tracker=new PlaySessionTracker(romId,()=>now,()=> '123e4567-e89b-42d3-a456-426614174000')
    tracker.start();now+=10_900
    const paused=tracker.checkpoint('paused')
    expect(paused?.session.durationSeconds).toBe(10);expect(paused?.deltaSeconds).toBe(10)
    now+=60_000;tracker.start();now+=5_500
    const background=tracker.checkpoint('background')
    expect(background?.session.durationSeconds).toBe(16);expect(background?.deltaSeconds).toBe(6)
    now+=30_000
    const exit=tracker.checkpoint('exit')
    expect(exit?.session.durationSeconds).toBe(16);expect(exit?.deltaSeconds).toBe(0)
    expect(exit?.session.id).toBe(paused?.session.id)
  })
  it('does not create a record before one full active second',()=>{let now=1_700_000_000_000;const tracker=new PlaySessionTracker(romId,()=>now,()=> '123e4567-e89b-42d3-a456-426614174001');tracker.start();now+=500;expect(tracker.checkpoint('exit')).toBeUndefined()})
})
