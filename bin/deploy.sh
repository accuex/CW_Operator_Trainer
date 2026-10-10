#!/usr/bin/env bash
#
# Next.js / PHP API をリモートサーバーへ rsync デプロイ
#
# 接続情報（api/.vscode/sftp.json と同一ホスト・ユーザー・鍵）:
#   host: cwot.jp
#   user: cw
#   path: /home/cw/app
#   key:  ~/.ssh/id_rsa
#
# Usage:
#   ./bin/deploy.sh                 # ソース/API同期・API依存更新（DB変更なし）
#   ./bin/deploy.sh --dry-run       # 差分確認（転送・リモート操作なし）
#   ./bin/deploy.sh --with-build    # ソース/API同期 → build → pm2 reload/start
#   ./bin/deploy.sh --with-build --with-db  # 上記 + DB migration
#   ./bin/deploy.sh --list-files    # 転送対象をローカル表示（接続なし）
#   ./bin/deploy.sh --with-build --skip-pm2  # build のみ（pm2 再起動なし）
#
# 本番反映の定番:
#   ./bin/deploy.sh --with-build
#
# Environment overrides:
#   DEPLOY_USER       (default: cw)
#   DEPLOY_HOST       (default: cwot.jp)
#   DEPLOY_PATH       (default: /home/cw/app)
#   DEPLOY_SSH_KEY    (default: ~/.ssh/id_rsa)
#   DEPLOY_API_PATH   (default: $DEPLOY_PATH/api) # 実際にPHPが参照するAPIルート
#   DEPLOY_PHP        (default: php)
#   DEPLOY_COMPOSER   (default: composer)
#   DEPLOY_NPM        (default: npm)
#   DEPLOY_PM2        (default: pm2)
#   DEPLOY_PM2_APP    (default: cw-app)
#   DEPLOY_PORT       (default: 3020)
#   DEPLOY_HOST_BIND  (default: 127.0.0.1)  # next start -H
#   DEPLOY_GA_ID      (default: G-0GRT7L4WCN)  # NEXT_PUBLIC_GA_MEASUREMENT_ID at build
#                     set empty to disable GA: DEPLOY_GA_ID= ./bin/deploy.sh --with-build
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

DEPLOY_USER="${DEPLOY_USER:-cw}"
DEPLOY_HOST="${DEPLOY_HOST:-cwot.jp}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/cw/app}"
DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/id_rsa}"
DEPLOY_NPM="${DEPLOY_NPM:-npm}"
DEPLOY_PM2="${DEPLOY_PM2:-pm2}"
DEPLOY_PM2_APP="${DEPLOY_PM2_APP:-cw-app}"
DEPLOY_PORT="${DEPLOY_PORT:-3020}"
DEPLOY_HOST_BIND="${DEPLOY_HOST_BIND:-127.0.0.1}"
DEPLOY_GA_ID="${DEPLOY_GA_ID-G-0GRT7L4WCN}"

DRY_RUN=""
WITH_BUILD=false
SKIP_PM2=false
WITH_DB=false
LIST_FILES=false
DEPLOY_API_PATH="${DEPLOY_API_PATH:-$DEPLOY_PATH/api}"
DEPLOY_PHP="${DEPLOY_PHP:-php}"
DEPLOY_COMPOSER="${DEPLOY_COMPOSER:-composer}"

usage() {
  sed -n '2,/^set -euo pipefail/p' "$0" | sed '/^set -euo pipefail/d; s/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN="--dry-run"
      ;;
    --with-build)
      WITH_BUILD=true
      ;;
    --with-db)
      WITH_DB=true
      ;;
    --list-files)
      LIST_FILES=true
      ;;
    --skip-pm2)
      SKIP_PM2=true
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

# Build the complete local manifest before any network or remote mutation.
APP_LIST="$(mktemp)"
API_LIST="$(mktemp)"
trap 'rm -f "$APP_LIST" "$API_LIST"' EXIT
python3 "$ROOT/scripts/deployManifest.py" "$ROOT" --area app > "$APP_LIST"
python3 "$ROOT/scripts/deployManifest.py" "$ROOT" --area api > "$API_LIST"
if $LIST_FILES; then
  echo "[app]"
  python3 "$ROOT/scripts/deployManifest.py" "$ROOT" --area app --print
  echo "[api]"
  python3 "$ROOT/scripts/deployManifest.py" "$ROOT" --area api --print
  exit 0
fi
if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync is required but not found in PATH" >&2
  exit 1
fi
# These values enter the existing remote shell scripts; reject shell metacharacters.
for deploy_value in "$DEPLOY_PATH" "$DEPLOY_API_PATH" "$DEPLOY_USER" "$DEPLOY_HOST" "$DEPLOY_NPM" "$DEPLOY_PM2" "$DEPLOY_PM2_APP" "$DEPLOY_PHP" "$DEPLOY_COMPOSER" "$DEPLOY_PORT" "$DEPLOY_HOST_BIND" "$DEPLOY_GA_ID"; do
  if [[ ! "$deploy_value" =~ ^[a-zA-Z0-9_./:@-]*$ ]]; then
    echo "Unsupported character in deployment configuration" >&2; exit 1
  fi
