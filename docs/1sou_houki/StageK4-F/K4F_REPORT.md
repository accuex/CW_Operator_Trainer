# Stage K4-F — 実法規1テーマの制作・非公開レビュー

判定 **REVIEW**。実教材1テーマ・独自練習4問・共通LessonPlayerによる認証付きローカルプレビュー・自動検証・ローカルcommitを完了。教材本文の人間レビュー、権利・公開審査、実画面QAが残る。一般公開承認、push、deployは行わない。

## 開始・選定

開始HEAD e5f3dfb986aea697adb815b8dd77271cefef2332、作業ツリーclean。既存変更の破棄・reset・stash・cleanなし。K3-N有効registry、K3-O設計、K4-A候補/出典/改正、K4-B隔離方式、K4-D/E実装を参照。

選定：**誤った遭難警報を送ったとき：通報・取消し・聴守**。queue2 / k1-ae8e50c1da5c36e315c4の確認scopeを再利用する。一般規定とDSC船舶局の条件、送信順序・回数、取消し後の聴守、ただし書の射程、参照号改正を一続きで学べるため。

磁気羅針儀保護は根拠が明確だが、今回の1テーマの参考書としては学習量が小さいため不採用。運規75条参照号変更は別テーマとして増やさず、選定テーマの補助カード1件として利用。unresolvedの告示探索・追加verificationには進まない。

## 実際に学べること

- 無線局に対する一般の通報義務と、DSCで誤警報を送った船舶局の取消しを分けられる。
- 通報先・取消しの通信方法・聴守する周波数の指示対象を取り違えず読める。
- 取消し通報の7事項を順に確認し、3回の事項と1回の事項、発射時刻と協定世界時を区別できる。
- 70条の2本文の通信種別を、ただし書へ無条件に移してはいけない理由を確認できる。
- 古い過去問の参照号と確認版の参照号を混同せず、歴史的正答を現行法へ置換しない。

導入→3動詞→主体の区別→条件→比較→7事項→暗記の整理→通信方法→例外→過去問との関連→独自練習→改正→一次資料のordered blocksで構成。全10型を埋めるための架空追加はしていない。

独自練習4問は、記録係の要約点検、二人の助言比較、送信下書きの回数/時刻点検、例外を拡張した結論の点検という新規場面。実原問を使わず、確認条文の要件から作成。穴ごとの答え表示・全表示/非表示と、正答理由・誤答理由を共通RedSheetPlayerで読める。原問題・選択肢・公式解答の転載0。原問への参照は試験年月・番号・canonical識別に限定し、傾向を得点効果へ一般化しない。

## 根拠・版

保存済みe-Gov公式API：無線局運用規則325M50080000017、revision 325M50080000017_20260723_508M60000008090、施行版2026-07-23、確認基準2026-10-07。75条4〜6項と70条の2第1項の原文JSONを読み、元hashとlocatorを再照合。取得日時2026-10-07T11:10:20.067263+00:00を維持。

令和6年総務省令119号の公式添付新旧対照・附則をK3-N/K4-Aから再利用。保存PDF hashを確認。公布2024-12-27、施行2025-01-01。附則確認scopeを限定し、改正理由・旧規定当初施行日は未確認のまま。元取得日時とmtime由来という取得記録の性質を内部台帳へ維持。

private/source_reuse.json、content_evidence_map.jsonに公式source/旧検証への参照、元hash、7事項の列構造照合、問題と答えを保存。法令の趣旨・改正理由を新たに推測しない。本文の学習上の整理を編集説明として区別する。個別機器操作、周波数の新たな対応表、全遭難制度へ範囲を拡張しない。

## データ・公開境界

内部教材：`private/false-alert.authoring.json`。1テーマ・4独自問題・補助改正1/注意1のみ。実教材JSONと詳細証拠はGit ignoreのprivateに残し、今回のcommitへ含めない。権利・人間公開承認pending、全releaseApproved=false、publishedAt=null。

K4-Eの既存block/schemaを使用。最小拡張は、型で既にnull許容だったsampleYearのschema整合、original_practice provenance/用途、配信不可のinternal_review edition。新しいformula/diagram型は実装しない。

公開側validateReleaseと、隔離レビュー側validateReviewPreviewを分けた。レビュー側もschema・参照・位置・版・条件scope・審査用途を検査し、承認フラグを変更しない。公開生成・production loaderはinternal_reviewを拒否する。既存public active.json/lessons-v1.jsonは開始hash不変。

