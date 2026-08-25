/* GHADI AI Workspace — Quiet Command Surface: client describes and renders state; the server owns execution and external decisions. */
"use strict";

const CONFIG = Object.freeze({
  api: "/api",
  timeout: 18000,
  maxFile: 25 * 1024 * 1024,
  exportName: "ghadi-ai-workspace-snapshot",
  locale: document.documentElement.lang || "en",
});

const state = {
  sessionId: crypto.randomUUID?.() || `session_${Date.now()}_${Math.random().toString(16).slice(2)}`,
  online: false,
  submitting: false,
  workspace: { id: "", title: "Untitled workspace", owned: false },
  run: null,
  attachments: [],
  events: [],
  approval: null,
};

const dom = {};
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const clean = (value, fallback = "") => String(value ?? "").trim() || fallback;
const stamp = () => new Intl.DateTimeFormat(CONFIG.locale, { hour: "2-digit", minute: "2-digit" }).format(new Date());
const bytes = (value) => `${new Intl.NumberFormat(CONFIG.locale, { maximumFractionDigits: 1 }).format(Number(value || 0) / 1024 / 1024)} MB`;

function toast(message, tone = "neutral") {
  const node = document.createElement("div");
  node.className = `toast ${tone}`;
  node.textContent = message;
  dom.toastRegion.append(node);
  window.setTimeout(() => node.remove(), 4400);
}

function kind(status) {
  const normalized = clean(status, "pending").toLowerCase();
  if (["completed", "complete", "ready", "succeeded", "success"].includes(normalized)) return "complete";
  if (["awaiting_approval", "blocked", "waiting", "requires_approval"].includes(normalized)) return "blocked";
  if (["failed", "error", "cancelled"].includes(normalized)) return "failed";
  return "running";
}

function label(status) {
  return ({ complete: "Ready for review", blocked: "Decision required", failed: "Not completed", running: "In progress" })[kind(status)] || "In progress";
}

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), CONFIG.timeout);
  try {
    const response = await fetch(`${CONFIG.api}${path}`, { ...options, signal: controller.signal });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok || (payload && typeof payload === "object" && payload.success === false)) {
      const message = typeof payload === "object" ? payload?.error?.message || payload?.error?.symbol || payload?.message : payload;
      throw new Error(message || `HTTP ${response.status}`);
    }
    return payload;
  } finally {
    window.clearTimeout(timeout);
  }
}

function recordEvent(title, detail, tone = "neutral") {
  state.events.unshift({ title: clean(title), detail: clean(detail), tone, at: stamp() });
  dom.railTrace.textContent = clean(detail, "No trace recorded in this session.");
  renderEvents();
}

// دالة مساعدة لتحديث النصوص بأمان دون الحاجة لفحص كل عنصر يدويًا
const setText = (element, value) => {
  if (element) element.textContent = value;
};

function renderWorkspace() {
  setText(dom.projectLabel, state.workspace.title);
  setText(dom.factProject, state.workspace.title);
  setText(dom.ownershipLabel, state.workspace.owned ? "Owned project" : "Local session");
  setText(dom.factOwnership, state.workspace.owned ? "Server-confirmed ownership" : "Local session — identity is not enabled");
  setText(dom.factConnection, state.online ? "GHADI API connected" : "No confirmed server connection");
}



function setOnline(online) {
  state.online = online;
  dom.connectionDot.className = `connection-dot ${online ? "online" : "offline"}`;
  dom.connectionLabel.textContent = online ? "Connected" : "Offline";
  renderWorkspace();
}

async function health() {
  dom.connectionLabel.textContent = "Checking";
  try {
    const payload = await api("/health", { headers: { Accept: "application/json" } });
    const data = payload?.data || payload || {};
    setOnline(data.engine === "healthy" || data.status === "healthy");
  } catch {
    setOnline(false);
  }
}

function submitState(submitting) {
  state.submitting = submitting;
  dom.submitBtn.disabled = submitting;
  dom.intentInput.disabled = submitting;
  dom.submitLabel.textContent = submitting ? "Registering" : "Start work";
  dom.composerHint.textContent = submitting
    ? "Waiting for the server to confirm a run."
    : "Image or PDF, up to 25 MB. A file becomes working context only after server confirmation.";
}

function surface(status, message) {
  dom.resultSurface.className = `result-surface state-${status}`;
  dom.runState.className = `state-chip ${status}`;
  dom.runState.textContent = message;
}

function renderPath(status) {
  const step = kind(status);
  const items = $$(".execution-path li");
  items.forEach((item, index) => {
    item.classList.remove("path-active", "path-complete");
    if (step === "complete" && index < 2) item.classList.add("path-complete");
    if (step === "blocked" && index === 2) item.classList.add("path-active");
    if (step === "failed" && index === 1) item.classList.add("path-active");
    if (step === "running" && index === 0) item.classList.add("path-active");
    if (step === "complete" && index === 1) item.classList.add("path-active");
  });
}

