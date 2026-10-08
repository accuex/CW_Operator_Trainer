import {expect,it,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
it('service worker never intercepts private review routes',()=>{const handlers:Record<string,Function>={};runInNewContext(readFileSync('public/sw.js','utf8'),{URL,self:{addEventListener:(name:string,fn:Function)=>handlers[name]=fn}});let intercepted=false;handlers.fetch({request:{method:'GET',url:'http://127.0.0.1:5187/__houki-review/data'},respondWith:()=>intercepted=true});expect(intercepted).toBe(false);});
import {loadDevReview} from './review-loader';
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('stale service worker blocks review before any fetch',async()=>{vi.stubEnv('NODE_ENV','development');vi.stubGlobal('navigator',{serviceWorker:{controller:{}}});const request=vi.fn();vi.stubGlobal('fetch',request);await expect(loadDevReview()).rejects.toThrow('Review unavailable');expect(request).not.toHaveBeenCalled();});
it('production never attempts a private fetch',async()=>{vi.stubEnv('NODE_ENV','production');vi.stubGlobal('navigator',{});const request=vi.fn();vi.stubGlobal('fetch',request);await expect(loadDevReview()).rejects.toThrow('Review unavailable');expect(request).not.toHaveBeenCalled();});
it('an authorization failure never parses a body',async()=>{vi.stubEnv('NODE_ENV','development');vi.stubGlobal('navigator',{});const json=vi.fn();vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,json}));await expect(loadDevReview()).rejects.toThrow('Reviewer authentication required');expect(json).not.toHaveBeenCalled();});
