#!/data/data/com.termux/files/usr/bin/bash
# Ghadi Project Diagnose — read-only snapshot and explicitly-gated local build.
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

ROOT="${GHADI_ROOT:-$HOME/g-elite-g-smart-platform}"
MODE="${1:-snapshot}"
STATE="$ROOT/.ghadi-foundation"
REPORTS="$STATE/reports"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "الأداة غير متاحة: $1"; }
layout() {
  [ -d "$ROOT/.git" ] || die "ليس مستودع Git: $ROOT"
  [ -d "$ROOT/functions/src" ] || die "مصدر functions غير موجود"
  [ -d "$ROOT/public" ] || die "مجلد public غير موجود"
  [ -f "$ROOT/firebase.json" ] || die "firebase.json غير موجود"
  [ -f "$ROOT/functions/package.json" ] || die "functions/package.json غير موجود"
}
tracked_secret_check() {
  if git -C "$ROOT" ls-files --error-unmatch functions/.env >/dev/null 2>&1; then die "functions/.env متتبع في Git؛ لا تكمل."; fi
  if git -C "$ROOT" ls-files | grep -Eqi '(^|/)([^/]*(service-account|firebase-adminsdk)[^/]*\.json|[^/]*\.key)$'; then die "يوجد ملف اعتماد محتمل متتبع في Git؛ لا تكمل."; fi
}
snapshot() {
  need git; need node; need npm; layout; tracked_secret_check
  mkdir -p "$REPORTS"
  local out="$REPORTS/project-snapshot-$(date +%Y%m%d-%H%M%S).md"
  {
    printf '# Ghadi Project Snapshot\n\n'
    printf '| Field | Value |\n| --- | --- |\n'
    printf '| Generated | %s |\n' "$(date -Iseconds)"
    printf '| Root | `%s` |\n' "$ROOT"
    printf '| Branch | `%s` |\n' "$(git -C "$ROOT" branch --show-current)"
    printf '| HEAD | `%s` |\n' "$(git -C "$ROOT" rev-parse --short HEAD)"
    printf '| Node | `%s` |\n' "$(node --version)"
    printf '| npm | `%s` |\n' "$(npm --version)"
    if command -v firebase >/dev/null 2>&1; then printf '| Firebase CLI | `%s` |\n' "$(firebase --version)"; else printf '| Firebase CLI | unavailable |\n'; fi
    printf '\n## Required files\n\n```text\n'
    for p in firebase.json firestore.rules firestore.indexes.json public/dashboard.html public/assets/dashboard.js functions/src/contracts.ts functions/src/index.ts functions/src/engine/ghadi-engine.ts; do
      [ -f "$ROOT/$p" ] && printf 'OK %s\n' "$p" || printf 'MISSING %s\n' "$p"
    done
    printf '```\n\n## Git status\n\n```text\n'
    git -C "$ROOT" status --short || true
    printf '```\n\n## Last commits\n\n```text\n'
    git -C "$ROOT" log --oneline -8 || true
    printf '```\n\n## Published API health\n\n```text\n'
    if command -v curl >/dev/null 2>&1; then curl --silent --show-error --fail --connect-timeout 8 https://g-elite-g.com/api/health || true; else printf 'curl unavailable\n'; fi
    printf '\n```\n\n## Safety\n\nNo .env, credentials, environment variables, or secret values were read. No deploy, write, or network submission was executed.\n'
  } > "$out"
  printf '%s\n' "$out"
}
build() {
  [ "${CONFIRM_LOCAL_BUILD:-0}" = "1" ] || die "يلزم CONFIRM_LOCAL_BUILD=1 لتشغيل npm ci والبناء المحلي."
  need node; need npm; layout; tracked_secret_check
  ( cd "$ROOT/functions" && npm ci --ignore-scripts && npm run check && npm run build )
  node --check "$ROOT/public/assets/dashboard.js"
  git -C "$ROOT" diff --check
  printf 'local_build=passed\n'
}
case "$MODE" in
  snapshot) snapshot ;;
  build) build ;;
  *) printf 'Usage: %s [snapshot|build]\n' "$0"; exit 64 ;;
esac
