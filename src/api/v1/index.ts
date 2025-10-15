import { createHash } from "node:crypto";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { orchestrate } from "../../orchestrator";
import {
  ConversationMessageSchema,
  OrchestrationOptionsSchema,
  TransactionSchema,
} from "../../orchestrator/schemas";
import { insightVectorStore } from "../vector-store";
import { requireUser, type AppContext, type AuthenticatedUser } from "../auth";
import { suggestActions } from "../../actions/suggest";
import { computeMonthlyMemory } from "../../memory/monthly";
import { scoreFinancialHealth } from "../../score/health";
import { simulateAdjustments } from "../../simulator/simulate";
import { listInsights } from "../../storage/insights";
import { maybeGetDb, schema, type Database } from "../../db/client";
import { enforceRateLimit } from "../rate-limit";
import type { ToolExecutionResult } from "../../orchestrator";
import type { HealthScoreResult, KPISet, MonthlyInsight, SuggestedAction } from "../../types";

const router = new Hono<AppContext>();

const chatSchema = z.object({
  conversation: z.array(ConversationMessageSchema.omit({ id: true })).min(1),
  options: OrchestrationOptionsSchema.optional(),
});

const transactionUploadSchema = z.object({
  month: z.string(),
  csv: z.string(),
});

const computationSchema = z.object({
  month: z.string(),
  transactions: z
    .array(
      z.object({
        amount: z.number(),
        type: z.enum(["income", "expense", "investment", "debt", "transfer"]),
        category: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .min(1),
  balances: z
    .object({
      cash: z.number().optional(),
      investments: z.number().optional(),
      debt: z.number().optional(),
    })
    .optional(),
  goals: z
    .object({
      savingsRate: z.number().optional(),
      investmentRate: z.number().optional(),
      debtToIncome: z.number().optional(),
      expenseCapRatio: z.number().optional(),
    })
    .optional(),
  previous: z
    .object({
      month: z.string(),
      netWorth: z.number().optional(),
      kpis: z.record(z.any()).optional(),
    })
    .optional(),
});

const kpiSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number(),
  unit: z.enum(["currency", "ratio", "percentage"]).optional(),
  delta: z.number().optional(),
  goal: z.number().optional(),
});

const simulateSchema = z.object({
  insightId: z.string().optional(),
  actions: z.array(z.string()).default([]),
});

const preferencesSchema = z.object({
  categories: z.array(z.string()).optional(),
  notifications: z
    .object({
      email: z.boolean().optional(),
      sms: z.boolean().optional(),
      push: z.boolean().optional(),
    })
    .optional(),
  goals: z
    .object({
      savingsRate: z.number().optional(),
      investmentRate: z.number().optional(),
      debtToIncome: z.number().optional(),
      expenseCapRatio: z.number().optional(),
    })
    .optional(),
});

const suggestedActionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.enum(["income", "expense", "debt", "investment", "savings"]),
  rationale: z.string(),
  impact_myr: z.number(),
  score_delta: z.number(),
});

const chatResponseSchema = z.object({
  reply: z.string(),
  kpis: z.record(kpiSchema).optional(),
  actions: z.array(suggestedActionSchema).optional(),
  followup: z.string().optional(),
});

const insightsResponseSchema = z.object({
  kpis: z.record(kpiSchema),
  story: z.string(),
});

const scoreResponseSchema = z.object({
  score: z.number(),
  components: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      score: z.number(),
      weight: z.number(),
      message: z.string(),
    }),
  ),
  notes: z.array(z.string()).optional(),
});

const simulateResponseSchema = z.object({
  kpis: z.record(kpiSchema),
  score: z.number(),
});

const uploadCsvResponseSchema = z.object({
  ingestedCount: z.number(),
  batches: z.array(
    z.object({
      batch: z.number(),
      rowCount: z.number(),
      month: z.string(),
    }),
  ),
});

const computedInsightResponseSchema = z.object({
  insight: insightsResponseSchema,
  score: scoreResponseSchema,
  actions: z.array(suggestedActionSchema),
});

const benchmarkCohortSchema = z.object({
  cohort: z.object({
    region: z.string(),
    income_band: z.string(),
  }),
  metrics: z.object({
    income_avg: z.number(),
    savings_rate_avg: z.number(),
    sample_size: z.number(),
  }),
});

