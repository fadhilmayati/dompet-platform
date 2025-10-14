import "dotenv/config";

interface RegressionPrompt {
  id: string;
  userId: string;
  prompt: string;
}

interface PromptResult {
  id: string;
  status: number | "error";
  ok: boolean;
  note: string;
}

const CHAT_ENDPOINT = process.env.CHAT_ENDPOINT ?? "http://localhost:3000/chat";
const TIMEOUT_MS = Number(process.env.CHAT_TIMEOUT_MS ?? 20000);

const REGRESSION_SUITE: RegressionPrompt[] = [
  { id: "budget-overview", userId: "ayu", prompt: "Give me an overview of my spending this month." },
  { id: "savings-progress", userId: "ayu", prompt: "How much did I save last month?" },
  { id: "top-expenses", userId: "rahmat", prompt: "List my top three expense categories." },
  { id: "credit-card-status", userId: "rahmat", prompt: "Did I pay my credit card bill this week?" },
  { id: "debt-ratio", userId: "rahmat", prompt: "What's my current debt to income ratio?" },
  { id: "monday-transactions", userId: "ayu", prompt: "Summarise my transactions from last Monday." },
  { id: "savings-goal", userId: "ayu", prompt: "Create a short progress update for my savings goal." },
  { id: "unusual-expenses", userId: "ayu", prompt: "Any unusual expenses I should know about?" },
  { id: "investment-total", userId: "siti", prompt: "How much have I invested so far in May?" },
  { id: "rule-roundup", userId: "siti", prompt: "Remind me what rule triggers the round-up savings automation." },
  { id: "active-challenges", userId: "siti", prompt: "Which challenges are active for me right now?" },
  { id: "badge-update", userId: "siti", prompt: "Do I have any new badges unlocked recently?" },
  { id: "avg-daily-spend", userId: "ayu", prompt: "What is my average daily spending this month?" },
  { id: "month-comparison", userId: "ayu", prompt: "How does this month compare to last month?" },
  { id: "dining-transactions", userId: "ayu", prompt: "Show my recent dining transactions." },
  { id: "largest-transaction", userId: "rahmat", prompt: "What is my largest transaction this quarter?" },
  { id: "challenge-progress", userId: "rahmat", prompt: "Have I stayed under my no-takeout challenge?" },
  { id: "savings-advice", userId: "siti", prompt: "Give me advice on improving my savings rate." },
  { id: "emergency-fund", userId: "siti", prompt: "Do I have enough cash to cover emergencies?" },
  { id: "debt-payments", userId: "rahmat", prompt: "Summarise my debt payments this month." },
];

async function runPrompt(prompt: RegressionPrompt): Promise<PromptResult> {
  const payload = {
    userId: prompt.userId,
    conversation: [
      {
        role: "user",
        content: prompt.prompt,
      },
    ],
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const raw = await response.text();
    if (!response.ok) {
      return {
        id: prompt.id,
        status: response.status,
        ok: false,
        note: `HTTP ${response.status}: ${raw.slice(0, 200)}`,
      };
    }

    try {
      JSON.parse(raw);
      return {
        id: prompt.id,
        status: response.status,
        ok: true,
        note: "valid JSON",
      };
    } catch (error) {
      return {
        id: prompt.id,
        status: response.status,
        ok: false,
        note: `JSON parse error: ${(error as Error).message}`,
      };
    }
  } catch (error) {
    return {
      id: prompt.id,
      status: "error",
      ok: false,
      note: error instanceof Error ? error.message : "Unknown error",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  console.log(`Running regression suite against ${CHAT_ENDPOINT}`);
  const results: PromptResult[] = [];

  for (const prompt of REGRESSION_SUITE) {
    console.log(`➡️  ${prompt.id}`);
    const result = await runPrompt(prompt);
    results.push(result);
    if (!result.ok) {
      console.warn(`⚠️  ${prompt.id}: ${result.note}`);
    }
  }

  const successes = results.filter((result) => result.ok).length;
  const total = results.length;
  const successRate = successes / total;

  console.table(
    results.map((result) => ({
      prompt: result.id,
      status: result.status,
      ok: result.ok,
      note: result.note,
    })),
  );

  const percentage = Math.round(successRate * 1000) / 10;
  const summary = `${successes}/${total} responses produced valid JSON (${percentage}%)`;
  if (successRate < 0.95) {
    throw new Error(`${summary}, below required 95% threshold.`);
  }
  console.log(`✅ ${summary}`);
}

main().catch((error) => {
  console.error("❌ Regression suite failed:", error);
  process.exit(1);
});
