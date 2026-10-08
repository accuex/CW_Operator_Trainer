# Stage K4-L — 法規Ver.1公開候補の確定

**公開準備Stage：PASS。一般公開：REVIEW（人間承認待ち）。**

公開候補は **41テーマ・140独自練習問題・279穴**、文字だけの注意カード1件・改正カード1件。必要な技術・内容・用途別の権利確認を通過した候補とする。公開承認は0件、`releaseApproved=false`、`publishedAt=null`を維持。本番activeへの登録、push、deploy、一般公開はしていない。

開始HEAD `3ba0622785971093c8a24fe321c4d04520e8c1b2`、main、working tree clean。既存変更の破棄・reset・stash・cleanは行っていない。内容照合と権利確認をgpt-6.1-sol / lowの2担当へ分担し、親が候補生成・差分・統合・QA・判定を担当した。AIの確認を人間の独立監査とは呼ばない。

## 1. 公開対象

テーマ名・ID・版・問題/穴数・公式source参照・分類は `release_candidate_registry.json` に全41件を記録。対象は自作の参考書、法令要件から独立構成した問題/正答・誤答解説、赤シート、公式リンク、確認済み範囲の文字カード。41テーマの教材単位ではrelease_candidate41、needs_revision0、rights_pending0、evidence_pending0。人間の権利/公開承認pendingは別軸であり、この分類のPASSで承認済みとはしない。

このStageで新テーマ・新問題・新blankは追加していない。数値・答え・本文の法的内容・rule/conditionは不変。

Ver.1公開範囲から以下を除外した。

- unresolved22 canonicalの未確認scope。
- 旧NBDPのblocked queue36/54を現行教材の正答とする用途。
- queue27の未完了ITU依存scope（公式RR/表は保存済みだが必要な詳細監査未完了）。
- 原問題全文、公式選択肢/公式解答、PDF、画像、公式図表/添付やITU表の転載。
- 未確認の改正理由等の生成。

これらは「41テーマのうち22件保留」という意味ではない。教材テーマの母集団とcanonical/未確認scopeの母集団を分ける。確認済み部分を扱う既存テーマは、その限定scopeだけを候補にする。Priority1 verified41/unresolved22の法令verification状態は変更しない。

## 2. 内容・正答照合

41テーマ、140問題、279答え、76rule、76condition、432ordered blocks、2カードを読んだ。K4-Kの監査・差分、K3-Kのただし書訂正、K4-Iの74条の2追補を再利用し、104source参照（63の保存済みarticle locator）と新規追補19単位のhash/pointer/本文を再照合した。主体・通信種別・条件・AND/OR/NOT・数値・単位・回数・ただし書・準用・正答一意性と誤答理由を確認。

新しいblocking error、法的本文の訂正、正答変更はいずれも0。通常通信電波の復習まとめについて任意の文章案1件が出たが、現行文に矛盾はなく今回は採用しなかった。新たな法令scopeや告示を調査・補完していない。

候補はedition/contentVersion6。行政的な「人間レビュー未承認」の注意を、法的な未確認事項と区別するため、41noteのunknownsと136問題のrelation説明から既存review metadata・内部bannerへ集約した（177record）。法的unknowns、scope、確認日、原問非転載/独自問題表示は維持。変更したentity/lessonのversionとreview/temporal参照を更新し、同じIDで旧版を上書きしていない。本文blocks・正答/穴・rule/condition・source・card/改正eventは旧版と完全一致。private `candidate_diff.json` に元値・新値・理由、`batch1.evidence.json` に旧証拠chainを保存した。

これにより承認後にも残るべき自作教材/非原問の表示と、内部レビューだけの未承認表示を分離した。承認状態はすべてpendingのまま。

## 3. 法令・一次資料

教材確認基準日 **2026-10-07 JST**、権利/公開条件の確認日2026-10-08。保存済みの取得日時・hash・revisionを維持する。教材の法令判断は基準日施行版に限る。

配信用sourceは104locator、公式リンクは次の5 URLで、104の独立文書を意味しない。

