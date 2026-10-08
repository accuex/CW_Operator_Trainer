# Stage K4-M — 法規Ver.1正式release

公開承認はプロジェクトオーナーの本Stage指示に基づく。K4-L候補版6のみを対象とする。

- 候補digest: `299eefc848e8f35f3fee12d0cfda9a0e4d4f9d445d93d62d57ec50f0bde332e4`。
- release: `cwot-houki-v1`、contentVersion6、41テーマ・140独自問題・279穴・注意/改正カード各1件。
- 法令確認基準日2026-10-07。旧原問・公式正答・未確認scope・unresolved22・旧NBDP blocked・未完了ITU依存は配信しない。
- 実際に承認指示を確認した時刻をapprovalObservedAtとして記録。ユーザー投稿時刻は取得できないため推測しない。対象ID/version/用途1200件をprivate承認記録と公開に必要な最小reviewで対応付ける。
- 候補の本文・問題・解答・法令scope・source・カードは変更していない。承認metadata/editionのみ正式化。公開日時はdeploy成功を観測して別記録する。DTOのnull publishedAtを事前に推測時刻で埋めない。
- 既存allowlist候補から正式DTOを作成し、既存validateReleaseを全件適用。validator及び承認条件を緩和していない。active.jsonをv6へ明示切替。v1架空サンプルは旧版として保持し、現行教材に混在させない。
- 通常画面の未投入説明を修正し、限定範囲・独自編集・非公式教材・原問転載でない旨・公式リンクの現在版との差を表示。
- TypeScript/build/65ファイル748テストPASS。desktop1280×900、mobile375×812で本文・出典・Enter/Space・個別/全表示・全非表示・解説・参考書往復と表示状態復元・分野/seedランダムを確認。mobile幅375/scrollWidth375。実VoiceOver及び音響品質はNOT_RUN。
- historical/K3〜K4-L/H-Final28/progress/CW/RIG/地理/英語/package1.1.1をhashで保全。production1214ファイルにレビューcredential実値混入0。公開DTOにprivate evidence/hash/pointer/rangeや原問は含めない。
- 既存deploy.shにGit追跡ファイルの転送allowlistとprivate/docs/build/cache除外を追加。非secretの既存PM2/hosting設定のみ明示追加。docs・証拠・資格情報・ローカル成果物を転送しない。既存PM2/npm build方式を維持。
- 本番成果物のrollbackコピーをdeploy前に非公開ディレクトリへ保存。deploy失敗時はコピーしたdistを戻して既存PM2をreloadする。旧教材static配信もsnapshotから回復可能。ユーザー教材原本は変更・削除しない。

公開確認・commit/push/deploy結果はdeployment_results.jsonに記録する。更新は新versionの編集・根拠照合・用途別公開承認・validateRelease・新release/active切替を経る。今回承認を将来版に流用しない。
