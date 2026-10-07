# Stage E2.0.1 教材本文品質改善レポート

作成日：2026-10-07。基準：`de9df04` / Stage E2-v1。対象は一総通専門英語の本文編集と最小UI修正のみ。今回の変更はcommitしていません。

## 1. 変更ファイル

### 教材とproduction

- `docs/1sou_english/StageE2/english_learning_master_v1.json`：正本。
- `public/english/data/english-learning-master-v1.json`：正本とbyte単位で一致する公開コピー。
- `app/views/EnglishView.tsx`：空欄非表示、監査情報のfold、範囲を変えない関連参照。
- `app/styles/views/english.css`：関連参照枠と長い関連ボタンの折返しのみ。
- `lib/english/data.ts`：audit metadataの最小型追加。
- `lib/english/editorial.test.ts`：編集前との全保護フィールド比較、本文・関連・例文の検査。
- `lib/english/e2-protected-facts.json`：E2確定時点のroot factsとitemごとのSHA256。採否・公式解答・頻度・modality等の変更を検出するfixture。

### 編集入力と監査

このレポートの隣に凍結baseline、101項目の編集入力、42修正例文、59保持例文の個別理由、`item_review_101.json`、`validation.json`、`quality_checks.json`、再生成script、`qa/`を保存しました。`README.md`に再生成方法を記載。

E2の履歴builderを使い直さず、凍結したE2マスターへE2.0.1のoverlayを適用します。出典・頻度の再集計は行いません。既存のcanonical/public path、masterVersion、schemaVersionを維持し、`editorialRevision`を追加しました。

## 2. 101項目の全件監査

101/101の専門義、具体的対比の要否、説明、学習上の効用、例文・対訳、関連先を個別に確認しました。説明と効用は全件を書き直しました。

自動検査は意味品質の証明ではありません。分析者による編集判断と、その限界を全件台帳に記録しています。独立した人間・英語ネイティブによる校閲は未実施です。

個別の理由・最終本文・関連先は [item_review_101.json](item_review_101.json)、例文保持の理由は [retained_examples_review.tsv](tools/retained_examples_review.tsv) で追えます。