function normalize(payload, intent) {
  if (!payload || typeof payload !== "object") throw new Error("The server response was not JSON.");
  const data = payload?.data || payload || {};
  const id = data.id || data.runId || data.executionId || "";
  if (!id) throw new Error("The server response did not include a run identifier.");
  return {
    id,
    status: data.status || "running",
    summary: data.result || data.summary || data.message || data.requestSummary || intent,
    output: data.modelOutput || data.output || data.artifact?.content || "",
    type: data.outputType || data.artifact?.type || data.kind || "Run",
    plan: data.plan || data.steps,
    approval: data.approval || data.pendingApproval,
    project: data.project || null,
  };
}

function showRun(run) {
  state.run = run;
  if (run.project?.id) {
    state.workspace = { id: run.project.id, title: clean(run.project.title, state.workspace.title), owned: true };
    renderWorkspace();
  }
  const currentKind = kind(run.status);
  dom.emptyResult.hidden = true;
  dom.runResult.hidden = false;
  dom.resultType.textContent = clean(run.type, "Run");
  dom.runTime.textContent = stamp();
  dom.runTitle.textContent = currentKind === "complete" ? "The outcome is ready for review" : currentKind === "blocked" ? "GHADI AI is waiting for a decision" : currentKind === "failed" ? "The run did not complete" : "Turning the outcome into reviewable work";
  dom.runSummary.textContent = clean(run.summary, "The server returned a reviewable run state.");
  dom.resultEvidence.textContent = run.id ? `Recorded run: ${run.id}` : "Server response without a run identifier";
  dom.railStatus.textContent = label(run.status);
  surface(currentKind, label(run.status));
  renderPath(run.status);
  renderOutput(run.output);
  renderPlan(run.plan, currentKind);
  renderApproval(run);
  recordEvent("Run update", currentKind === "blocked" ? "The server returned a protected decision point before any effect." : "The server returned a state that can be reviewed.", currentKind);
}

function renderOutput(value) {
  const output = clean(value);
  dom.primaryOutput.hidden = !output;
  if (output) dom.outputText.querySelector("code").textContent = output;
}

function empty(title, detail) {
  const node = document.createElement("div");
  const strong = document.createElement("strong");
  const paragraph = document.createElement("p");
  node.className = "empty-list";
  strong.textContent = title;
  paragraph.textContent = detail;
  node.append(strong, paragraph);
  return node;
}

function renderPlan(plan, currentStatus) {
  dom.planList.replaceChildren();
  const steps = Array.isArray(plan) && plan.length
    ? plan
    : [{ title: currentStatus === "running" ? "Waiting for a server update" : "No confirmed plan", description: currentStatus === "running" ? "GHADI AI shows work details when the server provides them." : "Only server-confirmed steps appear here." }];
  steps.forEach((step) => {
    const row = document.createElement("article");
    const dot = document.createElement("i");
    const content = document.createElement("div");
    const strong = document.createElement("strong");
    const paragraph = document.createElement("p");
    row.className = "plan-row";
    dot.className = `plan-dot ${kind(step.status || currentStatus)}`;
    strong.textContent = clean(step.title || step.id, "Work step");
    paragraph.textContent = clean(step.description || step.detail, "No additional description.");
    content.append(strong, paragraph);
    row.append(dot, content);
    dom.planList.append(row);
  });
}

function renderApproval(run) {
  state.approval = run.approval || (run.status === "awaiting_approval" ? { title: "External effect requires a decision", description: run.summary } : null);
  dom.approvalCard.hidden = !state.approval;
  if (state.approval) {
    dom.approvalTitle.textContent = clean(state.approval.title || state.approval.action, "Proposed external effect");
    dom.approvalDescription.textContent = clean(state.approval.description || state.approval.summary, "Review the details of this effect before approval.");
  }
}

function openApproval() {
  if (!state.approval) return;
  dom.approvalFacts.replaceChildren();
  [["Action", state.approval.title || state.approval.action || "Not specified"], ["Description", state.approval.description || state.approval.summary || "Not available"], ["State", state.approval.status || "Waiting for a decision"], ["Identifier", state.approval.id || "Not enabled"]].forEach(([term, value]) => {
    const row = document.createElement("div");
    const labelNode = document.createElement("small");
    const valueNode = document.createElement("strong");
    labelNode.textContent = term;
    valueNode.textContent = clean(value);
    row.append(labelNode, valueNode);
    dom.approvalFacts.append(row);
  });
  if (!dom.approvalModal.open) dom.approvalModal.showModal();
}

