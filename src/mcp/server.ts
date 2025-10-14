import { createHash, randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  customers,
  idempotencyKeys,
  paymentIntents,
  tenants,
  type Customer,
  type PaymentIntent,
  type Tenant,
} from "../../drizzle/schema";
import { listInsights } from "../storage/insights";
import { computeMonthlyMemory } from "../memory/monthly";
import { scoreFinancialHealth } from "../score/health";
import { suggestActions } from "../actions/suggest";
import { simulateAdjustments } from "../simulator/simulate";
import {
  type BalanceSheet,
  type FinancialGoals,
  type HealthScoreResult,
  type KPISet,
  type MonthlyInsight,
  type SimulationResult,
  type SuggestedAction,
  type Transaction as MonthlyTransaction,
  type TransactionType,
} from "../types";
import { ZodError, z } from "zod";

export type ToolName =
  | "transactions.create"
  | "transactions.list"
  | "insights.compute"
  | "insights.list"
  | "health.score"
  | "actions.suggest"
  | "simulations.run";

const TransactionTypeEnum = z.enum([
  "income",
  "expense",
  "investment",
  "debt",
  "transfer",
]);

const TransactionRecordSchema = z.object({
  id: z.string(),
  amount: z.number(),
  currency: z.string().min(3).max(3),
  type: TransactionTypeEnum,
  category: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  occurredAt: z.string(),
  createdAt: z.string(),
  status: z.string(),
  metadata: z.record(z.any()).optional(),
});

const BalanceSheetSchema = z
  .object({
    cash: z.number().optional(),
    investments: z.number().optional(),
    debt: z.number().optional(),
  })
  .partial();

const FinancialGoalsSchema = z
  .object({
    savingsRate: z.number().optional(),
    investmentRate: z.number().optional(),
    debtToIncome: z.number().optional(),
    expenseCapRatio: z.number().optional(),
  })
  .partial();

const KpiValueSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number(),
  unit: z.enum(["currency", "ratio", "percentage"]).optional(),
  delta: z.number().optional(),
  goal: z.number().optional(),
});

const KpiSetSchema: z.ZodType<KPISet> = z.record(KpiValueSchema);

const MonthlyInsightSchema: z.ZodType<MonthlyInsight> = z.object({
  id: z.string(),
  userId: z.string(),
  month: z.string(),
  kpis: KpiSetSchema,
  story: z.string(),
  createdAt: z.string(),
});

const HealthScoreComponentSchema = z.object({
  key: z.string(),
  label: z.string(),
  score: z.number(),
  weight: z.number(),
  message: z.string(),
});

const HealthScoreResultSchema: z.ZodType<HealthScoreResult> = z.object({
  total: z.number(),
  components: z.array(HealthScoreComponentSchema),
  notes: z.array(z.string()),
});

const SuggestedActionSchema: z.ZodType<SuggestedAction> = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.enum(["income", "expense", "debt", "investment", "savings"]),
  rationale: z.string(),
  expectedImpact: z.string(),
});

const SimulationResultSchema: z.ZodType<SimulationResult> = z.object({
  projectedInsight: MonthlyInsightSchema,
  projectedHealth: HealthScoreResultSchema,
  adjustments: z.record(z.number()),
});

const MonthStringSchema = z
  .string()
  .regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM month format");

export const transactionsCreateInputSchema = z.object({
  idempotencyKey: z.string().min(1, "idempotencyKey is required"),
  reference: z.string().min(1).optional(),
  amount: z.number().finite(),
  currency: z
    .string()
    .min(3)
    .max(3)
    .transform((value) => value.toUpperCase()),
  type: TransactionTypeEnum,
  category: z.string().nullish(),
  description: z.string().nullish(),
  notes: z.string().nullish(),
  occurredAt: z
    .string()
    .datetime({ offset: true })
    .or(z.string().datetime().transform((value) => new Date(value).toISOString()))
    .optional(),
  metadata: z.record(z.any()).optional(),
  status: z.string().optional(),
  rawText: z.string().optional(),
});

export type TransactionsCreateInput = z.infer<typeof transactionsCreateInputSchema>;

export const transactionsCreateResultSchema = z.object({
  transaction: TransactionRecordSchema,
  idempotency: z.object({ replayed: z.boolean() }),
});

export type TransactionsCreateResult = z.infer<typeof transactionsCreateResultSchema>;