const benchmarksResponseSchema = z.object({
  cohorts: z.array(benchmarkCohortSchema),
});

const leaderboardResponseSchema = z.object({
  leaderboard: z.array(
    z.object({
      alias: z.string(),
      score: z.number(),
      region: z.string(),
      income_band: z.string(),
    }),
  ),
  you: z.object({
    alias: z.string(),
    score: z.number(),
  }),
});

const preferencesResponseSchema = z.object({
  preferences: preferencesSchema,
});

function chunkMessage(message: string, size = 120): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < message.length; i += size) {
    chunks.push(message.slice(i, i + size));
  }
  return chunks;
}

function respond<T extends z.ZodTypeAny>(c: Context<AppContext>, schema: T, payload: unknown, status = 200) {
  const parsed = schema.parse(payload);
  return c.json(parsed, status);
}

function resolveDb(c: Parameters<typeof requireUser>[0]): Database | null {
  return c.get("db") ?? maybeGetDb();
}

function estimateActionImpact(
  action: SuggestedAction,
  insight: MonthlyInsight,
  health: HealthScoreResult,
): { impact_myr: number; score_delta: number } {
  const income = insight.kpis.income?.value ?? 0;
  const cashFlow = insight.kpis.cashFlow?.value ?? 0;
  const base = Math.max(Math.abs(cashFlow), income * 0.05, 100);
  const categoryMultiplier: Record<SuggestedAction["category"], number> = {
    income: 0.25,
    expense: 0.3,
    debt: 0.22,
    investment: 0.18,
    savings: 0.2,
  };
  const impact = base * categoryMultiplier[action.category];
  const remainingScoreHeadroom = Math.max(0, 1 - health.total);
  const scoreDelta = Math.min(0.15, remainingScoreHeadroom * categoryMultiplier[action.category]);
  return {
    impact_myr: Number(impact.toFixed(2)),
    score_delta: Number(scoreDelta.toFixed(3)),
  };
}

function serializeActions(
  actions: SuggestedAction[],
  insight: MonthlyInsight,
  health: HealthScoreResult,
) {
  return actions.map((action) => ({
    id: action.id,
    title: action.title,
    description: action.description,
    category: action.category,
    rationale: action.rationale,
    ...estimateActionImpact(action, insight, health),
  }));
}

function allowsBenchmarking(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object") {
    return false;
  }
  const record = metadata as Record<string, unknown>;
  if (record.allow_benchmarking === true) {
    return true;
  }
  const preferences = record.preferences as Record<string, unknown> | undefined;
  if (preferences?.allowBenchmarking === true) {
    return true;
  }
  return false;
}

const EMOJI_POOL = [
  "🦊",
  "🐼",
  "🦁",
  "🐨",
  "🦄",
  "🐙",
  "🐝",
  "🐢",
  "🐧",
  "🐉",
];

function anonymizedAlias(id: string): string {
  const hash = createHash("sha256").update(id).digest("hex");
  const emoji = EMOJI_POOL[parseInt(hash.slice(0, 2), 16) % EMOJI_POOL.length];
  return `${emoji}${hash.slice(2, 8)}`;
}

function extractCohort(metadata: unknown): { region: string; income_band: string } {
  if (!metadata || typeof metadata !== "object") {
    return { region: "unknown", income_band: "unknown" };
  }
  const record = metadata as Record<string, unknown>;
  const profile = record.profile as Record<string, unknown> | undefined;
  const region = String(profile?.region ?? record.region ?? "unknown");
  const income = String(profile?.incomeBand ?? record.income_band ?? "unknown");
  return { region: region || "unknown", income_band: income || "unknown" };
}

