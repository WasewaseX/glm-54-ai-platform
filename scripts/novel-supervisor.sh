#!/usr/bin/env bash
# Book Forge supervisor — keeps the resumable novel runner alive until the book is done.
# The runner checkpoints every chapter; restarts are free. The gateway quota refills
# slowly, so the supervisor just keeps putting the runner back to work.
set -u
cd /home/z/my-project
BOOK_ID="${1:-the-dreaming-vat}"

echo "[supervisor] started $(date -u) for $BOOK_ID" >> /tmp/novel-run.log

while true; do
  bun "scripts/run-novel.ts" "$BOOK_ID" >> /tmp/novel-run.log 2>&1
  code=$?
  echo "[supervisor] runner exited code=$code $(date -u)" >> /tmp/novel-run.log

  # Exit codes: 0 = done, 1 = fatal, 2 = pass finished with gaps (resume-worthy)
  if [ "$code" -eq 0 ]; then
    echo "[supervisor] book complete" >> /tmp/novel-run.log
    break
  fi

  # If state.json says done, stop regardless of exit code.
  if python3 - "$BOOK_ID" <<'PY' 2>/dev/null
import json, sys
s = json.load(open(f"books/{sys.argv[1]}/state.json"))
sys.exit(0 if s.get("phase") == "done" else 1)
PY
  then
    echo "[supervisor] state.json says done" >> /tmp/novel-run.log
    break
  fi

  sleep 8
done
