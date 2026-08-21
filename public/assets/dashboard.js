/*
 * اتجاه التصميم: مساحة إنجاز هادئة.
 * قاعدة هذا الملف: المتصفح يصف ويعرض ويتحقق فقط؛ غادي API ينشئ ويقرر وينفذ.
 * لا أسرار، ولا Gemini مباشر، ولا أمر نظام، ولا بريد أو دفع أو نشر من العميل.
 */

"use strict";

const CONFIG = Object.freeze({
  project: {
    id: "g-elite-g-smart-platform",
    region: "us-central1",
    firestoreDatabaseId: "g-elite-g"
  },
  api: {
    relativeBase: "/api",
    directBase: "https://ghadiapi-noy6fbznva-uc.a.run.app",
    timeoutMs: 18000,
    maxAttachmentBytes: 25 * 1024 * 1024
  },
  contracts: "/ghadi-platform-contracts.json",
  exportName: "ghadi-session-snapshot"
});

const state = {
  sessionId: crypto.randomUUID ? crypto.randomUUID() : `session_${Date.now()}`,
  projectId: localStorage.getItem("ghadi.projectId") || "new-project",
  projectTitle: localStorage.getItem("ghadi.projectTitle") || "مشروع جديد",
  apiBase: CONFIG.api.relativeBase,
  apiOnline: false,
  isSubmitting: false,
  currentRun: null,
  attachments: [],
  events: [],
  contracts: null,
  approval: null
};

const dom = {};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const nowLabel = () => new Intl.DateTimeFormat("ar", { hour: "2-digit", minute: "2-digit" }).format(new Date());
const safeText = (value, fallback = "") => String(value ?? fallback).trim() || fallback;
const humanSize = (value) => `${new Intl.NumberFormat("ar", { maximumFractionDigits: 1 }).format(Number(value || 0) / 1024 / 1024)} MB`;

function showToast(message, tone = "neutral") {
  const toast = document.createElement("div");
  toast.className = `toast ${tone}`;
  toast.textContent = message;
  dom.toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 4400);
}

