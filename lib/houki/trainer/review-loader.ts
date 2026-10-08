import {validateReviewPreview} from './release-validator.mjs';
import type {LessonRelease} from './lesson-types';
export async function loadDevReview():Promise<LessonRelease>{
 if(process.env.NODE_ENV!=='development'||typeof navigator==='undefined'||navigator.serviceWorker?.controller)throw Error('Review unavailable');
 const response=await fetch('/__houki-review/data',{credentials:'same-origin',cache:'no-store'});
 if(!response.ok)throw Error('Reviewer authentication required');
 return validateReviewPreview(await response.json());
}