async function persistTransaction(
  db: Database | null,
  user: AuthenticatedUser,
  transaction: z.infer<typeof TransactionSchema>,
): Promise<ToolExecutionResult> {
  if (!db) {
    return {
      tool: "transactions.create",
      status: "skipped",
      error: "Database unavailable",
    };
  }
  if (transaction.amount === null || transaction.currency === null) {
    return {
      tool: "transactions.create",
      status: "error",
      error: "Missing amount or currency",
    };
  }
  const numericAmount = Number(transaction.amount);
  if (!Number.isFinite(numericAmount)) {
    return {
      tool: "transactions.create",
      status: "error",
      error: "Invalid amount",
    };
  }
  const fallbackKey = createHash("sha256")
    .update(
      [
        user.tenantId,
        user.customerId,
        transaction.occurredAt ?? "",
        transaction.amount?.toString() ?? "",
        transaction.description ?? transaction.notes ?? "",
      ].join(":"),
    )
    .digest("hex")
    .slice(0, 24);
  const externalReference = transaction.idempotencyKey ?? `chat-${fallbackKey}`;

  const inserted = await db
    .insert(schema.paymentIntents)
    .values({
      tenantId: user.tenantId,
      customerId: user.customerId,
      externalReference,
      amount: String(numericAmount),
      currency: transaction.currency ?? "IDR",
      status: "succeeded",
      captureMethod: "automatic",
      metadata: {
        source: "chat_tool",
        occurredAt: transaction.occurredAt,
        merchant: transaction.merchant,
        category: transaction.category,
        notes: transaction.notes,
      },
      description: transaction.description ?? transaction.notes ?? "Chat transaction",
    })
    .onConflictDoNothing({
      target: [schema.paymentIntents.tenantId, schema.paymentIntents.externalReference],
    })
    .returning({ id: schema.paymentIntents.id });

  if (inserted.length === 0) {
    const [existing] = await db
      .select({ id: schema.paymentIntents.id })
      .from(schema.paymentIntents)
      .where(
        and(
          eq(schema.paymentIntents.tenantId, user.tenantId),
          eq(schema.paymentIntents.externalReference, externalReference),
        ),
      )
      .limit(1);
    return {
      tool: "transactions.create",
      status: "success",
      output: { reference: externalReference, id: existing?.id },
    };
  }

  return {
    tool: "transactions.create",
    status: "success",
    output: { reference: externalReference, id: inserted[0].id },
  };
}

router.post("/chat", async (c) => {
  const user = await requireUser(c);
  enforceRateLimit(c, { key: `chat:${user.userId}`, limit: 10, windowMs: 60_000 });
  const body = chatSchema.parse(await c.req.json());
  const options = body.options ?? {};
  const overrideModel = c.req.header("x-model");
  if (overrideModel) {
    options.classification = { ...(options.classification ?? {}), model: overrideModel };
    options.extraction = { ...(options.extraction ?? {}), model: overrideModel };
    options.summarization = { ...(options.summarization ?? {}), model: overrideModel };
    options.retrieval = { ...(options.retrieval ?? {}), model: overrideModel };
  }
  const request = {
    userId: user.userId,
    conversation: body.conversation,
    options,
  };
  const db = resolveDb(c);
  const dependencies = {
    vectorStore: insightVectorStore,
    tools: {
      "transactions.create": async (input: Record<string, unknown>) => {
        const parsed = TransactionSchema.safeParse(input.transaction ?? input);
        if (!parsed.success) {
          const failure: ToolExecutionResult = {
            tool: "transactions.create",
            status: "error",
            error: "Invalid transaction payload",
          };
          return failure;
        }
        return persistTransaction(db, user, parsed.data);
      },
    },
  };
  const wantsStream =
    c.req.header("accept")?.includes("text/event-stream") || c.req.query("stream") === "true";
  const result = await orchestrate(request, dependencies);
  const latestInsight = listInsights(user.userId).slice(-1)[0];
  const health = latestInsight ? scoreFinancialHealth(latestInsight.kpis) : null;
  const actionPayload =
    latestInsight && health ? serializeActions(suggestActions(latestInsight, health), latestInsight, health) : undefined;
  const finalPayload = chatResponseSchema.parse({
    reply: result.result.message,
    kpis: latestInsight?.kpis,
    actions: actionPayload,
    followup:
      result.intent.confidence < 0.4
        ? "Could you clarify your request so I can recommend the right action?"
        : undefined,
  });
  if (wantsStream) {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: "intent", data: JSON.stringify(result.intent) });
      await stream.writeSSE({ event: "plan", data: JSON.stringify(result.plan) });
      for (const chunk of chunkMessage(result.result.message)) {
        await stream.writeSSE({ event: "chunk", data: chunk });
      }
      await stream.writeSSE({ event: "result", data: JSON.stringify(finalPayload) });
      await stream.writeSSE({ event: "metadata", data: JSON.stringify(result.metadata) });
      await stream.writeSSE({ event: "done", data: JSON.stringify({ ok: true }) });
      stream.close();
    });
  }
  return respond(c, chatResponseSchema, finalPayload);
});

