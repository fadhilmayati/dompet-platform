import { z } from "zod";

export const MessageRoleEnum = z.enum(["system", "user", "assistant"]);

export const ConversationMessageSchema = z.object({
  id: z.string().optional(),
  role: MessageRoleEnum,
  content: z.string(),
  name: z.string().optional(),
  timestamp: z.coerce.date().optional(),
  metadata: z.record(z.any()).optional(),
});

export const IntentNameEnum = z.enum([
  "record_transaction",
  "budget_summary",
  "general_question",
  "unknown",
]);

export const IntentSchema = z.object({
  intent: IntentNameEnum,
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional(),
});

export const TransactionSchema = z.object({
  amount: z.number().nullable(),
  currency: z.string().nullable(),
  occurredAt: z.string().nullable(),
  merchant: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  rawText: z.string().optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

export const RetrievalDocumentSchema = z.object({
  id: z.string(),
  userId: z.string(),
  content: z.string(),
  embedding: z.array(z.number()).optional(),
  metadata: z.record(z.any()).optional(),
  createdAt: z.coerce.date().optional(),
});

export const PlanStepTypeEnum = z.enum(["retrieval", "llm", "tool", "synthesis"]);

export const PlanStepSchema = z.object({
  id: z.string(),
  type: PlanStepTypeEnum,
  description: z.string(),
  action: z.string().optional(),
  tool: z.string().optional(),
  input: z.record(z.any()).optional(),
  dependsOn: z.array(z.string()).optional(),
});

export const PlanSchema = z.array(PlanStepSchema);

export const ToolExecutionResultSchema = z.object({
  tool: z.string(),
  status: z.enum(["success", "skipped", "error"]),
  output: z.any().optional(),
  error: z.string().optional(),
});

export const MonthlySummarySchema = z.object({
  summary: z.string(),
  highlights: z.array(z.string()),
  savingsOpportunities: z.array(z.string()),
  followUps: z.array(z.string()).optional(),
});

export const OrchestrationOptionsSchema = z
  .object({
    classification: z
      .object({
        provider: z.string().optional(),
        model: z.string().optional(),
      })
      .optional(),
    extraction: z
      .object({
        provider: z.string().optional(),
        model: z.string().optional(),
      })
      .optional(),
    summarization: z
      .object({
        provider: z.string().optional(),
        model: z.string().optional(),
        tone: z.enum(["formal", "friendly", "celebratory"]).optional(),
        month: z.string().optional(),
      })
      .optional(),
    retrieval: z
      .object({
        limit: z.number().int().min(1).max(50).optional(),
        batchSize: z.number().int().min(1).max(64).optional(),
        provider: z.string().optional(),
        model: z.string().optional(),
      })
      .optional(),
  })
  .optional();

export const OrchestrationRequestSchema = z.object({
  userId: z.string().min(1),
  conversation: z.array(ConversationMessageSchema).min(1),
  options: OrchestrationOptionsSchema,
});

export const OrchestrationResultSchema = z.object({
  intent: IntentSchema,
  plan: PlanSchema,
  result: z.object({
    message: z.string(),
    data: z.record(z.any()).optional(),
    documents: z.array(RetrievalDocumentSchema).optional(),
  }),
  metadata: z.object({
    toolResults: z.array(ToolExecutionResultSchema).optional(),
    executionTimeMs: z.number(),
  }),
});

export type ConversationMessage = z.infer<typeof ConversationMessageSchema>;
export type IntentName = z.infer<typeof IntentNameEnum>;
export type Intent = z.infer<typeof IntentSchema>;
export type Transaction = z.infer<typeof TransactionSchema>;
export type RetrievalDocument = z.infer<typeof RetrievalDocumentSchema>;
export type PlanStep = z.infer<typeof PlanStepSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type ToolExecutionResult = z.infer<typeof ToolExecutionResultSchema>;
export type MonthlySummary = z.infer<typeof MonthlySummarySchema>;
export type OrchestrationRequest = z.infer<typeof OrchestrationRequestSchema>;
export type OrchestrationResult = z.infer<typeof OrchestrationResultSchema>;
