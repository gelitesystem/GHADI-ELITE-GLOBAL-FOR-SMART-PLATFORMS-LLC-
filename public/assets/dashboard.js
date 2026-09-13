"use strict";

/* ============================================================
   GHADI AI — Commercial Operating System
   dashboard.js
   Backend: Firebase Functions (ghadiApi) via Hosting rewrites
   ------------------------------------------------------------
   Sections
   01. Config
   02. State
   03. DOM cache & controllers
   04. Utils
   05. DOM builders (XSS-safe)
   06. Toasts
   07. API client
   08. Event log
   09. Connection / health monitor
   10. Dialog
   11. View fragments
   12. Router
   13. Metrics (from /api/runs + /api/approvals)
   14. Work queue (from /api/runs)
   15. Status badge & time format
   16. Audit panel
   17. Submit (POST /api/submit)
   18. Attachments (POST /api/attachments)
   19. Context dialog
   20. Work item detail (GET /api/runs/:id)
   21. Bindings
   22. Boot
   ============================================================ */

/* ---------- 01. Config ---------- */
const CONFIG = Object.freeze({
  apiBase: "/api",
  requestTimeout: 18000,
  healthTimeout: 8000,
  uploadTimeout: 60000,
  healthInterval: 30000,
  maxFileSize: 25 * 1024 * 1024,
  maxToasts: 3,
  toastTtlMs: 4400,
  maxEvents: 60,
  locale: document.documentElement.lang || "en",
  routes: Object.freeze([
    "overview", "work", "crm", "marketing",
    "events", "trade", "compliance", "audit"
  ])
});

/* ---------- 02. State ---------- */
const state = {
  clientTraceId: (crypto.randomUUID?.() ?? `trace_${Date.now()}`),
  online: false,
  submitting: false,
  workspace: Object.freeze({ id: "ghadi-elite-global", label: "GHADI Elite Global" }),
  attachments: [],
  events: [],
  metrics: null,
  runs: null,
  activeView: "overview"
};

/* ---------- 03. DOM cache & controllers ---------- */
const dom = {};
const controllers = {
  page: new AbortController(),
  uploads: new Map()
};

/* ---------- 04. Utils ---------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clean = (v, fb = "") => v == null ? fb : (String(v).trim() || fb);

const numFmt  = new Intl.NumberFormat(CONFIG.locale);
const timeFmt = new Intl.DateTimeFormat(CONFIG.locale, { hour: "2-digit", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat(CONFIG.locale, { day: "2-digit", month: "short", year: "numeric" });

const fmtInt  = (n) => Number.isFinite(n) ? numFmt.format(n) : "—";
const fmtTime = () => timeFmt.format(new Date());
const fmtDate = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  return Number.isNaN(dt.getTime()) ? "—" : dateFmt.format(dt);
};
const reducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

/* ---------- 05. DOM builders (XSS-safe) ---------- */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "attrs") for (const [a, av] of Object.entries(value)) {
      if (av != null && av !== false) node.setAttribute(a, av);
    }
    else if (key === "style" && typeof value === "object") Object.assign(node.style, value);
    else if (key === "on" && typeof value === "object") {
      for (const [evt, fn] of Object.entries(value)) node.addEventListener(evt, fn);
    }
    else node[key] = value;
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function frag(children) {
  const f = document.createDocumentFragment();
  for (const c of children) if (c) f.append(c);
  return f;
}

const clear = (node) => { if (node) node.replaceChildren(); };

/* ---------- 06. Toasts ---------- */
const toastState = { list: [] };

function toast(message, tone = "neutral", ttl = CONFIG.toastTtlMs) {
  const text = clean(message);
  if (!text || !dom.toasts) return;
  const now = Date.now();
  if (toastState.list.some(t => t.text === text && t.tone === tone && now - t.at < 2000)) return;

  const node = el("div", { class: `toast is-${tone}`, text });
  dom.toasts.append(node);

  const entry = { text, tone, at: now, node };
  toastState.list.push(entry);
  while (toastState.list.length > CONFIG.maxToasts) toastState.list.shift()?.node.remove();

  setTimeout(() => {
    const i = toastState.list.indexOf(entry);
    if (i >= 0) toastState.list.splice(i, 1);
    node.remove();
  }, ttl);
}