function renderFiles() {
  dom.attachmentShelf.replaceChildren();
  dom.fileList.replaceChildren();
  if (!state.attachments.length) {
    dom.attachmentShelf.hidden = true;
    dom.fileList.append(empty("No files", "Attach an image or PDF to see its acceptance state here."));
    return;
  }
  dom.attachmentShelf.hidden = false;
  state.attachments.forEach((attachment) => {
    const chip = document.createElement("div");
    const dot = document.createElement("i");
    const name = document.createElement("span");
    chip.className = `attachment-chip ${attachment.status === "failed" ? "failed" : ""}`;
    name.textContent = `${attachment.file.name} · ${attachment.label}`;
    chip.append(dot, name);
    dom.attachmentShelf.append(chip);

    const row = document.createElement("article");
    const info = document.createElement("div");
    const title = document.createElement("strong");
    const meta = document.createElement("p");
    const status = document.createElement("span");
    row.className = "file-row";
    title.textContent = attachment.file.name;
    meta.textContent = `${attachment.file.type || "application/octet-stream"} · ${bytes(attachment.file.size)}`;
    status.className = `file-status ${attachment.status === "failed" ? "failed" : ""}`;
    status.textContent = attachment.label;
    info.append(title, meta);
    row.append(info, status);
    dom.fileList.append(row);
  });
}

function renderEvents() {
  dom.eventList.replaceChildren();
  if (!state.events.length) {
    dom.eventList.append(empty("No activity yet", "GHADI AI records events the client proves or the server returns."));
    return;
  }
  state.events.forEach((activity) => {
    const row = document.createElement("article");
    const strong = document.createElement("strong");
    const paragraph = document.createElement("p");
    const time = document.createElement("span");
    row.className = "event-row";
    strong.textContent = activity.title;
    paragraph.textContent = activity.detail;
    time.className = "event-time";
    time.textContent = activity.at;
    row.append(strong, paragraph, time);
    dom.eventList.append(row);
  });
}

function allowedFile(file) {
  return file?.type?.startsWith("image/") || file?.type === "application/pdf";
}

async function upload(file) {
  if (!allowedFile(file)) throw new Error("Only images and PDF files are allowed.");
  if (file.size > CONFIG.maxFile) throw new Error("The file is larger than 25 MB.");
  const attachment = { file, status: "uploading", label: "Attaching", id: "", url: "" };
  state.attachments.push(attachment);
  renderFiles();
  recordEvent("Context added", `Sending ${file.name} to the server.`, "running");
  try {
    const payload = await api("/attachments", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name),
        "x-session-id": state.sessionId,
        "x-project-id": state.workspace.id || "session-pending",
      },
      body: file,
    });
    const data = payload?.data || payload || {};
    if (!data || typeof data !== "object") throw new Error("The server response was not JSON.");
    if (!(data.id || data.attachmentId || data.url || data.downloadUrl || data.downloadURL || data.publicUrl)) {
      throw new Error("The server response did not confirm an attachment identifier or reference.");
    }
    attachment.id = clean(data.id || data.attachmentId);
    attachment.url = clean(data.url || data.downloadUrl || data.downloadURL || data.publicUrl);
    attachment.status = "uploaded";
    attachment.label = "Server confirmed";
    recordEvent("File confirmed", `${file.name} is available for a run.`, "complete");
  } catch (error) {
    attachment.status = "failed";
    attachment.label = "Not confirmed by server";
    recordEvent("File could not be saved", `${file.name}: ${error.message}`, "failed");
    toast("The file is visible in this session, but server storage did not confirm it.", "warning");
  }
  renderFiles();
}

async function submit(intent) {
  submitState(true);
  surface("running", "In progress");
  renderPath("running");
  dom.emptyResult.hidden = true;
  dom.runResult.hidden = false;
  dom.resultType.textContent = "Outcome";
  dom.runTime.textContent = stamp();
  dom.runTitle.textContent = "Registering the outcome";
  dom.runSummary.textContent = "Waiting for GHADI API to confirm a run.";
  dom.primaryOutput.hidden = true;
  dom.approvalCard.hidden = true;
  dom.resultEvidence.textContent = "Waiting for GHADI API";
  recordEvent("Outcome submitted", "The interface sent the request to the relative /api route.", "running");
  try {
    const uploaded = state.attachments.filter((attachment) => attachment.status === "uploaded");
    const payload = await api("/submit", {
      method: "POST",
      headers: { "content-type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        request: intent,
        locale: CONFIG.locale,
        projectId: state.workspace.id || "session-pending",
        sessionId: state.sessionId,
        attachmentIds: uploaded.filter((attachment) => attachment.id).map((attachment) => attachment.id),
        attachmentRefs: uploaded.filter((attachment) => attachment.url).map((attachment) => ({ name: attachment.file.name, url: attachment.url })),
        idempotencyKey: `${state.sessionId}:${Date.now()}`,
      }),
    });
    showRun(normalize(payload, intent));
  } catch (error) {
    surface("failed", "Not completed");
    renderPath("failed");
    dom.runTitle.textContent = "The server did not confirm the run";
    dom.runSummary.textContent = `GHADI API did not return a recorded run: ${error.message}`;
    dom.resultEvidence.textContent = "No server-confirmed result";
    recordEvent("Run could not be created", error.message, "failed");
    toast("No server run was created. The interface did not perform an external effect.", "error");
  } finally {
    submitState(false);
  }
}

