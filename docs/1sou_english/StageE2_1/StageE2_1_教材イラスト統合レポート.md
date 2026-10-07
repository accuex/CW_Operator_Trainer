# Stage E2.1 教材イラスト統合レポート

2026-10-07。production統合・QA完了。**2026-10-07にプロジェクトオーナーが16枚すべてを人間レビューし、現状の画像を採用承認。** 画像の追加生成・再生成・変更なし。以下の候補選定とAI確認は承認前の作業記録。最終承認・commit前確認は末尾に記録する。

## 1. 選定結果

101項目をE2.0.1後のlearner-facing本文から個別判定し、画像生成前にselection manifestを保存した。採用数の目標は設定していない。

| 判定 | 件数 | 扱い |
| --- | ---: | --- |
| A | 18 | 専門義・位置・状態の理解を補う候補を生成 |
| B | 38 | 描けるが、意味の増分が薄い・誤具体化しやすいため画像なし |
| C | 45 | 抽象・論理・意味境界を保ちにくいため画像なし |

画像なしは83項目。空欄・placeholder・「画像なし」の表示は設けない。全101件の個別理由・learningPoint・riskは `english_illustration_selection.json` に保存。

## 2. A判定全項目・学習ポイント・リスク

| term | stable ID | asset ID | learningPoint | risk |
| --- | --- | --- | --- | --- |
| coast station | term-coast-station | shore-ship-radio | 海岸側の無線局と船側の無線局が通信する関係。 | 衛星地球局や港管理者の建物へ置換しない。アンテナの特定型式を必須としない。 |
| ship station | term-ship-station | shore-ship-radio | 船にある無線局が海岸側と通信する関係。 | 船長という人物と局を混同しない。船自体を局の唯一の外観と教えない。 |
| aircraft station | term-aircraft-station | air-ground-radio | 航空機上の局と地上の航空局が通信する関係。 | 地上局を管制塔だけに固定せず、衛星経由と誤認する要素を加えない。 |
| aeronautical station | term-aeronautical-station | air-ground-radio | 航空機と通信する地上側の無線局。 | 局と航空交通業務を同一の建物・役職に固定しない。 |
| overboard | term-overboard | person-overboard | 乗組員が船外の海中に転落した状況。 | 船の転覆と混同させない。非写実・非流血で、救助手順や装備選択を教えない。 |
| aground | term-aground | ship-aground | 船が浅瀬の底に接して座礁している状態。 | 投錨待機と混同せず、岩が甲板を貫くような不自然な構造を避ける。 |
| capsize | term-capsize | boat-capsized | 小型船が転覆した事故状態。 | 単なる横揺れとして描かず、転覆原因や全船型の法則を教えない。 |
| flooded | term-flooded | flooded-engine-room | 船の機関室が浸水している状態。 | 外の海面だけの画像にせず、浸水すべてが必ず沈没するという因果を加えない。 |
| berth | term-berth | ship-at-berth | 船が岸壁の係留位置に着いている場面。 | 索の本数や配置を係留の正解として教えない。 |
| anchorage | term-anchorage | ship-at-anchorage | 錨を下ろして待つ水域。 | 錨の構造を詳述せず、船が岸壁に係留されている絵にしない。 |
| under keel clearance | term-under-keel-clearance | under-keel-gap | 船底の下に残る水の隙間。 | 水深全体や水面上の高さと混同しない。数値・技術図面へ広げない。 |
| air draught | term-air-draught | ship-height-below-bridge | 船の水面上の高さと上方の橋梁の関係。 | 橋梁の空き高さそのものをair draughtとして描かない。bridgeカードの船橋と区別。 |
| dense fog | term-dense-fog | fog-at-harbour | 濃い霧が港の入口を覆う場面。 | 煙や単なる曇天にしない。視界不良の原因すべてが霧という表現にしない。 |
| fouled | term-fouled | rope-fouled-propeller | 船の推進器にロープが絡んでいる状態。 | propellerを船外の空中に置かない。装置の精密構造を必須として描かない。 |
| rolling | term-rolling | ship-rolling | 左右の横揺れ。 | 単なる恒常的な傾斜や転覆にせず、pitchingの方向を混ぜない。 |
| pitching | term-pitching | ship-pitching | 船首と船尾が上下する縦揺れ。 | 横揺れの図を使い回さず、船が水面から完全に浮く描写を避ける。 |
| bridge | term-bridge | ship-bridge | 操船・航行を管理する船橋。 | 道路橋に置換しない。細かい計器や機種を識別の条件にしない。 |
| bulbous bow | term-bulbous-bow | bulbous-bow | 船首の水面付近にある球状の突出部分。 | 船尾やプロペラにしない。全船に装備されるという一般化をしない。 |

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

