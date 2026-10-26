#!/usr/bin/env bash
# GLM 5.4 AI — durable GitHub backup
# Commits any pending work and pushes to the private backup repo.
# Token is read from .env (gitignored) and never written to .git/config.
#
# Usage:
#   bash scripts/backup-to-github.sh "optional commit message"

set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found. Add GITHUB_BACKUP_TOKEN=<your PAT> to .env" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

: "${GITHUB_BACKUP_TOKEN:?GITHUB_BACKUP_TOKEN missing in .env}"
REPO="WasewaseX/glm-54-ai-platform"
BRANCH="main"

git add -A
if git diff --cached --quiet; then
  echo "Nothing new to commit — pushing current state anyway."
else
  git commit -q -m "${1:-Backup: $(date -u '+%Y-%m-%d %H:%M UTC')}"
fi

git push "https://x-access-token:${GITHUB_BACKUP_TOKEN}@github.com/${REPO}.git" "HEAD:${BRANCH}" \
  | sed "s/${GITHUB_BACKUP_TOKEN}//g"

echo "Backup pushed to https://github.com/${REPO} (${BRANCH})"
