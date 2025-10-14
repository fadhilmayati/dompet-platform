/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  classifyIntent,
  extractTransaction,
  summarizeMonthLLM,
  type IntentClassification,
  type TransactionExtraction,
} from "../providers/model-router";
import { embedTexts } from "../providers/embeddings-router";
import {
  IntentSchema,
  MonthlySummarySchema,
  OrchestrationRequestSchema,
  PlanSchema,
  PlanStepSchema,
  RetrievalDocumentSchema,
  TransactionSchema,
  ToolExecutionResultSchema,
  type ConversationMessage,
  type Intent,
  type MonthlySummary,
  type OrchestrationRequest,
  type OrchestrationResult,
  type Plan,
  type PlanStep,
  type RetrievalDocument,
  type ToolExecutionResult,
} from "./schemas";
import { callChatModel, type ChatMessage } from "../providers/model-router";

export interface VectorStore {
  search(
    userId: string,
    queryEmbedding: number[],
    options?: { limit?: number }
  ): Promise<RetrievalDocument[]>;
}

export interface ToolExecutionContext {
  userId: string;
  conversation: ConversationMessage[];
  intent: Intent;
  retrievedDocuments: RetrievalDocument[];
  intermediate: Record<string, any>;
}

export type ToolHandler = (
  input: Record<string, any>,
  context: ToolExecutionContext
) => Promise<ToolExecutionResult>;

export interface OrchestratorDependencies {
  vectorStore?: VectorStore;
  tools?: Record<string, ToolHandler>;
}

interface ExecutionState {
  retrievedDocuments: RetrievalDocument[];
  stepResults: Record<string, any>;
  toolResults: ToolExecutionResult[];
  finalMessage?: string;
  resultData?: Record<string, any>;
}