function detail(name) {
  $$(".inspector-tab").forEach((button) => {
    const active = button.dataset.detail === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  $$(".detail-view").forEach((view) => {
    const active = view.id === `detail-${name}`;
    view.hidden = !active;
    view.classList.toggle("active", active);
  });
}

function openInspector(section = "project") {
  detail(section);
  if (!dom.inspector.open) dom.inspector.showModal();
}

function exportSnapshot() {
  const data = {
    generatedAt: new Date().toISOString(),
    workspace: state.workspace,
    api: { base: CONFIG.api, connected: state.online },
    run: state.run,
    attachments: state.attachments.map((attachment) => ({ name: attachment.file.name, type: attachment.file.type, size: attachment.file.size, status: attachment.status, id: attachment.id || null })),
    activity: state.events,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${CONFIG.exportName}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("A snapshot of this displayed session was downloaded.");
}

function bind() {
  dom.intentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.submitting) return;
    const intent = dom.intentInput.value.trim();
    if (!intent) {
      toast("Describe the outcome first.", "warning");
      dom.intentInput.focus();
      return;
    }
    dom.intentInput.value = "";
    await submit(intent);
  });
  dom.intentInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      dom.intentForm.requestSubmit();
    }
  });
  dom.attachBtn.addEventListener("click", () => dom.fileInput.click());
  dom.fileInput.addEventListener("change", async (event) => {
    for (const file of [...event.target.files]) {
      try { await upload(file); } catch (error) { toast(`${file.name}: ${error.message}`, "error"); }
    }
    event.target.value = "";
  });
  dom.openInspectorBtn.addEventListener("click", () => openInspector());
  dom.viewDetailsBtn.addEventListener("click", () => openInspector(state.run ? "activity" : "project"));
  dom.closeInspectorBtn.addEventListener("click", () => dom.inspector.close());
  $$(".inspector-tab").forEach((button) => button.addEventListener("click", () => detail(button.dataset.detail)));
  dom.reviewApprovalBtn.addEventListener("click", openApproval);
  dom.exportBtn.addEventListener("click", exportSnapshot);
  dom.copyOutputBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(dom.outputText.textContent || "");
      toast("The output was copied to your clipboard.");
    } catch {
      toast("The browser could not copy the output.", "warning");
    }
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  Object.assign(dom, {
    projectLabel: $("#projectLabel"), ownershipLabel: $("#ownershipLabel"), connectionDot: $("#connectionDot"), connectionLabel: $("#connectionLabel"), openInspectorBtn: $("#openInspectorBtn"),
    intentForm: $("#intentForm"), intentInput: $("#intentInput"), attachBtn: $("#attachBtn"), fileInput: $("#fileInput"), attachmentShelf: $("#attachmentShelf"), submitBtn: $("#submitBtn"), submitLabel: $("#submitLabel"), composerHint: $("#composerHint"),
    resultSurface: $("#resultSurface"), runState: $("#runState"), emptyResult: $("#emptyResult"), runResult: $("#runResult"), resultType: $("#resultType"), runTime: $("#runTime"), runTitle: $("#runTitle"), runSummary: $("#runSummary"), primaryOutput: $("#primaryOutput"), outputText: $("#outputText"), copyOutputBtn: $("#copyOutputBtn"), approvalCard: $("#approvalCard"), approvalTitle: $("#approvalTitle"), approvalDescription: $("#approvalDescription"), reviewApprovalBtn: $("#reviewApprovalBtn"), resultEvidence: $("#resultEvidence"), viewDetailsBtn: $("#viewDetailsBtn"),
    inspector: $("#inspector"), closeInspectorBtn: $("#closeInspectorBtn"), factProject: $("#factProject"), factOwnership: $("#factOwnership"), factConnection: $("#factConnection"), planList: $("#planList"), eventList: $("#eventList"), fileList: $("#fileList"), exportBtn: $("#exportBtn"), approvalModal: $("#approvalModal"), approvalFacts: $("#approvalFacts"), toastRegion: $("#toastRegion"), railStatus: $("#railStatus"), railTrace: $("#railTrace"),
  });
  renderWorkspace();
  renderFiles();
  renderEvents();
  renderPath("running");
  bind();
  await health();
});