/* ---------- 07. API client ---------- */
class ApiError extends Error {
  constructor(message, opts = {}) {
    super(message);
    this.name = "ApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.detail = opts.detail;
  }
}

async function api(path, { method = "GET", headers = {}, body, signal, timeout = CONFIG.requestTimeout } = {}) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(
    () => ctrl.abort(new DOMException("Timeout", "TimeoutError")),
    timeout
  );

  try {
    const res = await fetch(`${CONFIG.apiBase}${path}`, {
      method,
      headers: { Accept: "application/json", ...headers },
      body,
      credentials: "same-origin",
      cache: "no-store",
      signal: ctrl.signal
    });

    const type = res.headers.get("content-type") || "";
    const payload = type.includes("json")
      ? await res.json().catch(() => null)
      : await res.text();

    if (!res.ok) {
      const msg = payload && typeof payload === "object"
        ? payload.error?.message || payload.message || `HTTP ${res.status}`
        : String(payload || `HTTP ${res.status}`);
      throw new ApiError(msg, {
        status: res.status,
        code: payload?.error?.symbol || payload?.error?.code,
        detail: payload
      });
    }
    if (payload && typeof payload === "object" && payload.success === false) {
      throw new ApiError(
        payload.error?.message || payload.message || "Request failed",
        { code: payload.error?.symbol || payload.error?.code, detail: payload }
      );
    }
    return payload;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

/* ---------- 08. Event log ---------- */
function log(title, detail = "") {
  state.events.unshift({ title: clean(title), detail: clean(detail), at: fmtTime() });
  if (state.events.length > CONFIG.maxEvents) state.events.length = CONFIG.maxEvents;
}

/* ---------- 09. Connection / health monitor ---------- */
function setConnection(kind, label) {
  state.online = kind === "online";
  if (dom.connectionDot) dom.connectionDot.className = `connection__dot is-${kind}`;
  if (dom.connectionLabel) {
    dom.connectionLabel.textContent = label ?? (
      kind === "online"  ? "Connected"  :
      kind === "offline" ? "Offline"    :
                           "Checking…"
    );
  }
}

async function health() {
  if (!navigator.onLine) { setConnection("offline", "Device offline"); return; }
  setConnection("checking");
  try {
    const p = await api("/health", { timeout: CONFIG.healthTimeout });
    const d = p?.data || p || {};
    const ok =
      d.ok === true ||
      d.status === "healthy" ||
      d.engine === "healthy";
    setConnection(ok ? "online" : "offline", ok ? "Connected" : "Degraded");
  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      setConnection("offline", "Timeout");
    } else {
      setConnection("offline", "Unavailable");
    }
  }
}

function startHealthMonitor() {
  health();
  setInterval(() => { if (!document.hidden) health(); }, CONFIG.healthInterval);
  const s = controllers.page.signal;
  window.addEventListener("online", health, { signal: s });
  window.addEventListener("offline", () => setConnection("offline", "Device offline"), { signal: s });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) health();
  }, { signal: s });
}

/* ---------- 10. Dialog ---------- */
function openDialog({ title, eyebrow = "", body }) {
  if (!dom.dialog) return;
  if (dom.dialogTitle)   dom.dialogTitle.textContent   = clean(title);
  if (dom.dialogEyebrow) dom.dialogEyebrow.textContent = clean(eyebrow);
  clear(dom.dialogBody);
  if (body instanceof Node) dom.dialogBody.append(body);
  else if (Array.isArray(body)) dom.dialogBody.append(...body.filter(Boolean));
  if (!dom.dialog.open) dom.dialog.showModal();
}

function closeDialog() {
  if (dom.dialog?.open) dom.dialog.close();
}

/* ---------- 11. View fragments ---------- */
function factsGrid(items) {
  return el("div", { class: "facts" }, items.map(({ label, value }) =>
    el("div", { class: "fact" }, [
      el("span", { text: clean(label) }),
      el("b",    { text: clean(value, "—") })
    ])
  ));
}

function listBlock(items) {
  return el("div", { class: "list" }, items.map(({ title, detail }) =>
    el("div", { class: "list-item" }, [
      el("b", { text: clean(title) }),
      detail ? el("small", { text: clean(detail) }) : null
    ])
  ));
}

function emptyState({ title, hint }) {
  return el("div", { class: "empty-state" }, [
    el("strong", { text: clean(title) }),
    hint ? el("small", { text: clean(hint) }) : null
  ]);
}