function toChatMessages(conversation: ConversationMessage[]): ChatMessage[] {
  return conversation.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function latestUserMessage(conversation: ConversationMessage[]): ConversationMessage {
  for (let i = conversation.length - 1; i >= 0; i -= 1) {
    if (conversation[i].role === "user") {
      return conversation[i];
    }
  }
  return conversation[conversation.length - 1];
}

function buildPlan(intent: Intent): Plan {
  switch (intent.intent) {
    case "record_transaction":
      return PlanSchema.parse([
        {
          id: "extract-transaction",
          type: "llm",
          description: "Extract transaction fields from the latest user message",
          action: "extract-transaction",
        },
        {
          id: "persist-transaction",
          type: "tool",
          description: "Persist the extracted transaction for the user",
          tool: "transactions.create",
          dependsOn: ["extract-transaction"],
        },
        {
          id: "respond-user",
          type: "synthesis",
          description: "Craft a confirmation response for the user",
          dependsOn: ["persist-transaction"],
        },
      ]);
    case "budget_summary":
      return PlanSchema.parse([
        {
          id: "retrieve-context",
          type: "retrieval",
          description: "Retrieve recent transactions for the monthly summary",
        },
        {
          id: "summarize-month",
          type: "llm",
          description: "Summarize the retrieved transactions for the requested month",
          action: "summarize-month",
          dependsOn: ["retrieve-context"],
        },
        {
          id: "respond-user",
          type: "synthesis",
          description: "Deliver the monthly overview back to the user",
          dependsOn: ["summarize-month"],
        },
      ]);
    case "general_question":
      return PlanSchema.parse([
        {
          id: "retrieve-context",
          type: "retrieval",
          description: "Retrieve relevant personal finance notes for the user",
        },
        {
          id: "respond-user",
          type: "synthesis",
          description: "Answer the question using the retrieved context",
          dependsOn: ["retrieve-context"],
        },
      ]);
    default:
      return PlanSchema.parse([
        {
          id: "respond-user",
          type: "synthesis",
          description: "Let the user know their request could not be handled",
        },
      ]);
  }
}

async function executeRetrievalStep(
  step: PlanStep,
  request: OrchestrationRequest,
  dependencies: OrchestratorDependencies,
  state: ExecutionState
): Promise<void> {
  if (!dependencies.vectorStore) {
    state.stepResults[step.id] = [];
    return;
  }

  const limit =
    step.input?.limit ??
    request.options?.retrieval?.limit ??
    10;
  const provider = request.options?.retrieval?.provider as
    | "openai"
    | "fireworks"
    | undefined;
  const model = request.options?.retrieval?.model;
  const batchSize = request.options?.retrieval?.batchSize;

  const userMessage = latestUserMessage(request.conversation);
  const query = step.input?.query ?? userMessage.content;

  const { embeddings } = await embedTexts([query], {
    provider,
    model,
    batchSize,
  });

  const documents = await dependencies.vectorStore.search(
    request.userId,
    embeddings[0],
    { limit }
  );

  const filtered = documents
    .map((doc) => RetrievalDocumentSchema.parse(doc))
    .filter((doc) => doc.userId === request.userId);

  state.retrievedDocuments = filtered;
  state.stepResults[step.id] = filtered;
}

async function executeLLMStep(
  step: PlanStep,
  request: OrchestrationRequest,
  intent: Intent,
  state: ExecutionState
): Promise<void> {
  switch (step.action) {
    case "extract-transaction": {
      const userMessage = latestUserMessage(request.conversation);
      const extraction = await extractTransaction(userMessage.content, {
        provider: request.options?.extraction?.provider as any,
        model: request.options?.extraction?.model,
      });
      const parsed = TransactionSchema.parse(extraction);
      state.stepResults[step.id] = parsed;
      break;
    }
    case "summarize-month": {
      const month =
        request.options?.summarization?.month ?? new Date().toISOString().slice(0, 7);
      const tone = request.options?.summarization?.tone ?? "friendly";

      const transactions: Record<string, any>[] = state.retrievedDocuments
        .map((doc) => doc.metadata?.transaction)
        .filter(Boolean);

      const contextNotes = state.retrievedDocuments.map((doc) => doc.content);

      const summary = await summarizeMonthLLM(
        {
          userId: request.userId,
          month,
          transactions,
          context: contextNotes,
          tone,
        },
        {
          provider: request.options?.summarization?.provider as any,
          model: request.options?.summarization?.model,
        }
      );
      const parsed = MonthlySummarySchema.parse(summary);
      state.stepResults[step.id] = parsed;
      break;
    }
    default:
      throw new Error(`Unsupported LLM action: ${step.action ?? "(none)"}`);
  }
}

async function executeToolStep(
  step: PlanStep,
  request: OrchestrationRequest,
  intent: Intent,
  dependencies: OrchestratorDependencies,
  state: ExecutionState
): Promise<void> {
  if (!step.tool) {
    throw new Error("Tool step missing tool identifier");
  }

  const toolHandler = dependencies.tools?.[step.tool];
  if (!toolHandler) {
    const skipped = {
      tool: step.tool,
      status: "skipped",
      error: "Tool handler not registered",
    };
    state.toolResults.push(skipped);
    state.stepResults[step.id] = skipped;
    return;
  }

  const input = {
    ...(step.input ?? {}),
    transaction: state.stepResults["extract-transaction"],
  };

  const execution = await toolHandler(input, {
    userId: request.userId,
    conversation: request.conversation,
    intent,
    retrievedDocuments: state.retrievedDocuments,
    intermediate: state.stepResults,
  });

  const parsedExecution = ToolExecutionResultSchema.parse(execution);
  state.toolResults.push(parsedExecution);
  state.stepResults[step.id] = parsedExecution;
}

async function executeSynthesisStep(
  step: PlanStep,
  request: OrchestrationRequest,
  intent: Intent,
  state: ExecutionState
): Promise<void> {
  if (state.finalMessage) {
    return;
  }

  switch (intent.intent) {
    case "record_transaction": {
      const extraction = state.stepResults["extract-transaction"] as TransactionExtraction;
      const transaction = TransactionSchema.parse(extraction);
      const amount =
        typeof transaction.amount === "number"
          ? transaction.amount.toFixed(2)
          : "unknown";
      const currency = transaction.currency ?? "IDR";
      const when = transaction.occurredAt ?? "the specified date";
      const merchant = transaction.merchant ?? "the merchant";
      state.finalMessage = `Got it! I've recorded ${currency} ${amount} for ${merchant} on ${when}. Anything else you need?`;
      state.resultData = { transaction };
      break;
    }
    case "budget_summary": {
      const summary = state.stepResults["summarize-month"] as MonthlySummary;
      const parsed = MonthlySummarySchema.parse(summary);
      state.finalMessage = parsed.summary;
      state.resultData = { summary: parsed };
      break;
    }
    case "general_question": {
      const context = state.retrievedDocuments
        .map((doc) => `- ${doc.content}`)
        .join("\n");
      const latest = latestUserMessage(request.conversation);
      const response = await callChatModel(
        [
          {
            role: "system",
            content:
              "You are Dompet, a helpful finance assistant. Answer the question using only the provided user data. " +
              "If the answer is not in the context, say you do not have enough information.",
          },
          {
            role: "user",
            content: `${latest.content}\n\nContext:\n${context || "(no context)"}`,
          },
        ],
        {
          provider: request.options?.summarization?.provider as any,
          model: request.options?.summarization?.model,
        }
      );
      state.finalMessage = response.message.content;
      state.resultData = { documents: state.retrievedDocuments };
      break;
    }
    default:
      state.finalMessage =
        "I'm not sure how to help with that yet, but I'm learning more every day!";
      break;
  }
}

async function executePlan(
  plan: Plan,
  request: OrchestrationRequest,
  intent: Intent,
  dependencies: OrchestratorDependencies
): Promise<ExecutionState> {
  const state: ExecutionState = {
    retrievedDocuments: [],
    stepResults: {},
    toolResults: [],
  };

  for (const step of plan) {
    PlanStepSchema.parse(step);

    if (step.dependsOn) {
      const unmet = step.dependsOn.filter((dep) => !(dep in state.stepResults));
      if (unmet.length) {
        throw new Error(`Plan dependency unmet for step ${step.id}: ${unmet.join(", ")}`);
      }
    }

    switch (step.type) {
      case "retrieval":
        await executeRetrievalStep(step, request, dependencies, state);
        break;
      case "llm":
        await executeLLMStep(step, request, intent, state);
        break;
      case "tool":
        await executeToolStep(step, request, intent, dependencies, state);
        break;
      case "synthesis":
        await executeSynthesisStep(step, request, intent, state);
        break;
      default:
        throw new Error(`Unsupported plan step type: ${step.type}`);
    }
  }

  if (!state.finalMessage) {
    await executeSynthesisStep(
      { id: "synthesis-fallback", type: "synthesis", description: "fallback" },
      request,
      intent,
      state
    );
  }

  return state;
}

export async function orchestrate(
  request: OrchestrationRequest,
  dependencies: OrchestratorDependencies = {}
): Promise<OrchestrationResult> {
  const start = Date.now();
  const parsedRequest = OrchestrationRequestSchema.parse(request);

  const intentResult = await classifyIntent(
    toChatMessages(parsedRequest.conversation),
    {
      provider: parsedRequest.options?.classification?.provider as any,
      model: parsedRequest.options?.classification?.model,
    }
  );
  const intent = IntentSchema.parse(intentResult as IntentClassification);

  const plan = buildPlan(intent);

  const state = await executePlan(plan, parsedRequest, intent, dependencies);

  const executionTimeMs = Date.now() - start;

  return {
    intent,
    plan,
    result: {
      message: state.finalMessage ?? "",
      data: state.resultData,
      documents: state.retrievedDocuments,
    },
    metadata: {
      toolResults: state.toolResults,
      executionTimeMs,
    },
  };
}

export type { OrchestrationRequest, OrchestrationResult } from "./schemas";
