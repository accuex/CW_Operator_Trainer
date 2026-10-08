# Stage K4-J — 法規Ver.1カバレッジ・第4バッチ

**K4-J制作・dev統合・実施QA：PASS。Ver.1公開判定：REVIEW。** 人間の内容・権利・公開承認はpendingです。公開承認0、push/deployなし。K3-N及び各Stageの元判定は変更していません。

## 何が学べるようになったか

新規9テーマ・独自練習36問・72穴を追加し、累計37テーマ・124問・247穴になりました。各テーマに導入、要点、条件・例外、比較、覚え方、独自練習4問と正答・誤答理由、公式出典があります。

DSC警報に対する船舶局の電話応答を、海岸局のDSC応答と分けて練習できます。DSCと後続電話の六周波数及びVHFの対応、電波型式と単位も比較できます。156.8MHzの医事通報・安全呼出しと27524kHzの用途差、遭難通信に限る使用電波の例外、短波減力のWと％、法人の許可承継と航空機運行者の当然承継・届出を補いました。

| 新規テーマ | 対応queue | 問題 / 穴 |
|---|---|---:|
| 短波帯の船舶無線電話：75W以下への減力 | 27 | 4 / 8 |
| 船舶局の遭難警報への電話応答 | 31,41 | 4 / 8 |
| DSCに引き続く無線電話の電波 | 38,49 | 4 / 8 |
| 遭難・緊急・安全通信のDSC電波 | 38,49 | 4 / 8 |
| DSC六周波数の使用制限と試験例外 | 40 | 4 / 8 |
| その他の無線電話：使用電波と遭難時の例外 | 38,49 | 4 / 8 |
| 156.8MHzと27,524kHzの使用範囲 | 40,57 | 4 / 8 |
| 航空機の運行者変更：承継と届出 | 62 | 4 / 8 |
| 法人・事業の全部承継：大臣許可の条件 | 62 | 4 / 8 |

固定canonical ID・scope・依存・選定理由はK4J_scope.json、全文・位置・hash・原8gate・教材との対応はprivateに保持。別canonicalが同じ現行scopeを共有してもhistorical IDを統合しません。9テーマの範囲を固定後に自動拡張していません。航空19の2、70の2p2/p3、58p5等は、保存全条があるだけでは採用せず今回制作外としました。

## Priority 1カバレッジ

63件すべてを既存のLegalRule・LegalCondition・練習・解説・scopeへ照合しました。タイトルや全条sourceIdの存在だけでcoveredとはしません。判定は教材としての収載範囲であり、法的verified・得点率・試験の全範囲カバレッジではありません。

| verified41内の区分 | 開始時 | 追加後 |
|---|---:|---:|
| covered | 31 | 33 |
| partially_covered | 8 | 6 |
| not_covered | 0 | 0 |
| blocked | 2 | 2 |

unresolved22件はこの41件とは別の母集団で、全件隔離。blockedはverified内のqueue36/54の旧NBDP現行用途です。verifiedを解除したりhistorical証拠を削除した意味ではありません。9テーマ追加でcanonical9件が新たにcoveredとなった、という数え方はしません。

追加後のpartialはqueue27/31/38/41/49/62。58条の用途制限に対応する40/57は、既存の時間制限に今回の用途・例外の練習を加え、確認scopeのcoveredとしました。

残る範囲は、81の8p3の電話応答不受信時のDSC送信、70の2第1項3号の船舶航空機間電波・2/3項の通常通信電波特則、設備41p3/4のITU表依存、20p10の予備免許準用等です。法5/7は許可との接続を扱い、個別事業者の許可可否や全省令基準の適合審査を扱いません。

全63行のbefore/after台帳はprivate/coverage_initial.json・coverage_final.json。対応する旧28テーマの実際のルール・条件・正答・解説・未確認範囲、元status/gate/証拠参照を含みます。安全な集計・残件はcoverage_summary.json。

## 根拠と内容確認

確認基準日2026-10-07 JSTを維持。保存済み公式e-Gov一次資料を再利用し、元の取得日時・hash・revisionを保持しました。電波法2026-09-03施行版、運用規則2026-07-23施行版、設備規則2026-07-30施行版。新規Web探索や法令verification statusの変更はありません。

K3-Kの遭難限定ただし書・位置訂正、K3-Nの有効8gate、K4-Iの74条の2追補を適用しました。古い協力努力義務メモを教材根拠へ採用していません。原問・公式選択肢・公式解答の転載なし。練習のhistoricalRefはnull、provenanceはoriginal_practiceです。

制作とは別担当が36問の主体・数値・AND/OR・例外・正答と誤答理由を保存一次資料と照合しました。同一AI系統の編集確認で、人間の独立監査ではありません。制作中に40の7第1項の除外クラス説明不足を補い、親の章名整形が一つの正答まで置換した事故を発見して修正しました。最終正答は遭難通信のみです。未支持の途中版はfreezeせず、監査履歴に残しています。