const VIEW_META = Object.freeze({
  overview:   { title: "Overview",   subtitle: "" },
  work:       { title: "Work Queue", subtitle: "" },
  crm:        { title: "CRM",        subtitle: "" },
  marketing:  { title: "Marketing",  subtitle: "" },
  events:     { title: "Events",     subtitle: "" },
  trade:      { title: "Trade",      subtitle: "" },
  compliance: { title: "Compliance", subtitle: "" },
  audit:      { title: "Audit",      subtitle: "" }
});

/* ---------- 12. Router ---------- */
function parseRoute() {
  const h = location.hash.replace(/^#\/?/, "");
  return CONFIG.routes.includes(h) ? h : "overview";
}

function navigate(view) {
  if (!CONFIG.routes.includes(view)) return;
  if (parseRoute() === view) handleRoute();
  else location.hash = view;
}

function updateNav(view) {
  for (const link of dom.navLinks || []) {
    const on = link.dataset.view === view;
    link.classList.toggle("is-active", on);
    if (on) link.setAttribute("aria-current", "page");
    else    link.removeAttribute("aria-current");
  }
}

async function handleRoute() {
  const view = parseRoute();
  state.activeView = view;
  const meta = VIEW_META[view];
  if (dom.viewTitle)    dom.viewTitle.textContent    = meta.title;
  if (dom.viewSubtitle) dom.viewSubtitle.textContent = meta.subtitle || "";
  document.title = `GHADI — ${meta.title}`;
  updateNav(view);

  for (const panel of $$("[data-view-panel]", dom.viewRoot)) {
    panel.hidden = panel.dataset.viewPanel !== view;
  }

  if (view === "work")  await loadWorkQueue();
  if (view === "audit") renderAuditPanel();
}

/* ---------- 13. Metrics (from real endpoints) ---------- */
async function loadMetrics() {
  const cells = $$("[data-metric]", dom.viewRoot);
  cells.forEach(c => { c.textContent = "…"; });

  try {
    const [runsRes, approvalsRes] = await Promise.all([
      api("/runs?limit=100").catch(() => ({ data: [] })),
      api("/approvals").catch(() => ({ data: [] }))
    ]);

    const runs = Array.isArray(runsRes?.data)      ? runsRes.data      : [];
    const approvals = Array.isArray(approvalsRes?.data) ? approvalsRes.data : [];

    const isRunning = (s) => ["running", "queued", "in_progress"].includes(String(s || "").toLowerCase());
    const isDone    = (s) => ["completed", "done", "succeeded"].includes(String(s || "").toLowerCase());
    const isPending = (a) => ["pending", "awaiting", "review_required"].includes(
      String(a?.status || "").toLowerCase()
    );

    const counts = {
      runs:      runs.length,
      running:   runs.filter(r => isRunning(r.status)).length,
      pending:   approvals.filter(isPending).length,
      completed: runs.filter(r => isDone(r.status)).length
    };

    for (const c of cells) {
      const v = counts[c.dataset.metric];
      c.textContent = Number.isFinite(v) ? numFmt.format(v) : "—";
    }
    state.metrics = counts;
  } catch (err) {
    cells.forEach(c => { c.textContent = "—"; });
    log("Metrics unavailable", err.message);
  }
}

/* ---------- 14. Work queue (from /api/runs) ---------- */
async function loadWorkQueue() {
  const tbody = dom.workqueueBody;
  if (!tbody) return;
  clear(tbody);
  tbody.append(el("tr", {}, [
    el("td", { attrs: { colspan: "6" }, class: "muted", text: "Loading…" })
  ]));

  try {
    const res = await api("/runs?limit=50");
    const list = Array.isArray(res?.data) ? res.data : [];

    clear(tbody);

    if (!list.length) {
      tbody.append(el("tr", {}, [
        el("td", { attrs: { colspan: "6" } },
          [emptyState({
            title: "No runs yet",
            hint: "Submit a request from the composer above to create your first run."
          })])
      ]));
      state.runs = [];
      return;
    }

    state.runs = list;

    for (const run of list) {
      const id = clean(run.id || run.runId);
      tbody.append(el("tr", { dataset: { id } }, [
        el("td", { text: clean(run.request || run.input || run.title, "—") }),
        el("td", { text: clean(run.type    || run.domain || "Run") }),
        el("td", { text: clean(run.actor   || run.owner  || "System") }),
        el("td", {}, [statusBadge(run.status)]),
        el("td", {}, [el("time", { text: formatUpdated(run.createdAt || run.updatedAt) })]),
        el("td", { class: "table__action-col" }, [
          el("button", {
            class: "btn btn--sm",
            type: "button",
            dataset: { action: "open", id },
            text: "Open"
          })
        ])
      ]));
    }
  } catch (err) {
    clear(tbody);
    tbody.append(el("tr", {}, [
      el("td", { attrs: { colspan: "6" } },
        [emptyState({ title: "Unable to load runs", hint: err.message })])
    ]));
  }
}

/* ---------- 15. Status badge & time format ---------- */
function statusBadge(status) {
  const s = String(status || "").toLowerCase();
  const map = {
    "completed":          { cls: "is-ok",     label: "Completed" },
    "succeeded":          { cls: "is-ok",     label: "Succeeded" },
    "done":               { cls: "is-ok",     label: "Done" },
    "running":            { cls: "is-ok",     label: "Running" },
    "in_progress":        { cls: "is-ok",     label: "In progress" },
    "queued":             { cls: "is-warn",   label: "Queued" },
    "pending":            { cls: "is-warn",   label: "Pending" },
    "awaiting_approval":  { cls: "is-warn",   label: "Awaiting approval" },
    "failed":             { cls: "is-danger", label: "Failed" },
    "error":              { cls: "is-danger", label: "Error" },
    "rejected":           { cls: "is-danger", label: "Rejected" }
  };
  const cfg = map[s] || { cls: "", label: clean(status, "—") };
  return el("span", { class: `badge ${cfg.cls}`.trim(), text: cfg.label });
}

function formatUpdated(v) {
  if (!v) return "—";
  const d = typeof v?.toDate === "function" ? v.toDate() : new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  if (diff < 60_000)      return "Just now";
  if (diff < 3_600_000)   return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)  return `${Math.floor(diff / 3_600_000)}h ago`;
  return fmtDate(d);
}

