# Stage K4-D 法規トレーナー本実装

判定 **REVIEW**。本番コードへの統合、学習フロー実装、実施した型検査・テスト・build・commitは完了。ブラウザの安全制限により実画面の操作・375px・VoiceOverが未実施で、人間の最終QAが残る。未実施項目をPASSとしない。

## 開始状態・保全
開始HEAD c04a0bdf24d72d4b4e62d86221561c6467245496、clean、未commit変更0。他作業差分の破棄・復元・stashは行っていない。historical615/486/2161、Priority1 41/22、K3-A〜O・K4-A/B/C、K3-K、H-Final28、methodologyを開始hashで照合し不変。package1.1.1不変。今回のproduction変更は許可範囲として明示した。

## 利用方法
ローカル開発サーバー5187を起動済み。一総通→法規、又は http://127.0.0.1:5187/app/houki 。5188の内部プレビューとは別。5179には触れない。push・本番デプロイなし。

- 「参考書で学ぶ」→架空の章→テーマ→確認問題→答え表示→解説→対応する参考書。
- 「赤シートで特訓」→作成年・分野→順番又はランダム→各穴又は全表示／全非表示→前後。
- 「既存28句・25点セット」から従来の確認済み法規画面へ。旧progress・途中セットは従来のloader/schemaを使用し変更しない。
- 深いURL例：`/app/houki?mode=book&theme=sample-delivery`、`/app/houki?mode=sheet&question=sample-question-3`、`/app/houki?mode=legacy`。URL選択・popstate・戻る導線を実装。deep URLのHTTP200及び状態roundtripを検証、ブラウザでのreload/backは未実施。

## 実装済み機能
学習トップの2入口、章・テーマ一覧、要点・主体・条件・例外・手順、確認問題・解説、改正／注意カード、詳細に折り畳んだ出典・scope・unknownを実装。

赤シートは1問単位、印刷position単位のreveal/hide、全操作、前後、年度/分野filter、空の結果、ランダム（seedで安定）、問題と参考書の相互リンク。問題変更で表示状態と解説を初期化。サンプルの年は作成年であり試験年月・問題番号は対象外と表示。採点・SRS・新progressは実装していない。

公開datasetは架空2章・2テーマ・3問・変更カード1・注意カード1のみ。郵便屋さん・図書室の独立した架空ルールで、実法規の事実・実試験問題に見せない。615問等を利用可能件数に含めない。実法令章は未投入と明示。

## データ・公開境界
`lib/houki/trainer/types.ts`でHistoricalQuestion/Canonical/Blank、LearningNote、LegalRule/Condition、AmendmentEvent、TriviaCard、LegalSource、ContentReviewを別型として定義。歴史registryはサンプルでは空。id/version/用途別reviewの照合、参照・印刷穴の一致、不正private情報、verifiedのみの昇格を拒否する。

入力assetは `public/houki/trainer/original-samples-v1.json` のみ。K4-A実ノート2・実改正カード1、原問615・公式解答は未投入。K4-A technical承認を人間承認へ変更しない。実法令教材の公開承認0・release生成0を維持。既存H-Final公開masterは変更しない。

## 変更ファイル
- app/CWTrainer.tsx：法規lazy viewを新wrapperへ接続。
- app/globals.css、app/styles/views/houki-trainer.css：限定stylesheet。
- app/views/HoukiTrainerView.tsx：本番2モード・既存画面への入口。
- lib/houki/trainer/types.ts、engine.ts、trainer.test.ts：型・loader・filter/URL/reveal/review検証・test。
- public/houki/trainer/original-samples-v1.json：オリジナル架空サンプル。
- vitest.config.ts：本番コンポーネントの既存@/alias解決。

QSO/Rig/英語/地理のソースは変更していない。

## 検証結果
- production型検査PASS（production_tsconfig.jsonはdocs試作を除外、root正本は不変）。
- 全ファイル型検査は既存FAIL：K4-B/main.tsxのunknown→StagingDTO TS2345。開始HEADコピーと保護対象の同じpreviewで再現。新規エラーではなく、保護対象なので修正していない。
- 関連22 tests PASS（新規9、既存法規8、route2、教材導線3）。
- 全既存suite 59files/714tests PASS。歴史registry最終追加後は変更範囲の関連22件を再実行PASS。詳細test_results.json。
- 最終production build PASS。一時コピーで正式vinext buildし、元treeの生成物は触らない。既存route分類warningあり。
- 出力697ファイルscan：K4-A/BのID・見出し・本文・stage参照混入0。app/lib/publicからstaging参照0。unapproved_content_isolation.json。
- diff whitespace check PASS。
- 実browser操作・375pxキャプチャ・keyboard実操作・VoiceOverはNOT_RUN。以前の拒否を迂回せずheadlessも使わない。native button/summary、aria-expanded/live、focus-visible、mobile1列CSSを実装したが、実操作PASSを主張しない。

## Commit・残課題
実装commit：`31d84c143f34ad791c60e1045cef68ec4a48d8ef` — feat: add law trainer reference and red-sheet modes。9ファイルのみ。

検証報告は別のdocs commitに含める。push/deployなし。

次の必要作業は人間によるdesktop/375px・Tab/Shift+Tab・Enter/Space・全表示/非表示・filter/random・deep reload/back・既存resume確認。実教材投入には別の権利・用途別公開審査と人間承認が必要。実法令の内容を追加せず、本Stageはここで停止する。