export const transactionsListInputSchema = z.object({
  month: MonthStringSchema.optional(),
  limit: z.number().int().min(1).max(200).default(50),
  includeMetadata: z.boolean().default(false),
});

export type TransactionsListInput = z.infer<typeof transactionsListInputSchema>;

export const transactionsListResultSchema = z.object({
  transactions: z.array(TransactionRecordSchema),
});

export type TransactionsListResult = z.infer<typeof transactionsListResultSchema>;

export const insightsComputeInputSchema = z.object({
  month: MonthStringSchema,
  balances: BalanceSheetSchema.optional(),
  goals: FinancialGoalsSchema.optional(),
  previous: z
    .object({
      month: MonthStringSchema,
      netWorth: z.number().optional(),
      kpis: KpiSetSchema.optional(),
    })
    .optional(),
});

export type InsightsComputeInput = z.infer<typeof insightsComputeInputSchema>;

export const insightsComputeResultSchema = z.object({
  insight: MonthlyInsightSchema,
});

export type InsightsComputeResult = z.infer<typeof insightsComputeResultSchema>;

export const insightsListInputSchema = z.object({
  month: MonthStringSchema.optional(),
  limit: z.number().int().min(1).max(50).default(12),
});

export type InsightsListInput = z.infer<typeof insightsListInputSchema>;

export const insightsListResultSchema = z.object({
  insights: z.array(MonthlyInsightSchema),
});

export type InsightsListResult = z.infer<typeof insightsListResultSchema>;

export const healthScoreInputSchema = z.object({
  insight: MonthlyInsightSchema.optional(),
  month: MonthStringSchema.optional(),
});

export type HealthScoreInput = z.infer<typeof healthScoreInputSchema>;

export const healthScoreResultSchema = z.object({
  health: HealthScoreResultSchema,
});

export type HealthScoreToolResult = z.infer<typeof healthScoreResultSchema>;

export const actionsSuggestInputSchema = z.object({
  insight: MonthlyInsightSchema,
  health: HealthScoreResultSchema,
});

export type ActionsSuggestInput = z.infer<typeof actionsSuggestInputSchema>;

export const actionsSuggestResultSchema = z.object({
  actions: z.array(SuggestedActionSchema),
});

export type ActionsSuggestResult = z.infer<typeof actionsSuggestResultSchema>;

export const simulationsRunInputSchema = z.object({
  insight: MonthlyInsightSchema,
  actions: z.array(SuggestedActionSchema),
});

export type SimulationsRunInput = z.infer<typeof simulationsRunInputSchema>;

export const simulationsRunResultSchema = z.object({
  simulation: SimulationResultSchema,
});

export type SimulationsRunResult = z.infer<typeof simulationsRunResultSchema>;

export interface McpServerDependencies {
  db: NodePgDatabase;
  tenantSlug?: string;
  logger?: Pick<Console, "error" | "warn" | "info">;
  clock?: () => Date;
}

interface ToolContext {
  userId: string;
}

class ToolExecutionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

interface UserScope {
  tenant: Tenant;
  customer: Customer;
}

interface InternalDependencies extends Required<Pick<McpServerDependencies, "db">> {
  tenantSlug: string;
  logger: Pick<Console, "error" | "warn" | "info">;
  clock: () => Date;
}

function normaliseError(error: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  if (error instanceof ToolExecutionError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof ZodError) {
    return {
      code: "INVALID_INPUT",
      message: "Input validation failed",
      details: {
        issues: error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
          code: issue.code,
        })),
      },
    };
  }

  if (error instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: error.message,
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: "Unexpected error",
  };
}

function sanitiseMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined),
  );
}

async function ensureTenant(db: NodePgDatabase, slug: string): Promise<Tenant> {
  const existing = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);

  if (existing[0]) {
    return existing[0];
  }

  const inserted = await db
    .insert(tenants)
    .values({
      slug,
      name: slug,
      metadata: {},
    })
    .onConflictDoNothing()
    .returning();

  if (inserted[0]) {
    return inserted[0];
  }

  const fallback = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);

  if (!fallback[0]) {
    throw new ToolExecutionError("TENANT_CREATION_FAILED", `Unable to resolve tenant for slug ${slug}`);
  }

  return fallback[0];
}

