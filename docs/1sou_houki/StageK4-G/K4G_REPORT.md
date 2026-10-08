# Stage K4-G — 通常dev統合と実教材第1バッチ

判定：**REVIEW**。通常dev統合・教材制作・自動検証はPASS。6テーマの人間による内容・権利・公開レビューは未完了です。公開承認を代行しません。

## 実装

`/app/houki` の同じ参考書・赤シート画面から利用できます。共通LessonPlayer/BlockRenderer/RedSheetPlayer、分野・年度フィルター、seed付きランダム、個別・全表示・全非表示、参考書との往復・returnSheetの状態復元を再利用しました。独自練習には架空の試験年月を付けません。公開サンプル2テーマ・3問、既存28句・25点セットと進捗は維持します。

dev専用Vite middlewareが私有JSONを読み、review schemaで検査してから表示DTOだけを返します。明示的なレビュー用アカウント＋サーバー側のrole判定が必要です。通常PHPの認証にはレビューroleがないため別の端末内認証を採用しました。ログインのみで閲覧できる設計にはしていません。loopback・Host・Origin・Fetch-Siteの確認、4時間期限、HttpOnly/SameSite Strict cookie、ログアウト、試行制限、no-storeを実装。LAN・remote-devは拒否します。

private/docs/authoring/資格情報へのViteファイルサーバー経由アクセスも404。認可前には教材ファイルを読みません。失敗時は本文・根拠・例外内容をエラーやログに出しません。

productionにはmiddlewareが接続されず、review loaderもproductionで拒否します。公開generatorとloaderはinternal_reviewを引き続き拒否。既存サービスワーカーによるレビューAPI保存を防ぎ、古いworkerが残ったdevでの教材取得も拒否します。public/sw.jsの変更はレビュー経路の除外のみです。

開き方・認証・保存／復元は [REVIEW_ACCESS.md](REVIEW_ACCESS.md)。認証済みの通常dev画面を残しました。

## 教材

| テーマ | 根拠・確認範囲 | 独自練習 |
|---|---|---:|
| 誤った遭難警報：通報・取消し・聴守（K4-F） | 運規75条4〜6項、70条の2第1項、確認済み参照号変更 | 4 |
| 磁気羅針儀保護 | 設備規則37条の28：対象・筐体・最小距離 | 3 |
| 周波数等の変更 | 法71条：公益AND支障なし、指定変更／命令、補償・報告 | 3 |
| 船舶局無線従事者証明 | 法48条の2・39・42・77・79、施規34条の11・32条の10。資格AND訓練、認定課程の5年、準用の除外・読替 | 3 |
| 義務航空機局の試験 | 運規9条の2・9条の3、法13条2項。飛行前確認と1000時間ごとの性能試験 | 3 |
| 遭難通信責任者 | 法50・52・13、施規35条の2。OR/AND、資格・証明、代行条件 | 3 |

追加5／既存1、計6テーマ・19問・38穴。保留として投入したテーマは0。unresolved22・queue4・blocked36/54は選びません。K4-Fは原版のまま収録。新5テーマは導入・本文・条件・比較・暗記ポイント・独自設例・正誤理由・出典・未確認事項を持ちます。過去問原文・選択肢・公式解答は転載しません。canonicalとの関連は内部証拠台帳のみです。

机上の法令適合を超えて、実機操作・個別船舶／機種適合・全告示・制度全体を確認済みと説明しません。認定課程の5年条件、1000時間/1回以上、船種ORと国際航海AND、最小距離、準用の第3号除外を別の再照合工程で確認しました。作成者と監査者は同一エージェントであり、独立した人間監査ではありません。

## 公式資料

新たなWeb探索はせず、K3-N等の保存済み一次資料を再利用。基準日2026-10-07。

- 電波法：`325AC0000000131_20260903_508AC0000000027`、施行2026-09-03。
- 施行規則：`325M50080000014_20260730_508M60000008095`、施行2026-07-30。
- 設備規則：`325M50080000018_20260730_508M60000008095`、施行2026-07-30。
- 運用規則：`325M50080000017_20260723_508M60000008090`、施行2026-07-23。
- K4-Fの令和6年総務省令119号公式添付は従来証拠を継承。

e-Gov公式law URLを表示し、内部には元取得日時・revision・hash・JSON pointer・対象Articleを保存。テーマ別の条項、問題・答え・解説、条件scopeの対応を私有台帳に収録。DTOにhash/pointer/原問は含めません。改正時期・理由が未確認のものは断定しません。

## 検証

- 正式 `npm run build`：PASS（prebuildもPASS）。
- production対象TypeScript型検査：PASS。
- 既存suite含む最終テスト：63 files / **740 tests PASS**。
- 法規trainer関連：認証／認可、public拒否、cache拒否、既存player・return-state等を検証。
- reviewer：認証後200。observer：認証成功してもdata403。未認証data401。LAN／cross-origin／偽cookie／production拒否。
- docs・@fsの私有ファイル経路：dev/production404。
- production実サーバーのreview login/data404、SSR200でも私有本文なし。検証用5190は停止。
- 本番出力1213ファイル：実教材ID・資格情報ファイル名の混入0。公開DTO不変。
- review schema：6テーマ全件PASS。public validatorは同じDTOを拒否。
- 保存済み原文hashと条件anchorを再照合。参照・blank・版・ID・審査状態検証PASS。
- 私有パッケージのexport/別ディレクトリへのrestore：hash・版・ID照合PASS、資格情報除外。既存ファイル上書きは禁止。
- root全域の型検査：既存K4-B previewの `unknown → StagingDTO` TS2345のみFAIL。元ファイルhash不変。今回production型検査と区別。

ブラウザでは通常devで認証、6テーマ詳細（各3問／K4-F4問）、desktop1280×900、375×812の長文・比較・赤シート、分野フィルター6問、ランダム、前後移動、Enter/Space、全表示/全非表示、参考書往復時の2/2解答復元、公式リンク一覧、既存28句/25点画面を確認。375pxの長文画面はclientWidth=scrollWidth=375。キャプチャはprivate/review-capturesに保存。全画面・全キー操作・全テーマの375px網羅をしたとは扱いません。VoiceOver実音声：NOT_RUN。音響的CW品質を新たにPASSとは判定しません。

## 保存・保護

private教材・証拠・資格情報・画像・バックアップはGit ignoreを維持し、アクセス権限はprivateディレクトリ700、ファイル600。安全な移送と復元は専用transfer toolと手順書を用意しました。パッケージは平文のため暗号化移送・私有保管が必要です。Git cloneだけでは実教材は復元されません。

開始HEAD `7e0bc4a095bdf25d3ae84fca82a5bdb47849b5d7`、main、working tree clean。外部差分なし。保護対象1428ファイルhash不変。historical615/486/2161、Priority1 41/22、K3各Stage、K4-A〜F、H-Final28、package1.1.1を維持。今回production変更は法規view/review-loader、dev middleware/Vite接続、private追跡防止prebuild、レビューcache除外、transfer tool、関連テストに限定。

## 人間レビューと残課題

6テーマの適用条件・文章の自然さ・独自問題の正誤理由を確認してください。特に資格／証明、認定課程期限、旅客船ORトン数と国際航海AND、通信種別の例外を重点確認。著作権・権利審査・公開承認はpendingのままです。一般公開の判断は別Stageで行います。

LAN/remoteでのレビューは未対応。別端末は安全な私有移送と新たなレビュー資格情報が必要。VoiceOver実音声、全操作のアクセシビリティ網羅、既存K4-Bの型エラーが残ります。

ローカルcommitを行い、push/deploy/一般公開は行わず、このStageで停止します。
