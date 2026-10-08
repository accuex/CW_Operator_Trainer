import type {TrainerMaster} from './types';
type Base={id:string;contentVersion:number;heading:string};
export type LessonBlock=Base & (
 | {type:'explanation';body:string}
 | {type:'keyPoints'|'procedure';items:string[]}
 | {type:'conditions';ruleIds:string[]}
 | {type:'comparison';entries:{label:string;body:string}[]}
 | {type:'question'|'redSheet';questionId:string}
 | {type:'amendment';cardId:string}
 | {type:'pitfall';cardId:string;ruleIds:string[];conditionIds:string[]}
 | {type:'source';sourceIds:string[]});
export interface Lesson {id:string;contentVersion:number;chapterId:string;themeId:string;title:string;questionIds:string[];ruleIds:string[];amendmentIds:string[];sourceIds:string[];prerequisiteLessonIds:string[];blocks:LessonBlock[]}
export interface LessonRelease {schemaVersion:'1.0.0';contentVersion:number;editionId:string;master:TrainerMaster;lessons:Lesson[];dates:{lawEffectiveAt:string|null;verificationAsOf:string|null;sourceRetrievedAt:string|null;editorialVersion:number;humanApprovedAt:string|null};temporalRecords:{entityId:string;contentVersion:number;historicalExamDate:string|null;lawEffectiveAt:string|null;verificationAsOf:string|null;sourceRetrievedAt:string|null;editorialReviewedAt:string|null;publishedAt:string|null}[];publicReviews:{id:string;contentVersion:number;purpose:string;rights:string;humanApproval:string;approvedAt:string|null;releaseApproved:boolean}[]}
