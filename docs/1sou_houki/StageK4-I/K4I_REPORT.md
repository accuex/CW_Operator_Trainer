# Stage K4-I — 法規教材 第3バッチ

**制作・dev統合・実施QA：PASS。** 人間の内容・権利・公開承認はpending。公開承認0、push/deployなし。K3-N等の既存Stage判定・canonical有効statusを変更していません。

## 教材

新規 **12テーマ・39問・78穴**、累計 **28テーマ・88問・175穴**。既存16テーマ・49問・97穴を全文・ID・時計を含めて維持しました。明示8gate全PASSの保存verifiedから、重複しないscopeを開始時にK4I_scope.jsonへ固定しました。

| テーマ | queue / canonical | 問題 / 穴 |
|---|---|---:|
| 海岸局のDSC遭難応答：方式と待ち時間 | 11 / `k1-8f508e9914e3a43b8d38` | 3 / 6 |
| 安全呼出し・安全通報：3回と送信時点 | 16 / `k1-3441a7e8c41cbdcf25c3` | 3 / 6 |
| 遭難通報を受信したとき：聴守・通知・中継 | 23 / `k1-f19be754f504e8d93a1e` | 4 / 8 |
| 空中線電力の低下装置：50％と10％ | 27 / `k1-feb17e5eff84c5898815` | 3 / 6 |
| 聴守義務の例外：局種と周波数指定 | 28 / `k1-3b362342f5560d2248be` | 3 / 6 |
| 航空通信の優先順位：気象とノータム | 29 / `k1-4fadb08ec015a5e4d202` | 3 / 6 |
| 通常DSCの応答：局種別の期限と周波数調整 | 33 / `k1-2852ba926863c70e9534` | 3 / 6 |
| 各局あて緊急呼出し：パンパンと識別の回数 | 34 / `k1-500750f966afc25b9c19` | 3 / 6 |
| 船舶局のDSC遭難受信：短波と短波以外 | 39 / `k1-ca76b79fac5c0f64e1df` | 4 / 8 |
| 海上無線電話の呼出し：2回・2分・3分 | 46 / `k1-e48f540185209f8dca2d` | 3 / 6 |
| 無線電話の遭難送信：呼出し・通報・位置 | 55 / `k1-05d10ee9727840c6e340` | 4 / 8 |
| 海岸地球局の遭難受信：応答と救助機関通報 | 60 / `k1-6adac800ec9a03fd6c1d` | 3 / 6 |

各テーマに導入、要点、条件・例外、比較、覚え方、独自練習3〜4問と正答・誤答理由、一次資料があります。DSCの海岸局応答と船舶局の受信判断は別テーマです。既存の通常DSC呼出しと、新規の応答期限も分離しています。順位・周期・AND/OR・主体・使用電波と聴守を対応させて覚えられます。過去問本文・公式選択肢は使用していません。

選定は保存historical appearances、近年の反復、条件・数字の暗記価値、一次資料の確実性によります。対応canonicalは各2問、海岸局DSC応答のみ3問に登場した保存事実を教材に示します。将来の出題率・得点率ではありません。

## 法74条の2の局所確認

保存済み公式e-Gov全法令JSONのMainProvisionにある74条の2を独立に再読しました。全2項で、他の項はありません。

- 1項：総務大臣が通信計画・訓練等、非常時の通信体制のための事前措置を講じる義務。
- 2項：その措置を講じるため、総務大臣が免許人等の協力を求めることができる権限。

免許人等の協力努力義務は同条にありません。K3-I queue44の該当保存メモは不支持で、K4-H教材の説明は原文に合っているため変更不要でした。独立追補private/article74_addendum.jsonに元メモ、全項構造、subject/action/effect、施行版、元取得時刻、hash/pointerを保持。K3-I元成果物/status及びK4-H元成果物は不変です。これはK3-I全体の再verificationではありません。

## 一次資料と内容検査

確認基準日2026-10-07 JST。保存公式e-Gov JSONを再利用し、元の取得日時・hashを維持しました。電波法2026-09-03施行版、無線局運用規則2026-07-23施行版、無線設備規則・電波法施行規則2026-07-30施行版。条位置はMainProvision内で一意に取得し、附則の同番号条を混ぜません。

別表4/10/12の位置とセル、DSC別図1の2/3の既存公式PDF・検証証拠も参照。source hash/revision/locator、12テーマの重要語句位置と全一致、正答・条件・順序を編集者として再照合しました。これは人間の独立法令監査ではありません。