router.get("/insights", async (c) => {
  const user = await requireUser(c);
  const query = z
    .object({ month: z.string().regex(/^\d{4}-\d{2}$/) })
    .parse(Object.fromEntries(c.req.queryEntries()));
  const insight = listInsights(user.userId).find((entry) => entry.month === query.month);
  if (!insight) {
    throw new HTTPException(404, { message: "INSIGHT_NOT_FOUND" });
  }
  return respond(c, insightsResponseSchema, { kpis: insight.kpis, story: insight.story });
});

router.post("/insights", async (c) => {
  const user = await requireUser(c);
  enforceRateLimit(c, { key: `insights:${user.userId}`, limit: 6, windowMs: 60_000 });
  const payload = computationSchema.parse(await c.req.json());
  const db = resolveDb(c);
  let balances = payload.balances;
  if (!balances && db) {
    const [wallet] = await db
      .select({ balance: schema.walletAccounts.balance })
      .from(schema.walletAccounts)
      .where(
        and(
          eq(schema.walletAccounts.tenantId, user.tenantId),
          eq(schema.walletAccounts.customerId, user.customerId),
        ),
      )
      .limit(1);
    if (wallet?.balance !== undefined && wallet.balance !== null) {
      balances = { cash: Number(wallet.balance) };
    }
  }
  const insight = computeMonthlyMemory({
    userId: user.userId,
    month: payload.month,
    transactions: payload.transactions,
    balances,
    goals: payload.goals,
    previous: payload.previous,
  });
  const health = scoreFinancialHealth(insight.kpis);
  const actions = serializeActions(suggestActions(insight, health), insight, health);
  return respond(c, computedInsightResponseSchema, {
    insight: { kpis: insight.kpis, story: insight.story },
    score: {
      score: health.total * 100,
      components: health.components.map((component) => ({
        key: component.key,
        label: component.label,
        score: Number((component.score * 100).toFixed(1)),
        weight: component.weight,
        message: component.message,
      })),
      notes: health.notes,
    },
    actions,
  });
});

router.get("/score", async (c) => {
  const user = await requireUser(c);
  const query = z
    .object({ month: z.string().regex(/^\d{4}-\d{2}$/) })
    .parse(Object.fromEntries(c.req.queryEntries()));
  const insight = listInsights(user.userId).find((entry) => entry.month === query.month);
  if (!insight) {
    throw new HTTPException(404, { message: "SCORE_NOT_FOUND" });
  }
  const score = scoreFinancialHealth(insight.kpis);
  return respond(c, scoreResponseSchema, {
    score: score.total * 100,
    components: score.components.map((component) => ({
      key: component.key,
      label: component.label,
      score: Number((component.score * 100).toFixed(1)),
      weight: component.weight,
      message: component.message,
    })),
    notes: score.notes,
  });
});

router.post("/simulate", async (c) => {
  const user = await requireUser(c);
  enforceRateLimit(c, { key: `simulate:${user.userId}`, limit: 5, windowMs: 60_000 });
  const payload = simulateSchema.parse(await c.req.json());
  const insight = payload.insightId
    ? listInsights(user.userId).find((entry) => entry.id === payload.insightId)
    : listInsights(user.userId)[0];
  if (!insight) {
    throw new HTTPException(404, { message: "INSIGHT_NOT_FOUND" });
  }
  const baselineHealth = scoreFinancialHealth(insight.kpis);
  const actions = suggestActions(insight, baselineHealth);
  const actionMap = new Map(actions.map((action) => [action.id, action]));
  const selectedActions: SuggestedAction[] = payload.actions
    .map((actionId) => actionMap.get(actionId))
    .filter((action): action is SuggestedAction => Boolean(action));
  const simulation = simulateAdjustments(insight, selectedActions);
  const projectedHealth = scoreFinancialHealth(simulation.projectedInsight.kpis);
  return respond(c, simulateResponseSchema, {
    kpis: simulation.projectedInsight.kpis,
    score: Number((projectedHealth.total * 100).toFixed(1)),
  });
});

