# Stage K4-E — JSON教材プレイヤー

判定：**REVIEW**。JSONプレイヤーの本実装・自動検証・commitを完了。実画面、375px、キーボード、VoiceOverはNOT_RUNのため人間の最終QAが残る。公開承認・push・deployなし。

## 構造と教材移行

内部原本 `data/houki/original-samples.authoring.json` → 用途・版・個別審査の検証 → allowlist配信DTO → loaderのschema/registry検証 → 共通LessonPlayer。

架空2章・2テーマ・3問・改正カード1・注意カード1を維持。文章の正本はordered blocksのみ。K4-D互換のgoal/explanation/stepsは生成時に派生し、編集原本では重複管理しない。旧公開原本JSONを配信から外し、旧版の架空教材snapshotを本Stage内へ保存した。実問題・実法令教材の投入0。

schemaVersion `1.0.0`、Draft-07、既存Ajv6.15.0を直接依存として明示。追加パッケージ取得なし。依存lockは該当の既存runtime graphのみ更新、package version1.1.1維持。

型：explanation / keyPoints / conditions / procedure / comparison / question / redSheet / amendment / pitfall / source。未知型・未知schema・余分field・欠落fieldを拒否する。JSONの文字列はReactテキストとして描画し、HTML/script実行機構なし。loaderは診断をconsoleに残し、画面には安全な読込失敗を表示する。

LessonPlayerはJSON順にBlockRendererを呼ぶ。単独・参考書内の赤シートは同じRedSheetPlayerとtoggleRevealedを使用。Sources/Cardも共通化。既存28句・25点セットは従来HoukiViewへ接続し、master/progressを変更していない。

## Registry・版・公開境界

IDはregistry種別で名前空間化（既存chapter/themeの同一文字列を維持）。種別内重複、block重複、参照欠落、問題↔テーマ、rule/condition/source、card/event、歴史的原問/canonical/blank/version/answer/printedPositionを検査。問題↔lessonの相互リンクは許可、prerequisite構成の循環は拒否。

各表示entity、blank、lesson、blockにid/contentVersion/purpose別publicReviewを要求する。親の承認だけではchildや出典を承認しない。サンプルはoriginal_author / not_applicable_sample / releaseApproved=false。実教材はrights cleared、人間approved、承認日時、releaseApprovedが必要。verifiedやtechnical stagingだけでは配信不可。

内部証拠はauthoring外層に隔離。明示トップallowlist＋全階層additionalProperties=falseと禁止field検査で配信を保護する。private全文やhash/pointer/rangeを取り込まない。原本JSONそのものはpublicへコピーしない。

`generate:houki-lessons`で検証して版別DTOを生成。既存版と異なる内容の上書きは拒否しcontentVersion増分を要求。active.jsonが選択する版・パスをloaderでも検査。`npm run build`のprebuildで原本/DTO/index整合と全参照・審査を確認。直接vinextを呼ぶ場合はこのprebuildを省略できるため、正式buildはnpm run buildを使用する。

日時はentity/versionごとのtemporalRecordsで出題年月、法施行日、確認基準日、出典取得日、編集確認日、公開日を別管理。公開承認日は用途別review。架空データの日付はnull、作成年を試験年月として表示しない。既存版を自動更新・自動承認しない。実教材の公開運用・権利審査は別工程。

## 状態と導線

旧 `/app/houki?mode=home|book|sheet|legacy`、theme/question/year/chapter/random/seedを維持。赤シートから参考書へ移動する際、選択問題ID/版、filter、seed、印刷穴のreveal、解説開閉をreturnSheetへ保存する。明示的な「元の赤シートへ戻る」で復元。履歴移動用にも同じ状態を保存。JSONには穴IDだけを保存し答え本文を含めない。

無効returnデータは拒否、問題版が変わった場合はrevealを復元しない。通常の問題変更・filter変更ではreveal/解説を初期化する。採点、SRS、新progressは追加していない。

## 検証

- 全既存suite：60 files / 725 tests PASS。
- 最終関連：20 tests PASS（既存K4-D 9、新規11）。schema、独立審査、参照、循環、private混入拒否、10型SSR順序、HTML escape、共通赤シート、往復状態、loader安全失敗を検証。
- production TypeScript PASS。root型検査は既存K4-B/main.tsx:4のTS2345のみ。元ファイルの開始hash不変、K4-Dでも記録済み。保護対象を修正しない。
- 正式npm run build PASS。元treeを汚さない一時コピーで実施。既存vinext route分類warningあり。
- build出力のK4-A staging ID/本文/見出し及びauthoring参照混入0。詳細production_exclusion_check.json。
- historical 615/486/2161、Priority1 41/22、K3-A〜O・K4-A〜D、H-Final、methodology、外部画像：保護対象1,388ファイルhash一致。package1.1.1維持。
- desktop / 375px / keyboard / VoiceOver：NOT_RUN。ブラウザ制限を迂回しない。SSR・native操作要素・既存mobile CSSは実操作PASSの代替にしない。
- dev HTTPは接続確認できず。起動コマンドは既存5187/PID86185を検出して終了。既存プロセスの停止・復元を行っていない。

## 主な実装ファイル

lib/houki/trainer：lesson schema/types、release validator、lesson loader、return state、tests、既存engineとの共通loader接続。
app/components/houki：LessonPlayer/BlockRenderer/RedSheetPlayer、ResourceBlocks。
app/views/HoukiTrainerView.tsx：JSON表示と参考書往復。
data/houki：架空教材の内部authoring。
scripts/generateHoukiLessons.mjs：検証・版別生成・build前照合。
public/houki/trainer：active.json / lessons-v1.jsonのみ配信。
package.json/lock：生成・build gate・既存Ajv直接依存。

## 残課題・停止

人間によるdesktop/375px、Tab/Shift+Tab/Enter/Space、reveal全操作、filter/random、sheet→book→sheet、reload/back、既存28句resume確認が必要。実法令教材は権利・用途別人間承認後に別版へ投入する。法令調査・教材追加・UI刷新には進まない。

今回の実装・検証をcommitし、push/deployせず停止する。commit hashは最終報告とGit履歴を参照。