async function ensureCustomer(
  db: NodePgDatabase,
  tenantId: Tenant["id"],
  userId: string,
): Promise<Customer> {
  const existing = await db
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.externalReference, userId)))
    .limit(1);

  if (existing[0]) {
    return existing[0];
  }

  const inserted = await db
    .insert(customers)
    .values({
      tenantId,
      externalReference: userId,
      metadata: {},
    })
    .onConflictDoNothing()
    .returning();

  if (inserted[0]) {
    return inserted[0];
  }

  const fallback = await db
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.externalReference, userId)))
    .limit(1);

  if (!fallback[0]) {
    throw new ToolExecutionError("CUSTOMER_CREATION_FAILED", `Unable to resolve customer for user ${userId}`);
  }

  return fallback[0];
}

async function resolveScope(
  deps: InternalDependencies,
  context: ToolContext,
): Promise<UserScope> {
  if (!context.userId) {
    throw new ToolExecutionError("USER_SCOPE_MISSING", "userId is required in tool context");
  }

  const tenant = await ensureTenant(deps.db, deps.tenantSlug);
  const customer = await ensureCustomer(deps.db, tenant.id, context.userId);
  return { tenant, customer };
}

function parseTransactionType(value: unknown): TransactionType {
  if (typeof value !== "string") {
    return "expense";
  }
  if (TransactionTypeEnum.options.includes(value as TransactionType)) {
    return value as TransactionType;
  }
  return "expense";
}

function parseDate(input: unknown, fallback: Date): string {
  if (typeof input === "string") {
    const date = new Date(input);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  return fallback.toISOString();
}

function toMonthlyTransaction(record: PaymentIntent): MonthlyTransaction {
  const metadata = (record.metadata ?? {}) as Record<string, unknown>;
  const baseAmount = typeof record.amount === "string" ? Number(record.amount) : Number(record.amount ?? 0);
  const type = parseTransactionType(metadata.type);
  return {
    id: record.id,
    amount: type === "income" ? Math.abs(baseAmount) : -Math.abs(baseAmount),
    type,
    category: typeof metadata.category === "string" ? metadata.category : undefined,
    description: record.description ?? (typeof metadata.description === "string" ? metadata.description : undefined),
  };
}

function toTransactionRecord(row: PaymentIntent): z.infer<typeof TransactionRecordSchema> {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt ?? Date.now());
  const occurredAt = metadata.occurredAt ?? createdAt.toISOString();
  const amount = typeof row.amount === "string" ? Number(row.amount) : Number(row.amount ?? 0);
  return TransactionRecordSchema.parse({
    id: row.id,
    amount,
    currency: row.currency,
    type: parseTransactionType(metadata.type),
    category: typeof metadata.category === "string" ? metadata.category : null,
    description: row.description ?? (typeof metadata.description === "string" ? metadata.description : null),
    notes: typeof metadata.notes === "string" ? metadata.notes : null,
    occurredAt: parseDate(occurredAt, createdAt),
    createdAt: createdAt.toISOString(),
    status: row.status,
    metadata: metadata,
  });
}

async function performIdempotentOperation<TResult>(
  deps: InternalDependencies,
  scope: UserScope,
  key: string,
  requestPayload: Record<string, unknown>,
  executor: () => Promise<TResult>,
): Promise<{ result: TResult; replayed: boolean }> {
  const requestHash = createHash("sha256").update(JSON.stringify(requestPayload)).digest("hex");
  const now = deps.clock();

  const [entry] = await deps.db
    .insert(idempotencyKeys)
    .values({
      tenantId: scope.tenant.id,
      idempotencyKey: key,
      requestHash,
      lockedAt: now,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [idempotencyKeys.tenantId, idempotencyKeys.idempotencyKey],
      set: {
        lockedAt: now,
      },
    })
    .returning({
      id: idempotencyKeys.id,
      requestHash: idempotencyKeys.requestHash,
      responsePayload: idempotencyKeys.responsePayload,
    });

  if (!entry) {
    throw new ToolExecutionError("IDEMPOTENCY_FAILURE", "Failed to record idempotency key");
  }

  if (entry.requestHash && entry.requestHash !== requestHash) {
    throw new ToolExecutionError("IDEMPOTENCY_CONFLICT", "Request payload differs from the original invocation", {
      existingRequestHash: entry.requestHash,
    });
  }

  if (entry.responsePayload !== null && entry.responsePayload !== undefined) {
    return { result: entry.responsePayload as TResult, replayed: true };
  }

  const result = await executor();
  const serialised = JSON.parse(JSON.stringify(result)) as TResult;

  await deps.db
    .update(idempotencyKeys)
    .set({
      responsePayload: serialised,
      requestHash,
      lockedAt: null,
    })
    .where(eq(idempotencyKeys.id, entry.id));

  return { result: serialised, replayed: false };
}

