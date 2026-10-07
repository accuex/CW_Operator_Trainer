"""Apply a reproducible editorial overlay to the frozen E2-v1 master. No corpus rebuilding."""
from pathlib import Path
import json,csv,collections,hashlib,copy
HERE=Path(__file__).resolve().parent.parent
ROOT=HERE.parents[2]
baseline=json.loads((HERE/'english_master_E2_baseline.json').read_text())
m=copy.deepcopy(baseline)
rows={r['term'].strip().lower():r for r in csv.DictReader((HERE/'tools/editorial.tsv').open(),delimiter='\t')}
examples={r['term']:r for r in csv.DictReader((HERE/'tools/examples.tsv').open(),delimiter='\t')}
retained={r['term']:r['review_reason'] for r in csv.DictReader((HERE/'tools/retained_examples_review.tsv').open(),delimiter='	')}
assert len(examples)==42 and len(retained)==59 and not examples.keys() & retained.keys()
ids={i['term'].lower():i['learningEntityId'] for i in m['items']}
assert len(rows)==len(ids)==101 and rows.keys()==ids.keys()
meanings={
 'administration':'主管庁', 'master':'船長（harbour masterは港の管理者）',
 'urgency':'緊急通信', 'medical advice':'医療上の助言', 'on scene':'現場にいる／現場で',
 'gmdss':'海上における遭難及び安全に関する世界的な制度（GMDSS）',
 'epirb':'非常用位置指示無線標識（EPIRB）',
 'watch':'無線聴守／当直', 'guard':'周波数を聴守する', 'traffic':'無線通信のやり取り／船舶交通',
 'frequency':'無線周波数', 'clear':'周波数を空けておく／場所が空いている',
 'pilot':'水先人（海事）／操縦士（航空）', 'make fast':'係留索を固定する',
 'single up':'出港前に係留索を最小限だけ残す状態にする', 'lines':'係留索',
 'hampered':'操船に制約がある', 'dragging':'走錨している',
 'heading':'船・航空機の向首方向', 'course':'船舶・航空機の針路',
 'cable':'海事の距離単位ケーブル', 'knots':'船速の単位ノット',
 'make a lee':'風よけを作る', 'heave to':'船を減速・停船に近い状態に保つ',
 'keep clear':'対象から離れている（keep clear of）',
 'regularity of flight':'飛行の正常な運航', 'standardized phraseology':'標準通信表現',
 'plain language':'普通の言葉による表現', 'provided':'〜という条件で（provided that）',
 'bulbous bow':'球状船首',
}
# No forced contrasts: these have enough explanation without a separate warning.
no_confusion={'ship station','coast earth station','rescue coordination center','urgency','medical advice','maritime safety information','survival craft','on scene','gmdss','navtex','epirb','digital selective calling','narrow band direct printing','overboard','flooded','seelonce feenee','relay','acknowledge','estimated time of arrival','radio quarantine','poor visibility','unseaworthy','make a lee','heave to','automatic identification system','public correspondence','air traffic services','standardized phraseology','receiver failure','transmitting blind','in accordance with','prior to','on the authority of','without delay','bulkhead','bulbous bow'}
notes={
'gmdss':{'source':'1soutuu-2016(H28)-03-houki.pdf','page':7,'question':'A19','conclusion':'保存済み法規原本の制度名称を採用。「世界海洋遭難安全システム」という候補の正式性は、この局所確認では確定せず置換しない。英語の出現根拠やmodalityは変更しない。'},
'epirb':{'source':'1soutuu-2024(R06)-03-houki.pdf','page':7,'question':'A16','conclusion':'原本の「衛星非常用位置指示無線標識」を確認。教材の核を「非常用位置指示無線標識」とし、機能説明を別に記す。'},
'single up':{'source':'1soutuu-2023(R05)-09-eikaiwa.pdf','page':1,'question':'5','conclusion':'係留中から出港への文脈を確認。残す索の本数・配置は原本で指定されていないため教材で固定しない。最小限を残す説明は旧自作例の意味境界を明確化。'},
'plain language':{'source':'1soutuu-2017(H29)-09-eigo.pdf','page':2,'question':'A9','conclusion':'standardized phraseologyで意図を伝えられない場合の対比。「平文」は暗号との誤解を招くため採用しない。'},
'give way':{'source':'1soutuu-2019(R01)-09-eikaiwa.pdf','page':1,'question':'5','conclusion':'原本は操船能力の違いを述べる。旧自作例の大小による一般義務は不適切。主体の意思を示す例へ変更。'},
'keep clear':{'source':'1soutuu-2012(H24)-09-eikaiwa.pdf','page':2,'question':'7','conclusion':'keep clear of the fairwayの対象から離れる意味を確認。clear the fairwayとの構造を分ける。'},
'on scene':{'source':'1soutuu-2004(H16)-09-eigo.pdf','page':2,'question':'A8','conclusion':'on-scene communicationsという修飾形を確認。現場にいる自作例も保持。'},
}
changes=[]
for i,old in zip(m['items'],baseline['items']):
 t=i['term'].lower(); r=rows[t]
 i['audit_metadata']={
 'editorial_stage':'E2.0.1',
 'original_inclusion_rationale':old['why_it_matters'],
 'original_scope_or_confusion':old['misleading_meanings'],
 'original_scene_explanation':old['japanese_explanation'],
 'original_specialized_meaning':old['specialized_meaning'],
 'local_wording_check':notes.get(t),
 'related_selection':'meaning contrast or functional relationship; see individual review ledger',
 }
 i['japanese_explanation']=r['explanation'];i['why_it_matters']=r['why']
 i['misleading_meanings']='' if t in no_confusion else r['confusion']
 i['related_terms']=[ids[x.strip()] for x in r['related'].split(',') if x.strip()]
 i['specialized_meaning']=meanings.get(t,i['specialized_meaning'])
 if t in examples:
  i['example']['english']=examples[t]['english'];i['example']['japanese']=examples[t]['japanese']
 for s in i['supplements']:
  s['audit_original_meaning']=s['meaning']
  s['meaning']={'term-bound':'is bound toは義務を表すことがあります。行き先を示すbound forとは別です。shallと常に置き換えられるわけではありません。','term-life-raft':'救命いかだ。survival craftに含まれる救命用船艇の一種です。','term-flight-regularity':'飛行の正常な運航。regularity of flightと同じ概念を表す語順です。'}[s['term_id']]
 if i.get('supplement_modality_note'):
  i['audit_metadata']['supplement_modality_note']=i.pop('supplement_modality_note')
 changed=[k for k in ['specialized_meaning','misleading_meanings','example','japanese_explanation','why_it_matters','related_terms'] if i[k]!=old[k]]
 changes.append({'learningEntityId':i['learningEntityId'],'term':i['term'],'changed_fields':changed,'confusion_removed':bool(old['misleading_meanings']) and not i['misleading_meanings'],'related_targets':[x.strip() for x in r['related'].split(',')],'relationship_reason':r['explanation'], 'example_review': examples[t]['review_reason'] if t in examples else retained[t],'semantic_review':{'specialized_meaning':i['specialized_meaning'],'why':r['why'],'explanation':r['explanation']},'independent_human_review_recommended':True,'review_status':'analyst_review_completed_not_automated_semantic_proof'})
