# K4-G 内部レビューの開き方

通常dev（5187）の `/app/houki` にある「内部教材レビュー（担当者認証）」を開きます。

- URL：`http://127.0.0.1:5187/__houki-review/login`
- 担当者：`reviewer`
- パスワード：この端末の `private/review-accounts.json` の reviewer レコードを参照。
- 認証後：`/app/houki?review=1`。参考書6テーマ・独自練習19問。
- 「レビューを終了・通常教材へ」でセッションを失効し、架空サンプルに戻ります。

一般のCWOTログインとは別の、端末内レビュー用の認証です。既存PHP認証には教材レビュー権限がないため、通常ユーザーをレビュー担当者とみなしません。observerは認証できても教材取得は403です。サーバーが担当者・権限・有効期限を確認します。4時間で失効し、dev再起動時にもセッションは失効します。資格情報は端末内の非追跡ファイルにのみ保存します。

閲覧はloopbackに限定します。LANのIP、リバースプロキシ、別PCでのレビューは開放していません。別環境では下記の私有パッケージを安全に移し、その端末でdevとレビュー用アカウントを初期化してください。

古いサービスワーカーがブラウザを制御している場合は、内部教材の取得を拒否します。サービスワーカーのないブラウザで開いてください。通常教材のオフライン保存・学習記録は削除しません。

## 教材の保存と復元

正本は `private/batch1.authoring.json`、証拠は `private/batch1.evidence.json`。教材版 `k4g-internal-batch1` / contentVersion 1、6つの stable lesson ID を持ちます。K4-F元ファイルは変更していません。

今回の最終バックアップ：`private/batch1-v1-frozen.backup.json`。以前の draft backup は最終版ではありません。パッケージには教材・証拠・選定記録、各ファイルhash、教材版・ID一覧を収録します。資格情報・セッションは収録しません。

バックアップ作成：

```sh
node scripts/houkiReviewTransfer.mjs export /absolute/private/new-package.json
```

移送は管理者が承認した暗号化経路で行います。Git・public・通常Web配信・平文の公開リンクは使用しません。パッケージ自体は暗号化されていないため、私有保管先とアクセス制限が必要です。このStageでは外部移送を行っていません。

別cloneでは `docs/1sou_houki/StageK4-G/private` を作り、そこがGit ignoreされることを確認してから復元します。

```sh
node scripts/houkiReviewTransfer.mjs restore /absolute/private/received-package.json
```

hash・schema・版・ID・未承認状態を検査します。既存ファイルが1つでもある場合は上書きせず拒否します。新端末の資格情報はdev初回起動時に生成されます。再監査には参照元のK3/K4-F private資料も別途私有移送する必要があります（このパッケージは原PDF全体を収録しません）。

通常prebuildで法規private証拠・レビュー資格情報のGit追跡を拒否します。原本・実教材・証拠・資格情報・バックアップ・キャプチャは今回Git非追跡です。
