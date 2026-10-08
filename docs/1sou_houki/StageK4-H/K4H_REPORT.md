# Stage K4-H — 法規教材 第2バッチ

制作・dev統合・実施したQAはPASS。公開・権利・人間による内容審査は未承認のままです。K3-N等のStage判定を変更していません。

## 制作した教材

既存6テーマ・19問・38穴を維持し、10テーマ・30問・59穴を追加しました。合計 **16テーマ・49問・97穴**。各テーマは導入、要点、本文、条件・例外、比較、覚え方、独自練習3問と解説、公式出典を備えています。

| 追加テーマ | 独自練習 |
|---|---:|
| 免許不要局の監督：継続的かつ重大な障害 | 3 |
| 通常DSCの呼出し：45秒・5分・15分 | 3 |
| 呼出周波数の使用制限：1分未満と例外 | 3 |
| 船舶局の閉局：二つの終了条件と例外 | 3 |
| 呼出し前の確認：聴守してから発射する | 3 |
| 海岸局の常時運用：三類型だけでは足りない | 3 |
| 非常時の通信：命令・実費・事前の体制整備 | 3 |
| 免許承継：相続・運行者変更と届出 | 3 |
| 電波の質が不適合：停止→試験→直ちに解除 | 3 |
| 混信・妨害の防止：保護対象と四通信の例外 | 3 |

通信間隔、時間の境界、主体・局種、手続の順序を優先しました。今回の対応canonicalはそれぞれ原問2問への登場が保存分析で確認されています。既存6テーマの次に、近年の反復、数値・条件の混同を防ぐ学習価値、公式証拠の確実性で選びました。「最多頻出10テーマ」とは主張しません。出現数は将来の出題率・得点率ではありません。

## 正確性と確認範囲

基準日は2026-10-07 JST。保存済みe-Gov一次資料を再利用し、取得日時・hash・施行版・条位置を保持しました。電波法の施行版2026-09-03、無線局運用規則の施行版2026-07-23を使用。附則に繰り返される同番号条文を誤選択しないよう、MainProvision内の一意な条を選びました。

特に45秒/5分/15分の局種・場面、1分**未満**、156.8MHzの時間例外は遭難だけ、8291kHzへ試験例外を追加しないこと、閉局の号別例外、類型OR＋大臣指定AND、申出→試験→適合→即時解除を照合しました。免許承継の対象局種と書面付き届出を分け、現行規定の追加対象をhistorical原問へ書き込みません。

再読時に、運規41条の「空間の状態」、45条の「隣接海岸局による業務代行」「運用義務時間」、法20条の「遭難自動通報設備」を原文に合わせて教材化しました。個別指定告示、機器適合、未確認の改正時期・理由は補いません。

**保存メモの差異**：K3-I queue44のwholeScopeFindingsには「免許人等協力努力義務」とありますが、保存一次資料の74条の2第2項は「大臣が免許人等の協力を求めることができる」という文です。教材は一次資料の主語・法的効果に従い、免許人等の義務を追加しません。元verification/statusは変更せず、この差異をprivate/content_audit.jsonへ隔離記録しました。将来の独立レビューで確認する対象です。

queue45 canonicalのneeds_amendment_handlingは不変です。新規の現行法解説noteに付けたneeds_contextは編集コンテンツの文脈要件であり、canonicalの公開適合を上書きした値ではありません。historicalとの違い・未確認の改正時期を本文と確認範囲で区別しています。

## 既存画面と統合

既存6テーマをブラウザで軽く読み直しました。本文・問題の明らかな矛盾は見つからず、本文変更なし。新規教材も共通LessonPlayer/赤シート・既存認証・フィルター・ランダム・戻り状態を使用します。

テーマ一覧の下から教材を開くとスクロール位置が本文途中に残る挙動を確認したため、既存のフォーカス処理に見出しへの即時スクロールを追加しました。固定ヘッダー下96pxに見出しを置きます。出題・学習状態のロジックは変更していません。

dev middlewareの教材読込先と既存transfer toolの保存対象だけをStageK4-Hへ切替。reviewer credentialsは従来のStageK4-G/privateを継続使用し、認証・公開配信の基盤を増やしていません。

## 保存先と公開境界

- `private/batch1.authoring.json`：既存transfer allowlistとの互換名を維持した第2バッチ教材（教材版2）。
- `private/themes.py` / `private/create_batch.py`：10テーマの編集原本と生成処理。
- `private/batch1.evidence.json` / `private/content_audit.json`：canonical出現事実、選定根拠、source hash/pointer、条件と正答の照合。
- `private/batch2-v2-frozen.backup.json`：既存transfer方式による凍結保存。credentialsは含みません。
- `private/review-captures/`：既存教材のspot check、新規desktop、375px参考書・赤シート。

privateはGit対象外・public配下ではありません。今回commitには安全な実装・検証ツール・要約報告だけを含めます。教材本文・一次資料・credentialsは含めません。K4-Gの全原本は不変です。

未認証の取得拒否、reviewer権限、LAN/cross-origin拒否、production拒否、raw file拒否、cache拒否は既存関連テストで確認。未承認DTOは公開validatorに拒否されます。dist全1,213ファイルをprivateテーマID・タイトル・edition・credential等で検査し、混入0。既存public教材JSON不変、public assets追加0です。

## QA

- スキーマ・参照・旧6テーマ/旧masterレコード/時計の同一性・独自問題blank対応・source hash/位置：PASS。
- 正答・数値・例外：編集者による保存一次資料再照合。自動anchor検査のPASSを独立した法令監査とは呼びません。
- 関連テスト：6ファイル43テストPASS（既存28句・25点セットを含む）。
- production対象TypeScript：PASS。docsの保護済み試作は除外。root型検査は今回NOT_RUN。既知のK4-B試作TS2345はhash不変。
- 正式build（prebuildを含む）：PASS。
- desktop1280×900：DSC参考書の本文・比較・問題表示、見出し位置を確認。
- mobile375×812：参考書・赤シート、Enter/Space、全表示/全非表示、解説、分野18問、ランダムとreload、参考書から2/2正答表示＋解説状態復元を確認。横幅=scrollWidth=375。
- 新規代表例：通常DSC、呼出周波数の使用制限。公式出典・施行版・基準日の表示も確認。
- VoiceOver実音声・全テーマ全操作の網羅監査：NOT_RUN。

詳細はtest_results.json、private/schema_content_results.json、private/content_audit.json、private/build.log等。

## 変更・保護・次候補

開始HEAD ac24a3902eb2c8dd200f83a1a1d14ff9ab0eabdf、main、working tree clean。保護対象1,454ファイルhash不変。historical615/486/2161、Priority1 verified41/unresolved22、K3元記録、K4-A〜G、H-Final28、package1.1.1、既知画像を保持。

本番ソースの変更はHoukiTrainerViewの移動後の見出し表示とhouki-trainer.cssのみ。dev-review.mjsとhoukiReviewTransfer.mjsは既存機構の教材保存先変更、checkHoukiReviewBatch.mjsはローカル内容検査です。CW・地理・API/DB・公開教材は変更なし。push/deployなし。

次に効果的なのは、保存済みverified範囲での**安全呼出しと安全通報（queue16）**、**DSC遭難警報への応答・中継（queue11/23）**。方式・待時間・除外条件の比較に価値があります。今回着手していません。

人間レビューでは、10テーマの対象範囲・正答理由、上記queue44メモ差異、独自問題の表現、権利と公開可否を確認してください。人間公開承認は0のまま、devで閲覧できる制作版として停止します。