/* ---------- 16. Audit panel ---------- */
function renderAuditPanel() {
  let panel = $('[data-view-panel="audit"]', dom.viewRoot);
  if (!panel) {
    panel = el("section", { class: "view", dataset: { viewPanel: "audit" } });
    dom.viewRoot.append(panel);
  }
  clear(panel);

  const items = state.events.length
    ? state.events.map(e => ({ title: e.title, detail: `${e.detail} · ${e.at}` }))
    : [{ title: "No activity", detail: "Session events will appear here." }];

  panel.append(
    el("section", { class: "card" }, [
      el("header", { class: "section__head" }, [
        el("h2", { text: "Session activity" })
      ]),
      listBlock(items)
    ])
  );
}

/* ---------- 17. Submit (POST /api/submit) ---------- */
function setSubmitting(busy) {
  state.submitting = busy;
  if (dom.submitBtn) {
    dom.submitBtn.disabled = busy;
    dom.submitBtn.setAttribute("aria-busy", String(busy));
  }
  if (dom.submitLabel) {
    dom.submitLabel.textContent = busy ? "Planning…" : "Plan Work";
  }
}

async function submit(intent) {
  if (state.submitting) return;
  const text = clean(intent);
  if (!text) { toast("Describe the work first.", "warning"); return; }

  setSubmitting(true);
  let succeeded = false;

  try {
    const ready = state.attachments.filter(a => a.status === "uploaded");
    const res = await api("/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        request:        text,
        locale:         CONFIG.locale,
        projectId:      state.workspace.id,
        clientTraceId:  state.clientTraceId,
        attachmentIds:  ready.map(a => a.id).filter(Boolean),
        idempotencyKey: `${state.clientTraceId}:${Date.now()}`
      })
    });

    const run = normalizeRun(res, text);
    renderRun(run);
    succeeded = true;
  } catch (err) {
    log("Submit failed", err.message);
    toast(`Submit failed: ${err.message}`, "error");
    openDialog({
      title:   "Submit not confirmed",
      eyebrow: "Server",
      body: frag([
        el("p", { class: "muted", text: "The browser did not perform any external effect. Your text has been preserved." }),
        factsGrid([{ label: "Error", value: err.message }])
      ])
    });
  } finally {
    setSubmitting(false);
    if (succeeded && dom.intentInput) dom.intentInput.value = "";
  }
}

