import {validateRelease} from './release-validator.mjs';
import {validateTrainer} from './engine';
import type {LessonRelease} from './lesson-types';
export async function loadLessonRelease():Promise<LessonRelease>{
 const r=await fetch('/houki/trainer/active.json');if(!r.ok)throw Error('教材を読み込めません');
 try {const raw=await r.json();if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('不正な教材版index');const index=raw as Record<string,unknown>;if(index.schemaVersion!=='1.0.0'||typeof index.contentVersion!=='number'||!Number.isInteger(index.contentVersion)||index.contentVersion<1||index.file!==`/houki/trainer/lessons-v${index.contentVersion}.json`||Object.keys(index).length!==3)throw Error('不正な教材版index');const response=await fetch(String(index.file));if(!response.ok)throw Error('教材版がありません');const dto=validateRelease(await response.json());if(dto.contentVersion!==index.contentVersion)throw Error('教材版が一致しません');validateTrainer(dto.master);return dto;}
 catch(error){console.error('Houki lesson validation',error);throw Error('教材の形式を確認できません');}
}