async function fetchTransactions(
  deps: InternalDependencies,
  scope: UserScope,
  options: { limit: number },
): Promise<PaymentIntent[]> {
  return deps.db
    .select()
    .from(paymentIntents)
    .where(
      and(
        eq(paymentIntents.tenantId, scope.tenant.id),
        eq(paymentIntents.customerId, scope.customer.id),
      ),
    )
    .orderBy(desc(paymentIntents.createdAt))
    .limit(options.limit);
}

function filterByMonth(
  transactions: PaymentIntent[],
  month?: string,
): PaymentIntent[] {
  if (!month) {
    return transactions;
  }
  return transactions.filter((transaction) => {
    const metadata = (transaction.metadata ?? {}) as Record<string, unknown>;
    const createdAt = transaction.createdAt instanceof Date
      ? transaction.createdAt
      : new Date(transaction.createdAt ?? Date.now());
    const occurredAt = typeof metadata.occurredAt === "string" ? metadata.occurredAt : createdAt.toISOString();
    return occurredAt.startsWith(month);
  });
}

type ToolResolver<TInput extends z.infer<any>, TResult> = (
  deps: InternalDependencies,
  input: TInput,
  context: ToolContext,
) => Promise<TResult>;

interface ToolDefinition<TInputSchema extends z.ZodTypeAny, TResultSchema extends z.ZodTypeAny> {
  name: ToolName;
  input: TInputSchema;
  output: TResultSchema;
  resolver: ToolResolver<z.infer<TInputSchema>, z.infer<TResultSchema>>;
}

const TOOL_DEFINITIONS: ToolDefinition<any, any>[] = [
  {
    name: "transactions.create",
    input: transactionsCreateInputSchema,
    output: transactionsCreateResultSchema,
    resolver: async (deps, input, context) => {
      const scope = await resolveScope(deps, context);
      const payload = {
        ...input,
        userId: context.userId,
      };

      const { result, replayed } = await performIdempotentOperation(
        deps,
        scope,
        input.idempotencyKey,
        payload,
        async () => {
          const metadata = sanitiseMetadata({
            ...input.metadata,
            type: input.type,
            category: input.category ?? undefined,
            occurredAt: input.occurredAt ?? undefined,
            notes: input.notes ?? undefined,
            rawText: input.rawText ?? undefined,
          });

          const [inserted] = await deps.db
            .insert(paymentIntents)
            .values({
              tenantId: scope.tenant.id,
              customerId: scope.customer.id,
              externalReference: input.reference ?? randomUUID(),
              amount: input.amount,
              currency: input.currency,
              status: input.status ?? "recorded",
              metadata,
              description: input.description ?? undefined,
            })
            .returning();

          if (!inserted) {
            throw new ToolExecutionError("TRANSACTION_INSERT_FAILED", "Unable to record transaction");
          }

          return {
            transaction: toTransactionRecord(inserted),
            idempotency: { replayed: false },
          } satisfies TransactionsCreateResult;
        },
      );

      if (replayed) {
        return {
          transaction: transactionsCreateResultSchema.shape.transaction.parse(result.transaction),
          idempotency: { replayed: true },
        } satisfies TransactionsCreateResult;
      }

      return {
        transaction: transactionsCreateResultSchema.shape.transaction.parse(result.transaction),
        idempotency: { replayed: false },
      } satisfies TransactionsCreateResult;
    },
  },
  {
    name: "transactions.list",
    input: transactionsListInputSchema,
    output: transactionsListResultSchema,
    resolver: async (deps, input, context) => {
      const scope = await resolveScope(deps, context);
      const raw = await fetchTransactions(deps, scope, { limit: Math.min(input.limit * 3, 500) });
      const filtered = filterByMonth(raw, input.month).slice(0, input.limit);
      const transactions = filtered.map((row) => {
        const record = toTransactionRecord(row);
        if (!input.includeMetadata) {
          delete record.metadata;
        }
        return record;
      });
      return { transactions } satisfies TransactionsListResult;
    },
  },
  {
    name: "insights.compute",
    input: insightsComputeInputSchema,
    output: insightsComputeResultSchema,
    resolver: async (deps, input, context) => {
      const scope = await resolveScope(deps, context);
      const raw = await fetchTransactions(deps, scope, { limit: 500 });
      const monthlyTransactions = filterByMonth(raw, input.month).map(toMonthlyTransaction);

      const computationInput = {
        userId: context.userId,
        month: input.month,
        transactions: monthlyTransactions,
        balances: input.balances as BalanceSheet | undefined,
        goals: input.goals as FinancialGoals | undefined,
        previous: input.previous,
      } satisfies Parameters<typeof computeMonthlyMemory>[0];

      const insight = computeMonthlyMemory(computationInput);
      return { insight } satisfies InsightsComputeResult;
    },
  },
  {
    name: "insights.list",
    input: insightsListInputSchema,
    output: insightsListResultSchema,
    resolver: async (_deps, input, context) => {
      const insights = listInsights(context.userId)
        .filter((insight) => (input.month ? insight.month === input.month : true))
        .sort((a, b) => (a.month > b.month ? -1 : a.month < b.month ? 1 : 0))
        .slice(0, input.limit);
      return { insights: insights.map((insight) => MonthlyInsightSchema.parse(insight)) } satisfies InsightsListResult;
    },
  },
  {
    name: "health.score",
    input: healthScoreInputSchema,
    output: healthScoreResultSchema,
    resolver: async (_deps, input, context) => {
      let insight = input.insight;
      if (!insight) {
        const existing = listInsights(context.userId).find((candidate) =>
          input.month ? candidate.month === input.month : true,
        );
        if (!existing) {
          throw new ToolExecutionError(
            "INSIGHT_NOT_FOUND",
            input.month
              ? `No monthly insight available for ${input.month}`
              : "No monthly insights available for user",
          );
        }
        insight = MonthlyInsightSchema.parse(existing);
      }

      const health = scoreFinancialHealth(insight.kpis);
      return { health: HealthScoreResultSchema.parse(health) } satisfies HealthScoreToolResult;
    },
  },
  {
    name: "actions.suggest",
    input: actionsSuggestInputSchema,
    output: actionsSuggestResultSchema,
    resolver: async (_deps, input) => {
      const actions = suggestActions(input.insight, input.health);
      return { actions: actions.map((action) => SuggestedActionSchema.parse(action)) } satisfies ActionsSuggestResult;
    },
  },
  {
    name: "simulations.run",
    input: simulationsRunInputSchema,
    output: simulationsRunResultSchema,
    resolver: async (_deps, input) => {
      const result = simulateAdjustments(input.insight, input.actions);
      return { simulation: SimulationResultSchema.parse(result) } satisfies SimulationsRunResult;
    },
  },
];

