import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { and, avg, count, desc, eq, sum } from "drizzle-orm";
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
import type { ToolExecutionResult } from "../../orchestrator";
import type { KPISet, SuggestedAction } from "../../types";

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

const scoreSchema = z.object({
  kpis: z.record(kpiSchema),
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

function chunkMessage(message: string, size = 120): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < message.length; i += size) {
    chunks.push(message.slice(i, i + size));
  }
  return chunks;
}

function resolveDb(c: Parameters<typeof requireUser>[0]): Database | null {
  return c.get("db") ?? maybeGetDb();
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
  const externalReference = `chat-${Date.now()}`;
  await db
    .insert(schema.paymentIntents)
    .values({
      tenantId: user.tenantId,
      customerId: user.customerId,
      externalReference,
      amount: String(transaction.amount),
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
    .returning({ id: schema.paymentIntents.id });
  return {
    tool: "transactions.create",
    status: "success",
    output: { reference: externalReference },
  };
}

router.post("/chat", async (c) => {
  const user = await requireUser(c);
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
  if (wantsStream) {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: "intent", data: JSON.stringify(result.intent) });
      await stream.writeSSE({ event: "plan", data: JSON.stringify(result.plan) });
      for (const chunk of chunkMessage(result.result.message)) {
        await stream.writeSSE({ event: "chunk", data: chunk });
      }
      await stream.writeSSE({ event: "result", data: JSON.stringify(result.result) });
      await stream.writeSSE({ event: "metadata", data: JSON.stringify(result.metadata) });
      await stream.writeSSE({ event: "done", data: JSON.stringify({ ok: true }) });
      stream.close();
    });
  }
  return c.json({ data: result });
});

router.get("/insights", async (c) => {
  const user = await requireUser(c);
  const query = z
    .object({ month: z.string().optional() })
    .parse(Object.fromEntries(c.req.queryEntries()));
  const insights = listInsights(user.userId).filter((insight) =>
    query.month ? insight.month === query.month : true,
  );
  const db = resolveDb(c);
  let recentTransactions: Array<{
    id: string;
    amount: number;
    currency: string;
    createdAt: string;
  }> = [];
  if (db) {
    const rows = await db
      .select({
        id: schema.paymentIntents.id,
        amount: schema.paymentIntents.amount,
        currency: schema.paymentIntents.currency,
        createdAt: schema.paymentIntents.createdAt,
      })
      .from(schema.paymentIntents)
      .where(
        and(
          eq(schema.paymentIntents.tenantId, user.tenantId),
          eq(schema.paymentIntents.customerId, user.customerId),
        ),
      )
      .orderBy(desc(schema.paymentIntents.createdAt))
      .limit(10);
    recentTransactions = rows.map((row) => ({
      id: row.id,
      amount: Number(row.amount ?? 0),
      currency: row.currency,
      createdAt: row.createdAt?.toISOString?.() ?? new Date().toISOString(),
    }));
  }
  return c.json({
    data: {
      insights,
      recentTransactions,
    },
  });
});

router.post("/insights", async (c) => {
  const user = await requireUser(c);
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
  const actions = suggestActions(insight, health);
  return c.json({ data: { insight, health, actions } });
});

router.post("/score", async (c) => {
  const user = await requireUser(c);
  const payload = scoreSchema.parse(await c.req.json());
  const kpis: KPISet = {};
  for (const entry of Object.values(payload.kpis)) {
    kpis[entry.key] = entry;
  }
  const score = scoreFinancialHealth(kpis);
  const db = resolveDb(c);
  let transactionCount = 0;
  if (db) {
    const [{ value }] = await db
      .select({ value: count(schema.paymentIntents.id) })
      .from(schema.paymentIntents)
      .where(
        and(
          eq(schema.paymentIntents.tenantId, user.tenantId),
          eq(schema.paymentIntents.customerId, user.customerId),
        ),
      );
    transactionCount = Number(value);
  }
  return c.json({ data: { score, kpis, transactionCount } });
});

router.post("/simulate", async (c) => {
  const user = await requireUser(c);
  const payload = simulateSchema.parse(await c.req.json());
  const insight = payload.insightId
    ? listInsights(user.userId).find((entry) => entry.id === payload.insightId)
    : listInsights(user.userId)[0];
  if (!insight) {
    throw new HTTPException(404, { message: "Insight not found" });
  }
  const health = scoreFinancialHealth(insight.kpis);
  const actions = suggestActions(insight, health);
  const actionMap = new Map(actions.map((action) => [action.id, action]));
  const selectedActions: SuggestedAction[] = payload.actions
    .map((actionId) => actionMap.get(actionId))
    .filter((action): action is SuggestedAction => Boolean(action));
  const simulation = simulateAdjustments(insight, selectedActions);
  return c.json({ data: { simulation } });
});