特に1分〜2分45秒の帯域限定、通常DSCの5秒〜4分半/5分、50％/10％と75W/0.2W以下、短波の応答禁止、救助不能AND全他局無応答、緊急信号3回と識別3回以下、警急信号だけの省略、真方位＋海里を確認しました。分岐ごとに既存LegalRule/LegalConditionを作り、異なる項の条件をひとつのANDへ混ぜません。70条の2の使用電波の例外を聴守免除へ拡張しない注意も明示しました。

下書き検査で22条の混信通知の説明を原文へ合わせ、通知側が分で概略待ち時間を示すこと、試験・調整発射も直ちに中止することを確認しました。未支持の下書きは最終教材へ残していません。過去Stageを修正したものではありません。未知の改正時期・理由、個別機器・海域の適合、未解決指定告示の対象を補いません。

## 統合と保存

LessonPlayer/RedSheetPlayer/フィルター/seed/往復・状態復元/認証をそのまま使用。production UI・schema・progress変更なし。

変更ソースは3ファイルだけです。

- tooling/houki/dev-review.mjs：serve-onlyの内部教材読込先をStageK4-Iへ変更。資格情報は従来Gのまま。
- scripts/houkiReviewTransfer.mjs：既存ローカルtransfer対象をIへ変更。
- scripts/checkHoukiReviewBatch.mjs：I対Hの旧16不変、固定verified12、同名章重複、公式revision/table pointer等を確認。

private/batch1.authoring.jsonは教材版3です（既存transfer allowlistに合わせた互換ファイル名）。private/themes*.py・create_batch.pyは制作原本、batch1.evidence.json・content_audit.jsonは出典と照合、review-capturesは画面証拠。

**復元正本はprivate/batch3-v3-final-frozen.backup.json。** 既存transfer形式、3ファイルallowlist・hash・schema検証・credentials除外。restoreは全宛先の不存在を先に確認し、既存ファイルを上書きしません。現状で実restoreは実施していません。前段の2backupはdraft-*として隔離。G/H旧版はそのまま保存され、必要なら内容読込先を旧Stageへ戻せます。認証情報はbackupへ入っていません。

private本文・法令全文・credentialsはignored領域にのみ保存し、commitには連携コード・検査ツール・安全な報告を含めます。ローカル教材を移動する場合はこのprivate backupが別途必要です。

## QAと公開境界

- schema/review validator、固定scope・ID・参照・旧16/時計・blank対応：PASS。
- 未承認教材のrelease validator拒否：PASS。
- 関連6ファイル43テスト：PASS（既存28句・25点セット含む）。
- production対象TypeScript：PASS。保護済みdocs試作を除外。root全体の型検査はNOT_RUN。以前のK4-B TS2345箇所は不変。
- 正式npm run build：PASS。private/build.log保存。
- production出力1,213ファイルの全28テーマID・タイトル・edition・privatepath・資格情報の秘密値検査：混入0。
- desktop1280×900：安全通信本文・要点・比較・確認問題。
- mobile375×812：航空順位・DSC受信判断・赤シート。scrollWidth=375、本文・長い答えの折り返しを確認。
- Enter/Space、個別reveal/allshow/allhide、解説、分野航空3問、ランダム、参考書往復：PASS。元sheetへ2/2答えと開いた解説を復元。
- reload：同一seed/問題位置を維持。答え表示・解説は全reloadで隠れる既存挙動を確認。全reload後のreveal永続化は主張しません。
- 公式e-Govリンク・条/施行版/asof表示確認。
- viewport解除直後の戻るclickが1回反映されず、同ボタンEnterで正常に戻りました。原因は未確定。既存navigationコード不変、直前のmouse往復は成功。再現する場合は次回局所確認対象とします。
- VoiceOver実音声、全テーマ全操作、無関係なCW音響QA：NOT_RUN。

## 保護と残課題

開始HEAD ffb0429a3b9172a88762eadd8ea42bfee9c18f74、main、clean。保護1,479ファイルhash不変。historical615/486/2161、Priority1 verified41/unresolved22、K3元成果物とK追補、K4-A〜H、H-Final28、公開DTO、package1.1.1、既知画像を維持。CW/RIG/地理/英語の変更なし。public追加0、公開承認0。

人間による教材内容・権利・公開審査は未完了です。次回はこの12テーマの学習者レビューが可能です。未確認告示・改正史・他分野へ今回自動拡張しません。ローカルcommit後に停止します。