export type ToolHandlers = Record<ToolName, (input: Record<string, unknown>, context: ToolContext) => Promise<{
  tool: ToolName;
  status: "success" | "error";
  output?: unknown;
  error?: string;
}>>;

export function createMcpServer(dependencies: McpServerDependencies): ToolHandlers {
  if (!dependencies?.db) {
    throw new Error("MCP server requires a Drizzle database instance");
  }

  const deps: InternalDependencies = {
    db: dependencies.db,
    tenantSlug: dependencies.tenantSlug ?? "dompet",
    logger: dependencies.logger ?? console,
    clock: dependencies.clock ?? (() => new Date()),
  };

  const handlers = Object.fromEntries(
    TOOL_DEFINITIONS.map((definition) => {
      const handler = async (
        rawInput: Record<string, unknown>,
        context: ToolContext,
      ): Promise<{ tool: ToolName; status: "success" | "error"; output?: unknown; error?: string }> => {
        try {
          const input = definition.input.parse(rawInput);
          const output = await definition.resolver(deps, input, context);
          return {
            tool: definition.name,
            status: "success",
            output: definition.output.parse(output),
          };
        } catch (error) {
          const normalized = normaliseError(error);
          deps.logger.error?.(
            `[mcp:${definition.name}] ${normalized.code}: ${normalized.message}`,
            normalized.details ?? {},
          );
          return {
            tool: definition.name,
            status: "error",
            error: `${normalized.code}: ${normalized.message}`,
            output: normalized.details,
          };
        }
      };
      return [definition.name, handler];
    }),
  ) as ToolHandlers;

  return handlers;
}

export type {
  TransactionsCreateInput,
  TransactionsCreateResult,
  TransactionsListInput,
  TransactionsListResult,
  InsightsComputeInput,
  InsightsComputeResult,
  InsightsListInput,
  InsightsListResult,
  HealthScoreInput,
  HealthScoreToolResult,
  ActionsSuggestInput,
  ActionsSuggestResult,
  SimulationsRunInput,
  SimulationsRunResult,
};
