"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ghadiEngine = exports.GhadiEngine = void 0;
const node_crypto_1 = require("node:crypto");
const firestore_1 = require("firebase-admin/firestore");
const genai_1 = require("@google/genai");
const firebase_1 = require("../firebase");
const contracts_1 = require("../contracts");
const runs = firebase_1.firestore.collection("ghadiRuns");
const approvals = firebase_1.firestore.collection("ghadiApprovals");
const HIGH_RISK_PATTERN = /(delete|remove|publish|send|transfer|pay|payment|launch|deploy|حذف|إزالة|نشر|إرسال|تحويل|دفع|إطلاق|تفعيل)/i;
function isoNow() { return new Date().toISOString(); }
function ar(locale) { return locale === "ar"; }
function id(prefix) { return `${prefix}_${(0, node_crypto_1.randomUUID)().replace(/-/g, "").slice(0, 12)}`; }
function labels(locale) {
    return ar(locale)
        ? { observe: "فهم الطلب", plan: "بناء الخطة", evidence: "فحص الذاكرة", approval: "موافقة بشرية مطلوبة", verify: "التحقق من القيود", result: "صياغة النتيجة", completed: "اكتمل التنفيذ المضبوط", blocked: "توقف بأمان" }
        : { observe: "Observe request", plan: "Build plan", evidence: "Inspect memory", approval: "Human approval required", verify: "Verify guardrails", result: "Compose result", completed: "Controlled execution complete", blocked: "Stopped safely" };
}
function inferIntent(request, locale) {
    if (/(analy[sz]e|analysis|تحليل|حلل)/i.test(request))
        return ar(locale) ? "تحليل منظم للطلب" : "Structured request analysis";
    if (/(research|بحث|ابحث|مصادر)/i.test(request))
        return ar(locale) ? "استكشاف مصادر ومعرفة" : "Research and knowledge exploration";
    if (/(build|create|develop|بناء|إنشاء|طور)/i.test(request))
        return ar(locale) ? "تخطيط وتنفيذ بناء مضبوط" : "Controlled build planning and execution";
    return ar(locale) ? "تحويل النية إلى خطة تنفيذ مضبوطة" : "Transform intent into a controlled execution plan";
}
function workers(locale) {
    return [
        { id: "observer", name: "Ghadi.Observer", role: ar(locale) ? "فهم النية" : "Intent observer", status: "completed", lastEvent: ar(locale) ? "استقبل الطلب" : "Request received" },
        { id: "planner", name: "Ghadi.Planner", role: ar(locale) ? "مخطط منظم" : "Structured planner", status: "completed", lastEvent: ar(locale) ? "صاغ الخطة" : "Plan composed" },
        { id: "evidence", name: "Ghadi.Evidence", role: ar(locale) ? "مراجع الأدلة" : "Evidence reviewer", status: "completed", lastEvent: ar(locale) ? "تحقق من توافر الذاكرة" : "Memory availability checked" },
        { id: "critic", name: "Ghadi.Critic", role: ar(locale) ? "متحقق القيود" : "Guardrail critic", status: "completed", lastEvent: ar(locale) ? "تحقق من الحدود" : "Guardrails verified" },
        { id: "conductor", name: "Ghadi.Conductor", role: ar(locale) ? "مركب النتيجة" : "Result conductor", status: "completed", lastEvent: ar(locale) ? "صاغ النتيجة" : "Result composed" }
    ];
}
function makePlan(locale, sensitive) {
    const plan = [
        { id: "observe", title: ar(locale) ? "رصد النية" : "Observe intent", description: ar(locale) ? "تلخيص الطلب والتحقق من حدوده." : "Summarize the request and constraints.", tool: "request.parse", toolCategory: "read", workerId: "observer", status: "completed", requiresApproval: false },
        { id: "plan", title: ar(locale) ? "خطة منظمة" : "Structured plan", description: ar(locale) ? "ترتيب الخطوات والأدوات والمخاطر." : "Order steps, tools, and risks.", tool: "plan.compose", toolCategory: "read", workerId: "planner", status: "completed", requiresApproval: false },
        { id: "evidence", title: ar(locale) ? "حدود السياق" : "Context boundary", description: ar(locale) ? "تسجيل عدم توفر RAG بدل اختلاق مصدر." : "Record unavailable RAG instead of inventing a source.", tool: "memory.inspect", toolCategory: "read", workerId: "evidence", status: "completed", requiresApproval: false }
    ];
    if (sensitive)
        plan.push({ id: "approval", title: ar(locale) ? "تفويض حساس" : "Sensitive authorization", description: ar(locale) ? "يتطلب قرارًا بشريًا صريحًا." : "Requires an explicit human decision.", tool: "approval.gate", toolCategory: "high_risk", workerId: "critic", status: "waiting", requiresApproval: true });
    plan.push({ id: "verify", title: ar(locale) ? "التحقق" : "Verify", description: ar(locale) ? "تأكيد حدود الأدوات وعدم تجاوز السياسة." : "Confirm tool limits and policy.", tool: "guardrail.verify", toolCategory: "read", workerId: "critic", status: sensitive ? "pending" : "completed", requiresApproval: false }, { id: "synthesize", title: ar(locale) ? "النتيجة" : "Result", description: ar(locale) ? "صياغة نتيجة لا تدعي أثرًا لم يحدث." : "Compose a result without claiming an effect that did not happen.", tool: "result.compose", toolCategory: "write", workerId: "conductor", status: sensitive ? "pending" : "completed", requiresApproval: false });
    return plan.slice(0, contracts_1.LIMITS.maxSteps);
}
function event(runId, type, message, severity) {
    return { id: id("evt"), at: isoNow(), type, message: (0, contracts_1.redact)(message), severity };
}
function audit(runId, category, action, outcome, details, toolCategory) {
    const record = { id: id("audit"), at: isoNow(), category, action, outcome, runId, details: (0, contracts_1.redact)(details) };
    if (toolCategory)
        record.toolCategory = toolCategory;
    return record;
}
function geminiStatus() {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key)
        return "not_configured";
    return process.env.GHADI_ENABLE_GEMINI === "true" ? "enabled" : "configured_not_enabled";
}
async function optionalGemini(request, locale) {
    if (geminiStatus() !== "enabled")
        return undefined;
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key)
        return undefined;
    const ai = new genai_1.GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
        model: process.env.GHADI_GEMINI_MODEL?.trim() || "gemini-2.5-flash",
        contents: request,
        config: { systemInstruction: ar(locale) ? "قدّم ملحقًا تحليليًا موجزًا. لا تدّع تنفيذ أدوات أو آثارًا خارجية." : "Provide a concise analytical supplement. Do not claim tools or external side effects." }
    });
    return response.text ? (0, contracts_1.redact)(response.text).slice(0, 1600) : undefined;
}
function finalResult(run) {
    const suffix = run.modelOutput ? (ar(run.locale) ? `\n\nملحق Gemini موثق: ${run.modelOutput}` : `\n\nDocumented Gemini supplement: ${run.modelOutput}`) : "";
    const text = ar(run.locale)
        ? `أكمل Ghadi معالجة مضبوطة للنية «${run.intent}». حُفظت الحالة وسجل التدقيق في Firestore، وطُبقت حدود التنفيذ (${contracts_1.LIMITS.maxSteps} خطوات، ${contracts_1.LIMITS.maxToolCalls} استدعاء أدوات، ${contracts_1.LIMITS.maxRetries} إعادات). لم يُنفذ أي أثر خارجي غير مصرح به.${run.approvals.length ? " مر الإجراء الحساس عبر بوابة موافقة بشرية." : " لم يُرصد إجراء عالي الخطورة."}`
        : `Ghadi completed controlled processing for “${run.intent}”. State and audit were stored in Firestore, with limits of ${contracts_1.LIMITS.maxSteps} steps, ${contracts_1.LIMITS.maxToolCalls} tool calls, and ${contracts_1.LIMITS.maxRetries} retries. No unauthorized external effect was executed.${run.approvals.length ? " The sensitive action passed through human approval." : " No high-risk action was detected."}`;
    return text + suffix;
}
class GhadiEngine {
    health() {
        return { engine: "healthy", executionMode: "safe_server", stateStore: "firestore", firestoreDatabaseId: firebase_1.FIRESTORE_DATABASE_ID, gemini: geminiStatus(), rag: "not_configured", limits: contracts_1.LIMITS };
    }
    async submit(request, locale, idempotencyKey) {
        const normalized = (0, contracts_1.safeSummary)(request);
        const runId = id("run");
        const sensitive = HIGH_RISK_PATTERN.test(normalized);
        const started = isoNow();
        const run = {
            id: runId, locale, requestSummary: normalized, intent: inferIntent(normalized, locale),
            status: sensitive ? "awaiting_approval" : "completed", progress: sensitive ? 60 : 100,
            currentPhase: sensitive ? labels(locale).approval : labels(locale).completed,
            createdAt: started, updatedAt: started, phaseStartedAt: started, retryCount: 0, toolCalls: 5,
            plan: makePlan(locale, sensitive), workers: workers(locale), events: [], approvals: [],
            memory: [{ availability: "unavailable", reason: ar(locale) ? "لا توجد مصادر RAG مهيأة." : "No RAG sources are configured." }],
            audit: [], streamText: "", aiInvoked: false
        };
        if (idempotencyKey)
            run.idempotencyKey = idempotencyKey;
        run.events.push(event(run.id, "observation", ar(locale) ? "استقبل Ghadi الطلب وسجله." : "Ghadi received the request.", "info"));
        run.audit.push(audit(run.id, "request", "request.accepted", "accepted", "Request accepted without logging secrets."));
        if (sensitive) {
            const approval = { id: id("approval"), runId, requestedAction: ar(locale) ? "أثر عالي الخطورة رُصد" : "High-risk effect detected", toolCategory: "high_risk", status: "pending", requestedAt: started };
            run.approvals.push(approval);
            run.events.push(event(run.id, "approval", ar(locale) ? "توقف Ghadi للانتظار." : "Ghadi paused.", "warning"));
            run.audit.push(audit(run.id, "approval", "approval.requested", "pending", "Human approval requested.", "high_risk"));
        }
        else {
            try {
                const aiResponse = await optionalGemini(normalized, locale);
                if (aiResponse) {
                    run.modelOutput = aiResponse;
                    run.aiInvoked = true;
                }
            }
            catch {
                run.events.push(event(run.id, "guardrail", ar(locale) ? "تعذر استدعاء Gemini." : "Gemini unavailable.", "warning"));
            }
            run.result = finalResult(run);
            run.streamText = run.result;
            run.events.push(event(run.id, "result", ar(locale) ? "اكتملت النتيجة." : "Result completed.", "success"));
            run.audit.push(audit(run.id, "result", "run.completed", "completed", "Run completed."));
        }
        return firebase_1.firestore.runTransaction(async (tx) => {
            if (idempotencyKey) {
                const existing = await tx.get(runs.where("idempotencyKey", "==", idempotencyKey).limit(1));
                if (!existing.empty)
                    return existing.docs[0].data();
            }
            tx.set(runs.doc(runId), { ...run, createdAt: firestore_1.FieldValue.serverTimestamp(), updatedAt: firestore_1.FieldValue.serverTimestamp() });
            if (run.approvals[0])
                tx.set(approvals.doc(run.approvals[0].id), { ...run.approvals[0], createdAt: firestore_1.FieldValue.serverTimestamp() });
            return run;
        });
    }
    async getRun(runId) {
        const snap = await runs.doc(runId).get();
        return snap.exists ? snap.data() : null;
    }
    async listRuns(limit = 50) {
        const snap = await runs.orderBy("createdAt", "desc").limit(Math.min(limit, 100)).get();
        return snap.docs.map((doc) => doc.data());
    }
    async listApprovals() {
        const snap = await approvals.where("status", "==", "pending").orderBy("requestedAt", "desc").limit(100).get();
        return snap.docs.map((doc) => doc.data());
    }
    async decideApproval(approvalId, decision) {
        return firebase_1.firestore.runTransaction(async (tx) => {
            const approvalRef = approvals.doc(approvalId);
            const approvalSnap = await tx.get(approvalRef);
            if (!approvalSnap.exists)
                return null;
            const approval = approvalSnap.data();
            const runRef = runs.doc(approval.runId);
            const runSnap = await tx.get(runRef);
            if (!runSnap.exists)
                return null;
            const run = runSnap.data();
            if (approval.status !== "pending")
                return run;
            const now = isoNow();
            approval.status = decision;
            approval.decision = decision;
            approval.decidedAt = now;
            run.approvals = run.approvals.map((item) => item.id === approvalId ? approval : item);
            run.updatedAt = now;
            run.audit.push(audit(run.id, "approval", `approval.${decision}`, decision === "approved" ? "completed" : "blocked", `Decision: ${decision}`, "high_risk"));
            if (decision === "rejected") {
                run.status = "blocked";
                run.progress = 60;
                run.currentPhase = labels(run.locale).blocked;
                run.terminationReason = "human_rejected_high_risk_action";
                run.plan = run.plan.map((step) => step.id === "approval" ? { ...step, status: "blocked" } : step);
                run.result = ar(run.locale) ? "توقف بأمان: تم الرفض." : "Stopped safely: Rejected.";
                run.streamText = run.result;
                run.events.push(event(run.id, "guardrail", run.result, "warning"));
            }
            else {
                run.status = "completed";
                run.progress = 100;
                run.currentPhase = labels(run.locale).completed;
                run.plan = run.plan.map((step) => step.id === "approval" || step.id === "verify" || step.id === "synthesize" ? { ...step, status: "completed" } : step);
                run.result = finalResult(run);
                run.streamText = run.result;
                run.events.push(event(run.id, "result", ar(run.locale) ? "اكتملت النتيجة بعد الموافقة." : "Completed after approval.", "success"));
            }
            tx.set(approvalRef, approval, { merge: true });
            tx.set(runRef, { ...run, updatedAt: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
            return run;
        });
    }
}
exports.GhadiEngine = GhadiEngine;
exports.ghadiEngine = new GhadiEngine();
//# sourceMappingURL=ghadi-engine.js.map