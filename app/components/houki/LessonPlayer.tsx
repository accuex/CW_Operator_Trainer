'use client';
import {useState} from 'react';
import type {RedQuestion} from '@/lib/houki/trainer/types';
import type {LessonRelease,LessonBlock} from '@/lib/houki/trainer/lesson-types';
import {toggleRevealed} from '@/lib/houki/trainer/engine';
import {Sources,Card} from './ResourceBlocks';
export function RedSheetPlayer({question,revealed,setRevealed,explanationOpen,setExplanationOpen}:{question:RedQuestion;revealed:string[];setRevealed:(ids:string[])=>void;explanationOpen:boolean;setExplanationOpen:(open:boolean)=>void}){
 return <><p className="ht-question">{question.tokens.map((t,i)=>{if(t.kind==='text')return <span key={i}>{t.text}</span>;const b=question.blanks.find(x=>x.id===t.blankId)!;const shown=revealed.includes(b.printedPositionId);return <button key={b.printedPositionId} className="ht-blank" aria-expanded={shown} aria-label={`穴${b.slotLabel}：${shown?'答えを隠す':'答えを表示'}`} onClick={()=>setRevealed(toggleRevealed(revealed,b.printedPositionId))}>穴{b.slotLabel}：{shown?b.answer:'答えを表示'}</button>;})}</p><div className="ht-actions"><button className="btn btn-secondary" onClick={()=>setRevealed(question.blanks.map(b=>b.printedPositionId))}>すべて表示</button><button className="btn btn-secondary" onClick={()=>setRevealed([])}>すべて隠す</button></div><p role="status" aria-live="polite">{revealed.length} / {question.blanks.length}個の答えを表示中</p><details open={explanationOpen} onToggle={e=>setExplanationOpen(e.currentTarget.open)}><summary>解説を読む</summary><p>{question.explanation}</p></details></>;
}
function EmbeddedSheet({question}:{question:RedQuestion}){const [revealed,setRevealed]=useState<string[]>([]);const [open,setOpen]=useState(false);return <RedSheetPlayer question={question} revealed={revealed} setRevealed={setRevealed} explanationOpen={open} setExplanationOpen={setOpen}/>;}
export function BlockRenderer({block,release,openQuestion}:{block:LessonBlock;release:LessonRelease;openQuestion:(id:string)=>void}){
 const master=release.master;
 switch(block.type){
 case 'explanation':return <p>{block.body}</p>;
 case 'keyPoints':return <ul>{block.items.map((x,i)=><li key={i}>{x}</li>)}</ul>;
 case 'procedure':return <ol>{block.items.map((x,i)=><li key={i}>{x}</li>)}</ol>;
 case 'comparison':return <div className="ht-compare">{block.entries.map((e,i)=><div key={i}><h4>{e.label}</h4><p>{e.body}</p></div>)}</div>;
 case 'conditions':return <>{block.ruleIds.map(id=>{const r=master.rules.find(x=>x.id===id)!;return <div key={id}><p><strong>主体：</strong>{r.subject}</p><p><strong>行為：</strong>{r.action}</p>{r.conditionIds.map(cid=>{const c=master.conditions.find(x=>x.id===cid)!;return <div key={cid}><strong>{c.operator==='AND'?'すべて必要（AND）':'いずれかでよい（OR）'}</strong><ul>{c.requirements.map((x,i)=><li key={i}>{x}</li>)}</ul><p>例外：{c.exceptions.join(' / ')||'設定なし'}</p></div>;})}</div>;})}</>;
 case 'question':return <button className="btn btn-primary" onClick={()=>openQuestion(block.questionId)}>{master.questions.find(q=>q.id===block.questionId)!.title}</button>;
 case 'redSheet':return <EmbeddedSheet question={master.questions.find(q=>q.id===block.questionId)!}/>;
 case 'amendment':case 'pitfall':return <Card card={master.cards.find(c=>c.id===block.cardId)!} master={master}/>;
 case 'source':return <details><summary>出典を開く</summary><Sources master={master} ids={block.sourceIds}/></details>;
 default:throw Error('未知の教材ブロック');
 }
}
export function LessonPlayer({release,lessonId,openQuestion}:{release:LessonRelease;lessonId:string;openQuestion:(id:string)=>void}){
 const lesson=release.lessons.find(l=>l.id===lessonId);const note=release.master.notes.find(n=>n.id===lessonId);if(!lesson||!note)return <p role="alert">教材を表示できません。章一覧から選び直してください。</p>;
 return <article className="ht-lesson panel"><h2 tabIndex={-1} data-trainer-focus>{lesson.title}</h2>{lesson.blocks.map(block=><section key={block.id} data-block-type={block.type}><h3>{block.heading}</h3><BlockRenderer block={block} release={release} openQuestion={openQuestion}/></section>)}<details className="ht-audit"><summary>確認範囲・未確認事項・教材版</summary><p>確認範囲：{note.scope}</p><p>法令確認基準日：{note.asOfDate??'対象外（架空サンプル）'}</p><p>教材版：{lesson.contentVersion}</p>{note.asOfDate?<p>出典：各テーマの公式一次資料（e-Gov法令検索・総務省公開資料）。編集：CWOT。法令の要件をもとに編集した学習教材で、政府が作成した教材ではありません。法令原文は出典リンクで確認してください。</p>:<p>表示と操作を試す架空サンプルです。</p>}<ul>{note.unknowns.map((x,i)=><li key={i}>{x}</li>)}</ul></details></article>;
}