- **shore-ship-radio**：岸側の建物・垂直アンテナと船側の位置が別。双方向の通信を示す。最初の候補は写実的すぎたため再生成。アンテナ型式は例示であり必須設備を示さない。
- **air-ground-radio**：飛行中の航空機と地上局の位置が別。地上局を管制塔の外観に固定していない。機体の細部は教材の判定対象ではない。
- **person-overboard**：船外の水中に人の頭と肩が見える。転覆や救助手順を付加していない。人物の装具を必須の救命装備として教えない。
- **ship-aground**：船底が浅瀬の底に接している。投錨待機の絵ではなく、under keel clearanceの隙間と区別できる。
- **boat-capsized**：船底が上になった転覆状態。単なる横揺れとは区別できる。事故原因や全船型の復原性を教えるものではない。
- **flooded-engine-room**：船内の固定機械の下部が水に浸っている。外の波だけになっていない。機械・配管の構造の正確さは保証せず、浸水という一点のみを示す。
- **ship-at-berth**：岸壁と船の横付け位置・防舷材が見える。索の本数・結び方・配置を運用の正解として扱わない。
- **ship-at-anchorage**：岸壁から離れた水域に船が待機し、船首の錨鎖が水中へ続く。錨の構造・投錨手順は描いていない。
- **under-keel-gap**：船底の最下部と海底の間に青い水の隙間が残る。水深全体ではなく船底下の空間を示す。工学的な縮尺や寸法値ではない。
- **ship-height-below-bridge**：高さの目印は水面から船の最上部で止まり、橋の下端まで伸びない。橋下の空き高さそのものと区別できる。
- **fog-at-harbour**：近い船首は明瞭、遠い防波堤・灯台は霧に薄れる。煙や単に曇った空の絵ではない。
- **rope-fouled-propeller**：水中の船尾で索が推進器の軸に巻き付き羽根にも掛かる。汚れ・腐食の一般義へ引っ張られていない。羽根形状は機種の仕様図ではない。
- **ship-rolling**：船首側から見て船幅方向に傾き、左右の往復を示す矢印がある。転覆ではない。静止画だけでは動きを示せないため控えめな無文字の矢印を使用。
- **ship-pitching**：側面から船首と船尾の上下差が見え、船首側の上下矢印で往復を補う。横揺れの絵と視点・方向が異なり、船全体が浮いていない。
- **ship-bridge**：人物を除く修正後、前方窓・前甲板・舵輪がある船内の場所が主役。道路橋・航空機の操縦室ではない。計器配置や舵輪の形は必須条件を示さない。
- **bulbous-bow**：船首の水線下に丸い突出部がある。船尾や推進器ではない。全船の標準装備や抵抗低減の物理説明を付加していない。

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
| shore-ship-radio | coast station / ship station | /english/illustrations/shore-ship-radio-480.webp | /english/illustrations/shore-ship-radio-960.webp | 22136 / 62012 |
| air-ground-radio | aircraft station / aeronautical station | /english/illustrations/air-ground-radio-480.webp | /english/illustrations/air-ground-radio-960.webp | 16906 / 48340 |
| person-overboard | overboard | /english/illustrations/person-overboard-480.webp | /english/illustrations/person-overboard-960.webp | 16054 / 46284 |
| ship-aground | aground | /english/illustrations/ship-aground-480.webp | /english/illustrations/ship-aground-960.webp | 17822 / 53482 |
| boat-capsized | capsize | /english/illustrations/boat-capsized-480.webp | /english/illustrations/boat-capsized-960.webp | 15156 / 43950 |
| flooded-engine-room | flooded | /english/illustrations/flooded-engine-room-480.webp | /english/illustrations/flooded-engine-room-960.webp | 29040 / 78584 |
| ship-at-berth | berth | /english/illustrations/ship-at-berth-480.webp | /english/illustrations/ship-at-berth-960.webp | 21978 / 61258 |
| ship-at-anchorage | anchorage | /english/illustrations/ship-at-anchorage-480.webp | /english/illustrations/ship-at-anchorage-960.webp | 15894 / 45464 |
| under-keel-gap | under keel clearance | /english/illustrations/under-keel-gap-480.webp | /english/illustrations/under-keel-gap-960.webp | 16272 / 49384 |
| ship-height-below-bridge | air draught | /english/illustrations/ship-height-below-bridge-480.webp | /english/illustrations/ship-height-below-bridge-960.webp | 15966 / 44812 |
| fog-at-harbour | dense fog | /english/illustrations/fog-at-harbour-480.webp | /english/illustrations/fog-at-harbour-960.webp | 7446 / 19864 |
| rope-fouled-propeller | fouled | /english/illustrations/rope-fouled-propeller-480.webp | /english/illustrations/rope-fouled-propeller-960.webp | 15308 / 43470 |
| ship-rolling | rolling | /english/illustrations/ship-rolling-480.webp | /english/illustrations/ship-rolling-960.webp | 15010 / 42602 |
| ship-pitching | pitching | /english/illustrations/ship-pitching-480.webp | /english/illustrations/ship-pitching-960.webp | 14514 / 42114 |
| ship-bridge | bridge | /english/illustrations/ship-bridge-v2-480.webp | /english/illustrations/ship-bridge-v2-960.webp | 20384 / 51094 |
| bulbous-bow | bulbous bow | /english/illustrations/bulbous-bow-480.webp | /english/illustrations/bulbous-bow-960.webp | 8346 / 22566 |

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