- [電波法](https://laws.e-gov.go.jp/law/325AC0000000131)
- [電波法施行規則](https://laws.e-gov.go.jp/law/325M50080000014)
- [無線局運用規則](https://laws.e-gov.go.jp/law/325M50080000017)
- [無線設備規則](https://laws.e-gov.go.jp/law/325M50080000018)
- [令和6年総務省令第119号の公式改正資料](https://public-comment.e-gov.go.jp/pcm/download?seqNo=0000285095)

法令ページのリンク先は最新表示となることがあり、教材に表示する確認revision・施行日・基準日と区別する。全制度や将来の改正を確認済みとは表示しない。改正カードは第3号→第2号、公布/施行日の保存済み証拠に限り、理由は未確認。

## 4. 権利・出典表示

詳細は `rights_review.md`。e-Gov利用規約、デジタル庁PDL1.0、著作権法13条を公式資料で確認した。短い法令語句/条項参照と、自作の想定発言・強調を区別した。括弧入り51record・87span、split-tokenの括弧3件を確認。第三者の解説や全文の引用、配信図版は確認されなかった。括弧の存在だけでrights_pendingとはしない。法令が権利の目的とならない規定を、私的試験問題や第三者図版へ拡張しない。

日本無線協会の現在の案内には英語以外の公開過去問に条件付き無償利用の記載があり、K4-Aの記録との差を独立追補に保存した。今回は原問・公式解答を採用しないため、その許諾範囲を全コーパスへ一般化しない。外部への問い合わせ・申請はしていない。

LessonPlayerの確認範囲に公式資料出典・CWOT編集・政府作成教材ではないことを表示する。「法令本文の引用ではありません」という一律の旧文言は置き換えた。原文は各出典リンク、教材は独自編集であると読み分けられる。架空サンプルは架空であると別表示する。APIのlive取得は新設していないため、API固有の運用条件未確認を今回のリンク/保存済み要件教材の一律保留理由にしない。

## 5. release候補と実装

内部 `private/release_candidate_dto.json` は既存review schemaの直接入力となるDTO。トップレベルallowlist射影によりauthoring証拠を配信構造へコピーしない。strict schemaと既存validatorでprivate field・不正参照・混在承認・日時・versionを拒否する。source hash/pointer/exact range/原問全文/資格情報は含まない。

候補のContentReviewは全用途/versionでpending、publicReviews1,200単位は未承認。source/blank/blockの承認を親themeの承認だけから推定しない。候補のexact digestと依存versionは内部台帳に固定した。

今回のコード変更：

- 内部候補のallowlist生成関数・型、ignored private宛先だけに書くCLI、候補checker。
- 既存生成器に承認済みDTOの明示切替導線を追加。validateReleaseを通すだけで、承認フィールドを付与/変換しない。
- prebuild checkを既存active版の検証へ対応させ、将来の承認済み静的releaseがsample原本との比較だけで拒否されないようにした。sample版は従来どおり原本一致を検査する。公開版のsampleへの暗黙置換は拒否する。
- devレビューと既存transferの参照版をK4-Lへ変更。認証やAPI方式は変更していない。
- LessonPlayerの出典/加工表示だけを変更。

承認後に同じproduction loaderと共通playerで読める。今回は本番active/公開JSONに接続しない。一般の本番画面は既存教材だけを表示する。

## 6. QA

| 項目 | 結果 |
|---|---|
|candidate schema・ID/version/参照・旧版差分|PASS|
|未承認candidateの本番loader/validator拒否|PASS|
|private nested field・混在承認・公開日時・欠損参照の拒否|PASS|
|承認済み静的切替・旧版上書き防止・sampleへの暗黙downgrade拒否|PASS（一時directoryの架空test fixtureのみ）|
|関連/既存法規回帰test|7ファイル48テストPASS|
|production TypeScript|PASS|
|正式npm run build|PASS|
|本番成果物の未承認本文/ID/credentials混入検査|1,213ファイル、検出0|
|保護対象hash|1,619ファイル検査。予定したLessonPlayer変更以外は不変|
|active・公開DTO・H-Final28・既存原本・package1.1.1|不変|

ブラウザ：desktop1280×900で磁気羅針儀テーマの本文・問題・出典/編集表示、mobile375×812で誤警報テーマの改正前後・確認問題・赤シートを実表示した。横overflowなし。Enter個別表示、Space全表示、全非表示、解説、問題→参考書→元の赤シートの表示/解説状態復元を確認。console errorなし。既存担当者で再認証しただけで、資格情報/権限は変更していない。

実VoiceOver音声、全41テーマ全ブラウザ操作、CW音響品質、旧試作を含むroot型検査、正式本番release切替/deployはNOT_RUN。閲覧画像のAI確認と、人間の教材公開レビューは別。スクリーンショットと操作記録はprivateへ保存。

## 7. 人間に必要な判断

1. 固定manifestの **41テーマ・140独自問題・279穴・注意1/改正1** を、2026-10-07確認版の限定scope教材として公開するか。保留するテーマがあればIDで指定する。
2. **自作編集物としての採用・名義、公式出典とCWOT加工表示、原問/公式解答/図版の除外**を承認するか。

「全件専門家校閲してください」という要件にはしない。AI照合の限界と未確認scopeを明示した限定版の判断を求める。承認は台帳の対象version/用途へ記録し、対象外scopeや権利資料を自動承認しない。

## 8. 保存・切替・停止

候補本文・証拠・完全digest台帳・画像・資格情報はprivate。Gitへはコード/テストと安全な一覧/報告だけを追加。K4-K以前の元成果物は不変。既存transferで `private/v6-candidate.backup.json` にexport済み。restoreは既存宛先を上書きしない。

人間承認後の独立DTO作成、個別review記録、validateRelease、明示的な静的JSON切替、build/QAの手順は `release_activation_plan.md`。現在の `active.json` は不変。

ローカルcommit hashはprivate `completion.json` と完了報告に記録する。push・deploy・一般公開なし。次Stageへ自動進行せず、人間判断待ちで停止する。
