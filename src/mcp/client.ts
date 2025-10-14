import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { ToolExecutionContext, ToolHandler } from "../orchestrator";
import {
  createMcpServer,
  type ActionsSuggestInput,
  type ActionsSuggestResult,
  type HealthScoreInput,
  type HealthScoreToolResult,
  type InsightsComputeInput,
  type InsightsComputeResult,
  type InsightsListInput,
  type InsightsListResult,
  type SimulationsRunInput,
  type SimulationsRunResult,
  type ToolHandlers,
  type ToolName,
  type TransactionsCreateInput,
  type TransactionsCreateResult,
  type TransactionsListInput,
  type TransactionsListResult,
  actionsSuggestResultSchema,
  healthScoreResultSchema,
  insightsComputeResultSchema,
  insightsListResultSchema,
  simulationsRunResultSchema,
  transactionsCreateResultSchema,
  transactionsListResultSchema,
} from "./server";
import * as schema from "../../drizzle/schema";
import { z } from "zod";

export interface McpClientConfig {
  db?: NodePgDatabase<typeof schema>;
  connectionString?: string;
  tenantSlug?: string;
  logger?: Pick<Console, "error" | "warn" | "info">;
  clock?: () => Date;
}

class ToolInvocationError extends Error {
  constructor(
    public readonly tool: ToolName,
    public readonly result: { status: string; error?: string; output?: unknown },
  ) {
    super(result.error ?? `Tool ${tool} failed`);
    this.name = "ToolInvocationError";
  }
}

function resolveConnectionString(config: McpClientConfig): string {
  const fromConfig = config.connectionString;
  if (fromConfig) {
    return fromConfig;
  }
  const envConnection =
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL;
  if (!envConnection) {
    throw new Error(
      "Missing database connection string. Set connectionString or POSTGRES_URL_NON_POOLING/POSTGRES_URL/DATABASE_URL.",
    );
  }
  return envConnection;
}

interface InternalClientState {
  db: NodePgDatabase<typeof schema>;
  pool?: Pool;
  handlers: ToolHandlers;
  tenantSlug: string;
}

function ensureHandlers(config: McpClientConfig): InternalClientState {
  let db = config.db as NodePgDatabase<typeof schema> | undefined;
  let pool: Pool | undefined;

  if (!db) {
    const connectionString = resolveConnectionString(config);
    pool = new Pool({ connectionString });
    db = drizzle(pool, { schema });
  }

  const tenantSlug = config.tenantSlug ?? "dompet";

  const handlers = createMcpServer({
    db,
    tenantSlug,
    logger: config.logger,
    clock: config.clock,
  });

  return { db, pool, handlers, tenantSlug };
}

export class McpClient {
  private readonly state: InternalClientState;

  constructor(config: McpClientConfig = {}) {
    this.state = ensureHandlers(config);
  }

  get tools(): Record<ToolName, ToolHandler> {
    return this.state.handlers as unknown as Record<ToolName, ToolHandler>;
  }

  get db(): NodePgDatabase<typeof schema> {
    return this.state.db;
  }

  get tenantSlug(): string {
    return this.state.tenantSlug;
  }

  private async invoke<TResult>(
    tool: ToolName,
    input: Record<string, unknown>,
    context: ToolExecutionContext,
    schema: z.ZodType<TResult>,
  ): Promise<TResult> {
    const handler = this.state.handlers[tool];
    if (!handler) {
      throw new Error(`Tool handler for ${tool} is not registered`);
    }

    const result = await handler(input, context);
    if (result.status !== "success") {
      throw new ToolInvocationError(tool, result);
    }
    return schema.parse(result.output);
  }

  async createTransaction(
    input: TransactionsCreateInput,
    context: ToolExecutionContext,
  ): Promise<TransactionsCreateResult> {
    return this.invoke("transactions.create", input, context, transactionsCreateResultSchema);
  }

  async listTransactions(
    input: TransactionsListInput,
    context: ToolExecutionContext,
  ): Promise<TransactionsListResult> {
    return this.invoke("transactions.list", input, context, transactionsListResultSchema);
  }

  async computeInsights(
    input: InsightsComputeInput,
    context: ToolExecutionContext,
  ): Promise<InsightsComputeResult> {
    return this.invoke("insights.compute", input, context, insightsComputeResultSchema);
  }

  async listInsights(
    input: InsightsListInput,
    context: ToolExecutionContext,
  ): Promise<InsightsListResult> {
    return this.invoke("insights.list", input, context, insightsListResultSchema);
  }

  async scoreHealth(
    input: HealthScoreInput,
    context: ToolExecutionContext,
  ): Promise<HealthScoreToolResult> {
    return this.invoke("health.score", input, context, healthScoreResultSchema);
  }

  async suggestActions(
    input: ActionsSuggestInput,
    context: ToolExecutionContext,
  ): Promise<ActionsSuggestResult> {
    return this.invoke("actions.suggest", input, context, actionsSuggestResultSchema);
  }

  async runSimulation(
    input: SimulationsRunInput,
    context: ToolExecutionContext,
  ): Promise<SimulationsRunResult> {
    return this.invoke("simulations.run", input, context, simulationsRunResultSchema);
  }

  async close(): Promise<void> {
    if (this.state.pool) {
      await this.state.pool.end();
    }
  }
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
  ToolName,
};