- 480×320／960×640 WebP。全32variantの合計 **1,023,512 bytes**、最大1asset **78,584 bytes**。生成元1536px PNGはproduction配信しない。
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

## 11. 承認前の確認待ち一覧・停止（下記全件は第12節で承認済み）

**以下の16asset全部がpending**。上のmapping表に示した18項目へ仮表示している。

- `shore-ship-radio` — human visual review pending
- `air-ground-radio` — human visual review pending
- `person-overboard` — human visual review pending
- `ship-aground` — human visual review pending
- `boat-capsized` — human visual review pending
- `flooded-engine-room` — human visual review pending
- `ship-at-berth` — human visual review pending
- `ship-at-anchorage` — human visual review pending
- `under-keel-gap` — human visual review pending
- `ship-height-below-bridge` — human visual review pending
- `fog-at-harbour` — human visual review pending
- `rope-fouled-propeller` — human visual review pending
- `ship-rolling` — human visual review pending
- `ship-pitching` — human visual review pending
- `ship-bridge` — human visual review pending
- `bulbous-bow` — human visual review pending

確認画面：`http://localhost:5187/english/illustrations/review.html`。実生成の採用候補だけを表示し、学習ポイント・注意点・AI確認メモを開いて読める。元PDF・公式解答は公開しない。ローカルの `image_review.html` からも5187の同じassetsを参照できる。

人間確認では意味の一致、小さい表示の読みやすさ、細部の誤具体化、A-2からのスタイル逸脱を確認してほしい。特にair draughtの高さの端点、agroundと船底下の隙間の違い、rolling／pitchingの方向、floodedの機械描写、係留の索・装置細部を確認する。承認・差戻しの記録を受けるまで最終確定にしない。本Stageはここで停止。

## 12. 人間承認と最終確認（2026-10-07）

ユーザーが現時点の採用画像すべてをOKと判断した。16assetのmanifest statusを `approved` に更新し、review sheetも人間レビュー済みへ更新。生成時のpending記録は歴史的な作業記録として維持。`human_visual_review.json` に承認根拠と32variantのSHA-256を保存。E2.0.1の教材本文・意味・tier・group・evidence・modality・progress schema、現在の画像byteは変更していない。

最終実行：production build PASS、英語・editorial・illustration・routing関連15／15 PASS。`qa/release-build.log`、`qa/release-tests.log`に保存。canonical／public／E2.0.1 frozen masterがbyte一致し、32画像の承認時hash一致をtestで確認。CW／geography／progress／既知FAIL対象のファイルに差分なし。

既知のPileup digest FAIL1件とtypecheck2件は前Stageで変更前HEADにも再現済み。今回関連testsにFAILなし。

commit対象：production画像32variants、UI／CSS／manifest／tests、E2.1 selection／generation／human review／review sheet／report／QA、および保存済みE2.0.1本文改善・正本・監査成果。docsはignoreを全体変更せず、必要な成果物のみ明示的に追跡する。原本PDF・公式解答PDF・大規模コーパスは含めない。