| 項目 | 専門義 | 注意欄 | 例文 | 関連 |
|---|---|---|---|---|
| coast station | 保持 | 具体化 | 修正 | 修正 |
| ship station | 保持 | 非表示 | 修正 | 修正 |
| aircraft station | 保持 | 具体化 | 修正 | 修正 |
| aeronautical station | 保持 | 具体化 | 修正 | 修正 |
| coast earth station | 保持 | 非表示 | 修正 | 修正 |
| master | 変更 | 具体化 | 修正 | 修正 |
| Administration | 変更 | 具体化 | 修正 | 修正 |
| rescue coordination center | 保持 | 非表示 | 修正 | 修正 |
| distress | 保持 | 具体化 | 保持・個別確認 | 修正 |
| urgency | 変更 | 非表示 | 修正 | 修正 |
| distress alert | 保持 | 具体化 | 修正 | 修正 |
| distress traffic | 保持 | 具体化 | 保持・個別確認 | 修正 |
| radiotelephony | 保持 | 具体化 | 修正 | 修正 |
| acknowledge | 保持 | 非表示 | 修正 | 修正 |
| relay | 保持 | 非表示 | 修正 | 修正 |
| medical advice | 変更 | 非表示 | 修正 | 修正 |
| maritime safety information | 保持 | 非表示 | 修正 | 修正 |
| mayday | 保持 | 具体化 | 修正 | 修正 |
| pan pan | 保持 | 具体化 | 修正 | 修正 |
| survival craft | 保持 | 非表示 | 修正 | 修正 |
| on scene | 変更 | 非表示 | 保持・個別確認 | 修正 |
| gmdss | 変更 | 非表示 | 修正 | 修正 |
| navtex | 保持 | 非表示 | 修正 | 修正 |
| epirb | 変更 | 非表示 | 修正 | 修正 |
| digital selective calling | 保持 | 非表示 | 修正 | 修正 |
| narrow band direct printing | 保持 | 非表示 | 保持・個別確認 | 修正 |
| overboard | 保持 | 非表示 | 保持・個別確認 | 修正 |
| aground | 保持 | 具体化 | 保持・個別確認 | 修正 |
| capsize | 保持 | 具体化 | 保持・個別確認 | 修正 |
| flooded | 保持 | 非表示 | 保持・個別確認 | 修正 |
| seelonce feenee | 保持 | 非表示 | 修正 | 修正 |
| watch | 変更 | 具体化 | 保持・個別確認 | 修正 |
| guard | 変更 | 具体化 | 保持・個別確認 | 修正 |
| traffic | 変更 | 具体化 | 保持・個別確認 | 修正 |
| frequency | 変更 | 具体化 | 保持・個別確認 | 修正 |
| interference | 保持 | 具体化 | 修正 | 修正 |
| clear | 変更 | 具体化 | 保持・個別確認 | 修正 |
| sensitivity | 保持 | 具体化 | 保持・個別確認 | 修正 |
| port | 保持 | 具体化 | 保持・個別確認 | 修正 |
| starboard | 保持 | 具体化 | 保持・個別確認 | 保持・個別確認 |
| pilot | 変更 | 具体化 | 保持・個別確認 | 修正 |
| berth | 保持 | 具体化 | 修正 | 修正 |
| anchorage | 保持 | 具体化 | 保持・個別確認 | 修正 |
| fairway | 保持 | 具体化 | 保持・個別確認 | 修正 |
| under keel clearance | 保持 | 具体化 | 修正 | 修正 |
| air draught | 保持 | 具体化 | 保持・個別確認 | 修正 |
| make fast | 変更 | 具体化 | 修正 | 修正 |
| single up | 変更 | 具体化 | 修正 | 修正 |
| lines | 変更 | 具体化 | 保持・個別確認 | 保持・個別確認 |
| lock | 保持 | 具体化 | 保持・個別確認 | 修正 |
| estimated time of arrival | 保持 | 非表示 | 修正 | 保持・個別確認 |
| next port of call | 保持 | 具体化 | 保持・個別確認 | 修正 |
| final destination | 保持 | 具体化 | 保持・個別確認 | 修正 |
| radio quarantine | 保持 | 非表示 | 修正 | 修正 |
| dense fog | 保持 | 具体化 | 保持・個別確認 | 保持・個別確認 |
| poor visibility | 保持 | 非表示 | 保持・個別確認 | 保持・個別確認 |
| restricted visibility | 保持 | 具体化 | 保持・個別確認 | 修正 |
| hampered | 変更 | 具体化 | 保持・個別確認 | 修正 |
| fouled | 保持 | 具体化 | 保持・個別確認 | 修正 |
| congested | 保持 | 具体化 | 保持・個別確認 | 修正 |
| unseaworthy | 保持 | 非表示 | 保持・個別確認 | 修正 |
| dragging | 変更 | 具体化 | 保持・個別確認 | 修正 |
| rolling | 保持 | 具体化 | 修正 | 修正 |
| pitching | 保持 | 具体化 | 修正 | 修正 |
| swell | 保持 | 具体化 | 保持・個別確認 | 修正 |
| ballast | 保持 | 具体化 | 保持・個別確認 | 修正 |
| heading | 変更 | 具体化 | 保持・個別確認 | 修正 |
| bearing | 保持 | 具体化 | 保持・個別確認 | 保持・個別確認 |
| course | 変更 | 具体化 | 保持・個別確認 | 修正 |
| cable | 変更 | 具体化 | 保持・個別確認 | 修正 |
| knots | 変更 | 具体化 | 保持・個別確認 | 修正 |
| make a lee | 変更 | 非表示 | 保持・個別確認 | 修正 |
| heave to | 変更 | 非表示 | 保持・個別確認 | 修正 |
| give way | 保持 | 具体化 | 修正 | 修正 |
| keep clear | 変更 | 具体化 | 保持・個別確認 | 修正 |
| automatic identification system | 保持 | 非表示 | 修正 | 修正 |
| bridge | 保持 | 具体化 | 修正 | 修正 |
| regularity of flight | 変更 | 具体化 | 修正 | 修正 |
| public correspondence | 保持 | 非表示 | 修正 | 修正 |
| air traffic services | 保持 | 非表示 | 修正 | 修正 |
| standardized phraseology | 変更 | 非表示 | 修正 | 修正 |
| plain language | 変更 | 具体化 | 修正 | 修正 |
| receiver failure | 保持 | 非表示 | 修正 | 修正 |
| transmitting blind | 保持 | 非表示 | 保持・個別確認 | 修正 |
| shall | 保持 | 具体化 | 保持・個別確認 | 保持・個別確認 |
| shall not | 保持 | 具体化 | 保持・個別確認 | 保持・個別確認 |
| may | 保持 | 具体化 | 保持・個別確認 | 修正 |
| unless | 保持 | 具体化 | 保持・個別確認 | 修正 |
| except | 保持 | 具体化 | 保持・個別確認 | 修正 |
| provided | 変更 | 具体化 | 保持・個別確認 | 修正 |
| subject to | 保持 | 具体化 | 保持・個別確認 | 修正 |
| at least | 保持 | 具体化 | 保持・個別確認 | 修正 |
| in accordance with | 保持 | 非表示 | 保持・個別確認 | 修正 |
| prior to | 保持 | 非表示 | 保持・個別確認 | 修正 |
| only when | 保持 | 具体化 | 保持・個別確認 | 修正 |
| where practicable | 保持 | 具体化 | 保持・個別確認 | 修正 |
| on the authority of | 保持 | 非表示 | 保持・個別確認 | 修正 |
| without delay | 保持 | 非表示 | 保持・個別確認 | 修正 |
| regardless of | 保持 | 具体化 | 保持・個別確認 | 修正 |
| bulkhead | 保持 | 非表示 | 保持・個別確認 | 修正 |
| bulbous bow | 変更 | 非表示 | 修正 | 修正 |

