import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {DEFAULT_PROFILE,DEFAULT_SETTINGS,saveProfile} from '../storage';
import {loadAuthSession} from '../api/authSession';
import {fetchSyncState,putSyncState} from '../api/sync';
import {pushStateNow,syncPreferCloud} from '../api/cloudSync';
import {applyGameEvidence,gameRewardOwned,transitionEvidence} from './gameAchievements';
import {createGame} from './cwGuard';
vi.mock('../api/authSession',()=>({loadAuthSession:vi.fn()}));
vi.mock('../api/sync',()=>({fetchSyncState:vi.fn(),putSyncState:vi.fn(),postSyncAnswers:vi.fn(),postSyncSessions:vi.fn()}));
vi.mock('../storage',async()=>{const actual=await vi.importActual<typeof import('../storage')>('../storage');return {...actual,saveProfile:vi.fn(),saveSettings:vi.fn(),replaceAnswers:vi.fn(),replaceSessions:vi.fn()};});
beforeEach(()=>{vi.clearAllMocks();const values=new Map<string,string>([['cwot:syncRevision','1']]);vi.stubGlobal('localStorage',{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)});});
afterEach(()=>vi.unstubAllGlobals());
function earned(){const old=createGame('expert',false,73,{wpm:20});return applyGameEvidence(DEFAULT_PROFILE,transitionEvidence(old,{...old,phase:'intermission',correct:20,attempts:20,rewardStats:{...old.rewardStats,stagesCleared:[1]}})).profile;}
describe('existing game reward profile synchronization contract (mock API)',()=>{
 it('guest progress stays local and never calls authenticated sync',async()=>{
  vi.mocked(loadAuthSession).mockReturnValue(null);const profile=earned();expect(gameRewardOwned(profile,'cw-guard:first-clear')).toBe(true);
  await pushStateNow(profile,DEFAULT_SETTINGS);expect(putSyncState).not.toHaveBeenCalled();
 });
 it('signed-in profile sends evidence and cloud read retains it without reseeding a reward-only profile',async()=>{
  vi.mocked(loadAuthSession).mockReturnValue({user:{id:1,email:'test@example.test'},accessToken:'mock',refreshToken:'mock',expiresAt:9999999999});
  const profile=earned();vi.mocked(putSyncState).mockResolvedValue({revision:2,schemaVersion:1});
  await pushStateNow(profile,DEFAULT_SETTINGS);expect(putSyncState).toHaveBeenCalledWith(expect.objectContaining({profile}));
  vi.mocked(putSyncState).mockClear();
  vi.mocked(fetchSyncState).mockResolvedValue({profile:{achievements:profile.achievements},settings:{},revision:2,schemaVersion:1,answers:[],sessions:[]});
  const restored=await syncPreferCloud();expect(restored?.seededFromLocal).toBe(false);expect(gameRewardOwned(restored!.profile,'cw-guard:first-clear')).toBe(true);
  expect(saveProfile).toHaveBeenCalledWith(restored!.profile);expect(putSyncState).not.toHaveBeenCalled();
 });
 it('cloud IDs alone do not grant game rewards',async()=>{
  vi.mocked(loadAuthSession).mockReturnValue({user:{id:1,email:'test@example.test'},accessToken:'mock',refreshToken:'mock',expiresAt:9999999999});
  vi.mocked(fetchSyncState).mockResolvedValue({profile:{achievements:{'cw-guard:ace':{unlockedAt:1}}},settings:{},revision:1,schemaVersion:1});
  const result=await syncPreferCloud();expect(result?.profile.achievements).toEqual({});
 });
});
