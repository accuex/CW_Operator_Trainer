'use client';

import { Icon } from '@/app/components/icons';
import type { AppView } from '@/lib/appPaths';
import type { ExamMaterial } from '@/lib/examMaterial';

const MATERIALS = [
  { view: 'communication', saved: 'exam', title: '電気通信術', kicker: '受信練習', body: '欧文・和文を、本番形式で。聴いて、書き取る練習を。', detail: '科目選択・額表・採点', icon: 'exam' },
  { view: 'geography', saved: 'geography', title: '地理', kicker: '地図で覚える', body: '地点を眺めて、位置を覚える。白地図で確かめる。', detail: '学習・マップ・復習', icon: 'learn' },
  { view: 'english', saved: 'english', title: '専門英語', kicker: '場面から読む', body: '無線・海事・航空の表現と、規定の読み方を。', detail: '場面別・意味の対比・確認済み記録', icon: 'collection' },
] as const;

export default function ExamMenuView({ lastMaterial, onNavigate }: { lastMaterial: ExamMaterial; onNavigate: (view: AppView) => void }) {
  const last = MATERIALS.find(item => item.saved === lastMaterial) ?? MATERIALS[0];
  return <section className="exam-menu page-pad">
    <header className="exam-menu-heading"><p className="section-kicker">一総通</p><h1>今日は、何を学びますか。</h1><p>電気通信術・地理・専門英語。取り組みたい教材から。</p></header>
    <div className="exam-menu-continue panel"><div><small>前回の教材</small><strong>{last.title}</strong></div><button id="exam-continue" className="btn btn-primary" onClick={() => onNavigate(last.view)}>続きへ <Icon name="play" size={16} /></button></div>
    <div className="exam-menu-grid">{MATERIALS.map(item => <button type="button" id={`exam-${item.view}`} key={item.view} className="exam-menu-card panel" onClick={() => onNavigate(item.view)}><Icon name={item.icon} size={28} /><span className="section-kicker">{item.kicker}</span><h2>{item.title}</h2><p>{item.body}</p><small>{item.detail}</small><span className="exam-menu-open">教材を開く →</span></button>)}</div>
  </section>;
}
