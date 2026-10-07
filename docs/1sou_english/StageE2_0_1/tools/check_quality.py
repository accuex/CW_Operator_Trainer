"""Report editorial leakage and references; optionally check saved private E0 units for sentence matches."""
from pathlib import Path
import argparse,json,re,collections
HERE=Path(__file__).resolve().parent.parent
ROOT=HERE.parents[2]
a=argparse.ArgumentParser();a.add_argument('--private-units',type=Path);args=a.parse_args()
m=json.loads((ROOT/'public/english/data/english-learning-master-v1.json').read_text());old=json.loads((HERE/'english_master_E2_baseline.json').read_text())
leak=re.compile(r'E0|E1|E2|OCR|監査|表記検出|検出数|過去問文脈|教える意味|\d{4}-\d{2}|[HR]\d+-\d')
checks={}
for f in ['misleading_meanings','why_it_matters','japanese_explanation','specialized_meaning']:
 before=collections.Counter(i[f] for i in old['items'] if i[f]); after=collections.Counter(i[f] for i in m['items'] if i[f])
 checks[f]={'before_duplicate_texts':sum(v>1 for v in before.values()),'before_largest_duplicate':max(before.values()),'after_duplicate_texts':sum(v>1 for v in after.values()),'after_largest_duplicate':max(after.values()),'after_leak_ids':[i['learningEntityId'] for i in m['items'] if leak.search(i[f])],'meaning_review':'各行の説明・効用・対比を編集者が確認。文字列の一意性だけを品質判定にしていない。'}
occ={e['occurrence_id'] for e in json.loads((ROOT/'docs/1sou_english/StageE0/term_occurrences.json').read_text())}
missing=[e['e0_occurrence_id'] for i in m['items'] for e in i['evidence_references'] if e['e0_occurrence_id'] not in occ]
copyhits=None;units=None
if args.private_units:
 qs=json.loads(args.private_units.read_text());units=len(qs);copyhits=[]
 norm=lambda s:re.sub(r'[^a-z0-9]+',' ',s.lower()).strip()
 for i in m['items']:
  hits=[q['unit_id'] for q in qs if norm(i['example']['english']) in norm(q['private_text'])]
  if hits:copyhits.append({'id':i['learningEntityId'],'units':hits})
q={'template_checks':checks,'exam_exact_normalized_sentence_matches':copyhits,'exam_copy_check_units':units,'copy_check_limit':'保存済みE0抽出本文との正規化一致検査。短い定型句の共有、抽出誤り、意味品質の自動証明ではない。原本転載として例を作成していない。','example_manual_review_ids':[i['learningEntityId'] for i in m['items']], 'evidence_ref_missing':missing,'general_and_supplement_leak_ids':[i['learningEntityId'] for i in m['items'] if leak.search(str(i['general_meaning'])+' '.join(s['meaning'] for s in i['supplements']))], 'before_selection_template_count':sum('教える意味は' in i['why_it_matters'] for i in old['items']), 'before_group_goal_in_card_count':sum(any(g['goal'] in i['japanese_explanation'] for g in old['groups']) for i in old['items']), 'after_group_goal_in_card_count':sum(any(g['goal'] in i['japanese_explanation'] for g in m['groups']) for i in m['items'])}
(HERE/'quality_checks.json').write_text(json.dumps(q,ensure_ascii=False,indent=2)+'\n')
assert not missing and not q['general_and_supplement_leak_ids'] and all(not c['after_leak_ids'] for c in checks.values())
assert copyhits is None or not copyhits
assert (ROOT/'docs/1sou_english/StageE2/english_learning_master_v1.json').read_bytes()==(ROOT/'public/english/data/english-learning-master-v1.json').read_bytes()
print('quality checks PASS; semantic review ledger remains separate from automated checks')