router.post("/upload-csv", async (c) => {
  const user = await requireUser(c);
  enforceRateLimit(c, { key: `upload:${user.userId}`, limit: 3, windowMs: 60_000 });
  const payload = transactionUploadSchema.parse(await c.req.json());
  const lines = payload.csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length);
  if (lines.length <= 1) {
    throw new HTTPException(400, { message: "CSV_HEADER_MISSING" });
  }
  const [, ...rows] = lines;
  if (rows.length > 2000) {
    throw new HTTPException(400, { message: "CSV_TOO_LARGE" });
  }
  const allowedTypes = new Set(["income", "expense", "investment", "debt", "transfer"]);
  const batches: Array<{ batch: number; rowCount: number; month: string }> = [];
  let processed = 0;
  for (let index = 0; index < rows.length; index += 500) {
    const slice = rows.slice(index, index + 500);
    const transactions = slice.map((row) => {
      const [date, description, amountRaw, type, category] = row.split(",").map((value) => value.trim());
      const amount = Number(amountRaw);
      if (!Number.isFinite(amount)) {
        throw new HTTPException(400, { message: "INVALID_AMOUNT" });
      }
      const normalizedType = (type?.toLowerCase() ?? "expense") as
        | "income"
        | "expense"
        | "investment"
        | "debt"
        | "transfer";
      const finalType = allowedTypes.has(normalizedType) ? normalizedType : "expense";
      const descriptionWithDate = description ? `${description} (${date})` : date;
      return {
        amount,
        type: finalType,
        category: category || undefined,
        description: descriptionWithDate,
      };
    });
    computeMonthlyMemory({
      userId: user.userId,
      month: payload.month,
      transactions,
    });
    processed += transactions.length;
    batches.push({ batch: batches.length + 1, rowCount: transactions.length, month: payload.month });
  }
  return respond(c, uploadCsvResponseSchema, { ingestedCount: processed, batches });
});

router.get("/challenges", async (c) => {
  const user = await requireUser(c);
  const insights = listInsights(user.userId);
  const latest = insights[insights.length - 1];
  if (!latest) {
    return c.json({ data: { challenges: [] } });
  }
  const health = scoreFinancialHealth(latest.kpis);
  const actions = suggestActions(latest, health);
  const challenges = actions.map((action) => ({
    id: action.id,
    title: action.title,
    category: action.category,
    rationale: action.rationale,
  }));
  return c.json({ data: { challenges } });
});

router.get("/benchmarks", async (c) => {
  const user = await requireUser(c);
  const db = resolveDb(c);
  if (!db) {
    throw new HTTPException(503, { message: "BENCHMARKS_DISABLED" });
  }
  const customerRows = await db
    .select({ id: schema.customers.id, metadata: schema.customers.metadata })
    .from(schema.customers)
    .where(eq(schema.customers.tenantId, user.tenantId));
  const customerMeta = new Map(customerRows.map((row) => [row.id, row.metadata]));
  const youMetadata = customerMeta.get(user.customerId);
  if (!allowsBenchmarking(youMetadata)) {
    throw new HTTPException(403, { message: "BENCHMARK_OPT_IN_REQUIRED" });
  }
  const allowed = new Set(
    customerRows.filter((row) => allowsBenchmarking(row.metadata)).map((row) => row.id),
  );
  if (!allowed.size) {
    return respond(c, benchmarksResponseSchema, { cohorts: [] });
  }
  const insights = listInsights()
    .filter((insight) => allowed.has(insight.userId))
    .filter((insight) => customerMeta.has(insight.userId));
  const cohorts = new Map<
    string,
    { region: string; income_band: string; incomeTotal: number; savingsTotal: number; count: number }
  >();
  for (const insight of insights) {
    const metadata = customerMeta.get(insight.userId);
    const cohort = extractCohort(metadata);
    const key = `${cohort.region}:${cohort.income_band}`;
    const entry = cohorts.get(key) ?? {
      region: cohort.region,
      income_band: cohort.income_band,
      incomeTotal: 0,
      savingsTotal: 0,
      count: 0,
    };
    entry.incomeTotal += insight.kpis.income?.value ?? 0;
    entry.savingsTotal += insight.kpis.savingsRate?.value ?? 0;
    entry.count += 1;
    cohorts.set(key, entry);
  }
  const payload = Array.from(cohorts.values()).map((cohort) => ({
    cohort: { region: cohort.region, income_band: cohort.income_band },
    metrics: {
      income_avg: cohort.count ? Number((cohort.incomeTotal / cohort.count).toFixed(2)) : 0,
      savings_rate_avg: cohort.count ? Number((cohort.savingsTotal / cohort.count).toFixed(3)) : 0,
      sample_size: cohort.count,
    },
  }));
  return respond(c, benchmarksResponseSchema, { cohorts: payload });
});

