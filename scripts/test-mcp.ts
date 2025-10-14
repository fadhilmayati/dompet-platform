import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createMcpTools, type ToolRunResult } from "../src/mcp/tools";
import { transactions } from "../drizzle/schema";

const connectionString =
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_URL ??
  process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "Missing database connection string. Set POSTGRES_URL_NON_POOLING, POSTGRES_URL, or DATABASE_URL.",
  );
}

const TENANT_SLUG = "dompet-demo";

interface Step {
  name: string;
  input: unknown;
  validate?: (result: ToolRunResult<any>) => void;
  onSuccess?: (result: ToolRunResult<any>) => Promise<void> | void;
}

interface StepOutcome {
  tool: string;
  ok: boolean;
  info: string;
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);
  const tools = createMcpTools(db);
  const toolRegistry = new Map(tools.map((tool) => [tool.name, tool]));

  let createdTransactionId: string | null = null;
  const outcomes: StepOutcome[] = [];

  const now = new Date();
  const steps: Step[] = [
    {
      name: "users.list",
      input: { tenantSlug: TENANT_SLUG, limit: 10 },
      validate: (result) => {
        if (!Array.isArray(result.data) || result.data.length === 0) {
          throw new Error("users.list returned no users");
        }
      },
    },
    {
      name: "rules.list",
      input: { tenantSlug: TENANT_SLUG },
      validate: (result) => {
        if (!Array.isArray(result.data) || result.data.length === 0) {
          throw new Error("rules.list returned no rules");
        }
      },
    },
    {
      name: "badges.list",
      input: { tenantSlug: TENANT_SLUG },
      validate: (result) => {
        if (!Array.isArray(result.data) || result.data.length === 0) {
          throw new Error("badges.list returned no badges");
        }
      },
    },
    {
      name: "challenges.list",
      input: { tenantSlug: TENANT_SLUG, activeOnly: true, now },
      validate: (result) => {
        if (!Array.isArray(result.data) || result.data.length === 0) {
          throw new Error("challenges.list returned no active challenges");
        }
      },
    },
    {
      name: "transactions.list",
      input: { tenantSlug: TENANT_SLUG, userEmail: "ayu@dompet.id", limit: 5 },
      validate: (result) => {
        if (!Array.isArray(result.data) || result.data.length === 0) {
          throw new Error("transactions.list returned no transactions");
        }
      },
    },
    {
      name: "transactions.create",
      input: {
        tenantSlug: TENANT_SLUG,
        userEmail: "ayu@dompet.id",
        amount: 125000,
        currency: "IDR",
        type: "expense",
        category: "dining",
        description: "QA lunch outing",
        occurredAt: new Date().toISOString(),
        metadata: { source: "mcp-test" },
      },
      validate: (result) => {
        if (!result.data || typeof result.data !== "object" || !("id" in result.data)) {
          throw new Error("transactions.create did not return a transaction record");
        }
      },
      onSuccess: (result) => {
        if (result.data && typeof result.data === "object" && "id" in result.data) {
          createdTransactionId = String((result.data as Record<string, unknown>).id);
        }
      },
    },
    {
      name: "transactions.list",
      input: { tenantSlug: TENANT_SLUG, userEmail: "ayu@dompet.id", limit: 1 },
      validate: (result) => {
        if (!Array.isArray(result.data) || result.data.length === 0) {
          throw new Error("transactions.list after create returned no rows");
        }
        const [latest] = result.data as Array<Record<string, any>>;
        if (createdTransactionId && latest.id !== createdTransactionId) {
          throw new Error("transactions.list did not surface the freshly created transaction");
        }
        if (latest?.metadata?.source !== "mcp-test") {
          throw new Error("transactions.list result missing MCP test marker");
        }
      },
    },
  ];

  try {
    for (const step of steps) {
      const tool = toolRegistry.get(step.name);
      if (!tool) {
        throw new Error(`Tool ${step.name} is not registered in createMcpTools`);
      }

      const result = await tool.run(step.input);
      if (!result.ok) {
        throw new Error(`Tool ${step.name} failed: ${result.message ?? "unknown error"}`);
      }

      step.validate?.(result);
      await step.onSuccess?.(result);

      let info = "ok";
      if (Array.isArray(result.data)) {
        info = `${result.data.length} record(s)`;
      } else if (result.data && typeof result.data === "object") {
        info = "object";
      }
      outcomes.push({ tool: step.name, ok: true, info });
    }

    console.table(outcomes);
    console.log("✅ MCP tools exercised successfully");
  } catch (error) {
    console.error("❌ MCP tool execution failed:", error);
    process.exitCode = 1;
  } finally {
    try {
      if (createdTransactionId) {
        await db.delete(transactions).where(eq(transactions.id, createdTransactionId));
      }
    } finally {
      await pool.end();
    }
  }
}

main().catch((error) => {
  console.error("❌ Unexpected MCP tool error:", error);
  process.exit(1);
});
