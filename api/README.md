# CW Operator Trainer API

Slim 4 + MariaDB + JWT. Local-first アプリのログイン同期用バックエンド。

## Endpoints

| Method | Path | Auth | 説明 |
| --- | --- | --- | --- |
| GET | `/api/v1/health` | — | 生存確認 |
| POST | `/api/v1/auth/register` | — | `{ email, password }` |
| POST | `/api/v1/auth/login` | — | `{ email, password }` → JWT |
| POST | `/api/v1/auth/refresh` | — | `{ refreshToken }` |
| POST | `/api/v1/auth/password/forgot` | — | `{ email }` → 再設定メール（存在秘匿） |
| POST | `/api/v1/auth/password/reset` | — | `{ token, password }` |
| POST | `/api/v1/auth/email/confirm` | — | `{ token }` → メール変更確定 + JWT |
| POST | `/api/v1/auth/passkey/login/options` | — | パスキーログイン開始 |
| POST | `/api/v1/auth/passkey/login/verify` | — | パスキー検証 → JWT |
| GET | `/api/v1/me` | Bearer | 自分のプロフィール |
| POST | `/api/v1/me/email/change` | Bearer | `{ newEmail, password }` → 新アドレスへ確認メール |
| GET | `/api/v1/me/passkeys` | Bearer | パスキー一覧 |
| POST | `/api/v1/me/passkeys/options` | Bearer | パスキー登録開始 |
| POST | `/api/v1/me/passkeys/verify` | Bearer | パスキー登録確定 |
| DELETE | `/api/v1/me/passkeys/{id}` | Bearer | パスキー削除 |
| GET | `/api/v1/sync` | Bearer | state。`?answers=1&sessions=1&since=<ms>` でログも |
| PUT | `/api/v1/sync/state` | Bearer | `{ revision?, schemaVersion?, profile, settings }` |
| POST | `/api/v1/sync/answers` | Bearer | `{ items: AnswerLog[] }` upsert |
| POST | `/api/v1/sync/sessions` | Bearer | `{ items: SessionRecord[] }` upsert |

`PUT /sync/state` は `revision` がサーバと一致しないとき **409**（last-write-wins 用）。

## Setup

```bash
cd api
cp .env.example .env
# .env を編集（DB / JWT_SECRET）

composer install

# DB 作成後
mysql -u USER -p DBNAME < sql/schema.sql
# 既存DBへの追加なら:
# mysql -u USER -p DBNAME < sql/schema_passkeys.sql
# mysql -u USER -p DBNAME < sql/schema_auth_mail.sql

# 開発サーバ（document root = public）
php -S 127.0.0.1:8080 -t public
```

パスキーは `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` をフロントの origin に合わせる（local は `localhost`）。
メールは PHPMailer + SMTP（`SMTP_HOST` 必須。本番の sendmail はハングするので使わない）。リンク先は `FRONTEND_URL`。


動作確認:

```bash
curl -s http://127.0.0.1:8080/api/v1/health
```

## Notes

- 進捗本体は `user_blobs` の JSON（正規化しない）
- MariaDB では JSON 列へ `CAST(:x AS JSON)` せず、JSON 文字列をそのまま bind する
- `Config` は `$_ENV` / `$_SERVER` を読む（phpdotenv は `getenv()` に出ないことがある）
- パスワード再設定リンク: `{FRONTEND_URL}/account?reset=TOKEN`
- メール変更確認リンク: `{FRONTEND_URL}/account?emailConfirm=TOKEN`
- answers / sessions はクライアント `id` で idempotent upsert
- ログイン応答に `expiresAt`（unix秒）を含む
- フロントは [`lib/api/client.ts`](../lib/api/client.ts) が期限前／401で `/auth/refresh` を自動実行（並列は1本に集約）
- ログイン中は [`lib/api/cloudSync.ts`](../lib/api/cloudSync.ts) が DB 優先で pull。空クラウドだけ初回に端末データを seed。以後 profile/settings/answers/sessions を push

## Frontend env

ローカルフロントも本番 API を叩く（ローカルで PHP は起動しない）:

```bash
# リポジトリ直下 .env.local
NEXT_PUBLIC_API_BASE_URL=https://cw.conagi.jp
```

ローカル origin から叩く場合、本番 `CORS_ORIGIN` にその origin を含める（例: `https://cw.conagi.jp,http://localhost:3020`）。
