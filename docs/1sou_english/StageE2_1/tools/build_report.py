from pathlib import Path
from collections import Counter
import json
root=Path(__file__).resolve().parents[4];p=root/'docs/1sou_english/StageE2_1'
if (p/'human_visual_review.json').exists():
 raise SystemExit('Human review is finalized. Preserve the report history and append final verification instead of rebuilding the pending-stage draft.')
s=json.loads((p/'english_illustration_selection.json').read_text());manifest=json.loads((p/'illustration_manifest.json').read_text());qa=json.loads((p/'image_semantic_review.json').read_text());records=json.loads((p/'generation_records.json').read_text());counts=Counter(i['decision'] for i in s)
escape=lambda t:t.replace('|','／').replace('\n',' ')
a='\n'.join('| '+ ' | '.join(escape(str(x)) for x in [i['term'],i['learningEntityId'],i['candidateAssetId'],i['learningPoint'],i['risk']])+' |' for i in s if i['decision']=='A')
assets='\n'.join('| '+ ' | '.join(escape(str(x)) for x in [id,' / '.join(i['term'] for i in s if i['candidateAssetId']==id),a['variants'][0]['src'],a['variants'][1]['src'],str(a['variants'][0]['bytes'])+' / '+str(a['variants'][1]['bytes'])])+' |' for id,a in manifest['assets'].items())
semantic='\n'.join('- **'+i['assetId']+'**：'+i['aiReviewNotes'] for i in qa)
report=f'''# Stage E2.1 教材イラスト統合レポート

2026-10-07。productionへの仮統合・QAまで完了。**全16候補は human visual review pending**。最終採用の承認はしていない。commitなし、次Stageへ進まない。

## 1. 選定結果

101項目をE2.0.1後のlearner-facing本文から個別判定し、画像生成前にselection manifestを保存した。採用数の目標は設定していない。

| 判定 | 件数 | 扱い |
| --- | ---: | --- |
| A | {counts['A']} | 専門義・位置・状態の理解を補う候補を生成 |
| B | {counts['B']} | 描けるが、意味の増分が薄い・誤具体化しやすいため画像なし |
| C | {counts['C']} | 抽象・論理・意味境界を保ちにくいため画像なし |

画像なしは83項目。空欄・placeholder・「画像なし」の表示は設けない。全101件の個別理由・learningPoint・riskは `english_illustration_selection.json` に保存。

## 2. A判定全項目・学習ポイント・リスク

| term | stable ID | asset ID | learningPoint | risk |
| --- | --- | --- | --- | --- |
{a}

## 3. B/Cの主な理由

- **guard / watch**：無線機の前にいる人では聴守の意味が増えず、guardを警備員・Coast Guardへ引っ張る危険がある。B。
- **pilot / master**：制服・肖像で職務を判定させない。B。
- **port / starboard**：観察者の左右を船の左右と誤認しやすく、portの二義も一枚では扱いにくい。B。
- **single up / make fast**：索の本数・配置・結び方を普遍的正解として描かない。B。
- **give way**：船の大小・船型から優先規則を捏造しない。C。
- **heading / course / bearing**：同じ「船＋矢印」で意味を潰さず、今回の無文字の単一場面では境界が保ちにくいためC。
- **poor visibility / restricted visibility**：dense fogを共有して、原因と状態の意味を同一にしない。B。
- **GMDSS**：制度を一台の機器へ固定しない。C。**EPIRB / NAVTEX**は未確認の装置外観を教材として固定しない。B。
- **regularity of flight / transmitting blind / public correspondence / traffic**：航空機・船の汎用画像では意味や適用範囲が伝わらない。C。
- **LEGAL全項目**：条件・例外・義務・禁止・許可は本文と構造化自作例を維持。天秤・法律書等の装飾を追加しない。C。

## 4. 生成・再生成・降格・共有

組み込みの `image_gen.imagegen` を使用。初回16枚＋再生成2枚＝**18生成結果**。production採用候補は16枚、対応18項目。A→B降格は0。

再生成は以下の2件。元画像はproductionに残していない。

1. **shore-ship-radio**：初回が写実的・細密すぎたため、提示された比較画像をスタイル参考にしてA-2方向へ簡略化。海岸側と船側の局という意味を維持。
2. **ship-bridge**：初回の人物が中央で目立ったため、人物を除き、前方窓・舵輪・前甲板で船橋という「場所」が主役になるよう修正。productionは `ship-bridge-v2-*`。

共有は **coast station / ship station**、**aircraft station / aeronautical station** の2組のみ。通信の両側の局の設置場所という同じ関係を、相手側からも読めるため。sceneが同じだけの使い回しはしていない。

`generation_prompts.json` は意味・リスクを入力した最初のprompt setと生成状態、`generation_records.json` は実行prompt、修正prompt、元画像・候補画像の保存パス、試行の採否、参考画像を保持する。原本PDF本文の長文転載や画像化はしていない。

## 5. AIによるsemantic / visual QA

各生成結果を一枚ずつ確認し、以下を候補採用の範囲で確認した。これは人間による最終承認ではない。

{semantic}

全候補に学習用文字・ロゴ・透かしの混入なし。重要部分を切り取らず3:2全体を表示。約300pxのレビュー用サムネイルでも、陸／船／航空機／水／機関室／船底／船首／前方窓等の中心概念が読めることをAI確認した。

船体・機械・計器・索・アンテナの細部は仕様図ではなく例示。現実の設備・操作方法の正確さを保証する教材へ拡張していない。特に機関室・係留・推進器と静止画での揺れ表現は、人間の目視確認でも意味を狭めたり誤った規則を暗示しないか確認が必要。

## 6. Production統合

教材マスターは編集せず、独立したmanifestで `learningEntityId → assetId → variants / alt / caption / status` を管理した。termごとのUI hardcodeなし。

- `lib/english/illustration-manifest.json`：16asset・18itemのmapping、source master hash、AI確認、人間確認待ち状態、寸法・bytes。
- `lib/english/illustrations.ts`：意味非表示・mappingなし・不許可statusでは画像情報を返さない。
- `app/components/EnglishIllustration.tsx`：画像とHTMLキャプション。lazy、async decode、responsive srcset、明示寸法。
- `app/views/EnglishView.tsx`：説明とwhyの後、自作例の前へcomponent呼出しを1箇所追加。
- `app/styles/views/english.css`：figure・image・captionの最小styling。
- `public/english/illustrations/`：32WebP variantsと `review.html`。原本PDF・公式解答は配置していない。
- `lib/english/illustrations.test.ts`：全文master保護、hide時の画像／alt／caption非表示、画像なしカード、mapping／asset整合性。

CONTEXTで意味を隠すとfigure自体をrenderしない。altやcaptionもDOMに残らない。既存の初期意味表示・切替・progress semanticsは変更していない。

### 最終asset mapping

| asset ID | 対応項目 | 480px | 960px | bytes 480 / 960 |
| --- | --- | --- | --- | ---: |
{assets}

## 7. Desktop / mobile QA

5187で実施。5179には触れていない。PC **1440×1000**、mobile **375×812**。

| 確認 | 結果・根拠 |
| --- | --- |
| 画像あり18項目 | 両幅で1figure／正常decode／3:2／横overflowなし。CORE・CONTEXT・SCENE・EXTRAを含む |
| 画像なし | guard、distress、poor visibility、bulkhead、shallを両幅で確認。figure0、空枠なし |
| CONTEXT hide / reveal | bridgeと範囲外related previewで、hidden時figure0。render testでも全18mappingのalt／captionを含め空文字 |
| tier / scene | 最小・しっかり、actors・operations・all切替。32／74／101と8場面はmaster全文hashでも固定 |
| tier外related | 最小のmasterからしっかりのbridgeへ参照。範囲外表示・戻る・元の範囲と位置維持を両幅で確認 |
| prev / next | bridge→前の画像なしAIS→bridgeと往復し、画像が残留しないことを両幅で確認 |
| confirmed / reload | bridge確認済みtrueをreload後に復元。PC・mobileで確認後、QAで追加した確認記録を取り消した |
| evidence fold | 両幅で開閉。監査・原本参照情報は既存のまま |
| card height / crop / overflow | PC画像600×400、mobile309×206。本文が押し潰されず、object-fit:containで全図表示、横overflowなし |
| navigation | 一総通メニュー→専門英語→戻る、地理、ホーム、CWおぼえるのUI smoke確認 |
| 地理 | 既存地図と32／81／128／160、8エリアのUIを確認。地理のcode/dataは変更なし |
| review sheet | 16実候補のみ、PC／375pxでoverflowなし。クリックで960px画像、注意点の開閉、全pending |
| browser console | 最終確認時のerrorログなし |

詳細は `qa/browser_checks.json`（69観測）、`qa/*-final.jpg`、`qa/review-top.jpg` に保存。途中reload直後の未読込観測は、その後の教材表示・保存復元で確認し直している。viewportがレビューtabに適用された観測はmobile追加確認として区別し、最後に本番tabで1440px／600×400の修正版を再確認した。終了時は初期の最小／operations／guardへ戻し、viewport overrideを解除。

## 8. Performance

- 480×320／960×640 WebP。全32variantの合計 **{sum(v['bytes'] for a in manifest['assets'].values() for v in a['variants']):,} bytes**、最大1asset **{max(v['bytes'] for a in manifest['assets'].values() for v in a['variants']):,} bytes**。生成元1536px PNGはproduction配信しない。
- PCで960px、375pxで480pxのcurrentSrcを実確認。DPRに応じてブラウザが適切なvariantを選べる。
- 一覧へ全画像をmountせず、今開いている項目にのみ最大1img。画像なし・意味非表示では0img。`loading=lazy`、`decoding=async`。preloadなし。
- width／heightと3:2 aspect-ratioで読込前の表示領域を確保。非表示からrevealする際に領域が増えるのは操作に伴う意図した変化。
- 冷cache・低速回線・高DPR実機でのLCP／CLSスコア計測は未実施。数値的な「CLS=0」や初期ロード時間の改善は主張しない。

## 9. Build / tests / 既存FAIL

| 確認 | 結果 |
| --- | --- |
| production build | **PASS**。修正版asset／manifest後に再実施。`qa/build.log` |
| 英語＋routing関連 | **15 / 15 PASS**。英語5、editorial4、illustrations4、appPaths2。`qa/relevant-final.log` |
| 全既存test | **683 PASS / 1 FAIL（684）**。`qa/all-tests.log`。画像修正後は影響のある関連15を再確認 |
| typecheck | 既存2error。今回追加の型errorなし。`qa/types.log` |

既存FAILは変更前HEAD **de9df04** とE2.0.1で保存したHEAD検証ログを比較した。同じHEADを維持し、対象のPileup／Landing／cloudSyncファイルに差分がない。

- `lib/radio/sim/pileupGolden.test.ts` intro-average#1 digest：期待 `ae4b01cfea1e0d14ae002e96590c3dc264492c58fe281d0f5ef0d27aa5ba3cee`、実値 `25467add797c9d7b0647e69131c9fad56acb354d8a49a66c121a57e84331bc2a`。HEAD再現ログ `../StageE2_0_1/qa/head-pileup.log` と一致。
- `app/landing/LandingRigDemo.tsx:63` number／Timeout、および `lib/api/cloudSync.ts:154` TrainerProfile型変換。`../StageE2_0_1/qa/head-types.log` と一致。

今回の画像追加由来のFAILとして扱わず、無関係な修正を加えていない。音響の品質は今回のUI smokeや自動testで保証せず、必要な場合はhuman auditory QA対象。

## 10. 保護したデータと作業範囲

E2.1開始時のE2.0.1 public masterを `english_master_E2_0_1_baseline.json` に保存。現在masterと**byte単位で一致**。SHA-256：`0742bb407f6b3f6ef353b3a675bb54faaf60c92a45171f94cb545b4e090af403`。

adopted101、excluded42、integrated3、hold0、32／74／101、8scenes、全文教材・specialistMeaning・confusion・why・examples・related・frequency・evidence・modality・official metadataを維持。progress、routing、shell、地理、Dashboard、QSO、Tutorial、CQ、Contest、Pileup、Wabun、DECODEには実装変更なし。

作業開始時にはE2.0.1の未commit差分（EnglishView／CSS／data.ts／public master／editorial test／fixture）が存在した。それを保持したうえで本Stageの画像component・manifest・asset・testsを追加した。HEADとの差分があるpublic masterは前Stageの編集であり、本Stageの再編集ではない。

資料調査・新項目・新クイズ・SRS・音声・予測・他資格拡張なし。docsは既存ignore方針のままローカル保存。commit／pushなし。

## 11. 人間の目視確認待ち一覧・停止

**以下の16asset全部がpending**。上のmapping表に示した18項目へ仮表示している。

{chr(10).join('- `'+id+'` — human visual review pending' for id in manifest['assets'])}

確認画面：`http://localhost:5187/english/illustrations/review.html`。実生成の採用候補だけを表示し、学習ポイント・注意点・AI確認メモを開いて読める。元PDF・公式解答は公開しない。ローカルの `image_review.html` からも5187の同じassetsを参照できる。

人間確認では意味の一致、小さい表示の読みやすさ、細部の誤具体化、A-2からのスタイル逸脱を確認してほしい。特にair draughtの高さの端点、agroundと船底下の隙間の違い、rolling／pitchingの方向、floodedの機械描写、係留の索・装置細部を確認する。承認・差戻しの記録を受けるまで最終確定にしない。本Stageはここで停止。
'''
(p/'StageE2_1_教材イラスト統合レポート.md').write_text(report)
print('report saved',len(report),'characters')
