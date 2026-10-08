# Stage K4-K — 法規Ver.1仕上げ

実装・制作・検証のStage判定は **PASS**。限定範囲のVer.1内部完成候補とする。一般公開については **REVIEW**。人間の権利審査・公開承認は未実施であり、承認数は0。push・deploy・一般公開は行っていない。

法令確認基準日は2026-10-07 JST。開始HEADは `f69d31e79d6ae449492b447dd3ccc5b403b80a46`、main、作業ツリーclean。既存差分の破棄・復元は行っていない。親のモデル設定を変更せず、独立した不足scope・内容照合・受験者目線の監査をgpt-6.1-sol / lowの3担当へ分担した。AIの照合を人間による監査とは扱わない。

## 1. partial6件と追加教材

| queue | 処理結果 | 補完・残存scope |
|---|---|---|
|27|partial継続|設備41条3・4項のITU表。公式RR PDF・AP18画像と以前の依存PASS記録は保存済みだが、本Stageで個別channel・列注記・2030境界の詳細な独立照合を完了していない。未取得資料だとは扱わない。|
|31|covered|運81条の8第3項の電話応答が受信されなかった場合。第2項の前提を含めたDSC送信。|
|38|covered|運70条の2第1項第3号、第2・3項。遭難通信限定のただし書、通常通信電波、通信方式・準用条件。|
|41|covered|電話応答不受信時のDSC送信を補完。|
|49|covered|70条の2の通常通信特則と船舶・航空機間通信の限定scopeを補完。|
|62|covered|法20条10項の予備免許への準用と第8項等の関係を補完。個別許可基準・放送関連手続の全面解説は対象外。|

coveredは確認済みの教材scopeを扱うという意味であり、制度全体・全条文の網羅や得点率ではない。canonicalの法令verification statusは変更していない。

| 新規テーマ | 主な対応queue | 独自問題 | 穴 |
|---|---|---:|---:|
|船舶局の電話応答が受信されなかった場合|31・41|3|6|
|医事通報・緊急再送・安全通報の通常通信電波|38・49|5|10|
|予備免許を受けた者への承継規定の準用|62|4|8|
|船舶航空機間双方向無線電話の使用電波|38・49|4|8|
|追加計||16|32|

累計は **41テーマ・140問・279穴**。原問・公式選択肢の転載ではなく、法令要件から独自に構成した練習問題。通信種別・主体・例外・順序を比較し、本文から問題へ進める。新規4テーマの対応canonical・必要依存・限定scopeは `K4K_scope.json` に固定した。

## 2. 既存37テーマ・124問の監査

全37テーマの本文・条件、全124問の問題・正答・解説を保存済み一次資料と照合した。94件の保存済みsource参照hash、92件の埋込条文node、G/H/I/J証拠chainを確認。元版は保持した。

局所訂正は6件。正答変更は0、旧247穴のID・answerはすべて維持した。

- 運45条3項の告示事項に「時期」を含めていた説明を訂正。第1項の運用時期指定と第3項の告示事項を分離。
- 承継条件カードで、後続の届出義務を成立条件のANDへ混在させないよう訂正。
- 発射停止・試験・停止解除を段階ごとに区別し、すべてを先行条件とする表現を訂正。
- 海岸局DSC応答の条件カードで、特定帯域の待機規定を全応答義務の成立条件にしないよう訂正。
- 通常呼出しの問題に「通常の呼出し・ただし書のケースではない」という前提を補い、終了後の処理の正答を一意化。
- 機器の試験又は調整に関する問題で、省略されていた目的語を補完。

ほかに3か所の本文→確認問題の説明橋渡し（周波数変更の補償訴訟、証明書の準用・読替、遭難通信責任者の病気時の代行）を追加。長い導入目標1件を短く整理した。旧問題文の補足は2件で、正答は変えていない。差分対象は関連lesson・note・condition・question・reviewを含む22entity。内訳と元値・修正版はprivateの `new_old_diff.json` と `content_revision_log.json` に保存した。

新規教材の独立照合では、船舶・航空機間の規定に運58条5項の適用対象条件が必要と判明した。捜索救助用航空機の航空機局等という主体・目的を追加し、単なる船舶と任意の航空機の通信へ一般化しない説明へ訂正した。第70条の2第1項ただし書の例外は遭難通信だけに限定した。

## 3. 一次資料と版

保存済み公式e-Gov資料の取得日時・hashを維持した。基準日後の施行版を使用していない。

- 電波法：`325AC0000000131_20260903_508AC0000000027`、施行2026-09-03。
- 無線局運用規則：`325M50080000017_20260723_508M60000008090`、施行2026-07-23。
- 新規限定scopeの19単位について、hash・revision・JSON pointer・条項・本文を機械照合。

詳細原文、exact source span、hash、原問分析はprivateに保持した。K3-Kのただし書位置・条件訂正、K4-Iの法74条の2追補を適用し、K3-I旧メモを無条件に根拠としていない。新規教材の確認はcanonical全体の再verificationや公開承認ではない。

## 4. 学習構成

既存章を利用し、免許→従事者→設備→運用→遭難・非常→誤警報→航空→監督の順に整理。追補テーマは関係する既存テーマの後に配置した。長文explanationの改行を表示で保持する最小CSS修正を行った。