done
if [[ "$DEPLOY_PATH" != /* || "$DEPLOY_API_PATH" != /* || "$DEPLOY_PATH" == / || "$DEPLOY_API_PATH" == / ]]; then
  echo "Deploy paths must be absolute non-root directories" >&2; exit 1
fi

DEPLOY_SSH_KEY="${DEPLOY_SSH_KEY/#\~/$HOME}"

if [[ ! -f "$DEPLOY_SSH_KEY" ]]; then
  echo "SSH key not found: $DEPLOY_SSH_KEY" >&2
  exit 1
fi

SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"
SSH_CMD=(ssh -i "$DEPLOY_SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15)
printf -v RSYNC_SSH '%q ' "${SSH_CMD[@]}"

echo "Deploy target: ${SSH_TARGET}:${DEPLOY_PATH}"
echo "Source:        ${ROOT}/"
echo "API target:    ${SSH_TARGET}:${DEPLOY_API_PATH}"
if $WITH_DB; then echo "DB migration:  enabled (existing remote API .env)"; fi
if $WITH_BUILD; then
  echo "Remote build:  ${DEPLOY_NPM} ci && ${DEPLOY_NPM} run build"
  if [[ -n "$DEPLOY_GA_ID" ]]; then
    echo "GA:            ${DEPLOY_GA_ID}"
  else
    echo "GA:            disabled"
  fi
  if ! $SKIP_PM2; then
    echo "PM2:           ${DEPLOY_PM2} reload/start ${DEPLOY_PM2_APP} (port ${DEPLOY_PORT})"
  fi
fi
echo ""

RSYNC_EXCLUDES=(
  --exclude '.env'
  --exclude '.env.*'
  --exclude '.vscode/'
  --exclude '.git/'
  --exclude '.history/'
  --exclude 'node_modules/'
  --exclude '.next/'
  --exclude 'out/'
  --exclude '.vercel/'
  --exclude 'coverage/'
  --exclude '/docs/'
  --exclude '/.vinext/'
  --exclude '/dist/'
  --exclude '/.wrangler/'
  --exclude '/.claude/'
  --include '/.openai/hosting.json'
  --exclude '/.openai/*'
  --exclude '/work/'
  --exclude '/outputs/'
  --exclude '/tmp/'
  --exclude '.DS_Store'
  --exclude '*.tsbuildinfo'
)

# Preserve server-only configuration and dependencies; do not delete unrelated
# remote files via a dynamically generated files-from list.
rsync -avz --from0 --files-from="$APP_LIST" ${DRY_RUN} \
  "${RSYNC_EXCLUDES[@]}" -e "$RSYNC_SSH" "${ROOT}/" "${SSH_TARGET}:${DEPLOY_PATH}/"
rsync -avz --from0 --files-from="$API_LIST" ${DRY_RUN} \
  "${RSYNC_EXCLUDES[@]}" -e "$RSYNC_SSH" "${ROOT}/api/" "${SSH_TARGET}:${DEPLOY_API_PATH}/"

if [[ -n "$DRY_RUN" ]]; then
  echo ""
  echo "Dry run complete. No files were transferred."
  if $WITH_BUILD; then
    echo "Skipped remote npm ci / build / pm2 (dry run)."
  fi
  if $WITH_DB; then echo "Skipped DB migration and composer (dry run)."; fi
  exit 0
fi

# API dependencies must be installed on the server, never copied from local vendor.
"${SSH_CMD[@]}" "$SSH_TARGET" bash -s <<EOF
set -euo pipefail
cd '${DEPLOY_API_PATH}'
'${DEPLOY_COMPOSER}' install --no-dev --prefer-dist --no-interaction --optimize-autoloader
EOF

if $WITH_BUILD; then
  echo ""
  echo "Running npm ci && npm run build on remote..."
  "${SSH_CMD[@]}" "$SSH_TARGET" bash -s <<EOF
set -euo pipefail
cd '${DEPLOY_PATH}'
if ! command -v node >/dev/null 2>&1; then
  echo "node not found on remote" >&2
  exit 1
fi
if ! command -v '${DEPLOY_NPM}' >/dev/null 2>&1; then
  echo "npm not found on remote (tried: ${DEPLOY_NPM})" >&2
  exit 1
fi
'${DEPLOY_NPM}' ci
export NEXT_PUBLIC_GA_MEASUREMENT_ID='${DEPLOY_GA_ID}'
'${DEPLOY_NPM}' run build
EOF

fi

if $WITH_DB; then
  echo "Applying registered DB migrations..."
  "${SSH_CMD[@]}" "$SSH_TARGET" bash -s <<EOF
set -euo pipefail
cd '${DEPLOY_API_PATH}'
'${DEPLOY_PHP}' bin/migrate.php
EOF
fi

if $WITH_BUILD; then
  if ! $SKIP_PM2; then
    echo ""
    echo "Reloading PM2 app..."
    "${SSH_CMD[@]}" "$SSH_TARGET" bash -s <<EOF
set -euo pipefail
cd '${DEPLOY_PATH}'
export PM2_APP_NAME='${DEPLOY_PM2_APP}'
export PORT='${DEPLOY_PORT}'
export HOST='${DEPLOY_HOST_BIND}'

if ! command -v '${DEPLOY_PM2}' >/dev/null 2>&1; then
  echo "pm2 not found on remote (tried: ${DEPLOY_PM2})" >&2
  echo "Install: npm install -g pm2" >&2
  exit 1
fi

if '${DEPLOY_PM2}' pid '${DEPLOY_PM2_APP}' >/dev/null 2>&1; then
  '${DEPLOY_PM2}' reload ecosystem.config.cjs --update-env
else
  '${DEPLOY_PM2}' start ecosystem.config.cjs
fi

'${DEPLOY_PM2}' save || echo "Note: pm2 save skipped (run 'pm2 startup' once on the server if needed)"
'${DEPLOY_PM2}' status '${DEPLOY_PM2_APP}'
EOF
  fi
fi

echo ""
echo "Deploy complete."
