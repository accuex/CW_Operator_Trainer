import type {Plugin} from 'vite';
export function houkiReviewPlugin():Plugin;
export function initializeReviewAccounts(root:string):Promise<unknown[]>;
export function createReviewMiddleware(options:Record<string,unknown>):(req:any,res:any,next:()=>void)=>Promise<void>;
