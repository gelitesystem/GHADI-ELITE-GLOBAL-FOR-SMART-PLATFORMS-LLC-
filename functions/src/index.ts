import "./firebase-init"; // 🚀 هذا السطر يحل المشكلة ويجبر التهيئة قبل أي استيراد آخر
import "dotenv/config";
import express, { type Request, type Response } from "express";
import cors from "cors";
import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";

import { decisionSchema, submitSchema } from "./contracts";
import { storeAttachment } from "./attachments";
import { asJson, asMarkdown } from "./export";
import { ghadiEngine } from "./engine/ghadi-engine";

setGlobalOptions({ region: process.env.GHADI_REGION || "us-central1", maxInstances: 10, timeoutSeconds: 60, memory: "512MiB" });

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: true, methods: ["GET", "POST", "OPTIONS"], credentials: false }));
app.use(express.json({ limit: "1mb" }));

function sendError(res: Response, status: number, symbol: string, message: string) {
  return res.status(status).json({ success: false, error: { symbol, message } });
}

app.post(["/attachments", "/api/attachments"], express.raw({ type: "application/octet-stream", limit: "25mb" }), async (req, res) => {
  try {
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
    const record = await storeAttachment(buffer, String(req.header("x-file-name") || "attachment"), String(req.header("content-type") || "application/octet-stream"));
    return res.status(201).json({ success: true, data: record });
  } catch (error) {
    const code = error instanceof Error ? error.message : "attachment_failed";
    const status = code.includes("not_allowed") || code.includes("size") ? 400 : 500;
    return sendError(res, status, code, "The attachment could not be stored.");
  }
});

app.get(["/health", "/api/health"], async (_req, res) => {
  try {
    return res.json({ success: true, data: ghadiEngine.health() });
  } catch {
    return sendError(res, 503, "health_unavailable", "Backend health could not be determined.");
  }
});

app.post(["/submit", "/api/submit"], async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "invalid_request", "The request payload is invalid.");
  try {
    const run = await ghadiEngine.submit(parsed.data.request, parsed.data.locale, parsed.data.idempotencyKey);
    return res.status(201).json({ success: true, data: run });
  } catch (error) {
    console.error("[ghadi] submit failed", error instanceof Error ? error.message : "unknown");
    return sendError(res, 500, "submit_failed", "The task could not be submitted.");
  }
});

app.get(["/runs", "/api/runs"], async (req, res) => {
  try {
    const limit = Number(req.query.limit || 50);
    return res.json({ success: true, data: await ghadiEngine.listRuns(Number.isFinite(limit) ? limit : 50) });
  } catch (error) {
    console.error("[ghadi] list runs failed", error instanceof Error ? error.message : "unknown");
    return sendError(res, 500, "runs_unavailable", "Runs could not be loaded.");
  }
});

app.get(["/runs/:runId", "/api/runs/:runId"], async (req, res) => {
  try {
    const run = await ghadiEngine.getRun(String(req.params.runId));
    return run ? res.json({ success: true, data: run }) : sendError(res, 404, "run_not_found", "The requested run was not found.");
  } catch {
    return sendError(res, 500, "run_unavailable", "The requested run could not be loaded.");
  }
});

app.get(["/runs/:runId/export/:format", "/api/runs/:runId/export/:format"], async (req, res) => {
  const run = await ghadiEngine.getRun(String(req.params.runId));
  if (!run) return sendError(res, 404, "run_not_found", "The requested run was not found.");
  const format = String(req.params.format);
  if (format === "json") return res.type("application/json").send(asJson(run));
  if (format === "markdown") return res.type("text/markdown").send(asMarkdown(run));
  return sendError(res, 400, "unsupported_export", "Only JSON and Markdown exports are supported.");
});

app.get(["/approvals", "/api/approvals"], async (_req, res) => {
  try {
    return res.json({ success: true, data: await ghadiEngine.listApprovals() });
  } catch (error) {
    console.error("[ghadi] approvals failed", error instanceof Error ? error.message : "unknown");
    return sendError(res, 500, "approvals_unavailable", "Approvals could not be loaded.");
  }
});

app.post(["/approvals/:approvalId/decision", "/api/approvals/:approvalId/decision"], async (req, res) => {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, "invalid_decision", "The approval decision is invalid.");
  try {
    const run = await ghadiEngine.decideApproval(String(req.params.approvalId), parsed.data.decision);
    return run ? res.json({ success: true, data: run }) : sendError(res, 404, "approval_not_found", "The approval request was not found.");
  } catch (error) {
    console.error("[ghadi] decision failed", error instanceof Error ? error.message : "unknown");
    return sendError(res, 500, "decision_failed", "The approval decision could not be applied.");
  }
});

app.use((_req: Request, res: Response) => sendError(res, 404, "not_found", "The requested endpoint does not exist."));

export const ghadiApi = onRequest({ invoker: "public" }, app);
