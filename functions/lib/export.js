"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeRun = safeRun;
exports.asJson = asJson;
exports.asMarkdown = asMarkdown;
function safeRun(run) {
    return {
        id: run.id,
        locale: run.locale,
        requestSummary: run.requestSummary,
        intent: run.intent,
        status: run.status,
        progress: run.progress,
        currentPhase: run.currentPhase,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        plan: run.plan,
        workers: run.workers,
        events: run.events,
        approvals: run.approvals,
        memory: run.memory,
        audit: run.audit,
        streamText: run.streamText,
        result: run.result,
        terminationReason: run.terminationReason,
        aiInvoked: run.aiInvoked,
    };
}
function asJson(run) {
    return JSON.stringify(safeRun(run), null, 2);
}
function asMarkdown(run) {
    const lines = [
        `# Ghadi Run ${run.id}`,
        "",
        `- **Intent:** ${run.intent}`,
        `- **Status:** ${run.status}`,
        `- **Progress:** ${run.progress}%`,
        `- **Created:** ${run.createdAt}`,
        `- **AI invoked:** ${run.aiInvoked ? "yes" : "no"}`,
        "",
        "## Request",
        "",
        run.requestSummary,
        "",
        "## Plan",
        "",
        ...run.plan.map((step, index) => `${index + 1}. **${step.title}** — ${step.description} _(${step.status}, ${step.toolCategory})`),
        "",
        "## Result",
        "",
        run.result || run.streamText || "No final result.",
        "",
        "## Audit",
        "",
        ...run.audit.map(item => `- ${item.at} — **${item.action}** — ${item.outcome} — ${item.details}`),
    ];
    return lines.join("\n");
}
//# sourceMappingURL=export.js.map