## プレビュー

`preview/serve.mjs`を手動起動。127.0.0.1:5189だけにbindし、起動ごとのレビューtokenをサーバー側で確認してHttpOnly/SameSite=Strict cookieを発行する。token付き入口は起動ログ/最終報告で共有し、Gitに保存しない。

Host/Origin/Sec-Fetch-Site/HTTP methodを確認。認証済みでも固定経路以外は404。no-store/CSP/frame-ancestors none、原本読込前のproduction環境拒否。本番route/API/navigationにはリンク・importを追加しない。React bundleはメモリ内だけ。schemaの動的コンパイルはサーバー側で済ませ、unsafe-evalを許可しない。本文は検証済みの認証付きreview-dataから取得し、共通LessonPlayerへ渡す。テーマ/版/基準日/未承認/審査待ちを画面に表示する。

ローカル専用fallbackであり、一般サイトのアカウント権限基盤を新設していない。OS上の他ローカルprocessによるファイルアクセスまでは防がない。既存production port5187、K4-B5188、5179は変更しない。

## 検証結果

- 全suite：61 files / 730 tests PASS。
- 最終関連：25 tests PASS。pendingレビューの構造検査、公開拒否、子参照・穴位置・private field、認証・Host/Origin・固定経路・production起動拒否を追加。
- 本番TypeScript・レビューTypeScript：PASS。root全docs型検査に残る既存K4-B TS2345は修正しない。
- 正式npm run build：PASS（一時コピー、prebuild審査/原本DTO照合を含む）。既存vinext route分類warningあり。
- 実教材schema/参照：PASS。保存公式原文の7事項の列を機械照合、source/PDF hash確認、共通LessonPlayerによる実テーマSSR描画PASS。
- レビューHTTP：未認証403、認証入口303、認証済み1テーマ/4問取得200、private直リンク404、cross-origin403。
- production HTTP：review-data、private JSON、公開asset候補、公開API、/@fs経路は全404。内容混入なし。一時的なbuild検査サーバー5190は検証後停止。vinext startはhost指定を尊重せず全interfaceにbindしたため、維持せず終了した。
- production出力698ファイル：実テーマ固有ID/本文/練習問題/authoring pathの混入0。
- 保護対象1,402ファイル：開始hash不変。historical615/486/2161、Priority1 41/22、K3/K4元成果物、H-Final28、methodology、外部画像を保全。package1.1.1不変。
- 実desktop/375px/keyboard/VoiceOver：NOT_RUN。SSR・HTTP・CSSを実画面/実音声PASSの代替にしない。ブラウザ制限を迂回するheadless操作は行わない。

## 人間レビュー項目

1. 主体、DSC条件、通報と取消しの区別が初学者に理解できるか。
2. 7事項の順序・回数、UTC、発射時刻、取消し後の周波数が正確か。
3. ただし書の射程を広げず、教材scopeの外を断定していないか。
4. 独自練習の独立性、問題文の曖昧さ、正答・誤答理由の整合。
5. 出典・改正カード・確認版と現在公開URLの版の違いを誤認しないか。
6. 法令/公式添付の利用条件と教材公開の権利審査。
7. desktop/375pxの読みやすさ、Tab/Enter/Space、個別/全reveal、解説開閉、公式リンク、VoiceOver。
8. 以上と別に、version/用途別の人間公開承認。今回のtechnical検証はその代行ではない。

## 変更・引き継ぎ

本番共通libの型/schema/validatorと関連テストのみ最小拡張。表示コンポーネントはK4-E正本を再利用。3条件にも合うようAND表示だけ「両方必要」から「すべて必要」へ修正（学習ロジック変更なし）。独立レビューentry/serverを本Stageに追加。H-Final/CW/地理/英語の変更なし。

将来formula/diagramはschemaVersionを更新してdiscriminated unionへ追加し、許可された数式・構造化SVGの検証/専用rendererを別Stageで検討する。任意HTML/scriptを許す拡張はしない。今回先行実装なし。

ローカルcommit後、人間の教材レビュー待ちで停止する。実教材JSONはこのworkspaceのprivate保存物であり、他のcloneには自動配布しない。push/deploy/公開/次Stageなし。
