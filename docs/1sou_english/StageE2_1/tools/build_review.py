from pathlib import Path
import json,html
root=Path(__file__).resolve().parents[4];stage=root/'docs/1sou_english/StageE2_1'
selection=json.loads((stage/'english_illustration_selection.json').read_text());manifest=json.loads((stage/'illustration_manifest.json').read_text())
notes={
'shore-ship-radio':'岸側の建物・垂直アンテナと船側の位置が別。双方向の通信を示す。最初の候補は写実的すぎたため再生成。アンテナ型式は例示であり必須設備を示さない。',
'air-ground-radio':'飛行中の航空機と地上局の位置が別。地上局を管制塔の外観に固定していない。機体の細部は教材の判定対象ではない。',
'person-overboard':'船外の水中に人の頭と肩が見える。転覆や救助手順を付加していない。人物の装具を必須の救命装備として教えない。',
'ship-aground':'船底が浅瀬の底に接している。投錨待機の絵ではなく、under keel clearanceの隙間と区別できる。',
'boat-capsized':'船底が上になった転覆状態。単なる横揺れとは区別できる。事故原因や全船型の復原性を教えるものではない。',
'flooded-engine-room':'船内の固定機械の下部が水に浸っている。外の波だけになっていない。機械・配管の構造の正確さは保証せず、浸水という一点のみを示す。',
'ship-at-berth':'岸壁と船の横付け位置・防舷材が見える。索の本数・結び方・配置を運用の正解として扱わない。',
'ship-at-anchorage':'岸壁から離れた水域に船が待機し、船首の錨鎖が水中へ続く。錨の構造・投錨手順は描いていない。',
'under-keel-gap':'船底の最下部と海底の間に青い水の隙間が残る。水深全体ではなく船底下の空間を示す。工学的な縮尺や寸法値ではない。',
'ship-height-below-bridge':'高さの目印は水面から船の最上部で止まり、橋の下端まで伸びない。橋下の空き高さそのものと区別できる。',
'fog-at-harbour':'近い船首は明瞭、遠い防波堤・灯台は霧に薄れる。煙や単に曇った空の絵ではない。',
'rope-fouled-propeller':'水中の船尾で索が推進器の軸に巻き付き羽根にも掛かる。汚れ・腐食の一般義へ引っ張られていない。羽根形状は機種の仕様図ではない。',
'ship-rolling':'船首側から見て船幅方向に傾き、左右の往復を示す矢印がある。転覆ではない。静止画だけでは動きを示せないため控えめな無文字の矢印を使用。',
'ship-pitching':'側面から船首と船尾の上下差が見え、船首側の上下矢印で往復を補う。横揺れの絵と視点・方向が異なり、船全体が浮いていない。',
'ship-bridge':'人物を除く修正後、前方窓・前甲板・舵輪がある船内の場所が主役。道路橋・航空機の操縦室ではない。計器配置や舵輪の形は必須条件を示さない。',
'bulbous-bow':'船首の水線下に丸い突出部がある。船尾や推進器ではない。全船の標準装備や抵抗低減の物理説明を付加していない。'}
qa=[];cards=[];escape=lambda s:html.escape(s,quote=True)
for aid,asset in manifest['assets'].items():
 rows=[s for s in selection if s['candidateAssetId']==aid];terms=' / '.join(s['term'] for s in rows)
 qa.append({'assetId':aid,'learningEntityIds':[s['learningEntityId'] for s in rows],'aiSemanticReview':'passed','aiReviewNotes':notes[aid],'humanVisualReview':'approved','humanReviewReference':'human_visual_review.json','cardSizeReview':'AI card-size QA completed; human review approved'})
 li=''.join('<li><strong>'+escape(s['term'])+'</strong> — '+escape(s['learnerSource']['specialized_meaning'])+'<br>学習ポイント：'+escape(s['learningPoint'])+'<br>注意：'+escape(s['risk'])+'</li>' for s in rows)
 cards.append(f'<article id="{aid}"><h2 lang="en">{escape(terms)}</h2><p class="pending">人間レビュー済み · 採用</p><a href="{asset["variants"][1]["src"]}" target="_blank" rel="noreferrer"><img src="{asset["variants"][0]["src"]}" srcset="{asset["variants"][0]["src"]} 480w, {asset["variants"][1]["src"]} 960w" sizes="(max-width: 600px) calc(100vw - 56px), 420px" width="480" height="320" loading="lazy" alt="{escape(rows[0]["learningPoint"])}"></a><details><summary>学習ポイント・注意点を確認</summary><ul>{li}</ul><p class="review-note">AI確認：{escape(notes[aid])}</p><small>asset: {aid}<br>'+escape(' / '.join(s['learningEntityId'] for s in rows))+'</small></details></article>')
text='''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>一総通専門英語 · イラスト確認</title><style>body{margin:0;background:#0d1425;color:#e6ecf5;font:16px/1.75 system-ui,sans-serif}main{max-width:1400px;margin:auto;padding:24px}a{color:#f5c75c}h1{font-size:clamp(24px,3vw,36px)}h2{font-size:22px;margin:0}header{margin-bottom:28px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));gap:20px}article{background:#172137;border:1px solid #34425b;padding:16px;border-radius:14px;min-width:0;overflow-wrap:anywhere}summary{cursor:pointer;margin-top:16px;min-height:44px;line-height:1.7}img{display:block;width:100%;height:auto;aspect-ratio:3/2;object-fit:contain;border-radius:9px}.pending{color:#f5c75c;font-size:14px}ul{padding-left:20px}li{margin-bottom:14px}.review-note,small{color:#b7c5d9}.review-note{border-top:1px solid #34425b;padding-top:12px}a:focus-visible{outline:2px solid #f5c75c;outline-offset:4px}</style><main><header><a href="/app/english">← 専門英語へ</a><h1>教材イラストの確認</h1><p>16枚・18項目の採用画像です。2026-10-07にプロジェクトオーナーが全画像を確認し、採用を承認しました。</p><p>専門義が伝わるか、誤った規則を暗示しないか、小さな表示で読めるか、A-2の簡略化された場面イラストとして揃っているかを確認してください。画像を選ぶと960px版を開けます。</p><p>船・機械・計器・索の配置は専門義を補う一例です。設備仕様や実際の運用手順の教材ではありません。画像なし83項目には表示枠を設けません。</p></header><div class="grid">'''+''.join(cards)+'</div></main></html>'
(root/'public/english/illustrations/review.html').write_text(text)
(stage/'image_semantic_review.json').write_text(json.dumps(qa,ensure_ascii=False,indent=2)+'\n')
(stage/'image_review.html').write_text(text.replace('src="/english/', 'src="http://localhost:5187/english/').replace('srcset="/english/', 'srcset="http://localhost:5187/english/').replace(', /english/', ', http://localhost:5187/english/').replace('href="/english/', 'href="http://localhost:5187/english/').replace('href="/app/', 'href="http://localhost:5187/app/'))
print('review sheet',len(cards))