router.post("/upload-csv", async (c) => {
  const user = await requireUser(c);
  const payload = transactionUploadSchema.parse(await c.req.json());
  const lines = payload.csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length);
  if (lines.length <= 1) {
    throw new HTTPException(400, { message: "CSV must include a header and at least one row" });
  }
  const [, ...rows] = lines;
  const allowedTypes = new Set(["income", "expense", "investment", "debt", "transfer"]);
  const transactions = rows.map((row) => {
    const [date, description, amountRaw, type, category] = row.split(",").map((value) => value.trim());
    const amount = Number(amountRaw);
    if (Number.isNaN(amount)) {
      throw new HTTPException(400, { message: `Invalid amount in row: ${row}` });
    }
    const normalizedType = (type?.toLowerCase() ?? "expense") as "income" | "expense" | "investment" | "debt" | "transfer";
    const finalType = allowedTypes.has(normalizedType) ? normalizedType : "expense";
    const descriptionWithDate = description ? `${description} (${date})` : date;
    return {
      amount,
      type: finalType,
      category: category || undefined,
      description: descriptionWithDate,
    };
  });
  const insight = computeMonthlyMemory({
    userId: user.userId,
    month: payload.month,
    transactions,
  });
  const db = resolveDb(c);
  let totalAmount = 0;
  if (db) {
    const [{ value }] = await db
      .select({ value: sum(schema.paymentIntents.amount) })
      .from(schema.paymentIntents)
      .where(
        and(
          eq(schema.paymentIntents.tenantId, user.tenantId),
          eq(schema.paymentIntents.customerId, user.customerId),
        ),
      );
    totalAmount = Number(value ?? 0);
  }
  return c.json({ data: { insight, imported: transactions.length, totalAmount } });
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
    return c.json({
      data: {
        income: { tenantAverage: 0, you: 0 },
        savingsRate: { tenantAverage: 0, you: 0 },
      },
    });
  }
  const [averages] = await db
    .select({
      income: avg(schema.paymentIntents.amount),
    })
    .from(schema.paymentIntents)
    .where(eq(schema.paymentIntents.tenantId, user.tenantId));
  const insights = listInsights(user.userId);
  const latest = insights[insights.length - 1];
  const youIncome = latest?.kpis.income?.value ?? 0;
  const youSavingsRate = latest?.kpis.savingsRate?.value ?? 0;
  return c.json({
    data: {
      income: {
        tenantAverage: Number(averages?.income ?? 0),
        you: youIncome,
      },
      savingsRate: {
        tenantAverage: insights.length
          ? insights.reduce((sum, entry) => sum + (entry.kpis.savingsRate?.value ?? 0), 0) / insights.length
          : 0,
        you: youSavingsRate,
      },
    },
  });
});

router.get("/leaderboard", async (c) => {
  const user = await requireUser(c);
  const insights = listInsights(user.userId);
  const healthScores = insights.map((insight) => ({
    month: insight.month,
    score: scoreFinancialHealth(insight.kpis).total,
  }));
  const trend = healthScores.slice(-6);
  const db = resolveDb(c);
  let tenantCount = 1;
  if (db) {
    const [{ value }] = await db
      .select({ value: count(schema.customers.id) })
      .from(schema.customers)
      .where(eq(schema.customers.tenantId, user.tenantId));
    tenantCount = Number(value) || 1;
  }
  return c.json({
    data: {
      leaderboard: [
        { label: "You", score: trend.length ? trend[trend.length - 1].score : 0 },
        { label: "Tenant peers", score: trend.length ? trend.reduce((sum, item) => sum + item.score, 0) / trend.length : 0 },
      ],
      trend,
      tenantPopulation: tenantCount,
    },
  });
});

router.get("/preferences", async (c) => {
  const user = await requireUser(c);
  const db = resolveDb(c);
  if (!db) {
    return c.json({ data: { preferences: {} } });
  }
  const [customer] = await db
    .select({ metadata: schema.customers.metadata })
    .from(schema.customers)
    .where(eq(schema.customers.id, user.customerId))
    .limit(1);
  return c.json({ data: { preferences: customer?.metadata?.preferences ?? {} } });
});

router.put("/preferences", async (c) => {
  const user = await requireUser(c);
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
  return c.json({ data: { preferences: payload } });
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