## 3. confusionを変更した件数

**101件**。具体的な対比へ書き直した65件と、削除した36件です。旧原文は`audit_metadata.original_scope_or_confusion`に保存しました。

guardのCoast Guardとの区別、heading forの一般動詞用法、courseの過程・台風の進路など、意味境界は維持。E0の検出やGuardianの部分一致など監査用の事情をlearner本文へ出しません。

## 4. confusionを削除・非表示にした件数

**36件**。役割の説明で足りる項目に、無理に誤解例や一般的免責を足していません。値は空文字とし、`dt/dd`をまとめて非表示にしました。

対象：ship station、coast earth station、rescue coordination center、urgency、acknowledge、relay、medical advice、maritime safety information、survival craft、on scene、gmdss、navtex、epirb、digital selective calling、narrow band direct printing、overboard、flooded、seelonce feenee、estimated time of arrival、radio quarantine、poor visibility、unseaworthy、make a lee、heave to、automatic identification system、public correspondence、air traffic services、standardized phraseology、receiver failure、transmitting blind、in accordance with、prior to、on the authority of、without delay、bulkhead、bulbous bow。

## 5. whyItMattersを変更した件数

**101件**。「何を取り違えずに読めるか」を項目ごとに記述。以前の採用理由は`audit_metadata.original_inclusion_rationale`に保持し、根拠foldにだけ表示します。

`japanese_explanation`も101件変更。NAVTEXは安全情報受信、radiotelephonyは音声の通信方式、medical adviceは人の健康への助言、と各役割を説明しました。8場面のgoalは変更せずヘッダに残しました。

補足3項目の本文からも試験番号・検出事情を除去し、`audit_original_meaning`へ原文を保存。modality補足注記はauditへ移し、根拠foldで参照できます。

## 6. specialistMeaningの変更一覧

**30件**。

master、Administration、urgency、medical advice、on scene、gmdss、epirb、watch、guard、traffic、frequency、clear、pilot、make fast、single up、lines、hampered、dragging、heading、course、cable、knots、make a lee、heave to、keep clear、regularity of flight、standardized phraseology、plain language、provided、bulbous bow。

専門義の試験識別子を除去し、具体的な境界は説明・注意欄へ分けました。例：

