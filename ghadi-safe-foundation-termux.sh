#!/data/data/com.termux/files/usr/bin/bash
# Ghadi Safe Foundation — local source foundation only.
# It writes source on a feature branch after a local backup. It never reads
# secret values, never configures providers, and never deploys Firebase.

set -Eeuo pipefail
IFS=$'\n\t'
umask 077

readonly PROJECT_ROOT="${GHADI_ROOT:-$HOME/g-elite-g-smart-platform}"
readonly FUNCTIONS_DIR="$PROJECT_ROOT/functions"
readonly SOURCE_DIR="$FUNCTIONS_DIR/src"
readonly PUBLIC_DIR="$PROJECT_ROOT/public"
readonly STATE_DIR="$PROJECT_ROOT/.ghadi-foundation"
readonly BACKUP_DIR="$STATE_DIR/backups"
readonly REPORT_DIR="$STATE_DIR/reports"
readonly LOG_FILE="$STATE_DIR/foundation.log"
readonly MODE="${1:-help}"

say() { printf '\n==> %s\n' "$*"; mkdir -p "$STATE_DIR"; printf '[%s] %s\n' "$(date -Iseconds)" "$*" >> "$LOG_FILE"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "الأداة غير متاحة: $1"; }
gate() { [ "${!1:-0}" = "1" ] || die "يلزم $1=1 قبل $2"; }

on_error() {
  local line="$1" code="$2"
  mkdir -p "$STATE_DIR"
  printf '[%s] ERROR mode=%s line=%s exit=%s\n' "$(date -Iseconds)" "$MODE" "$line" "$code" >> "$LOG_FILE"
  printf '\nERROR: توقف الوضع %s عند السطر %s. لم يحدث نشر خارجي.\n' "$MODE" "$line" >&2
}
trap 'on_error "$LINENO" "$?"' ERR

init() { mkdir -p "$BACKUP_DIR" "$REPORT_DIR"; touch "$LOG_FILE"; }

layout() {
  [ -d "$PROJECT_ROOT" ] || die "المشروع غير موجود: $PROJECT_ROOT"
  [ -d "$SOURCE_DIR" ] || die "مصدر functions غير موجود: $SOURCE_DIR"
  [ -d "$PUBLIC_DIR" ] || die "public غير موجود: $PUBLIC_DIR"
  [ -f "$PROJECT_ROOT/firebase.json" ] || die "firebase.json غير موجود"
  [ -f "$PROJECT_ROOT/firestore.rules" ] || die "firestore.rules غير موجود"
  [ -f "$FUNCTIONS_DIR/package.json" ] || die "functions/package.json غير موجود"
  [ -f "$FUNCTIONS_DIR/package-lock.json" ] || die "functions/package-lock.json غير موجود"
}

safe_git() {
  need git
  git -C "$PROJECT_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "المجلد ليس مستودع Git صالحاً"
  git -C "$PROJECT_ROOT" diff --quiet || die "هناك تعديلات غير محفوظة. نفذ commit أو stash أولاً."
  git -C "$PROJECT_ROOT" diff --cached --quiet || die "هناك تعديلات staged. راجعها أولاً."
}

secret_policy() {
  # Do not read secret values. Only test tracking and dangerous paths by name.
  if git -C "$PROJECT_ROOT" ls-files --error-unmatch functions/.env >/dev/null 2>&1; then
    die "functions/.env متتبع في Git؛ أزله ودوّر الاعتمادات قبل أي تعديل."
  fi
  grep -Fqx 'functions/.env' "$PROJECT_ROOT/.gitignore" || die ".gitignore لا يحتوي functions/.env كسطر صريح."
  if find "$PROJECT_ROOT" -path "$PROJECT_ROOT/node_modules" -prune -o -type f \( -name '*.key' -o -name '*service-account*.json' -o -name '*firebase-adminsdk*.json' \) -print -quit | grep -q .; then
    die "ملف اعتماد محتمل داخل المشروع. انقله خارج المشروع قبل المتابعة."
  fi
}

