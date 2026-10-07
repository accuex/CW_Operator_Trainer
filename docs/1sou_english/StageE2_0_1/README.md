# E2.0.1 教材本文編集

確定したE2の101項目に、本文編集だけを適用します。採否・ID・tier・場面・頻度・modality・公式解答の再計算はしません。

- `english_master_E2_baseline.json`: 編集前E2の凍結コピー。
- `tools/editorial.tsv`: 101項目の説明・効用・対比・関連先。
- `tools/examples.tsv`: 修正した42例文と個別確認理由。
- `tools/retained_examples_review.tsv`: 保持した59例文の個別確認理由。
- `tools/apply_editorial.py`: 凍結コピーへ編集を適用。canonical/publicと101項目の台帳・検証結果を生成。
- `tools/check_quality.py`: テンプレート露出・出典参照・canonical/public一致を検査。保存済みprivate E0 unitsを指定すれば文一致を検査。
- `item_review_101.json`: 全件の変更フィールド、意味の確認、例文レビュー、関連先。
- `validation.json`, `quality_checks.json`: 変更件数・関連集中・定型文残存・出典検査。
- `qa/`: テストログ・1440px/375px確認画面。教材イラストではありません。

再生成はrepository rootで `python3 docs/1sou_english/StageE2_0_1/tools/apply_editorial.py`。
E2の旧 `tools/build.py` はE2時点の履歴です。そのまま再実行すると編集前へ戻るため、E2.0.1の再生成には使いません。
既存のcanonical pathとpublic pathを維持し、progress key/schemaVersionは変えていません。

原本PDF・公式解答PDF・private抽出本文は公開コピーへ含めません。レポートと編集入力は既存設定どおりdocs内へ保存しており、現時点ではcommitしていません。
