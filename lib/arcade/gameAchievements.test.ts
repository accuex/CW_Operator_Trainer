import {describe,it,expect,vi,afterEach} from 'vitest';
import {createGame} from './cwGuard';
import {GAME_ACHIEVEMENTS,GAME_EVIDENCE_KEY,evaluateGameAchievements,recordGameTransition,transitionEvidence,type GameAchievementDefinition} from './gameAchievements';
afterEach(()=>vi.unstubAllGlobals());
describe('isolated game achievement foundation',()=>{
 it('records game-only immutable settings and milestones without creating unapproved rewards',()=>{
  const g=createGame('expert',false,73,{wpm:40,preset:'wabun'});
  expect(GAME_ACHIEVEMENTS).toEqual([]);expect(evaluateGameAchievements(transitionEvidence(null,g),GAME_ACHIEVEMENTS)).toEqual([]);
  expect(transitionEvidence(null,g)[0]).toMatchObject({game:'cw-guard',wpm:40,preset:'wabun',practice:false,hints:false});
  expect(transitionEvidence(g,{...g,time:99})).toEqual([]);
  expect(transitionEvidence(g,{...g,phase:'warning',stage:3})[0].kind).toBe('stage_cleared');
 });
 it('requires game evidence, excludes developer practice and deduplicates unlocks',()=>{
  const definitions:GameAchievementDefinition[]=[{id:'cw-guard:test-only',game:'cw-guard',accepts:e=>e.kind==='completed'}];
  const g=createGame('expert'),e={...transitionEvidence(null,g)[0],kind:'completed' as const};
  expect(evaluateGameAchievements([e],definitions)).toEqual(['cw-guard:test-only']);
  expect(evaluateGameAchievements([{...e,practice:true}],definitions)).toEqual([]);
  expect(evaluateGameAchievements([e],definitions,['cw-guard:test-only'])).toEqual([]);
  expect(evaluateGameAchievements([{...e,game:'ordinary-learning'} as never],definitions)).toEqual([]);
 });
 it('guest records deduplicate, cap at200 and never write progress, achievements or shared logs',()=>{
  const values=new Map<string,string>(),writes:string[]=[];vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);writes.push(k);}});
  const g=createGame('beginner');recordGameTransition(null,g);recordGameTransition(null,g);
  expect(JSON.parse(values.get(GAME_EVIDENCE_KEY)!)).toHaveLength(1);
  for(let i=1;i<250;i++)recordGameTransition({...g,correct:i-1},{...g,correct:i,attempts:i});
  expect(JSON.parse(values.get(GAME_EVIDENCE_KEY)!)).toHaveLength(200);expect(new Set(writes)).toEqual(new Set([GAME_EVIDENCE_KEY]));
  vi.stubGlobal('localStorage',{getItem:()=>{throw Error('denied');}});expect(()=>recordGameTransition(null,g)).not.toThrow();
 });
});
