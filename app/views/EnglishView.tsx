'use client';
import { useEffect, useMemo, useState } from 'react';
import { loadEnglishMaster, selectedItems, TIERS, TIER_LABELS, type EnglishMaster, type Tier } from '@/lib/english/data';
import { emptyProgress, readProgress, saveProgress, toggleConfirmed, type EnglishProgress } from '@/lib/english/progress';
import EnglishIllustration from '@/app/components/EnglishIllustration';
const MODALITY = { reading: 'リーディング', listening: '英会話資料', both: 'リーディング・英会話資料' };
const CATEGORY = { CORE: '通信の基本語', CONTEXT: '文脈で変わる意味', SCENE: '状況をつかむ語', LEGAL: '規定の読み方', EXTRA: '場面を補う語' };
export default function EnglishView({ onBack }: { onBack: () => void }) {
  const [master, setMaster] = useState<EnglishMaster>();
  const [progress, setProgress] = useState<EnglishProgress>(emptyProgress);
  const [loaded, setLoaded] = useState(false);
  const [writable, setWritable] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showMeaning, setShowMeaning] = useState(true);
  // Related references are a temporary preview; the saved range and reading position stay intact.
  const [previewId, setPreviewId] = useState('');
  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after mount (SSR markup must match)
    try { const saved = readProgress(window.localStorage); setProgress(saved.progress); setWritable(saved.writable); setNotice(saved.notice); }
    catch { setNotice('ブラウザに保存できません。この画面の間だけ記録します。'); }
    setLoaded(true);
    loadEnglishMaster().then(data => { if (active) setMaster(data); }).catch(e => { if (active) setError(String(e.message)); });
    return () => { active = false; };
  }, []);
  const tier = progress.last.tier;
  const group = master?.groups.some(g => g.id === progress.last.group) ? progress.last.group : 'all';
  const items = useMemo(() => master ? selectedItems(master, tier, group) : [], [master, tier, group]);
  const readingItem = items.find(i => i.learningEntityId === progress.last.item) ?? items[0];
  const item = master?.items.find(i => i.learningEntityId === previewId) ?? readingItem;
  const isPreview = !!previewId && !!item;
  const index = items.findIndex(i => i === item);
  const [meaningFor, setMeaningFor] = useState(item?.learningEntityId);
  if (meaningFor !== item?.learningEntityId) {
    setMeaningFor(item?.learningEntityId);
    setShowMeaning(true);
  }
  function update(next: EnglishProgress) {
    setProgress(next);
    if (!loaded || !writable) return;
    try { if (!saveProgress(next, window.localStorage)) { setWritable(false); setNotice('保存できません。この画面の間だけ記録します。'); } }
    catch { setWritable(false); setNotice('保存できません。この画面の間だけ記録します。'); }
  }
  function select(tier: Tier, group: string, id = '') { setPreviewId(''); update({ ...progress, last: { tier, group, item: id } }); }
  return <section className="english-view page-pad">
    <header className="english-heading"><div><p className="section-kicker">一総通 · 専門英語</p><h1>場面から、英語を読む。</h1><p>一総通で繰り返し現れる無線・海事・航空・規定表現を、過去問から整理して学びます。</p></div><button id="english-back" className="btn btn-secondary" onClick={onBack}>一総通へ戻る</button></header>
    {notice && <p role="status" className="english-notice">{notice}</p>}
    {error && <p role="alert">{error} <button className="btn" onClick={() => { setError(''); loadEnglishMaster().then(setMaster).catch(e => setError(e.message)); }}>再読み込み</button></p>}
    {!master && !error && <p role="status">専門英語教材を読み込んでいます…</p>}
    {master && <>
      <div className="english-controls panel"><div className="english-tiers" role="group" aria-label="学習範囲">{TIERS.map(t => <button key={t} data-english-tier={t} aria-pressed={tier === t} className={`btn ${tier === t ? 'btn-primary' : 'btn-secondary'}`} onClick={() => select(t, group)}>{TIER_LABELS[t]} <span>{master.tier_counts[t]}項目</span></button>)}</div><label>場面で選ぶ<select id="english-group" value={group} onChange={e => select(tier, e.target.value)}><option value="all">すべての場面</option>{master.groups.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}</select></label><p id="english-summary">この範囲の確認済み {items.filter(i => progress.confirmed[i.learningEntityId]).length} / {items.length}項目</p><small>確認済みは自分で読んだ記録です。正答率・習熟度ではありません。記録はこのブラウザに保存します。</small></div>
      <p className="english-goal">{group === 'all' ? '通信する人、船の状態、規定の条件。同じ場面の表現をつなげて読みます。' : master.groups.find(g => g.id === group)?.goal}</p>
      <div className="english-workspace"><nav id="english-list" className="english-list panel" aria-label="教材項目">{items.map(i => <button key={i.learningEntityId} data-english-id={i.learningEntityId} aria-current={readingItem === i ? 'true' : undefined} onClick={() => select(tier, group, i.learningEntityId)}><span>{i.term}</span><small>{CATEGORY[i.category]}{progress.confirmed[i.learningEntityId] ? ' · 確認済み' : ''}</small></button>)}{!items.length && <p>この範囲にはまだ項目がありません。範囲を広げてみてください。</p>}</nav>
      {item && <article id="english-detail" className="english-detail panel" aria-labelledby="english-term">
        <p className="section-kicker">{CATEGORY[item.category]} · {MODALITY[item.modality.recommended]}</p><h2 id="english-term" lang="en">{item.term}</h2>
        {isPreview && <div id="english-related-preview" className="english-preview" role="status"><p>関連項目を参照中 · {TIER_LABELS[item.tier]}の項目{TIERS.indexOf(item.tier) > TIERS.indexOf(tier) ? '（現在の学習範囲外）' : ''}。学習範囲と読んでいた位置はそのままです。</p><button id="english-return-related" className="btn btn-secondary" onClick={() => setPreviewId('')}>元の項目へ戻る{readingItem ? ` · ${readingItem.term}` : ''}</button></div>}
        {item.category === 'CONTEXT' && <button id="english-reveal" className="btn btn-secondary" aria-expanded={showMeaning} onClick={() => setShowMeaning(!showMeaning)}>{showMeaning ? '意味を隠して考える' : '意味を確認する'}</button>}
        {showMeaning ? <><dl className="english-meanings">{item.general_meaning && <><dt>一般的な意味</dt><dd>{item.general_meaning}</dd></>}<dt>この試験で学ぶ意味</dt><dd className="english-specialized">{item.specialized_meaning}</dd>{item.misleading_meanings && <><dt>読み違えやすいところ</dt><dd>{item.misleading_meanings}</dd></>}</dl><p>{item.japanese_explanation}</p><p className="english-why">{item.why_it_matters}</p></> : <p>誰が、何を、どうしている場面かを考えてから意味を開いてみてください。</p>}
        <EnglishIllustration learningEntityId={item.learningEntityId} meaningRevealed={showMeaning} />
        <div className="english-example"><p className="section-kicker">短い自作例</p><p lang="en">{item.example.english}</p><p>{item.example.japanese}</p>
        {!!item.legal_structure.length && <div id="english-legal" className="english-legal">{item.legal_structure.map((s, n) => <div key={n}><small>{s.label}</small><span lang="en">{s.text}</span></div>)}</div>}
        <small>教材用の自作例です。過去問の転載・実際の運用指示ではありません。</small></div>
        {!!item.supplements.length && <div className="english-supplements">{item.supplements.map(s => <p key={s.term_id}><strong lang="en">{s.term}</strong> — {s.meaning}</p>)}</div>}
        <div className="english-related">{!!item.related_terms.length && <span>一緒に読む</span>}{item.related_terms.map(id => { const related = master.items.find(i => i.learningEntityId === id); return related && <button className="btn btn-secondary" key={id} onClick={() => setPreviewId(id)}>{related.term}{TIERS.indexOf(related.tier) > TIERS.indexOf(tier) && <small> · {TIER_LABELS[related.tier]}の項目（範囲外）</small>}</button>; })}</div>
        <div className="english-actions"><button id="english-prev" className="btn btn-secondary" disabled={isPreview || index <= 0} onClick={() => select(tier, group, items[index - 1].learningEntityId)}>前へ</button><button id="english-confirm" className={`btn ${progress.confirmed[item.learningEntityId] ? 'btn-secondary' : 'btn-primary'}`} aria-pressed={!!progress.confirmed[item.learningEntityId]} onClick={() => update(toggleConfirmed(isPreview ? progress : { ...progress, last: { tier, group, item: item.learningEntityId } }, item.learningEntityId))}>{progress.confirmed[item.learningEntityId] ? '確認済み · 取り消す' : '確認済みにする'}</button><button id="english-next" className="btn btn-secondary" disabled={isPreview || index >= items.length - 1} onClick={() => select(tier, group, items[index + 1].learningEntityId)}>次へ</button></div>
        <details className="english-evidence"><summary>過去問の根拠と採用・監査の記録</summary>{item.audit_metadata && <><p>採用時の判断：{item.audit_metadata.original_inclusion_rationale}</p><p>意味の範囲・監査メモ：{item.audit_metadata.original_scope_or_confusion}</p>{item.audit_metadata.supplement_modality_note && <p>{item.audit_metadata.supplement_modality_note}</p>}</>}<p>文意への影響 {item.meaning_impact}：{master.impact_scale[item.meaning_impact]}（分析者の判断・効果未測定）</p><p>E0表記パターン検出：{item.e0_frequency_facts.occurrence_count}回。{master.frequency_definition}</p><p>本文検出の年度：{item.e0_frequency_facts.stem_years.join('、') || 'なし（選択肢根拠）'}。専門義だけの年度数ではありません。</p><p>{master.modality_definition}</p><p>{item.modality.basis}</p>{item.evidence_role_note && <p>{item.evidence_role_note}</p>}<ul>{item.evidence_references.map(e => <li key={e.e0_occurrence_id}>{e.exam_date} · 問{e.question_number} {e.subquestion} · {e.role_in_E0 === 'choice' ? '選択肢' : e.role_in_E0 === 'annotation' ? 'E0注記区分（局所監査で本文・注記を分離）' : '本文'}<small>{e.source} · 開始ページ{e.page_start}</small></li>)}</ul><small>資料の種類を示す表示です。音声は確認していません。原本PDF・公式解答PDFは公開しません。</small></details>
      </article>}</div>
    </>}
  </section>;
}
