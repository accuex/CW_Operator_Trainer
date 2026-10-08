# ローカル内部レビュー

repository rootで `node docs/1sou_houki/StageK4-F/preview/serve.mjs` を起動し、表示される `/open?token=...` URLを開く。127.0.0.1:5189のみ。既存5187/5188/5179は変更しない。

実教材は `../private/false-alert.authoring.json` に保存し、Git/public/buildから除外する。ファイルを変更したら、このレビューサーバーだけを再起動する。認証済みcookieがない取得は403。固定4経路のみ、別Origin/cross-site/他Host/GET以外を拒否。tokenは起動ごとに生成し、Gitへ保存しない。NODE_ENV=productionでは原本読み込み前に起動を拒否。

本番route/API/navigationに接続しない。bundleはメモリ内だけに生成する。レビュー用DTOは権利・人間審査pending/releaseApproved=falseのまま、validateReviewPreviewで構造を検証する。一般配信用validateReleaseはこのinternal_review editionを拒否する。

これはローカルの人間レビュー専用で、運用中サイトのアカウント権限基盤ではない。OS上の他のローカルプロセス・ファイル所有者を遮断する仕組みではない。リモート公開・proxy転送・公開API接続はしない。