function normalizeRun(payload, fallbackSummary) {
  const d = payload?.data || payload;
  if (!d || typeof d !== "object") throw new ApiError("Malformed server response.");
  const id = clean(d.id || d.runId || d.executionId);
  if (!id) throw new ApiError("Response is missing a run identifier.");
  return {
    id,
    status:   clean(d.status, "running"),
    summary:  clean(d.result || d.summary || d.message, fallbackSummary),
    plan:     Array.isArray(d.plan)  ? d.plan
            : Array.isArray(d.steps) ? d.steps
            : [],
    approval: d.approval || d.pendingApproval || null,
    type:     clean(d.outputType || d.artifact?.type, "Run")
  };
}

function renderRun(run) {
  const needsApproval = Boolean(run.approval) || run.status === "awaiting_approval";
  const plan = run.plan.length ? run.plan : [];

  const body = frag([
    el("p", { text: clean(run.summary) }),
    factsGrid([
      { label: "Run ID", value: run.id },
      { label: "Status", value: run.status },
      { label: "Type",   value: run.type }
    ]),
    plan.length ? el("h3", { text: "Workflow", style: { marginTop: "1.25rem" } }) : null,
    plan.length ? listBlock(plan.map((s, i) => ({
      title:  `${i + 1}. ${clean(s.title || s.id, "Step")}`,
      detail: clean(s.description || s.detail)
    }))) : null
  ]);

  openDialog({
    title:   needsApproval ? "Decision required" : "Work plan",
    eyebrow: needsApproval ? "Protected" : "Result",
    body
  });
  log("Run received", run.id);
}

/* ---------- 18. Attachments (POST /api/attachments) ---------- */
function attachmentAllowed(file) {
  return file?.type?.startsWith("image/") || file?.type === "application/pdf";
}

function renderAttachments() {
  if (!dom.attachmentShelf) return;
  clear(dom.attachmentShelf);
  if (!state.attachments.length) { dom.attachmentShelf.hidden = true; return; }
  dom.attachmentShelf.hidden = false;
  for (const a of state.attachments) {
    dom.attachmentShelf.append(
      el("span", {
        class: a.status === "failed" ? "is-failed" : "",
        text: `${a.file.name} · ${a.label}`
      })
    );
  }
}

async function upload(file) {
  if (!attachmentAllowed(file)) throw new Error("Only images and PDFs are allowed.");
  if (file.size > CONFIG.maxFileSize) throw new Error("File exceeds 25 MB.");

  const entry = { file, status: "uploading", label: "Uploading", id: "" };
  state.attachments.push(entry);
  renderAttachments();

  const ctrl = new AbortController();
  controllers.uploads.set(entry, ctrl);

  try {
    const res = await api("/attachments", {
      method: "POST",
      headers: {
        "content-type":   "application/octet-stream",
        "x-file-name":    encodeURIComponent(file.name),
        "x-client-trace": state.clientTraceId
      },
      body: file,
      signal: ctrl.signal,
      timeout: CONFIG.uploadTimeout
    });
    const d = res?.data || res || {};
    const id = clean(d.id || d.attachmentId);
    if (!id) throw new Error("Server did not confirm the attachment.");
    entry.id = id;
    entry.status = "uploaded";
    entry.label = "Ready";
    log("File uploaded", file.name);
  } catch (err) {
    entry.status = "failed";
    entry.label = err.name === "AbortError" ? "Cancelled" : "Failed";
    if (err.name !== "AbortError") {
      toast(`${file.name}: ${err.message}`, "warning");
    }
  } finally {
    controllers.uploads.delete(entry);
    renderAttachments();
  }
}

/* ---------- 19. Context dialog ---------- */
function showContext() {
  openDialog({
    title:   "Context",
    eyebrow: "Workspace",
    body: factsGrid([
      { label: "Workspace",    value: state.workspace.label },
      { label: "Connection",   value: state.online ? "Connected" : "Offline" },
      { label: "Client trace", value: state.clientTraceId.slice(0, 12) }
    ])
  });
}