# Test snapshot hashes protect *all* non-editorial facts, not selected counts only.
def protected(x):
 return {k:v for k,v in x.items() if k not in ['specialized_meaning','misleading_meanings','example','japanese_explanation','why_it_matters','related_terms','audit_metadata','supplement_modality_note','supplements'] } | {'example_metadata':{k:v for k,v in x['example'].items() if k not in ['english','japanese']}, 'supplements':[{k:v for k,v in s.items() if k not in ['meaning','audit_original_meaning']} for s in x['supplements']], 'supplement_modality_note':x.get('supplement_modality_note',x.get('audit_metadata',{}).get('supplement_modality_note'))}
for i,o in zip(m['items'],baseline['items']):assert protected(i)==protected(o),i['term']
# Keep root model / facts unchanged. Revision describes editorial overlay, not a new curriculum.
m['editorialRevision']='E2.0.1'
canonical=ROOT/'docs/1sou_english/StageE2/english_learning_master_v1.json'
public=ROOT/'public/english/data/english-learning-master-v1.json'
out=json.dumps(m,ensure_ascii=False,indent=2)+'\n'
canonical.write_text(out);public.write_text(out)
(HERE/'item_review_101.json').write_text(json.dumps(changes,ensure_ascii=False,indent=2)+'\n')
counts={k:sum(k in c['changed_fields'] for c in changes) for k in ['specialized_meaning','misleading_meanings','example','japanese_explanation','why_it_matters','related_terms']}
counts['confusion_removed']=sum(c['confusion_removed'] for c in changes)
incoming=collections.Counter(id for i in m['items'] for id in i['related_terms'])
oldincoming=collections.Counter(id for i in baseline['items'] for id in i['related_terms'])
summary={'counts':counts,'related_incoming_before':oldincoming.most_common(),'related_incoming_after':incoming.most_common(),'local_wording_checks':notes,'canonical_public_equal':canonical.read_bytes()==public.read_bytes()}
(HERE/'validation.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
# JS stable key sorting hash for baseline invariants tests.
def stable(x):return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'))
fixture={'root':{k:v for k,v in baseline.items() if k!='items'}, 'items':{i['learningEntityId']:hashlib.sha256(stable(protected(i)).encode()).hexdigest() for i in baseline['items']}}
(ROOT/'lib/english/e2-protected-facts.json').write_text(json.dumps(fixture,ensure_ascii=False,indent=2)+'\n')
print(counts)