| 項目 | 編集結果 | 境界・根拠 |
|---|---|---|
| regularity of flight | 飛行の正常な運航 | 2006-09 reading問5 B3のsafety and regularity of flight。定時性だけに狭めない。 |
| on scene | 現場にいる／現場で | 2004-09 reading問2 A8のon-scene communications。既存例の救助船が現場にいる意味も保持。 |
| GMDSS | 海上における遭難及び安全に関する世界的な制度 | 保存済み2016-03法規A19、PDF7ページの印刷名称を使用。英語の頻度・modality根拠へ法規資料を加算しない。 |
| EPIRB | 非常用位置指示無線標識 | 2024-03法規A16、PDF7ページの「衛星非常用位置指示無線標識」を確認。短い機能説明は別欄。 |
| plain language | 普通の言葉による表現 | 2017-09 reading問2 A9。標準通信表現で意図を伝えられない場合。「平文」は暗号との誤解を招くため不採用。 |
| bulbous bow | 球状船首 | 2023-03 reading問4の水線下の球状部分。例文訳と統一。 |
| single up | 出港前に係留索を最小限だけ残す状態にする | 2023-09英会話問5は係留中から出港への場面。旧例の最小限の索という境界を説明で明確化。本数・配置・固定手順は追加しない。 |
| keep clear | 対象から離れている（keep clear of） | 2012-09英会話問7。ofの後ろが避ける対象。clear the fairwayとは構造を分ける。 |
| bridge | 船橋（保持） | 本義は船橋のまま。air draughtの橋梁と関連させ、文脈による二義を説明。choice-onlyという根拠事情はfoldへ保持。 |

guardは2009-09 reading問5の周波数を目的語に取るguards、headingは2021-03 reading問5、courseは2017-03 reading問5も局所確認。本文へ出典IDは混ぜず、元の根拠・除外用法を保全しました。

## 7. exampleの変更一覧

**42件修正、59件保持・個別確認**。全101件の英文・対訳・専門義・状況・誤規則・原文一致を確認しました。

修正：coast station、ship station、aircraft station、aeronautical station、coast earth station、master、Administration、rescue coordination center、urgency、distress alert、radiotelephony、acknowledge、relay、medical advice、maritime safety information、mayday、pan pan、survival craft、gmdss、navtex、epirb、digital selective calling、seelonce feenee、interference、berth、under keel clearance、make fast、single up、estimated time of arrival、radio quarantine、rolling、pitching、give way、automatic identification system、bridge、regularity of flight、public correspondence、air traffic services、standardized phraseology、plain language、receiver failure、bulbous bow。

- give wayの旧例`The smaller vessel must give way.`を削除。`Our vessel will give way and let the other vessel pass.`とし、大小で避航義務が決まるように教えません。保存済み2019-09英会話問5も操船能力についての本文です。
- MAYDAY/PAN PANは、呼出しの冒頭と続く状況が分かる短い自作例へ変更。長い交信例や実運用手順にはしません。
- COREは通信主体・相手・通報内容が分かるように補強。
- roll/pitchは揺れの向きを自作例で明示。
- LEGALの15例と構造表示は維持。架空の構文説明用例であり、実際の配備義務・運用規則として提示しません。

101例がtarget termまたは語形を含み、対訳を保持。保存済みE0の616unitのprivate textとの正規化全文一致は**0件**。これは抽出漏れや定型句の部分共有を否定する検査ではなく、意味や自然さの自動保証でもありません。原本を転載して例を作成していません。

自動だけで判定しないmanual review対象は**全101例**で、各理由を台帳と2つの例文TSVに列挙。とくにPAN PAN、single up、GMDSS、EPIRB、plain language、give way、heading/course、LEGAL15例は、用語の境界・誤った一般規則を含まないか重点確認しました。

## 8. relatedの変更一覧

**93件変更、8件は個別確認して保持**。

変更：coast station、ship station、aircraft station、aeronautical station、coast earth station、master、Administration、rescue coordination center、distress、urgency、distress alert、distress traffic、radiotelephony、acknowledge、relay、medical advice、maritime safety information、mayday、pan pan、survival craft、on scene、gmdss、navtex、epirb、digital selective calling、narrow band direct printing、overboard、aground、capsize、flooded、seelonce feenee、watch、guard、traffic、frequency、interference、clear、sensitivity、port、pilot、berth、anchorage、fairway、under keel clearance、air draught、make fast、single up、lock、next port of call、final destination、radio quarantine、restricted visibility、hampered、fouled、congested、unseaworthy、dragging、rolling、pitching、swell、ballast、heading、course、cable、knots、make a lee、heave to、give way、keep clear、automatic identification system、bridge、regularity of flight、public correspondence、air traffic services、standardized phraseology、plain language、receiver failure、transmitting blind、may、unless、except、provided、subject to、at least、in accordance with、prior to、only when、where practicable、on the authority of、without delay、regardless of、bulkhead、bulbous bow。