/* ---------- 20. Work item detail (GET /api/runs/:id) ---------- */
async function openWorkItem(id) {
  if (!id) return;
  openDialog({
    title:   "Run details",
    eyebrow: "Loading…",
    body: el("p", { class: "muted", text: "Fetching from server…" })
  });

  try {
    const res = await api(`/runs/${encodeURIComponent(id)}`);
    const run = res?.data || res || {};

    const body = frag([
      factsGrid([
        { label: "Status",  value: run.status },
        { label: "Type",    value: run.type || run.domain },
        { label: "Actor",   value: run.actor || run.owner },
        { label: "Created", value: formatUpdated(run.createdAt) },
        { label: "Updated", value: formatUpdated(run.updatedAt) }
      ]),
      el("h3", { text: "Request", style: { marginTop: "1.25rem" } }),
      el("p", { text: clean(run.request || run.input) }),
      run.result || run.output
        ? frag([
            el("h3", { text: "Result", style: { marginTop: "1.25rem" } }),
            el("pre", {
              class: "result-pre",
              text: typeof (run.result || run.output) === "string"
                ? (run.result || run.output)
                : JSON.stringify(run.result || run.output, null, 2)
            })
          ])
        : null
    ]);

    openDialog({
      title:   clean(run.title || `Run ${id}`),
      eyebrow: "Run detail",
      body
    });
  } catch (err) {
    openDialog({
      title:   "Unable to load",
      eyebrow: "Error",
      body: el("p", { class: "muted", text: err.message })
    });
  }
}

/* ---------- 21. Bindings ---------- */
function bind() {
  const s = controllers.page.signal;

  dom.dialogClose?.addEventListener("click", closeDialog, { signal: s });
  dom.dialog?.addEventListener("click", (e) => {
    if (e.target === dom.dialog) closeDialog();
  }, { signal: s });

  dom.inspectorOpen?.addEventListener("click", showContext, { signal: s });

  dom.newWork?.addEventListener("click", () => {
    navigate("overview");
    requestAnimationFrame(() => {
      dom.intentInput?.focus();
      dom.intentInput?.scrollIntoView({
        behavior: reducedMotion() ? "auto" : "smooth",
        block: "center"
      });
    });
  }, { signal: s });

  dom.viewActivity?.addEventListener("click", () => navigate("audit"), { signal: s });

  dom.intentForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    submit(dom.intentInput.value);
  }, { signal: s });

  dom.fileInput?.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    for (const f of files) {
      try { await upload(f); }
      catch (err) { toast(`${f.name}: ${err.message}`, "error"); }
    }
  }, { signal: s });

  dom.workqueueBody?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const { action, id } = btn.dataset;
    if (action === "open" && id) openWorkItem(id);
  }, { signal: s });

  for (const link of dom.navLinks || []) {
    link.addEventListener("click", (e) => {
      const view = link.dataset.view;
      if (!CONFIG.routes.includes(view)) { e.preventDefault(); return; }
      if (parseRoute() === view) { e.preventDefault(); handleRoute(); }
    }, { signal: s });
  }

  window.addEventListener("hashchange", handleRoute, { signal: s });
}

/* ---------- 22. Boot ---------- */
function cacheDom() {
  Object.assign(dom, {
    connectionDot:   $("#js-connection-dot"),
    connectionLabel: $("#js-connection-label"),
    viewTitle:       $("#js-view-title"),
    viewSubtitle:    $("#js-view-subtitle"),
    inspectorOpen:   $("#js-inspector-open"),
    newWork:         $("#js-new-work"),
    viewRoot:        $("#js-view-root"),
    intentForm:      $("#js-intent-form"),
    intentInput:     $("#js-intent-input"),
    attachmentShelf: $("#js-attachment-shelf"),
    fileInput:       $("#js-file-input"),
    submitBtn:       $("#js-submit-btn"),
    submitLabel:     $("#js-submit-label"),
    viewActivity:    $("#js-view-activity"),
    workqueueBody:   $("#js-workqueue-body"),
    dialog:          $("#js-inspector"),
    dialogTitle:     $("#js-dialog-title"),
    dialogEyebrow:   $("#js-dialog-eyebrow"),
    dialogBody:      $("#js-dialog-body"),
    dialogClose:     $("#js-dialog-close"),
    toasts:          $("#js-toasts")
  });
  dom.navLinks = $$(".nav__link[data-view]");
}

async function boot() {
  cacheDom();
  bind();
  startHealthMonitor();
  await handleRoute();
  await loadMetrics();
  await loadWorkQueue();
  log("Session ready", state.clientTraceId.slice(0, 8));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}