## 実装と保存

共通LessonPlayer/RedSheetPlayer、認証、フィルター、seed、戻り状態、progress、schemaを維持しました。変更ソースは3ファイルのみです。

- tooling/houki/dev-review.mjs：serve-only内部教材読込先をJへ。
- scripts/houkiReviewTransfer.mjs：既存transfer対象をJへ。
- scripts/checkHoukiReviewBatch.mjs：旧I28/88/175のdeep equality、固定9テーマ、複数canonical対応、source hash/revision/pointer等を検査。

private/batch1.authoring.jsonは教材版4。互換のため従来ファイル名を維持。themes_rules.py・themes_communications.py・create_batch.pyが制作原本、batch1.evidence.jsonが全文source/位置/hash・scope・元gate・対応証拠、2つのcrosscheckが照合結果です。

復元正本はprivate/batch4-v4-final-frozen.backup.json。authoring/evidence/selectionの3ファイル、hash・schema検査付き、credentials除外。既存transferのrestoreは宛先が存在する場合に拒否し、無断上書きしません。restore実行はNOT_RUN。I旧版とbackupは不変。初期生成backupはdraft-before-frequency-comparisonとして隔離しました。private教材・backup・資格情報・画面証拠はGitへ投入しません。連携コード・安全なscope/集計/報告だけをローカルcommitします。

## QA

- schema/review validator・ID/version/参照・公式hash/revision/MainProvision locator：PASS。
- 旧28テーマ・88問・175穴・既存時計/本文/ID：deep equality PASS。
- 未承認releaseのvalidator拒否：PASS。
- 関連6ファイル43テスト、production対象TypeScript、正式npm run build：PASS。
- root全体の型検査：NOT_RUN。保護docs試作はproduction対象から除外。既存K4-B試作の型問題を修正していません。
- build出力1,213ファイルの全37テーマID/タイトル/edition/privatepath/資格情報検査：混入0。
- desktop1280×900：DSC後電話の本文、条件・例外、六組＋VHF比較を確認。
- mobile375×812：法人承継ノート、航空機承継赤シート。scrollWidth375、横スクロール・文字欠けなし。
- Enter個別表示、Space全表示、全非表示、解説、分野11問・ランダム・次問：PASS。
- 参考書往復で同じ問題/seedと2/2答え・開いた解説を復元：PASS。
- 公式URLと条/施行版/asof表示：PASS。外部リンク先の新たな法令照合はNOT_RUN。
- 周波数テーマのdeep URL reload：PASS。年度は独自問題なのでallのみ。試験年月を捏造しません。
- viewport切替・解除後の戻るclick：今回は未再現。原因は推測せず、navigation修正なし。
- browser console error0。VoiceOver実音声・全テーマ全操作・無関係なCW音響QA：NOT_RUN。

証拠はprivate/tests.log・types.log・build.log・schema_content_results.json・production_exclusion_check.json・review-captures。今回実行したチェックに既知FAIL・新規regressionはありません。未実施をPASSとしません。

## Ver.1評価・次工程

技術と学習操作は実施範囲でPASS。免許/従事者/設備/監督/通常通信/遭難・緊急・安全/航空の確認scopeを学べる限定版Ver.1候補です。一総通法規全体の網羅や合格・得点保証ではありません。unresolved22の設備・指定告示・準用等は現行確定教材へ混入していません。国際法規、Priority2/3、未解決依存は公開完成済みと表示しません。

教材内容の人間レビュー、権利と公開対象の承認はREVIEW。まず37テーマの学習者レビューと専門内容レビューを推奨します。追加制作は、上記残scopeから3〜4テーマ程度を個別に再固定する候補があります。ITU依存・未取得告示の調査は別工程へ分離でき、限定scopeの承認済み教材設計を無期限に止める必要はありません。全63件完全網羅をv1条件とせず、公開範囲・基準日・残範囲が明瞭で、人間承認を受けた対象だけ配信できることを完成条件とします。

## Integrity・停止

開始HEAD ade6258f435e779e80f2320414c67ab4deff74f5、main、clean。保護1,504ファイルhash不変。historical615/486/2161、Priority1 verified41/unresolved22、K3正本・追補、H-Final28、K4-A〜I、公開DTO、package1.1.1、外部画像を保護。CW/RIG/地理/英語/認証/progress変更なし。public追加0・人間公開承認0。

子エージェントはgpt-6.1-sol/lowを明示指定。親の会話設定を変更する操作はしていません。カバレッジ・法令scope・2制作群・別担当照合を分担しました。

ローカルcommit後に停止します。次Stageの実行、push、deploy、一般公開は行いません。