LessonPlayer・RedSheetPlayer、既存URL、filter、seed、returnSheet、進捗、reviewer認証を維持した。新しい採点・SRS・ランキング・認証基盤は追加していない。

## 5. カバレッジとVer.1

verified41件の教材区分は、covered33→38、partial6→1、not_covered0、blocked2。別にunresolved22件が残る。blocked queue36/54の旧NBDP範囲を現行教材として使用していない。

Ver.1候補は、確認済みで独立して説明できる41テーマの限定範囲。63 canonicalの完全網羅・得点率・合格保証を意味しない。unresolved22件、queue27未完了scope、旧NBDP blocked範囲は完成済みの現行教材に含めない。

| 評価軸 | 判定 |
|---|---|
|技術的完成度|PASS（実施した検証範囲）|
|学習体験|代表画面・操作PASS、全件の人間レビュー待ち|
|確認済みscope|covered38、partial1、blocked2、unresolved22別管理|
|内容根拠|保存済み公式資料との限定scope照合済み。未確認範囲は隔離|
|権利・利用条件|用途別公開候補を整理。最終審査pending|
|人間公開承認|未承認、0件|

## 6. 権利と公開候補

[e-Gov利用規約](https://www.e-gov.go.jp/terms) と [公共データ利用規約第1.0版](https://www.digital.go.jp/resources/open_data/public_data_license_v1.0) を確認した。適用される資料では出典・編集者の表示が必要で、別利用条件・第三者権利・APIの条件は個別確認を要する。公開されているだけで転載可とは判定しない。

自作解説・独自練習問題・公式リンクは内部公開候補としたが、人間の用途別権利審査・公開承認はpending。短い法令引用、改正カード、公式図表・添付は個別審査を要する。原問・公式選択肢・公式解答は公開候補から除外した。資料不整合や検証上の訂正を法令改正の豆知識へ混入させない。

`rights_release_candidates.json` は用途別判断、privateの `release_candidate_registry.json` は41lesson・140独自問題のversion別内部台帳。release DTOではない。全件 `releaseApproved=false`、`publishedAt=null`、人間承認pending。approved_candidateを公開承認へ昇格させていない。

## 7. QA

| 検査 | 結果 |
|---|---|
|schema・review validator・ID/version/参照|PASS|
|未承認release validator拒否|PASS|
|旧37テーマ保持、124問・247穴の正答/ID|PASS（本文は記録済み局所編集あり）|
|19単位の公式hash/revision/locator|PASS|
|法規関連unit tests|6ファイル43テストPASS|
|production TypeScript|PASS|
|正式npm run build|PASS|
|本番出力private本文/ID/credential検査|1,213ファイル、41テーマID/タイトル等、検出0|
|保護対象hash|1,539ファイル、不変|
|公開DTO・H-Final28・package1.1.1|不変|

ブラウザ：desktop1280×900、mobile375×812を実表示してキャプチャを確認。横overflowなし、本文改行・比較表示・公式リンク・章一覧を確認。Enterで個別表示、Spaceで全表示、全非表示、解説展開、参考書往復の穴/解説状態復元、分野filter、random seed維持、深いURLをspot check。console errorなし。viewport変更後の戻るclick不発は未再現。原因推定や無関係なnavigation修正は行っていない。

実VoiceOver音声、全41テーマ全操作、CW音響品質、全プロジェクトroot型検査、復元による実上書き、queue27 ITU表の新規詳細監査はNOT_RUN。AX/自動テストを人間の読み上げPASSとして扱わない。

画像・操作記録はprivateの `review-captures/`、`browser_test_results.json`。test/build/typeログ、source照合・保護hash・本番混入検査もprivateに保存した。

## 8. 隔離・保存・commit

今回の本番コード変更は4ファイルのみ：開発レビューと既存transferの入力版をK4-Kへ切替、関連検証器を新版へ更新、説明段落の改行保持CSS。既存CW・RIG・英語・地理のロジック、progress、認証、公開DTOには触れていない。

教材本文・証拠・資格情報はignored private領域。Gitへは4コードファイルと本文を含まないK4-K報告・集計だけを追加する。devの `/app/houki?mode=book&review=1` で既存reviewer認証を通して閲覧できる。本番loaderは接続せず、本番出力の混入0を確認した。

旧K4-G/H/I/J教材は変更せず保存。新版はprivate `v5-final-frozen.backup.json` に既存transfer方式でexport済み。復元は同じ版の `scripts/houkiReviewTransfer.mjs restore` を用い、実行前に現在版をexportし、対象・hashを確認する。今回は保護のため復元実上書きは行っていない。資格情報はtransferに含めない。

ローカルcommit hash・最終作業ツリーはprivate `completion.json` に記録する。push・deployはしない。

## 9. 残課題・次工程

1. devで限定Ver.1候補の本文・問題・読みやすさを人間レビューする。
2. 自作解説・独自問題・引用・改正カードを用途/version別に権利審査し、承認対象を明示する。
3. 承認がある範囲だけ、別指示でrelease生成・公開へ進める。
4. queue27は保存済み公式RR/表を独立工程で詳細監査する。
5. unresolved22件の調査は、独立した確認済み教材の審査とは分離して継続できる。

このStageはローカルcommitまでで停止する。次工程を自動実行しない。
