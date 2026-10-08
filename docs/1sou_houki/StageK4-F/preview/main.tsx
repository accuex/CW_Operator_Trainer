import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LessonPlayer,RedSheetPlayer} from '../../../../app/components/houki/LessonPlayer';
import type {LessonRelease} from '../../../../lib/houki/trainer/lesson-types';
interface ReviewData {release:LessonRelease;review:{theme:string;asOf:string;issues:string[]}}
function Review(){
 const [data,setData]=useState<ReviewData>();const [error,setError]=useState('');const [questionId,setQuestionId]=useState('');const [revealed,setRevealed]=useState<string[]>([]);const [open,setOpen]=useState(false);
 useEffect(()=>{fetch('/review-data').then(async r=>{if(!r.ok)throw Error('許可されたレビューセッションで開いてください');const raw=await r.json() as ReviewData;setData(raw);}).catch(()=>setError('教材を表示できません。ローカルレビュー用URLで入り直してください。'));},[]);
 const q=data?.release.master.questions.find(q=>q.id===questionId);
 return <main className="ht-trainer page-pad"><header className="ht-heading"><div><p className="section-kicker">CWOT · ローカル内部レビュー</p><h1>実法規教材の非公開プレビュー</h1></div></header><p className="ht-notice">人間の公開承認は未取得です。架空教材ではなく、確認済み条文の範囲をもとに編集した教材候補です。</p>{error&&<p role="alert">{error}</p>}{!data&&!error&&<p role="status">読み込み中…</p>}{data&&<><section className="panel ht-card"><h2>{data.review.theme}</h2><p>教材版：{data.release.contentVersion} / 法令確認基準日：{data.review.asOf}</p><p>公開承認：未承認 · releaseApproved=false</p><details><summary>審査待ち事項</summary><ul>{data.review.issues.map(x=><li key={x}>{x}</li>)}</ul></details></section>{q?<article className="panel ht-sheet"><button className="btn btn-secondary" onClick={()=>setQuestionId('')}>← 参考書へ戻る</button><h2>{q.title}</h2><p>{q.relationToCurrent}</p><RedSheetPlayer question={q} revealed={revealed} setRevealed={setRevealed} explanationOpen={open} setExplanationOpen={setOpen}/></article>:<LessonPlayer release={data.release} lessonId={data.release.lessons[0].id} openQuestion={id=>{setQuestionId(id);setRevealed([]);setOpen(false);}}/>}</>}</main>;
}
createRoot(document.getElementById('root')!).render(<Review/>);
