# 学習ログ共有の最小安全性改善（2026-10-10）

## 実装

- 操作トークンを所有者とする既存方式を維持。公開ID・nicknameは操作権限にならない。
- ON/OFFはsettings、名前/アバターはprofileへ分離。ONはGET settingsで取得したrevisionとの比較更新を必須とし、OFFは必ずrevisionを進める。初回ONより先にOFFが届いた場合も非公開の拒否記録を残す。旧クライアントのrevisionなしONは409。
- クライアントはタブ共有の操作識別子を使用し、遅れたON応答が新しいOFFを上書きしない。storageイベントで設定画面を更新。
- OFF失敗はpendingを保持。アプリのonlineイベントで再試行し、成功前は取り下げ完了と表示しない。手動再試行も維持。
- 公開GET/設定GETはIP毎120回/分、投稿・更新は120回/時。OFFは独立した30回/分。集計は原子的なUPSERT。100件上限維持。
- Activityの本文はJSON解析前に8 KiBで制限。Content-Length欠落・偽装でも実本文を確認する。
- GETは期限削除を行わない。書込時に最大1回/時のメンテナンス。30日超のイベント削除、90日未更新の名前・アバター消去と共有OFF。書込がなければ物理削除は次の書込まで遅れるが、30日超ログは常に取得対象外。
- hashed token/public ID/revisionの最小拒否記録は保持する。これを削除すると昔の初回ONが再び有効になるため、個人表示情報とは別に扱う。

## 認証復元の判断

既存発信者には認証済みアカウントとの対応情報がない。nickname/public IDから後付けで取り下げ権限を与えない。ログインユーザーもブラウザデータ消去後の操作復元は未対応。ゲストと共に設定画面で明示。将来対応する場合、トークン所有とログイン認証の両方を確認した事前紐付けが必要。

## 検証

- Vitest: 74ファイル・800テスト PASS。
- PHP ActivityService: 29項目 PASS（SQLiteメモリDB）。OFF後の古いON・初回遅延ON・古いprofile、他所有者、保存期限、read/write/withdraw独立制限を確認。
- 本文制限: 5項目 PASS。過大本文はhandlerに到達しない。
- 正式npm run build: PASS。
- 本番app/libのTypeScript型検査: PASS（内部docs・テストを除外した別設定で実行）。
- 全体TypeScript: 内部K4-B previewと既存kakomonテストの計5診断が残る。当該ファイルは今回変更していない。
- 新規SQL migrationなし・既存schema不変。本番DB、push、deployは未実行。

## 残存事項

MariaDBでの実並行負荷試験・実サーバーのプロキシ/IP制限確認・実ブラウザ操作は未実施。共有IPには共通制限が適用される。自己申告イベントの高度なチート対策は対象外。既存の無関係な未commit差分を保全。