port↔starboard、heading↔course、rolling↔pitching、air draught↔bridgeを相互リンク。distress/urgency/安全情報は区分・働きで、fog/visibilityは原因・状態でつなぎます。bulbous bowには無理な同分類リンクを付けず、関連0件を許容しました。

| 入ってくるリンク | 編集前 | 編集後 |
|---|---:|---:|
| 最大集中数 | 19 | 5 |
| distress | 19 | 2 |
| urgency | 19 | 3 |
| dense fog | 13 | 1 |
| poor visibility | 13 | 2 |

nonexistent ID / self-link / duplicate linkは各0件。集中数を閾値に合わせるための最適化ではなく、個別の対比・機能関係を選んだ結果です。

tier外はボタンに「標準の項目（範囲外）」等を表示。関連は一時参照で、tier・場面・保存した読書位置を変更しません。「元の項目へ戻る」で復帰できます。参照中の前後移動は無効にして元の一覧との混同を防ぎます。参照先を確認済みにしても、保存するlastは元の位置で、reload時も元の項目から再開します。

## 9. 第三者レビューへの対応

| 指摘 | 判断 | 対応・理由 |
|---|---|---|
| 8場面・累積tier・一般義と専門義 | accepted | 全件固定。CONTEXTのhide/revealも保持。 |
| 監査文がconfusionに露出 | accepted | 101件編集、36件非表示。元文はauditへ。 |
| whyが採用テンプレ | accepted | 101件を項目固有の効用に書き直す。 |
| 試験番号が専門義に混入 | accepted | make fast/single up/make a lee/heave to等から除去、出典は保持。 |
| regularity of flightの日本語 | accepted | 核を正常な運航へ。定時性だけへ狭めない。 |
| on sceneの日本語 | accepted | 現場にいる／現場で、修飾形も説明。 |
| GMDSSの名称候補 | partially accepted | 名称確認は実施。ローカル一次資料に印刷された制度名称を使用。「世界海洋遭難安全システム」の正式性は局所資料で確定していないため置換しない。 |
| EPIRBの名称 | accepted | 保存済み法規の名称を確認し、非常用位置指示無線標識を核にする。 |
| plain languageの表現 | partially accepted | 「普通の言葉」を採用。「平文」は暗号との対比を生むため不採用。 |
| bulbous bowの訳 | accepted | 球状船首に統一。 |
| single upの具体性 | accepted | 最小限の索を残す出港準備として説明。操作の本数や配置は固定しない。 |
| give wayの大小規則 | accepted | 旧例削除。特定の船の行動を述べる中立例へ。 |
| keep clearとclearの混在 | accepted | ofの対象から離れる構造へ整理。 |
| air draught/bridgeの関連 | accepted | 相互関連、bridge本義の船橋を維持。 |
| 場面goalの機械的な貼付 | accepted | カード101件を編集、場面goalはヘッダのみ。 |
| relatedの場面hub集中 | accepted | 全件再選択、最大19→5。 |
| tier跨ぎの迷子 | accepted | 一時参照と明示した戻り導線。範囲を自動変更しない。 |
| 101自作例の品質 | accepted | 42件修正、59件は個別理由を付けて保持。 |
| LEGALの構造学習 | accepted | 義務・禁止・許可・条件等を保持、各語の働きを説明。法規講座に拡張しない。 |

全面的にrejectedとした指摘はなし。部分採用の具体的な不採用案と理由は上記に記録しています。

## 10. template leakage検査

- 共通免責が完全一致するconfusionは編集前72件 → 編集後0件。
- 非空confusion65件は完全一致の重複0。空欄36件を重複として数えていません。
- whyの「教える意味は」テンプレを含む73件 → 0件。
- 場面goalをそのまま含む個別説明72件 → 0件。
- why/説明は各101件の完全一致重複0。
- specialistMeaning、confusion、why、説明、一般義、補足に試験ID・監査語の混入0。

旧why/説明は元々完全一致ではありませんでした。単語を差し替えたテンプレを、完全一致率だけでは検出できません。今回は各項目の役割・対比・読み落とす内容まで個別編集し、台帳に最終本文を保存しました。自動的な「意味的重複率」は捏造していません。

## 11. data integrity

**PASS**。

