# 承認後の静的release切替

この手順は計画であり、本Stageでは実際の公開release生成・active切替・push・deployを行っていない。

## 現在の状態

- 内部候補：StageK4-L/private/release_candidate_dto.json、contentVersion6、41テーマ/140独自問題/279穴。
- 既存active.jsonと公開sample/H-Final28は不変。
- review validatorで内部構造を検査。release validatorは候補を拒否する。
- candidate本文・証拠・資格情報はignored privateに保存する。
- manifestの完全なdigest、用途/version別review、候補のhashはprivate/release_candidate_registry.exact.jsonに保存。Gitへ公開候補本文を登録しない。

## 人間の判断後

1. 対象候補hash、edition/contentVersion、採用テーマID・用途・versionを明示した人間の承認記録を保存する。承認されなかった項目を残して一括承認しない。
2. 保留を除く場合は依存する問題・穴・block・source・cardとreview/temporalRecordsの参照閉包を再生成し、独立にschemaと内容を照合する。元候補は上書きしない。
3. 独立した承認済みDTOを作成する。editionをapproved_releaseへ変えるだけでは足りない。親・子・各用途/versionの権利と人間承認、承認日時を実際の決定に従って記録する。未承認reviewを捏造しない。確認基準日・施行版・source取得日・編集日・公開日を分ける。承認後の注意表示は今回候補に入れた自作/非原問の説明を使用する。
4. validateReleaseで全参照・version・公開審査・private情報除外を検証する。既存公開versionと衝突する場合は上書きせず新versionを作る。
5. 明示的な正式release切替の指示がある場合のみ、既存生成器の `--activate-reviewed <承認済みDTO>` を実行する。この生成器は人間承認を付与せず、未承認candidateを拒否する。CLI導線の正動作検査は一時ディレクトリの架空test fixtureだけで実施済み。
6. prebuildの `--check`、型検査、関連テスト、正式build、実画面を確認する。静的indexは既存形式のcontentVersionとfileで切り替える。production loaderはvalidateReleaseを継続する。
7. push/deployは別途ユーザーの指示があるまで実施しない。承認済み教材がローカルpublicへ置かれることもこの後段の明示指示に従う。

## 保護と戻し方

公開候補は既存transferでprivate/v6-candidate.backup.jsonへexport済み。資格情報を含めない。restoreは既存ファイルがある宛先を拒否するため、勝手な上書きによる復元を行わない。現在版を別backupへexportし、必要な環境・対象を確認してから既存transfer手順を利用する。K4-K以前の原本は不変。

承認前のdev表示は既存reviewer認証で `/app/houki?mode=book&review=1`。一般のproduction route/loaderは内部DTOを取得しない。権利未確認の原問・公式解答・媒体の投入はこの切替に含めない。