router.get("/leaderboard", async (c) => {
  const user = await requireUser(c);
  const db = resolveDb(c);
  if (!db) {
    throw new HTTPException(503, { message: "LEADERBOARD_DISABLED" });
  }
  const customerRows = await db
    .select({ id: schema.customers.id, metadata: schema.customers.metadata })
    .from(schema.customers)
    .where(eq(schema.customers.tenantId, user.tenantId));
  const customerMeta = new Map(customerRows.map((row) => [row.id, row.metadata]));
  const youMetadata = customerMeta.get(user.customerId);
  if (!allowsBenchmarking(youMetadata)) {
    throw new HTTPException(403, { message: "BENCHMARK_OPT_IN_REQUIRED" });
  }
  const allowed = new Set(
    customerRows.filter((row) => allowsBenchmarking(row.metadata)).map((row) => row.id),
  );
  const insights = listInsights()
    .filter((insight) => allowed.has(insight.userId))
    .filter((insight) => customerMeta.has(insight.userId));
  if (!insights.length) {
    return respond(c, leaderboardResponseSchema, {
      leaderboard: [],
      you: { alias: anonymizedAlias(user.customerId), score: 0 },
    });
  }
  const leaderboard = insights
    .map((insight) => {
      const metadata = customerMeta.get(insight.userId);
      const cohort = extractCohort(metadata);
      const score = scoreFinancialHealth(insight.kpis).total * 100;
      return {
        alias: anonymizedAlias(insight.userId),
        score: Number(score.toFixed(1)),
        region: cohort.region,
        income_band: cohort.income_band,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  const youInsight = insights
    .filter((insight) => insight.userId === user.customerId)
    .sort((a, b) => (a.month > b.month ? 1 : -1))
    .slice(-1)[0];
  const youScore = youInsight ? Number((scoreFinancialHealth(youInsight.kpis).total * 100).toFixed(1)) : 0;
  return respond(c, leaderboardResponseSchema, {
    leaderboard,
    you: { alias: anonymizedAlias(user.customerId), score: youScore },
  });
});

router.get("/preferences", async (c) => {
  const user = await requireUser(c);
  const db = resolveDb(c);
  if (!db) {
    return respond(c, preferencesResponseSchema, { preferences: {} });
  }
  const [customer] = await db
    .select({ metadata: schema.customers.metadata })
    .from(schema.customers)
    .where(eq(schema.customers.id, user.customerId))
    .limit(1);
  return respond(c, preferencesResponseSchema, {
    preferences: preferencesSchema.parse(customer?.metadata?.preferences ?? {}),
  });
});

router.post("/preferences", async (c) => {
  const user = await requireUser(c);
  enforceRateLimit(c, { key: `preferences:${user.userId}`, limit: 10, windowMs: 60_000 });
  const db = resolveDb(c);
  if (!db) {
    throw new HTTPException(503, { message: "Preferences storage unavailable" });
  }
  const payload = preferencesSchema.parse(await c.req.json());
  const [existing] = await db
    .select({ metadata: schema.customers.metadata })
    .from(schema.customers)
    .where(eq(schema.customers.id, user.customerId))
    .limit(1);
  const nextMetadata = {
    ...(existing?.metadata ?? {}),
    preferences: payload,
  };
  await db
    .update(schema.customers)
    .set({
      metadata: nextMetadata,
    })
    .where(eq(schema.customers.id, user.customerId));
  return respond(c, preferencesResponseSchema, { preferences: payload });
});

router.get("/preferences/categories", async (c) => {
  await requireUser(c);
  return c.json({
    data: {
      categories: [
        "Housing",
        "Transportation",
        "Food",
        "Utilities",
        "Insurance",
        "Healthcare",
        "Savings",
        "Entertainment",
      ],
    },
  });
});

export { router as apiRouter };
