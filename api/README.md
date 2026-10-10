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
NEXT_PUBLIC_API_BASE_URL=https://cwot.jp
```

ローカル origin から叩く場合、本番 `CORS_ORIGIN` にその origin を含める（例: `https://cwot.jp,http://localhost:3020`）。

### 本番ドメイン

公開先は `https://cwot.jp`。本番の環境設定は次を使用します。

```dotenv
CORS_ORIGIN=https://cwot.jp,http://localhost:3020
WEBAUTHN_RP_ID=cwot.jp
WEBAUTHN_ORIGIN=https://cwot.jp
FRONTEND_URL=https://cwot.jp
```

`NEXT_PUBLIC_API_BASE_URL` と `SITE_URL` も `https://cwot.jp` に合わせて再ビルドしてください。旧ドメインで登録したパスキーは新しいRP IDでは使えないため、別のログイン手段で入り、新ドメインで登録し直します。ブラウザ内の学習記録もドメインごとに保存され、移行時に自動では引き継がれません。

## Opt-in academy activity feed

追加migration: `sql/schema_activity.sql`。既存DBへ適用した後、更新されたAPIを配置する。
本機能の実装時点では本番migration/deployは未実施。従来の同期テーブルは変更しない。

- `GET /api/v1/activity`: 共有中の直近30日・最新100件を取得（未ログインでも閲覧可）。
- `GET /api/v1/activity/settings`: token所有者の共有状態とrevisionを取得。
- `PUT /api/v1/activity/settings`: `{ sharing: boolean, nickname: string, avatarId: string|null, revision?: number }`。ONには直前に取得したrevisionが必須。OFFは版に関係なく優先し、revisionを進める。旧クライアントの版なしONは409。
- `PUT /api/v1/activity/profile`: `{ nickname: string, avatarId: string|null }`。名前・アバターだけを更新し、共有を有効化しない。
- `POST /api/v1/activity/events`: `{ kind: "started"|"achievement", detail: 許可されたID }`。
- 書き込みは端末専用のランダム256bit tokenを `Authorization: Bearer` で提示。ログインJWTとは別物。
  サーバーはSHA256 digestだけを保存し、公開IDとtokenを分離する。tokenはプロフィール同期・エクスポートに入れない。
- 共有は初期オフ。オフで当人の掲載イベントを削除し、公開名・アバターを消去する。
  同期profileやメール・回答内容・正答率を参照しない。共有設定はブラウザ専用。
- 学習開始は対象画面へ移動したとき（30分に1件）。達成は新しく解放されたアチーブIDのみ。
  過去の達成をさかのぼって投稿しない。イベントは自己申告であり技能認定ではない。
- IPの時間別digestを用いて書込み120回/時を制限。生IPはこのテーブルに保存しない。
  読み込みキャッシュは `no-store`。ブラウザの保存データを消すと取り下げtokenも失われる。
- 開発フロントでは端末内のログだけを表示する。本番へ試験投稿しない。
- API照合用allowlistは `data/activity-catalog.json`。フロントのavatar/achievement/subjectとの一致をテストで検証。

検証: `php api/tests/activity.php`（SQLiteインメモリ、実DBや本番利用者へ影響なし）。
本番MariaDBでのmigration・複数利用者の結合確認はdeploy時に別途行う。

## Combined source/API/database deployment

`bin/deploy.sh` transfers tracked files **and nonignored new files**. `.env`, vendor,
private evidence and credentials stay excluded. Only the existing narrowly listed
past-paper build inputs are retained as private runtime exceptions. Server-only
files are not deleted by this transfer.

```bash
# Offline transfer list (no SSH)
./bin/deploy.sh --list-files
# Preview transfers; never executes build, composer or migration
./bin/deploy.sh --dry-run --with-build --with-db
# Transfer app/API, install API dependencies, build, migrate, then reload
./bin/deploy.sh --with-build --with-db
```

`DEPLOY_API_PATH` defaults to `$DEPLOY_PATH/api`. If the web server serves PHP from
another directory, set this to that **existing API root** (the directory containing
`public/`, `src/`, `vendor/`, `.env`). Its existing server `.env` is required for DB
migration; local `.env` files are never uploaded. `DEPLOY_PHP` and
`DEPLOY_COMPOSER` can specify executable paths.

The DB step uses `api/bin/migrate.php` and `cwot_schema_migrations` with SHA256 and
an advisory lock. Registered order: base → passkeys → auth-mail → activity.
Previously manually created tables are retained with `CREATE TABLE IF NOT EXISTS`;
this does not assert that an independently modified existing table has the expected
columns. Applied SQL cannot be edited silently: add a new explicitly registered
migration instead. Unregistered SQL files stop the runner. The current runner
supports only the additive initial CREATE TABLE migrations, not arbitrary ALTER,
stored routines or destructive data patches.

MariaDB DDL auto-commits. A partial failure may leave newly created tables, but
no applied-history entry is written for the incomplete file. Re-running these
idempotent initial migrations resumes safely. DB backup/restore remains the server
operator's responsibility; no automatic data rollback is claimed. Migration failure
stops before PM2 reload. File synchronization occurs before migration, so this is
not an atomic zero-downtime deployment.

Offline checks:

```bash
python3 scripts/deployManifest.test.py
php api/tests/migrations.php
```

Production deployment and real MariaDB migration have not been performed as part
of this script change.

### Activity safety and retention

- GET/settings reads: 120 requests per IP per minute; writes: 120 per IP per hour.
- OFF has a separate 30/minute budget so exhausted posting limits do not block withdrawal.
- Activity request bodies are capped at 8 KiB before JSON parsing, including missing/false Content-Length.
- OFF removes the owner's events and displayed name/avatar; failed requests stay pending and retry on `online`.
- Public feed is read-only, latest 100 within 30 days. Stored expired events are cleaned at most once an hour on writes.
- After 90 days without updates, publisher name/avatar are erased and sharing is disabled. Non-public hashed-token/public-ID/revision tombstones remain to reject delayed consent requests; these are not account profiles. Cleanup is opportunistic: without writes, physical expiry waits until the next write. Feed still excludes events older than 30 days.
- Login does not recover the device publisher token: older publishers have no authenticated account binding. Linking by nickname or public ID would permit impersonation and is intentionally not implemented.
- Database schema/migration files are unchanged. No production DB commands were run for this change. MariaDB concurrent execution remains a deployment check; SQLite tests cover delayed request ordering and independent ownership.
- Test: `php api/tests/activity.php` and `php api/tests/activity_body_limit.php`.
