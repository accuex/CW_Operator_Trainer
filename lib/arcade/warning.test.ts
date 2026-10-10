import {describe,it,expect} from 'vitest';
import {warningFrame} from './warning';
import {WARNING_SECONDS,createGame,pauseGame,resumeAttack,advanceGame} from './cwGuard';
describe('WARNING presentation on the game clock',()=>{
 it('types WARNING before the subtitle, finishes in the 3.6 second transition',()=>{
  expect(warningFrame(0).title).toBe('');expect(warningFrame(.2).title).toBe('WAR');
  expect(warningFrame(.5)).toMatchObject({title:'WARNING',subtitle:'',glow:true});
  expect(warningFrame(1).subtitle).toBe('BO');
  expect(warningFrame(2)).toMatchObject({title:'WARNING',subtitle:'BOSS APPROACHING',titleCursor:false,subCursor:false});
  expect(WARNING_SECONDS).toBeGreaterThanOrEqual(3);expect(WARNING_SECONDS).toBeLessThanOrEqual(5);
 });
 it('does not progress while paused; resumes without resetting letters or bands',()=>{
  const g={...createGame('beginner'),stage:3,phase:'warning' as const,time:1,transitionUntil:WARNING_SECONDS};
  const paused=pauseGame(g),later=advanceGame(paused,999);
  expect(later).toBe(paused);expect(warningFrame(later.time)).toEqual(warningFrame(g.time));
  expect(resumeAttack(paused).time).toBe(g.time);
 });
 it('reduced motion immediately presents all text and stationary bands',()=>{
  expect(warningFrame(0,true)).toMatchObject({title:'WARNING',subtitle:'BOSS APPROACHING',pulse:1,bandOffset:0,titleCursor:false,subCursor:false});
 });
});
