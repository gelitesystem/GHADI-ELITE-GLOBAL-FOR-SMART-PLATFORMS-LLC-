import { z } from "zod";

export const toolCategories = ["read", "write", "high_risk"] as const;
export type ToolCategory = (typeof toolCategories)[number];
export type RunStatus = "running" | "awaiting_approval" | "completed" | "blocked" | "failed";
export type StepStatus = "pending" | "running" | "completed" | "waiting" | "blocked";
export type Locale = "ar" | "en";

export const LIMITS = {
  maxSteps: 7,
  maxToolCalls: 12,
  maxRuntimeMs: 30_000,
  maxRetries: 2,
  maxRequestChars: 6000,
} as const;

export const submitSchema = z.object({
  request: z.string().trim().min(3).max(LIMITS.maxRequestChars),
  locale: z.enum(["ar", "en"]).default("ar"),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

export const decisionSchema = z.object({ decision: z.enum(["approved", "rejected"]) });

export interface PlanStep {
  id: string;
  title: string;
  description: string;
  tool: string;
  toolCategory: ToolCategory;
  workerId: string;
  status: StepStatus;
  requiresApproval: boolean;
}

export interface Worker {
  id: string;
  name: string;
  role: string;
  status: "idle" | "working" | "waiting" | "completed" | "blocked";
  currentStepId?: string;
  lastEvent: string;
}

export interface Approval {
  id: string;
  runId: string;
  requestedAction: string;
  toolCategory: "high_risk";
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  decidedAt?: string;
  decision?: "approved" | "rejected";
}

export interface EventRecord {
  id: string;
  at: string;
  type: "observation" | "plan" | "worker" | "approval" | "verification" | "result" | "guardrail";
  message: string;
  severity: "info" | "success" | "warning" | "critical";
  workerId?: string;
  stepId?: string;
}

export interface AuditRecord {
  id: string;
  at: string;
  category: "request" | "plan" | "tool" | "approval" | "result" | "guardrail";
  action: string;
  outcome: "accepted" | "completed" | "blocked" | "pending";
  runId: string;
  details: string;
  workerId?: string;
  tool?: string;
  toolCategory?: ToolCategory;
}

export interface MemoryEvidence {
  availability: "available" | "unavailable";
  documentId?: string;
  source?: string;
  content?: string;
  relevance?: number;
  reason?: string;
}

export interface RunRecord {
  id: string;
  idempotencyKey?: string;
  locale: Locale;
  requestSummary: string;
  intent: string;
  status: RunStatus;
  progress: number;
  currentPhase: string;
  createdAt: string;
  updatedAt: string;
  phaseStartedAt: string;
  retryCount: number;
  toolCalls: number;
  plan: PlanStep[];
  workers: Worker[];
  events: EventRecord[];
  approvals: Approval[];
  memory: MemoryEvidence[];
  audit: AuditRecord[];
  streamText: string;
  modelOutput?: string;
  aiInvoked: boolean;
  result?: string;
  terminationReason?: string;
}

export interface Health {
  engine: "healthy";
  executionMode: "safe_server";
  stateStore: "firestore" | "unavailable";
  firestoreDatabaseId: string;
  gemini: "not_configured" | "configured_not_enabled" | "enabled";
  rag: "not_configured";
  limits: typeof LIMITS;
}

export function safeSummary(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 280);
}

export function redact(value: string): string {
  return value
    .replace(/(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*([^\s,;]+)/gi, "$1=[REDACTED]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED_GOOGLE_KEY]");
}

export const secureSubmitSchema = z.object({
  request: z.string().trim().min(3).max(5000),
  locale: z.enum(["ar", "en"]).default("ar"),
  projectId: z.string().trim().min(8).max(128),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
  attachmentIds: z.array(z.string().trim().min(8).max(128)).max(12).default([])
});