| 保護対象 | 結果 |
|---|---|
| adopted / excluded / integrated / hold | 101 / 42 / 3 / 0、E2から不変 |
| cumulative tiers | 32 / 74 / 101 |
| 8 scenes / goals | 不変 |
| stable learningEntityId / category / tier / group所属 | 不変 |
| E0 frequency facts / candidate decisions | 不変 |
| evidence references / corrected roles / official-answer metadata | 不変、参照切れ0 |
| modality facts / impact | 不変 |
| general meaning / example出所・非運用指示metadata | 不変 |
| schemaVersion / progress key / confirmedの意味 | 不変、schemaVersion1・`cwot:english-progress:v1` |
| canonical vs public | byte一致 |

itemの編集可能な本文・例文・関連と追加audit以外の全フィールドを凍結baselineと比較。補足のofficial_key/frequency/verification等も比較し、元の意味文・modality注記は移動先をたどって保持を確認。root factsも比較しました。

## 12. desktop/mobile QA

**1440×1000、375×812で主要フローPASS**。結果は`qa/browser_checks.json`、画面は`qa/desktop-related.jpg`・`qa/mobile-legal.jpg`。

- 3範囲の実一覧件数：32/74/101。
- 8場面の選択。全範囲で8/23/11/16/24/15/15/3件。所属の重複があり合計101にはなりません。
- 一覧→詳細、前後移動、意味hide/reveal、LEGAL構造。
- ship stationの空の注意欄とbulbous bowの空の関連タイトルは非表示。
- guard→frequency、port→starboardのtier外表示。学習範囲・場面・元の位置は不変。
- 参照から戻る。参照先の確認済みは保存でき、reloadは元の位置へ復帰。
- desktop/mobileの確認済み保存・取消・reload、最小/operations/guardの位置復元。
- evidence folding、監査テンプレはfold内のみ。
- 一総通メニュー→専門英語→メニュー。
- 375pxは全8場面と根拠展開・関連参照でscrollWidth=375、1440pxもscrollWidth=1440。横overflowなし。
- browser errorログ0。QAで付けたguard/starboardの確認済みを取消し、元の読書位置へ戻しました。

progress保存方式は変えず、保存に失敗する場合や未知schemaの保護テストも既存のままPASSです。

## 13. build/test

| 検証 | 結果 |
|---|---|
| 英語＋navigation関連 | **14/14 PASS**（英語9、navigation5） |
| 既存全体 | **679 PASS / 1既存FAIL / 計680** |
| production build | **PASS** |
| 追加editorial testのlint | **PASS** |
| typecheck | 既存2件でFAIL、新規エラー0 |
| diff whitespace | PASS |

ログは`qa/`に保存。全体テストにはCQ/Pileup/Contest/Wabun/DECODE等の既存試験が含まれます。今回それらのソースは変更していません。聴覚品質をこのQAで保証するものではありません。

## 14. pre-existing failure

変更前HEAD `de9df04`を`/tmp/e201/head`へ展開し、同じnode_modules・設定で再現確認しました。

- `lib/radio/sim/pileupGolden.test.ts`：intro-average#1のdigest不一致。期待`ae4b01…`、実値`25467a…`。変更前と変更後で同じFAIL。
- `app/landing/LandingRigDemo.tsx:63`：number/Timeoutの型不一致。
- `lib/api/cloudSync.ts:154`：Record<string,unknown>→TrainerProfileの型変換。
- typecheckの出力は変更前と同じ2件。今回の英語ファイルによる追加エラーなし。

既知FAILのため本体全テスト・typecheckを全面PASSとは記載しません。無関係な修正はしていません。

## 15. 残課題と停止

- 本文の自然さ・意味境界には編集判断が含まれます。全件台帳に判断を保存しており、独立した人間による最終校閲は未実施。
- GMDSSのレビュー候補表記を唯一の正式名称とする確認はしていません。確認できた原本の制度名称を使用。
- 本体の既知Pileup/typecheck FAILは残存。
- E0抽出本文の一致検査は原本全体の完璧な重複検出ではありません。自作であることと個別読解を併せて判断。
- docsは既存のignore設定下にあります。今回の編集入力・原文baseline・レポートはローカルに保存済み。後日commitする際の追跡対象は人間の指示に従います。

挿絵・画像manifest・教材placeholder・音声・SRS・新候補・他資格・地理/CW変更はありません。原本PDF・公式解答PDFを公開していません。

**E2.0.1で停止。commitせず、E2.1には進みません。**