function createProjectIdentity(intent) {
  if (state.projectId !== "new-project") return;
  const title = safeText(intent).replace(/\s+/g, " ").slice(0, 58) || "مشروع جديد";
  state.projectId = `local-${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
  state.projectTitle = title;
  localStorage.setItem("ghadi.projectId", state.projectId);
  localStorage.setItem("ghadi.projectTitle", state.projectTitle);
  renderProjectFacts();
}

function apiBases() {
  return [...new Set([state.apiBase, CONFIG.api.directBase].filter(Boolean).map((base) => base.replace(/\/$/, "")))];
}

async function request(path, options = {}) {
  let lastError;
  for (const base of apiBases()) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), CONFIG.api.timeoutMs);
    try {
      const response = await fetch(`${base}${path}`, { ...options, signal: controller.signal });
      window.clearTimeout(timer);
      const contentType = response.headers.get("content-type") || "";
      const payload = contentType.includes("application/json") ? await response.json() : await response.text();
      if (!response.ok || (payload && typeof payload === "object" && payload.success === false)) {
        const message = typeof payload === "object" ? payload?.error?.message || payload?.error?.symbol : payload;
        throw new Error(message || `HTTP ${response.status}`);
      }
      state.apiBase = base;
      return payload;
    } catch (error) {
      window.clearTimeout(timer);
      lastError = error;
    }
  }
  throw lastError || new Error("تعذر الوصول إلى Ghadi API.");
}

async function loadContracts() {
  try {
    const response = await fetch(CONFIG.contracts, { headers: { Accept: "application/json" } });
    if (!response.ok) return;
    state.contracts = await response.json();
  } catch {
    state.contracts = null;
  }
}

async function checkHealth() {
  dom.connectionLabel.textContent = "جارٍ التحقق";
  dom.connectionDot.className = "connection-dot checking";
  try {
    const payload = await request("/health", { headers: { Accept: "application/json" } });
    const health = payload?.data || payload || {};
    state.apiOnline = health.engine === "healthy" || health.status === "healthy";
    dom.connectionLabel.textContent = state.apiOnline ? "متصل" : "حالة محدودة";
    dom.connectionDot.className = "connection-dot online";
  } catch {
    state.apiOnline = false;
    dom.connectionLabel.textContent = "وضع محلي";
    dom.connectionDot.className = "connection-dot offline";
  }
  renderProjectFacts();
}

function runState(status) {
  const normalized = safeText(status, "pending").toLowerCase();
  if (["completed", "complete", "ready", "succeeded", "success"].includes(normalized)) return "complete";
  if (["awaiting_approval", "blocked", "waiting", "requires_approval"].includes(normalized)) return "blocked";
  if (["failed", "error", "cancelled"].includes(normalized)) return "failed";
  return "running";
}

function runLabel(status) {
  const labels = {
    complete: "جاهز للمراجعة",
    blocked: "تحتاج موافقتك",
    failed: "لم يكتمل",
    running: "قيد التنفيذ"
  };
  return labels[runState(status)] || "قيد التنفيذ";
}

function setSubmitState(active) {
  state.isSubmitting = active;
  dom.submitBtn.disabled = active;
  dom.intentInput.disabled = active;
  dom.submitLabel.textContent = active ? "جارٍ البدء" : "ابدأ";
  dom.composerHint.textContent = active ? "سُجل الهدف ويجري انتظار رد الخادم." : "يمكنك إرفاق صورة أو PDF حتى 25 MB.";
}

function recordEvent(title, body, tone = "neutral") {
  state.events.unshift({ title: safeText(title), body: safeText(body), tone, at: nowLabel() });
  renderEvents();
}

function setResultState(kind, label) {
  dom.resultSurface.className = `result-surface state-${kind}`;
  dom.runState.className = `state-chip ${kind}`;
  dom.runState.textContent = label;
}

function renderProjectFacts() {
  dom.projectLabel.textContent = state.projectTitle;
  dom.factProject.textContent = state.projectTitle;
  dom.factConnection.textContent = state.apiOnline ? "Ghadi API متصل" : "وضع محلي — لا يوجد اتصال خادمي";
}

function showRun(run) {
  state.currentRun = run;
  const status = runState(run.status);
  const title = status === "complete" ? "النتيجة جاهزة للمراجعة" : status === "blocked" ? "توقف العمل عند قرار منك" : status === "failed" ? "تعذر إكمال هذا التشغيل" : "يجري تحويل الهدف إلى عمل";
  const summary = safeText(run.result || run.requestSummary || run.intent || "استلم الخادم الهدف ويعد حالة قابلة للمراجعة.");

  dom.emptyResult.hidden = true;
  dom.runResult.hidden = false;
  dom.resultType.textContent = safeText(run.outputType || run.kind || "تشغيل");
  dom.runTime.textContent = nowLabel();
  dom.runTitle.textContent = title;
  dom.runSummary.textContent = summary;
  dom.resultEvidence.textContent = run.id ? `تشغيل موثق: ${run.id}` : "تشغيل موثق بواسطة Ghadi API";
  setResultState(status, runLabel(run.status));
  renderPlan(run.plan, status);
  renderPrimaryOutput(run);
  renderApproval(run);
  recordEvent("استلم Ghadi الهدف", status === "blocked" ? "أنشأ الخادم نقطة قرار قبل الأثر الخارجي." : "أعاد الخادم حالة تشغيل قابلة للمراجعة.", status);
}

function renderPrimaryOutput(run) {
  const output = safeText(run.modelOutput || run.output || run.artifact?.content || "");
  if (!output) {
    dom.primaryOutput.hidden = true;
    return;
  }
  dom.outputText.querySelector("code").textContent = output;
  dom.primaryOutput.hidden = false;
}

function renderPlan(plan, status) {
  const steps = Array.isArray(plan) && plan.length ? plan : [{ title: "تنسيق الهدف", description: "ينتظر Ghadi تفاصيل الخطة من الخادم.", status }];
  dom.planList.replaceChildren();
  for (const step of steps) {
    const item = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = `step-dot ${runState(step.status || status)}`;
    const copy = document.createElement("div");
    const strong = document.createElement("strong");
    const paragraph = document.createElement("p");
    strong.textContent = safeText(step.title || step.id, "خطوة عمل");
    paragraph.textContent = safeText(step.description || step.detail, "لا يوجد وصف إضافي لهذه الخطوة.");
    copy.append(strong, paragraph);
    item.append(dot, copy);
    dom.planList.append(item);
  }
}

function approvalFrom(run) {
  return run.approval || run.pendingApproval || (run.status === "awaiting_approval" ? { title: "أثر خارجي يحتاج قراراً", description: run.result || "أعاد الخادم حالة موافقة بدون تفاصيل كافية." } : null);
}

function renderApproval(run) {
  state.approval = approvalFrom(run);
  if (!state.approval) {
    dom.approvalCard.hidden = true;
    return;
  }
  dom.approvalTitle.textContent = safeText(state.approval.title || state.approval.action, "أثر خارجي مقترح");
  dom.approvalDescription.textContent = safeText(state.approval.description || state.approval.summary, "راجع تفاصيل الأثر قبل الموافقة.");
  dom.approvalCard.hidden = false;
}

function openApproval() {
  if (!state.approval) return;
  const facts = [
    ["الإجراء", state.approval.title || state.approval.action || "غير محدد"],
    ["الوصف", state.approval.description || state.approval.summary || "غير متاح"],
    ["الحالة", state.approval.status || "بانتظار قرار"],
    ["المعرف", state.approval.id || "يحتاج تفعيل الخادم"]
  ];
  dom.approvalFacts.replaceChildren();
  for (const [label, value] of facts) {
    const item = document.createElement("div");
    const small = document.createElement("small");
    const strong = document.createElement("strong");
    small.textContent = label;
    strong.textContent = safeText(value);
    item.append(small, strong);
    dom.approvalFacts.append(item);
  }
  dom.approvalModal.showModal();
}

function renderAttachments() {
  dom.attachmentShelf.replaceChildren();
  if (!state.attachments.length) {
    dom.attachmentShelf.hidden = true;
    return;
  }
  for (const record of state.attachments) {
    const token = document.createElement("div");
    token.className = `attachment-token ${record.status === "failed" ? "failed" : ""}`;
    const marker = document.createElement("i");
    const label = document.createElement("span");
    label.textContent = `${record.file.name} · ${record.label}`;
    token.title = `${record.file.name} — ${record.label}`;
    token.append(marker, label);
    dom.attachmentShelf.append(token);
  }
  dom.attachmentShelf.hidden = false;
  renderFiles();
}

function renderFiles() {
  dom.fileList.replaceChildren();
  if (!state.attachments.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.innerHTML = "<strong>لا يوجد سياق مرفق</strong><p>أرفق صورة أو PDF لتظهر حالته هنا.</p>";
    dom.fileList.append(empty);
    return;
  }
  for (const record of state.attachments) {
    const row = document.createElement("article");
    row.className = "file-row";
    const info = document.createElement("div");
    const title = document.createElement("strong");
    const meta = document.createElement("p");
    const status = document.createElement("span");
    title.textContent = record.file.name;
    meta.textContent = `${record.file.type || "application/octet-stream"} · ${humanSize(record.file.size)}`;
    status.className = `file-status ${record.status === "failed" ? "failed" : ""}`;
    status.textContent = record.label;
    info.append(title, meta);
    row.append(info, status);
    dom.fileList.append(row);
  }
}

function renderEvents() {
  dom.eventList.replaceChildren();
  if (!state.events.length) {
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.innerHTML = "<strong>لا يوجد سجل بعد</strong><p>تظهر هنا فقط الأحداث التي أعادها الخادم أو أثبتتها الواجهة.</p>";
    dom.eventList.append(empty);
    return;
  }
  for (const event of state.events) {
    const row = document.createElement("article");
    row.className = "event-row";
    const title = document.createElement("strong");
    const paragraph = document.createElement("p");
    const time = document.createElement("span");
    title.textContent = event.title;
    paragraph.textContent = event.body;
    time.className = "event-time";
    time.textContent = event.at;
    row.append(title, paragraph, time);
    dom.eventList.append(row);
  }
}

function allowedFile(file) {
  return file.type.startsWith("image/") || file.type === "application/pdf";
}

async function uploadFile(file) {
  if (!allowedFile(file)) throw new Error("يسمح Ghadi بالصور وملفات PDF فقط.");
  if (file.size > CONFIG.api.maxAttachmentBytes) throw new Error("حجم الملف أكبر من 25 MB.");
  const record = { file, status: "uploading", label: "جارٍ الإرفاق", url: "" };
  state.attachments.push(record);
  renderAttachments();
  recordEvent("أضيف سياق", `يجري إرفاق ${file.name} إلى المشروع.`, "running");
  try {
    const payload = await request("/attachments", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name),
        "x-session-id": state.sessionId,
        "x-project-id": state.projectId
      },
      body: file
    });
    const data = payload?.data || payload || {};
    record.status = "uploaded";
    record.label = "محفوظ في المشروع";
    record.url = data.url || data.downloadUrl || data.downloadURL || data.publicUrl || "";
    recordEvent("حُفظ السياق", `${file.name} أعاد الخادم تأكيداً بالحفظ.`, "complete");
  } catch (error) {
    record.status = "failed";
    record.label = "محلي — يحتاج تخزيناً خادمياً";
    record.url = URL.createObjectURL(file);
    recordEvent("لم يؤكد الخادم الحفظ", `${file.name}: ${error.message}`, "failed");
    showToast("ظهر الملف محلياً، لكن التخزين الخادمي لم يؤكد الحفظ.", "warning");
  }
  renderAttachments();
}

async function uploadFiles(files) {
  for (const file of [...files]) {
    try {
      await uploadFile(file);
    } catch (error) {
      showToast(`${file.name}: ${error.message}`, "error");
    }
  }
}

function normalizeRun(payload, intent) {
  const data = payload?.data || payload || {};
  return {
    id: data.id || data.runId || data.executionId || "",
    status: data.status || "running",
    intent: data.intent || intent,
    requestSummary: data.requestSummary,
    result: data.result || data.summary || data.message,
    modelOutput: data.modelOutput,
    output: data.output,
    outputType: data.outputType || data.artifact?.type,
    artifact: data.artifact,
    plan: data.plan,
    approval: data.approval || data.pendingApproval
  };
}

async function submitIntent(intent) {
  createProjectIdentity(intent);
  setSubmitState(true);
  setResultState("running", "قيد التنفيذ");
  dom.emptyResult.hidden = true;
  dom.runResult.hidden = false;
  dom.resultType.textContent = "الهدف";
  dom.runTime.textContent = nowLabel();
  dom.runTitle.textContent = "يجري فهم الهدف";
  dom.runSummary.textContent = "سيرد Ghadi فقط بما تم تسجيله أو ما يحتاج إلى قرار منك.";
  dom.primaryOutput.hidden = true;
  dom.approvalCard.hidden = true;
  dom.resultEvidence.textContent = "بانتظار Ghadi API";
  recordEvent("أرسل الهدف", "أرسلت الواجهة الطلب إلى غادي مع معرف جلسة ومشروع.", "running");

  try {
    const payload = await request("/submit", {
      method: "POST",
      headers: { "content-type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        request: intent,
        locale: "ar",
        projectId: state.projectId,
        sessionId: state.sessionId,
        attachmentRefs: state.attachments.filter((item) => item.status === "uploaded").map((item) => ({ name: item.file.name, url: item.url })),
        idempotencyKey: `${state.sessionId}:${Date.now()}`
      })
    });
    showRun(normalizeRun(payload, intent));
  } catch (error) {
    setResultState("failed", "لم يكتمل");
    dom.runTitle.textContent = "لم يتم إنشاء تشغيل خادمي";
    dom.runSummary.textContent = `لم يعد Ghadi API بتأكيد تشغيل: ${error.message}`;
    dom.resultEvidence.textContent = "لا توجد نتيجة خادمية موثقة";
    recordEvent("تعذر الوصول إلى Ghadi API", error.message, "failed");
    showToast("لم يؤكد الخادم إنشاء تشغيل. لم تُنفذ أي أدوات خارجية.", "error");
  } finally {
    setSubmitState(false);
  }
}

function changeDetail(section) {
  $$(".inspector-tab").forEach((tab) => {
    const active = tab.dataset.detail === section;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  $$(".detail-view").forEach((view) => {
    const active = view.id === `detail-${section}`;
    view.classList.toggle("active", active);
    view.hidden = !active;
  });
}

function openInspector(section = "project") {
  changeDetail(section);
  if (!dom.inspector.open) dom.inspector.showModal();
}

function downloadSnapshot() {
  const snapshot = {
    generatedAt: new Date().toISOString(),
    project: { id: state.projectId, title: state.projectTitle },
    api: { connected: state.apiOnline, base: state.apiBase },
    run: state.currentRun,
    attachments: state.attachments.map((item) => ({ name: item.file.name, type: item.file.type, size: item.file.size, status: item.status, url: item.url || null })),
    events: state.events,
    contractsLoaded: Boolean(state.contracts)
  };
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${CONFIG.exportName}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("نُزّلت لقطة JSON لما ظهر في الجلسة.");
}

function bindEvents() {
  dom.intentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.isSubmitting) return;
    const intent = dom.intentInput.value.trim();
    if (!intent) {
      showToast("اكتب الهدف الذي تريد الوصول إليه أولاً.", "warning");
      dom.intentInput.focus();
      return;
    }
    dom.intentInput.value = "";
    await submitIntent(intent);
  });
  dom.intentInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      dom.intentForm.requestSubmit();
    }
  });
  dom.attachBtn.addEventListener("click", () => dom.fileInput.click());
  dom.fileInput.addEventListener("change", async (event) => {
    await uploadFiles(event.target.files);
    event.target.value = "";
  });
  dom.openInspectorBtn.addEventListener("click", () => openInspector());
  dom.viewDetailsBtn.addEventListener("click", () => openInspector(state.currentRun ? "work" : "project"));
  dom.closeInspectorBtn.addEventListener("click", () => dom.inspector.close());
  $$(".inspector-tab").forEach((tab) => tab.addEventListener("click", () => changeDetail(tab.dataset.detail)));
  dom.reviewApprovalBtn.addEventListener("click", openApproval);
  dom.exportBtn.addEventListener("click", downloadSnapshot);
}

document.addEventListener("DOMContentLoaded", async () => {
  Object.assign(dom, {
    connectionDot: $("#connectionDot"), connectionLabel: $("#connectionLabel"), openInspectorBtn: $("#openInspectorBtn"),
    projectLabel: $("#projectLabel"), intentForm: $("#intentForm"), intentInput: $("#intentInput"), attachBtn: $("#attachBtn"),
    submitBtn: $("#submitBtn"), submitLabel: $("#submitLabel"), composerHint: $("#composerHint"), fileInput: $("#fileInput"), attachmentShelf: $("#attachmentShelf"),
    resultSurface: $("#resultSurface"), resultKicker: $("#resultKicker"), runState: $("#runState"), emptyResult: $("#emptyResult"), runResult: $("#runResult"),
    resultType: $("#resultType"), runTime: $("#runTime"), runTitle: $("#runTitle"), runSummary: $("#runSummary"), primaryOutput: $("#primaryOutput"), outputText: $("#outputText"),
    approvalCard: $("#approvalCard"), approvalTitle: $("#approvalTitle"), approvalDescription: $("#approvalDescription"), reviewApprovalBtn: $("#reviewApprovalBtn"), resultEvidence: $("#resultEvidence"), viewDetailsBtn: $("#viewDetailsBtn"),
    inspector: $("#inspector"), closeInspectorBtn: $("#closeInspectorBtn"), factProject: $("#factProject"), factConnection: $("#factConnection"), planList: $("#planList"), fileList: $("#fileList"), eventList: $("#eventList"), exportBtn: $("#exportBtn"),
    approvalModal: $("#approvalModal"), approvalFacts: $("#approvalFacts"), toastRegion: $("#toastRegion")
  });
  renderProjectFacts();
  renderAttachments();
  renderEvents();
  bindEvents();
  await Promise.all([loadContracts(), checkHealth()]);
});