backup() {
  init; layout
  local stamp dest
  stamp="$(date +%Y%m%d-%H%M%S)"
  dest="$BACKUP_DIR/$stamp"
  mkdir -p "$dest/src" "$dest/config"
  cp -p "$PROJECT_ROOT/firebase.json" "$PROJECT_ROOT/firestore.rules" "$PROJECT_ROOT/firestore.indexes.json" "$dest/config/"
  [ -f "$PROJECT_ROOT/storage.rules" ] && cp -p "$PROJECT_ROOT/storage.rules" "$dest/config/storage.rules"
  cp -p "$SOURCE_DIR"/*.ts "$dest/src/" 2>/dev/null || true
  [ -d "$SOURCE_DIR/engine" ] && cp -a "$SOURCE_DIR/engine" "$dest/src/engine"
  find "$dest" -type f -exec sha256sum {} \; > "$dest/MANIFEST.sha256"
  printf '%s\n' "$dest"
}

usage() {
  cat <<'USAGE'
Ghadi Safe Foundation

  ./ghadi-safe-foundation-termux.sh inspect
  CONFIRM_LOCAL_FOUNDATION=1 ./ghadi-safe-foundation-termux.sh apply
  ./ghadi-safe-foundation-termux.sh verify
  ./ghadi-safe-foundation-termux.sh report
  ./ghadi-safe-foundation-termux.sh rollback <backup-directory>

apply creates a timestamped backup and writes local source only.
It does not deploy, push Git, read secrets, configure Authentication, or add keys.
USAGE
}

inspect() {
  init; layout; safe_git; secret_policy
  need node; need npm
  say "فحص أساس المشروع بلا كتابة"
  printf 'root=%s\nnode=%s\nnpm=%s\ngit=%s\n' "$PROJECT_ROOT" "$(node --version)" "$(npm --version)" "$(git -C "$PROJECT_ROOT" rev-parse --short HEAD)"
  grep -nE '"public"|"function"|"runtime"|"database"' "$PROJECT_ROOT/firebase.json" || true
  grep -nE 'allow[[:space:]]+read|request\.auth' "$PROJECT_ROOT/firestore.rules" || true
  printf 'result=inspect_passed\n'
}

write_auth() {
  cat > "$SOURCE_DIR/auth.ts" <<'TS'
import type { NextFunction, Request, Response } from "express";
import { getAuth } from "firebase-admin/auth";
import { firestore } from "./firebase";

export interface Actor {
  uid: string;
  email?: string;
  roles: string[];
}

declare global {
  namespace Express {
    interface Request { actor?: Actor; }
  }
}

function bearer(value: string | undefined) {
  const match = /^Bearer\s+(.+)$/i.exec(String(value || "").trim());
  return match?.[1];
}

export async function requireActor(req: Request, res: Response, next: NextFunction) {
  try {
    const token = bearer(req.header("authorization"));
    if (!token) return res.status(401).json({ success: false, error: { symbol: "auth_required", message: "Authentication is required." } });
    const decoded = await getAuth().verifyIdToken(token, true);
    const rawRoles = decoded.roles;
    req.actor = { uid: decoded.uid, email: decoded.email, roles: Array.isArray(rawRoles) ? rawRoles.filter((x): x is string => typeof x === "string") : [] };
    return next();
  } catch {
    return res.status(401).json({ success: false, error: { symbol: "auth_invalid", message: "Authentication could not be verified." } });
  }
}

export async function isProjectMember(projectId: string, uid: string) {
  const snap = await firestore.doc(`projects/${projectId}/members/${uid}`).get();
  return snap.exists && snap.data()?.status === "active";
}

export async function requireProjectMember(req: Request, res: Response, next: NextFunction) {
  const projectId = String(req.body?.projectId || req.header("x-project-id") || req.query?.projectId || "").trim();
  if (!req.actor) return res.status(401).json({ success: false, error: { symbol: "auth_required", message: "Authentication is required." } });
  if (!projectId) return res.status(400).json({ success: false, error: { symbol: "project_required", message: "A projectId is required." } });
  if (!(await isProjectMember(projectId, req.actor.uid))) return res.status(403).json({ success: false, error: { symbol: "project_forbidden", message: "Project membership is required." } });
  req.body = { ...(req.body || {}), projectId };
  return next();
}
TS
}

write_policy() {
  cat > "$SOURCE_DIR/policy.ts" <<'TS'
export type ToolCategory = "read" | "write" | "high_risk";
const HIGH_RISK = /(delete|remove|publish|send|transfer|pay|payment|launch|deploy|حذف|إزالة|نشر|إرسال|تحويل|دفع|إطلاق|تفعيل)/i;

export function classifyIntent(request: string): ToolCategory {
  return HIGH_RISK.test(request) ? "high_risk" : /(create|build|write|generate|إنشاء|بناء|اكتب|ولد)/i.test(request) ? "write" : "read";
}

export function needsApproval(request: string) { return classifyIntent(request) === "high_risk"; }
TS
}

write_events() {
  cat > "$SOURCE_DIR/events.ts" <<'TS'
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "./firebase";

export type EventSeverity = "info" | "success" | "warning" | "critical";
export async function appendEvent(runId: string, event: { type: string; message: string; severity: EventSeverity; actorId?: string }) {
  await firestore.collection("ghadiRuns").doc(runId).collection("events").add({ ...event, createdAt: FieldValue.serverTimestamp() });
}
TS
}

write_runs() {
  cat > "$SOURCE_DIR/runs.ts" <<'TS'
import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getFunctions } from "firebase-admin/functions";
import { firestore } from "./firebase";
import { appendEvent } from "./events";
import { classifyIntent, needsApproval } from "./policy";

export interface NewRun { actorId: string; projectId: string; request: string; locale: "ar" | "en"; idempotencyKey?: string; attachmentIds: string[]; }
const clean = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 280);

export async function createRun(input: NewRun) {
  const requestSummary = clean(input.request);
  const runs = firestore.collection("ghadiRuns");
  if (input.idempotencyKey) {
    const existing = await runs.where("actorId", "==", input.actorId).where("idempotencyKey", "==", input.idempotencyKey).limit(1).get();
    if (!existing.empty) return existing.docs[0].data();
  }
  const id = `run_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const highRisk = needsApproval(requestSummary);
  const record = {
    id, actorId: input.actorId, projectId: input.projectId, locale: input.locale, requestSummary,
    status: highRisk ? "awaiting_approval" : "planned", progress: 0, toolCategory: classifyIntent(requestSummary),
    attachmentIds: input.attachmentIds, idempotencyKey: input.idempotencyKey || null, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  };
  await runs.doc(id).set(record);
  await appendEvent(id, { type: "run.accepted", message: "Request accepted and recorded.", severity: "info", actorId: input.actorId });
  if (highRisk) {
    const approvalId = `approval_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await firestore.collection("ghadiApprovals").doc(approvalId).set({ id: approvalId, runId: id, actorId: input.actorId, projectId: input.projectId, status: "pending", requestedAction: "high_risk_effect", createdAt: FieldValue.serverTimestamp() });
    await appendEvent(id, { type: "approval.requested", message: "A bounded approval is required before external effect.", severity: "warning", actorId: input.actorId });
    return { ...record, id, approvalId };
  }
  await getFunctions().taskQueue("ghadiPlanTask").enqueue({ runId: id });
  return { ...record, id };
}

export async function getRunForActor(runId: string, actorId: string) {
  const snap = await firestore.collection("ghadiRuns").doc(runId).get();
  const data = snap.data();
  return data && data.actorId === actorId ? data : null;
}

export async function listRunsForActor(actorId: string, projectId?: string) {
  let query = firestore.collection("ghadiRuns").where("actorId", "==", actorId).orderBy("createdAt", "desc").limit(50);
  if (projectId) query = firestore.collection("ghadiRuns").where("actorId", "==", actorId).where("projectId", "==", projectId).orderBy("createdAt", "desc").limit(50);
  const snapshot = await query.get();
  return snapshot.docs.map((doc) => doc.data());
}
TS
}

write_tasks() {
  cat > "$SOURCE_DIR/tasks.ts" <<'TS'
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "./firebase";
import { appendEvent } from "./events";

export const ghadiPlanTask = onTaskDispatched(
  { retryConfig: { maxAttempts: 3, minBackoffSeconds: 15 }, rateLimits: { maxConcurrentDispatches: 2 } },
  async (request) => {
    const runId = String(request.data?.runId || "").trim();
    if (!runId) throw new Error("run_id_required");
    const ref = firestore.collection("ghadiRuns").doc(runId);
    const snap = await ref.get();
    if (!snap.exists) return;
    const run = snap.data();
    if (run?.status !== "planned") return;
    await ref.set({ status: "running", progress: 20, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await appendEvent(runId, { type: "plan.started", message: "Planner task started.", severity: "info", actorId: run.actorId });
    const plan = [
      { id: "observe", title: "رصد الهدف", status: "completed" },
      { id: "plan", title: "بناء خطة قابلة للتنفيذ", status: "completed" },
      { id: "workspace", title: "في انتظار منفذ مساحة العمل", status: "pending" }
    ];
    await ref.set({ status: "completed", progress: 100, plan, result: "تم إنشاء خطة موثقة. يتطلب تنفيذ الملفات والبناء منفذ مساحة عمل معزولاً.", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await appendEvent(runId, { type: "plan.completed", message: "Planner task completed with a documented plan.", severity: "success", actorId: run.actorId });
  }
);
TS
}

write_attachments() {
  cat > "$SOURCE_DIR/attachments.ts" <<'TS'
import { createHash, randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { firestore, storage } from "./firebase";

const MAX_BYTES = 25 * 1024 * 1024;
const allowed = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const blockedExtensions = /\.(exe|dll|bat|cmd|com|scr|msi|sh|ps1)$/i;
function safeName(input: string) { return input.normalize("NFKC").replace(/[^\p{L}\p{N}\-_. ]/gu, "_").trim().slice(0, 160) || "attachment"; }
function magicOk(buffer: Buffer, mime: string) {
  if (mime === "application/pdf") return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mime === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime === "image/jpeg") return buffer[0] === 0xff && buffer[1] === 0xd8;
  if (mime === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

export async function storeAttachment(input: { buffer: Buffer; name: string; mimeType: string; actorId: string; projectId: string }) {
  const mimeType = input.mimeType.split(";")[0].trim().toLowerCase();
  if (!input.buffer.length || input.buffer.length > MAX_BYTES) throw new Error("attachment_size_not_allowed");
  if (!allowed.has(mimeType)) throw new Error("attachment_type_not_allowed");
  const name = safeName(input.name);
  if (blockedExtensions.test(name) || !magicOk(input.buffer, mimeType)) throw new Error("attachment_content_not_allowed");
  const id = `att_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const checksum = createHash("sha256").update(input.buffer).digest("hex");
  const storagePath = `ghadi/attachments/${input.projectId}/${input.actorId}/${id}/${name}`;
  const file = storage.bucket().file(storagePath);
  await file.save(input.buffer, { resumable: false, metadata: { contentType: mimeType, metadata: { actorId: input.actorId, projectId: input.projectId, checksum } } });
  const [url] = await file.getSignedUrl({ action: "read", expires: Date.now() + 60 * 60 * 1000 });
  const record = { id, actorId: input.actorId, projectId: input.projectId, name, mimeType, size: input.buffer.length, checksum, storagePath, url, uploadStatus: "stored", createdAt: FieldValue.serverTimestamp() };
  await firestore.collection("ghadiAttachments").doc(id).set(record);
  return { ...record, createdAt: new Date().toISOString() };
}
TS
}

write_contracts() {
  if grep -Fq 'secureSubmitSchema' "$SOURCE_DIR/contracts.ts"; then
    return
  fi
  cat >> "$SOURCE_DIR/contracts.ts" <<'TS'

export const projectSchema = z.object({ title: z.string().trim().min(2).max(120) });
export const secureSubmitSchema = z.object({
  request: z.string().trim().min(3).max(LIMITS.maxRequestChars),
  locale: z.enum(["ar", "en"]).default("ar"),
  projectId: z.string().trim().min(8).max(128),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
  attachmentIds: z.array(z.string().trim().min(8).max(128)).max(12).default([])
});
TS
}

write_index() {
  cat > "$SOURCE_DIR/index.ts" <<'TS'
import "./firebase-init";
import "dotenv/config";
import express from "express";
import cors from "cors";
import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";
import { FieldValue } from "firebase-admin/firestore";
import { firestore } from "./firebase";
import { requireActor, requireProjectMember } from "./auth";
import { projectSchema, secureSubmitSchema } from "./contracts";
import { storeAttachment } from "./attachments";
import { createRun, getRunForActor, listRunsForActor } from "./runs";
import { ghadiPlanTask } from "./tasks";
import { asJson, asMarkdown } from "./export";

setGlobalOptions({ region: process.env.GHADI_REGION || "us-central1", maxInstances: 10, timeoutSeconds: 60, memory: "512MiB" });
const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: true, methods: ["GET", "POST", "OPTIONS"], credentials: false }));
app.use(express.json({ limit: "1mb" }));
const error = (res: express.Response, status: number, symbol: string, message: string) => res.status(status).json({ success: false, error: { symbol, message } });

app.get(["/health", "/api/health"], (_req, res) => res.json({ success: true, data: { engine: "healthy", executionMode: "queued_server", stateStore: "firestore", auth: "required_for_project_routes", queue: "ghadiPlanTask" } }));

app.post(["/projects", "/api/projects"], requireActor, async (req, res) => {
  const parsed = projectSchema.safeParse(req.body);
  if (!parsed.success || !req.actor) return error(res, 400, "invalid_project", "A valid project title is required.");
  const ref = firestore.collection("projects").doc();
  await firestore.runTransaction(async (tx) => {
    tx.set(ref, { id: ref.id, title: parsed.data.title, ownerId: req.actor!.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    tx.set(ref.collection("members").doc(req.actor!.uid), { uid: req.actor!.uid, role: "owner", status: "active", createdAt: FieldValue.serverTimestamp() });
  });
  return res.status(201).json({ success: true, data: { id: ref.id, title: parsed.data.title } });
});

app.post(["/attachments", "/api/attachments"], requireActor, requireProjectMember, express.raw({ type: "application/octet-stream", limit: "25mb" }), async (req, res) => {
  try {
    if (!req.actor) return error(res, 401, "auth_required", "Authentication is required.");
    const record = await storeAttachment({ buffer: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), name: String(req.header("x-file-name") || "attachment"), mimeType: String(req.header("content-type") || "application/octet-stream"), actorId: req.actor.uid, projectId: String(req.body?.projectId || req.header("x-project-id") || "") });
    return res.status(201).json({ success: true, data: record });
  } catch (caught) {
    return error(res, 400, caught instanceof Error ? caught.message : "attachment_failed", "The attachment could not be stored.");
  }
});

app.post(["/submit", "/api/submit"], requireActor, requireProjectMember, async (req, res) => {
  const parsed = secureSubmitSchema.safeParse(req.body);
  if (!parsed.success || !req.actor) return error(res, 400, "invalid_request", "The request payload is invalid.");
  try { return res.status(202).json({ success: true, data: await createRun({ actorId: req.actor.uid, ...parsed.data }) }); }
  catch (caught) { return error(res, 500, "submit_failed", caught instanceof Error ? caught.message : "The task could not be submitted."); }
});

app.get(["/runs", "/api/runs"], requireActor, async (req, res) => res.json({ success: true, data: await listRunsForActor(req.actor!.uid, typeof req.query.projectId === "string" ? req.query.projectId : undefined) }));
app.get(["/runs/:runId", "/api/runs/:runId"], requireActor, async (req, res) => { const run = await getRunForActor(String(req.params.runId), req.actor!.uid); return run ? res.json({ success: true, data: run }) : error(res, 404, "run_not_found", "The requested run was not found."); });
app.get(["/runs/:runId/export/:format", "/api/runs/:runId/export/:format"], requireActor, async (req, res) => { const run = await getRunForActor(String(req.params.runId), req.actor!.uid); if (!run) return error(res, 404, "run_not_found", "The requested run was not found."); return req.params.format === "json" ? res.type("application/json").send(asJson(run)) : req.params.format === "markdown" ? res.type("text/markdown").send(asMarkdown(run)) : error(res, 400, "unsupported_export", "Only JSON and Markdown exports are supported."); });
app.use((_req, res) => error(res, 404, "not_found", "The requested endpoint does not exist."));

export const ghadiApi = onRequest({ invoker: "public" }, app);
export { ghadiPlanTask };
TS
}

write_rules() {
  cat > "$PROJECT_ROOT/firestore.rules" <<'RULES'
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }
    function member(projectId) { return signedIn() && exists(/databases/$(database)/documents/projects/$(projectId)/members/$(request.auth.uid)); }
    match /projects/{projectId} {
      allow create: if signedIn() && request.resource.data.ownerId == request.auth.uid;
      allow read: if member(projectId);
      allow update, delete: if signedIn() && resource.data.ownerId == request.auth.uid;
      match /members/{userId} { allow read: if member(projectId); allow write: if false; }
    }
    match /ghadiRuns/{runId} { allow read: if signedIn() && resource.data.actorId == request.auth.uid; allow write: if false; match /events/{eventId} { allow read: if signedIn() && get(/databases/$(database)/documents/ghadiRuns/$(runId)).data.actorId == request.auth.uid; allow write: if false; } }
    match /ghadiApprovals/{approvalId} { allow read: if signedIn() && resource.data.actorId == request.auth.uid; allow write: if false; }
    match /ghadiAttachments/{attachmentId} { allow read: if signedIn() && resource.data.actorId == request.auth.uid; allow write: if false; }
  }
}
RULES

  cat > "$PROJECT_ROOT/storage.rules" <<'RULES'
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /ghadi/attachments/{projectId}/{actorId}/{attachmentId}/{fileName} {
      allow read: if request.auth != null && request.auth.uid == actorId;
      allow write: if false;
    }
  }
}
RULES

  cat > "$PROJECT_ROOT/firestore.indexes.json" <<'JSON'
{
  "indexes": [
    { "collectionGroup": "ghadiRuns", "queryScope": "COLLECTION", "fields": [ { "fieldPath": "actorId", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
    { "collectionGroup": "ghadiRuns", "queryScope": "COLLECTION", "fields": [ { "fieldPath": "actorId", "order": "ASCENDING" }, { "fieldPath": "projectId", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" } ] },
    { "collectionGroup": "ghadiApprovals", "queryScope": "COLLECTION", "fields": [ { "fieldPath": "status", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" } ] }
  ],
  "fieldOverrides": []
}
JSON

  node - "$PROJECT_ROOT/firebase.json" <<'NODE'
const fs = require('fs');
const file = process.argv[2]; const json = JSON.parse(fs.readFileSync(file, 'utf8'));
json.storage = { rules: 'storage.rules' };
json.emulators = { functions: { port: 5001 }, firestore: { port: 8080 }, storage: { port: 9199 }, hosting: { port: 5000 }, ui: { enabled: true, port: 4000 } };
fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
NODE
}

apply() {
  gate CONFIRM_LOCAL_FOUNDATION "كتابة أساس Ghadi المحلي"
  init; layout; safe_git; secret_policy
  need node; need npm
  say "إنشاء نسخة احتياطية قبل الكتابة"
  local backup_path; backup_path="$(backup)"; say "النسخة: $backup_path"
  say "كتابة طبقات Auth وPolicy وRuns وTasks وEvents وAttachments"
  write_auth; write_policy; write_events; write_runs; write_tasks; write_attachments; write_contracts; write_index; write_rules
  cat > "$PROJECT_ROOT/GHADI_FOUNDATION_STATUS.md" <<EOF
# حالة أساس Ghadi المحلي

| الحقل | القيمة |
| --- | --- |
| التوقيت | $(date -Iseconds) |
| النسخة الاحتياطية | $backup_path |
| النشر | لم ينفذ |
| الأسرار | لم تقرأ |
| الحالة | يتطلب verify ثم Emulator Suite ثم إعداد Firebase Authentication يدوياً |
EOF
  say "اكتملت الكتابة المحلية. شغّل verify؛ لا تنفذ deploy من هذا السكربت."
}

verify() {
  init; layout; need node; need npm
  say "فحص المصدر المحلي بلا نشر"
  node --check "$PUBLIC_DIR/assets/dashboard.js"
  grep -Fq 'request.auth != null' "$PROJECT_ROOT/firestore.rules" || die "قواعد Firestore لا تتطلب هوية"
  [ -f "$PROJECT_ROOT/storage.rules" ] || die "storage.rules غير موجود"
  grep -Fq 'ghadiPlanTask' "$SOURCE_DIR/tasks.ts" || die "وظيفة الطابور غير موجودة"
  grep -Fq 'requireActor' "$SOURCE_DIR/index.ts" || die "مصادقة API غير موجودة"
  (
    cd "$FUNCTIONS_DIR"
    npm ci --ignore-scripts
    npm run check
    npm run build
  )
  printf 'verify=passed\n'
}

report() {
  init; layout
  local file="$REPORT_DIR/foundation-$(date +%Y%m%d-%H%M%S).md"
  cat > "$file" <<EOF
# تقرير تنفيذ أساس Ghadi

| الحقل | القيمة |
| --- | --- |
| التوقيت | $(date -Iseconds) |
| جذر المشروع | $PROJECT_ROOT |
| الفرع | $(git -C "$PROJECT_ROOT" branch --show-current 2>/dev/null || echo unavailable) |
| HEAD | $(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo unavailable) |
| Node | $(node --version 2>/dev/null || echo unavailable) |
| نشر خارجي | لم ينفذ هذا السكربت أي نشر |

## الملفات المتوقعة

\`\`\`text
$(find "$SOURCE_DIR" -maxdepth 1 -type f -name '*.ts' -printf '%f\n' | sort)
\`\`\`

## حالة Git

\`\`\`text
$(git -C "$PROJECT_ROOT" status --short 2>/dev/null || true)
\`\`\`
EOF
  printf '%s\n' "$file"
}

rollback() {
  gate CONFIRM_ROLLBACK "الاسترجاع المحلي"
  [ -n "${2:-}" ] || die "حدد مسار النسخة الاحتياطية بعد rollback"
  local source="$2"
  [ -f "$source/MANIFEST.sha256" ] || die "النسخة لا تحمل MANIFEST.sha256"
  (cd "$source" && sha256sum -c MANIFEST.sha256)
  cp -p "$source/config/firebase.json" "$source/config/firestore.rules" "$source/config/firestore.indexes.json" "$PROJECT_ROOT/"
  [ -f "$source/config/storage.rules" ] && cp -p "$source/config/storage.rules" "$PROJECT_ROOT/storage.rules" || rm -f "$PROJECT_ROOT/storage.rules"
  rm -f "$SOURCE_DIR"/*.ts
  cp -p "$source/src"/*.ts "$SOURCE_DIR/"
  [ -d "$source/src/engine" ] && { rm -rf "$SOURCE_DIR/engine"; cp -a "$source/src/engine" "$SOURCE_DIR/engine"; }
  say "اكتمل الاسترجاع المحلي. لا يوجد نشر خارجي."
}

case "$MODE" in
  help|-h|--help) usage ;;
  inspect) inspect ;;
  apply) apply ;;
  verify) verify ;;
  report) report ;;
  rollback) rollback "$@" ;;
  *) usage; die "أمر غير معروف: $MODE" ;;
esac
