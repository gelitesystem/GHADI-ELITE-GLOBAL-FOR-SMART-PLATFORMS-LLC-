"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.secureSubmitSchema = exports.decisionSchema = exports.submitSchema = exports.LIMITS = exports.toolCategories = void 0;
exports.safeSummary = safeSummary;
exports.redact = redact;
const zod_1 = require("zod");
exports.toolCategories = ["read", "write", "high_risk"];
exports.LIMITS = {
    maxSteps: 7,
    maxToolCalls: 12,
    maxRuntimeMs: 30_000,
    maxRetries: 2,
    maxRequestChars: 6000,
};
exports.submitSchema = zod_1.z.object({
    request: zod_1.z.string().trim().min(3).max(exports.LIMITS.maxRequestChars),
    locale: zod_1.z.enum(["ar", "en"]).default("ar"),
    idempotencyKey: zod_1.z.string().trim().min(8).max(128).optional(),
});
exports.decisionSchema = zod_1.z.object({ decision: zod_1.z.enum(["approved", "rejected"]) });
function safeSummary(value) {
    return value.replace(/\s+/g, " ").trim().slice(0, 280);
}
function redact(value) {
    return value
        .replace(/(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*([^\s,;]+)/gi, "$1=[REDACTED]")
        .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED_GOOGLE_KEY]");
}
exports.secureSubmitSchema = zod_1.z.object({
    request: zod_1.z.string().trim().min(3).max(5000),
    locale: zod_1.z.enum(["ar", "en"]).default("ar"),
    projectId: zod_1.z.string().trim().min(8).max(128),
    idempotencyKey: zod_1.z.string().trim().min(8).max(128).optional(),
    attachmentIds: zod_1.z.array(zod_1.z.string().trim().min(8).max(128)).max(12).default([])
});
//# sourceMappingURL=contracts.js.map