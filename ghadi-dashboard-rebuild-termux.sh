#!/data/data/com.termux/files/usr/bin/bash
# Ghadi Dashboard rebuild: local copy, verification, optional local commit.
# It never reads .env, creates secrets, links accounts, or deploys Firebase.
set -Eeuo pipefail
IFS=$'\n\t'

ROOT="${GHADI_ROOT:-$HOME/g-elite-g-smart-platform}"
BUNDLE_DIR="${GHADI_BUNDLE_DIR:-$HOME/storage/downloads/ghadi-dashboard-rebuild}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_ROOT="${GHADI_BACKUP_ROOT:-$ROOT/.ghadi/dashboard-backups}"
REPORT_ROOT="${GHADI_REPORT_ROOT:-$ROOT/.ghadi/reports}"
MODE="${1:-help}"

say(){ printf '\n== %s ==\n' "$*"; }
die(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
need(){ command -v "$1" >/dev/null 2>&1 || die "الأمر غير متاح: $1"; }
need_file(){ [[ -f "$1" ]] || die "ملف مفقود: $1"; }
root_guard(){ [[ -d "$ROOT/.git" ]] || die "GHADI_ROOT لا يشير إلى مستودع Git: $ROOT"; [[ -d "$ROOT/functions" && -d "$ROOT/public" ]] || die "البنية المتوقعة مفقودة: public وfunctions مطلوبان"; }
bundle_guard(){ need_file "$BUNDLE_DIR/dashboard.html"; need_file "$BUNDLE_DIR/dashboard.css"; need_file "$BUNDLE_DIR/dashboard.js"; }
forbidden_guard(){ if grep -RIlE '(api[_-]?key|private[_-]?key|service[_-]?account|password=)' "$BUNDLE_DIR/dashboard.html" "$BUNDLE_DIR/dashboard.css" "$BUNDLE_DIR/dashboard.js" >/dev/null 2>&1; then die "توقفت العملية: ملف الواجهة يحوي نمط اعتماد محظوراً"; fi; }
report(){ mkdir -p "$REPORT_ROOT"; local f="$REPORT_ROOT/dashboard-rebuild-${STAMP}.md"; { printf '# Ghadi Dashboard Rebuild Local Report\n\n'; printf -- '- time: `%s`\n- root: `%s`\n- branch: `%s`\n- revision: `%s`\n' "$STAMP" "$ROOT" "$(git -C "$ROOT" branch --show-current)" "$(git -C "$ROOT" rev-parse --short HEAD)"; printf -- '- dashboard_sha256:\n'; sha256sum "$ROOT/public/dashboard.html" "$ROOT/public/assets/dashboard.css" "$ROOT/public/assets/dashboard.js" | sed 's/^/  - `/;s/$/`/'; } > "$f"; printf 'report=%s\n' "$f"; }

inspect(){ root_guard; say "وضع المشروع"; printf 'root=%s\nbranch=%s\nrevision=%s\n' "$ROOT" "$(git -C "$ROOT" branch --show-current)" "$(git -C "$ROOT" rev-parse --short HEAD)"; git -C "$ROOT" status --short; say "الملفات المستهدفة"; find "$ROOT/public" -maxdepth 2 -type f \( -name 'dashboard.html' -o -name 'dashboard.css' -o -name 'dashboard.js' \) -print; }
apply(){ root_guard; bundle_guard; forbidden_guard; [[ "${CONFIRM_LOCAL_DASHBOARD_REBUILD:-}" == "1" ]] || die "أعد الأمر مع CONFIRM_LOCAL_DASHBOARD_REBUILD=1 لتطبيق نسخة محلية"; local b="$BACKUP_ROOT/$STAMP"; mkdir -p "$b/assets"; cp "$ROOT/public/dashboard.html" "$b/dashboard.html"; cp "$ROOT/public/assets/dashboard.css" "$b/assets/dashboard.css"; cp "$ROOT/public/assets/dashboard.js" "$b/assets/dashboard.js"; cp "$BUNDLE_DIR/dashboard.html" "$ROOT/public/dashboard.html"; cp "$BUNDLE_DIR/dashboard.css" "$ROOT/public/assets/dashboard.css"; cp "$BUNDLE_DIR/dashboard.js" "$ROOT/public/assets/dashboard.js"; sha256sum "$ROOT/public/dashboard.html" "$ROOT/public/assets/dashboard.css" "$ROOT/public/assets/dashboard.js" > "$b/APPLIED.sha256"; printf 'backup=%s\n' "$b"; }
verify(){ root_guard; need node; say "فحص واجهة Ghadi"; node --check "$ROOT/public/assets/dashboard.js"; grep -Fq '"/api"' "$ROOT/public/assets/dashboard.js" || die "لم يوجد المسار النسبي /api"; ! grep -Eiq 'https?://[^[:space:]]+\.run\.app' "$ROOT/public/assets/dashboard.js" || die "يوجد عنوان Cloud Run مباشر محظور"; ! grep -Eiq '(api[_-]?key|private[_-]?key|service[_-]?account)' "$ROOT/public/dashboard.html" "$ROOT/public/assets/dashboard.css" "$ROOT/public/assets/dashboard.js" || die "يوجد نمط اعتماد في الواجهة"; say "فحص الدوال"; (cd "$ROOT/functions" && npm run check && npm run build); report; printf 'verify=PASS\n'; }
commit_local(){ root_guard; [[ "${CONFIRM_GIT_COMMIT:-}" == "1" ]] || die "أعد الأمر مع CONFIRM_GIT_COMMIT=1 لإنشاء commit محلي"; git -C "$ROOT" add public/dashboard.html public/assets/dashboard.css public/assets/dashboard.js; git -C "$ROOT" diff --cached --quiet && die "لا توجد تغييرات Dashboard مؤهلة للـcommit"; git -C "$ROOT" commit -m "feat(workspace): rebuild ghadi dashboard surface"; }
rollback(){ root_guard; local b="${2:-}"; [[ -n "$b" ]] || die "الاستخدام: rollback <backup-directory>"; need_file "$b/dashboard.html"; need_file "$b/assets/dashboard.css"; need_file "$b/assets/dashboard.js"; [[ "${CONFIRM_LOCAL_ROLLBACK:-}" == "1" ]] || die "أعد الأمر مع CONFIRM_LOCAL_ROLLBACK=1 للاسترداد المحلي"; cp "$b/dashboard.html" "$ROOT/public/dashboard.html"; cp "$b/assets/dashboard.css" "$ROOT/public/assets/dashboard.css"; cp "$b/assets/dashboard.js" "$ROOT/public/assets/dashboard.js"; printf 'rollback=PASS\n'; }
usage(){ cat <<'EOF'
الاستخدام:
  bash ghadi-dashboard-rebuild-termux.sh inspect
  CONFIRM_LOCAL_DASHBOARD_REBUILD=1 bash ghadi-dashboard-rebuild-termux.sh apply
  bash ghadi-dashboard-rebuild-termux.sh verify
  CONFIRM_GIT_COMMIT=1 bash ghadi-dashboard-rebuild-termux.sh commit-local
  CONFIRM_LOCAL_ROLLBACK=1 bash ghadi-dashboard-rebuild-termux.sh rollback <backup-directory>

متغيرات اختيارية:
  GHADI_ROOT=~/g-elite-g-smart-platform
  GHADI_BUNDLE_DIR=~/storage/downloads/ghadi-dashboard-rebuild

هذا السكربت لا ينشر Firebase ولا يسجل دخولاً ولا يقرأ .env أو secrets.
EOF
}
case "$MODE" in inspect) inspect;; apply) apply;; verify) verify;; commit-local) commit_local;; rollback) rollback "$@";; help|-h|--help) usage;; *) usage; exit 2;; esac
